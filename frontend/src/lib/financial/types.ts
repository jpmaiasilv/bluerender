// --- Gestão Financeira: core domain types ---
//
// Money is always represented in integer cents (amountCents) — never floats
// — to avoid rounding drift in sums. Format only at render time (see
// money.ts). Dates the user reasons about (transactionDate, dueDate,
// settledDate) are date-only "YYYY-MM-DD" strings, never Date objects or
// timestamps, so period filtering never drifts a day from a UTC conversion
// (see dates.ts). createdAt/updatedAt are full ISO timestamps — audit
// metadata only, never used for period filtering.

export type TransactionType = 'income' | 'expense';

/** The only status a user sets directly. Every user-facing label (Recebido,
 * A receber, Pago, A pagar, Atrasado) is derived from this + dueDate — see
 * deriveStatus() below. Never store "overdue" — it would drift stale the
 * moment a day passes. */
export type SettlementState = 'settled' | 'pending';

export type DerivedStatus = 'received' | 'receivable' | 'paid' | 'payable' | 'overdue';

export type PaymentMethod = 'pix' | 'bankTransfer' | 'creditCard' | 'debitCard' | 'boleto' | 'cash' | 'other';

export const PAYMENT_METHODS: PaymentMethod[] = ['pix', 'bankTransfer', 'creditCard', 'debitCard', 'boleto', 'cash', 'other'];

/** 'monthly' is the only frequency exposed in the UI today — 'weekly' and
 * 'yearly' exist in the type/engine now so the future UI addition doesn't
 * need a data migration. */
export type RecurrenceFrequency = 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceRule {
  id: string;
  frequency: RecurrenceFrequency;
  /** Every N periods — 1 = every month, 2 = every other month, etc. */
  interval: number;
  /** Anchor date (YYYY-MM-DD) — the first occurrence's transactionDate. */
  startDate: string;
  /** Optional end date (YYYY-MM-DD), inclusive. Null = open-ended, but
   * generation is still bounded — see generateRecurringOccurrences(). */
  endDate: string | null;
  createdAt: string;
}

/** Only monthly for now — mirrors RecurrenceFrequency's own scoping (the type
 * allows for more later without a data migration; the UI exposes just one). */
export type InstallmentFrequency = 'monthly';

export interface InstallmentInput {
  /** Total number of installments — always >= 2 (a single "installment" is just a normal transaction). */
  count: number;
  firstDueDate: string;
  frequency: InstallmentFrequency;
}

export interface FinancialCategory {
  id: string;
  name: string;
  type: TransactionType;
  /** Seeded on first run — kept editable/deletable like any other category,
   * this only distinguishes "came with the app" for display purposes. */
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialTransaction {
  id: string;
  /** Not populated from the row (see mapTransactionRow) — the real creator
   * lives in the DB as created_by, set server-side via auth.uid(); nothing
   * in the UI needs it today. */
  userId: string | null;
  organizationId: string | null;

  type: TransactionType;
  description: string;
  amountCents: number;
  categoryId: string;

  /** When the transaction was recorded / the money is logically "for". */
  transactionDate: string;
  /** When it's due, if still pending. Null once irrelevant (rare) or for
   * transactions that were always settled on the spot. */
  dueDate: string | null;
  /** When it was actually received/paid — set only when settled. */
  settledDate: string | null;
  settled: boolean;

  /** Optional links — never fabricated. Null until real Projects/Clients
   * modules exist and are wired in (see section 20/21 of the spec). */
  projectId: string | null;
  clientId: string | null;

  paymentMethod: PaymentMethod | null;
  paymentMethodNote: string | null;
  notes: string | null;

  isRecurring: boolean;
  recurrenceRuleId: string | null;

  /** Part of a "Parcelar lançamento" plan when set — all sibling installments
   * share the same installmentGroupId; installmentNumber/Total identify this
   * one's position ("Parcela 2/4"). Mutually exclusive with recurrence in the
   * UI — a transaction is never both. */
  installmentGroupId: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;

  /** A project_files row (bucket: project-files) — reused, never a separate
   * upload pipeline. Null projectId on that file means a general, no-obra
   * attachment; a real projectId makes it also show up under that obra's
   * "Arquivos da obra → Financeiro". */
  attachmentFileId: string | null;

  createdAt: string;
  updatedAt: string;
}

/** Derives the user-facing status purely from stored data — never trusts a
 * stale manual "overdue" flag. `todayISO` is injected (not read from `new
 * Date()` inside) so this stays a pure, testable function. */
export function deriveStatus(tx: Pick<FinancialTransaction, 'type' | 'settled' | 'dueDate'>, todayISO: string): DerivedStatus {
  if (tx.settled) return tx.type === 'income' ? 'received' : 'paid';
  if (tx.dueDate && tx.dueDate < todayISO) return 'overdue';
  return tx.type === 'income' ? 'receivable' : 'payable';
}

/** The single date every period filter, chart and total uses for a given
 * transaction — settled transactions count on the date they were actually
 * settled; pending ones count on their due date (falling back to the
 * transaction date if no due date was set). Keeping this in one place is
 * what makes cards/charts/lists/totals agree with each other. */
export function periodDateOf(tx: Pick<FinancialTransaction, 'settled' | 'settledDate' | 'dueDate' | 'transactionDate'>): string {
  if (tx.settled) return tx.settledDate ?? tx.transactionDate;
  return tx.dueDate ?? tx.transactionDate;
}

export interface TransactionInput {
  type: TransactionType;
  description: string;
  amountCents: number;
  categoryId: string;
  transactionDate: string;
  dueDate: string | null;
  settled: boolean;
  settledDate: string | null;
  projectId: string | null;
  clientId: string | null;
  paymentMethod: PaymentMethod | null;
  paymentMethodNote: string | null;
  notes: string | null;
  isRecurring: boolean;
  recurrenceRuleId: string | null;
  installmentGroupId: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  attachmentFileId: string | null;
}

export interface TransactionFilter {
  type?: TransactionType;
  categoryId?: string;
  projectId?: string;
  clientId?: string;
  installmentGroupId?: string;
  /** Inclusive YYYY-MM-DD bounds, matched against periodDateOf(tx). */
  periodStart?: string;
  periodEnd?: string;
}
