import fs from 'node:fs';
import path from 'node:path';
import { getSupabaseAdmin, isSupabaseAdminConfigured } from '../lib/supabaseAdmin';
import { serverLogger } from '../lib/logger';
import { LOCAL_FALLBACK_BANNER, isLocalDevFallbackAllowed, isProduction } from '../config/runtimeEnvironment';

/**
 * Persistence for Planta Humanizada generations. Supabase is the store
 * (table humanized_floorplan_generations, see the migration). The local JSON
 * backend exists ONLY for tests and the explicit dev fallback
 * (ALLOW_LOCAL_DEV_FALLBACK=true) and refuses to construct in production.
 * Every read/write is scoped by userId — callers never get another user's row.
 * Credits are NOT stored here as a ledger: the wallet's credit_ledger is the
 * source of truth; this row keeps the movement ids and a per-generation summary.
 */

export type GenerationStatus = 'processing' | 'completed' | 'failed';
export type GenerationMode = 'standard' | 'astra';
/** LEGACY: written by the old validation flow. Optional in the database and never read to decide delivery. */
export type ValidationStatus = 'approved' | 'approved_after_correction' | 'delivered_minor_deviations' | 'failed';

export interface StoredViolation {
  type: string;
  severity: string;
  location: string;
  description: string;
}

/** The Astra flow only writes 'analysis' and 'generation_1'; the validation_* / generation_2 names remain valid so old rows still load. */
export type PipelineStepName = 'analysis' | 'generation_1' | 'validation_1' | 'generation_2' | 'validation_2';

/** One accounting row per pipeline step. Internal: never returned to the browser. */
export interface PipelineStepRecord {
  step: PipelineStepName;
  model: string;
  status: 'completed' | 'failed';
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningEffort: string | null;
  requestId: string | null;
  costUsd: number | null;
  detail: Record<string, unknown> | null;
  errorCode: string | null;
}

export interface GenerationUsage {
  textInputTokens: number | null;
  imageInputTokens: number | null;
  imageOutputTokens: number | null;
  totalTokens: number | null;
}

export interface GenerationRecord {
  id: string;
  userId: string;
  idempotencyKey: string | null;
  status: GenerationStatus;
  originalFileName: string | null;
  referenceFileName: string | null;
  hasReference: boolean;
  sourceGenerationId: string | null;
  style: string;
  lighting: string;
  surroundings: string;
  surroundingsKind: string | null;
  customSurroundings: string | null;
  textMode: string;
  furnitureLevel: string;
  outputFormat: string;
  customInstructions: string | null;
  creditsReserved: number;
  creditsCaptured: number;
  creditsRefunded: number;
  reservationId: string | null;
  captureTransactionId: string | null;
  refundTransactionId: string | null;
  provider: string;
  model: string;
  quality: string | null;
  size: string | null;
  requestId: string | null;
  usage: GenerationUsage | null;
  costUsd: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  originalPath: string | null;
  referencePath: string | null;
  resultPath: string | null;
  resultJpgPath: string | null;
  createdAt: string;
  completedAt: string | null;
  deletedAt: string | null;
  /** 'standard' (Blue Render) or 'astra'. Rows written before the Astra mode existed read as 'standard'. */
  generationMode: GenerationMode;
  analysisModel: string | null;
  analysisStatus: 'completed' | 'failed' | null;
  validationStatus: ValidationStatus | null;
  fidelityScore: number | null;
  attemptsCount: number;
  autoCorrectionApplied: boolean;
  violationsSummary: StoredViolation[] | null;
  /** Last pipeline stage reached — persisted so progress survives a restart / another instance. */
  pipelineStage: string | null;
}

/** Thrown by insert() when (userId, idempotencyKey) already exists — the caller treats it as "same generation". */
export class DuplicateGenerationError extends Error {
  constructor() {
    super('duplicate idempotency key');
  }
}

