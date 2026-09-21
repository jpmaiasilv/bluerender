// Reuses the EXISTING Financial module's repository directly — this is
// deliberately not a new repository or a re-implementation of its sums.
// FinancialTransaction is the single source of truth for money; this file
// only reads it, filtered by projectId, using the exact same
// settled/receivable semantics as lib/financial/calculations.ts.
import { getFinancialRepositories } from '../financial/repositoryProvider';
import { ProjectFinancials } from './types';

export async function getProjectFinancials(organizationId: string, projectId: string): Promise<ProjectFinancials> {
  const { financial } = getFinancialRepositories(organizationId);
  const transactions = await financial.listTransactions({ projectId });

  const receivedCents = transactions
    .filter((t) => t.type === 'income' && t.settled)
    .reduce((sum, t) => sum + t.amountCents, 0);
  const receivableCents = transactions
    .filter((t) => t.type === 'income' && !t.settled)
    .reduce((sum, t) => sum + t.amountCents, 0);
  const expenseCents = transactions
    .filter((t) => t.type === 'expense' && t.settled)
    .reduce((sum, t) => sum + t.amountCents, 0);

  return { receivedCents, receivableCents, expenseCents, resultCents: receivedCents - expenseCents };
}

/** Batched variant for the board/list, where computing this one project at a
 * time would mean N sequential IndexedDB reads — reads every transaction
 * once and groups by projectId instead. */
export async function getProjectFinancialsByProjectIds(organizationId: string, projectIds: string[]): Promise<Map<string, ProjectFinancials>> {
  const { financial } = getFinancialRepositories(organizationId);
  const all = await financial.listTransactions();
  const relevant = new Set(projectIds);

  const map = new Map<string, ProjectFinancials>();
  for (const id of projectIds) map.set(id, { receivedCents: 0, receivableCents: 0, expenseCents: 0, resultCents: 0 });

  for (const t of all) {
    if (!t.projectId || !relevant.has(t.projectId)) continue;
    const entry = map.get(t.projectId)!;
    if (t.type === 'income' && t.settled) entry.receivedCents += t.amountCents;
    else if (t.type === 'income' && !t.settled) entry.receivableCents += t.amountCents;
    else if (t.type === 'expense' && t.settled) entry.expenseCents += t.amountCents;
  }
  for (const entry of map.values()) entry.resultCents = entry.receivedCents - entry.expenseCents;
  return map;
}

/** Sum of all projects' outstanding receivables — used by the board's
 * summary bar's "A receber" figure, which must come from Financial, not be
 * recomputed independently (per spec). */
export async function totalReceivableAcrossProjects(organizationId: string): Promise<number> {
  const { financial } = getFinancialRepositories(organizationId);
  const all = await financial.listTransactions();
  return all.filter((t) => t.type === 'income' && !t.settled && t.projectId).reduce((sum, t) => sum + t.amountCents, 0);
}
