import crypto from 'node:crypto';
import { AppError } from '../lib/errors';
import { serverLogger } from '../lib/logger';
import { getSupabaseAdmin, isSupabaseAdminConfigured } from '../lib/supabaseAdmin';
import { LOCAL_FALLBACK_BANNER, isLocalDevFallbackAllowed, isProduction, walletSignupBonusCredits } from '../config/runtimeEnvironment';

/**
 * The ONE credit wallet, per user, shared by every tool. The source of truth
 * is Supabase (tables credit_wallets / credit_ledger, moved only through the
 * atomic SQL functions in supabase/migrations/20260920100000_credit_wallet.sql).
 *
 * Lifecycle of a paid generation:
 *   reserveCredits()  -> credits leave the spendable balance atomically
 *   captureCredits()  -> only after the result exists and is saved
 *   refundCredits()   -> on ANY failure; credits return exactly once
 *
 * A MemoryWalletBackend with the same semantics exists for tests and for the
 * explicit dev fallback (ALLOW_LOCAL_DEV_FALLBACK=true) — it can never be
 * selected in production.
 */

export interface Reservation {
  id: string;
  userId: string;
  amount: number;
  tool: string;
  generationId: string | null;
}

export interface PendingReservation {
  reservationId: string;
  userId: string;
  generationId: string | null;
  amount: number;
  tool: string;
  createdAt: string;
}

export interface LedgerMovement {
  id: string;
  type: 'credit' | 'reserve' | 'capture' | 'refund' | 'adjustment';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  reason: string | null;
  createdAt: string;
  reservationId: string | null;
}

export interface WalletBackend {
  readonly kind: 'supabase' | 'memory';
  ensure(userId: string, bonus: number): Promise<number>;
  balance(userId: string): Promise<number>;
  reserve(p: { userId: string; amount: number; tool: string; generationId: string | null; idempotencyKey: string | null }): Promise<{ reservationId: string; amount: number; balanceAfter: number; reused: boolean }>;
  capture(userId: string, reservationId: string, amount?: number): Promise<{ captured: number; captureId: string; refunded: number; refundId: string | null; balanceAfter: number; reused: boolean }>;
  refund(userId: string, reservationId: string, reason: string): Promise<{ refunded: number; refundId: string; balanceAfter: number; reused: boolean }>;
  credit(userId: string, amount: number, reason: string, tool: string, idempotencyKey: string | null): Promise<number>;
  pending(olderThanSeconds: number, userId?: string): Promise<PendingReservation[]>;
  ledgerForGeneration(userId: string, generationId: string): Promise<LedgerMovement[]>;
}

/** Error thrown by a backend for a business-rule refusal (not an outage). */
export class WalletRuleError extends Error {
  constructor(public readonly rule: 'insufficient_credits' | 'reservation_not_found' | 'reservation_already_captured' | 'reservation_already_refunded' | 'invalid_amount' | 'wallet_not_found', detail?: string) {
    super(detail ? `${rule}: ${detail}` : rule);
  }
}

const RULES = ['insufficient_credits', 'reservation_not_found', 'reservation_already_captured', 'reservation_already_refunded', 'invalid_amount', 'wallet_not_found'] as const;

function toRuleError(message: string): WalletRuleError | null {
  const rule = RULES.find((r) => message.includes(r));
  return rule ? new WalletRuleError(rule) : null;
}

// --- Supabase backend ----------------------------------------------------------

