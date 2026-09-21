import { Check } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { UpcomingDueItem } from '../../lib/financial/calculations';
import { formatMoneyCents } from '../../lib/financial/money';
import { FinancialTransaction } from '../../lib/financial/types';

interface Props {
  items: UpcomingDueItem[];
  categoryName: (id: string) => string;
  clientName: (id: string | null) => string;
  projectName: (id: string | null) => string;
  onMarkSettled: (tx: FinancialTransaction) => void;
}

export function UpcomingDueDates({ items, categoryName, clientName, projectName, onMarkSettled }: Props) {
  const { messages, locale } = useLanguage();
  const t = messages.financial.upcoming;

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <h3 className="mb-3 text-sm font-semibold text-ink">{t.title}</h3>
      {items.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-muted">{t.empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map(({ transaction, daysUntilDue }) => {
            const overdue = daysUntilDue < 0;
            const dueLabel = overdue ? t.dueOverdue : daysUntilDue === 0 ? t.dueToday : daysUntilDue === 1 ? t.dueTomorrow : t.dueInDays(daysUntilDue);
            const client = clientName(transaction.clientId);
            const project = projectName(transaction.projectId);
            return (
              <li key={transaction.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{transaction.description}</p>
                  <p className="truncate text-xs text-ink-muted">
                    {categoryName(transaction.categoryId)}
                    {(client || project) && ' · '}
                    {client}
                    {client && project && ' · '}
                    {project}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${transaction.type === 'income' ? 'text-success' : 'text-ink'}`}>
                      {formatMoneyCents(transaction.amountCents, locale)}
                    </p>
                    <p className={`text-xs ${overdue ? 'text-danger' : 'text-ink-muted'}`}>
                      {dueLabel} · {transaction.type === 'income' ? t.receivableLabel : t.payableLabel}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onMarkSettled(transaction)}
                    title={transaction.type === 'income' ? t.markReceived : t.markPaid}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-ink-muted transition hover:border-success/40 hover:bg-success/10 hover:text-success"
                  >
                    <Check size={13} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
