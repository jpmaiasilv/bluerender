import { Sparkles } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { UPDATES } from '../../config/updates';
import { formatLocaleDate } from '../../lib/formatLocaleDate';
import { UPDATE_TAG_STYLES } from './updateTagStyles';

export function UpdatesCard() {
  const { messages, locale } = useLanguage();
  const t = messages.helpPage.updates;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sapphire-light">
          <Sparkles size={18} className="text-sapphire" strokeWidth={2} />
        </div>
        <div>
          <h2 className="font-semibold text-ink">{t.title}</h2>
          <p className="text-sm text-ink-secondary">{t.description}</p>
        </div>
      </div>

      <ol className="mt-5 flex flex-col gap-5 border-l border-border pl-5">
        {UPDATES.map((update) => {
          const item = t.items[update.id];
          if (!item) return null;
          const style = UPDATE_TAG_STYLES[update.tag];
          return (
            <li key={update.id} className="relative">
              <span className="absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-sapphire" />
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.bg} ${style.text}`}>
                  {t.tagLabels[update.tag]}
                </span>
                <span className="text-xs text-ink-muted">{formatLocaleDate(update.date, locale)}</span>
              </div>
              <h3 className="mt-1.5 text-sm font-semibold text-ink">{item.title}</h3>
              <p className="mt-0.5 text-sm leading-snug text-ink-secondary">{item.description}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
