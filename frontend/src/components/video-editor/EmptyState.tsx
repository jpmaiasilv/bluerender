import { useRef } from 'react';
import { Clapperboard, ImagePlus, VideoIcon } from 'lucide-react';
import { useLanguage } from '../../i18n';

interface Props {
  onAddVideo: (file: File) => void;
  onAddImage: (file: File) => void;
}

export function EmptyState({ onAddVideo, onAddImage }: Props) {
  const { messages } = useLanguage();
  const t = messages.videoEditor.emptyState;
  const videoInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-surface-secondary/60 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-sapphire-light">
        <Clapperboard size={26} className="text-sapphire" />
      </div>
      <div>
        <p className="text-base font-semibold text-ink">{t.title}</p>
        <p className="mt-1 text-sm text-ink-secondary">{t.subtitle}</p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => videoInputRef.current?.click()}
          className="flex items-center gap-1.5 rounded-lg bg-sapphire px-4 py-2 text-sm font-medium text-white transition hover:bg-sapphire-hover"
        >
          <VideoIcon size={14} />
          {t.addVideo}
        </button>
        <input
          ref={videoInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onAddVideo(file);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-sapphire"
        >
          <ImagePlus size={14} />
          {t.addImage}
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onAddImage(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
