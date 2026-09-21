import { Link } from 'react-router-dom';
import { Instagram } from 'lucide-react';
import { Logo } from '../Logo';
import { WhatsAppIcon } from '../icons/WhatsAppIcon';
import { useLanguage } from '../../i18n';
import { LanguageSwitch } from './LanguageSwitch';

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const INSTAGRAM_HANDLE = 'bluerender.ai';
const INSTAGRAM_URL = `https://instagram.com/${INSTAGRAM_HANDLE}`;
// Brazilian mobile number (DDD 31), WhatsApp click-to-chat link format: country code + area code + number.
const WHATSAPP_DISPLAY = '+55 (31) 99711-0990';
const WHATSAPP_URL = 'https://wa.me/5531997110990';

/**
 * No Legal column (Termos/Privacidade/Cookies): none of those pages exist
 * yet anywhere in the app — omitted rather than linking to a page that
 * doesn't exist. Support still points at /ajuda, the one real contact
 * surface that already exists inside the app; Instagram and WhatsApp are
 * this company's actual external contact channels.
 */
export function SalesFooter() {
  const { messages } = useLanguage();
  const t = messages.sales.footer;

  return (
    <footer className="border-t border-border bg-surface py-14">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <Logo size={24} />
            <p className="mt-3 max-w-[220px] text-sm text-ink-secondary">{t.tagline}</p>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{t.productTitle}</h3>
            <ul className="mt-3 flex flex-col gap-2.5 text-sm text-ink-secondary">
              <li>
                <button type="button" onClick={() => scrollToSection('recursos')} className="hover:text-ink">
                  {t.tools}
                </button>
              </li>
              <li>
                <button type="button" onClick={() => scrollToSection('precos')} className="hover:text-ink">
                  {t.pricingLink}
                </button>
              </li>
              <li>
                <button type="button" onClick={() => scrollToSection('galeria')} className="hover:text-ink">
                  {t.galleryLink}
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{t.resourcesTitle}</h3>
            <ul className="mt-3 flex flex-col gap-2.5 text-sm text-ink-secondary">
              <li>
                <button type="button" onClick={() => scrollToSection('faq')} className="hover:text-ink">
                  {t.faqLink}
                </button>
              </li>
              <li>
                <Link to="/ajuda" className="hover:text-ink">
                  {t.support}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{t.companyTitle}</h3>
            <ul className="mt-3 flex flex-col gap-2.5 text-sm text-ink-secondary">
              <li>
                <Link to="/ajuda" className="hover:text-ink">
                  {t.contact}
                </Link>
              </li>
              <li>
                <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer" aria-label={t.instagram} className="flex items-center gap-1.5 hover:text-ink">
                  <Instagram size={14} />
                  @{INSTAGRAM_HANDLE}
                </a>
              </li>
              <li>
                <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" aria-label={t.whatsapp} className="flex items-center gap-1.5 hover:text-ink">
                  <WhatsAppIcon size={14} />
                  {WHATSAPP_DISPLAY}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border pt-6 sm:flex-row">
          <p className="text-xs text-ink-muted">{t.copyright(new Date().getFullYear())}</p>
          <LanguageSwitch align="footer" />
        </div>
      </div>
    </footer>
  );
}
