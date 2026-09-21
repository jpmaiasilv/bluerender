import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { SelectField } from '../SelectField';
import { PAYMENT_METHODS, PaymentMethod, DerivedStatus } from '../../lib/financial/types';
import { Client } from '../../lib/clients/types';
import { Project } from '../../lib/projects/types';
import { FinancialCategory } from '../../lib/financial/types';

export interface AdvancedFilters {
  clientId: string | null;
  projectId: string | null;
  categoryId: string | null;
  status: DerivedStatus | 'all';
  paymentMethod: PaymentMethod | null;
  valueMin: string;
  valueMax: string;
}

export const BLANK_ADVANCED_FILTERS: AdvancedFilters = {
  clientId: null,
  projectId: null,
  categoryId: null,
  status: 'all',
  paymentMethod: null,
  valueMin: '',
  valueMax: '',
};

export function isAdvancedFiltersActive(f: AdvancedFilters): boolean {
  return Boolean(f.clientId || f.projectId || f.categoryId || f.status !== 'all' || f.paymentMethod || f.valueMin || f.valueMax);
}

interface Props {
  value: AdvancedFilters;
  onChange: (value: AdvancedFilters) => void;
  clients: Client[];
  projects: Project[];
  categories: FinancialCategory[];
}

/** A single "Filtros" button that opens a compact popover — keeps the always-
 * visible toolbar (FiltersBar) uncluttered per the spec's own instruction. */
export function AdvancedFiltersPanel({ value, onChange, clients, projects, categories }: Props) {
  const { messages } = useLanguage();
  const t = messages.financial.filters;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(value);
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open, value]);

  const active = isAdvancedFiltersActive(value);
  const statusOptions: (DerivedStatus | 'all')[] = ['all', 'received', 'receivable', 'paid', 'payable', 'overdue'];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
          active ? 'border-sapphire bg-sapphire-light text-sapphire' : 'border-border bg-surface text-ink-secondary hover:border-sapphire/40'
        }`}
      >
        <SlidersHorizontal size={14} />
        {t.button}
        {active && <span className="h-1.5 w-1.5 rounded-full bg-sapphire" />}
      </button>

      {open && (
        <div className="absolute left-0 top-10 z-20 w-[320px] rounded-xl border border-border bg-surface p-4 shadow-lg">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t.title}</p>
          <div className="flex flex-col gap-3">
            <SelectField
              label={t.client}
              value={draft.clientId ?? ''}
              options={[{ value: '', label: t.anyClient }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
              onChange={(v) => setDraft((d) => ({ ...d, clientId: v || null }))}
            />
            <SelectField
              label={t.project}
              value={draft.projectId ?? ''}
              options={[{ value: '', label: t.anyProject }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
              onChange={(v) => setDraft((d) => ({ ...d, projectId: v || null }))}
            />
            <SelectField
              label={t.category}
              value={draft.categoryId ?? ''}
              options={[{ value: '', label: t.anyCategory }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
              onChange={(v) => setDraft((d) => ({ ...d, categoryId: v || null }))}
            />
            <SelectField
              label={t.status}
              value={draft.status}
              options={statusOptions.map((s) => ({ value: s, label: s === 'all' ? t.allStatuses : messages.financial.status[s] }))}
              onChange={(v) => setDraft((d) => ({ ...d, status: v as DerivedStatus | 'all' }))}
            />
            <SelectField
              label={t.paymentMethod}
              value={draft.paymentMethod ?? ''}
              options={[{ value: '', label: t.allPaymentMethods }, ...PAYMENT_METHODS.map((m) => ({ value: m, label: messages.financial.paymentMethods[m] }))]}
              onChange={(v) => setDraft((d) => ({ ...d, paymentMethod: (v || null) as PaymentMethod | null }))}
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-secondary">{t.valueMin}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={draft.valueMin}
                  onChange={(e) => setDraft((d) => ({ ...d, valueMin: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-sapphire"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-secondary">{t.valueMax}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={draft.valueMax}
                  onChange={(e) => setDraft((d) => ({ ...d, valueMax: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-sapphire"
                />
              </label>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                onChange(BLANK_ADVANCED_FILTERS);
                setDraft(BLANK_ADVANCED_FILTERS);
              }}
              className="text-xs font-medium text-ink-secondary hover:text-danger"
            >
              {t.clear}
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
              className="rounded-lg bg-sapphire px-4 py-1.5 text-sm font-medium text-white transition hover:bg-sapphire-hover"
            >
              {t.apply}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
