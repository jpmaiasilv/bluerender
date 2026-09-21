import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getSupabaseAdmin, isSupabaseAdminConfigured } from '../lib/supabaseAdmin';
import { serverLogger } from '../lib/logger';
import { LOCAL_FALLBACK_BANNER, isLocalDevFallbackAllowed, isProduction } from '../config/runtimeEnvironment';
import { ARCHITECT_CHAT_MAX_FILE_BYTES } from '../config/architectChat';

/**
 * Private file storage for Arquiteto Estagiário attachments (images, audio,
 * documents the user sends into the chat). Same shape as
 * storage/humanizedFloorplanFiles.ts: a PRIVATE Supabase Storage bucket in
 * production/normal use, objects at "<user_id>/<conversation_id>/<message_id>/<index>.<ext>",
 * never a public URL — only short-lived signed URLs minted after an
 * ownership check. Local disk exists solely for tests and the explicit dev
 * fallback and refuses to construct in production.
 */

export const ARCHITECT_CHAT_BUCKET = 'architect-chat-files';
export const ARCHITECT_CHAT_SIGNED_URL_TTL_SECONDS = 10 * 60;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'audio/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/ogg': 'ogg',
  'text/plain': 'txt',
};

const SAFE_SEGMENT = /^[A-Za-z0-9-]{8,64}$/;

export function isSafePathSegment(value: string): boolean {
  return SAFE_SEGMENT.test(value);
}

/** The only way an attachment object path is ever produced. Throws on anything unsafe. */
export function buildAttachmentPath(userId: string, conversationId: string, messageId: string, index: number, mime: string): string {
  if (!isSafePathSegment(userId) || !isSafePathSegment(conversationId) || !isSafePathSegment(messageId)) throw new Error('Unsafe storage path segment.');
  const ext = EXTENSIONS[mime];
  if (!ext) throw new Error(`Unsupported storage MIME type: ${mime}`);
  if (!Number.isInteger(index) || index < 0 || index > 63) throw new Error('Unsafe attachment index.');
  return `${userId}/${conversationId}/${messageId}/${index}.${ext}`;
}

export interface ArchitectChatFileStorage {
  readonly backend: 'supabase' | 'local';
  save(userId: string, conversationId: string, messageId: string, index: number, buffer: Buffer, mime: string): Promise<string>;
  read(objectPath: string): Promise<Buffer | null>;
  exists(objectPath: string): Promise<boolean>;
  removeConversation(userId: string, conversationId: string): Promise<void>;
  signedUrl(objectPath: string, downloadName?: string): Promise<string | null>;
}

// --- Supabase Storage ------------------------------------------------------------

export class SupabaseArchitectChatFileStorage implements ArchitectChatFileStorage {
  readonly backend = 'supabase' as const;

  private bucket() {
    return getSupabaseAdmin().storage.from(ARCHITECT_CHAT_BUCKET);
  }

  async save(userId: string, conversationId: string, messageId: string, index: number, buffer: Buffer, mime: string): Promise<string> {
    if (buffer.length === 0 || buffer.length > ARCHITECT_CHAT_MAX_FILE_BYTES) throw new Error('File size is outside the allowed range.');
    const objectPath = buildAttachmentPath(userId, conversationId, messageId, index, mime);
    const { error } = await this.bucket().upload(objectPath, buffer, { contentType: mime, upsert: true });
    if (error) throw new Error(`storage upload failed: ${error.message}`);
    return objectPath;
  }

  async read(objectPath: string): Promise<Buffer | null> {
    const { data, error } = await this.bucket().download(objectPath);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }

  async exists(objectPath: string): Promise<boolean> {
    const dir = path.posix.dirname(objectPath);
    const name = path.posix.basename(objectPath);
    const { data, error } = await this.bucket().list(dir, { search: name, limit: 5 });
    if (error) throw new Error(`storage list failed: ${error.message}`);
    return (data ?? []).some((o) => o.name === name);
  }

  async removeConversation(userId: string, conversationId: string): Promise<void> {
    if (!isSafePathSegment(userId) || !isSafePathSegment(conversationId)) return;
    const dir = `${userId}/${conversationId}`;
    const { data: messageDirs, error } = await this.bucket().list(dir, { limit: 500 });
    if (error) throw new Error(`storage list failed: ${error.message}`);
    const paths: string[] = [];
    for (const entry of messageDirs ?? []) {
      const sub = `${dir}/${entry.name}`;
      const { data: files, error: subErr } = await this.bucket().list(sub, { limit: 50 });
      if (subErr) throw new Error(`storage list failed: ${subErr.message}`);
      for (const f of files ?? []) paths.push(`${sub}/${f.name}`);
    }
    if (paths.length === 0) return;
    const removed = await this.bucket().remove(paths);
    if (removed.error) throw new Error(`storage remove failed: ${removed.error.message}`);
  }

  async signedUrl(objectPath: string, downloadName?: string): Promise<string | null> {
    const { data, error } = await this.bucket().createSignedUrl(objectPath, ARCHITECT_CHAT_SIGNED_URL_TTL_SECONDS, downloadName ? { download: downloadName } : undefined);
    if (error || !data) return null;
    return data.signedUrl;
  }
}

// --- Local disk (tests / explicit dev fallback only) -----------------------------

export const LOCAL_ARCHITECT_CHAT_FILES_ROOT = path.join(__dirname, '..', '..', 'private-data', 'architect-chat-files');
const SIGNING_SECRET = process.env.ARCHITECT_CHAT_FILE_SIGNING_SECRET || crypto.randomBytes(32).toString('hex');
const LOCAL_FILE_ROUTE = '/api/architect-chat/file';

