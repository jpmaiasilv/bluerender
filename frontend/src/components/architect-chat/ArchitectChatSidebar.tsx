import { MessageSquarePlus, Trash2 } from 'lucide-react';
import { ArchitectChatConversationSummary } from '../../types';
import { useLanguage } from '../../i18n';
import { formatRelativeTime } from '../../lib/formatRelativeTime';

interface Props {
  conversations: ArchitectChatConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  /** On narrow screens the sidebar is an overlay; `open` controls whether it is shown. Always visible from md upward regardless of this flag. */
  open: boolean;
  onClose: () => void;
}

/** The ChatGPT-like left rail: "New conversation" action on top, then the conversation list, newest first. A fixed overlay (with backdrop) below the md breakpoint, a static column from md upward. */
export function ArchitectChatSidebar({ conversations, activeId, onSelect, onNew, onDelete, open, onClose }: Props) {
  const { messages, locale } = useLanguage();
  const t = messages.architectChat;

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-ink/30 md:hidden" onClick={onClose} aria-hidden="true" />}
      <aside
        className={`${open ? 'fixed inset-y-0 left-0 z-40 flex w-72 shadow-xl' : 'hidden'} shrink-0 flex-col border-r border-border bg-surface-secondary md:static md:z-auto md:flex md:w-64 md:shadow-none`}
      >
        <div className="p-3">
          <button
            type="button"
            onClick={() => {
              onNew();
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-medium text-ink shadow-card transition hover:border-sapphire/40 hover:text-sapphire"
          >
            <MessageSquarePlus size={16} />
            {t.newConversation}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          <p className="mb-1.5 mt-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-ink-muted/80">{t.conversationsTitle}</p>
          {conversations.length === 0 && <p className="px-2 py-4 text-xs text-ink-muted">{t.noConversations}</p>}
          <ul className="flex flex-col gap-0.5">
            {conversations.map((c) => (
              <li key={c.id}>
                <div
                  className={`group flex items-center gap-1 rounded-lg px-2 py-2 text-sm transition ${
                    c.id === activeId ? 'bg-sapphire-light font-medium text-sapphire' : 'text-ink-secondary hover:bg-surface'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(c.id);
                      onClose();
                    }}
                    className="min-w-0 flex-1 truncate text-left"
                  >
                    {c.title || t.untitledConversation}
                  </button>
                  <span className="shrink-0 text-[10px] text-ink-muted group-hover:hidden">{formatRelativeTime(Date.parse(c.updatedAt), locale)}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(c.id);
                    }}
                    aria-label={t.deleteConversation}
                    title={t.deleteConversation}
                    className="hidden shrink-0 rounded-md p-1 text-ink-muted transition hover:bg-danger/10 hover:text-danger group-hover:block"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </>
  );
}
