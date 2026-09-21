import { useLanguage } from '../i18n';
import logoMarkSrc from '../assets/logo-mark.png';
import wordmarkSrc from '../assets/wordmark.png';

interface LogoMarkProps {
  size?: number;
  className?: string;
}

/**
 * The symbol only — our real brand mark (frontend/src/assets/logo-mark.png).
 * Kept as its own export so it can be reused standalone (collapsed sidebar,
 * illustrations) independent of the wordmark next to it. Also used as the
 * favicon (frontend/public/favicon.png, same source file) — see index.html.
 */
export function LogoMark({ size = 28, className = '' }: LogoMarkProps) {
  return (
    <img
      src={logoMarkSrc}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`shrink-0 object-contain ${className}`}
    />
  );
}

interface LogoProps {
  size?: number;
  /** Show only the symbol (collapsed sidebar, favicon-style contexts). */
  markOnly?: boolean;
  className?: string;
}

/**
 * Brand lockup — the mark plus the "blue render" wordmark image
 * (frontend/src/assets/wordmark.png). Wherever the brand name is written out,
 * this image is what renders it — never plain text — per the brand asset.
 */
export function Logo({ size = 28, markOnly = false, className = '' }: LogoProps) {
  const { messages } = useLanguage();

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <LogoMark size={size} />
      {!markOnly && (
        <img src={wordmarkSrc} alt={messages.header.brand} style={{ height: size * 0.7 }} className="w-auto object-contain" />
      )}
    </div>
  );
}
