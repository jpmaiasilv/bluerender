import { IDEA_STYLE_VALUES } from '../../lib/options';
import { IdeaStyle } from '../../types';
import { SelectField } from '../SelectField';
import { useLanguage } from '../../i18n';

interface Props {
  value: IdeaStyle;
  onChange: (value: IdeaStyle) => void;
  disabled?: boolean;
}

/** Same dropdown component as Environment/Space/Goal — one consistent visual language for every categorical field. */
export function IdeaStyleSelector({ value, onChange, disabled }: Props) {
  const { messages } = useLanguage();
  const t = messages.ideaGenerator;

  return (
    <SelectField
      label={t.styleLabel}
      value={value}
      options={IDEA_STYLE_VALUES.map((style) => ({ value: style, label: t.styles[style] }))}
      onChange={(v) => onChange(v as IdeaStyle)}
      disabled={disabled}
    />
  );
}
