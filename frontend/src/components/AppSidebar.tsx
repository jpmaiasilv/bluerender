import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight, FolderOpen, History, HelpCircle, Home, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Logo, LogoMark } from './Logo';
import { PremiumLockIcon } from './icons/PremiumLockIcon';
import { toolsByGroup } from '../config/tools';
import type { ToolStatus } from '../config/tools';
import type { PlanId } from '../config/plans';
import { useLanguage } from '../i18n';

const STORAGE_KEY = 'render-lab:sidebar-collapsed';

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

interface NavItemProps {
  to: string;
  icon: LucideIcon;
  label: string;
  collapsed: boolean;
  /** Defaults to 'available' — Library/Help/Settings/Home items never pass this. */
  status?: ToolStatus;
  requiredPlan?: PlanId;
  /** Called instead of navigating when a locked ('premium' or 'comingSoon') item is clicked — the sidebar presents both identically (small gold lock, no "coming soon" text) and routes both to the same Upgrade experience, per the current design direction. */
  onLockedClick?: () => void;
}

/**
 * Single place that decides the lock glyph's size/appearance, so every locked
 * item in the sidebar (expanded or collapsed) looks identical — never styled
 * ad hoc per item.
 */
function LockGlyph({ size = 18 }: { size?: number }) {
  return <PremiumLockIcon size={size} />;
}

function NavItem({ to, icon: Icon, label, collapsed, status = 'available', requiredPlan, onLockedClick }: NavItemProps) {
  const { messages } = useLanguage();
  const isLocked = status !== 'available';
  const lockTooltip = requiredPlan
    ? messages.nav.premiumTooltip(messages.plans.names[requiredPlan])
    : messages.nav.premiumGenericTooltip;

  return (
    <NavLink
      to={to}
      onClick={(e) => {
        if (isLocked) {
          e.preventDefault();
          onLockedClick?.();
        }
      }}
      className={({ isActive }) =>
        `group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sapphire/40 ${
          isActive ? 'bg-sapphire-light font-medium text-sapphire' : 'text-ink-secondary hover:bg-sapphire-soft hover:text-sapphire'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-sapphire" aria-hidden="true" />
          )}
          <span className="relative shrink-0">
            <Icon
              size={18}
              strokeWidth={2}
              className={`transition-colors duration-150 ${isActive ? 'text-sapphire' : 'text-ink-muted group-hover:text-sapphire'}`}
            />
            {collapsed && isLocked && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-surface" aria-hidden="true">
                <LockGlyph size={12} />
              </span>
            )}
          </span>
          {!collapsed && (
            <span className="flex flex-1 items-center justify-between gap-2 truncate">
              <span className="truncate">{label}</span>
              {isLocked && (
                <span title={lockTooltip} className="shrink-0">
                  <LockGlyph />
                </span>
              )}
            </span>
          )}
          {collapsed && (
            <span className="pointer-events-none absolute left-full top-1/2 z-20 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
              {label}
              {isLocked ? ` · ${lockTooltip}` : ''}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

function GroupLabel({ children, collapsed }: { children: string; collapsed: boolean }) {
  if (collapsed) return <div className="my-2 h-px bg-border" />;
  return (
    <p className="mb-1.5 mt-6 px-3 text-[10px] font-semibold uppercase tracking-wider text-ink-muted/80 first:mt-0">
      {children}
    </p>
  );
}

interface Props {
  /** Opens the shared Upgrade modal — used when any locked nav item is clicked. */
  onOpenUpgrade: () => void;
}

export function AppSidebar({ onOpenUpgrade }: Props) {
  const { messages } = useLanguage();
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        // localStorage may be unavailable (private browsing); collapse state just won't persist.
      }
      return next;
    });
  }

  return (
    <aside
      className={`flex h-screen shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-150 ${
        collapsed ? 'w-[72px]' : 'w-60'
      }`}
    >
      <div className={`flex items-center px-4 py-6 ${collapsed ? 'justify-center' : ''}`}>
        {collapsed ? <LogoMark size={28} /> : <Logo size={28} />}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <GroupLabel collapsed={collapsed}>{messages.nav.groups.home}</GroupLabel>
        <NavItem to="/painel" icon={Home} label={messages.nav.items.home} collapsed={collapsed} />

        <GroupLabel collapsed={collapsed}>{messages.nav.groups.create}</GroupLabel>
        {toolsByGroup('create').map((tool) => (
          <NavItem
            key={tool.id}
            to={tool.path}
            icon={tool.icon}
            label={messages.nav.items[tool.id]}
            collapsed={collapsed}
            status={tool.status}
            requiredPlan={tool.requiredPlan}
            onLockedClick={onOpenUpgrade}
          />
        ))}

        <GroupLabel collapsed={collapsed}>{messages.nav.groups.edit}</GroupLabel>
        {toolsByGroup('edit').map((tool) => (
          <NavItem
            key={tool.id}
            to={tool.path}
            icon={tool.icon}
            label={messages.nav.items[tool.id]}
            collapsed={collapsed}
            status={tool.status}
            requiredPlan={tool.requiredPlan}
            onLockedClick={onOpenUpgrade}
          />
        ))}

        <GroupLabel collapsed={collapsed}>{messages.nav.groups.assist}</GroupLabel>
        {toolsByGroup('assist').map((tool) => (
          <NavItem
            key={tool.id}
            to={tool.path}
            icon={tool.icon}
            label={messages.nav.items[tool.id]}
            collapsed={collapsed}
            status={tool.status}
            requiredPlan={tool.requiredPlan}
            onLockedClick={onOpenUpgrade}
          />
        ))}

        <GroupLabel collapsed={collapsed}>{messages.nav.groups.management}</GroupLabel>
        {toolsByGroup('management').map((tool) => (
          <NavItem
            key={tool.id}
            to={tool.path}
            icon={tool.icon}
            label={messages.nav.items[tool.id]}
            collapsed={collapsed}
            status={tool.status}
            requiredPlan={tool.requiredPlan}
            onLockedClick={onOpenUpgrade}
          />
        ))}

        <GroupLabel collapsed={collapsed}>{messages.nav.groups.library}</GroupLabel>
        <NavItem to="/projetos" icon={FolderOpen} label={messages.nav.items.meusProjetos} collapsed={collapsed} />
        <NavItem to="/historico" icon={History} label={messages.nav.items.historico} collapsed={collapsed} />
      </nav>

      <div className="border-t border-border px-2 py-3">
        <NavItem to="/ajuda" icon={HelpCircle} label={messages.nav.items.ajuda} collapsed={collapsed} />
        <NavItem to="/configuracoes" icon={Settings} label={messages.nav.items.configuracoes} collapsed={collapsed} />

        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? messages.nav.expandSidebar : messages.nav.collapseSidebar}
          className={`mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-ink-muted transition duration-150 hover:bg-sapphire-soft hover:text-sapphire focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sapphire/40 ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          {!collapsed && <span>{messages.nav.collapseSidebar}</span>}
        </button>
      </div>
    </aside>
  );
}
