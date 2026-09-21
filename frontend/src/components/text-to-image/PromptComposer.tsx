import { Sparkles, Wand2 } from 'lucide-react';
import { TextToImageSettings } from '../../types';
import { useLanguage } from '../../i18n';
import { generateInspirationPrompt } from '../../lib/promptInspiration';
import { completeDescription } from '../../lib/completeDescription';

export const MAX_PROMPT_LENGTH = 4000;

interface Props {
  prompt: string;
  onPromptChange: (prompt: string) => void;
  settings: TextToImageSettings;
  disabled?: boolean;
}

export function PromptComposer({ prompt, onPromptChange, settings, disabled }: Props) {
  const { messages } = useLanguage();
  const t = messages.textToImage;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <textarea
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value.slice(0, MAX_PROMPT_LENGTH))}
        disabled={disabled}
        placeholder={t.composer.placeholder}
        rows={6}
        maxLength={MAX_PROMPT_LENGTH}
        className="min-h-[180px] w-full resize-none border-none bg-transparent text-base text-ink outline-none placeholder:text-ink-muted disabled:opacity-60"
      />
      <p className="mt-1 text-xs text-ink-muted">{t.composer.helper}</p>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPromptChange(generateInspirationPrompt(messages))}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Sparkles size={14} />
            {t.inspireMe}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPromptChange(completeDescription(prompt, settings, messages))}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Wand2 size={14} />
            {t.completeDescription}
          </button>
        </div>
        <span className="text-xs text-ink-muted">{t.composer.charCount(prompt.length, MAX_PROMPT_LENGTH)}</span>
      </div>
    </div>
  );
}
