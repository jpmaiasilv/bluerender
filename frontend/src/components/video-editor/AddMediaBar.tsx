import { useRef } from 'react';
import { FolderOpen, ImagePlus, Music, VideoIcon } from 'lucide-react';
import { useLanguage } from '../../i18n';

interface Props {
  onAddVideo: (file: File) => void;
  onAddImage: (file: File) => void;
  onAddMusic: (file: File) => void;
  onOpenMyProjects: () => void;
}

const BUTTON_CLASS =
  'flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-sapphire';

export function AddMediaBar({ onAddVideo, onAddImage, onAddMusic, onOpenMyProjects }: Props) {
  const { messages } = useLanguage();
  const t = messages.videoEditor;
  const videoInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={BUTTON_CLASS} onClick={() => videoInputRef.current?.click()}>
        <VideoIcon size={13} />
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

      <button type="button" className={BUTTON_CLASS} onClick={() => imageInputRef.current?.click()}>
        <ImagePlus size={13} />
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

      <button type="button" className={BUTTON_CLASS} onClick={() => musicInputRef.current?.click()}>
        <Music size={13} />
        {t.addMusic}
      </button>
      <input
        ref={musicInputRef}
        type="file"
        accept="audio/mpeg,audio/mp3,audio/wav,audio/mp4,audio/x-m4a"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onAddMusic(file);
          e.target.value = '';
        }}
      />

      <button type="button" className={BUTTON_CLASS} onClick={onOpenMyProjects}>
        <FolderOpen size={13} />
        {t.addFromProjects}
      </button>
    </div>
  );
}