function sign(payload: string): string {
  return crypto.createHmac('sha256', SIGNING_SECRET).update(payload).digest('base64url');
}

export interface SignedFileClaims {
  path: string;
  expiresAt: number;
  name?: string;
}

export function createFileToken(objectPath: string, ttlMs: number = ARCHITECT_CHAT_SIGNED_URL_TTL_SECONDS * 1000, now: number = Date.now(), name?: string): string {
  const payload = Buffer.from(JSON.stringify({ path: objectPath, expiresAt: now + ttlMs, ...(name ? { name } : {}) } satisfies SignedFileClaims)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyFileToken(token: string, now: number = Date.now()): SignedFileClaims | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const a = Buffer.from(signature);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SignedFileClaims;
    if (typeof claims.path !== 'string' || typeof claims.expiresAt !== 'number' || claims.expiresAt < now) return null;
    return claims;
  } catch {
    return null;
  }
}

export function contentTypeForPath(objectPath: string): string {
  const ext = path.extname(objectPath).toLowerCase().slice(1);
  const found = Object.entries(EXTENSIONS).find(([, e]) => e === ext);
  return found ? found[0] : 'application/octet-stream';
}

export class LocalArchitectChatFileStorage implements ArchitectChatFileStorage {
  readonly backend = 'local' as const;

  constructor(private readonly root: string = LOCAL_ARCHITECT_CHAT_FILES_ROOT) {
    if (isProduction()) throw new Error('LocalArchitectChatFileStorage cannot be used in production.');
  }

  private resolve(objectPath: string): string | null {
    const full = path.resolve(this.root, objectPath);
    return full.startsWith(path.resolve(this.root) + path.sep) ? full : null;
  }

  async save(userId: string, conversationId: string, messageId: string, index: number, buffer: Buffer, mime: string): Promise<string> {
    if (buffer.length === 0 || buffer.length > ARCHITECT_CHAT_MAX_FILE_BYTES) throw new Error('File size is outside the allowed range.');
    const objectPath = buildAttachmentPath(userId, conversationId, messageId, index, mime);
    const full = this.resolve(objectPath);
    if (!full) throw new Error('Unsafe storage path.');
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buffer);
    return objectPath;
  }

  async read(objectPath: string): Promise<Buffer | null> {
    const full = this.resolve(objectPath);
    return full && fs.existsSync(full) && fs.statSync(full).isFile() ? fs.readFileSync(full) : null;
  }

  async exists(objectPath: string): Promise<boolean> {
    const full = this.resolve(objectPath);
    return Boolean(full && fs.existsSync(full) && fs.statSync(full).isFile());
  }

  async removeConversation(userId: string, conversationId: string): Promise<void> {
    if (!isSafePathSegment(userId) || !isSafePathSegment(conversationId)) return;
    const full = this.resolve(path.posix.join(userId, conversationId));
    if (full && fs.existsSync(full)) fs.rmSync(full, { recursive: true, force: true });
  }

  async signedUrl(objectPath: string, downloadName?: string): Promise<string | null> {
    if (!(await this.exists(objectPath))) return null;
    return `${LOCAL_FILE_ROUTE}?token=${encodeURIComponent(createFileToken(objectPath, undefined, undefined, downloadName))}`;
  }
}

// --- Selection ---------------------------------------------------------------

let overrideStorage: ArchitectChatFileStorage | null = null;
let resolved: Promise<ArchitectChatFileStorage> | null = null;

async function resolveStorage(): Promise<ArchitectChatFileStorage> {
  if (overrideStorage) return overrideStorage;
  if (isSupabaseAdminConfigured()) {
    const { data, error } = await getSupabaseAdmin().storage.getBucket(ARCHITECT_CHAT_BUCKET);
    if (!error && data) {
      if (data.public) throw new Error(`Storage bucket "${ARCHITECT_CHAT_BUCKET}" is PUBLIC — refusing to store chat attachments in a public bucket.`);
      serverLogger.log(`Arquiteto Estagiário files: using private Supabase Storage bucket "${ARCHITECT_CHAT_BUCKET}"`);
      return new SupabaseArchitectChatFileStorage();
    }
    if (isProduction()) throw new Error(`Storage bucket "${ARCHITECT_CHAT_BUCKET}" is not available: apply the storage migration before starting production.`);
    if (!isLocalDevFallbackAllowed()) {
      throw new Error(`Storage bucket "${ARCHITECT_CHAT_BUCKET}" is not available: apply supabase/migrations/20260921120000_architect_chat.sql, or set ALLOW_LOCAL_DEV_FALLBACK=true.`);
    }
  } else if (isProduction() || !isLocalDevFallbackAllowed()) {
    throw new Error('Supabase is not configured: chat attachments cannot be stored.');
  }
  serverLogger.error(`${LOCAL_FALLBACK_BANNER} — chat attachments are stored on LOCAL DISK`);
  return new LocalArchitectChatFileStorage();
}

export function getArchitectChatFileStorage(): Promise<ArchitectChatFileStorage> {
  if (!resolved) {
    resolved = resolveStorage().catch((err) => {
      resolved = null;
      throw err;
    });
  }
  return resolved;
}

export function setArchitectChatFileStorageForTests(storage: ArchitectChatFileStorage | null): void {
  overrideStorage = storage;
  resolved = null;
}
