import fs from 'node:fs';
import path from 'node:path';
import { getSupabaseAdmin, isSupabaseAdminConfigured } from '../lib/supabaseAdmin';
import { serverLogger } from '../lib/logger';
import { LOCAL_FALLBACK_BANNER, isLocalDevFallbackAllowed, isProduction } from '../config/runtimeEnvironment';
import { ArchitectChatAttachmentKind } from '../config/architectChat';

/**
 * Persistence for Arquiteto Estagiário conversations and messages. Same shape
 * as services/humanizedFloorplanStore.ts: Supabase is the store (tables
 * architect_chat_conversations / architect_chat_messages); the local JSON
 * backend exists ONLY for tests and the explicit dev fallback
 * (ALLOW_LOCAL_DEV_FALLBACK=true) and refuses to construct in production.
 * Every read/write is scoped by userId. Credits are NOT stored here as a
 * ledger: the wallet's credit_ledger is the source of truth; a message row
 * keeps only the movement ids and a summary.
 */

export type ArchitectMessageRole = 'user' | 'assistant';
export type ArchitectMessageStatus = 'completed' | 'failed';

export interface ArchitectMessageUsage {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface StoredAttachment {
  kind: ArchitectChatAttachmentKind;
  path: string;
  mime: string;
  originalFileName: string | null;
  /** Only ever present for kind 'audio' — the transcript that was actually sent to the model. */
  transcript: string | null;
}

export interface ConversationRecord {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  userId: string;
  role: ArchitectMessageRole;
  content: string;
  attachments: StoredAttachment[];
  status: ArchitectMessageStatus;
  errorCode: string | null;
  errorMessage: string | null;
  creditsCharged: number;
  reservationId: string | null;
  captureTransactionId: string | null;
  refundTransactionId: string | null;
  model: string | null;
  requestId: string | null;
  usage: ArchitectMessageUsage | null;
  costUsd: number | null;
  createdAt: string;
}

export interface ArchitectChatStore {
  readonly backend: 'supabase' | 'local';
  createConversation(conversation: ConversationRecord): Promise<void>;
  touchConversation(userId: string, id: string, patch: Partial<Pick<ConversationRecord, 'title' | 'updatedAt'>>): Promise<void>;
  getConversation(userId: string, id: string): Promise<ConversationRecord | null>;
  listConversations(userId: string, limit: number): Promise<ConversationRecord[]>;
  softDeleteConversation(userId: string, id: string): Promise<boolean>;
  insertMessage(message: MessageRecord): Promise<void>;
  updateMessage(userId: string, id: string, patch: Partial<MessageRecord>): Promise<void>;
  listMessages(userId: string, conversationId: string, limit: number): Promise<MessageRecord[]>;
}

// --- Local JSON backend (tests / explicit dev fallback only) ----------------------

const LOCAL_FILE = path.join(__dirname, '..', '..', 'private-data', 'architect-chat.json');

interface LocalData {
  conversations: ConversationRecord[];
  messages: MessageRecord[];
}

export class LocalArchitectChatStore implements ArchitectChatStore {
  readonly backend = 'local' as const;
  private data: LocalData | null = null;

  constructor(private readonly filePath: string = LOCAL_FILE) {
    if (isProduction()) throw new Error('LocalArchitectChatStore cannot be used in production.');
  }

