import { UserRound } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { useAuth } from '../../lib/auth/AuthProvider';

const LOCALE_DISPLAY_NAME: Record<string, string> = {
  pt: 'Português',
  en: 'English',
  es: 'Español',
};

export function ProfileSection() {
  const { messages, locale } = useLanguage();
  const t = messages.settings;
  const { user, profile } = useAuth();

  const rows: [string, string][] = [
    [t.profile.name, profile?.fullName || t.notAvailable],
    [t.profile.email, user?.email ?? t.notAvailable],
    [t.profile.phone, profile?.phone || t.notAvailable],
    [t.profile.language, LOCALE_DISPLAY_NAME[locale]],
    [t.profile.currentPlan, t.billing.noActiveSubscription],
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="text-base font-semibold text-ink">{t.profile.title}</h2>

      <div className="flex items-center gap-4 rounded-xl border border-border bg-surface-secondary p-5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-ink-muted">
          <UserRound size={24} />
        </div>
        <div>
          <p className="text-sm font-medium text-ink">{profile?.fullName || t.notAvailable}</p>
          <p className="text-xs text-ink-secondary">{user?.email}</p>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t.profile.accountInfo}</h3>
        <dl className="divide-y divide-border rounded-xl border border-border">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between px-4 py-3 text-sm">
              <dt className="text-ink-secondary">{label}</dt>
              <dd className="font-medium text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
