import { useEffect, useRef, useState } from 'react';
import { Check, Copy, MoreHorizontal, Paperclip, Pencil, Trash2 } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { formatMoneyCents } from '../../lib/financial/money';
import { deriveStatus, FinancialTransaction } from '../../lib/financial/types';
import { todayISO } from '../../lib/financial/dates';

interface Props {
  transactions: FinancialTransaction[];
  categoryName: (id: string) => string;
  clientName: (id: string | null) => string;
  projectName: (id: string | null) => string;
  onEdit: (tx: FinancialTransaction) => void;
  onDuplicate: (tx: FinancialTransaction) => void;
  onDelete: (tx: FinancialTransaction) => void;
  onToggleSettled: (tx: FinancialTransaction) => void;
}

function StatusBadge({ status, onClick, actionLabel }: { status: ReturnType<typeof deriveStatus>; onClick?: () => void; actionLabel?: string }) {
  const { messages } = useLanguage();
  const tone =
    status === 'received' || status === 'paid'
      ? 'bg-success/10 text-success'
      : status === 'overdue'
        ? 'bg-danger/10 text-danger'
        : 'bg-sapphire-light text-sapphire';

  const label = messages.financial.status[status];

  if (!onClick) {
    return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{label}</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={actionLabel}
      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition hover:ring-1 hover:ring-sapphire/40 ${tone}`}
    >
      {label}
    </button>
  );
}

interface RowMenuProps {
  tx: FinancialTransaction;
  onEdit: (tx: FinancialTransaction) => void;
  onDuplicate: (tx: FinancialTransaction) => void;
  onDelete: (tx: FinancialTransaction) => void;
  onToggleSettled: (tx: FinancialTransaction) => void;
}

function RowMenu({ tx, onEdit, onDuplicate, onDelete, onToggleSettled }: RowMenuProps) {
  const { messages } = useLanguage();
  const t = messages.financial.table.actions;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition hover:bg-surface-secondary hover:text-ink"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 w-44 rounded-lg border border-border bg-surface py-1 shadow-lg">
          {!tx.settled && (
            <button
              type="button"
              onClick={() => {
                onToggleSettled(tx);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-sapphire-soft hover:text-sapphire"
            >
              <Check size={13} />
              {tx.type === 'income' ? t.markReceived : t.markPaid}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onEdit(tx);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-sapphire-soft hover:text-sapphire"
          >
            <Pencil size={13} />
            {t.edit}
          </button>
          <button
            type="button"
            onClick={() => {
              onDuplicate(tx);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-sapphire-soft hover:text-sapphire"
          >
            <Copy size={13} />
            {t.duplicate}
          </button>
          <button
            type="button"
            onClick={() => {
              onDelete(tx);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-danger hover:bg-danger/10"
          >
            <Trash2 size={13} />
            {t.delete}
          </button>
        </div>
      )}
    </div>
  );
}

export function TransactionsTable({ transactions, categoryName, clientName, projectName, onEdit, onDuplicate, onDelete, onToggleSettled }: Props) {
  const { messages, locale } = useLanguage();
  const t = messages.financial.table;
  const today = todayISO();

  if (transactions.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-muted">{t.empty}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
            <th className="py-2 pr-3">{t.columns.date}</th>
            <th className="py-2 pr-3">{t.columns.description}</th>
            <th className="py-2 pr-3">{t.columns.client}</th>
            <th className="py-2 pr-3">{t.columns.project}</th>
            <th className="py-2 pr-3">{t.columns.category}</th>
            <th className="py-2 pr-3">{t.columns.type}</th>
            <th className="py-2 pr-3 text-right">{t.columns.value}</th>
            <th className="py-2 pr-3">{t.columns.status}</th>
            <th className="py-2 pl-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {transactions.map((tx) => {
            const status = deriveStatus(tx, today);
            return (
              <tr key={tx.id} className="text-ink">
                <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-ink-secondary">{formatDateBR(tx.transactionDate)}</td>
                <td className="max-w-[220px] truncate py-2.5 pr-3">
                  <span className="flex items-center gap-1.5">
                    {tx.description}
                    {tx.installmentTotal && (
                      <span className="shrink-0 rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                        {tx.installmentNumber}/{tx.installmentTotal}
                      </span>
                    )}
                    {tx.attachmentFileId && <Paperclip size={11} className="shrink-0 text-ink-muted" />}
                  </span>
                </td>
                <td className="max-w-[140px] truncate py-2.5 pr-3 text-xs text-ink-secondary">{clientName(tx.clientId) || '—'}</td>
                <td className="max-w-[140px] truncate py-2.5 pr-3 text-xs text-ink-secondary">{projectName(tx.projectId) || '—'}</td>
                <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-ink-secondary">{categoryName(tx.categoryId)}</td>
                <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-ink-secondary">
                  {tx.type === 'income' ? messages.financial.typeFilter.income : messages.financial.typeFilter.expense}
                </td>
                <td className={`whitespace-nowrap py-2.5 pr-3 text-right font-medium ${tx.type === 'income' ? 'text-success' : 'text-ink'}`}>
                  {tx.type === 'expense' ? '-' : ''}
                  {formatMoneyCents(tx.amountCents, locale)}
                </td>
                <td className="whitespace-nowrap py-2.5 pr-3">
                  <StatusBadge
                    status={status}
                    onClick={!tx.settled ? () => onToggleSettled(tx) : undefined}
                    actionLabel={tx.type === 'income' ? t.actions.markReceived : t.actions.markPaid}
                  />
                </td>
                <td className="py-2.5 pl-3">
                  <RowMenu tx={tx} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} onToggleSettled={onToggleSettled} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatDateBR(dateISO: string): string {
  const [y, m, d] = dateISO.split('-');
  return `${d}/${m}/${y}`;
}
