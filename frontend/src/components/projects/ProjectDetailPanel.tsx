import { useEffect, useState } from 'react';
import { Archive, ArchiveRestore, Check, Copy, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Modal } from '../Modal';
import { SelectField } from '../SelectField';
import { useLanguage } from '../../i18n';
import { formatMoneyCents } from '../../lib/financial/money';
import { deriveDueStatus, daysInStage } from '../../lib/projects/dates';
import { ApprovalStatus, Project, ProjectFinancials, ProjectHistoryEntry, ProjectStage, ProjectTag } from '../../lib/projects/types';
import { Client } from '../../lib/clients/types';
import { DUE_STATUS_STYLES } from './dueStatusStyles';
import { ProjectFilesTab } from '../projectFiles/ProjectFilesTab';
import { ProjectFinancialTab } from './ProjectFinancialTab';

interface Props {
  project: Project | null;
  organizationId: string | null;
  stages: ProjectStage[];
  tags: ProjectTag[];
  clients: Client[];
  financials: ProjectFinancials | undefined;
  history: ProjectHistoryEntry[];
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onMoveStage: (stageId: string) => void;
  onToggleWaitingForClient: (waiting: boolean) => void;
  onSetApprovalStatus: (status: ApprovalStatus) => void;
  onMarkCompleted: () => void;
  onReopen: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onAddChecklistItem: (title: string) => void;
  onToggleChecklistItem: (itemId: string, completed: boolean) => void;
  onRemoveChecklistItem: (itemId: string) => void;
}

function formatDateBR(dateISO: string | null): string {
  if (!dateISO) return '—';
  const [y, m, d] = dateISO.split('-');
  return `${d}/${m}/${y}`;
}

