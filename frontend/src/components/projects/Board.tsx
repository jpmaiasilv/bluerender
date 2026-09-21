import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { Project, ProjectFinancials, ProjectStage } from '../../lib/projects/types';
import { StageColumn } from './StageColumn';

interface Props {
  stages: ProjectStage[];
  projects: Project[];
  financials: Map<string, ProjectFinancials>;
  tagName: (id: string) => string;
  onOpenProject: (project: Project) => void;
  onMoveProject: (projectId: string, toStageId: string) => void;
  onReorderInStage: (stageId: string, orderedProjectIds: string[]) => void;
  onRenameStage: (stageId: string) => void;
  onDeleteStage: (stageId: string) => void;
  onAddStage: () => void;
}

export function Board({
  stages,
  projects,
  financials,
  tagName,
  onOpenProject,
  onMoveProject,
  onReorderInStage,
  onRenameStage,
  onDeleteStage,
  onAddStage,
}: Props) {
  const { messages } = useLanguage();
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);

  const sortedStages = [...stages].sort((a, b) => a.order - b.order);
  const projectsByStage = (stageId: string) => projects.filter((p) => p.stageId === stageId);

  function handleDropOnColumn(stageId: string, beforeProjectId: string | null) {
    if (!draggedProjectId) return;
    const dragged = projects.find((p) => p.id === draggedProjectId);
    if (!dragged) return;

    if (dragged.stageId !== stageId) {
      onMoveProject(draggedProjectId, stageId);
      setDraggedProjectId(null);
      return;
    }

    // Same-column reorder: rebuild the ordered id list with the dragged card
    // moved to its new position.
    const currentOrder = projectsByStage(stageId)
      .sort((a, b) => a.order - b.order)
      .map((p) => p.id)
      .filter((id) => id !== draggedProjectId);

    if (beforeProjectId && beforeProjectId !== draggedProjectId) {
      const targetIndex = currentOrder.indexOf(beforeProjectId);
      currentOrder.splice(targetIndex, 0, draggedProjectId);
    } else {
      currentOrder.push(draggedProjectId);
    }

    onReorderInStage(stageId, currentOrder);
    setDraggedProjectId(null);
  }

  return (
    <div className="flex h-full gap-3 overflow-x-auto px-6 py-4 lg:px-8">
      {sortedStages.map((stage) => (
        <StageColumn
          key={stage.id}
          stage={stage}
          projects={projectsByStage(stage.id)}
          financials={financials}
          tagName={tagName}
          draggedProjectId={draggedProjectId}
          onDragStartCard={setDraggedProjectId}
          onDragEndCard={() => setDraggedProjectId(null)}
          onDropOnColumn={handleDropOnColumn}
          onOpenProject={onOpenProject}
          onRenameStage={onRenameStage}
          onDeleteStage={onDeleteStage}
        />
      ))}
      <button
        type="button"
        onClick={onAddStage}
        className="flex h-10 w-[200px] shrink-0 items-center justify-center gap-1.5 self-start rounded-xl border border-dashed border-border text-xs font-medium text-ink-secondary transition hover:border-sapphire/50 hover:text-sapphire"
      >
        <Plus size={13} />
        {messages.projectFlow.stages.add}
      </button>
    </div>
  );
}
