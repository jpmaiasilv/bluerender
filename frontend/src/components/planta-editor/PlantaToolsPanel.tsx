import { Hash, PaintBucket, Ruler, Tag } from 'lucide-react';
import { EditorToolMode } from '../../lib/plantaEditor/types';
import { useLanguage } from '../../i18n';

interface Props {
  tool: EditorToolMode;
  onToolChange: (tool: EditorToolMode) => void;
  scaleBarMeters: number;
  onScaleBarMetersChange: (meters: number) => void;
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  brushOpacity: number;
  onBrushOpacityChange: (opacity: number) => void;
}

const SCALE_OPTIONS = [1, 5];

export function PlantaToolsPanel({
  tool,
  onToolChange,
  scaleBarMeters,
  onScaleBarMetersChange,
  brushSize,
  onBrushSizeChange,
  brushOpacity,
  onBrushOpacityChange,
}: Props) {
  const { messages } = useLanguage();
  const t = messages.plantaEditor;

  const itemClass = (active: boolean) =>
    `flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
      active ? 'border-sapphire bg-sapphire-light text-sapphire' : 'border-border bg-surface text-ink-secondary hover:border-sapphire/40 hover:text-ink'
    }`;

  return (
    <div className="flex w-64 shrink-0 flex-col gap-3 border-l border-border bg-surface p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{t.plantaTools.title}</h3>

      <button type="button" className={itemClass(tool === 'roomNumber')} onClick={() => onToolChange('roomNumber')}>
        <Hash size={15} />
        {t.plantaTools.numberRooms}
      </button>

      <button type="button" className={itemClass(tool === 'roomName')} onClick={() => onToolChange('roomName')}>
        <Tag size={15} />
        {t.plantaTools.roomName}
      </button>

      <button type="button" className={itemClass(tool === 'scaleBar')} onClick={() => onToolChange('scaleBar')}>
        <Ruler size={15} />
        {t.plantaTools.scaleBar}
      </button>
      {tool === 'scaleBar' && (
        <div className="ml-1">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-muted">{t.plantaTools.scaleBarValueLabel}</span>
          <div className="flex gap-1.5">
            {SCALE_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onScaleBarMetersChange(m)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                  scaleBarMeters === m ? 'border-sapphire bg-sapphire-light text-sapphire' : 'border-border text-ink-secondary hover:border-sapphire/40'
                }`}
              >
                {m} m
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 border-t border-border pt-3">
        <button type="button" className={itemClass(tool === 'maskBrush')} onClick={() => onToolChange('maskBrush')}>
          <PaintBucket size={15} />
          {t.plantaTools.maskBrush}
        </button>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">{t.plantaTools.maskBrushHint}</p>
        {tool === 'maskBrush' && (
          <div className="mt-2 flex flex-col gap-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-muted">{t.plantaTools.brushSize}</span>
              <input
                type="range"
                min={4}
                max={60}
                value={brushSize}
                onChange={(e) => onBrushSizeChange(Number(e.target.value))}
                className="w-full"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-muted">{t.plantaTools.brushOpacity}</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={brushOpacity}
                onChange={(e) => onBrushOpacityChange(Number(e.target.value))}
                className="w-full"
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
