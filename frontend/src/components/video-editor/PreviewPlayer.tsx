import { CSSProperties, useEffect, useRef } from 'react';
import { Pause, Play, RotateCcw, Volume2 } from 'lucide-react';
import { EditorClip, EditorTransitionType } from '../../types';
import { EditorProject, FORMAT_RATIOS, activeTransitionAt, clipStartOffsets, effectiveMovementWindow, projectDuration } from './editorState';
import { motionProgress, motionTransform } from './motion';

interface Props {
  project: EditorProject;
  playhead: number;
  isPlaying: boolean;
  onPlayheadChange: (seconds: number) => void;
  onPlayingChange: (playing: boolean) => void;
  /** First visual clip's own pixel dimensions — used only when format is 'auto'. */
  autoRatio: { width: number; height: number } | null;
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

interface ActiveClip {
  clip: EditorClip;
  offset: number;
}

function findActiveClip(project: EditorProject, offsets: number[], t: number): ActiveClip | null {
  if (project.clips.length === 0) return null;
  for (let i = project.clips.length - 1; i >= 0; i--) {
    if (t >= offsets[i] - 0.001) return { clip: project.clips[i], offset: offsets[i] };
  }
  return { clip: project.clips[0], offset: 0 };
}

/** Lightweight CSS approximation of each transition type — the exported MP4
 * is the source of truth for the real crossfade (see ffmpegExport.ts's
 * xfade/acrossfade chain); this only helps the editor "see" the transition
 * without re-rendering it. `a` is the outgoing clip, `b` the incoming one. */
function transitionStyles(type: EditorTransitionType, progress: number): { a: CSSProperties; b: CSSProperties } {
  switch (type) {
    case 'slide':
      return {
        a: { transform: `translateX(${-progress * 100}%)` },
        b: { transform: `translateX(${(1 - progress) * 100}%)` },
      };
    case 'zoom':
      return {
        a: { opacity: 1 - progress, transform: `scale(${1 + progress * 0.08})` },
        b: { opacity: progress, transform: `scale(${1.08 - progress * 0.08})` },
      };
    case 'fade':
    case 'dissolve':
    default:
      return { a: { opacity: 1 - progress }, b: { opacity: progress } };
  }
}

/** Real, state-driven preview: a primary <video>/<img> follows the active
 * clip and the playhead drives both. When the playhead is inside a
 * transition's crossfade window, a second layer for the incoming clip is
 * mounted alongside it and blended via CSS (opacity/transform) to
 * approximate the transition — see transitionStyles above. The exported MP4
 * (real xfade/acrossfade) remains the source of truth for the final result. */
export function PreviewPlayer({ project, playhead, isPlaying, onPlayheadChange, onPlayingChange, autoRatio }: Props) {
  const videoRefA = useRef<HTMLVideoElement>(null);
  const videoRefB = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const playheadRef = useRef(playhead);

  const total = projectDuration(project);
  const offsets = clipStartOffsets(project);
  const clampedPlayhead = Math.min(playhead, Math.max(0, total - 0.001));
  const active = findActiveClip(project, offsets, clampedPlayhead);
  const transition = activeTransitionAt(project, clampedPlayhead);
  const incomingClip = transition ? project.clips[transition.toIndex] : null;

  const ratio =
    project.format === 'auto'
      ? autoRatio
        ? `${autoRatio.width} / ${autoRatio.height}`
        : '9 / 16'
      : `${FORMAT_RATIOS[project.format].w} / ${FORMAT_RATIOS[project.format].h}`;
  const objectFitClass = project.fit === 'cover' ? 'object-cover' : 'object-contain';

  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);

  // Layer A (primary / outgoing during a transition) follows the timeline exactly as before.
  useEffect(() => {
    if (!active) return;
    if (active.clip.type === 'video' && videoRefA.current) {
      const within = Math.max(0, playhead - active.offset);
      const sourceTime = active.clip.trimStart + within * active.clip.speed;
      if (Math.abs(videoRefA.current.currentTime - sourceTime) > 0.2) {
        videoRefA.current.currentTime = sourceTime;
      }
      videoRefA.current.playbackRate = active.clip.speed;
      videoRefA.current.volume = active.clip.volume;
    }
  }, [active?.clip.id, active?.offset, playhead]);

  // Layer B (incoming clip during a transition) — muted, visual-only; audio stays on layer A.
  useEffect(() => {
    if (!transition || !incomingClip || incomingClip.type !== 'video' || !videoRefB.current) return;
    const localTime = transition.progress * transition.duration;
    const sourceTime = incomingClip.trimStart + localTime * incomingClip.speed;
    if (Math.abs(videoRefB.current.currentTime - sourceTime) > 0.2) {
      videoRefB.current.currentTime = sourceTime;
    }
    videoRefB.current.playbackRate = incomingClip.speed;
  }, [transition?.toIndex, transition?.progress, incomingClip?.id]);

