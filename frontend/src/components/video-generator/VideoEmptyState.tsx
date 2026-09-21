import { Video } from 'lucide-react';
import { useLanguage } from '../../i18n';

export function VideoEmptyState() {
  const { messages } = useLanguage();
  const t = messages.videoGenerator.emptyState;

  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-secondary px-8 py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sapphire-light">
        <Video size={22} className="text-sapphire" />
      </div>
      <p className="text-base font-medium text-ink">{t.title}</p>
      <p className="mt-1 max-w-sm text-sm text-ink-secondary">{t.subtitle}</p>
    </div>
  );
}
