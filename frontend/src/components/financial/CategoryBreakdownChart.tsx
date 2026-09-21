import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useLanguage } from '../../i18n';
import { CategoryBreakdownItem } from '../../lib/financial/calculations';
import { formatMoneyCents } from '../../lib/financial/money';

interface Props {
  items: CategoryBreakdownItem[];
}

const SLICE_COLORS = ['#1769E0', '#5B9BF0', '#93C1F7', '#0B4A9E', '#B7D5FA', '#9CA3AF'];

export function CategoryBreakdownChart({ items }: Props) {
  const { messages, locale } = useLanguage();
  const t = messages.financial.categoryChart;

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <h3 className="mb-3 text-sm font-semibold text-ink">{t.title}</h3>
      {items.length === 0 ? (
        <p className="py-16 text-center text-sm text-ink-muted">{t.empty}</p>
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <div className="h-[180px] w-[180px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={items} dataKey="amountCents" nameKey="categoryName" innerRadius={48} outerRadius={80} paddingAngle={2}>
                  {items.map((entry, i) => (
                    <Cell key={entry.categoryId} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatMoneyCents(Number(value), locale)} contentStyle={{ borderRadius: 8, borderColor: '#E5E7EB', fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex-1 space-y-1.5">
            {items.map((item, i) => (
              <li key={item.categoryId} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                  <span className="truncate text-ink-secondary">{item.categoryName}</span>
                </span>
                <span className="shrink-0 font-medium text-ink">{formatMoneyCents(item.amountCents, locale)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
