import { addMonths, todayISO } from './dates';
import { generateFollowingOccurrenceDates } from './recurrence';
import { FinancialRepositories } from './repositoryProvider';
import { FinancialCategory, FinancialTransaction, InstallmentInput, RecurrenceFrequency, TransactionInput } from './types';

export interface RecurrenceInput {
  frequency: RecurrenceFrequency;
  interval: number;
  endDate: string | null;
}

/**
 * The only layer UI components talk to. Owns business rules (id/createdAt
 * preservation on edit, bounded recurring-series generation, settlement
 * bookkeeping) so those rules live in exactly one place regardless of which
 * repository implementation is behind it.
 */
export class FinancialService {
  constructor(private repos: FinancialRepositories) {}

  async listTransactions(): Promise<FinancialTransaction[]> {
    return this.repos.financial.listTransactions();
  }

  async listCategories(): Promise<FinancialCategory[]> {
    return this.repos.categories.listCategories();
  }

  async createTransaction(input: TransactionInput, recurrence?: RecurrenceInput, installment?: InstallmentInput): Promise<FinancialTransaction[]> {
    if (installment && installment.count >= 2) {
      return this.createInstallmentPlan(input, installment);
    }

    let recurrenceRuleId: string | null = null;
    if (recurrence && input.isRecurring) {
      const rule = await this.repos.financial.createRecurrenceRule({
        frequency: recurrence.frequency,
        interval: Math.max(1, recurrence.interval),
        startDate: input.transactionDate,
        endDate: recurrence.endDate,
      });
      recurrenceRuleId = rule.id;
    }

    const first = await this.repos.financial.createTransaction({ ...input, recurrenceRuleId });

    const created = [first];

    if (recurrence && input.isRecurring && recurrenceRuleId) {
      const followingDates = generateFollowingOccurrenceDates(input.transactionDate, recurrence.frequency, recurrence.interval, recurrence.endDate);
      const dueDelta = input.dueDate ? daysBetweenDates(input.transactionDate, input.dueDate) : null;
      for (const date of followingDates) {
        const occurrence = await this.repos.financial.createTransaction({
          ...input,
          transactionDate: date,
          dueDate: dueDelta !== null ? shiftDate(date, dueDelta) : null,
          settled: false,
          settledDate: null,
          recurrenceRuleId,
          // A recurring series' later occurrences never carry the same
          // attachment forward — each is its own future record.
          attachmentFileId: null,
        });
        created.push(occurrence);
      }
    }

    return created;
  }

  /**
   * Splits input.amountCents evenly across `installment.count` occurrences,
   * putting any leftover cent (integer division can't always divide evenly)
   * on the LAST installment so the parts always sum back to the exact total.
   * Every occurrence is unsettled/pending — you don't receive all parcelas
   * on day one — and they share one installmentGroupId so the relationship
   * between them is never lost (see deleteInstallmentGroup).
   */
  private async createInstallmentPlan(input: TransactionInput, installment: InstallmentInput): Promise<FinancialTransaction[]> {
    const count = Math.max(2, Math.floor(installment.count));
    const base = Math.floor(input.amountCents / count);
    const remainder = input.amountCents - base * count;
    const groupId = crypto.randomUUID();

    const created: FinancialTransaction[] = [];
    for (let i = 0; i < count; i++) {
      const dueDate = addMonths(installment.firstDueDate, i);
      const amountCents = i === count - 1 ? base + remainder : base;
      const occurrence = await this.repos.financial.createTransaction({
        ...input,
        amountCents,
        transactionDate: dueDate,
        dueDate,
        settled: false,
        settledDate: null,
        isRecurring: false,
        recurrenceRuleId: null,
        installmentGroupId: groupId,
        installmentNumber: i + 1,
        installmentTotal: count,
        // The attachment (e.g. the signed contract) belongs to the plan as a
        // whole — only the first installment keeps the reference, so it isn't
        // shown as if every parcela had its own separate document.
        attachmentFileId: i === 0 ? input.attachmentFileId : null,
      });
      created.push(occurrence);
    }
    return created;
  }

  /**
   * "Excluir todas as parcelas futuras": removes `from` and every later
   * installment in its group, leaving earlier (already-settled-or-not)
   * ones untouched. "Excluir somente esta parcela" is just deleteTransaction.
   */
  async deleteInstallmentGroupFrom(groupId: string, fromInstallmentNumber: number): Promise<void> {
    const siblings = await this.repos.financial.listTransactions({ installmentGroupId: groupId });
    const toDelete = siblings.filter((t) => (t.installmentNumber ?? 0) >= fromInstallmentNumber);
    for (const tx of toDelete) {
      await this.repos.financial.deleteTransaction(tx.id);
    }
  }

  async updateTransaction(id: string, patch: Partial<TransactionInput>): Promise<FinancialTransaction> {
    return this.repos.financial.updateTransaction(id, patch);
  }

  async deleteTransaction(id: string): Promise<void> {
    return this.repos.financial.deleteTransaction(id);
  }

  async duplicateTransaction(source: FinancialTransaction): Promise<FinancialTransaction> {
    // A fresh, unsettled copy dated today — the user reviews it in the
    // still-open form before saving, so we never silently copy a payment
    // status or a stale date onto a brand new record.
    const today = todayISO();
    return this.repos.financial.createTransaction({
      type: source.type,
      description: source.description,
      amountCents: source.amountCents,
      categoryId: source.categoryId,
      transactionDate: today,
      dueDate: source.dueDate ? shiftDate(today, daysBetweenDates(source.transactionDate, source.dueDate)) : null,
      settled: false,
      settledDate: null,
      projectId: source.projectId,
      clientId: source.clientId,
      paymentMethod: source.paymentMethod,
      paymentMethodNote: source.paymentMethodNote,
      notes: source.notes,
      isRecurring: false,
      recurrenceRuleId: null,
      installmentGroupId: null,
      installmentNumber: null,
      installmentTotal: null,
      // A duplicate never inherits the source's attachment — it's a fresh
      // record the user reviews before saving, not a copy of that document.
      attachmentFileId: null,
    });
  }

  async markSettled(id: string, settledDate = todayISO()): Promise<FinancialTransaction> {
    return this.repos.financial.updateTransaction(id, { settled: true, settledDate });
  }

  async markUnsettled(id: string): Promise<FinancialTransaction> {
    return this.repos.financial.updateTransaction(id, { settled: false, settledDate: null });
  }

  async createCategory(name: string, type: 'income' | 'expense'): Promise<FinancialCategory> {
    return this.repos.categories.createCategory({ name, type });
  }

  async deleteCategory(id: string): Promise<void> {
    return this.repos.categories.deleteCategory(id);
  }
}

function daysBetweenDates(fromISO: string, toISODate: string): number {
  const a = new Date(fromISO + 'T00:00:00').getTime();
  const b = new Date(toISODate + 'T00:00:00').getTime();
  return Math.round((b - a) / 86_400_000);
}

function shiftDate(dateISO: string, days: number): string {
  const d = new Date(dateISO + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
