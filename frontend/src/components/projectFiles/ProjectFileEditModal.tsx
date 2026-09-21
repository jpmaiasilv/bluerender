import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '../Modal';
import { SelectField } from '../SelectField';
import { useLanguage } from '../../i18n';
import { ProjectFile, ProjectFileCategory, ProjectFileUpdate } from '../../lib/projectFiles/types';

const CATEGORY_ORDER: ProjectFileCategory[] = [
  'project',
  'contract',
  'financial',
  'invoice',
  'image',
  'client_document',
  'survey',
  'other',
];

const TITLE_ID = 'project-file-edit-title';

interface Props {
  file: ProjectFile | null;
  onClose: () => void;
  onSave: (id: string, patch: ProjectFileUpdate) => Promise<unknown>;
}

export function ProjectFileEditModal({ file, onClose, onSave }: Props) {
  const { messages } = useLanguage();
  const t = messages.projectFiles.edit;

  const [name, setName] = useState('');
  const [category, setCategory] = useState<ProjectFileCategory>('other');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!file) return;
    setName(file.name);
    setCategory(file.category);
    setDescription(file.description ?? '');
    setError(false);
  }, [file]);

  function handleClose() {
    if (submitting) return;
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !name.trim() || submitting) return;
    setSubmitting(true);
    setError(false);
    try {
      await onSave(file.id, { name: name.trim(), category, description: description.trim() || null });
      onClose();
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={file !== null} onClose={handleClose} labelledBy={TITLE_ID} panelClassName="w-full max-w-[440px]">
      <form onSubmit={handleSubmit} className="flex max-h-[85vh] flex-col">
        <div className="border-b border-border px-6 py-4">
          <h2 id={TITLE_ID} className="text-base font-semibold text-ink">
            {t.modalTitle}
          </h2>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.nameLabel}</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire"
            />
          </label>

          <SelectField
            label={t.categoryLabel}
            value={category}
            onChange={(value) => setCategory(value as ProjectFileCategory)}
            options={CATEGORY_ORDER.map((key) => ({ value: key, label: messages.projectFiles.categories[key] }))}
          />

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.descriptionLabel}</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={1000}
              className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire"
            />
          </label>

          {error && <p className="text-sm text-danger">{t.errorGeneric}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink-secondary transition hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {messages.projectFlow.form.cancel}
          </button>
          <button
            type="submit"
            disabled={!name.trim() || submitting}
            className="flex items-center gap-1.5 rounded-lg bg-sapphire px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:bg-sapphire-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting ? t.submitting : t.submit}
          </button>
        </div>
      </form>
    </Modal>
  );
}
