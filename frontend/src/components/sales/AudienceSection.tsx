import { Building2, GraduationCap, HardHat, PenTool, Ruler, Users } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { Reveal } from './Reveal';

const ICONS = { architects: Ruler, designers: PenTool, engineers: HardHat, students: GraduationCap, artists3d: Building2, offices: Users } as const;

export function AudienceSection() {
  const { messages } = useLanguage();
  const t = messages.sales.audience;
  const entries = Object.entries(t.items) as [keyof typeof ICONS, { title: string; body: string }][];

  return (
    <section className="bg-surface-secondary/60 py-14 sm:py-20">
      <div className="mx-auto max-w-5xl px-5 sm:px-8">
        <Reveal className="text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t.title}</h2>
        </Reveal>

        <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {entries.map(([key, item], index) => {
            const Icon = ICONS[key];
            return (
              <Reveal key={key} delayMs={(index % 3) * 80}>
                <div className="flex h-full flex-col gap-2.5 rounded-2xl border border-border bg-surface p-5">
                  <Icon size={20} className="text-sapphire" />
                  <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
                  <p className="text-xs leading-relaxed text-ink-secondary">{item.body}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
