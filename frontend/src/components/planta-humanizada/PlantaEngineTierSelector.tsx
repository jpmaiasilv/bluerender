import { Sparkles, Star, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PlantaEngineInfo, PlantaEngineTier } from '../../types';
import { useLanguage } from '../../i18n';

const TIER_ICON: Record<PlantaEngineTier, LucideIcon> = {
  fast: Zap,
  pro: Star,
  ultra: Sparkles,
};

interface Props {
  engines: PlantaEngineInfo[];
  value: PlantaEngineTier;
  onChange: (engine: PlantaEngineTier) => void;
  disabled?: boolean;
}

/** Same card visual as Imagem por Texto / Gerador de Ideias' quality selector — reused so every tool reads as one platform. */
export function PlantaEngineTierSelector({ engines, value, onChange, disabled }: Props) {
  const { messages } = useLanguage();
  const t = messages.plantaHumanizada;

  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.qualityLabel}</span>
      <div className="grid grid-cols-3 gap-2">
        {engines.map((engine) => {
          const isSelected = engine.id === value;
          const Icon = TIER_ICON[engine.id];
          return (
            <button
              key={engine.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(engine.id)}
              className={`relative flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition disabled:cursor-not-allowed disabled:opacity-60 ${
                isSelected ? 'border-sapphire bg-sapphire-light shadow-glow' : 'border-border bg-surface hover:border-sapphire/40'
              }`}
            >
              {engine.recommended && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-sapphire px-2 py-0.5 text-[10px] font-semibold text-white">
                  {messages.engines.recommended}
                </span>
              )}
              <Icon size={18} className={`mt-1.5 ${isSelected ? 'text-sapphire' : 'text-ink-muted'}`} />
              <span className={`text-sm font-medium ${isSelected ? 'text-sapphire' : 'text-ink'}`}>{t.engineTierNames[engine.id]}</span>
              <span className="text-xs text-ink-secondary">{messages.wallet.creditsSuffix(engine.credits)}</span>
              <span className="text-[10px] text-ink-muted">{t.engineTierDescriptions[engine.id]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
