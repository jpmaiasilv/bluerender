import { ToolLayout } from '../components/ToolLayout';
import { ComingSoon } from '../components/ComingSoon';
import { getTool } from '../config/tools';
import { ToolId } from '../i18n/types';
import { useLanguage } from '../i18n';

interface Props {
  toolId: ToolId;
}

/** Generic "coming soon" page used by every planned tool with no backend yet. */
export function ComingSoonToolPage({ toolId }: Props) {
  const { messages } = useLanguage();
  const tool = getTool(toolId);

  return (
    <ToolLayout title={messages.nav.items[toolId]} description={messages.toolDescriptions[toolId]}>
      <ComingSoon icon={tool.icon} title={messages.comingSoon.title} message={messages.comingSoon.message} />
    </ToolLayout>
  );
}
