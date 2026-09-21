import { FolderOpen } from 'lucide-react';
import { ToolLayout } from '../components/ToolLayout';
import { useLanguage } from '../i18n';

/** Visual structure only — no project-grouping persistence exists yet (see History for real data). */
export function ProjectsPage() {
  const { messages } = useLanguage();

  return (
    <ToolLayout title={messages.projects.title} description={messages.projects.subtitle}>
      <div className="flex flex-1 flex-col items-center justify-center px-8 py-20 text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-sapphire-light">
          <FolderOpen size={28} className="text-sapphire" strokeWidth={1.75} />
        </div>
        <p className="max-w-md text-sm text-ink-secondary">{messages.projects.empty}</p>
      </div>
    </ToolLayout>
  );
}