  private load(): LocalData {
    if (this.data) return this.data;
    try {
      this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as LocalData;
    } catch {
      this.data = { conversations: [], messages: [] };
    }
    return this.data;
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data ?? { conversations: [], messages: [] }));
    fs.renameSync(tmp, this.filePath);
  }

  async createConversation(conversation: ConversationRecord): Promise<void> {
    this.load().conversations.push(conversation);
    this.persist();
  }

  async touchConversation(userId: string, id: string, patch: Partial<Pick<ConversationRecord, 'title' | 'updatedAt'>>): Promise<void> {
    const c = this.load().conversations.find((x) => x.id === id && x.userId === userId);
    if (!c) return;
    Object.assign(c, patch);
    this.persist();
  }

  async getConversation(userId: string, id: string): Promise<ConversationRecord | null> {
    const c = this.load().conversations.find((x) => x.id === id && x.userId === userId && !x.deletedAt);
    return c ? { ...c } : null;
  }

  async listConversations(userId: string, limit: number): Promise<ConversationRecord[]> {
    return this.load()
      .conversations.filter((c) => c.userId === userId && !c.deletedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((c) => ({ ...c }));
  }

  async softDeleteConversation(userId: string, id: string): Promise<boolean> {
    const c = this.load().conversations.find((x) => x.id === id && x.userId === userId && !x.deletedAt);
    if (!c) return false;
    c.deletedAt = new Date().toISOString();
    this.persist();
    return true;
  }

  async insertMessage(message: MessageRecord): Promise<void> {
    this.load().messages.push(message);
    this.persist();
  }

  async updateMessage(userId: string, id: string, patch: Partial<MessageRecord>): Promise<void> {
    const m = this.load().messages.find((x) => x.id === id && x.userId === userId);
    if (!m) return;
    Object.assign(m, patch);
    this.persist();
  }

  async listMessages(userId: string, conversationId: string, limit: number): Promise<MessageRecord[]> {
    return this.load()
      .messages.filter((m) => m.userId === userId && m.conversationId === conversationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-limit)
      .map((m) => ({ ...m }));
  }
}

// --- Supabase backend --------------------------------------------------------

const CONVERSATIONS_TABLE = 'architect_chat_conversations';
const MESSAGES_TABLE = 'architect_chat_messages';

type Row = Record<string, unknown>;

function conversationFromRow(row: Row): ConversationRecord {
  return { id: row.id as string, userId: row.user_id as string, title: row.title as string, createdAt: row.created_at as string, updatedAt: row.updated_at as string, deletedAt: (row.deleted_at as string | null) ?? null };
}

function messageToRow(m: Partial<MessageRecord>): Row {
  const row: Row = {};
  if (m.id !== undefined) row.id = m.id;
  if (m.conversationId !== undefined) row.conversation_id = m.conversationId;
  if (m.userId !== undefined) row.user_id = m.userId;
  if (m.role !== undefined) row.role = m.role;
  if (m.content !== undefined) row.content = m.content;
  if (m.attachments !== undefined) row.attachments = m.attachments;
  if (m.status !== undefined) row.status = m.status;
  if (m.errorCode !== undefined) row.error_code = m.errorCode;
  if (m.errorMessage !== undefined) row.error_message = m.errorMessage;
  if (m.creditsCharged !== undefined) row.credits_charged = m.creditsCharged;
  if (m.reservationId !== undefined) row.reservation_id = m.reservationId;
  if (m.captureTransactionId !== undefined) row.capture_transaction_id = m.captureTransactionId;
  if (m.refundTransactionId !== undefined) row.refund_transaction_id = m.refundTransactionId;
  if (m.model !== undefined) row.model = m.model;
  if (m.requestId !== undefined) row.request_id = m.requestId;
  if (m.usage !== undefined) row.usage = m.usage;
  if (m.costUsd !== undefined) row.cost_usd = m.costUsd;
  if (m.createdAt !== undefined) row.created_at = m.createdAt;
  return row;
}

