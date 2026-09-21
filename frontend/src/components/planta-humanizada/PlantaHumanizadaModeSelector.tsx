import { Check } from 'lucide-react';
import { HUMANIZED_FLOORPLAN_GENERATION_MODES, HumanizedFloorplanGenerationMode, HumanizedFloorplanModeConfig } from '../../types';
import { useLanguage } from '../../i18n';

interface Props {
  mode: HumanizedFloorplanGenerationMode;
  onChange: (mode: HumanizedFloorplanGenerationMode) => void;
  /** Price + availability from the backend. Null while loading: the cards render but their prices stay hidden (never guessed). */
  modes: Record<HumanizedFloorplanGenerationMode, HumanizedFloorplanModeConfig> | null;
  disabled: boolean;
}

/**
 * "Modo de geração": two selectable cards. Blue Render (fast, the default) and
 * Blue Render with GPT-6 Astra (higher precision). Selecting a card only
 * changes which mode is REQUESTED — the price shown is read from the backend
 * config and the server independently prices the request by mode.
 */
export function PlantaHumanizadaModeSelector({ mode, onChange, modes, disabled }: Props) {
  const { messages } = useLanguage();
  const t = messages.plantaHumanizada.simpleFlow;

  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.modeLabel}</span>
      <div className="mt-2 grid grid-cols-1 gap-2" role="radiogroup" aria-label={t.modeLabel}>
        {HUMANIZED_FLOORPLAN_GENERATION_MODES.map((m) => {
          const cfg = modes?.[m] ?? null;
          const unavailable = cfg !== null && !cfg.available;
          const selected = mode === m;
          const copy = t.modes[m];
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled || unavailable}
              onClick={() => onChange(m)}
              className={`relative flex flex-col gap-1.5 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed ${
                selected ? 'border-sapphire bg-sapphire/10 shadow-glow' : 'border-border bg-surface-secondary hover:border-sapphire/40'
              } ${unavailable ? 'opacity-60' : ''} ${disabled && !selected ? 'opacity-60' : ''}`}
            >
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 pr-6">
                <span className={`text-sm font-semibold ${selected ? 'text-sapphire' : 'text-ink'}`}>{copy.title}</span>
                {m === 'astra' && <span className="rounded-full bg-sapphire px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">{t.modes.astra.badge}</span>}
              </span>
              <span className="text-xs leading-snug text-ink-secondary">{copy.description}</span>
              <span className="text-xs font-semibold text-ink">{unavailable ? t.modes.astra.comingSoon : cfg ? copy.costLabel(cfg.cost) : ''}</span>
              {selected && (
                <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-sapphire text-white" aria-hidden="true">
                  <Check size={12} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