export interface GenerationStore {
  readonly backend: 'supabase' | 'local';
  insert(record: GenerationRecord): Promise<void>;
  update(userId: string, id: string, patch: Partial<GenerationRecord>): Promise<void>;
  get(userId: string, id: string): Promise<GenerationRecord | null>;
  findByIdempotencyKey(userId: string, key: string): Promise<GenerationRecord | null>;
  list(userId: string, limit: number): Promise<GenerationRecord[]>;
  /** Soft delete: the row stays (its ledger movements stay too); file paths are cleared. */
  softDelete(userId: string, id: string): Promise<boolean>;
  /** Removes a row that never got a reservation (e.g. refused for lack of credits). Only ever touches status='processing' rows without a reservation. */
  discardUnreserved(userId: string, id: string): Promise<void>;
  /** All users: generations still 'processing' after `olderThanMs` — input to reconciliation. */
  listStaleProcessing(olderThanMs: number): Promise<GenerationRecord[]>;
  /** Pipeline accounting (Astra mode). Upserts by (generation, step). */
  saveStep(userId: string, generationId: string, step: PipelineStepRecord): Promise<void>;
  listSteps(userId: string, generationId: string): Promise<PipelineStepRecord[]>;
}

/** Defaults for fields that older rows / JSON records do not have. */
export function withModeDefaults<T extends Partial<GenerationRecord>>(r: T): T & Pick<GenerationRecord, 'generationMode' | 'attemptsCount' | 'autoCorrectionApplied'> {
  return {
    ...r,
    generationMode: r.generationMode === 'astra' ? 'astra' : 'standard',
    attemptsCount: typeof r.attemptsCount === 'number' ? r.attemptsCount : 1,
    autoCorrectionApplied: Boolean(r.autoCorrectionApplied),
  };
}

// --- Local JSON backend (tests / explicit dev fallback only) ----------------------

const LOCAL_FILE = path.join(__dirname, '..', '..', 'private-data', 'humanized-generations.json');

export class LocalGenerationStore implements GenerationStore {
  readonly backend = 'local' as const;
  private records: GenerationRecord[] | null = null;
  private steps: Array<PipelineStepRecord & { userId: string; generationId: string }> = [];

  constructor(private readonly filePath: string = LOCAL_FILE) {
    if (isProduction()) throw new Error('LocalGenerationStore cannot be used in production.');
  }