function messageFromRow(row: Row): MessageRecord {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    userId: row.user_id as string,
    role: row.role as ArchitectMessageRole,
    content: (row.content as string | null) ?? '',
    attachments: (row.attachments as StoredAttachment[] | null) ?? [],
    status: row.status as ArchitectMessageStatus,
    errorCode: (row.error_code as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    creditsCharged: Number(row.credits_charged ?? 0),
    reservationId: (row.reservation_id as string | null) ?? null,
    captureTransactionId: (row.capture_transaction_id as string | null) ?? null,
    refundTransactionId: (row.refund_transaction_id as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    requestId: (row.request_id as string | null) ?? null,
    usage: (row.usage as ArchitectMessageUsage | null) ?? null,
    costUsd: row.cost_usd === null || row.cost_usd === undefined ? null : Number(row.cost_usd),
    createdAt: row.created_at as string,
  };
}

export class SupabaseArchitectChatStore implements ArchitectChatStore {
  readonly backend = 'supabase' as const;

  async createConversation(conversation: ConversationRecord): Promise<void> {
    const { error } = await getSupabaseAdmin()
      .from(CONVERSATIONS_TABLE)
      .insert({ id: conversation.id, user_id: conversation.userId, title: conversation.title, created_at: conversation.createdAt, updated_at: conversation.updatedAt, deleted_at: conversation.deletedAt });
    if (error) throw new Error(`insert conversation failed: ${error.message}`);
  }

  async touchConversation(userId: string, id: string, patch: Partial<Pick<ConversationRecord, 'title' | 'updatedAt'>>): Promise<void> {
    const row: Row = {};
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.updatedAt !== undefined) row.updated_at = patch.updatedAt;
    const { error } = await getSupabaseAdmin().from(CONVERSATIONS_TABLE).update(row).eq('id', id).eq('user_id', userId);
    if (error) throw new Error(`update conversation failed: ${error.message}`);
  }

  async getConversation(userId: string, id: string): Promise<ConversationRecord | null> {
    const { data, error } = await getSupabaseAdmin().from(CONVERSATIONS_TABLE).select('*').eq('id', id).eq('user_id', userId).is('deleted_at', null).maybeSingle();
    if (error) throw new Error(`get conversation failed: ${error.message}`);
    return data ? conversationFromRow(data) : null;
  }

  async listConversations(userId: string, limit: number): Promise<ConversationRecord[]> {
    const { data, error } = await getSupabaseAdmin().from(CONVERSATIONS_TABLE).select('*').eq('user_id', userId).is('deleted_at', null).order('updated_at', { ascending: false }).limit(limit);
    if (error) throw new Error(`list conversations failed: ${error.message}`);
    return (data ?? []).map(conversationFromRow);
  }

  async softDeleteConversation(userId: string, id: string): Promise<boolean> {
    const { data, error } = await getSupabaseAdmin().from(CONVERSATIONS_TABLE).update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId).is('deleted_at', null).select('id');
    if (error) throw new Error(`delete conversation failed: ${error.message}`);
    return (data ?? []).length > 0;
  }

  async insertMessage(message: MessageRecord): Promise<void> {
    const { error } = await getSupabaseAdmin().from(MESSAGES_TABLE).insert(messageToRow(message));
    if (error) throw new Error(`insert message failed: ${error.message}`);
  }

  async updateMessage(userId: string, id: string, patch: Partial<MessageRecord>): Promise<void> {
    const { error } = await getSupabaseAdmin().from(MESSAGES_TABLE).update(messageToRow(patch)).eq('id', id).eq('user_id', userId);
    if (error) throw new Error(`update message failed: ${error.message}`);
  }

  async listMessages(userId: string, conversationId: string, limit: number): Promise<MessageRecord[]> {
    const { data, error } = await getSupabaseAdmin().from(MESSAGES_TABLE).select('*').eq('user_id', userId).eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(limit);
    if (error) throw new Error(`list messages failed: ${error.message}`);
    return (data ?? []).map(messageFromRow).reverse();
  }
}

// --- Selection ---------------------------------------------------------------

let overrideStore: ArchitectChatStore | null = null;
let resolved: Promise<ArchitectChatStore> | null = null;

async function resolveStore(): Promise<ArchitectChatStore> {
  if (overrideStore) return overrideStore;
  if (isSupabaseAdminConfigured()) {
    const { error } = await getSupabaseAdmin().from(CONVERSATIONS_TABLE).select('id').limit(1);
    if (!error) {
      serverLogger.log('Arquiteto Estagiário: using Supabase store');
      return new SupabaseArchitectChatStore();
    }
    if (isProduction()) throw new Error(`Chat tables are not available in Supabase (${error.code ?? 'error'}): apply the migrations before starting production.`);
    if (!isLocalDevFallbackAllowed()) {
      throw new Error(`Chat tables are not available in Supabase (${error.code ?? 'error'}): apply supabase/migrations/20260921120000_architect_chat.sql, or set ALLOW_LOCAL_DEV_FALLBACK=true.`);
    }
  } else if (isProduction() || !isLocalDevFallbackAllowed()) {
    throw new Error('Supabase is not configured: chat history cannot start.');
  }
  serverLogger.error(`${LOCAL_FALLBACK_BANNER} — chat history is a LOCAL JSON file`);
  return new LocalArchitectChatStore();
}

export function getArchitectChatStore(): Promise<ArchitectChatStore> {
  if (!resolved) {
    resolved = resolveStore().catch((err) => {
      resolved = null;
      throw err;
    });
  }
  return resolved;
}

export function setArchitectChatStoreForTests(store: ArchitectChatStore | null): void {
  overrideStore = store;
  resolved = null;
}
