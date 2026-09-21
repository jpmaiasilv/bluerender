import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLanguage } from '../i18n';

export interface EngineDropdownOption<T extends string> {
  id: T;
  credits: number;
  /** Small badge in the picker, e.g. "new" on a newly-added engine. */
  badge?: 'new' | null;
  /** Demoted into the picker's collapsed "legacy models" section instead of the featured list. Still fully selectable. */
  legacy: boolean;
}

interface Props<T extends string> {
  engines: Array<EngineDropdownOption<T>>;
  value: T;
  onChange: (id: T) => void;
  disabled?: boolean;
  /** Label above the dropdown (e.g. "Motor do Render", "Motor de Geração"). */
  title: string;
  /** Display name per engine id (e.g. "FLUX.2 Klein", "GPT Image", "Nano Banana 2"). */
  names: Record<T, string>;
  descriptions: Record<T, string>;
  /** Icon per engine id — every id must have one, so the summary/list rows always render something recognizable. */
  icons: Record<T, LucideIcon>;
}

function Row<T extends string>({
  engine,
  selected,
  name,
  description,
  Icon,
  onSelect,
  disabled,
}: {
  engine: EngineDropdownOption<T>;
  selected: boolean;
  name: string;
  description: string;
  Icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
}) {
  const { messages } = useLanguage();

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
        selected ? 'bg-sapphire-light' : 'hover:bg-surface-secondary'
      }`}
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${selected ? 'bg-sapphire text-white' : 'bg-surface-secondary text-ink-secondary'}`}>
        <Icon size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={`truncate text-sm font-medium ${selected ? 'text-sapphire' : 'text-ink'}`}>{name}</span>
          {engine.badge === 'new' && <span className="shrink-0 rounded-full bg-sapphire px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">{messages.engines.newBadge}</span>}
        </span>
        <span className="block truncate text-xs text-ink-muted">{description}</span>
      </span>
      <span className="shrink-0 text-xs text-ink-secondary">{messages.wallet.creditsSuffix(engine.credits)}</span>
      {selected && <Check size={16} className="shrink-0 text-sapphire" />}
    </button>
  );
}

/**
 * A single dropdown that picks WHICH AI generates the image (not a speed
 * tier): a summary button showing the current engine, opening a panel with
 * the featured engines up top and older ones tucked behind a "legacy
 * models" disclosure. Shared by Render IA, Imagem por Texto and Gerador de
 * Ideias — same visual language across every tool with an image engine.
 */
export function EngineDropdown<T extends string>({ engines, value, onChange, disabled, title, names, descriptions, icons }: Props<T>) {
  const { messages } = useLanguage();
  const [open, setOpen] = useState(false);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const featured = engines.filter((e) => !e.legacy);
  const legacy = engines.filter((e) => e.legacy);
  const selected = engines.find((e) => e.id === value);
  const SelectedIcon = icons[selected ? selected.id : value] as LucideIcon;

  // If the current selection is a legacy engine, the panel opens with that section already expanded — never hiding what is actually selected.
  useEffect(() => {
    if (open && selected?.legacy) setLegacyOpen(true);
  }, [open, selected?.legacy]);

  return (
    <div className="relative" ref={containerRef}>
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{title}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition hover:border-sapphire/40 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sapphire text-white">
          <SelectedIcon size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-ink">{selected ? names[selected.id] : ''}</span>
            {selected?.badge === 'new' && <span className="shrink-0 rounded-full bg-sapphire px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">{messages.engines.newBadge}</span>}
          </span>
          <span className="block truncate text-xs text-ink-muted">{selected ? messages.wallet.creditsSuffix(selected.credits) : ''}</span>
        </span>
        <ChevronDown size={16} className={`shrink-0 text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-2 rounded-xl border border-border bg-surface p-2 shadow-card">
          <div className="flex flex-col gap-0.5">
            {featured.map((engine) => (
              <Row
                key={engine.id}
                engine={engine}
                selected={engine.id === value}
                name={names[engine.id]}
                description={descriptions[engine.id]}
                Icon={icons[engine.id]}
                disabled={disabled}
                onSelect={() => {
                  onChange(engine.id);
                  setOpen(false);
                }}
              />
            ))}
          </div>

          {legacy.length > 0 && (
            <>
              <div className="my-1.5 h-px bg-border" />
              <button
                type="button"
                onClick={() => setLegacyOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-secondary"
              >
                {messages.engines.legacyModels}
                <ChevronDown size={14} className={`transition-transform ${legacyOpen ? 'rotate-180' : ''}`} />
              </button>
              {legacyOpen && (
                <div className="mt-0.5 flex flex-col gap-0.5">
                  {legacy.map((engine) => (
                    <Row
                      key={engine.id}
                      engine={engine}
                      selected={engine.id === value}
                      name={names[engine.id]}
                      description={descriptions[engine.id]}
                      Icon={icons[engine.id]}
                      disabled={disabled}
                      onSelect={() => {
                        onChange(engine.id);
                        setOpen(false);
                      }}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