function formatTimestampBR(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function ProjectDetailPanel({
  project,
  organizationId,
  stages,
  tags,
  clients,
  financials,
  history,
  onClose,
  onEdit,
  onDuplicate,
  onMoveStage,
  onToggleWaitingForClient,
  onSetApprovalStatus,
  onMarkCompleted,
  onReopen,
  onArchive,
  onUnarchive,
  onAddChecklistItem,
  onToggleChecklistItem,
  onRemoveChecklistItem,
}: Props) {
  const { messages, locale } = useLanguage();
  const t = messages.projectFlow;
  const [newTask, setNewTask] = useState('');
  const [activeTab, setActiveTab] = useState<'details' | 'financial' | 'files'>('details');

  useEffect(() => {
    setNewTask('');
    setActiveTab('details');
  }, [project?.id]);

  return (
    <Modal open={project !== null} onClose={onClose} labelledBy="project-detail-title" panelClassName="w-full max-w-[820px]">
      {project && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="border-b border-border px-6 py-4">
            <div className="flex items-center gap-2">
              <h2 id="project-detail-title" className="text-base font-semibold text-ink">
                {project.name}
              </h2>
              {project.completedAt && (
                <span className="rounded-full bg-sapphire-light px-2 py-0.5 text-xs font-medium text-sapphire">{t.dueStatus.completed}</span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">
              {(project.clientId && clients.find((c) => c.id === project.clientId)?.name) || t.detail.noClient} · {project.projectType || t.detail.noType}
            </p>
          </div>

          <div className="flex items-center gap-1 border-b border-border px-6 pt-2">
            {(['details', 'financial', 'files'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`border-b-2 px-3 py-2 text-sm font-medium transition ${
                  activeTab === tab ? 'border-sapphire text-sapphire' : 'border-transparent text-ink-secondary hover:text-ink'
                }`}
              >
                {tab === 'details' ? t.detail.detailsTab : tab === 'financial' ? messages.projectFinancialTab.tabLabel : messages.projectFiles.tabLabel}
              </button>
            ))}
          </div>

          {activeTab === 'files' ? (
            <div className="flex-1 overflow-y-auto">
              <ProjectFilesTab organizationId={organizationId} projectId={project.id} />
            </div>
          ) : activeTab === 'financial' ? (
            <div className="flex-1 overflow-y-auto">
              <ProjectFinancialTab organizationId={organizationId} project={project} />
            </div>
          ) : (
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-2 gap-3">
              <SelectField label={t.detail.stage} value={project.stageId} options={stages.map((s) => ({ value: s.id, label: s.name }))} onChange={onMoveStage} />
              <SelectField
                label={t.detail.approval}
                value={project.approvalStatus}
                options={(['none', 'awaitingApproval', 'changesRequested', 'approved'] as const).map((s) => ({
                  value: s,
                  label: t.approval.options[s],
                }))}
                onChange={(v) => onSetApprovalStatus(v as ApprovalStatus)}
              />
            </div>

            <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-surface-secondary p-3 text-sm">
              <div>
                <p className="text-[10px] uppercase text-ink-muted">{t.detail.contractValue}</p>
                <p className="font-semibold text-ink">{formatMoneyCents(project.contractValueCents, locale)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-ink-muted">{t.card.received}</p>
                <p className="font-semibold text-success">{formatMoneyCents(financials?.receivedCents ?? 0, locale)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-ink-muted">{t.card.receivable}</p>
                <p className="font-semibold text-ink">{formatMoneyCents(financials?.receivableCents ?? 0, locale)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-[10px] uppercase text-ink-muted">{t.detail.startDate}</p>
                <p className="text-ink">{formatDateBR(project.startDate)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-ink-muted">{t.detail.dueDate}</p>
                <p className="text-ink">{formatDateBR(project.dueDate)}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(() => {
                const status = deriveDueStatus(project);
                const style = DUE_STATUS_STYLES[status];
                return (
                  <span className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${style.bg} ${style.text}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                    {t.dueStatus[status]}
                  </span>
                );
              })()}
              <span className="text-xs text-ink-muted">{t.card.daysInStage(daysInStage(project.stageEnteredAt))}</span>
            </div>

            <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-sm text-ink">{t.waitingForClient.label}</span>
              <input
                type="checkbox"
                checked={project.waitingForClient}
                onChange={(e) => onToggleWaitingForClient(e.target.checked)}
                className="accent-sapphire"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.detail.nextAction}</span>
              <p className="rounded-lg bg-surface-secondary px-3 py-2 text-sm text-ink-secondary">{project.nextAction || '—'}</p>
            </label>

            <div>
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.detail.checklist}</span>
              <ul className="space-y-1">
                {project.checklist.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-surface-secondary">
                    <input
                      type="checkbox"
                      checked={item.completed}
                      onChange={(e) => onToggleChecklistItem(item.id, e.target.checked)}
                      className="accent-sapphire"
                    />
                    <span className={`flex-1 text-sm ${item.completed ? 'text-ink-muted line-through' : 'text-ink'}`}>{item.title}</span>
                    <button type="button" onClick={() => onRemoveChecklistItem(item.id)} className="text-ink-muted hover:text-danger">
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-1.5">
                <input
                  type="text"
                  value={newTask}
                  onChange={(e) => setNewTask(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newTask.trim()) {
                      e.preventDefault();
                      onAddChecklistItem(newTask.trim());
                      setNewTask('');
                    }
                  }}
                  placeholder={t.detail.addTask}
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-sapphire focus:ring-1 focus:ring-sapphire"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (newTask.trim()) {
                      onAddChecklistItem(newTask.trim());
                      setNewTask('');
                    }
                  }}
                  className="rounded-lg bg-sapphire px-3 text-sm font-medium text-white hover:bg-sapphire-hover"
                >
                  {t.detail.addTask}
                </button>
              </div>
            </div>

            {project.tagIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {project.tagIds.map((id) => {
                  const tag = tags.find((tg) => tg.id === id);
                  return tag ? (
                    <span key={id} className="rounded-full bg-sapphire-soft px-2 py-0.5 text-xs text-sapphire">
                      {tag.name}
                    </span>
                  ) : null;
                })}
              </div>
            )}

            {project.notes && (
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.detail.notes}</span>
                <p className="whitespace-pre-wrap rounded-lg bg-surface-secondary px-3 py-2 text-sm text-ink-secondary">{project.notes}</p>
              </label>
            )}

            {history.length > 0 && (
              <div>
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.detail.history}</span>
                <ul className="space-y-1 text-xs text-ink-muted">
                  {history.slice(0, 6).map((entry) => {
                    const from = stages.find((s) => s.id === entry.fromStageId)?.name ?? t.detail.noStage;
                    const to = stages.find((s) => s.id === entry.toStageId)?.name ?? entry.toStageId;
                    return (
                      <li key={entry.id}>
                        {formatTimestampBR(entry.timestamp)} · {from} → {to}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-6 py-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onEdit}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-sapphire"
              >
                <Pencil size={13} />
                {t.detail.edit}
              </button>
              <button
                type="button"
                onClick={onDuplicate}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-sapphire"
              >
                <Copy size={13} />
                {t.detail.duplicate}
              </button>
              {project.archivedAt ? (
                <button
                  type="button"
                  onClick={onUnarchive}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-sapphire"
                >
                  <ArchiveRestore size={13} />
                  {t.detail.unarchive}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onArchive}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-sapphire"
                >
                  <Archive size={13} />
                  {t.detail.archive}
                </button>
              )}
            </div>
            {project.completedAt ? (
              <button
                type="button"
                onClick={onReopen}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-sapphire"
              >
                <RotateCcw size={13} />
                {t.detail.reopen}
              </button>
            ) : (
              <button
                type="button"
                onClick={onMarkCompleted}
                className="flex items-center gap-1.5 rounded-lg bg-sapphire px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sapphire-hover"
              >
                <Check size={13} />
                {t.detail.markCompleted}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