  private load(): GenerationRecord[] {
    if (this.records) return this.records;
    try {
      this.records = (JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as GenerationRecord[]).map((r) => withModeDefaults(r) as GenerationRecord);
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

  async insert(record: GenerationRecord): Promise<void> {
    if (record.idempotencyKey && this.load().some((r) => r.userId === record.userId && r.idempotencyKey === record.idempotencyKey)) throw new DuplicateGenerationError();
    this.load().push(record);
    this.persist();
  }

  async update(userId: string, id: string, patch: Partial<GenerationRecord>): Promise<void> {
    const rec = this.load().find((r) => r.id === id && r.userId === userId);
    if (!rec) return;
    Object.assign(rec, patch);
    this.persist();
  }

  async get(userId: string, id: string): Promise<GenerationRecord | null> {
    const r = this.load().find((x) => x.id === id && x.userId === userId && !x.deletedAt);
    return r ? { ...r } : null;
  }

  async findByIdempotencyKey(userId: string, key: string): Promise<GenerationRecord | null> {
    const r = this.load().find((x) => x.userId === userId && x.idempotencyKey === key);
    return r ? { ...r } : null;
  }

  async list(userId: string, limit: number): Promise<GenerationRecord[]> {
    return this.load()
      .filter((r) => r.userId === userId && !r.deletedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async softDelete(userId: string, id: string): Promise<boolean> {
    const rec = this.load().find((r) => r.id === id && r.userId === userId && !r.deletedAt);
    if (!rec) return false;
    rec.deletedAt = new Date().toISOString();
    rec.originalPath = null;
    rec.referencePath = null;
    rec.resultPath = null;
    rec.resultJpgPath = null;
    this.persist();
    return true;
  }

  async discardUnreserved(userId: string, id: string): Promise<void> {
    const list = this.load();
    const i = list.findIndex((r) => r.id === id && r.userId === userId && r.status === 'processing' && !r.reservationId);
    if (i >= 0) {
      list.splice(i, 1);
      this.persist();
    }
  }

  async saveStep(userId: string, generationId: string, step: PipelineStepRecord): Promise<void> {
    const i = this.steps.findIndex((x) => x.userId === userId && x.generationId === generationId && x.step === step.step);
    const row = { ...step, userId, generationId };
    if (i >= 0) this.steps[i] = row;
    else this.steps.push(row);
  }

  async listSteps(userId: string, generationId: string): Promise<PipelineStepRecord[]> {
    return this.steps.filter((x) => x.userId === userId && x.generationId === generationId).map(({ userId: _u, generationId: _g, ...rest }) => rest);
  }

  async listStaleProcessing(olderThanMs: number): Promise<GenerationRecord[]> {
    const cutoff = Date.now() - olderThanMs;
    return this.load()
      .filter((r) => r.status === 'processing' && !r.deletedAt && Date.parse(r.createdAt) <= cutoff)
      .map((r) => ({ ...r }));
  }
}

// --- Supabase backend --------------------------------------------------------

const TABLE = 'humanized_floorplan_generations';

type Row = Record<string, unknown>;

const FIELD_TO_COLUMN: Record<keyof GenerationRecord, string> = {
  id: 'id', userId: 'user_id', idempotencyKey: 'idempotency_key', status: 'status', originalFileName: 'original_file_name',
  referenceFileName: 'reference_file_name', hasReference: 'has_reference', sourceGenerationId: 'source_generation_id', style: 'style',
  lighting: 'lighting', surroundings: 'surroundings', surroundingsKind: 'surroundings_kind', customSurroundings: 'custom_surroundings',
  textMode: 'text_mode', furnitureLevel: 'furniture_level', outputFormat: 'output_format', customInstructions: 'custom_instructions',
  creditsReserved: 'credits_reserved', creditsCaptured: 'credits_captured', creditsRefunded: 'credits_refunded', reservationId: 'reservation_id',
  captureTransactionId: 'capture_transaction_id', refundTransactionId: 'refund_transaction_id', provider: 'provider', model: 'model',
  quality: 'quality', size: 'size', requestId: 'request_id', usage: 'usage', costUsd: 'cost_usd', errorCode: 'error_code',
  errorMessage: 'error_message', originalPath: 'original_path', referencePath: 'reference_path', resultPath: 'result_path',
  resultJpgPath: 'result_jpg_path', createdAt: 'created_at', completedAt: 'completed_at', deletedAt: 'deleted_at',
  generationMode: 'generation_mode', analysisModel: 'analysis_model', analysisStatus: 'analysis_status', validationStatus: 'validation_status',
  fidelityScore: 'fidelity_score', attemptsCount: 'attempts_count', autoCorrectionApplied: 'auto_correction_applied', violationsSummary: 'violations_summary',
  pipelineStage: 'pipeline_stage',
};

export function toRow(r: Partial<GenerationRecord>): Row {
  const row: Row = {};
  for (const [k, v] of Object.entries(r)) {
    const col = FIELD_TO_COLUMN[k as keyof GenerationRecord];
    if (col) row[col] = v;
  }
  return row;
}

export function fromRow(row: Row): GenerationRecord {
  const s = (k: string): string | null => (row[k] as string | null | undefined) ?? null;
  const n = (k: string): number => Number(row[k] ?? 0);
  return {
    id: row.id as string, userId: row.user_id as string, idempotencyKey: s('idempotency_key'), status: row.status as GenerationStatus,
    originalFileName: s('original_file_name'), referenceFileName: s('reference_file_name'), hasReference: Boolean(row.has_reference),
    sourceGenerationId: s('source_generation_id'), style: row.style as string, lighting: row.lighting as string, surroundings: row.surroundings as string,
    surroundingsKind: s('surroundings_kind'), customSurroundings: s('custom_surroundings'), textMode: row.text_mode as string,
    furnitureLevel: row.furniture_level as string, outputFormat: row.output_format as string, customInstructions: s('custom_instructions'),
    creditsReserved: n('credits_reserved'), creditsCaptured: n('credits_captured'), creditsRefunded: n('credits_refunded'), reservationId: s('reservation_id'),
    captureTransactionId: s('capture_transaction_id'), refundTransactionId: s('refund_transaction_id'), provider: row.provider as string, model: row.model as string,
    quality: s('quality'), size: s('size'), requestId: s('request_id'), usage: (row.usage as GenerationUsage | null) ?? null,
    costUsd: row.cost_usd === null || row.cost_usd === undefined ? null : Number(row.cost_usd), errorCode: s('error_code'), errorMessage: s('error_message'),
    originalPath: s('original_path'), referencePath: s('reference_path'), resultPath: s('result_path'), resultJpgPath: s('result_jpg_path'),
    createdAt: row.created_at as string, completedAt: s('completed_at'), deletedAt: s('deleted_at'),
    generationMode: row.generation_mode === 'astra' ? 'astra' : 'standard', analysisModel: s('analysis_model'),
    analysisStatus: (s('analysis_status') as GenerationRecord['analysisStatus']) ?? null, validationStatus: (s('validation_status') as ValidationStatus | null) ?? null,
    fidelityScore: row.fidelity_score === null || row.fidelity_score === undefined ? null : Number(row.fidelity_score),
    attemptsCount: row.attempts_count === null || row.attempts_count === undefined ? 1 : Number(row.attempts_count),
    autoCorrectionApplied: Boolean(row.auto_correction_applied), violationsSummary: (row.violations_summary as StoredViolation[] | null) ?? null,
    pipelineStage: s('pipeline_stage'),
  };
}

export class SupabaseGenerationStore implements GenerationStore {
  readonly backend = 'supabase' as const;

  async insert(record: GenerationRecord): Promise<void> {
    const { error } = await getSupabaseAdmin().from(TABLE).insert(toRow(record));
    if (error) {
      if (error.code === '23505') throw new DuplicateGenerationError();
      throw new Error(`insert failed: ${error.message}`);
    }
  }

  async update(userId: string, id: string, patch: Partial<GenerationRecord>): Promise<void> {
    const { error } = await getSupabaseAdmin().from(TABLE).update(toRow(patch)).eq('id', id).eq('user_id', userId);
    if (error) throw new Error(`update failed: ${error.message}`);
  }

  async get(userId: string, id: string): Promise<GenerationRecord | null> {
    const { data, error } = await getSupabaseAdmin().from(TABLE).select('*').eq('id', id).eq('user_id', userId).is('deleted_at', null).maybeSingle();
    if (error) throw new Error(`get failed: ${error.message}`);
    return data ? fromRow(data) : null;
  }

  async findByIdempotencyKey(userId: string, key: string): Promise<GenerationRecord | null> {
    const { data, error } = await getSupabaseAdmin().from(TABLE).select('*').eq('user_id', userId).eq('idempotency_key', key).maybeSingle();
    if (error) throw new Error(`lookup failed: ${error.message}`);
    return data ? fromRow(data) : null;
  }

  async list(userId: string, limit: number): Promise<GenerationRecord[]> {
    const { data, error } = await getSupabaseAdmin().from(TABLE).select('*').eq('user_id', userId).is('deleted_at', null).order('created_at', { ascending: false }).limit(limit);
    if (error) throw new Error(`list failed: ${error.message}`);
    return (data ?? []).map(fromRow);
  }

  async softDelete(userId: string, id: string): Promise<boolean> {
    const { data, error } = await getSupabaseAdmin()
      .from(TABLE)
      .update({ deleted_at: new Date().toISOString(), original_path: null, reference_path: null, result_path: null, result_jpg_path: null })
      .eq('id', id)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .select('id');
    if (error) throw new Error(`delete failed: ${error.message}`);
    return (data ?? []).length > 0;
  }

  async discardUnreserved(userId: string, id: string): Promise<void> {
    const { error } = await getSupabaseAdmin().from(TABLE).delete().eq('id', id).eq('user_id', userId).eq('status', 'processing').is('reservation_id', null);
    if (error) throw new Error(`discard failed: ${error.message}`);
  }

  async saveStep(userId: string, generationId: string, step: PipelineStepRecord): Promise<void> {
    const { error } = await getSupabaseAdmin().from('humanized_floorplan_pipeline_steps').upsert(
      {
        generation_id: generationId, user_id: userId, step: step.step, model: step.model, status: step.status, started_at: step.startedAt, completed_at: step.completedAt,
        duration_ms: step.durationMs, input_tokens: step.inputTokens, cached_input_tokens: step.cachedInputTokens, output_tokens: step.outputTokens,
        total_tokens: step.totalTokens, reasoning_effort: step.reasoningEffort, request_id: step.requestId, cost_usd: step.costUsd, detail: step.detail, error_code: step.errorCode,
      },
      { onConflict: 'generation_id,step' }
    );
    if (error) throw new Error('step save failed: ' + error.message);
  }

  async listSteps(userId: string, generationId: string): Promise<PipelineStepRecord[]> {
    const { data, error } = await getSupabaseAdmin().from('humanized_floorplan_pipeline_steps').select('*').eq('user_id', userId).eq('generation_id', generationId).order('started_at', { ascending: true });
    if (error) throw new Error('step list failed: ' + error.message);
    return (data ?? []).map((r) => ({
      step: r.step as PipelineStepName, model: r.model as string, status: r.status as 'completed' | 'failed', startedAt: r.started_at as string, completedAt: (r.completed_at as string | null) ?? null,
      durationMs: (r.duration_ms as number | null) ?? null, inputTokens: (r.input_tokens as number | null) ?? null, cachedInputTokens: (r.cached_input_tokens as number | null) ?? null,
      outputTokens: (r.output_tokens as number | null) ?? null, totalTokens: (r.total_tokens as number | null) ?? null, reasoningEffort: (r.reasoning_effort as string | null) ?? null,
      requestId: (r.request_id as string | null) ?? null, costUsd: r.cost_usd === null || r.cost_usd === undefined ? null : Number(r.cost_usd), detail: (r.detail as Record<string, unknown> | null) ?? null,
      errorCode: (r.error_code as string | null) ?? null,
    }));
  }

  async listStaleProcessing(olderThanMs: number): Promise<GenerationRecord[]> {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const { data, error } = await getSupabaseAdmin().from(TABLE).select('*').eq('status', 'processing').is('deleted_at', null).lte('created_at', cutoff).limit(200);
    if (error) throw new Error(`stale list failed: ${error.message}`);
    return (data ?? []).map(fromRow);
  }
}

// --- Selection ---------------------------------------------------------------

let overrideStore: GenerationStore | null = null;
let resolved: Promise<GenerationStore> | null = null;

async function resolveStore(): Promise<GenerationStore> {
  if (overrideStore) return overrideStore;
  if (isSupabaseAdminConfigured()) {
    const { error } = await getSupabaseAdmin().from(TABLE).select('id').limit(1);
    if (!error) {
      serverLogger.log('Humanized floor plan generations: using Supabase store');
      return new SupabaseGenerationStore();
    }
    if (isProduction()) throw new Error(`Generations table is not available in Supabase (${error.code ?? 'error'}): apply the migrations before starting production.`);
    if (!isLocalDevFallbackAllowed()) {
      throw new Error(`Generations table is not available in Supabase (${error.code ?? 'error'}): apply supabase/migrations/20260919120000_humanized_floorplan_generations.sql, or set ALLOW_LOCAL_DEV_FALLBACK=true.`);
    }
  } else if (isProduction() || !isLocalDevFallbackAllowed()) {
    throw new Error('Supabase is not configured: the generation history cannot start.');
  }
  serverLogger.error(`${LOCAL_FALLBACK_BANNER} — generation history is a LOCAL JSON file`);
  return new LocalGenerationStore();
}

export function getGenerationStore(): Promise<GenerationStore> {
  if (!resolved) {
    resolved = resolveStore().catch((err) => {
      resolved = null;
      throw err;
    });
  }
  return resolved;
}

/** Test hook: forces a specific store (null restores normal selection). */
export function setGenerationStoreForTests(store: GenerationStore | null): void {
  overrideStore = store;
  resolved = null;
}
