import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { UploadDropzone } from '../UploadDropzone';
import { PlantaHumanizadaModeSelector } from './PlantaHumanizadaModeSelector';
import {
  HUMANIZED_FLOORPLAN_FURNITURE_LEVELS,
  HUMANIZED_FLOORPLAN_LIGHTING_OPTIONS,
  HUMANIZED_FLOORPLAN_OUTPUT_FORMATS,
  HUMANIZED_FLOORPLAN_SIMPLE_STYLES,
  HUMANIZED_FLOORPLAN_SURROUNDINGS_KINDS,
  HUMANIZED_FLOORPLAN_SURROUNDINGS_OPTIONS,
  HUMANIZED_FLOORPLAN_TEXT_MODES,
  HumanizedFloorplanGenerationMode,
  HumanizedFloorplanModeConfig,
  HumanizedFloorplanSimpleSettings,
} from '../../types';
import { useLanguage } from '../../i18n';

interface Props {
  mode: HumanizedFloorplanGenerationMode;
  onModeChange: (mode: HumanizedFloorplanGenerationMode) => void;
  /** Backend price/availability per mode (null while loading). */
  modes: Record<HumanizedFloorplanGenerationMode, HumanizedFloorplanModeConfig> | null;
  settings: HumanizedFloorplanSimpleSettings;
  onChange: (patch: Partial<HumanizedFloorplanSimpleSettings>) => void;
  referencePreviewUrl: string | null;
  onReferenceSelected: (file: File) => void;
  onReferenceClear: () => void;
  maxFileSizeBytes: number | null;
  costCredits: number | null;
  walletBalance: number;
  disabled: boolean;
  canGenerate: boolean;
  isGenerating: boolean;
  onGenerate: () => void;
}

const SECTION_LABEL = 'text-xs font-medium uppercase tracking-wide text-ink-secondary';

