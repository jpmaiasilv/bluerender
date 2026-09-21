import { ReactNode } from 'react';

interface Props {
  title: string;
  description?: string;
  /** Render nothing else around the content (used by full-bleed "coming soon" pages). */
  bare?: boolean;
  /** Optional right-aligned controls next to the title (e.g. History / New buttons). */
  actions?: ReactNode;
  children: ReactNode;
}

/** Shared page shell every tool route renders inside — consistent title/description header. */
export function ToolLayout({ title, description, bare, actions, children }: Props) {
  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      {!bare && (
        <div className="flex items-start justify-between gap-4 border-b border-border px-8 py-5">
          <div>
            <h1 className="text-lg font-semibold text-ink">{title}</h1>
            {description && <p className="mt-1 text-sm text-ink-secondary">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="flex flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  );
}
