import { Modal } from '../Modal';
import { useLanguage } from '../../i18n';
import { formatMoneyCents } from '../../lib/financial/money';
import { FinancialTransaction } from '../../lib/financial/types';

interface Props {
  transaction: FinancialTransaction | null;
  onCancel: () => void;
  /** Deletes just this one record. */
  onConfirmSingle: () => void;
  /** Only called when `transaction.installmentGroupId` is set — deletes this and every later installment in its group. */
  onConfirmAllFuture: () => void;
}

export function ConfirmDeleteModal({ transaction, onCancel, onConfirmSingle, onConfirmAllFuture }: Props) {
  const { messages, locale } = useLanguage();
  const t = messages.financial.deleteConfirm;
  const isInstallment = Boolean(transaction?.installmentGroupId);

  return (
    <Modal open={transaction !== null} onClose={onCancel} labelledBy="delete-transaction-title" panelClassName="w-full max-w-[420px]">
      {transaction && (
        <div className="flex flex-col gap-4 px-6 py-6">
          <h2 id="delete-transaction-title" className="text-base font-semibold text-ink">
            {t.title}
          </h2>
          <p className="rounded-lg bg-surface-secondary px-3 py-2 text-sm text-ink-secondary">
            {t.message(transaction.description, formatMoneyCents(transaction.amountCents, locale))}
          </p>

          {isInstallment ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-ink-muted">{t.installmentPrompt}</p>
              <button
                type="button"
                onClick={onConfirmSingle}
                className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink transition hover:border-danger/40 hover:text-danger"
              >
                {t.installmentThisOnly}
              </button>
              <button
                type="button"
                onClick={onConfirmAllFuture}
                className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white transition hover:bg-danger/90"
              >
                {t.installmentAllFuture}
              </button>
              <button type="button" onClick={onCancel} className="text-sm font-medium text-ink-secondary hover:text-ink">
                {t.cancel}
              </button>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={onConfirmSingle}
                className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white transition hover:bg-danger/90"
              >
                {t.confirm}
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
