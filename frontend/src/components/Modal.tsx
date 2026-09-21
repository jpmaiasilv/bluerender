import { ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useLanguage } from '../i18n';

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
  /** Tailwind width/height classes for the dialog panel. */
  panelClassName?: string;
}

/**
 * Generic centered modal: dark/blurred overlay, click-outside-to-close, ESC to
 * close, and a basic focus trap (Tab cycles within the dialog, focus returns to
 * the trigger element on close). No app-specific content lives here — reused by
 * any future modal, not just the upgrade one.
 */
export function Modal({ open, onClose, children, labelledBy, panelClassName = 'w-full max-w-[900px]' }: Props) {
  const { messages } = useLanguage();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`relative z-10 flex max-h-[85vh] ${panelClassName} flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl outline-none`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={messages.common.close}
          className="absolute right-4 top-4 z-20 flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-secondary hover:text-ink"
        >
          <X size={18} />
        </button>
        {children}
      </div>
    </div>,
    document.body
  );
}
