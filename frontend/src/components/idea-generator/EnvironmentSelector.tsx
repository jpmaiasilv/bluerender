import { IDEA_ENVIRONMENT_VALUES } from '../../lib/options';
import { IdeaEnvironment } from '../../types';
import { SelectField } from '../SelectField';
import { useLanguage } from '../../i18n';

interface Props {
  value: IdeaEnvironment;
  onChange: (value: IdeaEnvironment) => void;
  disabled?: boolean;
}

/** Same dropdown component as Space/Goal/Style — one consistent visual language for every categorical field. */
export function EnvironmentSelector({ value, onChange, disabled }: Props) {
  const { messages } = useLanguage();
  const t = messages.ideaGenerator;

  return (
    <SelectField
      label={t.environmentLabel}
      value={value}
      options={IDEA_ENVIRONMENT_VALUES.map((env) => ({ value: env, label: t.environments[env] }))}
      onChange={(v) => onChange(v as IdeaEnvironment)}
      disabled={disabled}
    />
  );
}
