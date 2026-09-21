import { IdeaEnvironment, IdeaStyle } from '../types';
import { IdeaSpaceKey } from './options';

export interface IdeaExamplePreset {
  id: string;
  environment: IdeaEnvironment;
  spaceKey: IdeaSpaceKey;
  style: IdeaStyle;
}

/** Empty-state example chips (section 63) — each fills environment/space/style, not a text prompt. Labels live in i18n (messages.ideaGenerator.examples), keyed by `id`. */
export const IDEA_EXAMPLE_PRESETS: IdeaExamplePreset[] = [
  { id: 'sala_japandi', environment: 'interior', spaceKey: 'sala_estar', style: 'japandi' },
  { id: 'casa_tropical', environment: 'exterior', spaceKey: 'residencia', style: 'tropical' },
  { id: 'fachada_contemporanea', environment: 'exterior', spaceKey: 'fachada', style: 'contemporaneo' },
  { id: 'cozinha_minimalista', environment: 'interior', spaceKey: 'cozinha', style: 'minimalista' },
  { id: 'jardim_mediterraneo', environment: 'paisagismo', spaceKey: 'jardim_residencial', style: 'mediterraneo' },
];
