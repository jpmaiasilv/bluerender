import { Copy, Scissors, Trash2 } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { SelectField } from '../SelectField';
import {
  EditorClip,
  EditorClipSpeed,
  EditorFit,
  EditorFormat,
  EditorImageClip,
  EditorMotionIntensity,
  EditorMotionType,
  EditorMusicItem,
  EditorResolution,
  EditorTransitionType,
  EditorVideoClip,
} from '../../types';
import { EditorProject, EditorSelection, clipEffectiveDuration, projectDuration } from './editorState';

const SPEED_OPTIONS: EditorClipSpeed[] = [0.5, 0.75, 1, 1.25, 1.5, 2];
const MOTION_OPTIONS: EditorMotionType[] = ['none', 'zoomIn', 'zoomOut', 'panLeft', 'panRight', 'panUp', 'panDown', 'kenBurns'];
/** No fixed upper bound in the UI beyond a generous sanity ceiling — matches
 * the backend's own MAX_IMAGE_DURATION_S. */
const MAX_IMAGE_DURATION = 120;

function Slider({ label, value, min, max, step, onChange, formatValue }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  formatValue: (v: number) => string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-ink-secondary">
        <span>{label}</span>
        <span className="normal-case text-ink-muted">{formatValue(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer accent-sapphire"
      />
    </label>
  );
}

function ActionButton({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition ${
        danger
          ? 'border-danger/30 text-danger hover:bg-danger/10'
          : 'border-border text-ink-secondary hover:border-sapphire/40 hover:text-sapphire'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function formatDuration(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}

function SegmentedToggle<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{label}</span>
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-surface-secondary p-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-md px-2 py-1.5 text-xs font-medium transition ${
              value === opt.value ? 'bg-sapphire text-white shadow-sm' : 'text-ink-secondary hover:text-sapphire'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </label>
  );
}

function NumberField({ label, value, min, max, step, onChange, suffix }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
          }}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire"
        />
        {suffix && <span className="shrink-0 text-xs text-ink-muted">{suffix}</span>}
      </div>
    </label>
  );
}

interface MotionLabels {
  motionSectionLabel: string;
  intensitySectionLabel: string;
  motionOptionLabels: Record<EditorMotionType, string>;
  intensityLabels: { soft: string; medium: string };
  timingSectionLabel: string;
  fullClipLabel: string;
  startLabel: string;
  durationLabel: string;
}

