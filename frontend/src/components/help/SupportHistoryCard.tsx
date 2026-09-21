import { useState } from 'react';
import { ChevronDown, Paperclip } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { SupportTicket } from '../../lib/support/types';
import { formatLocaleDate } from '../../lib/formatLocaleDate';
import { TICKET_STATUS_STYLES } from './ticketStatusStyles';

interface Props {
  tickets: SupportTicket[];
  loading: boolean;
  getAttachmentSignedUrl: (path: string) => Promise<string | null>;
}

export function SupportHistoryCard({ tickets, loading, getAttachmentSignedUrl }: Props) {
  const { messages, locale } = useLanguage();
  const t = messages.helpPage.history;
  const categoryLabels = messages.helpPage.contact.categoryOptions;

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string | null>>({});

  async function toggle(ticket: SupportTicket) {
    const next = expandedId === ticket.id ? null : ticket.id;
    setExpandedId(next);
    if (next && ticket.attachmentPath && !(ticket.id in attachmentUrls)) {
      const url = await getAttachmentSignedUrl(ticket.attachmentPath);
      setAttachmentUrls((prev) => ({ ...prev, [ticket.id]: url }));
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <h2 className="font-semibold text-ink">{t.title}</h2>

      {loading ? (
        <p className="mt-4 text-sm text-ink-secondary">…</p>
      ) : tickets.length === 0 ? (
        <p className="mt-4 text-sm text-ink-secondary">{t.empty}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {tickets.map((ticket) => {
            const style = TICKET_STATUS_STYLES[ticket.status];
            const isOpen = expandedId === ticket.id;
            return (
              <li key={ticket.id} className="overflow-hidden rounded-xl border border-border">
                <button
                  type="button"
                  onClick={() => toggle(ticket)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-secondary"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{ticket.subject}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {categoryLabels[ticket.category]} · {formatLocaleDate(ticket.createdAt, locale)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                      {t.statusLabels[ticket.status]}
                    </span>
                    <ChevronDown size={16} className={`text-ink-muted transition ${isOpen ? 'rotate-180' : ''}`} />
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-border bg-surface-secondary/50 px-4 py-4">
                    <div className="max-w-[85%] rounded-xl rounded-tl-sm bg-surface px-3.5 py-2.5 text-sm text-ink shadow-sm">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{t.yourMessage}</p>
                      <p className="whitespace-pre-wrap">{ticket.message}</p>
                      {ticket.attachmentPath && (
                        <a
                          href={attachmentUrls[ticket.id] ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                          className={`mt-2 flex w-fit items-center gap-1.5 text-xs font-medium text-sapphire hover:underline ${
                            attachmentUrls[ticket.id] ? '' : 'pointer-events-none opacity-50'
                          }`}
                        >
                          <Paperclip size={12} />
                          {t.attachment}
                        </a>
                      )}
                    </div>

                    {ticket.adminResponse ? (
                      <div className="ml-auto mt-3 max-w-[85%] rounded-xl rounded-tr-sm bg-sapphire-light px-3.5 py-2.5 text-sm text-ink shadow-sm">
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-sapphire">{t.teamResponse}</p>
                        <p className="whitespace-pre-wrap">{ticket.adminResponse}</p>
                        {ticket.respondedAt && (
                          <p className="mt-1.5 text-[11px] text-ink-muted">
                            {t.respondedOn} {formatLocaleDate(ticket.respondedAt, locale)}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-ink-muted">{t.awaitingResponse}</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
