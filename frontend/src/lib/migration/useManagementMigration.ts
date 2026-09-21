import { useCallback, useEffect, useState } from 'react';
import { MigrationPreview, MigrationResult, previewLocalManagementData, runManagementMigration } from './managementMigration';
import { isManagementMigrationDone, markManagementMigrationDone } from './migrationMarker';

export type ManagementMigrationStatus = 'checking' | 'none' | 'pending' | 'syncing' | 'done' | 'error';

/**
 * Drives the "Encontramos dados salvos neste dispositivo" banner (see
 * ManagementSyncBanner). Only ever probes/uploads after the user explicitly
 * confirms — mounting this hook alone never touches Supabase beyond a
 * read-only preview of local IndexedDB data.
 */
export function useManagementMigration(organizationId: string | null) {
  const [status, setStatus] = useState<ManagementMigrationStatus>('checking');
  const [preview, setPreview] = useState<MigrationPreview | null>(null);
  const [result, setResult] = useState<MigrationResult | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    if (isManagementMigrationDone(organizationId)) {
      setStatus('done');
      return;
    }
    let cancelled = false;
    setStatus('checking');
    previewLocalManagementData()
      .then((p) => {
        if (cancelled) return;
        if (!p.hasLocalData) {
          markManagementMigrationDone(organizationId);
          setStatus('done');
        } else {
          setPreview(p);
          setStatus('pending');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const sync = useCallback(async () => {
    if (!organizationId) return;
    setStatus('syncing');
    try {
      const res = await runManagementMigration(organizationId);
      setResult(res);
      if (res.ok) {
        markManagementMigrationDone(organizationId);
        setStatus('done');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }, [organizationId]);

  /** Session-only — the banner reappears on the next full reload until the
   * user actually syncs (or there turns out to be nothing to sync). */
  const dismiss = useCallback(() => setStatus('none'), []);

  return { status, preview, result, sync, dismiss };
}
