import { Bot, Leaf, Sparkles, Star, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { IdeaEngineInfo, IdeaEngineTier } from '../../types';
import { useLanguage } from '../../i18n';
import { EngineDropdown } from '../EngineDropdown';

const TIER_ICON: Record<IdeaEngineTier, LucideIcon> = {
  fast: Zap,
  gpt_image: Bot,
  nano_banana_2: Leaf,
  pro: Star,
  ultra: Sparkles,
};

interface Props {
  engines: IdeaEngineInfo[];
  value: IdeaEngineTier;
  onChange: (engine: IdeaEngineTier) => void;
  disabled?: boolean;
}

export function IdeaEngineTierSelector({ engines, value, onChange, disabled }: Props) {
  const { messages } = useLanguage();
  const t = messages.ideaGenerator;

  return (
    <EngineDropdown
      engines={engines}
      value={value}
      onChange={onChange}
      disabled={disabled}
      title={t.engineLabel}
      names={t.engineTierNames}
      descriptions={t.engineTierDescriptions}
      icons={TIER_ICON}
    />
  );
}
