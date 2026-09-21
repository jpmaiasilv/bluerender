/**
 * Honest stand-in for real Blue Render before/after imagery. This project's
 * asset folder only has the logo (frontend/src/assets — checked) — there are
 * no real render pairs to show yet, and this sales page must never present a
 * fabricated image as if it were genuine Blue Render output (explicit
 * requirement). So instead of a fake photo, this draws an abstract
 * architectural line drawing: "sketch" (thin outline, blueprint-style — the
 * *before*) and "render" (filled gradient, soft glow — the *after*). It's
 * honest about being a diagram, not a photograph, while still carrying the
 * "rough input -> polished output" idea.
 *
 * TODO(assets): replace every <PlaceholderArt> usage with real
 * originalSrc/resultSrc image pairs once real Blue Render output exists —
 * see BeforeAfterSlider's props, which already accept plain image URLs.
 */

export type ArtMood = 'facade' | 'interior' | 'landscape' | 'commercial';
export type ArtVariant = 'sketch' | 'render';

interface Props {
  mood: ArtMood;
  variant: ArtVariant;
  className?: string;
  /** 'cover' (default, crops to fill) mirrors every existing usage unchanged; 'contain' (SVG's "meet") shows the whole illustration with no cropping — used by the hero fallback. */
  fit?: 'cover' | 'contain';
}

const SKETCH_STROKE = '#9CA3AF';
const SKETCH_BG = '#F7F8FA';

function FacadeShapes({ variant }: { variant: ArtVariant }) {
  const fill = variant === 'render' ? 'url(#brGradient)' : 'none';
  const stroke = variant === 'render' ? 'none' : SKETCH_STROKE;
  return (
    <>
      <rect x="150" y="90" width="180" height="210" fill={fill} stroke={stroke} strokeWidth="1.5" />
      <rect x="150" y="60" width="180" height="30" fill={fill} stroke={stroke} strokeWidth="1.5" />
      {[0, 1, 2, 3].map((row) =>
        [0, 1, 2].map((col) => (
          <rect
            key={`${row}-${col}`}
            x={172 + col * 50}
            y={115 + row * 42}
            width="28"
            height="28"
            fill={variant === 'render' ? 'url(#brGlow)' : 'none'}
            stroke={variant === 'render' ? 'none' : SKETCH_STROKE}
            strokeWidth="1"
          />
        ))
      )}
      <line x1="60" y1="300" x2="420" y2="300" stroke={variant === 'render' ? '#1258C7' : SKETCH_STROKE} strokeWidth="1.5" opacity={variant === 'render' ? 0.4 : 1} />
    </>
  );
}

function InteriorShapes({ variant }: { variant: ArtVariant }) {
  const fill = variant === 'render' ? 'url(#brGradient)' : 'none';
  const stroke = variant === 'render' ? 'none' : SKETCH_STROKE;
  return (
    <>
      <rect x="70" y="70" width="340" height="200" fill={fill} stroke={stroke} strokeWidth="1.5" />
      <rect x="230" y="100" width="140" height="100" fill={variant === 'render' ? 'url(#brGlow)' : 'none'} stroke={variant === 'render' ? 'none' : SKETCH_STROKE} strokeWidth="1" />
      <rect x="100" y="210" width="90" height="45" fill={variant === 'render' ? '#0E3E85' : 'none'} stroke={variant === 'render' ? 'none' : SKETCH_STROKE} strokeWidth="1" opacity={variant === 'render' ? 0.7 : 1} />
      <line x1="70" y1="270" x2="410" y2="270" stroke={variant === 'render' ? '#1258C7' : SKETCH_STROKE} strokeWidth="1.5" opacity={variant === 'render' ? 0.4 : 1} />
    </>
  );
}

function LandscapeShapes({ variant }: { variant: ArtVariant }) {
  const fill = variant === 'render' ? 'url(#brGradient)' : 'none';
  const stroke = variant === 'render' ? 'none' : SKETCH_STROKE;
  return (
    <>
      <rect x="90" y="160" width="150" height="120" fill={fill} stroke={stroke} strokeWidth="1.5" />
      <polygon points="330,280 360,200 390,280" fill={variant === 'render' ? '#134FA6' : 'none'} stroke={variant === 'render' ? 'none' : SKETCH_STROKE} strokeWidth="1" opacity={variant === 'render' ? 0.55 : 1} />
      <polygon points="370,280 395,220 420,280" fill={variant === 'render' ? '#1769E0' : 'none'} stroke={variant === 'render' ? 'none' : SKETCH_STROKE} strokeWidth="1" opacity={variant === 'render' ? 0.4 : 1} />
      <line x1="50" y1="280" x2="430" y2="280" stroke={variant === 'render' ? '#1258C7' : SKETCH_STROKE} strokeWidth="1.5" opacity={variant === 'render' ? 0.4 : 1} />
    </>
  );
}

function CommercialShapes({ variant }: { variant: ArtVariant }) {
  const fill = variant === 'render' ? 'url(#brGradient)' : 'none';
  const stroke = variant === 'render' ? 'none' : SKETCH_STROKE;
  return (
    <>
      <rect x="60" y="140" width="360" height="140" fill={fill} stroke={stroke} strokeWidth="1.5" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <line key={i} x1={90 + i * 58} y1="140" x2={90 + i * 58} y2="280" stroke={variant === 'render' ? '#0E3E85' : SKETCH_STROKE} strokeWidth="1" opacity={variant === 'render' ? 0.35 : 0.6} />
      ))}
      <rect x="60" y="120" width="360" height="20" fill={variant === 'render' ? 'url(#brGlow)' : 'none'} stroke={variant === 'render' ? 'none' : SKETCH_STROKE} strokeWidth="1" />
      <line x1="40" y1="280" x2="440" y2="280" stroke={variant === 'render' ? '#1258C7' : SKETCH_STROKE} strokeWidth="1.5" opacity={variant === 'render' ? 0.4 : 1} />
    </>
  );
}

const SHAPES: Record<ArtMood, typeof FacadeShapes> = {
  facade: FacadeShapes,
  interior: InteriorShapes,
  landscape: LandscapeShapes,
  commercial: CommercialShapes,
};

export function PlaceholderArt({ mood, variant, className = '', fit = 'cover' }: Props) {
  const Shapes = SHAPES[mood];
  return (
    <svg
      viewBox="0 0 480 360"
      className={className}
      preserveAspectRatio={fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice'}
      role="img"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="brGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2A7BEA" />
          <stop offset="100%" stopColor="#0E3E85" />
        </linearGradient>
        <radialGradient id="brGlow" cx="50%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#FFE9B8" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#FFB84D" stopOpacity="0.55" />
        </radialGradient>
        <linearGradient id="brSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#EAF2FF" />
          <stop offset="100%" stopColor="#F7F8FA" />
        </linearGradient>
      </defs>
      <rect width="480" height="360" fill={variant === 'render' ? 'url(#brSky)' : SKETCH_BG} />
      {variant === 'sketch' &&
        Array.from({ length: 12 }).map((_, row) =>
          Array.from({ length: 16 }).map((_, col) => (
            <circle key={`${row}-${col}`} cx={16 + col * 30} cy={16 + row * 30} r="0.8" fill="#D1D5DB" />
          ))
        )}
      <Shapes variant={variant} />
    </svg>
  );
}
