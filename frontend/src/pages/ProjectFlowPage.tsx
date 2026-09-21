import { useMemo, useState } from 'react';
import { ToolLayout } from '../components/ToolLayout';
import { SummaryBar } from '../components/projects/SummaryBar';
import { FiltersBar, StatusFilterKey } from '../components/projects/FiltersBar';
import { Board } from '../components/projects/Board';
import { ProjectsListView } from '../components/projects/ProjectsListView';
import { ProjectFormModal } from '../components/projects/ProjectFormModal';
import { ProjectDetailPanel } from '../components/projects/ProjectDetailPanel';
import { AddStageModal, DeleteStageModal, RenameStageModal } from '../components/projects/StageModals';
import { useLanguage } from '../i18n';
import { useAuth } from '../lib/auth/AuthProvider';
import { useProjectsData } from '../lib/projects/useProjectsData';
import { useClientsData } from '../lib/clients/useClientsData';
import { deriveDueStatus, todayISO, daysBetween } from '../lib/projects/dates';
import { ApprovalStatus, Project, ProjectInput, ProjectPriority, ProjectStage } from '../lib/projects/types';

export function ProjectFlowPage() {
  const { messages } = useLanguage();
  const t = messages.projectFlow;
  const { currentOrganization } = useAuth();
  const {
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
  } = useProjectsData(currentOrganization?.id ?? null);
  const { clients, createClient } = useClientsData(currentOrganization?.id ?? null);

  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>('all');
  const [priorityFilter, setPriorityFilter] = useState<ProjectPriority | 'all'>('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'board' | 'list'>('board');
  const [showArchived, setShowArchived] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [formInitial, setFormInitial] = useState<Project | null>(null);
  const [formDefaults, setFormDefaults] = useState<Partial<ProjectInput> | undefined>(undefined);

  const [detailProjectId, setDetailProjectId] = useState<string | null>(null);
  const [detailHistory, setDetailHistory] = useState<ReturnType<typeof getHistory> extends Promise<infer R> ? R : never>([]);

  const [renamingStage, setRenamingStage] = useState<ProjectStage | null>(null);
  const [deletingStage, setDeletingStage] = useState<ProjectStage | null>(null);
  const [addStageOpen, setAddStageOpen] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  const today = todayISO();
  const tagName = (id: string) => tags.find((tg) => tg.id === id)?.name ?? '';
  const clientName = (id: string | null) => (id ? (clients.find((c) => c.id === id)?.name ?? '') : '');

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (!showArchived && p.archivedAt) return false;
      if (showArchived && !p.archivedAt) return false;
      if (priorityFilter !== 'all' && p.priority !== priorityFilter) return false;
      if (statusFilter === 'waitingForClient' && !p.waitingForClient) return false;
      if (statusFilter === 'completed' && !p.completedAt) return false;
      if (['onTrack', 'dueSoon', 'overdue'].includes(statusFilter) && deriveDueStatus(p, today) !== statusFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const haystack = `${p.name} ${clientName(p.clientId)} ${p.projectType ?? ''} ${p.tagIds.map(tagName).join(' ')}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [projects, statusFilter, priorityFilter, search, showArchived, today, tags, clients]);

  const activeCount = projects.filter((p) => !p.archivedAt && !p.completedAt).length;
  const overdueCount = projects.filter((p) => !p.archivedAt && deriveDueStatus(p, today) === 'overdue').length;
  const dueThisWeekCount = projects.filter((p) => !p.archivedAt && !p.completedAt && p.dueDate && daysBetween(today, p.dueDate) >= 0 && daysBetween(today, p.dueDate) <= 7).length;
  const receivableCents = [...financials.values()].reduce((sum, f) => sum + f.receivableCents, 0);

  const detailProject = detailProjectId ? (projects.find((p) => p.id === detailProjectId) ?? null) : null;

  function openDetail(project: Project) {
    setDetailProjectId(project.id);
    void getHistory(project.id).then(setDetailHistory);
  }

  function closeDetail() {
    setDetailProjectId(null);
    setDetailHistory([]);
  }

  function openNewForm() {
    setFormInitial(null);
    setFormDefaults({ stageId: stages[0]?.id });
    setFormOpen(true);
  }

  function openEditForm(project: Project) {
    setFormInitial(project);
    setFormDefaults(undefined);
    setFormOpen(true);
  }

  async function handleDuplicate(project: Project) {
    const copy = await duplicateProject(project);
    closeDetail();
    setFormInitial(copy);
    setFormDefaults(undefined);
    setFormOpen(true);
  }

  const stageProjectCount = (stageId: string) => projects.filter((p) => p.stageId === stageId).length;

  const hasAnyProjects = projects.length > 0;

  return (
    <ToolLayout
      title={t.title}
      description={t.subtitle}
      actions={
        <button type="button" onClick={openNewForm} className="rounded-lg bg-sapphire px-4 py-1.5 text-sm font-medium text-white transition hover:bg-sapphire-hover">
          {t.newProject}
        </button>
      }
    >
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-sapphire border-t-transparent" />
        </div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="text-sm text-danger">{messages.settings.errorLoading}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink"
          >
            {messages.settings.tryAgain}
          </button>
        </div>
      ) : !hasAnyProjects ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="text-base font-semibold text-ink">{t.emptyState.title}</p>
          <p className="max-w-sm text-sm text-ink-secondary">{t.emptyState.subtitle}</p>
          <button type="button" onClick={openNewForm} className="rounded-lg bg-sapphire px-4 py-2 text-sm font-medium text-white transition hover:bg-sapphire-hover">
            {t.emptyState.cta}
          </button>
        </div>
      ) : (
        <>
          <SummaryBar activeCount={activeCount} overdueCount={overdueCount} dueThisWeekCount={dueThisWeekCount} receivableCents={receivableCents} />
          <FiltersBar
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            priorityFilter={priorityFilter}
            onPriorityFilterChange={setPriorityFilter}
            search={search}
            onSearchChange={setSearch}
            view={view}
            onViewChange={setView}
            showArchived={showArchived}
            onShowArchivedChange={setShowArchived}
          />

          {moveError && (
            <div className="mx-6 mt-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger lg:mx-8">{moveError}</div>
          )}

          <div className="flex-1 overflow-hidden">
            {view === 'board' ? (
              <Board
                stages={stages}
                projects={filtered}
                financials={financials}
                tagName={tagName}
                onOpenProject={openDetail}
                onMoveProject={(projectId, toStageId) => void moveProjectToStage(projectId, toStageId, setMoveError)}
                onReorderInStage={(stageId, orderedIds) => void reorderProjectsInStage(stageId, orderedIds, setMoveError)}
                onRenameStage={(stageId) => setRenamingStage(stages.find((s) => s.id === stageId) ?? null)}
                onDeleteStage={(stageId) => setDeletingStage(stages.find((s) => s.id === stageId) ?? null)}
                onAddStage={() => setAddStageOpen(true)}
              />
            ) : (
              <ProjectsListView projects={filtered} stages={stages} clients={clients} financials={financials} onOpenProject={openDetail} />
            )}
          </div>
        </>
      )}

      <ProjectFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        stages={stages}
        tags={tags}
        clients={clients}
        initial={formInitial}
        defaultValues={formDefaults}
        onSubmit={async (input) => {
          if (formInitial) await updateProject(formInitial.id, input);
          else await createProject(input);
        }}
        onCreateTag={createTag}
        onCreateClient={(name) => createClient({ name, company: null, email: null, phone: null, address: null, notes: null })}
      />

      <ProjectDetailPanel
        project={detailProject}
        organizationId={currentOrganization?.id ?? null}
        stages={stages}
        tags={tags}
        clients={clients}
        financials={detailProject ? financials.get(detailProject.id) : undefined}
        history={detailHistory}
        onClose={closeDetail}
        onEdit={() => detailProject && openEditForm(detailProject)}
        onDuplicate={() => detailProject && void handleDuplicate(detailProject)}
        onMoveStage={(stageId) => detailProject && void moveProjectToStage(detailProject.id, stageId, setMoveError)}
        onToggleWaitingForClient={(waiting) => detailProject && void setWaitingForClient(detailProject.id, waiting)}
        onSetApprovalStatus={(status: ApprovalStatus) => detailProject && void setApprovalStatus(detailProject.id, status)}
        onMarkCompleted={() => detailProject && void markCompleted(detailProject.id)}
        onReopen={() => detailProject && void reopenProject(detailProject.id)}
        onArchive={() => {
          if (detailProject) void archiveProject(detailProject.id);
          closeDetail();
        }}
        onUnarchive={() => detailProject && void unarchiveProject(detailProject.id)}
        onAddChecklistItem={(title) => detailProject && void addChecklistItem(detailProject.id, title)}
        onToggleChecklistItem={(itemId, completed) => detailProject && void toggleChecklistItem(detailProject.id, itemId, completed)}
        onRemoveChecklistItem={(itemId) => detailProject && void removeChecklistItem(detailProject.id, itemId)}
      />

      <RenameStageModal
        stage={renamingStage}
        onClose={() => setRenamingStage(null)}
        onConfirm={(name) => {
          if (renamingStage) void renameStage(renamingStage.id, name);
          setRenamingStage(null);
        }}
      />

      <AddStageModal
        open={addStageOpen}
        onClose={() => setAddStageOpen(false)}
        onConfirm={(name) => {
          void createStage(name);
          setAddStageOpen(false);
        }}
      />

      <DeleteStageModal
        stage={deletingStage}
        otherStages={stages.filter((s) => s.id !== deletingStage?.id)}
        projectCount={deletingStage ? stageProjectCount(deletingStage.id) : 0}
        onClose={() => setDeletingStage(null)}
        onConfirm={(migrateToStageId) => {
          if (deletingStage) void deleteStage(deletingStage.id, migrateToStageId);
          setDeletingStage(null);
        }}
      />
    </ToolLayout>
  );
}
