import { useState } from 'react';
import { Globe } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { LanguageSelector } from '../LanguageSelector';

interface Props {
  /** Which side the dropdown opens from — footer sits at the bottom, so its panel should open upward. */
  align?: 'header' | 'footer';
}

/** Globe icon that reveals the shared LanguageSelector on click — reused by SalesHeader and SalesFooter so the language control looks identical everywhere on the sales page. */
export function LanguageSwitch({ align = 'header' }: Props) {
  const { messages } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={messages.profileMenu.changeLanguage}
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-full text-ink-secondary transition hover:bg-surface-secondary hover:text-ink"
      >
        <Globe size={17} />
      </button>
      {open && (
        <div
          className={`absolute right-0 z-10 w-40 rounded-xl border border-border bg-surface p-2 shadow-card ${
            align === 'footer' ? 'bottom-full mb-2' : 'mt-2'
          }`}
          onMouseLeave={() => setOpen(false)}
        >
          <LanguageSelector />
        </div>
      )}
    </div>
  );
}
