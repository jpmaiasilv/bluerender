// Every dashboard number and chart on the Financial page reads from these
// functions — never recomputed ad hoc inside a component — so cards, charts,
// lists and totals can never disagree with each other.

import { addDays, isWithinRange, PeriodRange, todayISO } from './dates';
import { deriveStatus, FinancialCategory, FinancialTransaction, periodDateOf } from './types';

function inPeriod(tx: FinancialTransaction, range: PeriodRange): boolean {
  return isWithinRange(periodDateOf(tx), range);
}

export function totalIncome(transactions: FinancialTransaction[], range: PeriodRange): number {
  return transactions
    .filter((t) => t.type === 'income' && t.settled && inPeriod(t, range))
    .reduce((sum, t) => sum + t.amountCents, 0);
}

export function totalExpense(transactions: FinancialTransaction[], range: PeriodRange): number {
  return transactions
    .filter((t) => t.type === 'expense' && t.settled && inPeriod(t, range))
    .reduce((sum, t) => sum + t.amountCents, 0);
}

export function balance(transactions: FinancialTransaction[], range: PeriodRange): number {
  return totalIncome(transactions, range) - totalExpense(transactions, range);
}

export function receivable(transactions: FinancialTransaction[], range: PeriodRange): number {
  return transactions
    .filter((t) => t.type === 'income' && !t.settled && inPeriod(t, range))
    .reduce((sum, t) => sum + t.amountCents, 0);
}

export function payable(transactions: FinancialTransaction[], range: PeriodRange): number {
  return transactions
    .filter((t) => t.type === 'expense' && !t.settled && inPeriod(t, range))
    .reduce((sum, t) => sum + t.amountCents, 0);
}

/**
 * Operational cash forecast — NOT period-scoped: it's the current true
 * position (all-time realized balance) projected forward by every
 * outstanding receivable/payable, regardless of which period the dashboard
 * happens to be showing. This is deliberately simple (no discounting, no
 * accrual accounting) — an operational estimate, not a ledger.
 */
export function forecastBalance(allTransactions: FinancialTransaction[]): number {
  const realized = allTransactions
    .filter((t) => t.settled)
    .reduce((sum, t) => sum + (t.type === 'income' ? t.amountCents : -t.amountCents), 0);
  const outstandingReceivable = allTransactions
    .filter((t) => t.type === 'income' && !t.settled)
    .reduce((sum, t) => sum + t.amountCents, 0);
  const outstandingPayable = allTransactions
    .filter((t) => t.type === 'expense' && !t.settled)
    .reduce((sum, t) => sum + t.amountCents, 0);
  return realized + outstandingReceivable - outstandingPayable;
}

export function dueWithinDays(allTransactions: FinancialTransaction[], type: 'income' | 'expense', days: number, today = todayISO()): number {
  const until = addDays(today, days);
  return allTransactions
    .filter((t) => t.type === type && !t.settled && t.dueDate && t.dueDate >= today && t.dueDate <= until)
    .reduce((sum, t) => sum + t.amountCents, 0);
}

export function overdueTransactions(allTransactions: FinancialTransaction[], today = todayISO()): FinancialTransaction[] {
  return allTransactions.filter((t) => deriveStatus(t, today) === 'overdue');
}

export interface UpcomingDueItem {
  transaction: FinancialTransaction;
  daysUntilDue: number;
}

/** Unsettled transactions with a due date, soonest first, capped to `limit`. */
export function upcomingDueDates(allTransactions: FinancialTransaction[], limit = 8, today = todayISO()): UpcomingDueItem[] {
  return allTransactions
    .filter((t) => !t.settled && t.dueDate)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0))
    .slice(0, limit)
    .map((transaction) => ({
      transaction,
      daysUntilDue: Math.round(
        (new Date(transaction.dueDate! + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86_400_000
      ),
    }));
}

export interface CategoryBreakdownItem {
  categoryId: string;
  categoryName: string;
  amountCents: number;
  percent: number;
}

const OTHERS_BUCKET_LABEL = 'Outros';
const MAX_CATEGORY_SLICES = 6;

export function categoryBreakdown(
  transactions: FinancialTransaction[],
  categories: FinancialCategory[],
  range: PeriodRange,
  type: 'income' | 'expense'
): CategoryBreakdownItem[] {
  const byCategory = new Map<string, number>();
  let total = 0;
  transactions
    .filter((t) => t.type === type && t.settled && inPeriod(t, range))
    .forEach((t) => {
      byCategory.set(t.categoryId, (byCategory.get(t.categoryId) ?? 0) + t.amountCents);
      total += t.amountCents;
    });

  const nameFor = (id: string) => categories.find((c) => c.id === id)?.name ?? id;
  const sorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);

  const head = sorted.slice(0, MAX_CATEGORY_SLICES);
  const tail = sorted.slice(MAX_CATEGORY_SLICES);
  const items: CategoryBreakdownItem[] = head.map(([categoryId, amountCents]) => ({
    categoryId,
    categoryName: nameFor(categoryId),
    amountCents,
    percent: total > 0 ? (amountCents / total) * 100 : 0,
  }));

  if (tail.length > 0) {
    const othersTotal = tail.reduce((sum, [, amount]) => sum + amount, 0);
    items.push({
      categoryId: '__others__',
      categoryName: OTHERS_BUCKET_LABEL,
      amountCents: othersTotal,
      percent: total > 0 ? (othersTotal / total) * 100 : 0,
    });
  }

  return items;
}

