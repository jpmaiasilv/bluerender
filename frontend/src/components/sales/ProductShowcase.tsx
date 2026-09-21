import { ImageIcon, Sparkles, Upload } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { Reveal } from './Reveal';

/**
 * A faithful, inert recreation of Blue Render's real generation panel —
 * same field set and styling as components/SelectField.tsx and the
 * Render IA / Idea Generator control panels (types.ts's ProjectType,
 * PreserveLevel, RenderStyleOption, LightingOption, EnvironmentOption,
 * aspect ratio and custom-instructions fields, plus reference-image upload
 * and engine selection). Never a fabricated control that doesn't exist.
 */
function MockSelect({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-ink-secondary">{label}</span>
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink">
        {value}
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" className="text-ink-muted">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

export function ProductShowcase() {
  const { messages } = useLanguage();
  const t = messages.sales.showcase;
  const c = t.controls;

  return (
    <section className="bg-surface py-14 sm:py-20">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-5 sm:px-8 lg:grid-cols-2 lg:gap-14">
        <Reveal>
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t.title}</h2>
          <p className="mt-4 text-sm font-semibold text-sapphire">{t.subtitle}</p>
          <p className="mt-3 max-w-md text-base leading-relaxed text-ink-secondary">{t.body}</p>
        </Reveal>

        <Reveal delayMs={120}>
          <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_32px_80px_-32px_rgba(17,24,39,0.3)]">
            <div className="flex items-center gap-1.5 border-b border-border bg-surface-secondary px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-danger/50" />
              <span className="h-2.5 w-2.5 rounded-full bg-warning/50" />
              <span className="h-2.5 w-2.5 rounded-full bg-success/50" />
            </div>
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              <MockSelect label={c.projectType} value="Residencial" />
              <MockSelect label={c.preserveArchitecture} value="Alta" />
              <MockSelect label={c.style} value="Contemporâneo" />
              <MockSelect label={c.lighting} value="Golden hour" />
              <MockSelect label={c.environment} value="Urbano" />
              <MockSelect label={c.aspectRatio} value="16:9" />
            </div>
            <div className="px-5">
              <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-ink-secondary">{c.instructions}</span>
              <div className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink-muted">
                Fachada com revestimento em madeira, luz suave ao entardecer…
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 p-5">
              <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-5 text-ink-muted">
                <Upload size={16} />
                <span className="text-[11px]">{c.reference}</span>
              </div>
              <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-secondary py-5 text-ink-secondary">
                <ImageIcon size={16} />
                <span className="text-[11px]">{c.engine} · Pro</span>
              </div>
            </div>
            <div className="flex items-center justify-end border-t border-border bg-surface-secondary px-5 py-4">
              <span className="flex items-center gap-1.5 rounded-lg bg-sapphire px-4 py-2 text-xs font-semibold text-white">
                <Sparkles size={13} />
                Gerar
              </span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
