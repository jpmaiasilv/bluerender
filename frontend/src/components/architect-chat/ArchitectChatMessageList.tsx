import { useEffect, useRef } from 'react';
import { FileAudio, FileText, GraduationCap } from 'lucide-react';
import { ArchitectChatAttachment, ArchitectChatMessage } from '../../types';
import { useLanguage } from '../../i18n';
import { MarkdownLite } from '../../lib/markdownLite';

interface Props {
  messages: ArchitectChatMessage[];
  /** True while the assistant's reply is still streaming in — shows a "thinking" indicator on an empty trailing assistant message. */
  isStreaming: boolean;
}

function AttachmentChip({ attachment }: { attachment: ArchitectChatAttachment }) {
  const { messages } = useLanguage();
  const t = messages.architectChat;
  if (attachment.kind === 'image') {
    return attachment.url ? (
      <a href={attachment.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-border">
        <img src={attachment.url} alt={attachment.originalFileName ?? ''} className="max-h-64 w-auto max-w-full object-cover" />
      </a>
    ) : null;
  }
  const Icon = attachment.kind === 'audio' ? FileAudio : FileText;
  return (
    <div className="flex max-w-xs flex-col gap-1 rounded-xl border border-border bg-surface-secondary px-3 py-2">
      <div className="flex items-center gap-2 text-xs font-medium text-ink-secondary">
        <Icon size={14} />
        <span className="truncate">{attachment.originalFileName ?? attachment.kind}</span>
      </div>
      {attachment.kind === 'audio' && attachment.transcript && (
        <p className="text-xs text-ink-muted">
          <span className="font-medium">{t.transcriptLabel}:</span> {attachment.transcript}
        </p>
      )}
    </div>
  );
}

function UserBubble({ message }: { message: ArchitectChatMessage }) {
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[80%] flex-col items-end gap-2">
        {message.attachments.length > 0 && (
          <div className="flex flex-col items-end gap-2">
            {message.attachments.map((a, i) => (
              <AttachmentChip key={i} attachment={a} />
            ))}
          </div>
        )}
        {message.content && (
          <div className="whitespace-pre-wrap rounded-2xl bg-surface-secondary px-4 py-2.5 text-sm text-ink">{message.content}</div>
        )}
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-muted [animation-delay:-0.2s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-muted [animation-delay:-0.1s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-muted" />
    </span>
  );
}

function AssistantBubble({ message, showThinking }: { message: ArchitectChatMessage; showThinking: boolean }) {
  const { messages } = useLanguage();
  const t = messages.architectChat;

  return (
    <div className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sapphire-light text-sapphire">
        <GraduationCap size={16} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5 text-sm text-ink">
        {message.status === 'failed' ? (
          <div>
            <p className="text-danger">{message.errorMessage}</p>
            <p className="mt-1 text-xs text-ink-muted">{t.failureNoCharge}</p>
          </div>
        ) : message.content ? (
          <MarkdownLite text={message.content} className="flex flex-col gap-2" />
        ) : showThinking ? (
          <ThinkingDots />
        ) : null}
      </div>
    </div>
  );
}

export function ArchitectChatMessageList({ messages, isStreaming }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, isStreaming]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
      {messages.map((m, i) => {
        const isLast = i === messages.length - 1;
        return m.role === 'user' ? (
          <UserBubble key={m.id} message={m} />
        ) : (
          <AssistantBubble key={m.id} message={m} showThinking={isStreaming && isLast} />
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
