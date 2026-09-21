import { useEffect, useReducer, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ToolLayout } from '../components/ToolLayout';
import { AddMediaBar } from '../components/video-editor/AddMediaBar';
import { PreviewPlayer } from '../components/video-editor/PreviewPlayer';
import { Timeline } from '../components/video-editor/Timeline';
import { RightPanel } from '../components/video-editor/RightPanel';
import { EmptyState } from '../components/video-editor/EmptyState';
import { ExportPanel } from '../components/video-editor/ExportPanel';
import { MyProjectsModal } from '../components/video-editor/MyProjectsModal';
import { useLanguage } from '../i18n';
import { uploadEditorMedia } from '../lib/api';
import { probeMediaDimensions, probeMediaDuration } from '../lib/mediaProbe';
import {
  EMPTY_PROJECT,
  EditorAction,
  EditorSelection,
  clipStartOffsets,
  editorReducer,
  makeImageClip,
  makeMusicItem,
  makeVideoClip,
  makeHistoryReducer,
} from '../components/video-editor/editorState';

const historyReducer = makeHistoryReducer(editorReducer);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function VideoEditorPage() {
  const { messages } = useLanguage();
  const t = messages.videoEditor;
  const navigate = useNavigate();
  const location = useLocation();

  const [history, dispatchRaw] = useReducer(historyReducer, { past: [], present: EMPTY_PROJECT, future: [] });
  const project = history.present;
  const dispatch = (action: EditorAction) => dispatchRaw(action);

  const [selection, setSelection] = useState<EditorSelection>({ type: 'none' });
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [myProjectsOpen, setMyProjectsOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [autoRatio, setAutoRatio] = useState<{ width: number; height: number } | null>(null);
  const importedRef = useRef(false);

  // "Automático" format uses the first visual clip's own aspect ratio as its
  // reference — re-probed only when that first clip actually changes.
  const firstClip = project.clips[0];
  useEffect(() => {
    if (!firstClip || firstClip.uploading) {
      setAutoRatio(null);
      return;
    }
    let cancelled = false;
    probeMediaDimensions(firstClip.source.url, firstClip.type)
      .then((dims) => {
        if (!cancelled) setAutoRatio(dims);
      })
      .catch(() => {
        if (!cancelled) setAutoRatio(null);
      });
    return () => {
      cancelled = true;
    };
  }, [firstClip?.id, firstClip?.source.url, firstClip?.type, firstClip?.uploading]);

  // Vídeo IA integration: pre-load a just-generated video when navigated here with state.
  useEffect(() => {
    const importUrl = (location.state as { importVideoUrl?: string } | null)?.importVideoUrl;
    if (!importUrl || importedRef.current) return;
    importedRef.current = true;
    probeMediaDuration(importUrl, 'video')
      .then((duration) => {
        const clip = makeVideoClip({ url: importUrl }, duration || 5, 'Vídeo IA');
        dispatch({ type: 'ADD_CLIP', clip });
      })
      .catch(() => setUploadError(t.errors.uploadFailed));
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => !p);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.type === 'clip') {
          dispatch({ type: 'REMOVE_CLIP', clipId: selection.clipId });
          setSelection({ type: 'none' });
        } else if (selection.type === 'music') {
          dispatch({ type: 'SET_MUSIC', music: null });
          setSelection({ type: 'none' });
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) dispatchRaw({ type: '__REDO__' });
        else dispatchRaw({ type: '__UNDO__' });
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection]);

  async function handleAddVideo(file: File) {
    setUploadError(null);
    const objectUrl = URL.createObjectURL(file);
    let duration = 0;
    try {
      duration = await probeMediaDuration(objectUrl, 'video');
    } catch {
      URL.revokeObjectURL(objectUrl);
      setUploadError(t.errors.uploadFailed);
      return;
    }
    const clip = makeVideoClip({ url: objectUrl }, duration, file.name);
    clip.uploading = true;
    dispatch({ type: 'ADD_CLIP', clip });

    try {
      const uploaded = await uploadEditorMedia(file, 'video');
      dispatch({
        type: 'UPDATE_CLIP',
        clipId: clip.id,
        patch: { source: { url: uploaded.url }, uploading: false, sourceDuration: uploaded.durationSeconds || duration },
      });
    } catch {
      dispatch({ type: 'REMOVE_CLIP', clipId: clip.id });
      setUploadError(t.errors.uploadFailed);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function handleAddImage(file: File) {
    setUploadError(null);
    const objectUrl = URL.createObjectURL(file);
    const clip = makeImageClip({ url: objectUrl }, file.name);
    clip.uploading = true;
    dispatch({ type: 'ADD_CLIP', clip });

    try {
      const uploaded = await uploadEditorMedia(file, 'image');
      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { source: { url: uploaded.url }, uploading: false } });
    } catch {
      dispatch({ type: 'REMOVE_CLIP', clipId: clip.id });
      setUploadError(t.errors.uploadFailed);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function handleAddMusic(file: File) {
    setUploadError(null);
    const objectUrl = URL.createObjectURL(file);
    let duration = 0;
    try {
      duration = await probeMediaDuration(objectUrl, 'audio');
    } catch {
      URL.revokeObjectURL(objectUrl);
      setUploadError(t.errors.uploadFailed);
      return;
    }
    const music = makeMusicItem({ url: objectUrl }, duration, file.name);
    music.uploading = true;
    dispatch({ type: 'SET_MUSIC', music });

    try {
      const uploaded = await uploadEditorMedia(file, 'audio');
      dispatch({
        type: 'UPDATE_MUSIC',
        patch: { source: { url: uploaded.url }, uploading: false, sourceDuration: uploaded.durationSeconds || duration },
      });
    } catch {
      dispatch({ type: 'SET_MUSIC', music: null });
      setUploadError(t.errors.uploadFailed);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function handleAddFromProjects(url: string, kind: 'video' | 'image') {
    if (kind === 'image') {
      dispatch({ type: 'ADD_CLIP', clip: makeImageClip({ url }, 'render') });
      setMyProjectsOpen(false);
      return;
    }
    try {
      const duration = await probeMediaDuration(url, 'video');
      dispatch({ type: 'ADD_CLIP', clip: makeVideoClip({ url }, duration, 'vídeo') });
      setMyProjectsOpen(false);
    } catch {
      setUploadError(t.errors.uploadFailed);
    }
  }

  function handleSplit(clipId: string) {
    const index = project.clips.findIndex((c) => c.id === clipId);
    if (index === -1) return;
    const clip = project.clips[index];
    if (clip.type !== 'video') return;
    const offsets = clipStartOffsets(project);
    const atSourceSeconds = clip.trimStart + Math.max(0, playhead - offsets[index]) * clip.speed;
    dispatch({ type: 'SPLIT_CLIP', clipId, atSourceSeconds });
  }

  const hasUploadsInFlight = project.clips.some((c) => c.uploading) || Boolean(project.music?.uploading);
  const hasClips = project.clips.length > 0;

  return (
    <ToolLayout
      title={messages.nav.items.videoEditor}
      description={messages.toolDescriptions.videoEditor}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <AddMediaBar
            onAddVideo={handleAddVideo}
            onAddImage={handleAddImage}
            onAddMusic={handleAddMusic}
            onOpenMyProjects={() => setMyProjectsOpen(true)}
          />
          <button
            type="button"
            onClick={() => {
              dispatch({ type: 'LOAD_PROJECT', project: EMPTY_PROJECT });
              setSelection({ type: 'none' });
              setPlayhead(0);
              setIsPlaying(false);
            }}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink"
          >
            {t.toolbar.new}
          </button>
          <ExportPanel project={project} disabled={!hasClips || hasUploadsInFlight} />
        </div>
      }
    >
      <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-6 lg:w-[72%]">
          {uploadError && (
            <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{uploadError}</div>
          )}

          {hasClips ? (
            <>
              <PreviewPlayer
                project={project}
                playhead={playhead}
                isPlaying={isPlaying}
                onPlayheadChange={setPlayhead}
                onPlayingChange={setIsPlaying}
                autoRatio={autoRatio}
              />
              <Timeline
                project={project}
                selection={selection}
                onSelect={setSelection}
                playhead={playhead}
                onPlayheadChange={setPlayhead}
                onReorderClips={(fromIndex, toIndex) => dispatch({ type: 'REORDER_CLIPS', fromIndex, toIndex })}
                onTrimVideo={(clipId, patch) => dispatch({ type: 'UPDATE_CLIP', clipId, patch })}
                onResizeImage={(clipId, duration) => dispatch({ type: 'UPDATE_CLIP', clipId, patch: { duration } })}
                onSetTransition={(afterClipId, type) => dispatch({ type: 'SET_TRANSITION', afterClipId, transitionType: type, duration: 0.5 })}
              />
            </>
          ) : (
            <EmptyState onAddVideo={handleAddVideo} onAddImage={handleAddImage} />
          )}
        </div>

        <div className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-t border-border bg-surface px-5 py-6 lg:w-[28%] lg:border-l lg:border-t-0">
          <RightPanel
            selection={selection}
            project={project}
            onSetFormat={(format) => dispatch({ type: 'SET_FORMAT', format })}
            onSetFit={(fit) => dispatch({ type: 'SET_FIT', fit })}
            onSetResolution={(resolution) => dispatch({ type: 'SET_RESOLUTION', resolution })}
            onUpdateVideoClip={(clipId, patch) => dispatch({ type: 'UPDATE_CLIP', clipId, patch })}
            onUpdateImageClip={(clipId, patch) => dispatch({ type: 'UPDATE_CLIP', clipId, patch })}
            onSplitClip={handleSplit}
            onDuplicateClip={(clipId) => dispatch({ type: 'DUPLICATE_CLIP', clipId })}
            onDeleteClip={(clipId) => {
              dispatch({ type: 'REMOVE_CLIP', clipId });
              setSelection({ type: 'none' });
            }}
            onUpdateMusic={(patch) => dispatch({ type: 'UPDATE_MUSIC', patch })}
            onRemoveMusic={() => {
              dispatch({ type: 'SET_MUSIC', music: null });
              setSelection({ type: 'none' });
            }}
            onSetTransition={(afterClipId, type, duration) => dispatch({ type: 'SET_TRANSITION', afterClipId, transitionType: type, duration })}
          />
        </div>
      </div>

      <MyProjectsModal open={myProjectsOpen} onClose={() => setMyProjectsOpen(false)} onAdd={handleAddFromProjects} />
    </ToolLayout>
  );
}
