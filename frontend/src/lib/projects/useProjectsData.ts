import { useCallback, useEffect, useMemo, useState } from 'react';
import { getProjectFinancialsByProjectIds } from './financialIntegration';
import { getProjectRepositories } from './projectRepositoryProvider';
import { ProjectService } from './service';
import { Project, ProjectFinancials, ProjectInput, ProjectStage, ProjectTag } from './types';

/**
 * The only place the Project Flow page's UI touches the service layer.
 * Mostly the same "mutate then reload" model as useFinancialData, EXCEPT for
 * drag-and-drop moves and reordering, which update local state optimistically
 * first (so the card never visibly snaps back while the write is in flight)
 * and roll back on failure — see moveProjectToStage/reorderProjectsInStage.
 *
 * `organizationId` is null while AuthProvider is still resolving
 * currentOrganization — no query runs until it's known (see section 23 of
 * the management-foundation spec: never query with a guessed org).
 */
export function useProjectsData(organizationId: string | null) {
  const service = useMemo(() => (organizationId ? new ProjectService(getProjectRepositories(organizationId)) : null), [organizationId]);
  const requireService = useCallback(() => {
    if (!service) throw new Error('Organization not ready');
    return service;
  }, [service]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [stages, setStages] = useState<ProjectStage[]>([]);
  const [tags, setTags] = useState<ProjectTag[]>([]);
  const [financials, setFinancials] = useState<Map<string, ProjectFinancials>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!service || !organizationId) return;
    try {
      const [projectList, stageList, tagList] = await Promise.all([requireService().listProjects(), requireService().listStages(), requireService().listTags()]);
      setProjects(projectList);
      setStages(stageList);
      setTags(tagList);
      const financialMap = await getProjectFinancialsByProjectIds(organizationId, projectList.map((p) => p.id));
      setFinancials(financialMap);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [service, organizationId, requireService]);

  useEffect(() => {
    if (!service) return;
    void reload();
  }, [service, reload]);

  const createProject = useCallback(
    async (input: ProjectInput) => {
      const created = await requireService().createProject(input);
      await reload();
      return created;
    },
    [service, reload]
  );

  const updateProject = useCallback(
    async (id: string, patch: Partial<Project>) => {
      const updated = await requireService().updateProject(id, patch);
      await reload();
      return updated;
    },
    [service, reload]
  );

  const duplicateProject = useCallback(
    async (source: Project) => {
      const copy = await requireService().duplicateProject(source);
      await reload();
      return copy;
    },
    [service, reload]
  );

  /** Optimistic: the card visually jumps to the new column immediately;
   * if the persist call fails, the previous snapshot is restored and
   * `onError` is invoked so the UI can show a small, discreet message. */
  const moveProjectToStage = useCallback(
    async (projectId: string, toStageId: string, onError?: (message: string) => void) => {
      const snapshot = projects;
      const now = new Date().toISOString();
      setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, stageId: toStageId, stageEnteredAt: now } : p)));
      try {
        await requireService().moveToStage(projectId, toStageId);
        await reload();
      } catch (err) {
        setProjects(snapshot);
        onError?.(err instanceof Error ? err.message : String(err));
      }
    },
    [service, projects, reload]
  );

  const reorderProjectsInStage = useCallback(
    async (stageId: string, orderedProjectIds: string[], onError?: (message: string) => void) => {
      const snapshot = projects;
      setProjects((prev) => {
        const orderIndex = new Map(orderedProjectIds.map((id, i) => [id, i]));
        return prev.map((p) => (p.stageId === stageId && orderIndex.has(p.id) ? { ...p, order: orderIndex.get(p.id)! } : p));
      });
      try {
        await requireService().reorderWithinStage(stageId, orderedProjectIds);
      } catch (err) {
        setProjects(snapshot);
        onError?.(err instanceof Error ? err.message : String(err));
      }
    },
    [service, projects]
  );

  const markCompleted = useCallback(async (id: string) => { await requireService().markCompleted(id); await reload(); }, [service, reload]);
  const reopenProject = useCallback(async (id: string) => { await requireService().reopenProject(id); await reload(); }, [service, reload]);
  const archiveProject = useCallback(async (id: string) => { await requireService().archiveProject(id); await reload(); }, [service, reload]);
  const unarchiveProject = useCallback(async (id: string) => { await requireService().unarchiveProject(id); await reload(); }, [service, reload]);
  const setWaitingForClient = useCallback(
    async (id: string, waiting: boolean) => { await requireService().setWaitingForClient(id, waiting); await reload(); },
    [service, reload]
  );
  const setApprovalStatus = useCallback(
    async (id: string, status: Project['approvalStatus']) => { await requireService().setApprovalStatus(id, status); await reload(); },
    [service, reload]
  );

  const addChecklistItem = useCallback(async (id: string, title: string) => { await requireService().addChecklistItem(id, title); await reload(); }, [service, reload]);
  const toggleChecklistItem = useCallback(
    async (id: string, itemId: string, completed: boolean) => { await requireService().toggleChecklistItem(id, itemId, completed); await reload(); },
    [service, reload]
  );
  const removeChecklistItem = useCallback(
    async (id: string, itemId: string) => { await requireService().removeChecklistItem(id, itemId); await reload(); },
    [service, reload]
  );

  const createStage = useCallback(async (name: string) => { const s = await requireService().createStage(name); await reload(); return s; }, [service, reload]);
  const renameStage = useCallback(async (id: string, name: string) => { await requireService().renameStage(id, name); await reload(); }, [service, reload]);
  const deleteStage = useCallback(
    async (id: string, migrateToStageId: string) => { await requireService().deleteStage(id, migrateToStageId); await reload(); },
    [service, reload]
  );

  const createTag = useCallback(async (name: string) => { const t = await requireService().createTag(name); await reload(); return t; }, [service, reload]);

  const getHistory = useCallback((projectId: string) => requireService().getHistory(projectId), [service]);

  return {
    projects,
    stages,
    tags,
    financials,
    loading,
    error,
    createProject,
    updateProject,
    duplicateProject,
    moveProjectToStage,
    reorderProjectsInStage,
    markCompleted,
    reopenProject,
    archiveProject,
    unarchiveProject,
    setWaitingForClient,
    setApprovalStatus,
    addChecklistItem,
    toggleChecklistItem,
    removeChecklistItem,
    createStage,
    renameStage,
    deleteStage,
    createTag,
    getHistory,
  };
}
