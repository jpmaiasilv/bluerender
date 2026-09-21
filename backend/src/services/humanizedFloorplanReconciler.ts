import { serverLogger } from '../lib/logger';
import { walletStaleReservationMinutes } from '../config/runtimeEnvironment';
import { getWalletBackend } from './creditWallet';
import { registerReservationResolver } from './walletReconciler';
import { getGenerationStore } from './humanizedFloorplanStore';
import { getFileStorage } from '../storage/humanizedFloorplanFiles';

/**
 * Recovery for Planta Humanizada generations interrupted mid-flight.
 * Decisions are always taken from PERSISTED state, never from a guess:
 *
 *   reservation still pending, generation record says
 *     completed                      -> capture
 *     failed                         -> refund
 *     processing + result file saved -> the image exists: finish it (capture
 *                                       + mark completed) — the user is NOT refunded
 *     processing, no result file     -> refund, mark failed
 *     no record at all               -> refund
 *
 *   reservation already settled but the record still says 'processing'
 *   (crash between capture/refund and the record update) -> the record is
 *   brought in line with the ledger.
 */

export const HUMANIZED_TOOL = 'planta_humanizada';
export const HUMANIZED_ASTRA_TOOL = 'planta_humanizada_astra';

/** Generations a job in THIS process is still running — reconciliation leaves them alone. */
const liveGenerations = new Set<string>();
export const markGenerationLive = (id: string): void => void liveGenerations.add(id);
export const markGenerationDone = (id: string): void => void liveGenerations.delete(id);

const resolveHumanizedReservation: Parameters<typeof registerReservationResolver>[1] = async (p) => {
  if (!p.generationId) return { action: 'refund', reason: 'no_generation' };
  if (liveGenerations.has(p.generationId)) return { action: 'skip' };
  const store = await getGenerationStore();
  const rec = await store.get(p.userId, p.generationId);
  if (!rec) return { action: 'refund', reason: 'generation_missing' };
  if (rec.status === 'completed') return { action: 'capture' };
  if (rec.status === 'failed') return { action: 'refund', reason: 'generation_failed' };

  const storage = await getFileStorage();
  if (rec.resultPath && (await storage.exists(rec.resultPath))) {
    await store.update(p.userId, rec.id, { status: 'completed', creditsCaptured: p.amount, completedAt: new Date().toISOString() });
    return { action: 'capture' };
  }
  await store.update(p.userId, rec.id, {
    status: 'failed',
    creditsCaptured: 0,
    creditsRefunded: p.amount,
    errorCode: 'GENERATION_FAILED',
    errorMessage: 'The generation was interrupted before finishing.',
    completedAt: new Date().toISOString(),
  });
  return { action: 'refund', reason: 'interrupted_before_result' };
};

// The standard and the Astra mode share the same rule: it looks at the persisted generation (a saved final result is always captured, never refunded).
registerReservationResolver(HUMANIZED_TOOL, resolveHumanizedReservation);
registerReservationResolver(HUMANIZED_ASTRA_TOOL, resolveHumanizedReservation);

/** Brings 'processing' records whose credits are already settled in line with the ledger. */
export async function reconcileStaleGenerations(olderThanMs: number = walletStaleReservationMinutes() * 60_000): Promise<number> {
  const store = await getGenerationStore();
  const backend = await getWalletBackend();
  const stale = await store.listStaleProcessing(olderThanMs);
  let fixed = 0;
  for (const rec of stale) {
    if (liveGenerations.has(rec.id)) continue;
    try {
      const movements = await backend.ledgerForGeneration(rec.userId, rec.id);
      const capture = movements.find((m) => m.type === 'capture');
      const refund = movements.find((m) => m.type === 'refund' && !movements.some((c) => c.type === 'capture'));
      const reserve = movements.find((m) => m.type === 'reserve');
      const now = new Date().toISOString();
      if (capture && rec.resultPath) {
        await store.update(rec.userId, rec.id, { status: 'completed', creditsCaptured: capture.amount, captureTransactionId: capture.id, completedAt: now });
        fixed++;
      } else if (refund || (capture && !rec.resultPath)) {
        await store.update(rec.userId, rec.id, { status: 'failed', creditsCaptured: 0, creditsRefunded: refund?.amount ?? 0, refundTransactionId: refund?.id ?? null, errorCode: 'GENERATION_FAILED', errorMessage: 'The generation was interrupted before finishing.', completedAt: now });
        fixed++;
      } else if (!reserve) {
        // Never reserved anything (crashed right after the row was created): nothing to refund, nothing delivered.
        await store.update(rec.userId, rec.id, { status: 'failed', errorCode: 'GENERATION_FAILED', errorMessage: 'The generation was interrupted before finishing.', completedAt: now });
        fixed++;
      }
      // reserve exists and is unsettled -> handled by the wallet reservation resolver above.
    } catch (err) {
      serverLogger.error(`Could not reconcile generation ${rec.id}`, err instanceof Error ? err.message : String(err));
    }
  }
  return fixed;
}
