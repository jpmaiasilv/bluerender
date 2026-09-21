import { useRef, useState } from 'react';
import { Music } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { EditorTransitionType } from '../../types';
import { ClipBlock, TIMELINE_PX_PER_SEC } from './ClipBlock';
import { TransitionButton } from './TransitionButton';
import { EditorProject, EditorSelection, clipStartOffsets, projectDuration } from './editorState';

interface Props {
  project: EditorProject;
  selection: EditorSelection;
  onSelect: (selection: EditorSelection) => void;
  playhead: number;
  onPlayheadChange: (seconds: number) => void;
  onReorderClips: (fromIndex: number, toIndex: number) => void;
  onTrimVideo: (clipId: string, patch: { trimStart?: number; trimEnd?: number }) => void;
  onResizeImage: (clipId: string, duration: number) => void;
  onSetTransition: (afterClipId: string, type: EditorTransitionType) => void;
}

export function Timeline({
  project,
  selection,
  onSelect,
  playhead,
  onPlayheadChange,
  onReorderClips,
  onTrimVideo,
  onResizeImage,
  onSetTransition,
}: Props) {
  const { messages } = useLanguage();
  const t = messages.videoEditor.timeline;
  const dragIndexRef = useRef<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrubbing, setScrubbing] = useState(false);

  const total = projectDuration(project);
  const contentWidth = Math.max(320, total * TIMELINE_PX_PER_SEC + 80);

  function seekFromClientX(clientX: number) {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(0, clientX - rect.left);
    onPlayheadChange(Math.min(total, x / TIMELINE_PX_PER_SEC));
  }

  function startPlayheadDrag(e: React.PointerEvent) {
    e.preventDefault();
    setScrubbing(true);
    seekFromClientX(e.clientX);
    function handleMove(ev: PointerEvent) {
      seekFromClientX(ev.clientX);
    }
    function handleUp() {
      setScrubbing(false);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    }
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  const ticks: number[] = [];
  for (let s = 0; s <= total + 5; s += 1) ticks.push(s);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="overflow-x-auto rounded-xl border border-border bg-surface pb-2">
        <div ref={contentRef} className="relative" style={{ width: contentWidth }}>
          {/* Ruler */}
          <div
            className="relative h-6 cursor-pointer border-b border-border"
            onPointerDown={startPlayheadDrag}
          >
            {ticks.map((s) => (
              <div
                key={s}
                className="absolute top-0 flex h-full flex-col justify-end"
                style={{ left: s * TIMELINE_PX_PER_SEC }}
              >
                <div className={`w-px bg-border ${s % 5 === 0 ? 'h-2.5' : 'h-1.5'}`} />
                {s % 5 === 0 && <span className="absolute -top-0.5 left-1 text-[9px] text-ink-muted">{s}s</span>}
              </div>
            ))}
          </div>

          {/* Video/Image track */}
          <div className="relative flex items-center gap-0 px-2 py-2" style={{ minHeight: 72 }}>
            {project.clips.length === 0 ? (
              <p className="py-4 text-xs text-ink-muted">{t.emptyHint}</p>
            ) : (
              <>
                {project.clips.map((clip, i) => (
                  <ClipBlock
                    key={clip.id}
                    clip={clip}
                    index={i}
                    selected={selection.type === 'clip' && selection.clipId === clip.id}
                    onSelect={() => onSelect({ type: 'clip', clipId: clip.id })}
                    onDragStart={(index) => {
                      dragIndexRef.current = index;
                    }}
                    onDropOnto={(index) => {
                      if (dragIndexRef.current !== null && dragIndexRef.current !== index) {
                        onReorderClips(dragIndexRef.current, index);
                      }
                      dragIndexRef.current = null;
                    }}
                    onTrimVideo={onTrimVideo}
                    onResizeImage={onResizeImage}
                  />
                ))}
                {/* Transition controls render as an absolutely-positioned overlay
                    layer (like the playhead below), anchored to the exact clip
                    boundary in timeline pixels — this keeps them reliably above
                    the clip thumbnails regardless of DOM/paint order, unlike the
                    previous inline flex placement which could get visually lost
                    against a light-on-light default state. */}
                {project.clips.slice(0, -1).map((clip, i) => (
                  <div
                    key={`transition-${clip.id}`}
                    className="pointer-events-none absolute top-1/2 z-20 -translate-y-1/2"
                    style={{ left: clipStartOffsets(project)[i + 1] * TIMELINE_PX_PER_SEC }}
                  >
                    <div className="pointer-events-auto -translate-x-1/2">
                      <TransitionButton
                        afterClipId={clip.id}
                        currentType={project.transitions.find((tr) => tr.afterClipId === clip.id)?.type ?? 'none'}
                        active={selection.type === 'transition' && selection.afterClipId === clip.id}
                        onSelect={() => onSelect({ type: 'transition', afterClipId: clip.id })}
                        onChange={(type) => onSetTransition(clip.id, type)}
                      />
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Audio track */}
          <div className="flex items-center border-t border-border px-2 py-2" style={{ minHeight: 44 }}>
            {project.music ? (
              <button
                type="button"
                onClick={() => onSelect({ type: 'music' })}
                style={{ width: Math.max(40, (project.music.trimEnd - project.music.trimStart) * TIMELINE_PX_PER_SEC) }}
                className={`flex h-8 items-center gap-1.5 rounded-lg border-2 px-2 transition ${
                  selection.type === 'music' ? 'border-sapphire bg-sapphire-soft' : 'border-border bg-surface-secondary hover:border-sapphire/40'
                }`}
              >
                <Music size={12} className="shrink-0 text-sapphire" />
                <span className="truncate text-[10px] text-ink-secondary">{project.music.name}</span>
              </button>
            ) : (
              <p className="text-xs text-ink-muted">{t.audioTrackLabel}</p>
            )}
          </div>

          {/* Playhead */}
          <div
            className={`pointer-events-none absolute top-0 z-30 h-full w-px ${scrubbing ? 'bg-sapphire' : 'bg-danger'}`}
            style={{ left: Math.min(playhead, total) * TIMELINE_PX_PER_SEC }}
          >
            <div className="absolute -top-0.5 -left-[5px] h-2.5 w-[11px] rounded-sm bg-inherit" />
          </div>
        </div>
      </div>
    </div>
  );
}
