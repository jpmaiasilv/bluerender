import { useEffect, useState } from 'react';
import { useLanguage } from '../../i18n';
import { useAuth } from '../../lib/auth/AuthProvider';
import { supabase } from '../../lib/supabase';

const LOCALE_DISPLAY_NAME: Record<string, string> = {
  pt: 'Português',
  en: 'English',
  es: 'Español',
};

/** Editable Nome/Telefone, backed for real by profiles.full_name/profiles.phone. Email always comes from Auth (read-only here). */
export function PersonalDataSection() {
  const { messages, locale } = useLanguage();
  const t = messages.settings;
  const { user, profile, refreshProfile } = useAuth();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFullName(profile?.fullName ?? '');
    setPhone(profile?.phone ?? '');
  }, [profile?.id, profile?.fullName, profile?.phone]);

  const inputClass =
    'w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-muted focus:border-sapphire focus:ring-1 focus:ring-sapphire';

  const dirty = fullName !== (profile?.fullName ?? '') || phone !== (profile?.phone ?? '');

  async function handleSave() {
    if (!supabase || !user) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), phone: phone.trim() || null })
      .eq('id', user.id);

    if (updateError) {
      setError(messages.auth.errors.unknown);
    } else {
      setSaved(true);
      await refreshProfile();
    }
    setSaving(false);
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      <h2 className="text-base font-semibold text-ink">{t.personalData.title}</h2>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">
          {t.personalData.fullName}
        </span>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">
          {t.personalData.phone}
        </span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t.personalData.phonePlaceholder}
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className="mb-1.5 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-ink-secondary">
          {t.personalData.language}
          <span className="normal-case text-ink-muted">{t.personalData.languageHint}</span>
        </span>
        <input value={LOCALE_DISPLAY_NAME[locale]} disabled className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-60`} />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">
          {t.personalData.email}
        </span>
        <input value={user?.email ?? ''} disabled className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-60`} />
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}
      {saved && <p className="text-sm text-success">{t.personalData.saveSuccess}</p>}

      <div className="mt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty || !fullName.trim()}
          className="rounded-lg bg-sapphire px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t.saveChanges}
        </button>
      </div>
    </div>
  );
}
