import { Bot, Leaf, Sparkles, Star, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { EngineInfo, EngineTier } from '../types';
import { useLanguage } from '../i18n';
import { EngineDropdown } from './EngineDropdown';

const TIER_ICON: Record<EngineTier, LucideIcon> = {
  fast: Zap,
  gpt_image: Bot,
  nano_banana_2: Leaf,
  standard: Star,
  pro: Sparkles,
};

interface Props {
  engines: EngineInfo[];
  value: EngineTier;
  onChange: (engine: EngineTier) => void;
  disabled?: boolean;
}

export function EngineSelector({ engines, value, onChange, disabled }: Props) {
  const { messages } = useLanguage();

  return (
    <EngineDropdown
      engines={engines}
      value={value}
      onChange={onChange}
      disabled={disabled}
      title={messages.engines.title}
      names={messages.engines.tierNames}
      descriptions={messages.engines.tierDescriptions}
      icons={TIER_ICON}
    />
  );
}
