import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { Logo } from '../Logo';
import { useLanguage } from '../../i18n';
import { LanguageSelector } from '../LanguageSelector';
import { LanguageSwitch } from './LanguageSwitch';
import { useSalesCta } from './useSalesCta';
import { trackEvent } from '../../lib/analytics/trackEvent';

const NAV_ANCHORS = [
  { id: 'recursos', key: 'navFeatures' as const },
  { id: 'resultados', key: 'navResults' as const },
  { id: 'como-funciona', key: 'navHowItWorks' as const },
  { id: 'precos', key: 'navPricing' as const },
  { id: 'faq', key: 'navFaq' as const },
];

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function SalesHeader() {
  const { messages } = useLanguage();
  const t = messages.sales.header;
  const { primaryHref, loginHref, authenticated } = useSalesCta();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 24);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 transition-colors duration-300 ${
        scrolled ? 'border-b border-border bg-surface/80 backdrop-blur-md' : 'border-b border-transparent bg-surface'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link to="/" className="shrink-0" aria-label="Blue Render">
          <Logo size={34} />
        </Link>

        <nav className="hidden items-center gap-7 lg:flex">
          {NAV_ANCHORS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => scrollToSection(item.id)}
              className="text-sm font-medium text-ink-secondary transition hover:text-ink"
            >
              {t[item.key]}
            </button>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <LanguageSwitch />
          <Link to={loginHref} className="rounded-lg px-3.5 py-2 text-sm font-medium text-ink-secondary transition hover:text-ink">
            {t.login}
          </Link>
          <Link
            to={primaryHref}
            onClick={() => trackEvent('hero_cta_click', { location: 'header' })}
            className="rounded-lg bg-sapphire px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:bg-sapphire-hover"
          >
            {authenticated ? messages.nav.items.home : t.ctaStart}
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={mobileOpen ? messages.common.close : 'Menu'}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-secondary lg:hidden"
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t border-border bg-surface px-5 py-4 lg:hidden">
          <nav className="flex flex-col gap-1">
            {NAV_ANCHORS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  scrollToSection(item.id);
                }}
                className="rounded-lg px-2 py-2.5 text-left text-sm font-medium text-ink-secondary hover:bg-surface-secondary"
              >
                {t[item.key]}
              </button>
            ))}
          </nav>
          <div className="mt-3 border-t border-border pt-3">
            <LanguageSelector />
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <Link
              to={loginHref}
              onClick={() => setMobileOpen(false)}
              className="rounded-lg border border-border px-4 py-2.5 text-center text-sm font-medium text-ink"
            >
              {t.login}
            </Link>
            <Link
              to={primaryHref}
              onClick={() => {
                setMobileOpen(false);
                trackEvent('hero_cta_click', { location: 'header_mobile' });
              }}
              className="rounded-lg bg-sapphire px-4 py-2.5 text-center text-sm font-semibold text-white"
            >
              {t.ctaStart}
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
