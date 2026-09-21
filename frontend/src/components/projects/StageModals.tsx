import { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { SelectField } from '../SelectField';
import { useLanguage } from '../../i18n';
import { ProjectStage } from '../../lib/projects/types';

interface RenameProps {
  stage: ProjectStage | null;
  onClose: () => void;
  onConfirm: (name: string) => void;
}

export function RenameStageModal({ stage, onClose, onConfirm }: RenameProps) {
  const { messages } = useLanguage();
  const t = messages.projectFlow.stages;
  const [name, setName] = useState('');

  useEffect(() => {
    setName(stage?.name ?? '');
  }, [stage]);

  return (
    <Modal open={stage !== null} onClose={onClose} labelledBy="rename-stage-title" panelClassName="w-full max-w-[360px]">
      {stage && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onConfirm(name.trim());
          }}
          className="flex flex-col gap-4 px-6 py-6"
        >
          <h2 id="rename-stage-title" className="text-base font-semibold text-ink">
            {t.rename}
          </h2>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-sapphire focus:ring-1 focus:ring-sapphire"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink-secondary hover:border-sapphire/40">
              {messages.financial.form.cancel}
            </button>
            <button type="submit" className="rounded-lg bg-sapphire px-4 py-2 text-sm font-medium text-white hover:bg-sapphire-hover">
              {messages.financial.form.save}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

interface AddProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (name: string) => void;
}

export function AddStageModal({ open, onClose, onConfirm }: AddProps) {
  const { messages } = useLanguage();
  const t = messages.projectFlow.stages;
  const [name, setName] = useState('');

  useEffect(() => {
    if (open) setName('');
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} labelledBy="add-stage-title" panelClassName="w-full max-w-[360px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onConfirm(name.trim());
        }}
        className="flex flex-col gap-4 px-6 py-6"
      >
        <h2 id="add-stage-title" className="text-base font-semibold text-ink">
          {t.add}
        </h2>
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.namePlaceholder}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-sapphire focus:ring-1 focus:ring-sapphire"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink-secondary hover:border-sapphire/40">
            {messages.financial.form.cancel}
          </button>
          <button type="submit" className="rounded-lg bg-sapphire px-4 py-2 text-sm font-medium text-white hover:bg-sapphire-hover">
            {messages.financial.form.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface DeleteProps {
  stage: ProjectStage | null;
  otherStages: ProjectStage[];
  projectCount: number;
  onClose: () => void;
  onConfirm: (migrateToStageId: string) => void;
}

export function DeleteStageModal({ stage, otherStages, projectCount, onClose, onConfirm }: DeleteProps) {
  const { messages } = useLanguage();
  const t = messages.projectFlow.stages;
  const [target, setTarget] = useState(otherStages[0]?.id ?? '');

  useEffect(() => {
    setTarget(otherStages[0]?.id ?? '');
  }, [stage, otherStages]);

  return (
    <Modal open={stage !== null} onClose={onClose} labelledBy="delete-stage-title" panelClassName="w-full max-w-[400px]">
      {stage && (
        <div className="flex flex-col gap-4 px-6 py-6">
          <h2 id="delete-stage-title" className="text-base font-semibold text-ink">
            {t.deleteConfirmTitle(stage.name)}
          </h2>
          {projectCount > 0 && (
            <>
              <p className="text-sm text-ink-secondary">{t.deleteMigratePrompt(projectCount)}</p>
              <SelectField label={t.moveProjectsTo} value={target} options={otherStages.map((s) => ({ value: s.id, label: s.name }))} onChange={setTarget} />
            </>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink-secondary hover:border-sapphire/40">
              {messages.financial.form.cancel}
            </button>
            <button
              type="button"
              disabled={projectCount > 0 && !target}
              onClick={() => onConfirm(target)}
              className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90 disabled:opacity-50"
            >
              {t.delete}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