function Pills<T extends string>({
  options,
  value,
  labels,
  onSelect,
  disabled,
  columns = 2,
}: {
  options: readonly T[];
  value: T;
  labels: Record<T, string>;
  onSelect: (v: T) => void;
  disabled: boolean;
  columns?: 2 | 3 | 4;
}) {
  const cols = columns === 4 ? 'grid-cols-2 sm:grid-cols-4' : columns === 3 ? 'grid-cols-3' : 'grid-cols-2';
  return (
    <div className={`mt-2 grid gap-2 ${cols}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          disabled={disabled}
          onClick={() => onSelect(o)}
          className={`min-w-0 break-words rounded-lg border px-2 py-2 text-[13px] font-medium leading-tight transition sm:px-2.5 sm:text-sm disabled:cursor-not-allowed disabled:opacity-60 ${
            value === o ? 'border-sapphire bg-sapphire/10 text-sapphire' : 'border-border bg-surface-secondary text-ink-secondary hover:text-ink'
          }`}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

/**
 * Planta Humanizada's settings column. Order follows the spec: style,
 * lighting, surroundings, style reference, additional instructions,
 * (collapsible) advanced settings, then cost + generate. Nothing here can
 * change the architecture — every option only affects style/light/context.
 */
export function PlantaHumanizadaSimpleSettingsPanel({
  mode,
  onModeChange,
  modes,
  settings,
  onChange,
  referencePreviewUrl,
  onReferenceSelected,
  onReferenceClear,
  maxFileSizeBytes,
  costCredits,
  walletBalance,
  disabled,
  canGenerate,
  isGenerating,
  onGenerate,
}: Props) {
  const { messages } = useLanguage();
  const t = messages.plantaHumanizada.simpleFlow;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const canAfford = costCredits === null || walletBalance >= costCredits;
  const balanceAfter = costCredits === null ? null : walletBalance - costCredits;

  return (
    <div className="flex flex-col gap-5 border-border bg-surface p-4 sm:p-5 lg:border-l">
      <PlantaHumanizadaModeSelector mode={mode} onChange={onModeChange} modes={modes} disabled={disabled} />

      <div>
        <span className={SECTION_LABEL}>{t.styleLabel}</span>
        <Pills options={HUMANIZED_FLOORPLAN_SIMPLE_STYLES} value={settings.style} labels={t.styles} onSelect={(style) => onChange({ style })} disabled={disabled} />
      </div>

      <div>
        <span className={SECTION_LABEL}>{t.lightingLabel}</span>
        <Pills options={HUMANIZED_FLOORPLAN_LIGHTING_OPTIONS} value={settings.lighting} labels={t.lighting} onSelect={(lighting) => onChange({ lighting })} disabled={disabled} />
      </div>

      <div>
        <span className={SECTION_LABEL}>{t.surroundingsLabel}</span>
        <Pills
          options={HUMANIZED_FLOORPLAN_SURROUNDINGS_OPTIONS}
          value={settings.surroundings}
          labels={t.surroundings}
          onSelect={(surroundings) => onChange({ surroundings })}
          disabled={disabled}
          columns={3}
        />
        {settings.surroundings === 'with' && (
          <div className="mt-3">
            <span className="text-xs text-ink-muted">{t.surroundingsKindLabel}</span>
            <Pills
              options={HUMANIZED_FLOORPLAN_SURROUNDINGS_KINDS}
              value={settings.surroundingsKind}
              labels={t.surroundingsKinds}
              onSelect={(surroundingsKind) => onChange({ surroundingsKind })}
              disabled={disabled}
            />
            {settings.surroundingsKind === 'custom' && (
              <input
                type="text"
                value={settings.customSurroundings}
                onChange={(e) => onChange({ customSurroundings: e.target.value })}
                disabled={disabled}
                maxLength={200}
                placeholder={t.customSurroundingsPlaceholder}
                className="mt-2 w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-ink placeholder:text-ink-muted disabled:cursor-not-allowed disabled:opacity-60"
              />
            )}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2">
          <span className={SECTION_LABEL}>{t.referenceLabel}</span>
          <span className="rounded-full bg-sapphire/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sapphire">{t.referenceBadge}</span>
        </div>
        <UploadDropzone
          compact
          hideLabel
          label={t.referenceLabel}
          hint={t.referenceHint}
          dragDropText={t.referenceDragDrop}
          previewUrl={referencePreviewUrl}
          onFileSelected={onReferenceSelected}
          onClear={onReferenceClear}
          disabled={disabled}
          maxSizeBytes={maxFileSizeBytes ?? undefined}
          fileTooLargeText={maxFileSizeBytes ? t.fileTooLarge(Math.floor(maxFileSizeBytes / (1024 * 1024))) : undefined}
          replaceLabel={t.replaceFile}
        />
      </div>

      <div>
        <label htmlFor="planta-simple-instructions" className={SECTION_LABEL}>
          {t.instructionsLabel}
        </label>
        <textarea
          id="planta-simple-instructions"
          value={settings.customInstructions}
          onChange={(e) => onChange({ customInstructions: e.target.value })}
          disabled={disabled}
          maxLength={2000}
          placeholder={t.instructionsPlaceholder}
          rows={3}
          className="mt-2 w-full resize-none rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-ink placeholder:text-ink-muted disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      <div className="rounded-xl border border-border">
        <button
          type="button"
          onClick={() => setAdvancedOpen((o) => !o)}
          aria-expanded={advancedOpen}
          className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium text-ink"
        >
          {t.advancedLabel}
          <ChevronDown size={16} className={`text-ink-muted transition ${advancedOpen ? 'rotate-180' : ''}`} />
        </button>
        {advancedOpen && (
          <div className="flex flex-col gap-4 border-t border-border p-3">
            <div>
              <span className="text-xs text-ink-muted">{t.textModeLabel}</span>
              <Pills options={HUMANIZED_FLOORPLAN_TEXT_MODES} value={settings.textMode} labels={t.textModes} onSelect={(textMode) => onChange({ textMode })} disabled={disabled} columns={3} />
            </div>
            <div>
              <span className="text-xs text-ink-muted">{t.furnitureLabel}</span>
              <Pills
                options={HUMANIZED_FLOORPLAN_FURNITURE_LEVELS}
                value={settings.furnitureLevel}
                labels={t.furnitureLevels}
                onSelect={(furnitureLevel) => onChange({ furnitureLevel })}
                disabled={disabled}
                columns={3}
              />
            </div>
            <div>
              <span className="text-xs text-ink-muted">{t.outputFormatLabel}</span>
              <Pills
                options={HUMANIZED_FLOORPLAN_OUTPUT_FORMATS}
                value={settings.outputFormat}
                labels={t.outputFormats}
                onSelect={(outputFormat) => onChange({ outputFormat })}
                disabled={disabled}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-xs text-ink-muted">{costCredits !== null ? (mode === 'astra' ? t.astraCostNotice(costCredits) : t.costNotice(costCredits)) : t.costLoading}</p>
        {costCredits !== null && balanceAfter !== null && balanceAfter >= 0 && <p className="text-xs text-ink-muted">{t.balanceNotice(walletBalance, balanceAfter)}</p>}
        {!canAfford && costCredits !== null && <p className="text-xs text-danger">{messages.wallet.insufficientMessage(costCredits, walletBalance)}</p>}
        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate}
          className="w-full rounded-xl bg-sapphire py-3 text-sm font-semibold text-white shadow-glow transition hover:bg-sapphire-hover disabled:cursor-not-allowed disabled:bg-surface-secondary disabled:text-ink-muted disabled:shadow-none"
        >
          {isGenerating ? t.generating : costCredits !== null ? (mode === 'astra' ? t.astraGenerateButton(costCredits) : t.generateButton(costCredits)) : t.generateButtonLoading}
        </button>
      </div>
    </div>
  );
}
