import { useLanguage } from '../i18n';

interface Props {
  imageUrl: string;
  onGenerateAgain: () => void;
  onNewImage: () => void;
}

export function ResultActions({ imageUrl, onGenerateAgain, onNewImage }: Props) {
  const { messages } = useLanguage();

  return (
    <div className="grid grid-cols-3 gap-3">
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
        className="rounded-lg border border-border bg-surface py-2.5 text-sm font-medium text-ink transition hover:bg-surface-secondary"
      >
        {messages.result.generateAgain}
      </button>
      <button
        type="button"
        onClick={onNewImage}
        className="rounded-lg border border-border bg-surface py-2.5 text-sm font-medium text-ink transition hover:bg-surface-secondary"
      >
        {messages.result.newImage}
      </button>
    </div>
  );
}