export class SupabaseWalletBackend implements WalletBackend {
  readonly kind = 'supabase' as const;

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await getSupabaseAdmin().rpc(fn, args);
    if (error) {
      const rule = toRuleError(error.message ?? '');
      if (rule) throw rule;
      throw new Error(`wallet rpc ${fn} failed: ${error.code ?? ''} ${error.message ?? ''}`.trim());
    }
    return data as T;
  }

  ensure(userId: string, bonus: number): Promise<number> {
    return this.rpc<number>('wallet_ensure', { p_user: userId, p_bonus: bonus });
  }

  async balance(userId: string): Promise<number> {
    const r = await this.rpc<{ balance: number | null }>('wallet_get', { p_user: userId });
    if (r.balance === null) throw new WalletRuleError('wallet_not_found');
    return r.balance;
  }

  async reserve(p: { userId: string; amount: number; tool: string; generationId: string | null; idempotencyKey: string | null }) {
    const r = await this.rpc<{ reservation_id: string; amount: number; balance_after: number; reused: boolean }>('wallet_reserve', {
      p_user: p.userId,
      p_amount: p.amount,
      p_tool: p.tool,
      p_generation: p.generationId,
      p_idempotency_key: p.idempotencyKey,
      p_metadata: {},
    });
    return { reservationId: r.reservation_id, amount: r.amount, balanceAfter: r.balance_after, reused: r.reused };
  }

  async capture(userId: string, reservationId: string, amount?: number) {
    const r = await this.rpc<{ captured: number; capture_id: string; refunded?: number; refund_id?: string | null; balance_after: number; reused: boolean }>('wallet_capture', {
      p_user: userId,
      p_reservation: reservationId,
      p_amount: amount ?? null,
    });
    return { captured: r.captured, captureId: r.capture_id, refunded: r.refunded ?? 0, refundId: r.refund_id ?? null, balanceAfter: r.balance_after, reused: r.reused };
  }

  async refund(userId: string, reservationId: string, reason: string) {
    const r = await this.rpc<{ refunded: number; refund_id: string; balance_after: number; reused: boolean }>('wallet_refund', { p_user: userId, p_reservation: reservationId, p_reason: reason });
    return { refunded: r.refunded, refundId: r.refund_id, balanceAfter: r.balance_after, reused: r.reused };
  }

  async credit(userId: string, amount: number, reason: string, tool: string, idempotencyKey: string | null): Promise<number> {
    const r = await this.rpc<{ balance_after: number }>('wallet_credit', { p_user: userId, p_amount: amount, p_reason: reason, p_tool: tool, p_idempotency_key: idempotencyKey, p_metadata: {} });
    return r.balance_after;
  }

  async pending(olderThanSeconds: number, userId?: string): Promise<PendingReservation[]> {
    const rows = await this.rpc<Array<{ reservation_id: string; user_id: string; generation_id: string | null; amount: number; tool: string; created_at: string }>>('wallet_pending_reservations', {
      p_older_than_seconds: olderThanSeconds,
      p_user: userId ?? null,
    });
    return rows.map((r) => ({ reservationId: r.reservation_id, userId: r.user_id, generationId: r.generation_id, amount: r.amount, tool: r.tool, createdAt: r.created_at }));
  }

  async ledgerForGeneration(userId: string, generationId: string): Promise<LedgerMovement[]> {
    const { data, error } = await getSupabaseAdmin()
      .from('credit_ledger')
      .select('id, transaction_type, amount, balance_before, balance_after, reason, created_at, reservation_id')
      .eq('user_id', userId)
      .eq('generation_id', generationId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`ledger read failed: ${error.message}`);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      type: r.transaction_type as LedgerMovement['type'],
      amount: r.amount as number,
      balanceBefore: r.balance_before as number,
      balanceAfter: r.balance_after as number,
      reason: (r.reason as string | null) ?? null,
      createdAt: r.created_at as string,
      reservationId: (r.reservation_id as string | null) ?? null,
    }));
  }
}

// --- Memory backend (tests / explicit dev fallback ONLY) ------------------------

interface MemLedgerRow extends LedgerMovement {
  userId: string;
  generationId: string | null;
  idempotencyKey: string | null;
  tool: string;
}

export class MemoryWalletBackend implements WalletBackend {
  readonly kind = 'memory' as const;
  private readonly wallets = new Map<string, { balance: number; reserved: number }>();
  private readonly ledger: MemLedgerRow[] = [];

  constructor() {
    if (isProduction()) throw new Error('MemoryWalletBackend cannot be used in production.');
  }

  private wallet(userId: string) {
    const w = this.wallets.get(userId);
    if (!w) throw new WalletRuleError('wallet_not_found');
    return w;
  }

