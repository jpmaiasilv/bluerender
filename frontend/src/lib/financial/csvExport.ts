import { Messages } from '../../i18n/types';
import { centsToAmountString } from './money';
import { deriveStatus, FinancialCategory, FinancialTransaction } from './types';

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

interface CsvNameLookups {
  categoryName: (id: string) => string;
  clientName: (id: string | null) => string;
  projectName: (id: string | null) => string;
}

/** Real CSV export (not a placeholder) — one row per transaction, values
 * already resolved to their display form (translated status/payment method/
 * type, resolved category/client/project names) — never raw internal codes. */
export function transactionsToCsv(
  transactions: FinancialTransaction[],
  categories: FinancialCategory[],
  todayISO: string,
  messages: Messages,
  lookups: Pick<CsvNameLookups, 'clientName' | 'projectName'>
): string {
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? '';
  const header = [
    messages.financial.table.columns.date,
    messages.financial.csv.dueDate,
    messages.financial.table.columns.type,
    messages.financial.table.columns.client,
    messages.financial.table.columns.project,
    messages.financial.table.columns.category,
    messages.financial.table.columns.description,
    messages.financial.table.columns.value,
    messages.financial.table.columns.status,
    messages.financial.csv.paymentMethod,
  ];
  const rows = transactions.map((t) =>
    [
      t.transactionDate,
      t.dueDate ?? '',
      t.type === 'income' ? messages.financial.typeFilter.income : messages.financial.typeFilter.expense,
      lookups.clientName(t.clientId),
      lookups.projectName(t.projectId),
      categoryName(t.categoryId),
      t.description,
      centsToAmountString(t.amountCents),
      messages.financial.status[deriveStatus(t, todayISO)],
      t.paymentMethod ? messages.financial.paymentMethods[t.paymentMethod] : '',
    ]
      .map(csvCell)
      .join(',')
  );
  return [header.join(','), ...rows].join('\r\n');
}

export function downloadCsv(content: string, fileName: string): void {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
