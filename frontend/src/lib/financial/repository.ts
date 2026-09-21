import { FinancialCategory, FinancialTransaction, RecurrenceRule, TransactionFilter, TransactionInput } from './types';

/**
 * The only contracts the UI and FinancialService are allowed to depend on.
 * `SupabaseFinancialRepository`/`SupabaseCategoryRepository` (see
 * supabaseRepository.ts) are the only implementations — see
 * getFinancialRepositories() in repositoryProvider.ts, the single place
 * that decides which implementation to construct. Attachments are not part
 * of this module: they're project_files rows (see lib/projectFiles),
 * referenced from a transaction by attachmentFileId — never a separate
 * upload pipeline.
 */
export interface FinancialRepository {
  createTransaction(input: TransactionInput & { id?: string; createdAt?: string; updatedAt?: string }): Promise<FinancialTransaction>;
  updateTransaction(id: string, patch: Partial<TransactionInput>): Promise<FinancialTransaction>;
  deleteTransaction(id: string): Promise<void>;
  getTransaction(id: string): Promise<FinancialTransaction | null>;
  listTransactions(filter?: TransactionFilter): Promise<FinancialTransaction[]>;

  createRecurrenceRule(rule: Omit<RecurrenceRule, 'id' | 'createdAt'>): Promise<RecurrenceRule>;
  getRecurrenceRule(id: string): Promise<RecurrenceRule | null>;
}

export interface CategoryRepository {
  createCategory(input: Pick<FinancialCategory, 'name' | 'type'> & { isDefault?: boolean }): Promise<FinancialCategory>;
  updateCategory(id: string, patch: Partial<Pick<FinancialCategory, 'name'>>): Promise<FinancialCategory>;
  deleteCategory(id: string): Promise<void>;
  listCategories(): Promise<FinancialCategory[]>;
}
