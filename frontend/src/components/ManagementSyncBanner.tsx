import { CloudUpload, X } from 'lucide-react';
import { useLanguage } from '../i18n';
import { useAuth } from '../lib/auth/AuthProvider';
import { useManagementMigration } from '../lib/migration/useManagementMigration';

/**
 * "Encontramos dados salvos neste dispositivo" — offered once per org per
 * device (see migrationMarker.ts). Never uploads anything without the user
 * clicking Sincronizar; never touches/clears IndexedDB either way.
 */
export function ManagementSyncBanner() {
  const { currentOrganization } = useAuth();
  const { messages } = useLanguage();
  const t = messages.migration;
  const { status, sync, dismiss } = useManagementMigration(currentOrganization?.id ?? null);

  if (status === 'checking' || status === 'none' || status === 'done') return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-full max-w-sm rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sapphire-light text-sapphire">
          <CloudUpload size={18} />
        </div>
        <div className="flex-1">
          {status === 'pending' && (
            <>
              <p className="text-sm font-medium text-ink">{t.foundTitle}</p>
              <p className="mt-1 text-xs text-ink-secondary">{t.foundBody}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => void sync()}
                  className="rounded-lg bg-sapphire px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sapphire-hover"
                >
                  {t.syncCta}
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink"
                >
                  {t.dismissCta}
                </button>
              </div>
            </>
          )}

          {status === 'syncing' && (
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-sapphire border-t-transparent" />
              <p className="text-sm text-ink">{t.syncing}</p>
            </div>
          )}

          {status === 'error' && (
            <>
              <p className="text-sm font-medium text-danger">{t.errorTitle}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => void sync()}
                  className="rounded-lg bg-sapphire px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sapphire-hover"
                >
                  {t.retryCta}
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink"
                >
                  {t.dismissCta}
                </button>
              </div>
            </>
          )}
        </div>
        <button type="button" onClick={dismiss} className="shrink-0 text-ink-muted hover:text-ink">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
