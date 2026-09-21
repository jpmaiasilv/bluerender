import { Eraser } from 'lucide-react';
import { useLanguage } from '../../i18n';

interface Props {
  imageUrl: string;
  onGenerateAgain: () => void;
  onNewImage: () => void;
  onCleanup: () => void;
  isCleaning: boolean;
}

/**
 * Planta Humanizada's own result-actions row — NOT the shared ResultActions
 * (Render IA and other tools keep using that one unchanged). This one adds
 * "Limpeza Técnica", a Planta-only action, so it's a separate component
 * rather than growing the generic one with a prop no other tool needs.
 *
 * "Editar" deliberately lives only in the page's persistent header (see
 * PlantaHumanizadaPage.tsx), not duplicated here — the header version is
 * always visible (even before a generation exists) and already links to
 * this exact result once one does, so repeating it here would just be two
 * buttons doing the same thing a few lines apart.
 */
export function PlantaResultActions({ imageUrl, onGenerateAgain, onNewImage, onCleanup, isCleaning }: Props) {
  const { messages } = useLanguage();
  const t = messages.plantaHumanizada;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <a
        href={imageUrl}
        download
        className="rounded-lg bg-sapphire py-2.5 text-center text-sm font-semibold text-white transition hover:bg-sapphire-hover"
      >
        {messages.result.downloadRender}
      </a>
      <button
        type="button"
        onClick={onGenerateAgain}
        disabled={isCleaning}
        className="rounded-lg border border-border bg-surface py-2.5 text-sm font-medium text-ink transition hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-60"
      >
        {messages.result.generateAgain}
      </button>
      <button
        type="button"
        onClick={onNewImage}
        disabled={isCleaning}
        className="rounded-lg border border-border bg-surface py-2.5 text-sm font-medium text-ink transition hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-60"
      >
        {messages.result.newImage}
      </button>
      <button
        type="button"
        onClick={onCleanup}
        disabled={isCleaning}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface py-2.5 text-sm font-medium text-ink transition hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isCleaning ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-sapphire" />
        ) : (
          <Eraser size={14} />
        )}
        {isCleaning ? t.cleanupButtonLoading : t.cleanupButton}
      </button>
    </div>
  );
}
