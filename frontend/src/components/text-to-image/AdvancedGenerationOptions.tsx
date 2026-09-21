import { useState } from 'react';
import { Plus } from 'lucide-react';
import { ENVIRONMENT_VALUES, LED_VALUES, T2I_LIGHTING_VALUES, T2I_PROJECT_TYPE_VALUES } from '../../lib/options';
import { TextToImageSettings } from '../../types';
import { AdvancedOptions } from '../AdvancedOptions';
import { SelectField } from '../SelectField';
import { UploadDropzone } from '../UploadDropzone';
import { useLanguage } from '../../i18n';

interface Props {
  settings: TextToImageSettings;
  onSettingsChange: (settings: TextToImageSettings) => void;
  referencePreviewUrl: string | null;
  onReferenceFileSelected: (file: File) => void;
  onClearReferenceFile: () => void;
  disabled?: boolean;
}

/**
 * Creativity is prompt-only steering (see lib/textToImagePromptBuilder.ts on the
 * backend) — BFL has no equivalent API parameter, so it's never sent as a raw
 * value, only folded into the built prompt. Seed and negative prompt are
 * intentionally absent: BFL doesn't support the latter, and the former isn't
 * exposed in this v1.
 */
export function AdvancedGenerationOptions({
  settings,
  onSettingsChange,
  referencePreviewUrl,
  onReferenceFileSelected,
  onClearReferenceFile,
  disabled,
}: Props) {
  const { messages } = useLanguage();
  const [referenceExpanded, setReferenceExpanded] = useState(false);
  const showReferenceUpload = referenceExpanded || Boolean(referencePreviewUrl);

  function update<K extends keyof TextToImageSettings>(key: K, value: TextToImageSettings[K]) {
    onSettingsChange({ ...settings, [key]: value });
  }

  return (
    <AdvancedOptions title={messages.fields.advancedOptions}>
      <SelectField
        label={messages.textToImage.projectTypeLabel}
        value={settings.projectType}
        options={T2I_PROJECT_TYPE_VALUES.map((v) => ({ value: v, label: messages.textToImage.projectTypes[v] }))}
        onChange={(v) => update('projectType', v as TextToImageSettings['projectType'])}
        disabled={disabled}
      />

      <SelectField
        label={messages.textToImage.lightingLabel}
        value={settings.lighting}
        options={T2I_LIGHTING_VALUES.map((v) => ({ value: v, label: messages.textToImage.lightingOptions[v] }))}
        onChange={(v) => update('lighting', v as TextToImageSettings['lighting'])}
        disabled={disabled}
      />

      {/* Same field/labels as Render IA's Advanced Options (messages.fields) — standardized across every tool. */}
      <SelectField
        label={messages.fields.environment}
        value={settings.environment}
        options={ENVIRONMENT_VALUES.map((v) => ({ value: v, label: messages.fields.environmentOptions[v] }))}
        onChange={(v) => update('environment', v as TextToImageSettings['environment'])}
        disabled={disabled}
      />

      <SelectField
        label={messages.fields.led}
        value={settings.led}
        options={LED_VALUES.map((v) => ({ value: v, label: messages.fields.ledOptions[v] }))}
        onChange={(v) => update('led', v as TextToImageSettings['led'])}
        disabled={disabled}
      />

      <div>
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">
          {messages.textToImage.creativityLabel}
        </span>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface-secondary p-1">
          {(['baixa', 'equilibrada', 'alta'] as const).map((level) => (
            <button
              key={level}
              type="button"
              disabled={disabled}
              onClick={() => update('creativity', level)}
              className={`rounded-md py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                settings.creativity === level ? 'bg-surface text-sapphire shadow-card' : 'text-ink-secondary hover:text-ink'
              }`}
            >
              {messages.textToImage.creativityLevels[level]}
            </button>
          ))}
        </div>
      </div>

      {showReferenceUpload ? (
        <UploadDropzone
          label={messages.textToImage.reference.label}
          hint={messages.textToImage.reference.hint}
          dragDropText={messages.textToImage.reference.dragDrop}
          previewUrl={referencePreviewUrl}
          onFileSelected={onReferenceFileSelected}
          onClear={onClearReferenceFile}
          disabled={disabled}
          compact
        />
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setReferenceExpanded(true)}
          className="flex items-center gap-1.5 self-start rounded-lg border border-dashed border-border px-3 py-2 text-xs font-medium text-ink-secondary transition duration-150 hover:border-sapphire/40 hover:bg-sapphire-soft hover:text-sapphire disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus size={14} />
          {messages.textToImage.reference.label}
        </button>
      )}
    </AdvancedOptions>
  );
}
