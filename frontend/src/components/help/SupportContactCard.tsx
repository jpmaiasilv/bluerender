import { useState } from 'react';
import { MessageCircleQuestion, Paperclip, X } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { SelectField } from '../SelectField';
import { UploadDropzone } from '../UploadDropzone';
import { SupportCategory, SupportTicketInput } from '../../lib/support/types';

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const CATEGORY_ORDER: SupportCategory[] = ['question', 'technical', 'financial', 'suggestion', 'other'];

const textareaClass =
  'w-full resize-none rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-muted focus:border-sapphire focus:ring-1 focus:ring-sapphire';
const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-muted focus:border-sapphire focus:ring-1 focus:ring-sapphire';

interface Props {
  category: SupportCategory;
  onCategoryChange: (category: SupportCategory) => void;
  onUploadAttachment: (file: File) => Promise<string>;
  onSubmit: (input: SupportTicketInput) => Promise<void>;
}

export function SupportContactCard({ category, onCategoryChange, onUploadAttachment, onSubmit }: Props) {
  const { messages } = useLanguage();
  const t = messages.helpPage.contact;

  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<'success' | 'error' | null>(null);

  function handleFileSelected(selected: File) {
    if (selected.size > MAX_ATTACHMENT_BYTES) {
      setFileError(t.attachmentHint);
      return;
    }
    setFileError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
  }

  function clearFile() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setFileError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !message.trim() || submitting) return;

    setSubmitting(true);
    setFeedback(null);
    try {
      const attachmentPath = file ? await onUploadAttachment(file) : null;
      await onSubmit({ category, subject: subject.trim(), message: message.trim(), attachmentPath });
      setSubject('');
      setMessage('');
      clearFile();
      setFeedback('success');
    } catch {
      setFeedback('error');
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = subject.trim().length > 0 && message.trim().length > 0 && !submitting;

  return (
    <div id="fale-com-a-gente" className="scroll-mt-6 rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sapphire-light">
          <MessageCircleQuestion size={18} className="text-sapphire" strokeWidth={2} />
        </div>
        <div>
          <h2 className="font-semibold text-ink">{t.title}</h2>
          <p className="text-sm text-ink-secondary">{t.description}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
        <SelectField
          label={t.categoryLabel}
          value={category}
          onChange={(value) => onCategoryChange(value as SupportCategory)}
          options={CATEGORY_ORDER.map((key) => ({ value: key, label: t.categoryOptions[key] }))}
        />

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.subjectLabel}</span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t.subjectPlaceholder}
            maxLength={200}
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.messageLabel}</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t.messagePlaceholder}
            rows={5}
            maxLength={5000}
            className={textareaClass}
          />
        </label>

        <div>
          <UploadDropzone
            label={t.attachmentLabel}
            hint={t.attachmentHint}
            dragDropText={t.attachmentDragText}
            previewUrl={previewUrl}
            onFileSelected={handleFileSelected}
            onClear={clearFile}
            compact
            disabled={submitting}
          />
          {file && !fileError && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-secondary">
              <Paperclip size={12} />
              {file.name}
              <button
                type="button"
                onClick={clearFile}
                className="ml-1 text-ink-muted transition hover:text-danger"
                aria-label={messages.upload.remove}
              >
                <X size={12} />
              </button>
            </p>
          )}
          {fileError && <p className="mt-1.5 text-xs text-danger">{fileError}</p>}
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-1 self-start rounded-lg bg-sapphire px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:bg-sapphire-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? t.submitting : t.submit}
        </button>

        {feedback === 'success' && (
          <div className="rounded-lg bg-success/10 px-3.5 py-3 text-sm text-success">
            <p className="font-medium">{t.successTitle}</p>
            <p className="mt-0.5 text-success/90">{t.successBody}</p>
          </div>
        )}
        {feedback === 'error' && <p className="text-sm text-danger">{t.errorGeneric}</p>}
      </form>
    </div>
  );
}
