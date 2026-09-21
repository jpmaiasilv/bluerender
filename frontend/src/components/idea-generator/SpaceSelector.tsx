import { useEffect, useState } from 'react';
import { IDEA_SPACE_KEYS_BY_ENVIRONMENT, IdeaSpaceKey } from '../../lib/options';
import { IdeaEnvironment } from '../../types';
import { useLanguage } from '../../i18n';

interface Props {
  environment: IdeaEnvironment;
  /** The resolved label text actually sent to the backend (not the internal dropdown key). */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * The dropdown's own value is an internal key (IdeaSpaceKey), resolved to a
 * localized label before reaching `onChange` — the backend only ever receives
 * plain text. Picking "Outro" reveals a free-text field instead. "Livre"
 * environment skips the dropdown entirely (section 16: "permitir qualquer
 * conceito"), showing only the free-text field.
 */
export function SpaceSelector({ environment, value, onChange, disabled }: Props) {
  const { messages } = useLanguage();
  const t = messages.ideaGenerator;
  const isLivre = environment === 'livre';
  const keys = isLivre ? [] : IDEA_SPACE_KEYS_BY_ENVIRONMENT[environment];
  const [key, setKey] = useState<IdeaSpaceKey>('outro');

  useEffect(() => {
    if (isLivre) {
      setKey('outro');
      return;
    }
    const firstKey = keys[0];
    setKey(firstKey);
    onChange(t.spaces[firstKey]);
    // Only re-run when the environment itself changes — switching space/style shouldn't reset this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environment]);

  function handleSelectChange(nextKey: IdeaSpaceKey) {
    setKey(nextKey);
    onChange(nextKey === 'outro' ? '' : t.spaces[nextKey]);
  }

  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.spaceLabel}</span>
      {!isLivre && (
        <select
          value={key}
          disabled={disabled}
          onChange={(e) => handleSelectChange(e.target.value as IdeaSpaceKey)}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire disabled:cursor-not-allowed disabled:opacity-50"
        >
          {keys.map((k) => (
            <option key={k} value={k}>
              {t.spaces[k]}
            </option>
          ))}
        </select>
      )}
      {(isLivre || key === 'outro') && (
        <input
          type="text"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t.spaceOtherPlaceholder}
          className={`w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-muted focus:border-sapphire focus:ring-1 focus:ring-sapphire disabled:cursor-not-allowed disabled:opacity-50 ${
            !isLivre ? 'mt-1.5' : ''
          }`}
        />
      )}
    </div>
  );
}