function MotionControls({
  clip,
  labels,
  onUpdate,
}: {
  clip: EditorVideoClip | EditorImageClip;
  labels: MotionLabels;
  onUpdate: (patch: Partial<EditorVideoClip> & Partial<EditorImageClip>) => void;
}) {
  const fullDuration = clipEffectiveDuration(clip as EditorClip);
  const isFullClip = clip.movementTimingMode !== 'custom';

  return (
    <>
      <SelectField
        label={labels.motionSectionLabel}
        value={clip.motion}
        options={MOTION_OPTIONS.map((m) => ({ value: m, label: labels.motionOptionLabels[m] }))}
        onChange={(v) => onUpdate({ motion: v as EditorMotionType })}
      />
      {clip.motion !== 'none' && (
        <>
          <SegmentedToggle
            label={labels.intensitySectionLabel}
            value={clip.motionIntensity}
            options={[
              { value: 'soft' as EditorMotionIntensity, label: labels.intensityLabels.soft },
              { value: 'medium' as EditorMotionIntensity, label: labels.intensityLabels.medium },
            ]}
            onChange={(motionIntensity) => onUpdate({ motionIntensity })}
          />
          <div>
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">
              {labels.timingSectionLabel}
            </span>
            <label className="mb-2 flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={isFullClip}
                onChange={(e) =>
                  onUpdate(
                    e.target.checked
                      ? { movementTimingMode: 'full' }
                      : {
                          movementTimingMode: 'custom',
                          movementStart: 0,
                          movementDuration: Math.max(0.1, Math.min(fullDuration, fullDuration * 0.6)),
                        }
                  )
                }
                className="accent-sapphire"
              />
              {labels.fullClipLabel}
            </label>
            {!isFullClip && (
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label={labels.startLabel}
                  value={clip.movementStart}
                  min={0}
                  max={Math.max(0, fullDuration - 0.1)}
                  step={0.1}
                  suffix="s"
                  onChange={(movementStart) => onUpdate({ movementStart })}
                />
                <NumberField
                  label={labels.durationLabel}
                  value={clip.movementDuration}
                  min={0.1}
                  max={fullDuration}
                  step={0.1}
                  suffix="s"
                  onChange={(movementDuration) => onUpdate({ movementDuration })}
                />
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

interface Props {
  selection: EditorSelection;
  project: EditorProject;
  onSetFormat: (format: EditorFormat) => void;
  onSetFit: (fit: EditorFit) => void;
  onSetResolution: (resolution: EditorResolution) => void;
  onUpdateVideoClip: (clipId: string, patch: Partial<EditorVideoClip>) => void;
  onUpdateImageClip: (clipId: string, patch: Partial<EditorImageClip>) => void;
  onSplitClip: (clipId: string) => void;
  onDuplicateClip: (clipId: string) => void;
  onDeleteClip: (clipId: string) => void;
  onUpdateMusic: (patch: Partial<EditorMusicItem>) => void;
  onRemoveMusic: () => void;
  onSetTransition: (afterClipId: string, type: EditorTransitionType, duration: number) => void;
}

export function RightPanel({
  selection,
  project,
  onSetFormat,
  onSetFit,
  onSetResolution,
  onUpdateVideoClip,
  onUpdateImageClip,
  onSplitClip,
  onDuplicateClip,
  onDeleteClip,
  onUpdateMusic,
  onRemoveMusic,
  onSetTransition,
}: Props) {
  const { messages } = useLanguage();
  const t = messages.videoEditor.panel;

  if (selection.type === 'clip') {
    const clip = project.clips.find((c) => c.id === selection.clipId);
    if (clip?.type === 'video') {
      return (
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-ink">{t.videoClip.title}</h3>
          <p className="text-xs text-ink-muted">
            {t.videoClip.durationLabel}: {formatDuration((clip.trimEnd - clip.trimStart) / clip.speed)}
          </p>
          <SelectField
            label={t.videoClip.speedLabel}
            value={String(clip.speed)}
            options={SPEED_OPTIONS.map((s) => ({ value: String(s), label: `${s}x` }))}
            onChange={(v) => onUpdateVideoClip(clip.id, { speed: Number(v) as EditorClipSpeed })}
          />
          <Slider
            label={t.videoClip.volumeLabel}
            value={clip.volume}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onUpdateVideoClip(clip.id, { volume: v })}
            formatValue={(v) => `${Math.round(v * 100)}%`}
          />
          <MotionControls
            clip={clip}
            labels={{
              motionSectionLabel: t.motion.label,
              intensitySectionLabel: t.motion.intensityLabel,
              motionOptionLabels: t.motion.options,
              intensityLabels: t.motion.intensityOptions,
              timingSectionLabel: t.motion.timing.label,
              fullClipLabel: t.motion.timing.fullClip,
              startLabel: t.motion.timing.start,
              durationLabel: t.motion.timing.duration,
            }}
            onUpdate={(patch) => onUpdateVideoClip(clip.id, patch)}
          />
          <div className="flex gap-2">
            <ActionButton icon={<Scissors size={13} />} label={t.videoClip.split} onClick={() => onSplitClip(clip.id)} />
            <ActionButton icon={<Copy size={13} />} label={t.videoClip.duplicate} onClick={() => onDuplicateClip(clip.id)} />
          </div>
          <ActionButton icon={<Trash2 size={13} />} label={t.videoClip.delete} onClick={() => onDeleteClip(clip.id)} danger />
        </div>
      );
    }
    if (clip?.type === 'image') {
      return (
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-ink">{t.image.title}</h3>
          <NumberField
            label={t.image.durationLabel}
            value={clip.duration}
            min={0.5}
            max={MAX_IMAGE_DURATION}
            step={0.5}
            suffix="s"
            onChange={(v) => onUpdateImageClip(clip.id, { duration: v })}
          />
          <MotionControls
            clip={clip}
            labels={{
              motionSectionLabel: t.motion.label,
              intensitySectionLabel: t.motion.intensityLabel,
              motionOptionLabels: t.motion.options,
              intensityLabels: t.motion.intensityOptions,
              timingSectionLabel: t.motion.timing.label,
              fullClipLabel: t.motion.timing.fullClip,
              startLabel: t.motion.timing.start,
              durationLabel: t.motion.timing.duration,
            }}
            onUpdate={(patch) => onUpdateImageClip(clip.id, patch)}
          />
          <div className="flex gap-2">
            <ActionButton icon={<Copy size={13} />} label={t.image.duplicate} onClick={() => onDuplicateClip(clip.id)} />
            <ActionButton icon={<Trash2 size={13} />} label={t.image.delete} onClick={() => onDeleteClip(clip.id)} danger />
          </div>
        </div>
      );
    }
  }

  if (selection.type === 'music' && project.music) {
    const music = project.music;
    return (
      <div className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-ink">{t.audio.title}</h3>
        <Slider
          label={t.audio.volumeLabel}
          value={music.volume}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onUpdateMusic({ volume: v })}
          formatValue={(v) => `${Math.round(v * 100)}%`}
        />
        <div className="grid grid-cols-2 gap-2">
          <Slider
            label={t.audio.trimStartLabel}
            value={music.trimStart}
            min={0}
            max={Math.max(0, music.trimEnd - 0.5)}
            step={0.1}
            onChange={(v) => onUpdateMusic({ trimStart: v })}
            formatValue={formatDuration}
          />
          <Slider
            label={t.audio.trimEndLabel}
            value={music.trimEnd}
            min={music.trimStart + 0.5}
            max={music.sourceDuration}
            step={0.1}
            onChange={(v) => onUpdateMusic({ trimEnd: v })}
            formatValue={formatDuration}
          />
        </div>
        <label className="flex items-center justify-between text-xs font-medium text-ink-secondary">
          {t.audio.fadeIn}
          <input
            type="checkbox"
            checked={music.fadeIn > 0}
            onChange={(e) => onUpdateMusic({ fadeIn: e.target.checked ? 1 : 0 })}
            className="accent-sapphire"
          />
        </label>
        {music.fadeIn > 0 && (
          <Slider
            label={t.audio.fadeDurationLabel}
            value={music.fadeIn}
            min={0.2}
            max={5}
            step={0.1}
            onChange={(v) => onUpdateMusic({ fadeIn: v })}
            formatValue={formatDuration}
          />
        )}
        <label className="flex items-center justify-between text-xs font-medium text-ink-secondary">
          {t.audio.fadeOut}
          <input
            type="checkbox"
            checked={music.fadeOut > 0}
            onChange={(e) => onUpdateMusic({ fadeOut: e.target.checked ? 1 : 0 })}
            className="accent-sapphire"
          />
        </label>
        {music.fadeOut > 0 && (
          <Slider
            label={t.audio.fadeDurationLabel}
            value={music.fadeOut}
            min={0.2}
            max={5}
            step={0.1}
            onChange={(v) => onUpdateMusic({ fadeOut: v })}
            formatValue={formatDuration}
          />
        )}
        <ActionButton icon={<Trash2 size={13} />} label={t.audio.remove} onClick={onRemoveMusic} danger />
      </div>
    );
  }

  if (selection.type === 'transition') {
    const transition = project.transitions.find((tr) => tr.afterClipId === selection.afterClipId);
    const type = transition?.type ?? 'none';
    const duration = transition?.duration ?? 0.5;
    return (
      <div className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-ink">{t.transition.title}</h3>
        <SelectField
          label={t.transition.typeLabel}
          value={type}
          options={(['none', 'fade', 'dissolve', 'slide', 'zoom'] as const).map((opt) => ({
            value: opt,
            label: t.transition.options[opt],
          }))}
          onChange={(v) => onSetTransition(selection.afterClipId, v as EditorTransitionType, duration)}
        />
        {type !== 'none' && (
          <Slider
            label={t.transition.durationLabel}
            value={duration}
            min={0.2}
            max={1.5}
            step={0.1}
            onChange={(v) => onSetTransition(selection.afterClipId, type, v)}
            formatValue={formatDuration}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-ink">{t.project.title}</h3>
      <SelectField
        label={t.project.formatLabel}
        value={project.format}
        options={[
          { value: 'auto', label: t.project.formatOptions.auto },
          { value: 'reels', label: t.project.formatOptions.reels },
          { value: 'feed', label: t.project.formatOptions.feed },
          { value: 'youtube', label: t.project.formatOptions.youtube },
          { value: 'square', label: t.project.formatOptions.square },
        ]}
        onChange={(v) => onSetFormat(v as EditorFormat)}
      />
      <SegmentedToggle
        label={t.project.fitLabel}
        value={project.fit}
        options={[
          { value: 'contain', label: t.project.fitOptions.contain },
          { value: 'cover', label: t.project.fitOptions.cover },
        ]}
        onChange={onSetFit}
      />
      <SelectField
        label={t.project.resolutionLabel}
        value={project.resolution}
        options={[
          { value: 'auto', label: t.project.resolutionOptions.auto },
          { value: '720', label: t.project.resolutionOptions.r720 },
          { value: '1080', label: t.project.resolutionOptions.r1080 },
        ]}
        onChange={(v) => onSetResolution(v as EditorResolution)}
      />
      <div className="rounded-lg border border-border bg-surface-secondary px-3 py-2.5 text-xs text-ink-secondary">
        <p>{t.project.clipCount(project.clips.length)}</p>
        <p className="mt-1">
          {t.project.totalDuration}: {formatDuration(projectDuration(project))}
        </p>
      </div>
      <p className="text-xs text-ink-muted">{t.project.selectHint}</p>
    </div>
  );
}
