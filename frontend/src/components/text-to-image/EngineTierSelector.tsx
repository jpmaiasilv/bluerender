import { Bot, Leaf, Sparkles, Star, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { T2IEngineInfo, T2IEngineTier } from '../../types';
import { useLanguage } from '../../i18n';
import { EngineDropdown } from '../EngineDropdown';

const TIER_ICON: Record<T2IEngineTier, LucideIcon> = {
  fast: Zap,
  gpt_image: Bot,
  nano_banana_2: Leaf,
  pro: Star,
  ultra: Sparkles,
};

interface Props {
  engines: T2IEngineInfo[];
  value: T2IEngineTier;
  onChange: (engine: T2IEngineTier) => void;
  disabled?: boolean;
}

export function EngineTierSelector({ engines, value, onChange, disabled }: Props) {
  const { messages } = useLanguage();
  const t = messages.textToImage;

  return (
    <EngineDropdown
      engines={engines}
      value={value}
      onChange={onChange}
      disabled={disabled}
      title={t.qualityLabel}
      names={t.engineTierNames}
      descriptions={t.engineTierDescriptions}
      icons={TIER_ICON}
    />
  );
}
