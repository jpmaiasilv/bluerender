import { useState } from 'react';
import { useLanguage } from '../../i18n';
import { formatMoneyCents } from '../../lib/financial/money';
import { deriveDueStatus } from '../../lib/projects/dates';
import { Project, ProjectFinancials, ProjectStage } from '../../lib/projects/types';
import { Client } from '../../lib/clients/types';
import { DUE_STATUS_STYLES } from './dueStatusStyles';

type SortKey = 'dueDate' | 'priority' | 'name';

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

interface Props {
  projects: Project[];
  stages: ProjectStage[];
  clients: Client[];
  financials: Map<string, ProjectFinancials>;
  onOpenProject: (project: Project) => void;
}

function formatDateBR(dateISO: string | null): string {
  if (!dateISO) return '—';
  const [y, m, d] = dateISO.split('-');
  return `${d}/${m}/${y}`;
}

export function ProjectsListView({ projects, stages, clients, financials, onOpenProject }: Props) {
  const { messages, locale } = useLanguage();
  const t = messages.projectFlow.list;
  const [sortKey, setSortKey] = useState<SortKey>('dueDate');

  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? '';
  const clientName = (id: string | null) => (id ? (clients.find((c) => c.id === id)?.name ?? '') : '');

  const sorted = [...projects].sort((a, b) => {
    if (sortKey === 'name') return a.name.localeCompare(b.name);
    if (sortKey === 'priority') return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    const ad = a.dueDate ?? '9999-99-99';
    const bd = b.dueDate ?? '9999-99-99';
    return ad < bd ? -1 : ad > bd ? 1 : 0;
  });

  if (projects.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-muted">{messages.projectFlow.emptyState.title}</p>;
  }

  return (
    <div className="overflow-x-auto px-6 py-4 lg:px-8">
      <div className="mb-2 flex items-center gap-2 text-xs text-ink-secondary">
        <span>{t.sortBy}</span>
        {(['dueDate', 'priority', 'name'] as SortKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSortKey(key)}
            className={`rounded-full px-2 py-1 font-medium ${sortKey === key ? 'bg-sapphire-light text-sapphire' : 'text-ink-muted hover:text-sapphire'}`}
          >
            {t.sortOptions[key]}
          </button>
        ))}
      </div>
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
            <th className="py-2 pr-3">{t.columns.name}</th>
            <th className="py-2 pr-3">{t.columns.stage}</th>
            <th className="py-2 pr-3">{t.columns.client}</th>
            <th className="py-2 pr-3">{t.columns.due}</th>
            <th className="py-2 pr-3 text-right">{t.columns.value}</th>
            <th className="py-2 pr-3 text-right">{t.columns.received}</th>
            <th className="py-2 pr-3 text-right">{t.columns.receivable}</th>
            <th className="py-2 pr-3">{t.columns.status}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sorted.map((p) => {
            const status = deriveDueStatus(p);
            const style = DUE_STATUS_STYLES[status];
            const fin = financials.get(p.id);
            return (
              <tr key={p.id} onClick={() => onOpenProject(p)} className="cursor-pointer text-ink hover:bg-surface-secondary">
                <td className="max-w-[220px] truncate py-2.5 pr-3 font-medium">{p.name}</td>
                <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-ink-secondary">{stageName(p.stageId)}</td>
                <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-ink-secondary">{clientName(p.clientId) || '—'}</td>
                <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-ink-secondary">{formatDateBR(p.dueDate)}</td>
                <td className="whitespace-nowrap py-2.5 pr-3 text-right">{formatMoneyCents(p.contractValueCents, locale)}</td>
                <td className="whitespace-nowrap py-2.5 pr-3 text-right text-success">{formatMoneyCents(fin?.receivedCents ?? 0, locale)}</td>
                <td className="whitespace-nowrap py-2.5 pr-3 text-right">{formatMoneyCents(fin?.receivableCents ?? 0, locale)}</td>
                <td className="whitespace-nowrap py-2.5 pr-3">
                  <span className={`flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                    {messages.projectFlow.dueStatus[status]}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
