import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HelpCircle, LogOut, Settings, User } from 'lucide-react';
import { useLanguage } from '../i18n';
import { useAuth } from '../lib/auth/AuthProvider';
import { LanguageSelector } from './LanguageSelector';

const LOCALE_CODE: Record<string, string> = { pt: 'PT', en: 'EN', es: 'ES' };

export function ProfileMenu() {
  const { messages, locale } = useLanguage();
  const { user, profile, currentOrganization, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    await signOut();
    setOpen(false);
    navigate('/login', { replace: true });
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-secondary text-ink-secondary transition hover:border-sapphire hover:text-sapphire"
      >
        <User size={17} />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-border bg-surface p-2 shadow-card">
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-medium text-ink">{profile?.fullName || user?.email}</p>
            {user?.email && profile?.fullName && <p className="truncate text-xs text-ink-muted">{user.email}</p>}
            {currentOrganization && <p className="mt-0.5 truncate text-xs text-ink-muted">{currentOrganization.name}</p>}
          </div>

          <div className="my-1 h-px bg-border" />

          <div className="px-2 py-1.5">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">
              {messages.profileMenu.changeLanguage} · {LOCALE_CODE[locale]}
            </p>
            <LanguageSelector />
          </div>

          <div className="my-1 h-px bg-border" />

          <Link
            to="/ajuda"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-ink-secondary transition hover:bg-surface-secondary"
          >
            <HelpCircle size={16} className="text-ink-muted" />
            {messages.profileMenu.helpAndFeedback}
          </Link>
          <Link
            to="/configuracoes"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-ink-secondary transition hover:bg-surface-secondary"
          >
            <Settings size={16} className="text-ink-muted" />
            {messages.profileMenu.settings}
          </Link>

          <div className="my-1 h-px bg-border" />

          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-ink-secondary transition hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LogOut size={16} className="text-ink-muted" />
            {messages.profileMenu.logout}
          </button>
        </div>
      )}
    </div>
  );
}
