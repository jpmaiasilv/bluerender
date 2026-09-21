import { useEffect, useRef, useState } from 'react';
import { ArrowUp, FileAudio, Mic, Paperclip, Square, X } from 'lucide-react';
import { useLanguage } from '../../i18n';

const MAX_ATTACHMENTS = 6;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/webp,audio/webm,audio/mpeg,audio/mp3,audio/wav,audio/mp4,audio/ogg,text/plain';

interface PendingAttachment {
  file: File;
  previewUrl: string | null;
}

interface Props {
  disabled?: boolean;
  costCredits: number;
  onSend: (text: string, files: File[]) => void;
  /** Set the composer's text from outside (e.g. an empty-state suggestion chip). Bump `presetSeed` every time `presetText` should be (re-)applied, even to the same string. */
  presetText?: string;
  presetSeed?: number;
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/** A ChatGPT-like composer: auto-growing textarea, a pill-shaped container, attach + mic + send controls, and attachment chips above the input. */
export function ArchitectChatComposer({ disabled, costCredits, onSend, presetText, presetSeed }: Props) {
  const { messages } = useLanguage();
  const t = messages.architectChat;
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(() => {
    if (!presetSeed) return;
    setText(presetText ?? '');
    textareaRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetSeed]);

  useEffect(() => {
    return () => {
      for (const a of attachments) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addFiles(files: FileList | File[]) {
    setAttachError(null);
    const incoming = Array.from(files);
    const next: PendingAttachment[] = [];
    for (const file of incoming) {
      if (file.size > MAX_FILE_BYTES) {
        setAttachError(t.fileTooLarge);
        continue;
      }
      next.push({ file, previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null });
    }
    setAttachments((prev) => {
      const combined = [...prev, ...next];
      if (combined.length > MAX_ATTACHMENTS) {
        setAttachError(t.attachTooMany(MAX_ATTACHMENTS));
        return combined.slice(0, MAX_ATTACHMENTS);
      }
      return combined;
    });
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => {
      const target = prev[index];
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) addFiles(e.target.files);
    e.target.value = '';
  }

  async function startRecording() {
    setAttachError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const ext = (recorder.mimeType || 'audio/webm').includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `gravacao-${Date.now()}.${ext}`, { type: blob.type });
        addFiles([file]);
        stream.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
      };
      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch {
      setAttachError(t.micUnavailable);
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setIsRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  function handleSend() {
    const trimmed = text.trim();
    if (disabled) return;
    if (!trimmed && attachments.length === 0) return;
    onSend(trimmed, attachments.map((a) => a.file));
    setText('');
    for (const a of attachments) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    setAttachments([]);
    setAttachError(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const canSend = !disabled && (text.trim().length > 0 || attachments.length > 0);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4 pt-2">
      {attachError && <p className="mb-2 text-xs text-danger">{attachError}</p>}

      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            <div key={i} className="group relative flex items-center gap-2 rounded-xl border border-border bg-surface px-2 py-1.5 shadow-card">
              {a.previewUrl ? (
                <img src={a.previewUrl} alt="" className="h-9 w-9 rounded-lg object-cover" />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-secondary text-ink-secondary">
                  {a.file.type.startsWith('audio/') ? <FileAudio size={16} /> : <Paperclip size={16} />}
                </span>
              )}
              <span className="max-w-[120px] truncate text-xs text-ink-secondary">{a.file.name}</span>
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                aria-label={t.removeAttachment}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-white opacity-0 shadow transition-opacity group-hover:opacity-100"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {isRecording ? (
        <div className="flex items-center gap-3 rounded-3xl border border-danger/30 bg-surface px-4 py-3 shadow-card">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" aria-hidden="true" />
          <span className="text-sm font-medium text-ink">{t.recording}</span>
          <span className="text-sm tabular-nums text-ink-muted">{formatSeconds(recordingSeconds)}</span>
          <button
            type="button"
            onClick={stopRecording}
            aria-label={t.recordStop}
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-danger text-white transition hover:bg-danger/90"
          >
            <Square size={14} fill="currentColor" />
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-2 rounded-3xl border border-border bg-surface px-3 py-2 shadow-card focus-within:border-sapphire">
          <input ref={fileInputRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={handleFilePicked} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            aria-label={t.attach}
            title={t.attach}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-secondary transition hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Paperclip size={18} />
          </button>
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.composerPlaceholder}
            className="max-h-[200px] flex-1 resize-none border-none bg-transparent py-1.5 text-sm text-ink outline-none placeholder:text-ink-muted disabled:cursor-not-allowed"
          />
          <button
            type="button"
            onClick={startRecording}
            disabled={disabled}
            aria-label={t.recordStart}
            title={t.recordStart}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-secondary transition hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Mic size={18} />
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label={t.send}
            title={t.send}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sapphire text-white transition hover:bg-sapphire-hover disabled:cursor-not-allowed disabled:bg-ink-muted/40"
          >
            <ArrowUp size={18} />
          </button>
        </div>
      )}
      <p className="mt-2 text-center text-[11px] text-ink-muted">{t.costNotice(costCredits)}</p>
    </div>
  );
}
