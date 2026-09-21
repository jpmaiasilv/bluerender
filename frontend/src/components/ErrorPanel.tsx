import { JobErrorPayload } from '../types';
import { useLanguage } from '../i18n';

interface Props {
  error: JobErrorPayload;
  onRetry: () => void;
}

export function ErrorPanel({ error, onRetry }: Props) {
  const { messages } = useLanguage();

  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-red-200 bg-red-50 px-8 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-white">
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-danger">
          <path
            d="M12 9v4m0 4h.01M10.29 3.86l-8.18 14.18A2 2 0 004 21h16a2 2 0 001.89-2.96L13.71 3.86a2 2 0 00-3.42 0z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <p className="text-base font-medium text-ink">{messages.errors.titles[error.code]}</p>
      <p className="mt-1 max-w-sm text-sm text-ink-secondary">{error.message}</p>

      {error.details && (
        <details className="mt-4 w-full max-w-sm text-left">
          <summary className="cursor-pointer text-xs text-ink-muted hover:text-ink-secondary">
            {messages.errors.technicalDetails}
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-left text-xs text-ink-secondary">
            {error.details}
          </pre>
        </details>
      )}

      <button
        type="button"
        onClick={onRetry}
        className="mt-6 rounded-lg bg-white px-4 py-2 text-sm font-medium text-ink shadow-card transition hover:bg-surface-secondary"
      >
        {messages.errors.tryAgain}
      </button>
    </div>
  );
}
