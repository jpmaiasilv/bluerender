import {
  ENVIRONMENT_VALUES,
  IDEA_ATMOSPHERE_VALUES,
  IDEA_CAMERA_VALUES_NO_IMAGE,
  IDEA_LIGHTING_VALUES,
  IDEA_MATERIAL_VALUES,
  LED_VALUES,
} from '../../lib/options';
import { IdeaGeneratorSettings } from '../../types';
import { AdvancedOptions } from '../AdvancedOptions';
import { SelectField } from '../SelectField';
import { useLanguage } from '../../i18n';

interface Props {
  settings: IdeaGeneratorSettings;
  onSettingsChange: (settings: IdeaGeneratorSettings) => void;
  hasReferenceImage: boolean;
  disabled?: boolean;
}

/**
 * Camera behaves differently with vs. without a reference image: with one, the
 * camera is always preserved (no dropdown, just a note — section 37); without
 * one, the full set of framing options applies.
 */
export function IdeaAdvancedOptions({ settings, onSettingsChange, hasReferenceImage, disabled }: Props) {
  const { messages } = useLanguage();
  const t = messages.ideaGenerator;

  function update<K extends keyof IdeaGeneratorSettings>(key: K, value: IdeaGeneratorSettings[K]) {
    onSettingsChange({ ...settings, [key]: value });
  }

  return (
    <AdvancedOptions title={messages.fields.advancedOptions}>
      <SelectField
        label={t.lightingLabel}
        value={settings.lighting}
        options={IDEA_LIGHTING_VALUES.map((v) => ({ value: v, label: t.lightingOptions[v] }))}
        onChange={(v) => update('lighting', v as IdeaGeneratorSettings['lighting'])}
        disabled={disabled}
      />

      {/* Same values/options as Render IA's "Ambiente" (messages.fields.environmentOptions) — but this tool's own
          `environment` field (space type) already uses the "Ambiente" label, so this needs a distinct label
          (t.surroundingsLabel = "Entorno") to avoid two differently-scoped controls sharing one name on screen. */}
      <SelectField
        label={t.surroundingsLabel}
        value={settings.surroundings}
        options={ENVIRONMENT_VALUES.map((v) => ({ value: v, label: messages.fields.environmentOptions[v] }))}
        onChange={(v) => update('surroundings', v as IdeaGeneratorSettings['surroundings'])}
        disabled={disabled}
      />

      <SelectField
        label={messages.fields.led}
        value={settings.led}
        options={LED_VALUES.map((v) => ({ value: v, label: messages.fields.ledOptions[v] }))}
        onChange={(v) => update('led', v as IdeaGeneratorSettings['led'])}
        disabled={disabled}
      />

      {hasReferenceImage ? (
        <div>
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.cameraLabel}</span>
          <p className="text-xs text-ink-muted">{t.cameraPreserveNote}</p>
        </div>
      ) : (
        <SelectField
          label={t.cameraLabel}
          value={settings.camera}
          options={IDEA_CAMERA_VALUES_NO_IMAGE.map((v) => ({ value: v, label: t.cameraOptions[v] }))}
          onChange={(v) => update('camera', v as IdeaGeneratorSettings['camera'])}
          disabled={disabled}
        />
      )}

      <SelectField
        label={t.atmosphereLabel}
        value={settings.atmosphere}
        options={IDEA_ATMOSPHERE_VALUES.map((v) => ({ value: v, label: t.atmosphereOptions[v] }))}
        onChange={(v) => update('atmosphere', v as IdeaGeneratorSettings['atmosphere'])}
        disabled={disabled}
      />

      <SelectField
        label={t.materialsLabel}
        value={settings.materials}
        options={IDEA_MATERIAL_VALUES.map((v) => ({ value: v, label: t.materialOptions[v] }))}
        onChange={(v) => update('materials', v as IdeaGeneratorSettings['materials'])}
        disabled={disabled}
      />

      <div>
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.creativityLabel}</span>
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
              {t.creativityLevels[level]}
            </button>
          ))}
        </div>
      </div>
    </AdvancedOptions>
  );
}
