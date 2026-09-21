import { SelectField } from '../SelectField';
import { T2IProjectType } from '../../types';
import { useLanguage } from '../../i18n';

type CategoryKey = 'residencial' | 'interiores' | 'comercial' | 'paisagismo' | 'fachadas' | 'conceitual';

const CATEGORY_TO_PROJECT_TYPE: Record<CategoryKey, T2IProjectType> = {
  residencial: 'exterior',
  interiores: 'interior',
  comercial: 'comercial',
  paisagismo: 'paisagismo',
  fachadas: 'exterior',
  conceitual: 'livre',
};

const CATEGORY_ORDER: CategoryKey[] = ['residencial', 'interiores', 'comercial', 'paisagismo', 'fachadas', 'conceitual'];

/** Two category keys ("residencial"/"fachadas") map to the same projectType — deterministic first-match keeps the select's value stable no matter which control last changed projectType. */
function categoryKeyForProjectType(projectType: T2IProjectType): CategoryKey {
  return CATEGORY_ORDER.find((key) => CATEGORY_TO_PROJECT_TYPE[key] === projectType) ?? 'conceitual';
}

interface Props {
  value: T2IProjectType;
  onChange: (value: T2IProjectType) => void;
  disabled?: boolean;
}

/** Same options and projectType mapping as the tool's old category chips — now a plain select, matching the Idea Generator's dropdown language. */
export function CategorySelect({ value, onChange, disabled }: Props) {
  const { messages } = useLanguage();
  const t = messages.textToImage;

  return (
    <SelectField
      label={t.categoryLabel}
      value={categoryKeyForProjectType(value)}
      options={CATEGORY_ORDER.map((key) => ({ value: key, label: t.quickChips[key] }))}
      onChange={(key) => onChange(CATEGORY_TO_PROJECT_TYPE[key as CategoryKey])}
      disabled={disabled}
    />
  );
}
