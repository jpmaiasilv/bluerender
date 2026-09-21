import { useRef, useState } from 'react';
import { Loader2, Paperclip, UploadCloud, X } from 'lucide-react';
import { Modal } from '../Modal';
import { SelectField } from '../SelectField';
import { useLanguage } from '../../i18n';
import { ALLOWED_PROJECT_FILE_EXTENSIONS, MAX_PROJECT_FILE_BYTES, PROJECT_FILE_ACCEPT, isAllowedProjectFileName } from '../../config/projectFiles';
import { ProjectFileCategory } from '../../lib/projectFiles/types';
import { UploadProjectFileInput } from '../../lib/projectFiles/useProjectFiles';
import { formatFileSize } from '../../lib/formatFileSize';

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

const TITLE_ID = 'project-file-upload-title';

interface Props {
  open: boolean;
  onClose: () => void;
  initialCategory: ProjectFileCategory;
  onUpload: (input: UploadProjectFileInput) => Promise<unknown>;
}

export function ProjectFileUploadModal({ open, onClose, initialCategory, onUpload }: Props) {
  const { messages, locale } = useLanguage();
  const t = messages.projectFiles.upload;

  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ProjectFileCategory>(initialCategory);
  const [description, setDescription] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<'success' | 'error' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setName('');
    setCategory(initialCategory);
    setDescription('');
    setFileError(null);
    setFeedback(null);
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  function handleFile(selected: File | undefined) {
    if (!selected) return;
    if (!isAllowedProjectFileName(selected.name)) {
      setFileError(t.invalidFormat);
      return;
    }
    if (selected.size > MAX_PROJECT_FILE_BYTES) {
      setFileError(t.tooLarge);
      return;
    }
    setFileError(null);
    setFile(selected);
    setName(selected.name);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !name.trim() || submitting) return;

    setSubmitting(true);
    setFeedback(null);
    try {
      await onUpload({ file, name: name.trim(), category, description: description.trim() || null });
      setFeedback('success');
      setTimeout(() => {
        reset();
        onClose();
      }, 900);
    } catch {
      setFeedback('error');
      setSubmitting(false);
    }
  }

  const canSubmit = Boolean(file) && name.trim().length > 0 && !submitting;

  return (
    <Modal open={open} onClose={handleClose} labelledBy={TITLE_ID} panelClassName="w-full max-w-[480px]">
      <form onSubmit={handleSubmit} className="flex max-h-[85vh] flex-col">
        <div className="border-b border-border px-6 py-4">
          <h2 id={TITLE_ID} className="text-base font-semibold text-ink">
            {t.modalTitle}
          </h2>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div>
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.fileLabel}</span>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!submitting) setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (!submitting) handleFile(e.dataTransfer.files[0]);
              }}
              className={`flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 text-center transition ${
                isDragging ? 'border-sapphire bg-sapphire-soft' : 'border-border bg-surface-secondary'
              }`}
            >
              {file ? (
                <div className="flex w-full items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm text-ink-secondary shadow-sm">
                  <Paperclip size={14} className="shrink-0" />
                  <span className="flex-1 truncate text-left">{file.name}</span>
                  <span className="shrink-0 text-xs text-ink-muted">{formatFileSize(file.size, locale)}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      setName('');
                    }}
                    className="shrink-0 text-ink-muted transition hover:text-danger"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <UploadCloud size={22} className="text-sapphire" />
                  <p className="text-sm text-ink-secondary">{t.dragDropText}</p>
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-sapphire"
                  >
                    {t.selectFileButton}
                  </button>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                accept={PROJECT_FILE_ACCEPT}
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-ink-muted">{t.formatsHint}</p>
            {fileError && <p className="mt-1.5 text-xs text-danger">{fileError}</p>}
          </div>

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
              placeholder={t.descriptionPlaceholder}
              rows={3}
              maxLength={1000}
              className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-muted focus:border-sapphire focus:ring-1 focus:ring-sapphire"
            />
          </label>

          {feedback === 'success' && <p className="text-sm font-medium text-success">{t.successMessage}</p>}
          {feedback === 'error' && <p className="text-sm text-danger">{t.errorGeneric}</p>}
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
            disabled={!canSubmit}
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
