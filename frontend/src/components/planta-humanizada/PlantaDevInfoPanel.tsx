import { PlantaJobResultPayload } from '../../types';
import { useLanguage } from '../../i18n';

interface Props {
  result: PlantaJobResultPayload;
}

/** Dev-only technical breakdown — never shown to end customers in a production build. Mirrors DevInfoPanel.tsx (Render IA), typed for Planta Humanizada's own result shape. */
export function PlantaDevInfoPanel({ result }: Props) {
  const { messages } = useLanguage();
  const t = messages.plantaHumanizada;

  const rows: [string, string][] = [
    [messages.devInfo.engine, result.engine],
    [messages.devInfo.provider, result.provider],
    [messages.devInfo.model, result.model],
    [messages.devInfo.generationTime, `${(result.generationTimeMs / 1000).toFixed(1)}s`],
    [messages.devInfo.resolution, result.resolution ? `${result.resolution.width} × ${result.resolution.height}` : '—'],
    [messages.devInfo.creditsCharged, String(result.creditsCharged)],
  ];
  if (result.cleaned) {
    rows.push([t.cleanupAppliedLabel, t.cleanupAppliedYes]);
  }

  return (
    <details className="rounded-xl border border-border bg-surface-secondary p-3 text-xs">
      <summary className="cursor-pointer select-none font-medium uppercase tracking-wide text-ink-muted">
        {messages.devInfo.title}
      </summary>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="truncate text-right font-mono text-ink-secondary" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
