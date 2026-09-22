import fs from 'node:fs';
import path from 'node:path';
import { getSupabaseAdmin, isSupabaseAdminConfigured } from '../lib/supabaseAdmin';
import { serverLogger } from '../lib/logger';
import { LOCAL_FALLBACK_BANNER, isLocalDevFallbackAllowed, isProduction } from '../config/runtimeEnvironment';
import { UpscaleScale } from '../config/topaz';

/**
 * Persistence for Upscale IA jobs. Same shape as
 * services/humanizedFloorplanStore.ts (see that file's own comments for the
 * full rationale) — table `upscale_jobs`, RLS select-only-own-rows, every
 * read/write scoped by userId. Credits are NOT a ledger here either: the
 * wallet's credit_ledger is the source of truth; this row keeps the
 * movement ids and a per-job summary.
 */

export type UpscaleStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'timed_out';

export interface UpscaleJobRecord {
  id: string;
  userId: string;
  idempotencyKey: string | null;
  status: UpscaleStatus;
  provider: string;
  providerProcessId: string | null;
  model: string;
  scale: UpscaleScale;
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
  originalPath: string | null;
  resultPath: string | null;
  creditsReserved: number;
  creditsCaptured: number;
  creditsRefunded: number;
  reservationId: string | null;
  captureTransactionId: string | null;
  refundTransactionId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface UpscaleStore {
  readonly backend: 'supabase' | 'local';
  insert(record: UpscaleJobRecord): Promise<void>;
  update(userId: string, id: string, patch: Partial<UpscaleJobRecord>): Promise<void>;
  get(userId: string, id: string): Promise<UpscaleJobRecord | null>;
  findByIdempotencyKey(userId: string, key: string): Promise<UpscaleJobRecord | null>;
  list(userId: string, limit: number): Promise<UpscaleJobRecord[]>;
}

// --- Local JSON backend (tests / explicit dev fallback only) ----------------------

const LOCAL_FILE = path.join(__dirname, '..', '..', 'private-data', 'upscale-jobs.json');

export class LocalUpscaleStore implements UpscaleStore {
  readonly backend = 'local' as const;
  private records: UpscaleJobRecord[] | null = null;

  constructor(private readonly filePath: string = LOCAL_FILE) {
    if (isProduction()) throw new Error('LocalUpscaleStore cannot be used in production.');
  }

  private load(): UpscaleJobRecord[] {
    if (this.records) return this.records;
    try {
      this.records = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as UpscaleJobRecord[];
    } catch {
      this.records = [];
    }
    return this.records;
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.records ?? []));
    fs.renameSync(tmp, this.filePath);
  }

  async insert(record: UpscaleJobRecord): Promise<void> {
    this.load().push(record);
    this.persist();
  }

  async update(userId: string, id: string, patch: Partial<UpscaleJobRecord>): Promise<void> {
    const rec = this.load().find((r) => r.id === id && r.userId === userId);
    if (!rec) return;
    Object.assign(rec, patch);
    this.persist();
  }

  async get(userId: string, id: string): Promise<UpscaleJobRecord | null> {
    const r = this.load().find((x) => x.id === id && x.userId === userId);
    return r ? { ...r } : null;
  }

  async findByIdempotencyKey(userId: string, key: string): Promise<UpscaleJobRecord | null> {
    const r = this.load().find((x) => x.userId === userId && x.idempotencyKey === key);
    return r ? { ...r } : null;
  }

  async list(userId: string, limit: number): Promise<UpscaleJobRecord[]> {
    return this.load()
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }
}

// --- Supabase backend --------------------------------------------------------

const TABLE = 'upscale_jobs';

type Row = Record<string, unknown>;

const FIELD_TO_COLUMN: Record<keyof UpscaleJobRecord, string> = {
  id: 'id',
  userId: 'user_id',
  idempotencyKey: 'idempotency_key',
  status: 'status',
  provider: 'provider',
  providerProcessId: 'provider_process_id',
  model: 'model',
  scale: 'scale',
  originalWidth: 'original_width',
  originalHeight: 'original_height',
  outputWidth: 'output_width',
  outputHeight: 'output_height',
  originalPath: 'original_path',
  resultPath: 'result_path',
  creditsReserved: 'credits_reserved',
  creditsCaptured: 'credits_captured',
  creditsRefunded: 'credits_refunded',
  reservationId: 'reservation_id',
  captureTransactionId: 'capture_transaction_id',
  refundTransactionId: 'refund_transaction_id',
  errorCode: 'error_code',
  errorMessage: 'error_message',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  completedAt: 'completed_at',
};

