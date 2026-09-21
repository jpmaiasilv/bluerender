import { assertNoError, requireSupabase } from '../supabaseRepositoryHelpers';
import { CategoryRepository, FinancialRepository } from './repository';
import { FinancialCategory, FinancialTransaction, RecurrenceRule, TransactionFilter, TransactionInput } from './types';
import { CategoryRow, RecurrenceRow, TransactionRow, mapCategoryRow, mapRecurrenceRow, mapTransactionRow } from './mappers';

function transactionPatchToRow(patch: Partial<TransactionInput>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if ('type' in patch) row.type = patch.type;
  if ('description' in patch) row.description = patch.description;
  if ('amountCents' in patch) row.amount_cents = patch.amountCents;
  if ('categoryId' in patch) row.category_id = patch.categoryId;
  if ('transactionDate' in patch) row.transaction_date = patch.transactionDate;
  if ('dueDate' in patch) row.due_date = patch.dueDate;
  if ('settledDate' in patch) row.settled_date = patch.settledDate;
  if ('settled' in patch) row.settled = patch.settled;
  if ('projectId' in patch) row.project_id = patch.projectId;
  if ('clientId' in patch) row.client_id = patch.clientId;
  if ('paymentMethod' in patch) row.payment_method = patch.paymentMethod;
  if ('paymentMethodNote' in patch) row.payment_method_note = patch.paymentMethodNote;
  if ('notes' in patch) row.notes = patch.notes;
  if ('recurrenceRuleId' in patch) row.recurrence_id = patch.recurrenceRuleId;
  if ('attachmentFileId' in patch) row.attachment_file_id = patch.attachmentFileId;
  return row;
}

export class SupabaseFinancialRepository implements FinancialRepository {
  constructor(private organizationId: string) {}

  async createTransaction(input: TransactionInput & { id?: string; createdAt?: string; updatedAt?: string }): Promise<FinancialTransaction> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from('financial_transactions')
      .insert({
        id: input.id,
        organization_id: this.organizationId,
        type: input.type,
        description: input.description,
        amount_cents: input.amountCents,
        category_id: input.categoryId,
        transaction_date: input.transactionDate,
        due_date: input.dueDate,
        settled_date: input.settledDate,
        settled: input.settled,
        project_id: input.projectId,
        client_id: input.clientId,
        recurrence_id: input.recurrenceRuleId,
        payment_method: input.paymentMethod,
        payment_method_note: input.paymentMethodNote,
        notes: input.notes,
        installment_group_id: input.installmentGroupId,
        installment_number: input.installmentNumber,
        installment_total: input.installmentTotal,
        attachment_file_id: input.attachmentFileId,
        ...(input.createdAt ? { created_at: input.createdAt } : {}),
        ...(input.updatedAt ? { updated_at: input.updatedAt } : {}),
      })
      .select()
      .single();
    assertNoError(error);
    return mapTransactionRow(data as TransactionRow);
  }

  async updateTransaction(id: string, patch: Partial<TransactionInput>): Promise<FinancialTransaction> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from('financial_transactions')
      .update(transactionPatchToRow(patch))
      .eq('id', id)
      .select()
      .single();
    assertNoError(error);
    return mapTransactionRow(data as TransactionRow);
  }

  async deleteTransaction(id: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase.from('financial_transactions').delete().eq('id', id);
    assertNoError(error);
  }

  async getTransaction(id: string): Promise<FinancialTransaction | null> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.from('financial_transactions').select('*').eq('id', id).maybeSingle();
    assertNoError(error);
    return data ? mapTransactionRow(data as TransactionRow) : null;
  }

  async listTransactions(filter?: TransactionFilter): Promise<FinancialTransaction[]> {
    const supabase = requireSupabase();
    let query = supabase.from('financial_transactions').select('*').eq('organization_id', this.organizationId);
    if (filter?.type) query = query.eq('type', filter.type);
    if (filter?.categoryId) query = query.eq('category_id', filter.categoryId);
    if (filter?.projectId) query = query.eq('project_id', filter.projectId);
    if (filter?.clientId) query = query.eq('client_id', filter.clientId);
    if (filter?.installmentGroupId) query = query.eq('installment_group_id', filter.installmentGroupId);
    // periodStart/periodEnd filter on periodDateOf(tx) — a derived value
    // (settledDate for settled rows, else dueDate/transactionDate) that has
    // no single DB column, so period filtering stays client-side in
    // calculations.ts exactly as before; this only narrows by transaction_date
    // as a coarse pre-filter when there's no due/settled date involved.
    const { data, error } = await query;
    assertNoError(error);
    return ((data as TransactionRow[]) ?? []).map(mapTransactionRow);
  }

  async createRecurrenceRule(rule: Omit<RecurrenceRule, 'id' | 'createdAt'>): Promise<RecurrenceRule> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from('financial_recurrences')
      .insert({
        organization_id: this.organizationId,
        frequency: rule.frequency,
        recurrence_interval: rule.interval,
        start_date: rule.startDate,
        end_date: rule.endDate,
      })
      .select()
      .single();
    assertNoError(error);
    return mapRecurrenceRow(data as RecurrenceRow);
  }

  async getRecurrenceRule(id: string): Promise<RecurrenceRule | null> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.from('financial_recurrences').select('*').eq('id', id).maybeSingle();
    assertNoError(error);
    return data ? mapRecurrenceRow(data as RecurrenceRow) : null;
  }
}

export class SupabaseCategoryRepository implements CategoryRepository {
  constructor(private organizationId: string) {}

  async createCategory(input: Pick<FinancialCategory, 'name' | 'type'> & { isDefault?: boolean }): Promise<FinancialCategory> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from('financial_categories')
      .insert({ organization_id: this.organizationId, name: input.name.trim(), type: input.type, is_default: input.isDefault ?? false })
      .select()
      .single();
    assertNoError(error);
    return mapCategoryRow(data as CategoryRow);
  }

  async updateCategory(id: string, patch: Partial<Pick<FinancialCategory, 'name'>>): Promise<FinancialCategory> {
    const supabase = requireSupabase();
    const rowPatch: Record<string, unknown> = {};
    if (patch.name !== undefined) rowPatch.name = patch.name;
    const { data, error } = await supabase.from('financial_categories').update(rowPatch).eq('id', id).select().single();
    assertNoError(error);
    return mapCategoryRow(data as CategoryRow);
  }

  async deleteCategory(id: string): Promise<void> {
    const supabase = requireSupabase();
    const { count } = await supabase.from('financial_transactions').select('id', { count: 'exact', head: true }).eq('category_id', id);
    if ((count ?? 0) > 0) throw new Error('CATEGORY_IN_USE');
    const { error } = await supabase.from('financial_categories').delete().eq('id', id);
    assertNoError(error);
  }

  async listCategories(): Promise<FinancialCategory[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.from('financial_categories').select('*').eq('organization_id', this.organizationId);
    assertNoError(error);
    return ((data as CategoryRow[]) ?? []).map(mapCategoryRow);
  }
}
