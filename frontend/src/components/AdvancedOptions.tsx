import { ReactNode, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

/** Reusable collapsible section — used to keep secondary tool settings out of the way by default. */
export function AdvancedOptions({ title, children, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-border pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-sm font-medium text-ink-secondary transition hover:text-ink"
      >
        {title}
        <ChevronDown size={16} className={`text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="mt-4 flex flex-col gap-5">{children}</div>}
    </div>
  );
}
