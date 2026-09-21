import { Plus } from 'lucide-react';
import { CreditBalance } from './CreditBalance';
import { UpgradeButton } from './UpgradeButton';
import { ProfileMenu } from './ProfileMenu';
import { useLanguage } from '../i18n';

interface Props {
  balance: number;
  onAddTestCredits: () => void;
  addingCredits: boolean;
  onOpenUpgrade: () => void;
}

export function Header({ balance, onAddTestCredits, addingCredits, onOpenUpgrade }: Props) {
  const { messages } = useLanguage();

  return (
    <header className="flex h-16 shrink-0 items-center justify-end gap-3 border-b border-border bg-surface px-6">
      <div className="flex items-center gap-1.5">
        <CreditBalance balance={balance} onOpenUpgrade={onOpenUpgrade} />
        <button
          type="button"
          onClick={onAddTestCredits}
          disabled={addingCredits}
          title={messages.wallet.addTestCredits}
          className="flex items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-1 text-[10px] font-semibold text-ink-muted transition hover:border-sapphire hover:text-sapphire disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus size={12} />
          {messages.wallet.devBadge}
        </button>
      </div>

      <UpgradeButton onClick={onOpenUpgrade} />

      <ProfileMenu />
    </header>
  );
}
