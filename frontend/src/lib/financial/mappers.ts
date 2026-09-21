import { FinancialCategory, FinancialTransaction, RecurrenceRule } from './types';

export interface TransactionRow {
  id: string;
  organization_id: string;
  type: string;
  description: string;
  amount_cents: number;
  category_id: string;
  transaction_date: string;
  due_date: string | null;
  settled_date: string | null;
  settled: boolean;
  project_id: string | null;
  client_id: string | null;
  recurrence_id: string | null;
  payment_method: string | null;
  payment_method_note: string | null;
  notes: string | null;
  installment_group_id: string | null;
  installment_number: number | null;
  installment_total: number | null;
  attachment_file_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CategoryRow {
  id: string;
  name: string;
  type: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface RecurrenceRow {
  id: string;
  frequency: string;
  recurrence_interval: number;
  start_date: string;
  end_date: string | null;
  created_at: string;
}

export function mapTransactionRow(row: TransactionRow): FinancialTransaction {
  return {
    id: row.id,
    userId: null,
    organizationId: row.organization_id,
    type: row.type as FinancialTransaction['type'],
    description: row.description,
    amountCents: row.amount_cents,
    categoryId: row.category_id,
    transactionDate: row.transaction_date,
    dueDate: row.due_date,
    settledDate: row.settled_date,
    settled: row.settled,
    projectId: row.project_id,
    clientId: row.client_id,
    paymentMethod: row.payment_method as FinancialTransaction['paymentMethod'],
    paymentMethodNote: row.payment_method_note,
    notes: row.notes,
    isRecurring: row.recurrence_id !== null,
    recurrenceRuleId: row.recurrence_id,
    installmentGroupId: row.installment_group_id,
    installmentNumber: row.installment_number,
    installmentTotal: row.installment_total,
    attachmentFileId: row.attachment_file_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapCategoryRow(row: CategoryRow): FinancialCategory {
  return {
    id: row.id,
    name: row.name,
    type: row.type as FinancialCategory['type'],
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapRecurrenceRow(row: RecurrenceRow): RecurrenceRule {
  return {
    id: row.id,
    frequency: row.frequency as RecurrenceRule['frequency'],
    interval: row.recurrence_interval,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
  };
}
