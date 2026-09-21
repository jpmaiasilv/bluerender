import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { useAuth } from '../../lib/auth/AuthProvider';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../i18n';

/**
 * Renames the current Escritório (organizations.name). Only owner/admin can
 * save — enforced for real by the organizations_update_admin RLS policy;
 * the disabled input here is just the matching UX, not the security boundary.
 */
export function OfficeSection() {
  const { messages } = useLanguage();
  const t = messages.settings.office;
  const { currentOrganization, currentOrganizationRole, refreshOrganizations } = useAuth();

  const [name, setName] = useState(currentOrganization?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(currentOrganization?.name ?? '');
  }, [currentOrganization?.id, currentOrganization?.name]);

  const canEdit = currentOrganizationRole === 'owner' || currentOrganizationRole === 'admin';

  async function handleSave() {
    if (!supabase || !currentOrganization) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    setSaving(true);
    setError(null);
    setSaved(false);
    const { error: updateError } = await supabase
      .from('organizations')
      .update({ name: trimmed })
      .eq('id', currentOrganization.id);

    if (updateError) {
      setError(messages.auth.errors.unknown);
    } else {
      setSaved(true);
      await refreshOrganizations();
    }
    setSaving(false);
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      <h2 className="text-base font-semibold text-ink">{t.title}</h2>
      <p className="-mt-3 text-sm text-ink-secondary">{t.subtitle}</p>

      <div className="flex items-center gap-4 rounded-xl border border-border bg-surface-secondary p-5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-ink-muted">
          <Building2 size={22} />
        </div>
        <label className="flex-1">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.nameLabel}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
            placeholder={t.namePlaceholder}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-muted focus:border-sapphire focus:ring-1 focus:ring-sapphire disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
      </div>

      {!canEdit && <p className="text-xs text-ink-muted">{t.readOnlyNotice}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {saved && <p className="text-sm text-success">{t.saveSuccess}</p>}

      {canEdit && (
        <div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !name.trim() || name.trim() === currentOrganization?.name}
            className="rounded-lg bg-sapphire px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-sapphire-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t.save}
          </button>
        </div>
      )}
    </div>
  );
}
