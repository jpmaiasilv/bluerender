import { EngineInfo, FreeformRenderSettings } from '../types';
import { ASPECT_RATIO_VALUES } from '../lib/options';
import { SelectField } from './SelectField';
import { EngineSelector } from './EngineSelector';
import { useLanguage } from '../i18n';

interface Props {
  settings: FreeformRenderSettings;
  onSettingsChange: (settings: FreeformRenderSettings) => void;
  engines: EngineInfo[];
  walletBalance: number;
  disabled: boolean;
  onGenerate: () => void;
  canGenerate: boolean;
  isGenerating: boolean;
}

/** "Edição Livre com IA" — a prompt, an engine and an aspect ratio. No hidden architectural-preservation instructions: the prompt is sent to the provider verbatim, so it can genuinely add, remove or replace elements when asked. */
export function FreeformRenderPanel({
  settings,
  onSettingsChange,
  engines,
  walletBalance,
  disabled,
  onGenerate,
  canGenerate,
  isGenerating,
}: Props) {
  const { messages } = useLanguage();
  const t = messages.renderFreeform;
  const selectedEngine = engines.find((e) => e.id === settings.engine);
  const canAfford = !selectedEngine || walletBalance >= selectedEngine.credits;
  const balanceAfter = selectedEngine ? Math.max(0, walletBalance - selectedEngine.credits) : walletBalance;

  function update<K extends keyof FreeformRenderSettings>(key: K, value: FreeformRenderSettings[K]) {
    onSettingsChange({ ...settings, [key]: value });
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto border-l border-border bg-surface px-5 py-6">
      <div className="flex flex-1 flex-col gap-5">
        <EngineSelector engines={engines} value={settings.engine} onChange={(v) => update('engine', v)} disabled={disabled} />

        <div>
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.promptLabel}</span>
          <textarea
            value={settings.prompt}
            onChange={(e) => update('prompt', e.target.value)}
            disabled={disabled}
            placeholder={t.promptPlaceholder}
            rows={6}
            maxLength={2000}
            className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire disabled:cursor-not-allowed disabled:opacity-50"
          />
          <p className="mt-1.5 text-xs text-ink-muted">{t.helper}</p>
        </div>

        <SelectField
          label={messages.fields.aspectRatio}
          value={settings.aspectRatio}
          options={ASPECT_RATIO_VALUES.map((v) => ({ value: v, label: messages.fields.aspectRatioOptions[v] }))}
          onChange={(v) => update('aspectRatio', v as FreeformRenderSettings['aspectRatio'])}
          disabled={disabled}
        />
      </div>

      <div className="mt-5 flex flex-col gap-2">
        {selectedEngine && (
          <>
            {!canAfford && <p className="text-xs text-danger">{messages.wallet.insufficientMessage(selectedEngine.credits, walletBalance)}</p>}
            <p className="text-center text-xs text-ink-muted">{messages.wallet.balancePreview(walletBalance, balanceAfter)}</p>
          </>
        )}
        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate || !canAfford}
          className="w-full rounded-lg bg-sapphire px-4 py-3 text-sm font-semibold text-white transition hover:bg-sapphire-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isGenerating ? messages.generate.generating : `${messages.generate.button}${selectedEngine ? ` · ${messages.wallet.creditsSuffix(selectedEngine.credits)}` : ''}`}
        </button>
      </div>
    </div>
  );
}
