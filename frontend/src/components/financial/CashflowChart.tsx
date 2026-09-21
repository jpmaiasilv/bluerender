import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '../../i18n';
import { CashflowGranularity, cashflowSeries, cashflowSeriesWithCumulativeBalance } from '../../lib/financial/calculations';
import { PeriodRange } from '../../lib/financial/dates';
import { FinancialTransaction } from '../../lib/financial/types';
import { formatMoneyCents } from '../../lib/financial/money';

interface Props {
  transactions: FinancialTransaction[];
  range: PeriodRange;
  granularity: CashflowGranularity;
}

const SAPPHIRE = '#1769E0';
const DANGER = '#EF4444';

export function CashflowChart({ transactions, range, granularity }: Props) {
  const { messages, locale } = useLanguage();
  const t = messages.financial.chart;
  const [mode, setMode] = useState<'flow' | 'balance'>('flow');
  const [valuation, setValuation] = useState<'realized' | 'forecast'>('realized');

  const points = useMemo(
    () => cashflowSeries(transactions, range, granularity, valuation),
    [transactions, range, granularity, valuation]
  );

  const money = (v: number) => formatMoneyCents(v, locale);

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{t.title}</h3>
        <div className="flex flex-wrap gap-2">
          <div className="flex gap-1 rounded-lg border border-border bg-surface-secondary p-1">
            <button
              type="button"
              onClick={() => setValuation('realized')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                valuation === 'realized' ? 'bg-sapphire text-white shadow-sm' : 'text-ink-secondary hover:text-sapphire'
              }`}
            >
              {t.realizedMode}
            </button>
            <button
              type="button"
              onClick={() => setValuation('forecast')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                valuation === 'forecast' ? 'bg-sapphire text-white shadow-sm' : 'text-ink-secondary hover:text-sapphire'
              }`}
            >
              {t.forecastMode}
            </button>
          </div>
          <div className="flex gap-1 rounded-lg border border-border bg-surface-secondary p-1">
            <button
              type="button"
              onClick={() => setMode('flow')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                mode === 'flow' ? 'bg-sapphire text-white shadow-sm' : 'text-ink-secondary hover:text-sapphire'
              }`}
            >
              {t.flowMode}
            </button>
            <button
              type="button"
              onClick={() => setMode('balance')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                mode === 'balance' ? 'bg-sapphire text-white shadow-sm' : 'text-ink-secondary hover:text-sapphire'
              }`}
            >
              {t.balanceMode}
            </button>
          </div>
        </div>
      </div>

      {points.length === 0 ? (
        <p className="py-16 text-center text-sm text-ink-muted">{t.empty}</p>
      ) : (
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            {mode === 'flow' ? (
              <BarChart data={points} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={{ stroke: '#E5E7EB' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} tickFormatter={(v) => money(v)} width={70} />
                <Tooltip
                  formatter={(value, name) => [money(Number(value)), name === 'incomeCents' ? t.incomeLabel : t.expenseLabel]}
                  contentStyle={{ borderRadius: 8, borderColor: '#E5E7EB', fontSize: 12 }}
                />
                <Bar dataKey="incomeCents" name={t.incomeLabel} fill={SAPPHIRE} radius={[3, 3, 0, 0]} />
                <Bar dataKey="expenseCents" name={t.expenseLabel} fill={DANGER} radius={[3, 3, 0, 0]} />
              </BarChart>
            ) : (
              <LineChart data={cashflowSeriesWithCumulativeBalance(points)}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={{ stroke: '#E5E7EB' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} tickFormatter={(v) => money(v)} width={70} />
                <Tooltip formatter={(value) => [money(Number(value)), t.balanceMode]} contentStyle={{ borderRadius: 8, borderColor: '#E5E7EB', fontSize: 12 }} />
                <Line type="monotone" dataKey="cumulativeBalanceCents" stroke={SAPPHIRE} strokeWidth={2} dot={false} />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