export type CashflowGranularity = 'hour' | 'day' | 'week' | 'month';

export interface CashflowPoint {
  label: string;
  bucketStart: string;
  incomeCents: number;
  expenseCents: number;
}

/** Picks a legible bucket size for a given range — mirrors the guidance in
 * the spec (hour for a single day if there's enough data, day for a week,
 * day/week for 30 days or a month, week/month beyond that). */
export function granularityForRange(range: PeriodRange): CashflowGranularity {
  const spanDays = Math.round((new Date(range.end).getTime() - new Date(range.start).getTime()) / 86_400_000) + 1;
  if (spanDays <= 1) return 'hour';
  if (spanDays <= 10) return 'day';
  if (spanDays <= 45) return 'day';
  if (spanDays <= 120) return 'week';
  return 'month';
}

function bucketKeyFor(dateISO: string, timestamp: number, granularity: CashflowGranularity): { key: string; label: string } {
  if (granularity === 'hour') {
    const hour = new Date(timestamp).getHours();
    return { key: `${dateISO}T${hour}`, label: `${String(hour).padStart(2, '0')}h` };
  }
  if (granularity === 'day') {
    const [, m, d] = dateISO.split('-');
    return { key: dateISO, label: `${d}/${m}` };
  }
  if (granularity === 'week') {
    const date = new Date(dateISO + 'T00:00:00');
    const day = date.getDay();
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((day + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    const [, m, d] = key.split('-');
    return { key, label: `${d}/${m}` };
  }
  const [y, m] = dateISO.split('-');
  return { key: `${y}-${m}`, label: `${m}/${y}` };
}

export type CashflowValuationMode = 'realized' | 'forecast';

/**
 * Buckets income/expense into a legible series across the period. `hour`
 * buckets use each transaction's createdAt clock time (the only timestamp
 * this module keeps) since transactionDate itself has no time-of-day
 * component.
 *
 * `mode: 'realized'` (default) only counts settled money — what actually
 * moved. `'forecast'` also includes pending transactions, bucketed by their
 * periodDateOf (due date, or transactionDate if none) — what's expected to
 * move if everything gets paid/received on schedule.
 */
export function cashflowSeries(
  transactions: FinancialTransaction[],
  range: PeriodRange,
  granularity: CashflowGranularity,
  mode: CashflowValuationMode = 'realized'
): CashflowPoint[] {
  const buckets = new Map<string, CashflowPoint>();

  transactions
    .filter((t) => (mode === 'forecast' || t.settled) && inPeriod(t, range))
    .forEach((t) => {
      const d = periodDateOf(t);
      const { key, label } = bucketKeyFor(d, new Date(t.createdAt).getTime(), granularity);
      const existing = buckets.get(key) ?? { label, bucketStart: key, incomeCents: 0, expenseCents: 0 };
      if (t.type === 'income') existing.incomeCents += t.amountCents;
      else existing.expenseCents += t.amountCents;
      buckets.set(key, existing);
    });

  return [...buckets.values()].sort((a, b) => (a.bucketStart < b.bucketStart ? -1 : a.bucketStart > b.bucketStart ? 1 : 0));
}

export interface CashflowSeriesWithBalance extends CashflowPoint {
  cumulativeBalanceCents: number;
}

export function cashflowSeriesWithCumulativeBalance(points: CashflowPoint[], startingBalanceCents = 0): CashflowSeriesWithBalance[] {
  let running = startingBalanceCents;
  return points.map((p) => {
    running += p.incomeCents - p.expenseCents;
    return { ...p, cumulativeBalanceCents: running };
  });
}

export interface ProjectResult {
  incomeCents: number;
  expenseCents: number;
  resultCents: number;
  receivableCents: number;
  payableCents: number;
}

export function resultByProject(transactions: FinancialTransaction[], projectId: string): ProjectResult {
  const projectTx = transactions.filter((t) => t.projectId === projectId);
  const incomeCents = projectTx.filter((t) => t.type === 'income' && t.settled).reduce((s, t) => s + t.amountCents, 0);
  const expenseCents = projectTx.filter((t) => t.type === 'expense' && t.settled).reduce((s, t) => s + t.amountCents, 0);
  const receivableCents = projectTx.filter((t) => t.type === 'income' && !t.settled).reduce((s, t) => s + t.amountCents, 0);
  const payableCents = projectTx.filter((t) => t.type === 'expense' && !t.settled).reduce((s, t) => s + t.amountCents, 0);
  return { incomeCents, expenseCents, resultCents: incomeCents - expenseCents, receivableCents, payableCents };
}
