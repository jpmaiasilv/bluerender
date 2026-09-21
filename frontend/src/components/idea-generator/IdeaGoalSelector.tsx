import { useEffect } from 'react';
import { IDEA_GOALS_BY_ENVIRONMENT } from '../../lib/options';
import { IdeaEnvironment, IdeaGoal } from '../../types';
import { SelectField } from '../SelectField';
import { useLanguage } from '../../i18n';

interface Props {
  environment: IdeaEnvironment;
  value: IdeaGoal;
  onChange: (value: IdeaGoal) => void;
  disabled?: boolean;
}

/** Options change with Environment (section 19) — irrelevant goals are hidden, never just disabled. */
export function IdeaGoalSelector({ environment, value, onChange, disabled }: Props) {
  const { messages } = useLanguage();
  const t = messages.ideaGenerator;
  const goals = IDEA_GOALS_BY_ENVIRONMENT[environment];

  useEffect(() => {
    if (!goals.includes(value)) {
      onChange(goals[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environment]);

  return (
    <SelectField
      label={t.goalLabel}
      value={value}
      options={goals.map((g) => ({ value: g, label: t.goals[g] }))}
      onChange={(v) => onChange(v as IdeaGoal)}
      disabled={disabled}
    />
  );
}
