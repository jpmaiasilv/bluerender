import { serverLogger } from '../lib/logger';
import { walletStaleReservationMinutes } from '../config/runtimeEnvironment';
import { PendingReservation, getWalletBackend, isReservationActive } from './creditWallet';

/**
 * Recovery for reservations that were never settled — e.g. the server
 * restarted mid-generation, or crashed between saving the result and
 * capturing the credits.
 *
 * A reservation is only examined after WALLET_RESERVATION_STALE_MINUTES
 * (default 20, longer than the longest pipeline) and never while a job in
 * THIS process still owns it. Each tool registers a resolver that looks at the
 * PERSISTED state of its own generation, so credits are never given back for a
 * generation that actually finished:
 *   - result saved      -> capture (the user got what they paid for)
 *   - failed / no result -> refund
 * Tools without persisted generations (the older tools, whose job state is
 * in memory only) use the default: an unsettled reservation older than the
 * threshold means the job is gone -> refund. That favours the user; the
 * trade-off is documented in the wallet notes.
 */

export type ReservationDecision = { action: 'capture'; amount?: number } | { action: 'refund'; reason: string } | { action: 'skip' };
export type ReservationResolver = (pending: PendingReservation) => Promise<ReservationDecision>;

const resolvers = new Map<string, ReservationResolver>();

export function registerReservationResolver(tool: string, resolver: ReservationResolver): void {
  resolvers.set(tool, resolver);
}

export interface ReconcileSummary {
  captured: number;
  refunded: number;
  skipped: number;
}

export async function reconcileStaleReservations(opts: { olderThanSeconds?: number; userId?: string } = {}): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { captured: 0, refunded: 0, skipped: 0 };
  const backend = await getWalletBackend();
  const olderThan = opts.olderThanSeconds ?? walletStaleReservationMinutes() * 60;
  const pending = await backend.pending(olderThan, opts.userId);

  for (const p of pending) {
    if (isReservationActive(p.reservationId)) {
      summary.skipped++;
      continue;
    }
    try {
      const resolver = resolvers.get(p.tool);
      const decision: ReservationDecision = resolver ? await resolver(p) : { action: 'refund', reason: 'orphaned_reservation' };
      if (decision.action === 'capture') {
        await backend.capture(p.userId, p.reservationId, decision.amount);
        summary.captured++;
      } else if (decision.action === 'refund') {
        await backend.refund(p.userId, p.reservationId, decision.reason);
        summary.refunded++;
      } else {
        summary.skipped++;
      }
    } catch (err) {
      summary.skipped++;
      serverLogger.error(`Could not reconcile reservation ${p.reservationId}`, err instanceof Error ? err.message : String(err));
    }
  }
  return summary;
}

let timer: NodeJS.Timeout | null = null;

/** Runs reconciliation shortly after startup and then every few minutes. Failures are logged, never thrown. */
export function startWalletReconciler(extraPass?: () => Promise<void>, intervalMs = 5 * 60 * 1000): void {
  if (timer) return;
  const run = async () => {
    try {
      const s = await reconcileStaleReservations();
      if (s.captured || s.refunded) serverLogger.log(`Wallet reconciliation: captured ${s.captured}, refunded ${s.refunded}, skipped ${s.skipped}`);
      await extraPass?.();
    } catch (err) {
      serverLogger.error('Wallet reconciliation pass failed', err instanceof Error ? err.message : String(err));
    }
  };
  setTimeout(() => void run(), 20_000).unref();
  timer = setInterval(() => void run(), intervalMs);
  timer.unref();
}
