import { useLanguage } from '../../i18n';

interface Props {
  totalCost: number;
  imageCount: number;
  walletBalance: number;
  canAfford: boolean;
  isGenerating: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
  onOpenUpgrade: () => void;
}

/** Cost shown here always comes from the real engine config × image count returned by the backend — never a hardcoded number. */
export function CreditGenerationButton({
  totalCost,
  imageCount,
  walletBalance,
  canAfford,
  isGenerating,
  canGenerate,
  onGenerate,
  onOpenUpgrade,
}: Props) {
  const { messages } = useLanguage();
  const t = messages.textToImage;

  if (!canAfford) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-sm font-medium text-danger">{t.insufficientCredits}</span>
        <button
          type="button"
          onClick={onOpenUpgrade}
          className="rounded-xl bg-sapphire px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:bg-sapphire-hover"
        >
          {messages.upgrade.button}
        </button>
      </div>
    );
  }

  const balanceAfter = Math.max(0, walletBalance - totalCost);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate}
        className="rounded-xl bg-sapphire px-7 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-glow transition hover:bg-sapphire-hover disabled:cursor-not-allowed disabled:bg-surface-secondary disabled:text-ink-muted disabled:shadow-none"
      >
        {isGenerating ? t.generating : t.generateButton(imageCount, totalCost)}
      </button>
      {!isGenerating && <p className="text-xs text-ink-muted">{messages.wallet.balancePreview(walletBalance, balanceAfter)}</p>}
    </div>
  );
}
