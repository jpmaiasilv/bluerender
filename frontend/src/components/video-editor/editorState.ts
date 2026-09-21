import {
  EditorClip,
  EditorExportRequestProject,
  EditorFit,
  EditorFormat,
  EditorImageClip,
  EditorMediaRef,
  EditorMovementTimingMode,
  EditorMusicItem,
  EditorResolution,
  EditorTransition,
  EditorTransitionType,
  EditorVideoClip,
} from '../../types';

export interface EditorProject {
  format: EditorFormat;
  fit: EditorFit;
  resolution: EditorResolution;
  clips: EditorClip[];
  transitions: EditorTransition[];
  music: EditorMusicItem | null;
}

/** Simplest-integer aspect ratio per fixed format — mirrors
 * backend/src/lib/canvasDimensions.ts's FORMAT_RATIOS. Drives the preview box. */
export const FORMAT_RATIOS: Record<Exclude<EditorFormat, 'auto'>, { w: number; h: number }> = {
  reels: { w: 9, h: 16 },
  feed: { w: 4, h: 5 },
  youtube: { w: 16, h: 9 },
  square: { w: 1, h: 1 },
};

export type EditorSelection =
  | { type: 'none' }
  | { type: 'clip'; clipId: string }
  | { type: 'music' }
  | { type: 'transition'; afterClipId: string };

export const EMPTY_PROJECT: EditorProject = {
  format: 'reels',
  fit: 'contain',
  resolution: '1080',
  clips: [],
  transitions: [],
  music: null,
};

function newId(): string {
  return crypto.randomUUID();
}

export function makeVideoClip(source: EditorMediaRef, sourceDuration: number, name: string): EditorVideoClip {
  return {
    id: newId(),
    type: 'video',
    name,
    source,
    sourceDuration,
    trimStart: 0,
    trimEnd: sourceDuration,
    speed: 1,
    volume: 1,
    motion: 'none',
    motionIntensity: 'soft',
    movementTimingMode: 'full',
    movementStart: 0,
    movementDuration: sourceDuration,
  };
}

export function makeImageClip(source: EditorMediaRef, name: string): EditorImageClip {
  return {
    id: newId(),
    type: 'image',
    name,
    source,
    duration: 3,
    motion: 'none',
    motionIntensity: 'soft',
    movementTimingMode: 'full',
    movementStart: 0,
    movementDuration: 3,
  };
}

export function makeMusicItem(source: EditorMediaRef, sourceDuration: number, name: string): EditorMusicItem {
  return {
    id: newId(),
    name,
    source,
    sourceDuration,
    trimStart: 0,
    trimEnd: sourceDuration,
    volume: 0.8,
    fadeIn: 0,
    fadeOut: 0,
  };
}

export function clipEffectiveDuration(clip: EditorClip): number {
  return clip.type === 'image' ? clip.duration : (clip.trimEnd - clip.trimStart) / clip.speed;
}

/** The window (in clip-relative seconds) during which a clip's movement
 * actually happens — [0, full duration] for "durante todo o clipe", or the
 * clip's own movementStart/movementDuration for a custom window. Before the
 * window the clip holds its initial framing; after it, its final framing. */
export function effectiveMovementWindow(clip: EditorClip): { start: number; duration: number } {
  const fullDuration = clipEffectiveDuration(clip);
  if (clip.movementTimingMode !== 'custom') return { start: 0, duration: fullDuration };
  return { start: clip.movementStart, duration: clip.movementDuration };
}

/** Keeps movementStart/movementDuration valid whenever a clip's own
 * duration-affecting fields change (image duration; video trim/speed):
 * start >= 0, duration > 0, start + duration <= the clip's effective
 * duration. Only actually used while movementTimingMode is 'custom', but
 * kept valid unconditionally so stored values are never nonsensical even if
 * the user re-enables custom timing later. */
function clampMovementFields(clip: EditorClip): EditorClip {
  const dur = Math.max(0.1, clipEffectiveDuration(clip));
  const start = Math.max(0, Math.min(clip.movementStart, Math.max(0, dur - 0.1)));
  const duration = Math.max(0.1, Math.min(clip.movementDuration, dur - start));
  if (start === clip.movementStart && duration === clip.movementDuration) return clip;
  return { ...clip, movementStart: start, movementDuration: duration };
}

export function transitionDurationFor(project: EditorProject, afterClipId: string): number {
  const t = project.transitions.find((tr) => tr.afterClipId === afterClipId);
  return t && t.type !== 'none' ? t.duration : 0;
}

