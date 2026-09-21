import { useId } from 'react';

interface Props {
  size?: number;
  className?: string;
}

/**
 * A small "realistic" gold padlock — filled body with a metallic gradient, a
 * highlight for shine, and a keyhole for depth — rather than a thin-stroke
 * line icon. Kept as its own tiny SVG (no new icon library) so it can be
 * reused anywhere a locked/premium indicator is needed with one consistent look.
 */
export function PremiumLockIcon({ size = 14, className = '' }: Props) {
  const gradientId = useId();

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="4" y1="4" x2="20" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F6DD8B" />
          <stop offset="45%" stopColor="#D4A72C" />
          <stop offset="100%" stopColor="#9C7412" />
        </linearGradient>
      </defs>
      <path
        d="M7.5 10.5V7.75a4.5 4.5 0 0 1 9 0v2.75"
        stroke={`url(#${gradientId})`}
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5" fill={`url(#${gradientId})`} />
      <rect x="5.3" y="11.3" width="13.4" height="2.9" rx="1.8" fill="#FCEFC3" opacity="0.45" />
      <circle cx="12" cy="15" r="1.4" fill="#7A5A0E" />
      <rect x="11.35" y="15.6" width="1.3" height="2.6" rx="0.5" fill="#7A5A0E" />
    </svg>
  );
}
