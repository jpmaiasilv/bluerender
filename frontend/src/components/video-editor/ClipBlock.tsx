import { useRef } from 'react';
import { Image as ImageIcon, Move, Video as VideoIcon } from 'lucide-react';
import { EditorClip } from '../../types';
import { useLanguage } from '../../i18n';
import { clipEffectiveDuration, effectiveMovementWindow } from './editorState';

const PX_PER_SEC = 50;
export const TIMELINE_PX_PER_SEC = PX_PER_SEC;
const MAX_IMAGE_DURATION = 120;

interface Props {
  clip: EditorClip;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onDragStart: (index: number) => void;
  onDropOnto: (index: number) => void;
  onTrimVideo?: (clipId: string, patch: { trimStart?: number; trimEnd?: number }) => void;
  onResizeImage?: (clipId: string, duration: number) => void;
}

export function ClipBlock({ clip, index, selected, onSelect, onDragStart, onDropOnto, onTrimVideo, onResizeImage }: Props) {
  const { messages } = useLanguage();
  const width = Math.max(24, clipEffectiveDuration(clip) * PX_PER_SEC);
  const dragOverRef = useRef(false);

  function startVideoHandleDrag(edge: 'start' | 'end', e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (clip.type !== 'video' || !onTrimVideo) return;
    const trim = onTrimVideo;
    const startX = e.clientX;
    const startTrimStart = clip.trimStart;
    const startTrimEnd = clip.trimEnd;
    const speed = clip.speed;
    const sourceDuration = clip.sourceDuration;

    function handleMove(ev: PointerEvent) {
      const deltaPx = ev.clientX - startX;
      const deltaSourceSeconds = (deltaPx / PX_PER_SEC) * speed;
      if (edge === 'start') {
        const next = Math.max(0, Math.min(startTrimStart + deltaSourceSeconds, startTrimEnd - 0.2));
        trim(clip.id, { trimStart: next });
      } else {
        const next = Math.min(sourceDuration, Math.max(startTrimEnd + deltaSourceSeconds, startTrimStart + 0.2));
        trim(clip.id, { trimEnd: next });
      }
    }
    function handleUp() {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    }
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  function startImageHandleDrag(e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (clip.type !== 'image' || !onResizeImage) return;
    const resize = onResizeImage;
    const startX = e.clientX;
    const startDuration = clip.duration;

    function handleMove(ev: PointerEvent) {
      const deltaPx = ev.clientX - startX;
      const next = Math.min(MAX_IMAGE_DURATION, Math.max(0.5, startDuration + deltaPx / PX_PER_SEC));
      resize(clip.id, next);
    }
    function handleUp() {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    }
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(index);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        dragOverRef.current = true;
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropOnto(index);
      }}
      onClick={onSelect}
      style={{ width }}
      className={`group relative flex h-16 shrink-0 cursor-grab select-none items-center overflow-hidden rounded-lg border-2 bg-surface-secondary transition active:cursor-grabbing ${
        selected ? 'border-sapphire ring-2 ring-sapphire/30' : 'border-border hover:border-sapphire/40'
      }`}
      title={clip.name}
    >
      {clip.type === 'image' ? (
        <img src={clip.source.url} alt="" className="h-full w-full object-cover opacity-90" draggable={false} />
      ) : (
        <video src={clip.source.url} className="h-full w-full object-cover opacity-90" muted preload="metadata" />
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 bg-ink/60 px-1.5 py-0.5">
        {clip.type === 'image' ? <ImageIcon size={10} className="text-white" /> : <VideoIcon size={10} className="text-white" />}
        <span className="truncate text-[10px] text-white">{clip.name}</span>
      </div>
      {clip.motion !== 'none' && (
        <>
          <div
            title={messages.videoEditor.panel.motion.options[clip.motion]}
            className="pointer-events-none absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-sapphire text-white shadow"
          >
            <Move size={9} />
          </div>
          {clip.movementTimingMode === 'custom' &&
            (() => {
              const fullDuration = Math.max(0.01, clipEffectiveDuration(clip));
              const window = effectiveMovementWindow(clip);
              const leftPct = (window.start / fullDuration) * 100;
              const widthPct = (window.duration / fullDuration) * 100;
              return (
                <div
                  className="pointer-events-none absolute top-0.5 h-1 rounded-full bg-sapphire/80"
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  title={`${window.start.toFixed(1)}s → ${(window.start + window.duration).toFixed(1)}s`}
                />
              );
            })()}
        </>
      )}
      {clip.uploading && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink/50 text-[10px] text-white">...</div>
      )}
      {clip.type === 'video' && (
        <>
          <div
            onPointerDown={(e) => startVideoHandleDrag('start', e)}
            className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-sapphire/0 hover:bg-sapphire/60"
          />
          <div
            onPointerDown={(e) => startVideoHandleDrag('end', e)}
            className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-sapphire/0 hover:bg-sapphire/60"
          />
        </>
      )}
      {clip.type === 'image' && (
        <div
          onPointerDown={startImageHandleDrag}
          className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-sapphire/0 hover:bg-sapphire/60"
        />
      )}
    </div>
  );
}
