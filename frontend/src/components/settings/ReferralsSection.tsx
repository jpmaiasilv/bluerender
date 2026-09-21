import { Gift, UserPlus, Users } from 'lucide-react';
import { useLanguage } from '../../i18n';

export function ReferralsSection() {
  const { messages } = useLanguage();
  const t = messages.settings;

  return (
    <div className="flex flex-col gap-4 p-6">
      <h2 className="text-base font-semibold text-ink">{t.referrals.title}</h2>

      <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-surface-secondary px-6 py-10 text-center">
        <div className="flex items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface text-ink-muted">
            <Users size={20} />
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sapphire-light text-sapphire">
            <Gift size={20} />
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface text-ink-muted">
            <UserPlus size={20} />
          </div>
        </div>

        <span className="rounded-full bg-sapphire-light px-3 py-1 text-xs font-semibold text-sapphire">
          {t.comingSoonBadge}
        </span>

        <div>
          <p className="font-semibold text-ink">{t.referrals.cardTitle}</p>
          <p className="mt-1 max-w-sm text-sm text-ink-secondary">{t.referrals.cardBody}</p>
        </div>
      </div>
    </div>
  );
}
