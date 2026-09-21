import { Clock, Hourglass } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { deriveDueStatus, daysInStage } from '../../lib/projects/dates';
import { Project, ProjectFinancials } from '../../lib/projects/types';
import { formatMoneyCents } from '../../lib/financial/money';
import { DUE_STATUS_STYLES, PRIORITY_DOT_COLOR } from './dueStatusStyles';

interface Props {
  project: Project;
  financials: ProjectFinancials | undefined;
  tagName: (id: string) => string;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  dragging: boolean;
}

function formatDateBR(dateISO: string): string {
  const [y, m, d] = dateISO.split('-');
  return `${d}/${m}/${y}`;
}

export function ProjectCard({ project, financials, tagName, onOpen, onDragStart, onDragEnd, dragging }: Props) {
  const { messages, locale } = useLanguage();
  const t = messages.projectFlow;
  const dueStatus = deriveDueStatus(project);
  const style = DUE_STATUS_STYLES[dueStatus];
  const stageDays = daysInStage(project.stageEnteredAt);

  const checklistTotal = project.checklist.length;
  const checklistDone = project.checklist.filter((i) => i.completed).length;

  const visibleTags = project.tagIds.slice(0, 2);
  const extraTagCount = project.tagIds.length - visibleTags.length;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={`flex cursor-pointer flex-col gap-1.5 rounded-lg border border-border bg-surface p-3 text-left shadow-card transition hover:border-sapphire/40 ${
        dragging ? 'opacity-40' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{project.name}</p>
        <span title={t.priority.options[project.priority]} className={`mt-1 h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT_COLOR[project.priority]}`} />
      </div>

      {(project.projectType || visibleTags.length > 0) && (
        <div className="flex flex-wrap items-center gap-1">
          {project.projectType && <span className="text-xs text-ink-muted">{project.projectType}</span>}
          {visibleTags.map((id) => (
            <span key={id} className="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-ink-secondary">
              {tagName(id)}
            </span>
          ))}
          {extraTagCount > 0 && <span className="text-[10px] text-ink-muted">+{extraTagCount}</span>}
        </div>
      )}

      {project.contractValueCents > 0 && (
        <div className="text-xs text-ink-secondary">
          <span className="font-medium text-ink">{formatMoneyCents(project.contractValueCents, locale)}</span>
          {financials && (financials.receivedCents > 0 || financials.receivableCents > 0) && (
            <span className="text-ink-muted">
              {' · '}
              {t.card.received} {formatMoneyCents(financials.receivedCents, locale)}
            </span>
          )}
        </div>
      )}

      {project.dueDate && (
        <div className="flex items-center justify-between text-[11px] text-ink-muted">
          <span>{t.card.due} {formatDateBR(project.dueDate)}</span>
          <span className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium ${style.bg} ${style.text}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
            {t.dueStatus[dueStatus]}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-ink-muted">
        <span className="flex items-center gap-2">
          {checklistTotal > 0 && (
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {checklistDone}/{checklistTotal}
            </span>
          )}
          <span className="flex items-center gap-1" title={t.card.daysInStage(stageDays)}>
            <Hourglass size={11} />
            {stageDays}d
          </span>
        </span>
        {project.waitingForClient && (
          <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-600">{t.waitingForClient.badge}</span>
        )}
      </div>

      {project.nextAction && <p className="truncate text-[11px] italic text-ink-muted">{project.nextAction}</p>}
    </div>
  );
}
