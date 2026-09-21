import { Zap } from 'lucide-react';
import { useLanguage } from '../i18n';

interface Props {
  onClick: () => void;
}

/** Opens the compact upgrade modal — no checkout is wired up there yet, by design. */
export function UpgradeButton({ onClick }: Props) {
  const { messages } = useLanguage();

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg bg-sapphire px-3.5 py-1.5 text-sm font-semibold text-white shadow-glow transition hover:bg-sapphire-hover"
    >
      <Zap size={15} fill="currentColor" />
      {messages.upgrade.button}
    </button>
  );
}
