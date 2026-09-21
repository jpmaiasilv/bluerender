/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand — Sapphire Blue. Used sparingly: primary buttons, active nav item,
        // selected states, links, key icons. Everything else stays neutral.
        sapphire: {
          DEFAULT: '#1769E0',
          hover: '#1258C7',
          light: '#EAF2FF',
          soft: '#F4F8FF',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          secondary: '#F7F8FA',
        },
        border: '#E5E7EB',
        ink: {
          DEFAULT: '#111827',
          secondary: '#6B7280',
          muted: '#9CA3AF',
        },
        success: '#16A34A',
        warning: '#F59E0B',
        danger: '#EF4444',
        // Reserved exclusively for "Premium" (plan-gated, functional) indicators —
        // never used for "coming soon" (not-yet-built) states, which stay neutral gray.
        premium: {
          gold: '#D4A72C',
        },
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(23, 105, 224, 0.15), 0 8px 24px -8px rgba(23, 105, 224, 0.25)',
        card: '0 1px 2px 0 rgba(17, 24, 39, 0.04), 0 1px 3px 0 rgba(17, 24, 39, 0.06)',
      },
    },
  },
  plugins: [],
};
