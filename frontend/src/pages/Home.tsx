import { HomeHero } from '../components/home/HomeHero';
import { RecentProjectsSection } from '../components/home/RecentProjectsSection';
import { ToolCard } from '../components/ToolCard';
import { toolsByGroup } from '../config/tools';
import { TOOL_PREVIEW_IMAGES } from '../config/toolPreviewImages';
import { useWalletContext } from '../layouts/RootLayout';
import { useLanguage } from '../i18n';

export function Home() {
  const { messages } = useLanguage();
  const { openUpgradeModal } = useWalletContext();
  const createTools = toolsByGroup('create');
  const editTools = toolsByGroup('edit');

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Scrolling and width-centering are two different jobs: this outer div
          spans the full remaining width (so its native scrollbar sits flush
          against the real window edge, not floating mid-page), while the
          inner div only constrains/centers the content column. */}
      <div className="mx-auto w-full max-w-[1220px] px-6 py-8 sm:px-8">
        <HomeHero />

        <RecentProjectsSection />

        <h2 id="criar" className="mb-3 mt-10 scroll-mt-6 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {messages.home.createSection}
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {createTools.map((tool) => (
            <ToolCard
              key={tool.id}
              icon={tool.icon}
              title={messages.nav.items[tool.id]}
              description={messages.toolDescriptions[tool.id]}
              status={tool.status}
              requiredPlan={tool.requiredPlan}
              to={tool.path}
              imageSrc={TOOL_PREVIEW_IMAGES[tool.id]}
              onPremiumClick={openUpgradeModal}
            />
          ))}
        </div>

        <h2 className="mb-3 mt-10 text-xs font-semibold uppercase tracking-wide text-ink-muted">{messages.home.improveSection}</h2>
        <div className="grid grid-cols-2 gap-4 pb-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {editTools.map((tool) => (
            <ToolCard
              key={tool.id}
              icon={tool.icon}
              title={messages.nav.items[tool.id]}
              description={messages.toolDescriptions[tool.id]}
              status={tool.status}
              requiredPlan={tool.requiredPlan}
              to={tool.path}
              imageSrc={TOOL_PREVIEW_IMAGES[tool.id]}
              onPremiumClick={openUpgradeModal}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
