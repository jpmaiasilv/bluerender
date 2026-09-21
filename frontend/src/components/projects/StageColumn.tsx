import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { ProjectFinancials, ProjectStage } from '../../lib/projects/types';
import { Project } from '../../lib/projects/types';
import { ProjectCard } from './ProjectCard';

interface Props {
  stage: ProjectStage;
  projects: Project[];
  financials: Map<string, ProjectFinancials>;
  tagName: (id: string) => string;
  draggedProjectId: string | null;
  onDragStartCard: (projectId: string) => void;
  onDragEndCard: () => void;
  onDropOnColumn: (stageId: string, beforeProjectId: string | null) => void;
  onOpenProject: (project: Project) => void;
  onRenameStage: (stageId: string) => void;
  onDeleteStage: (stageId: string) => void;
}

export function StageColumn({
  stage,
  projects,
  financials,
  tagName,
  draggedProjectId,
  onDragStartCard,
  onDragEndCard,
  onDropOnColumn,
  onOpenProject,
  onRenameStage,
  onDeleteStage,
}: Props) {
  const { messages } = useLanguage();
  const t = messages.projectFlow;
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [menuOpen]);

  const sorted = [...projects].sort((a, b) => a.order - b.order);

  return (
    <div className="flex w-[280px] shrink-0 flex-col rounded-xl bg-surface-secondary/70">
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-1.5 truncate">
          <span className="truncate text-xs font-semibold uppercase tracking-wide text-ink-secondary">{stage.name}</span>
          <span className="shrink-0 rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">{sorted.length}</span>
        </div>
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-muted transition hover:bg-surface hover:text-ink"
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-7 z-20 w-40 rounded-lg border border-border bg-surface py-1 shadow-lg">
              <button
                type="button"
                onClick={() => {
                  onRenameStage(stage.id);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-sapphire-soft hover:text-sapphire"
              >
                <Pencil size={12} />
                {t.stages.rename}
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteStage(stage.id);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-danger hover:bg-danger/10"
              >
                <Trash2 size={12} />
                {t.stages.delete}
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onDropOnColumn(stage.id, null);
        }}
        className={`flex min-h-[80px] flex-1 flex-col gap-2 rounded-b-xl p-2 transition ${dragOver ? 'bg-sapphire-soft' : ''}`}
      >
        {sorted.map((project) => (
          <div
            key={project.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDropOnColumn(stage.id, project.id);
            }}
          >
            <ProjectCard
              project={project}
              financials={financials.get(project.id)}
              tagName={tagName}
              onOpen={() => onOpenProject(project)}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                onDragStartCard(project.id);
              }}
              onDragEnd={onDragEndCard}
              dragging={draggedProjectId === project.id}
            />
          </div>
        ))}
        {sorted.length === 0 && <p className="px-1 py-4 text-center text-[11px] text-ink-muted">{t.stages.empty}</p>}
      </div>
    </div>
  );
}
