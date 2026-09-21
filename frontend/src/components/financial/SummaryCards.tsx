import { ReactNode } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Scale, TrendingDown, TrendingUp, Wallet2 } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { formatMoneyCents } from '../../lib/financial/money';

interface CardProps {
  label: string;
  value: number;
  icon: ReactNode;
  tone?: 'default' | 'positive' | 'negative';
  hint?: string;
  onClick?: () => void;
  onHintClick?: () => void;
}

function Card({ label, value, icon, tone = 'default', hint, onClick, onHintClick }: CardProps) {
  const { locale } = useLanguage();
  const toneClass = tone === 'positive' ? 'text-success' : tone === 'negative' ? 'text-danger' : 'text-ink';
  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 text-left shadow-card ${
        onClick ? 'transition hover:-translate-y-0.5 hover:border-sapphire/30 hover:shadow-md' : ''
      }`}
    >
      <div className="flex items-center gap-2 text-ink-secondary">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <span className={`text-xl font-semibold ${toneClass}`}>{formatMoneyCents(value, locale)}</span>
      {hint &&
        (onHintClick ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onHintClick();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                onHintClick();
              }
            }}
            className="w-fit text-xs font-medium text-danger underline decoration-dotted underline-offset-2 hover:text-danger/80"
          >
            {hint}
          </span>
        ) : (
          <span className="text-xs text-ink-muted">{hint}</span>
        ))}
    </Wrapper>
  );
}

interface Props {
  balanceCents: number;
  incomeCents: number;
  expenseCents: number;
  receivableCents: number;
  payableCents: number;
  forecastCents: number;
  receivableNext30Cents: number;
  payableNext30Cents: number;
  overdueReceivableCents: number;
  overduePayableCents: number;
  onFocusReceivable: () => void;
  onFocusPayable: () => void;
  onFocusOverdueReceivable: () => void;
  onFocusOverduePayable: () => void;
}

export function SummaryCards({
  balanceCents,
  incomeCents,
  expenseCents,
  receivableCents,
  payableCents,
  forecastCents,
  receivableNext30Cents,
  payableNext30Cents,
  overdueReceivableCents,
  overduePayableCents,
  onFocusReceivable,
  onFocusPayable,
  onFocusOverdueReceivable,
  onFocusOverduePayable,
}: Props) {
  const { messages, locale } = useLanguage();
  const t = messages.financial.cards;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <Card label={t.balance} value={balanceCents} icon={<Scale size={15} />} tone={balanceCents >= 0 ? 'positive' : 'negative'} />
      <Card label={t.income} value={incomeCents} icon={<ArrowUpCircle size={15} />} tone="positive" />
      <Card label={t.expense} value={expenseCents} icon={<ArrowDownCircle size={15} />} tone="negative" />
      <Card
        label={t.receivable}
        value={receivableCents}
        icon={<TrendingUp size={15} />}
        onClick={onFocusReceivable}
        hint={overdueReceivableCents > 0 ? t.overdueHint(formatMoneyCents(overdueReceivableCents, locale)) : undefined}
        onHintClick={overdueReceivableCents > 0 ? onFocusOverdueReceivable : undefined}
      />
      <Card
        label={t.payable}
        value={payableCents}
        icon={<TrendingDown size={15} />}
        onClick={onFocusPayable}
        hint={overduePayableCents > 0 ? t.overdueHint(formatMoneyCents(overduePayableCents, locale)) : undefined}
        onHintClick={overduePayableCents > 0 ? onFocusOverduePayable : undefined}
      />
      <Card
        label={t.forecast}
        value={forecastCents}
        icon={<Wallet2 size={15} />}
        tone={forecastCents >= 0 ? 'positive' : 'negative'}
        hint={`${t.receivableNext30} ${formatMoneyCents(receivableNext30Cents, locale)} · ${t.payableNext30} ${formatMoneyCents(
          payableNext30Cents,
          locale
        )}`}
      />
    </div>
  );
}
