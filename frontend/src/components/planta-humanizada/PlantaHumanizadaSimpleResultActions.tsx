import { useLanguage } from '../../i18n';

interface Props {
  downloadPngUrl: string | null;
  downloadJpgUrl: string | null;
  onGenerateAgain: () => void;
  onNewImage: () => void;
}

/** Download PNG / Download JPG / Generate again (asks for confirmation — it costs credits) / New floor plan. */
export function PlantaHumanizadaSimpleResultActions({ downloadPngUrl, downloadJpgUrl, onGenerateAgain, onNewImage }: Props) {
  const { messages } = useLanguage();
  const t = messages.plantaHumanizada.simpleFlow;
  const secondary = 'rounded-lg border border-border bg-surface py-2.5 text-center text-sm font-medium text-ink transition hover:bg-surface-secondary';

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {downloadPngUrl && (
        <a href={downloadPngUrl} download className="rounded-lg bg-sapphire py-2.5 text-center text-sm font-semibold text-white transition hover:bg-sapphire-hover">
          {t.downloadPng}
        </a>
      )}
      {downloadJpgUrl && (
        <a href={downloadJpgUrl} download className={secondary}>
          {t.downloadJpg}
        </a>
      )}
      <button type="button" onClick={onGenerateAgain} className={secondary}>
        {t.againButton}
      </button>
      <button type="button" onClick={onNewImage} className={secondary}>
        {t.newPlanButton}
      </button>
    </div>
  );
}
