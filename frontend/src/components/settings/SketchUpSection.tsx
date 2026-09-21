import { ReactNode } from 'react';
import { ArrowRight, Box, Download, Lock, Sparkles } from 'lucide-react';
import { LogoMark } from '../Logo';
import { useLanguage } from '../../i18n';

/**
 * Generic "3D model" pictogram stands in for SketchUp — we don't have (and
 * shouldn't fabricate) a license to use SketchUp's own logo/assets here.
 */
export function SketchUpSection() {
  const { messages } = useLanguage();
  const t = messages.settings;

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-ink">{t.sketchup.title}</h2>
        <span className="rounded-full bg-sapphire-light px-2.5 py-0.5 text-[10px] font-semibold text-sapphire">
          {t.comingSoonBadge}
        </span>
      </div>

      <p className="text-sm text-ink-secondary">{t.sketchup.description1}</p>
      <p className="text-sm text-ink-secondary">{t.sketchup.description2}</p>

      <div className="flex items-center justify-center gap-3 rounded-xl border border-border bg-surface-secondary py-8 sm:gap-6">
        <Step icon={<Box size={22} className="text-ink-secondary" />} label={t.sketchup.step1} />
        <ArrowRight size={16} className="shrink-0 text-ink-muted" />
        <Step icon={<LogoMark size={26} />} label={t.sketchup.step2} />
        <ArrowRight size={16} className="shrink-0 text-ink-muted" />
        <Step icon={<Sparkles size={22} className="text-sapphire" />} label={t.sketchup.step3} />
      </div>

      <div>
        <button
          type="button"
          disabled
          className="flex items-center gap-2 rounded-lg bg-sapphire px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download size={16} />
          {t.sketchup.downloadButton}
          <Lock size={13} />
        </button>
        <p className="mt-2 text-xs text-ink-muted">{t.sketchup.availableSoon}</p>
      </div>
    </div>
  );
}

function Step({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface shadow-card">
        {icon}
      </div>
      <span className="text-xs font-medium text-ink-secondary">{label}</span>
    </div>
  );
}