/**
 * Timeline duration and per-clip offsets use a simple cumulative sum — clips
 * are laid out back-to-back, with transitions shown as a small indicator at
 * the boundary rather than a visual overlap. The real export shortens the
 * total by each transition's duration (xfade genuinely crossfades the two
 * clips), so the exported file runs a few tenths of a second shorter than
 * this preview total per transition — imperceptible and not worth the extra
 * complexity of keeping two coordinate systems in sync across the UI.
 */
export function projectDuration(project: EditorProject): number {
  return project.clips.reduce((sum, clip) => sum + clipEffectiveDuration(clip), 0);
}

export function clipStartOffsets(project: EditorProject): number[] {
  const offsets: number[] = [];
  let cursor = 0;
  project.clips.forEach((clip) => {
    offsets.push(cursor);
    cursor += clipEffectiveDuration(clip);
  });
  return offsets;
}

export interface ActiveTransition {
  fromIndex: number;
  toIndex: number;
  type: EditorTransitionType;
  duration: number;
  /** 0 at the start of the crossfade window, 1 exactly at the clip boundary. */
  progress: number;
}

/**
 * Finds whether `playhead` currently falls inside a transition's crossfade
 * window — the last `duration` seconds of the outgoing clip, right before
 * its boundary with the next one. Used by the preview to render a lightweight
 * two-layer approximation of the transition (see PreviewPlayer.tsx).
 */
export function activeTransitionAt(project: EditorProject, playhead: number): ActiveTransition | null {
  const offsets = clipStartOffsets(project);
  for (let i = 0; i < project.clips.length - 1; i++) {
    const transition = project.transitions.find((t) => t.afterClipId === project.clips[i].id);
    if (!transition || transition.type === 'none' || transition.duration <= 0) continue;
    const boundary = offsets[i + 1];
    const windowStart = boundary - transition.duration;
    if (playhead >= windowStart && playhead < boundary) {
      return {
        fromIndex: i,
        toIndex: i + 1,
        type: transition.type,
        duration: transition.duration,
        progress: Math.min(1, Math.max(0, (playhead - windowStart) / transition.duration)),
      };
    }
  }
  return null;
}

export type EditorAction =
  | { type: 'ADD_CLIP'; clip: EditorClip }
  | { type: 'REMOVE_CLIP'; clipId: string }
  | { type: 'DUPLICATE_CLIP'; clipId: string }
  | { type: 'REORDER_CLIPS'; fromIndex: number; toIndex: number }
  | { type: 'UPDATE_CLIP'; clipId: string; patch: Partial<EditorVideoClip> | Partial<EditorImageClip> }
  | { type: 'SPLIT_CLIP'; clipId: string; atSourceSeconds: number }
  | { type: 'SET_MUSIC'; music: EditorMusicItem | null }
  | { type: 'UPDATE_MUSIC'; patch: Partial<EditorMusicItem> }
  | { type: 'SET_TRANSITION'; afterClipId: string; transitionType: EditorTransitionType; duration: number }
  | { type: 'SET_FORMAT'; format: EditorFormat }
  | { type: 'SET_FIT'; fit: EditorFit }
  | { type: 'SET_RESOLUTION'; resolution: EditorResolution }
  | { type: 'LOAD_PROJECT'; project: EditorProject };

