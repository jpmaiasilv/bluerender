import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bug, Coins, CreditCard, Lightbulb } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { SupportCategory } from '../../lib/support/types';

const cardClass =
  'group flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 text-left shadow-card transition hover:-translate-y-0.5 hover:border-sapphire/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sapphire';

function ShortcutIcon({ children }: { children: ReactNode }) {
  return <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sapphire-light">{children}</div>;
}

interface Props {
  onFocusForm: (category: SupportCategory) => void;
}

export function HelpShortcuts({ onFocusForm }: Props) {
  const { messages } = useLanguage();
  const t = messages.helpPage.shortcuts;

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t.title}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/configuracoes/plano" className={cardClass}>
          <ShortcutIcon>
            <CreditCard size={20} className="text-sapphire" strokeWidth={2} />
          </ShortcutIcon>
          <div>
            <h3 className="font-semibold text-ink">{t.plans.title}</h3>
            <p className="mt-1 text-sm leading-snug text-ink-secondary">{t.plans.description}</p>
          </div>
        </Link>

        <Link to="/configuracoes/creditos" className={cardClass}>
          <ShortcutIcon>
            <Coins size={20} className="text-sapphire" strokeWidth={2} />
          </ShortcutIcon>
          <div>
            <h3 className="font-semibold text-ink">{t.credits.title}</h3>
            <p className="mt-1 text-sm leading-snug text-ink-secondary">{t.credits.description}</p>
          </div>
        </Link>

        <button type="button" onClick={() => onFocusForm('technical')} className={cardClass}>
          <ShortcutIcon>
            <Bug size={20} className="text-sapphire" strokeWidth={2} />
          </ShortcutIcon>
          <div>
            <h3 className="font-semibold text-ink">{t.reportIssue.title}</h3>
            <p className="mt-1 text-sm leading-snug text-ink-secondary">{t.reportIssue.description}</p>
          </div>
        </button>

        <button type="button" onClick={() => onFocusForm('suggestion')} className={cardClass}>
          <ShortcutIcon>
            <Lightbulb size={20} className="text-sapphire" strokeWidth={2} />
          </ShortcutIcon>
          <div>
            <h3 className="font-semibold text-ink">{t.suggestTool.title}</h3>
            <p className="mt-1 text-sm leading-snug text-ink-secondary">{t.suggestTool.description}</p>
          </div>
        </button>
      </div>
    </section>
  );
}
