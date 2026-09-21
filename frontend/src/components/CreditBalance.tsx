import { useEffect, useRef, useState } from 'react';
import { Coins, ShoppingBag, Zap } from 'lucide-react';
import { useLanguage } from '../i18n';

interface Props {
  balance: number;
  onOpenUpgrade: () => void;
}

/**
 * Clicking the balance opens a small dropdown. Per the product spec, this only
 * ever shows data we actually have (the real balance) — plan/usage/renewal-date
 * rows are intentionally omitted rather than faked, since there's no subscription
 * system yet to source them from.
 */
export function CreditBalance({ balance, onOpenUpgrade }: Props) {
  const { messages } = useLanguage();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-border bg-surface-secondary px-3 py-1.5 text-sm transition hover:border-sapphire/40"
      >
        <Coins size={16} className="text-sapphire" />
        <span className="font-semibold text-ink">{balance}</span>
        <span className="text-ink-secondary">{messages.wallet.creditsLabel}</span>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-border bg-surface p-3 shadow-card">
          <p className="px-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
            {messages.creditsDropdown.currentBalance}
          </p>
          <p className="mt-1 px-1 text-2xl font-semibold text-ink">{balance}</p>

          <div className="my-3 h-px bg-border" />

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenUpgrade();
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-sapphire py-2 text-sm font-semibold text-white transition hover:bg-sapphire-hover"
          >
            <Zap size={14} fill="currentColor" />
            {messages.upgrade.button}
          </button>

          <div className="mt-2 flex cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-sm font-medium text-ink-muted">
            <ShoppingBag size={14} />
            {messages.creditsDropdown.buyCredits}
            <span className="text-xs">({messages.creditsDropdown.buyCreditsComingSoon})</span>
          </div>
        </div>
      )}
    </div>
  );
}