export function editorReducer(state: EditorProject, action: EditorAction): EditorProject {
  switch (action.type) {
    case 'ADD_CLIP':
      return { ...state, clips: [...state.clips, action.clip] };

    case 'REMOVE_CLIP':
      return {
        ...state,
        clips: state.clips.filter((c) => c.id !== action.clipId),
        transitions: state.transitions.filter((t) => t.afterClipId !== action.clipId),
      };

    case 'DUPLICATE_CLIP': {
      const index = state.clips.findIndex((c) => c.id === action.clipId);
      if (index === -1) return state;
      const original = state.clips[index];
      const copy: EditorClip = { ...original, id: newId() };
      const clips = [...state.clips];
      clips.splice(index + 1, 0, copy);
      return { ...state, clips };
    }

    case 'REORDER_CLIPS': {
      const { fromIndex, toIndex } = action;
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= state.clips.length || toIndex >= state.clips.length) {
        return state;
      }
      const clips = [...state.clips];
      const [moved] = clips.splice(fromIndex, 1);
      clips.splice(toIndex, 0, moved);
      return { ...state, clips };
    }

    case 'UPDATE_CLIP':
      return {
        ...state,
        clips: state.clips.map((c) =>
          c.id === action.clipId ? clampMovementFields({ ...c, ...action.patch } as EditorClip) : c
        ),
      };

    case 'SPLIT_CLIP': {
      const index = state.clips.findIndex((c) => c.id === action.clipId);
      if (index === -1) return state;
      const clip = state.clips[index];
      if (clip.type !== 'video') return state;
      const splitPoint = action.atSourceSeconds;
      if (splitPoint <= clip.trimStart + 0.05 || splitPoint >= clip.trimEnd - 0.05) return state;

      const first = clampMovementFields({ ...clip, id: newId(), trimEnd: splitPoint }) as EditorVideoClip;
      const second = clampMovementFields({ ...clip, id: newId(), trimStart: splitPoint }) as EditorVideoClip;
      const clips = [...state.clips];
      clips.splice(index, 1, first, second);

      // Any transition anchored to the original clip now belongs after the second half.
      const transitions = state.transitions.map((t) => (t.afterClipId === clip.id ? { ...t, afterClipId: second.id } : t));
      return { ...state, clips, transitions };
    }

    case 'SET_MUSIC':
      return { ...state, music: action.music };

    case 'UPDATE_MUSIC':
      return state.music ? { ...state, music: { ...state.music, ...action.patch } } : state;

    case 'SET_TRANSITION': {
      const existing = state.transitions.filter((t) => t.afterClipId !== action.afterClipId);
      if (action.transitionType === 'none') {
        return { ...state, transitions: existing };
      }
      return {
        ...state,
        transitions: [...existing, { id: newId(), afterClipId: action.afterClipId, type: action.transitionType, duration: action.duration }],
      };
    }

    case 'SET_FORMAT':
      return { ...state, format: action.format };

    case 'SET_FIT':
      return { ...state, fit: action.fit };

    case 'SET_RESOLUTION':
      return { ...state, resolution: action.resolution };

    case 'LOAD_PROJECT':
      return action.project;

    default:
      return state;
  }
}

// --- Undo/redo wrapper ---

export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export type HistoryDispatchAction<A> = A | { type: '__UNDO__' } | { type: '__REDO__' };

const MAX_HISTORY = 50;

export function makeHistoryReducer<T, A>(reducer: (state: T, action: A) => T) {
  return (state: HistoryState<T>, action: HistoryDispatchAction<A>): HistoryState<T> => {
    if (action && typeof action === 'object' && 'type' in action && action.type === '__UNDO__') {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] };
    }
    if (action && typeof action === 'object' && 'type' in action && action.type === '__REDO__') {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return { past: [...state.past, state.present], present: next, future: rest };
    }
    const nextPresent = reducer(state.present, action as A);
    if (nextPresent === state.present) return state;
    const past = [...state.past, state.present].slice(-MAX_HISTORY);
    return { past, present: nextPresent, future: [] };
  };
}

// --- Mapping to the backend export contract ---

export function toExportProject(project: EditorProject): EditorExportRequestProject {
  return {
    format: project.format,
    fit: project.fit,
    resolution: project.resolution,
    clips: project.clips.map((clip) =>
      clip.type === 'video'
        ? {
            id: clip.id,
            type: 'video' as const,
            source: clip.source,
            trimStart: clip.trimStart,
            trimEnd: clip.trimEnd,
            speed: clip.speed,
            volume: clip.volume,
            motion: clip.motion,
            motionIntensity: clip.motionIntensity,
            movementTimingMode: clip.movementTimingMode,
            movementStart: clip.movementStart,
            movementDuration: clip.movementDuration,
          }
        : {
            id: clip.id,
            type: 'image' as const,
            source: clip.source,
            duration: clip.duration,
            motion: clip.motion,
            motionIntensity: clip.motionIntensity,
            movementTimingMode: clip.movementTimingMode,
            movementStart: clip.movementStart,
            movementDuration: clip.movementDuration,
          }
    ),
    transitions: project.transitions.map((t) => ({ id: t.id, afterClipId: t.afterClipId, type: t.type, duration: t.duration })),
    audio: project.music
      ? [
          {
            id: project.music.id,
            source: project.music.source,
            trimStart: project.music.trimStart,
            trimEnd: project.music.trimEnd,
            volume: project.music.volume,
            fadeIn: project.music.fadeIn,
            fadeOut: project.music.fadeOut,
            startAt: 0,
          },
        ]
      : [],
  };
}