  private add(row: Omit<MemLedgerRow, 'id' | 'createdAt'>): MemLedgerRow {
    const full = { ...row, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    this.ledger.push(full);
    return full;
  }

  async ensure(userId: string, bonus: number): Promise<number> {
    let w = this.wallets.get(userId);
    if (!w) {
      w = { balance: 0, reserved: 0 };
      this.wallets.set(userId, w);
      if (bonus > 0) {
        w.balance = bonus;
        this.add({ userId, generationId: null, idempotencyKey: `signup_bonus:${userId}`, type: 'credit', amount: bonus, balanceBefore: 0, balanceAfter: bonus, reason: 'signup_bonus', tool: 'system', reservationId: null });
      }
    }
    return w.balance;
  }

  async balance(userId: string): Promise<number> {
    return this.wallet(userId).balance;
  }

  async reserve(p: { userId: string; amount: number; tool: string; generationId: string | null; idempotencyKey: string | null }) {
    if (!Number.isInteger(p.amount) || p.amount <= 0) throw new WalletRuleError('invalid_amount');
    const w = this.wallet(p.userId);
    if (p.idempotencyKey) {
      const existing = this.ledger.find((r) => r.userId === p.userId && r.idempotencyKey === p.idempotencyKey && r.type === 'reserve');
      if (existing) return { reservationId: existing.id, amount: existing.amount, balanceAfter: w.balance, reused: true };
    }
    if (w.balance < p.amount) throw new WalletRuleError('insufficient_credits');
    const before = w.balance;
    w.balance -= p.amount;
    w.reserved += p.amount;
    const row = this.add({ userId: p.userId, generationId: p.generationId, idempotencyKey: p.idempotencyKey, type: 'reserve', amount: p.amount, balanceBefore: before, balanceAfter: w.balance, reason: 'generation', tool: p.tool, reservationId: null });
    return { reservationId: row.id, amount: p.amount, balanceAfter: w.balance, reused: false };
  }

  private reservationRow(userId: string, id: string): MemLedgerRow {
    const r = this.ledger.find((x) => x.id === id && x.userId === userId && x.type === 'reserve');
    if (!r) throw new WalletRuleError('reservation_not_found');
    return r;
  }

  async capture(userId: string, reservationId: string, amount?: number) {
    const w = this.wallet(userId);
    const r = this.reservationRow(userId, reservationId);
    const cap = this.ledger.find((x) => x.reservationId === reservationId && x.type === 'capture');
    if (cap) return { captured: cap.amount, captureId: cap.id, refunded: 0, refundId: null, balanceAfter: w.balance, reused: true };
    if (this.ledger.some((x) => x.reservationId === reservationId && x.type === 'refund')) throw new WalletRuleError('reservation_already_refunded');
    const capture = amount ?? r.amount;
    if (!Number.isInteger(capture) || capture < 1 || capture > r.amount) throw new WalletRuleError('invalid_amount');
    const remainder = r.amount - capture;
    const before = w.balance;
    w.reserved -= r.amount;
    w.balance += remainder;
    const capRow = this.add({ userId, generationId: r.generationId, idempotencyKey: null, type: 'capture', amount: capture, balanceBefore: before, balanceAfter: before, reason: 'generation_completed', tool: r.tool, reservationId });
    let refundId: string | null = null;
    if (remainder > 0) refundId = this.add({ userId, generationId: r.generationId, idempotencyKey: null, type: 'refund', amount: remainder, balanceBefore: before, balanceAfter: w.balance, reason: 'partial_capture_remainder', tool: r.tool, reservationId }).id;
    return { captured: capture, captureId: capRow.id, refunded: remainder, refundId, balanceAfter: w.balance, reused: false };
  }

  async refund(userId: string, reservationId: string, reason: string) {
    const w = this.wallet(userId);
    const r = this.reservationRow(userId, reservationId);
    if (this.ledger.some((x) => x.reservationId === reservationId && x.type === 'capture')) throw new WalletRuleError('reservation_already_captured');
    const rf = this.ledger.find((x) => x.reservationId === reservationId && x.type === 'refund');
    if (rf) return { refunded: rf.amount, refundId: rf.id, balanceAfter: w.balance, reused: true };
    const before = w.balance;
    w.reserved -= r.amount;
    w.balance += r.amount;
    const row = this.add({ userId, generationId: r.generationId, idempotencyKey: null, type: 'refund', amount: r.amount, balanceBefore: before, balanceAfter: w.balance, reason: reason || 'generation_failed', tool: r.tool, reservationId });
    return { refunded: r.amount, refundId: row.id, balanceAfter: w.balance, reused: false };
  }

  async credit(userId: string, amount: number, reason: string, tool: string, idempotencyKey: string | null): Promise<number> {
    if (!Number.isInteger(amount) || amount <= 0) throw new WalletRuleError('invalid_amount');
    const w = this.wallet(userId);
    if (idempotencyKey && this.ledger.some((r) => r.userId === userId && r.idempotencyKey === idempotencyKey)) return w.balance;
    const before = w.balance;
    w.balance += amount;
    this.add({ userId, generationId: null, idempotencyKey, type: 'credit', amount, balanceBefore: before, balanceAfter: w.balance, reason, tool, reservationId: null });
    return w.balance;
  }

  async pending(olderThanSeconds: number, userId?: string): Promise<PendingReservation[]> {
    const cutoff = Date.now() - Math.max(olderThanSeconds, 0) * 1000;
    return this.ledger
      .filter((r) => r.type === 'reserve' && (!userId || r.userId === userId) && Date.parse(r.createdAt) <= cutoff && !this.ledger.some((s) => s.reservationId === r.id))
      .map((r) => ({ reservationId: r.id, userId: r.userId, generationId: r.generationId, amount: r.amount, tool: r.tool, createdAt: r.createdAt }));
  }

  async ledgerForGeneration(userId: string, generationId: string): Promise<LedgerMovement[]> {
    return this.ledger.filter((r) => r.userId === userId && r.generationId === generationId).map(({ id, type, amount, balanceBefore, balanceAfter, reason, createdAt, reservationId }) => ({ id, type, amount, balanceBefore, balanceAfter, reason, createdAt, reservationId }));
  }

  /** Test helper: age a reservation so reconciliation treats it as stale. */
  backdateForTests(reservationId: string, ms: number): void {
    const r = this.ledger.find((x) => x.id === reservationId);
    if (r) r.createdAt = new Date(Date.parse(r.createdAt) - ms).toISOString();
  }
}

// --- Backend selection ---------------------------------------------------------

let overrideBackend: WalletBackend | null = null;
let resolved: Promise<WalletBackend> | null = null;

/** Tests inject a backend explicitly (never reachable in production: MemoryWalletBackend refuses to construct there). */
export function setWalletBackendForTests(backend: WalletBackend | null): void {
  overrideBackend = backend;
  resolved = null;
}

async function resolveBackend(): Promise<WalletBackend> {
  if (overrideBackend) return overrideBackend;

  if (isSupabaseAdminConfigured()) {
    const { error } = await getSupabaseAdmin().rpc('wallet_get', { p_user: '00000000-0000-0000-0000-000000000000' });
    if (!error) {
      serverLogger.log('Credit wallet: using Supabase (persistent, per user)');
      return new SupabaseWalletBackend();
    }
    if (isProduction()) throw new Error(`Credit wallet is not available in Supabase (${error.code ?? 'error'}): apply the wallet migration before starting production.`);
    if (!isLocalDevFallbackAllowed()) {
      throw new Error(`Credit wallet is not available in Supabase (${error.code ?? 'error'}): apply supabase/migrations/20260920100000_credit_wallet.sql, or set ALLOW_LOCAL_DEV_FALLBACK=true for a local, non-persistent wallet.`);
    }
  } else if (isProduction() || !isLocalDevFallbackAllowed()) {
    throw new Error('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY): the credit wallet cannot start.');
  }

  serverLogger.error(`${LOCAL_FALLBACK_BANNER} — credit wallet is IN MEMORY and resets on restart`);
  return new MemoryWalletBackend();
}

export function getWalletBackend(): Promise<WalletBackend> {
  if (!resolved) {
    resolved = resolveBackend().catch((err) => {
      resolved = null; // a failure is never cached: fixing the setup (or re-running the migration) recovers without a restart
      throw err;
    });
  }
  return resolved;
}

function walletUnavailable(err: unknown): AppError {
  serverLogger.error('Credit wallet unavailable', err instanceof Error ? err.message : String(err));
  return new AppError('PROVIDER_UNAVAILABLE', 'The credits service is temporarily unavailable. No credits were used.', undefined, 503);
}

// --- Service API used by every tool -------------------------------------------

/** Reservations currently owned by a running job in THIS process — reconciliation never touches them. */
const activeReservations = new Set<string>();
export function isReservationActive(reservationId: string): boolean {
  return activeReservations.has(reservationId);
}

/** The user's spendable balance. Creates the wallet (and grants the one-time signup bonus, if configured) on first use. */
export async function getWalletBalance(userId: string): Promise<number> {
  try {
    const backend = await getWalletBackend();
    await backend.ensure(userId, walletSignupBonusCredits());
    return await backend.balance(userId);
  } catch (err) {
    throw walletUnavailable(err);
  }
}

export interface ReserveParams {
  userId: string;
  amount: number;
  tool: string;
  generationId: string;
  /** Same key => same reservation, never a second charge. */
  idempotencyKey?: string | null;
}

export interface ActiveReservation extends Reservation {
  reused: boolean;
  balanceAfter: number;
}

/** Atomically takes `amount` credits out of the spendable balance. Throws INSUFFICIENT_CREDITS (402) when the user cannot afford it. */
export async function reserveCredits(p: ReserveParams): Promise<ActiveReservation> {
  let backend: WalletBackend;
  try {
    backend = await getWalletBackend();
    await backend.ensure(p.userId, walletSignupBonusCredits());
  } catch (err) {
    throw walletUnavailable(err);
  }
  try {
    const r = await backend.reserve({ userId: p.userId, amount: p.amount, tool: p.tool, generationId: p.generationId, idempotencyKey: p.idempotencyKey ?? null });
    activeReservations.add(r.reservationId);
    return { id: r.reservationId, userId: p.userId, amount: r.amount, tool: p.tool, generationId: p.generationId, reused: r.reused, balanceAfter: r.balanceAfter };
  } catch (err) {
    if (err instanceof WalletRuleError && err.rule === 'insufficient_credits') {
      const balance = await backend.balance(p.userId).catch(() => null);
      throw new AppError('INSUFFICIENT_CREDITS', `You need ${p.amount} credits for this generation.${balance === null ? '' : ` Your balance is ${balance} credits.`}`, undefined, 402);
    }
    throw walletUnavailable(err);
  }
}

/** Consumes the reservation (optionally only part of it; the rest returns to the balance). Safe to call twice. */
export async function captureCredits(reservation: Reservation, amount?: number): Promise<{ captured: number; captureId: string; refunded: number; refundId: string | null }> {
  try {
    const backend = await getWalletBackend();
    const r = await backend.capture(reservation.userId, reservation.id, amount);
    activeReservations.delete(reservation.id);
    return { captured: r.captured, captureId: r.captureId, refunded: r.refunded, refundId: r.refundId };
  } catch (err) {
    // The job is over either way: hand the reservation to reconciliation instead of leaving it 'owned' forever.
    activeReservations.delete(reservation.id);
    throw walletUnavailable(err);
  }
}

/**
 * Returns the reservation to the balance. Never throws: a refund that cannot
 * be recorded right now is logged and picked up by reconciliation (the
 * reservation stays pending, never lost).
 */
export async function refundCredits(reservation: Reservation, reason: string): Promise<{ refunded: number; refundId: string } | null> {
  try {
    const backend = await getWalletBackend();
    const r = await backend.refund(reservation.userId, reservation.id, reason);
    activeReservations.delete(reservation.id);
    return { refunded: r.refunded, refundId: r.refundId };
  } catch (err) {
    if (err instanceof WalletRuleError && err.rule === 'reservation_already_captured') {
      activeReservations.delete(reservation.id);
      return null;
    }
    activeReservations.delete(reservation.id);
    serverLogger.error(`Refund for reservation ${reservation.id} could not be recorded; reconciliation will retry`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Grants credits (dev test credits today; purchases/plan renewals later). Idempotent per key. */
export async function grantCredits(userId: string, amount: number, reason: string, tool = 'system', idempotencyKey: string | null = null): Promise<number> {
  try {
    const backend = await getWalletBackend();
    await backend.ensure(userId, walletSignupBonusCredits());
    return await backend.credit(userId, amount, reason, tool, idempotencyKey);
  } catch (err) {
    throw walletUnavailable(err);
  }
}
