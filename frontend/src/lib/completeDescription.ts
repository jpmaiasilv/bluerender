import { Messages } from '../i18n';
import { TextToImageSettings } from '../types';

/**
 * Deterministic, non-AI "Completar descrição" — appends the currently selected
 * project type / style / lighting as a plain clause, using labels that are
 * already fully localized. No text-generation API exists in this project, so
 * this never calls one; it only reflects choices already made in the UI.
 */
export function completeDescription(prompt: string, settings: TextToImageSettings, messages: Messages): string {
  const t = messages.textToImage;
  const parts: string[] = [];

  if (settings.projectType !== 'livre') parts.push(t.projectTypes[settings.projectType]);
  if (settings.style !== 'livre') parts.push(t.styles[settings.style]);
  if (settings.lighting !== 'automatica') parts.push(t.lightingOptions[settings.lighting]);

  if (parts.length === 0) return prompt;

  const clause = `${t.completionPrefix}: ${parts.join(', ')}.`;
  const trimmed = prompt.trim();
  if (trimmed.includes(clause)) return prompt;
  return trimmed ? `${trimmed}\n\n${clause}` : clause;
}
