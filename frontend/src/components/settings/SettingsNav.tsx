import { NavLink } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { SETTINGS_SECTIONS } from '../../config/settingsSections';
import { useLanguage } from '../../i18n';

/**
 * Settings' own internal navigation — deliberately separate from AppSidebar
 * (the main app nav). Desktop: compact vertical list. Mobile: horizontal
 * scroll-snap pills, so it never eats half the screen.
 */
export function SettingsNav() {
  const { messages } = useLanguage();

  return (
    <>
      <nav className="hidden w-56 shrink-0 flex-col gap-0.5 border-r border-border p-3 md:flex">
        {SETTINGS_SECTIONS.map((section) => (
          <NavLink
            key={section.id}
            to={section.path}
            title={section.locked ? messages.settings.comingSoonLockTooltip : undefined}
            className={({ isActive }) =>
              `group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                isActive ? 'bg-sapphire-light font-medium text-sapphire' : 'text-ink-secondary hover:bg-surface-secondary'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-sapphire" />}
                <section.icon size={16} className={isActive ? 'text-sapphire' : 'text-ink-muted'} />
                <span className="flex-1 truncate">{messages.settings.nav[section.id]}</span>
                {section.locked && <Lock size={12} className="shrink-0 text-ink-muted" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <nav className="flex snap-x gap-2 overflow-x-auto border-b border-border p-3 md:hidden">
        {SETTINGS_SECTIONS.map((section) => (
          <NavLink
            key={section.id}
            to={section.path}
            className={({ isActive }) =>
              `flex shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition ${
                isActive ? 'border-sapphire bg-sapphire-light font-medium text-sapphire' : 'border-border text-ink-secondary'
              }`
            }
          >
            <section.icon size={14} />
            {messages.settings.nav[section.id]}
            {section.locked && <Lock size={11} className="text-ink-muted" />}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
