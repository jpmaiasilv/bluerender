import { useLanguage, Locale } from '../i18n';

const LOCALE_OPTIONS: { code: Locale; label: string }[] = [
  { code: 'pt', label: 'Português' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
];

const LOCALE_CODE: Record<Locale, string> = { pt: 'PT', en: 'EN', es: 'ES' };

export function LanguageSelector() {
  const { locale, setLocale } = useLanguage();

  return (
    <div className="flex flex-col gap-0.5">
      {LOCALE_OPTIONS.map((opt) => (
        <button
          key={opt.code}
          type="button"
          onClick={() => setLocale(opt.code)}
          className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition ${
            locale === opt.code ? 'bg-sapphire-light text-sapphire font-medium' : 'text-ink-secondary hover:bg-surface-secondary'
          }`}
        >
          {opt.label}
          <span className="text-xs text-ink-muted">{LOCALE_CODE[opt.code]}</span>
        </button>
      ))}
    </div>
  );
}
