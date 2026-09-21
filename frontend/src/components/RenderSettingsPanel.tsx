import { EngineInfo, RenderSettings } from '../types';
import {
  ASPECT_RATIO_VALUES,
  ENVIRONMENT_VALUES,
  LED_VALUES,
  LIGHTING_VALUES,
  PROJECT_TYPE_VALUES,
  RENDER_STYLE_VALUES,
} from '../lib/options';
import { SelectField } from './SelectField';
import { PreserveArchitectureControl } from './PreserveArchitectureControl';
import { UploadDropzone } from './UploadDropzone';
import { CustomInstructionsField } from './CustomInstructionsField';
import { EngineSelector } from './EngineSelector';
import { AdvancedOptions } from './AdvancedOptions';
import { useLanguage } from '../i18n';

interface Props {
  settings: RenderSettings;
  onSettingsChange: (settings: RenderSettings) => void;
  referencePreviewUrl: string | null;
  onReferenceFileSelected: (file: File) => void;
  onClearReferenceFile: () => void;
  engines: EngineInfo[];
  walletBalance: number;
  disabled: boolean;
  onGenerate: () => void;
  canGenerate: boolean;
  isGenerating: boolean;
}

export function RenderSettingsPanel({
  settings,
  onSettingsChange,
  referencePreviewUrl,
  onReferenceFileSelected,
  onClearReferenceFile,
  engines,
  walletBalance,
  disabled,
  onGenerate,
  canGenerate,
  isGenerating,
}: Props) {
  const { messages } = useLanguage();
  const selectedEngine = engines.find((e) => e.id === settings.engine);
  const canAfford = !selectedEngine || walletBalance >= selectedEngine.credits;
  const balanceAfter = selectedEngine ? Math.max(0, walletBalance - selectedEngine.credits) : walletBalance;

  function update<K extends keyof RenderSettings>(key: K, value: RenderSettings[K]) {
    onSettingsChange({ ...settings, [key]: value });
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto border-l border-border bg-surface px-5 py-6">
      <div className="flex flex-1 flex-col gap-5">
        <EngineSelector engines={engines} value={settings.engine} onChange={(v) => update('engine', v)} disabled={disabled} />

        <SelectField
          label={messages.fields.projectType}
          value={settings.projectType}
          options={PROJECT_TYPE_VALUES.map((v) => ({ value: v, label: messages.fields.projectTypeOptions[v] }))}
          onChange={(v) => update('projectType', v as RenderSettings['projectType'])}
          disabled={disabled}
        />

        <SelectField
          label={messages.fields.renderStyle}
          value={settings.renderStyle}
          options={RENDER_STYLE_VALUES.map((v) => ({ value: v, label: messages.fields.renderStyles[v] }))}
          onChange={(v) => update('renderStyle', v as RenderSettings['renderStyle'])}
          disabled={disabled}
        />

        <AdvancedOptions title={messages.fields.advancedOptions}>
          <PreserveArchitectureControl
            value={settings.preserveArchitecture}
            onChange={(v) => update('preserveArchitecture', v)}
          />

          <SelectField
            label={messages.fields.lighting}
            value={settings.lighting}
            options={LIGHTING_VALUES.map((v) => ({ value: v, label: messages.fields.lightingOptions[v] }))}
            onChange={(v) => update('lighting', v as RenderSettings['lighting'])}
            disabled={disabled}
          />

          <SelectField
            label={messages.fields.environment}
            value={settings.environment}
            options={ENVIRONMENT_VALUES.map((v) => ({ value: v, label: messages.fields.environmentOptions[v] }))}
            onChange={(v) => update('environment', v as RenderSettings['environment'])}
            disabled={disabled}
          />

          <SelectField
            label={messages.fields.led}
            value={settings.led}
            options={LED_VALUES.map((v) => ({ value: v, label: messages.fields.ledOptions[v] }))}
            onChange={(v) => update('led', v as RenderSettings['led'])}
            disabled={disabled}
          />

          <SelectField
            label={messages.fields.aspectRatio}
            value={settings.aspectRatio}
            options={ASPECT_RATIO_VALUES.map((v) => ({ value: v, label: messages.fields.aspectRatioOptions[v] }))}
            onChange={(v) => update('aspectRatio', v as RenderSettings['aspectRatio'])}
            disabled={disabled}
          />

          <UploadDropzone
            label={messages.upload.referenceRender}
            hint={messages.upload.referenceRenderHint}
            dragDropText={messages.upload.referenceRenderDragDrop}
            previewUrl={referencePreviewUrl}
            onFileSelected={onReferenceFileSelected}
            onClear={onClearReferenceFile}
            disabled={disabled}
            compact
          />

          <CustomInstructionsField
            value={settings.customInstructions ?? ''}
            onChange={(v) => update('customInstructions', v)}
            disabled={disabled}
          />
        </AdvancedOptions>
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate || !canAfford}
          className="w-full rounded-xl bg-sapphire py-3.5 text-base font-semibold text-white shadow-glow transition hover:bg-sapphire-hover disabled:cursor-not-allowed disabled:bg-surface-secondary disabled:text-ink-muted disabled:shadow-none"
        >
          {isGenerating
            ? messages.generate.generating
            : `${messages.generate.button}${selectedEngine ? ` · ${messages.wallet.creditsSuffix(selectedEngine.credits)}` : ''}`}
        </button>
        {canAfford && selectedEngine && !isGenerating && (
          <p className="mt-2 text-center text-xs text-ink-muted">
            {messages.wallet.balancePreview(walletBalance, balanceAfter)}
          </p>
        )}
        {!canAfford && selectedEngine && (
          <p className="mt-2 text-center text-xs text-danger">
            {messages.wallet.insufficientMessage(selectedEngine.credits, walletBalance)}
          </p>
        )}
      </div>
    </div>
  );
}
