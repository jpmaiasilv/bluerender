import { useLanguage } from '../../i18n';
import { Reveal } from './Reveal';

const SOFTWARE = ['SketchUp', 'Archicad', 'Revit', 'Rhino', 'Blender', '3ds Max', 'AutoCAD'];

/** Compatibility is by image export only — never claim a native plugin/integration that doesn't exist (SketchUp's own plugin is still "coming soon", see settings/SketchUpSection.tsx). */
export function SoftwareCompatibility() {
  const { messages } = useLanguage();
  const t = messages.sales.compatibility;

  return (
    <section className="border-y border-border bg-surface-secondary/60 py-10">
      <div className="mx-auto max-w-5xl px-5 text-center sm:px-8">
        <Reveal>
          <h2 className="text-lg font-semibold text-ink sm:text-xl">{t.title}</h2>
        </Reveal>
        <Reveal delayMs={80}>
          <div className="mx-auto mt-6 flex max-w-3xl flex-wrap items-center justify-center gap-x-8 gap-y-3">
            {SOFTWARE.map((name) => (
              <span key={name} className="text-sm font-medium text-ink-muted transition hover:text-ink-secondary">
                {name}
              </span>
            ))}
          </div>
        </Reveal>
        <Reveal delayMs={140}>
          <p className="mt-6 text-sm text-ink-secondary">{t.note}</p>
        </Reveal>
      </div>
    </section>
  );
}
