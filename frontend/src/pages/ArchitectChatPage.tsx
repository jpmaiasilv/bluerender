import { useEffect, useRef, useState } from 'react';
import { GraduationCap, PanelLeft } from 'lucide-react';
import { ToolLayout } from '../components/ToolLayout';
import { ArchitectChatSidebar } from '../components/architect-chat/ArchitectChatSidebar';
import { ArchitectChatMessageList } from '../components/architect-chat/ArchitectChatMessageList';
import { ArchitectChatComposer } from '../components/architect-chat/ArchitectChatComposer';
import { useLanguage } from '../i18n';
import { useWalletContext } from '../layouts/RootLayout';
import { ApiError, deleteArchitectConversation, fetchArchitectChatConfig, getArchitectConversation, listArchitectConversations, sendArchitectChatMessage } from '../lib/api';
import { ArchitectChatConfig, ArchitectChatConversationSummary, ArchitectChatMessage } from '../types';

/** Full ChatGPT-like page: a conversation rail on the left, messages in the middle, and a composer pinned to the bottom. */
export function ArchitectChatPage() {
  const { messages } = useLanguage();
  const t = messages.architectChat;
  const { refreshWallet } = useWalletContext();

  const [config, setConfig] = useState<ArchitectChatConfig | null>(null);
  const [conversations, setConversations] = useState<ArchitectChatConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ArchitectChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [preset, setPreset] = useState<{ text: string; seed: number }>({ text: '', seed: 0 });

  const objectUrlsRef = useRef<string[]>([]);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  useEffect(() => {
    fetchArchitectChatConfig()
      .then(setConfig)
      .catch(() => setConfig({ available: false, costCredits: 1 }));
    listArchitectConversations()
      .then(setConversations)
      .catch(() => undefined);
  }, []);

  function releaseObjectUrls() {
    for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
    objectUrlsRef.current = [];
  }

  async function openConversation(id: string) {
    releaseObjectUrls();
    setActiveId(id);
    try {
      const detail = await getArchitectConversation(id);
      setChatMessages(detail.messages);
    } catch {
      setChatMessages([]);
    }
  }

  function startNewConversation() {
    releaseObjectUrls();
    setActiveId(null);
    setChatMessages([]);
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t.deleteConfirmMessage)) return;
    try {
      await deleteArchitectConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeIdRef.current === id) startNewConversation();
    } catch {
      // Best-effort: it stays in the list and the user can retry.
    }
  }

  async function refreshConversationsList() {
    try {
      setConversations(await listArchitectConversations());
    } catch {
      // Non-critical: the locally reconciled state (from 'start'/'done' events) stays as-is.
    }
  }

  async function handleSend(text: string, files: File[]) {
    if (!config?.available || isStreaming) return;

    let imgIdx = 0;
    const localImageUrls = files.filter((f) => f.type.startsWith('image/')).map((f) => URL.createObjectURL(f));
    objectUrlsRef.current.push(...localImageUrls);

    const optimisticUser: ArchitectChatMessage = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      content: text,
      attachments: files.map((f) => ({
        kind: f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') ? 'audio' : 'document',
        url: f.type.startsWith('image/') ? localImageUrls[imgIdx++] : null,
        originalFileName: f.name,
        transcript: null,
      })),
      status: 'completed',
      errorCode: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
    };
    const assistantId = `local-assistant-${Date.now()}`;
    const optimisticAssistant: ArchitectChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      attachments: [],
      status: 'completed',
      errorCode: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
    };

    setChatMessages((prev) => [...prev, optimisticUser, optimisticAssistant]);
    setIsStreaming(true);

    const requestConversationId = activeIdRef.current ?? 'new';
    let resolvedConversationId: string | null = activeIdRef.current;

    try {
      await sendArchitectChatMessage(requestConversationId, text, files, (event) => {
        if (event.type === 'start') {
          resolvedConversationId = event.conversationId;
          if (!activeIdRef.current) {
            setActiveId(event.conversationId);
            const now = new Date().toISOString();
            setConversations((prev) => [{ id: event.conversationId, title: event.title, createdAt: now, updatedAt: now }, ...prev]);
          }
        } else if (event.type === 'delta') {
          setChatMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + event.text } : m)));
        } else if (event.type === 'done') {
          setConversations((prev) => {
            const idx = prev.findIndex((c) => c.id === event.conversationId);
            if (idx < 0) return prev;
            const updated = { ...prev[idx], title: event.title || prev[idx].title, updatedAt: new Date().toISOString() };
            return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
          });
        } else if (event.type === 'error') {
          setChatMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, status: 'failed', errorCode: event.code, errorMessage: event.message } : m)));
        }
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : messages.errors.titles.UNKNOWN_ERROR;
      setChatMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, status: 'failed', errorMessage: message } : m)));
    } finally {
      setIsStreaming(false);
      refreshWallet();
      if (resolvedConversationId) {
        const id = resolvedConversationId;
        getArchitectConversation(id)
          .then((detail) => {
            releaseObjectUrls();
            if (activeIdRef.current === id) setChatMessages(detail.messages);
          })
          .catch(() => undefined);
      }
      refreshConversationsList();
    }
  }

  const headerAction = (
    <button
      type="button"
      onClick={() => setMobileSidebarOpen(true)}
      aria-label={t.conversationsTitle}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-secondary transition hover:bg-surface-secondary md:hidden"
    >
      <PanelLeft size={18} />
    </button>
  );

  if (!config) {
    return (
      <ToolLayout title={t.title}>
        <div className="flex flex-1 items-center justify-center text-sm text-ink-muted">…</div>
      </ToolLayout>
    );
  }

  if (!config.available) {
    return (
      <ToolLayout title={t.title}>
        <div className="flex flex-1 flex-col items-center justify-center px-8 py-20 text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-sapphire-light">
            <GraduationCap size={28} className="text-sapphire" strokeWidth={1.75} />
          </div>
          <h1 className="text-xl font-semibold text-ink">{t.unavailableTitle}</h1>
          <p className="mt-2 max-w-md text-sm text-ink-secondary">{t.unavailableMessage}</p>
        </div>
      </ToolLayout>
    );
  }

  return (
    <ToolLayout title={t.title} bare>
      <div className="flex h-full min-h-0 flex-1 overflow-hidden">
        <ArchitectChatSidebar
          conversations={conversations}
          activeId={activeId}
          onSelect={openConversation}
          onNew={startNewConversation}
          onDelete={handleDelete}
          open={mobileSidebarOpen}
          onClose={() => setMobileSidebarOpen(false)}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 md:hidden">
            {headerAction}
            <span className="truncate text-sm font-medium text-ink">
              {activeId ? conversations.find((c) => c.id === activeId)?.title || t.untitledConversation : t.newConversation}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {chatMessages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-sapphire-light">
                  <GraduationCap size={26} className="text-sapphire" strokeWidth={1.75} />
                </span>
                <h1 className="text-lg font-semibold text-ink">{t.emptyStateTitle}</h1>
                <p className="mt-1.5 max-w-md text-sm text-ink-secondary">{t.emptyStateSubtitle}</p>
                <div className="mt-5 flex max-w-xl flex-wrap justify-center gap-2">
                  {t.emptyStateSuggestions.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPreset({ text: s, seed: Date.now() })}
                      className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs text-ink-secondary transition hover:border-sapphire/40 hover:text-sapphire"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <ArchitectChatMessageList messages={chatMessages} isStreaming={isStreaming} />
            )}
          </div>
          <ArchitectChatComposer disabled={isStreaming} costCredits={config.costCredits} onSend={handleSend} presetText={preset.text} presetSeed={preset.seed} />
        </div>
      </div>
    </ToolLayout>
  );
}
