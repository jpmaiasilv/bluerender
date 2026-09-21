import { PlantaHumanizadaSettings } from '../../types';
import { PlantaPromptField } from './PlantaPromptField';
import { useLanguage } from '../../i18n';

interface Props {
  settings: PlantaHumanizadaSettings;
  onSettingsChange: (settings: PlantaHumanizadaSettings) => void;
  /** Fixed cost of the OpenCV-mask + FLUX.1 Fill pipeline (see backend HUMANIZED_FLOORPLAN_WALLET_DEBIT_CREDITS) — there is no Fast/Pro/Ultra tier here, unlike the rest of Blue Render, so this is a plain number rather than an engine list. */
  costCredits: number;
  walletBalance: number;
  disabled: boolean;
  onGenerate: () => void;
  canGenerate: boolean;
  isGenerating: boolean;
}

/**
 * Deliberately minimal compared to every other tool's settings panel: the
 * new mask+Fill pipeline (see MaskReviewScreen.tsx) has no render-style or
 * quality-tier choice — geometry is preserved by the mask itself, not by a
 * whole-image style prompt — so the only input left here is the optional
 * custom prompt. Clicking Generate does not call the paid endpoint directly;
 * it hands off to the free mask preview + review screen first (see
 * PlantaHumanizadaPage's handleStartMaskReview).
 */
export function PlantaSettingsPanel({ settings, onSettingsChange, costCredits, walletBalance, disabled, onGenerate, canGenerate, isGenerating }: Props) {
  const { messages } = useLanguage();
  const t = messages.plantaHumanizada;
  const canAfford = walletBalance >= costCredits;
  const balanceAfter = Math.max(0, walletBalance - costCredits);

  function update<K extends keyof PlantaHumanizadaSettings>(key: K, value: PlantaHumanizadaSettings[K]) {
    onSettingsChange({ ...settings, [key]: value });
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto border-l border-border bg-surface px-5 py-6">
      <div className="flex flex-1 flex-col gap-5">
        <PlantaPromptField
          value={settings.customInstructions ?? ''}
          onChange={(v) => update('customInstructions', v)}
          disabled={disabled}
        />
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate || !canAfford}
          className="w-full rounded-xl bg-sapphire py-3.5 text-base font-semibold text-white shadow-glow transition hover:bg-sapphire-hover disabled:cursor-not-allowed disabled:bg-surface-secondary disabled:text-ink-muted disabled:shadow-none"
        >
          {isGenerating ? t.generating : `${t.generateButton} · ${messages.wallet.creditsSuffix(costCredits)}`}
        </button>
        {canAfford && !isGenerating && (
          <p className="mt-2 text-center text-xs text-ink-muted">
            {messages.wallet.balancePreview(walletBalance, balanceAfter)}
          </p>
        )}
        {!canAfford && (
          <p className="mt-2 text-center text-xs text-danger">
            {messages.wallet.insufficientMessage(costCredits, walletBalance)}
          </p>
        )}
      </div>
    </div>
  );
}
