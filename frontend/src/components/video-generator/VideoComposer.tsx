import { useLanguage } from '../../i18n';

export const MAX_VIDEO_PROMPT_LENGTH = 2000;

interface Props {
  prompt: string;
  onPromptChange: (prompt: string) => void;
  disabled?: boolean;
}

export function VideoComposer({ prompt, onPromptChange, disabled }: Props) {
  const { messages } = useLanguage();
  const t = messages.videoGenerator;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <textarea
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value.slice(0, MAX_VIDEO_PROMPT_LENGTH))}
        disabled={disabled}
        placeholder={t.composer.placeholder}
        rows={6}
        maxLength={MAX_VIDEO_PROMPT_LENGTH}
        className="min-h-[180px] w-full resize-none border-none bg-transparent text-base text-ink outline-none placeholder:text-ink-muted disabled:opacity-60"
      />
      <p className="mt-1 text-xs text-ink-muted">{t.composer.helper}</p>

      <div className="mt-3 flex items-center justify-end border-t border-border pt-3">
        <span className="text-xs text-ink-muted">{t.composer.charCount(prompt.length, MAX_VIDEO_PROMPT_LENGTH)}</span>
      </div>
    </div>
  );
}