function toRow(r: Partial<UpscaleJobRecord>): Row {
  const row: Row = {};
  for (const [k, v] of Object.entries(r)) {
    const col = FIELD_TO_COLUMN[k as keyof UpscaleJobRecord];
    if (col) row[col] = v;
  }
  return row;
}

function fromRow(row: Row): UpscaleJobRecord {
  const s = (k: string): string | null => (row[k] as string | null | undefined) ?? null;
  const n = (k: string): number => Number(row[k] ?? 0);
  return {
    id: row.id as string,
    userId: row.user_id as string,
    idempotencyKey: s('idempotency_key'),
    status: row.status as UpscaleStatus,
    provider: row.provider as string,
    providerProcessId: s('provider_process_id'),
    model: row.model as string,
    scale: n('scale') as UpscaleScale,
    originalWidth: n('original_width'),
    originalHeight: n('original_height'),
    outputWidth: n('output_width'),
    outputHeight: n('output_height'),
    originalPath: s('original_path'),
    resultPath: s('result_path'),
    creditsReserved: n('credits_reserved'),
    creditsCaptured: n('credits_captured'),
    creditsRefunded: n('credits_refunded'),
    reservationId: s('reservation_id'),
    captureTransactionId: s('capture_transaction_id'),
    refundTransactionId: s('refund_transaction_id'),
    errorCode: s('error_code'),
    errorMessage: s('error_message'),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    completedAt: s('completed_at'),
  };
}

export class SupabaseUpscaleStore implements UpscaleStore {
  readonly backend = 'supabase' as const;

  async insert(record: UpscaleJobRecord): Promise<void> {
    const { error } = await getSupabaseAdmin().from(TABLE).insert(toRow(record));
    if (error) throw new Error(`insert failed: ${error.message}`);
  }

  async update(userId: string, id: string, patch: Partial<UpscaleJobRecord>): Promise<void> {
    const { error } = await getSupabaseAdmin().from(TABLE).update(toRow(patch)).eq('id', id).eq('user_id', userId);
    if (error) throw new Error(`update failed: ${error.message}`);
  }

  async get(userId: string, id: string): Promise<UpscaleJobRecord | null> {
    const { data, error } = await getSupabaseAdmin().from(TABLE).select('*').eq('id', id).eq('user_id', userId).is('deleted_at', null).maybeSingle();
    if (error) throw new Error(`get failed: ${error.message}`);
    return data ? fromRow(data) : null;
  }

  async findByIdempotencyKey(userId: string, key: string): Promise<UpscaleJobRecord | null> {
    const { data, error } = await getSupabaseAdmin().from(TABLE).select('*').eq('user_id', userId).eq('idempotency_key', key).maybeSingle();
    if (error) throw new Error(`lookup failed: ${error.message}`);
    return data ? fromRow(data) : null;
  }

  async list(userId: string, limit: number): Promise<UpscaleJobRecord[]> {
    const { data, error } = await getSupabaseAdmin().from(TABLE).select('*').eq('user_id', userId).is('deleted_at', null).order('created_at', { ascending: false }).limit(limit);
    if (error) throw new Error(`list failed: ${error.message}`);
    return (data ?? []).map(fromRow);
  }
}

// --- Selection ---------------------------------------------------------------

let overrideStore: UpscaleStore | null = null;
let resolved: Promise<UpscaleStore> | null = null;

async function resolveStore(): Promise<UpscaleStore> {
  if (overrideStore) return overrideStore;
  if (isSupabaseAdminConfigured()) {
    const { error } = await getSupabaseAdmin().from(TABLE).select('id').limit(1);
    if (!error) {
      serverLogger.log('Upscale jobs: using Supabase store');
      return new SupabaseUpscaleStore();
    }
    if (isProduction()) throw new Error(`upscale_jobs table is not available in Supabase (${error.code ?? 'error'}): apply the migrations before starting production.`);
    if (!isLocalDevFallbackAllowed()) {
      throw new Error(`upscale_jobs table is not available in Supabase (${error.code ?? 'error'}): apply supabase/migrations/20260922100000_upscale_jobs.sql, or set ALLOW_LOCAL_DEV_FALLBACK=true.`);
    }
  } else if (isProduction() || !isLocalDevFallbackAllowed()) {
    throw new Error('Supabase is not configured: upscale history cannot start.');
  }
  serverLogger.error(`${LOCAL_FALLBACK_BANNER} — upscale job history is a LOCAL JSON file`);
  return new LocalUpscaleStore();
}

export function getUpscaleStore(): Promise<UpscaleStore> {
  if (!resolved) {
    resolved = resolveStore().catch((err) => {
      resolved = null;
      throw err;
    });
  }
  return resolved;
}

export function setUpscaleStoreForTests(store: UpscaleStore | null): void {
  overrideStore = store;
  resolved = null;
}
