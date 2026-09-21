import { getFinancialDb } from './db';
import { CategoryRepository, FinancialRepository } from './repository';
import { FinancialCategory, FinancialTransaction, RecurrenceRule, TransactionFilter, TransactionInput, periodDateOf } from './types';

function newId(): string {
  return crypto.randomUUID();
}

function nowISO(): string {
  return new Date().toISOString();
}

export class IndexedDbFinancialRepository implements FinancialRepository {
  async createTransaction(input: TransactionInput & { id?: string; createdAt?: string; updatedAt?: string }): Promise<FinancialTransaction> {
    const db = await getFinancialDb();
    const now = nowISO();
    const transaction: FinancialTransaction = {
      id: input.id ?? newId(),
      userId: null,
      organizationId: null,
      type: input.type,
      description: input.description,
      amountCents: input.amountCents,
      categoryId: input.categoryId,
      transactionDate: input.transactionDate,
      dueDate: input.dueDate,
      settledDate: input.settledDate,
      settled: input.settled,
      projectId: input.projectId,
      clientId: input.clientId,
      paymentMethod: input.paymentMethod,
      paymentMethodNote: input.paymentMethodNote,
      notes: input.notes,
      isRecurring: input.isRecurring,
      recurrenceRuleId: input.recurrenceRuleId,
      installmentGroupId: input.installmentGroupId,
      installmentNumber: input.installmentNumber,
      installmentTotal: input.installmentTotal,
      attachmentFileId: input.attachmentFileId,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    await db.put('transactions', transaction);
    return transaction;
  }

  async updateTransaction(id: string, patch: Partial<TransactionInput>): Promise<FinancialTransaction> {
    const db = await getFinancialDb();
    const existing = await db.get('transactions', id);
    if (!existing) throw new Error(`Transaction not found: ${id}`);
    const updated: FinancialTransaction = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt, updatedAt: nowISO() };
    await db.put('transactions', updated);
    return updated;
  }

  async deleteTransaction(id: string): Promise<void> {
    const db = await getFinancialDb();
    await db.delete('transactions', id);
  }

  async getTransaction(id: string): Promise<FinancialTransaction | null> {
    const db = await getFinancialDb();
    return (await db.get('transactions', id)) ?? null;
  }

  async listTransactions(filter?: TransactionFilter): Promise<FinancialTransaction[]> {
    const db = await getFinancialDb();
    let all = await db.getAll('transactions');
    if (filter?.type) all = all.filter((t) => t.type === filter.type);
    if (filter?.categoryId) all = all.filter((t) => t.categoryId === filter.categoryId);
    if (filter?.projectId) all = all.filter((t) => t.projectId === filter.projectId);
    if (filter?.clientId) all = all.filter((t) => t.clientId === filter.clientId);
    if (filter?.installmentGroupId) all = all.filter((t) => t.installmentGroupId === filter.installmentGroupId);
    if (filter?.periodStart || filter?.periodEnd) {
      all = all.filter((t) => {
        const d = periodDateOf(t);
        if (filter.periodStart && d < filter.periodStart) return false;
        if (filter.periodEnd && d > filter.periodEnd) return false;
        return true;
      });
    }
    return all;
  }

  async createRecurrenceRule(rule: Omit<RecurrenceRule, 'id' | 'createdAt'>): Promise<RecurrenceRule> {
    const db = await getFinancialDb();
    const created: RecurrenceRule = { ...rule, id: newId(), createdAt: nowISO() };
    await db.put('recurrenceRules', created);
    return created;
  }

  async getRecurrenceRule(id: string): Promise<RecurrenceRule | null> {
    const db = await getFinancialDb();
    return (await db.get('recurrenceRules', id)) ?? null;
  }
}

export class IndexedDbCategoryRepository implements CategoryRepository {
  async createCategory(input: Pick<FinancialCategory, 'name' | 'type'> & { isDefault?: boolean }): Promise<FinancialCategory> {
    const db = await getFinancialDb();
    const now = nowISO();
    const category: FinancialCategory = {
      id: newId(),
      name: input.name.trim(),
      type: input.type,
      isDefault: input.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
    };
    await db.put('categories', category);
    return category;
  }

  async updateCategory(id: string, patch: Partial<Pick<FinancialCategory, 'name'>>): Promise<FinancialCategory> {
    const db = await getFinancialDb();
    const existing = await db.get('categories', id);
    if (!existing) throw new Error(`Category not found: ${id}`);
    const updated: FinancialCategory = { ...existing, ...patch, updatedAt: nowISO() };
    await db.put('categories', updated);
    return updated;
  }

  async deleteCategory(id: string): Promise<void> {
    const db = await getFinancialDb();
    const inUse = await db.getAllFromIndex('transactions', 'categoryId', id);
    if (inUse.length > 0) {
      throw new Error('CATEGORY_IN_USE');
    }
    await db.delete('categories', id);
  }

  async listCategories(): Promise<FinancialCategory[]> {
    const db = await getFinancialDb();
    return db.getAll('categories');
  }
}
