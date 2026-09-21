import { BillingCycle } from '../config/plans';
import { useLanguage } from '../i18n';

interface Props {
  value: BillingCycle;
  onChange: (cycle: BillingCycle) => void;
}

export function BillingCycleToggle({ value, onChange }: Props) {
  const { messages } = useLanguage();

  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-secondary p-1">
      <button
        type="button"
        onClick={() => onChange('monthly')}
        className={`rounded-full px-4 py-2 text-sm font-medium transition ${
          value === 'monthly' ? 'bg-surface text-ink shadow-card' : 'text-ink-secondary hover:text-ink'
        }`}
      >
        {messages.plans.billingToggle.monthly}
      </button>
      <button
        type="button"
        onClick={() => onChange('annual')}
        className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
          value === 'annual' ? 'bg-surface text-ink shadow-card' : 'text-ink-secondary hover:text-ink'
        }`}
      >
        {messages.plans.billingToggle.annual}
        <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
          {messages.plans.billingToggle.annualBadge}
        </span>
      </button>
    </div>
  );
}
