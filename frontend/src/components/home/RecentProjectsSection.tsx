import { useEffect, useState } from 'react';
import { ChevronRight, ImageOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../i18n';
import { historyEntryTitle, loadHistory } from '../../lib/history';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { HistoryEntry, isVideoHistoryEntry } from '../../types';

const MAX_RECENT = 3;

function RecentProjectCard({ entry }: { entry: HistoryEntry }) {
  const { messages, locale } = useLanguage();
  const [thumbFailed, setThumbFailed] = useState(false);

  return (
    <Link
      to={`/historico?tool=${entry.toolId}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-sapphire/30 hover:shadow-md"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-secondary">
        {thumbFailed ? (
          <div className="flex h-full w-full items-center justify-center text-ink-muted">
            <ImageOff size={22} />
          </div>
        ) : isVideoHistoryEntry(entry) ? (
          <video src={entry.imageUrl} className="h-full w-full object-cover" muted onError={() => setThumbFailed(true)} />
        ) : (
          <img
            src={entry.imageUrl}
            alt=""
            className="h-full w-full object-cover transition duration-200 ease-out group-hover:scale-[1.02]"
            onError={() => setThumbFailed(true)}
          />
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-4 py-3">
        <p className="truncate text-sm font-medium text-ink">{historyEntryTitle(entry, messages)}</p>
        <p className="truncate text-xs text-ink-muted">
          {messages.nav.items[entry.toolId]} · {formatRelativeTime(entry.timestamp, locale)}
        </p>
      </div>
    </Link>
  );
}

export function RecentProjectsSection() {
  const { messages } = useLanguage();
  const t = messages.home.recentProjects;
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    setEntries(loadHistory().slice(0, MAX_RECENT));
  }, []);

  if (entries === null) return null;

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">{t.title}</h2>
        {entries.length > 0 && (
          <Link to="/historico" className="flex items-center gap-0.5 text-sm font-medium text-sapphire hover:underline">
            {t.viewAll}
            <ChevronRight size={15} />
          </Link>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="mt-3 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-surface-secondary/60 py-10 text-center">
          <p className="text-sm text-ink-secondary">{t.emptyTitle}</p>
          <Link
            to="/render"
            className="rounded-lg bg-sapphire px-4 py-2 text-sm font-medium text-white transition hover:bg-sapphire-hover"
          >
            {t.emptyCta}
          </Link>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((entry) => (
            <RecentProjectCard key={`${entry.requestId}-${entry.timestamp}`} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}
