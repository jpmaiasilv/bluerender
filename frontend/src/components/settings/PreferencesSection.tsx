import { LanguageSelector } from '../LanguageSelector';
import { useLanguage } from '../../i18n';

/**
 * Language is the one real, useful preference right now — reuses the exact same
 * LanguageSelector (and setLocale/localStorage mechanism) as the profile-menu
 * dropdown, so there's a single source of truth for the app's language. No dark
 * mode (the product is light-only by decision) and no other browser-permission
 * preferences with a real implementation yet.
 */
export function PreferencesSection() {
  const { messages } = useLanguage();
  const t = messages.settings;

  return (
    <div className="flex flex-col gap-5 p-6">
      <h2 className="text-base font-semibold text-ink">{t.preferences.title}</h2>

      <div className="max-w-xs">
        <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-ink-secondary">
          {t.preferences.languageLabel}
        </span>
        <div className="rounded-xl border border-border bg-surface p-2">
          <LanguageSelector />
        </div>
      </div>
    </div>
  );
}
