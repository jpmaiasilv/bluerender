import { useEffect, useState } from 'react';
import { Coins, ShoppingBag } from 'lucide-react';
import { useWalletContext } from '../../layouts/RootLayout';
import { loadHistory } from '../../lib/history';
import { HistoryEntry } from '../../types';
import { useLanguage, Messages } from '../../i18n';

/** Engine tier label sets differ per tool (Render IA's Fast/Standard/Pro vs.
 * Imagem por Texto's / Gerador de Ideias' Fast/Pro/Ultra) — look up the one
 * matching the entry's tool. */
function engineLabelFor(entry: HistoryEntry, messages: Messages): string {
  const tierNames =
    entry.toolId === 'imagemPorTexto'
      ? messages.textToImage.engineTierNames
      : entry.toolId === 'ideaGenerator'
        ? messages.ideaGenerator.engineTierNames
        : messages.engines.tierNames;
  return (tierNames as Record<string, string>)[entry.engine] ?? entry.engine;
}

/**
 * The balance shown here is the exact same `walletBalance` the header reads
 * (via RootLayout's outlet context) — no second credits state, no hardcoded
 * number. The history list reuses the same real generation records that power
 * "Recent Tests" / the History page (localStorage), not fabricated transactions.
 */
export function CreditsSection() {
  const { messages } = useLanguage();
  const { walletBalance } = useWalletContext();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    setEntries(loadHistory());
  }, []);

  const t = messages.settings;

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="text-base font-semibold text-ink">{t.credits.title}</h2>

      <div className="rounded-xl border border-border bg-sapphire-light p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-sapphire/80">{t.credits.availableBalance}</p>
        <div className="mt-1 flex items-center gap-2">
          <Coins size={22} className="text-sapphire" />
          <span className="text-3xl font-bold text-ink">{walletBalance}</span>
          <span className="text-sm text-ink-secondary">{messages.wallet.creditsLabel}</span>
        </div>
        <p className="mt-3 text-sm text-ink-secondary">{t.credits.explanation1}</p>
        <p className="text-sm text-ink-secondary">{t.credits.explanation2}</p>

        <button
          type="button"
          disabled
          title={t.comingSoonLockTooltip}
          className="mt-4 flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-border bg-surface px-4 py-2 text-sm font-medium text-ink-muted disabled:cursor-not-allowed"
        >
          <ShoppingBag size={15} />
          {messages.creditsDropdown.buyCredits} · {t.comingSoonBadge}
        </button>
      </div>

      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t.credits.historyTitle}</h3>
        {entries.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface-secondary px-4 py-6 text-center text-sm text-ink-muted">
            {t.credits.historyEmpty}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {entries.slice(0, 15).map((entry) => (
              <li key={`${entry.requestId}-${entry.timestamp}`} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-ink">{messages.nav.items[entry.toolId]}</p>
                  <p className="text-xs text-ink-muted">
                    {new Date(entry.timestamp).toLocaleString()} · {engineLabelFor(entry, messages)}
                  </p>
                </div>
                <span className="font-medium text-danger">
                  −{messages.wallet.creditsSuffix(entry.creditsCharged)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
