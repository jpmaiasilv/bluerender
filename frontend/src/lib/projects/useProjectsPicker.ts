import { useEffect, useMemo, useState } from 'react';
import { getProjectRepositories } from './projectRepositoryProvider';
import { Project } from './types';

/**
 * Lightweight, picker-only project list — used by TransactionFormModal's
 * "Projeto" select. Deliberately doesn't go through useProjectsData (which
 * also fetches per-project financials via financialIntegration.ts): that
 * would be circular busywork just to populate a dropdown.
 */
export function useProjectsPicker(organizationId: string | null) {
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    if (!organizationId) {
      setProjects([]);
      return;
    }
    let cancelled = false;
    getProjectRepositories(organizationId)
      .projects.listProjects()
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  return useMemo(() => projects, [projects]);
}
