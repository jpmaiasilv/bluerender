import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { useLanguage } from '../i18n';

const ACCEPTED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

interface Props {
  label: string;
  hint?: string;
  dragDropText: string;
  previewUrl: string | null;
  onFileSelected: (file: File) => void;
  onClear: () => void;
  disabled?: boolean;
  /** Smaller footprint for secondary/optional uploads, so they read as clearly optional. */
  compact?: boolean;
  /** Hide the label above the dropzone (used when it's the page's hero upload area). */
  hideLabel?: boolean;
  /** Optional size cap — a larger file is refused with fileTooLargeText instead of being selected. */
  maxSizeBytes?: number;
  fileTooLargeText?: string;
  /** When set, a "replace" button is shown next to "remove" while a preview is displayed. */
  replaceLabel?: string;
}

export function UploadDropzone({
  label,
  hint,
  dragDropText,
  previewUrl,
  onFileSelected,
  onClear,
  disabled,
  compact,
  hideLabel,
  maxSizeBytes,
  fileTooLargeText,
  replaceLabel,
}: Props) {
  const { messages } = useLanguage();
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError(messages.upload.unsupportedFormat);
      return;
    }
    if (maxSizeBytes && file.size > maxSizeBytes) {
      setError(fileTooLargeText ?? messages.upload.unsupportedFormat);
      return;
    }
    setError(null);
    onFileSelected(file);
  }

  return (
    <div className={compact ? undefined : 'flex h-full flex-1 flex-col'}>
      {!hideLabel && (
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{label}</span>
      )}
      {hint && <p className="mb-2 text-xs text-ink-muted">{hint}</p>}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (!disabled) handleFile(e.dataTransfer.files[0]);
        }}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition ${
          compact ? 'min-h-[110px]' : 'min-h-[320px] flex-1'
        } ${isDragging ? 'border-sapphire bg-sapphire-soft' : 'border-border bg-surface-secondary hover:border-sapphire/50'} ${
          disabled ? 'pointer-events-none opacity-60' : ''
        }`}
      >
        {previewUrl ? (
          <>
            <img
              src={previewUrl}
              alt={label}
              className={`w-full object-contain p-2 ${compact ? 'max-h-[160px]' : 'max-h-[60vh]'}`}
            />
            <div className="absolute right-2 top-2 flex max-w-[calc(100%-1rem)] flex-wrap justify-end gap-1.5">
              {replaceLabel && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    inputRef.current?.click();
                  }}
                  className="rounded-md bg-ink/70 px-2 py-1 text-xs text-white hover:bg-ink/90"
                >
                  {replaceLabel}
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClear();
                }}
                className="rounded-md bg-ink/70 px-2 py-1 text-xs text-white hover:bg-ink/90"
              >
                {messages.upload.remove}
              </button>
            </div>
          </>
        ) : (
          <div className="px-6 text-center">
            {!compact && (
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sapphire-light">
                <UploadCloud size={22} className="text-sapphire" />
              </div>
            )}
            <p className="text-sm font-medium text-ink">{dragDropText}</p>
            <p className="mt-1 text-xs text-ink-muted">{messages.upload.formats}</p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
}
