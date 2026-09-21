import { Modal } from '../Modal';
import { useLanguage } from '../../i18n';

interface Props {
  open: boolean;
  costCredits: number;
  walletBalance: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Shown before any generation that spends credits again (regenerate / repeat settings) — the user sees cost, balance and the balance after. */
export function ConfirmGenerationModal({ open, costCredits, walletBalance, onConfirm, onCancel }: Props) {
  const { messages } = useLanguage();
  const t = messages.plantaHumanizada.simpleFlow;
  const after = walletBalance - costCredits;
  const canAfford = after >= 0;

  return (
    <Modal open={open} onClose={onCancel} labelledBy="planta-confirm-title" panelClassName="w-full max-w-[440px]">
      <div className="p-6">
        <h3 id="planta-confirm-title" className="pr-8 text-base font-semibold text-ink">
          {t.confirmTitle}
        </h3>
        <p className="mt-3 text-sm text-ink-secondary">{canAfford ? t.confirmBody(costCredits, walletBalance, after) : messages.wallet.insufficientMessage(costCredits, walletBalance)}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-secondary">
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canAfford}
            className="rounded-lg bg-sapphire px-4 py-2 text-sm font-semibold text-white hover:bg-sapphire-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t.confirmAction}
          </button>
        </div>
      </div>
    </Modal>
  );
}
