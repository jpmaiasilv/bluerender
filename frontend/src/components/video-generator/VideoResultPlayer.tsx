import { Download, RefreshCcw, Scissors } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { VideoJobResultPayload } from '../../types';
import { useLanguage } from '../../i18n';

interface Props {
  result: VideoJobResultPayload;
  onReuseSettings: () => void;
  onGenerateAgain: () => void;
}

export function VideoResultPlayer({ result, onReuseSettings, onGenerateAgain }: Props) {
  const { messages } = useLanguage();
  const navigate = useNavigate();
  const t = messages.videoGenerator.results;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-2xl border border-border bg-ink shadow-card">
        <video src={result.videoUrl} controls className="max-h-[60vh] w-full" />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <a
          href={result.videoUrl}
          download
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink"
        >
          <Download size={13} />
          {t.download}
        </a>
        <button
          type="button"
          onClick={onReuseSettings}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink"
        >
          {t.reuseSettings}
        </button>
        <button
          type="button"
          onClick={onGenerateAgain}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink"
        >
          <RefreshCcw size={13} />
          {t.generateAgain}
        </button>
        <button
          type="button"
          onClick={() => navigate('/video-editor', { state: { importVideoUrl: result.videoUrl } })}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink"
        >
          <Scissors size={13} />
          {messages.videoEditor.editFromVideoIa}
        </button>
      </div>
    </div>
  );
}