  useEffect(() => {
    if (!audioRef.current || !project.music) return;
    const sourceTime = project.music.trimStart + playhead;
    if (Math.abs(audioRef.current.currentTime - sourceTime) > 0.25) {
      audioRef.current.currentTime = Math.min(sourceTime, Math.max(project.music.trimStart, project.music.trimEnd - 0.05));
    }
    audioRef.current.volume = project.music.volume;
  }, [project.music, playhead]);

  useEffect(() => {
    if (!isPlaying) {
      videoRefA.current?.pause();
      videoRefB.current?.pause();
      audioRef.current?.pause();
      lastTsRef.current = null;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      return;
    }

    void videoRefA.current?.play().catch(() => undefined);
    void videoRefB.current?.play().catch(() => undefined);
    void audioRef.current?.play().catch(() => undefined);

    function tick(ts: number) {
      if (lastTsRef.current === null) lastTsRef.current = ts;
      const deltaSeconds = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;

      const next = playheadRef.current + deltaSeconds;
      if (next >= total) {
        onPlayheadChange(0);
        onPlayingChange(false);
        return;
      }
      onPlayheadChange(next);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      lastTsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, total, transition !== null]);

  function handleScrub(e: React.ChangeEvent<HTMLInputElement>) {
    onPlayingChange(false);
    onPlayheadChange(Number(e.target.value));
  }

  const styles = transition ? transitionStyles(transition.type, transition.progress) : null;

  const motionA = active
    ? (() => {
        const window = effectiveMovementWindow(active.clip);
        const withinA = Math.max(0, playhead - active.offset);
        return motionTransform(active.clip.motion, active.clip.motionIntensity, motionProgress(withinA, window.start, window.duration));
      })()
    : '';
  const motionB =
    transition && incomingClip
      ? (() => {
          const window = effectiveMovementWindow(incomingClip);
          const withinB = transition.progress * transition.duration;
          return motionTransform(incomingClip.motion, incomingClip.motionIntensity, motionProgress(withinB, window.start, window.duration));
        })()
      : '';

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative mx-auto flex max-h-[55vh] w-full items-center justify-center overflow-hidden rounded-2xl border border-border bg-ink shadow-card"
        style={{ aspectRatio: ratio }}
      >
        {active ? (
          <>
            <div className="absolute inset-0 overflow-hidden" style={styles?.a}>
              {active.clip.type === 'video' ? (
                <video
                  key={active.clip.id}
                  ref={videoRefA}
                  src={active.clip.source.url}
                  className={`h-full w-full ${objectFitClass}`}
                  style={motionA ? { transform: motionA } : undefined}
                  playsInline
                  muted={false}
                />
              ) : (
                <img
                  key={active.clip.id}
                  src={active.clip.source.url}
                  alt=""
                  className={`h-full w-full ${objectFitClass}`}
                  style={motionA ? { transform: motionA } : undefined}
                />
              )}
            </div>

            {transition && incomingClip && (
              <div className="absolute inset-0 overflow-hidden" style={styles?.b}>
                {incomingClip.type === 'video' ? (
                  <video
                    key={incomingClip.id}
                    ref={videoRefB}
                    src={incomingClip.source.url}
                    className={`h-full w-full ${objectFitClass}`}
                    style={motionB ? { transform: motionB } : undefined}
                    playsInline
                    muted
                  />
                ) : (
                  <img
                    key={incomingClip.id}
                    src={incomingClip.source.url}
                    alt=""
                    className={`h-full w-full ${objectFitClass}`}
                    style={motionB ? { transform: motionB } : undefined}
                  />
                )}
              </div>
            )}

            {project.music && <audio ref={audioRef} src={project.music.source.url} />}
          </>
        ) : (
          <p className="px-6 text-center text-sm text-white/60">Adicione um vídeo ou imagem para começar</p>
        )}
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5">
        <button
          type="button"
          onClick={() => onPlayingChange(!isPlaying)}
          disabled={!active}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-sapphire text-white transition hover:bg-sapphire-hover disabled:opacity-40"
        >
          {isPlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
        </button>
        <button
          type="button"
          onClick={() => {
            onPlayingChange(false);
            onPlayheadChange(0);
          }}
          disabled={!active}
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition hover:bg-sapphire-soft hover:text-sapphire disabled:opacity-40"
        >
          <RotateCcw size={14} />
        </button>
        <span className="w-10 shrink-0 text-xs tabular-nums text-ink-secondary">{formatTime(playhead)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(0.01, total)}
          step={0.01}
          value={Math.min(playhead, total)}
          onChange={handleScrub}
          disabled={!active}
          className="h-1.5 flex-1 cursor-pointer accent-sapphire disabled:cursor-not-allowed disabled:opacity-40"
        />
        <span className="w-10 shrink-0 text-xs tabular-nums text-ink-muted">{formatTime(total)}</span>
        <Volume2 size={14} className="text-ink-muted" />
      </div>
    </div>
  );
}
