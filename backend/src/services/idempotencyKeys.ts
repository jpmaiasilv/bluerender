/**
 * Idempotency-key tracking for paid operations — used by any future route
 * that debits credits for a one-shot action (e.g. creating a furniture
 * block), so a client retry (dropped response, double-submit, etc.) with
 * the SAME key never charges twice. Not wired into any live route in this
 * round — see config/humanizedFloorplanBilling.ts for the billing rules
 * this exists to support once the block-creation endpoint is built.
 *
 * In-memory, matching this codebase's existing simple dev-mode patterns
 * (see services/creditWallet.ts's single in-memory balance, routes' own
 * in-memory job Maps) — a production-grade implementation would persist
 * this the same place jobs/wallet state eventually get persisted.
 */

export interface IdempotentChargeResult<T> {
  /** True only the first time this exact key was used — a duplicate call with the same key returns the ORIGINAL result with charged: false, and never invokes debitFn again. */
  charged: boolean;
  result: T;
}

interface StoredEntry<T> {
  result: T;
  storedAt: number;
}

const store = new Map<string, StoredEntry<unknown>>();
const ENTRY_TTL_MS = 24 * 60 * 60 * 1000; // 24h — long enough to catch any realistic client retry window, short enough not to leak memory forever in a long-running dev process.

function sweepExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.storedAt > ENTRY_TTL_MS) store.delete(key);
  }
}

/**
 * Runs `operation` (which performs the actual charge + delivers the result)
 * at most once per idempotency key. A second call with the same key, made
 * before the entry expires, returns the FIRST call's result without
 * re-running `operation` — so a caller that (say) debits credits inside
 * `operation` can never double-charge for the same key.
 */
export function withIdempotencyKey<T>(key: string, operation: () => T): IdempotentChargeResult<T> {
  sweepExpired();
  const existing = store.get(key);
  if (existing) {
    return { charged: false, result: existing.result as T };
  }
  const result = operation();
  store.set(key, { result, storedAt: Date.now() });
  return { charged: true, result };
}

/** Async variant — same contract, for an operation that itself needs to await (e.g. a provider call before debiting). */
export async function withIdempotencyKeyAsync<T>(key: string, operation: () => Promise<T>): Promise<IdempotentChargeResult<T>> {
  sweepExpired();
  const existing = store.get(key);
  if (existing) {
    return { charged: false, result: existing.result as T };
  }
  const result = await operation();
  store.set(key, { result, storedAt: Date.now() });
  return { charged: true, result };
}

/** Test-only: clears all tracked keys so tests don't leak state into each other. */
export function resetIdempotencyStoreForTests(): void {
  store.clear();
}
