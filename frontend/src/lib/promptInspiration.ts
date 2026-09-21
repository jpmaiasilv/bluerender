import { Messages } from '../i18n';

function pickRandom<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Purely client-side idea generator — combines curated, localized fragments
 * into a natural sentence. Never calls any API and never consumes credits;
 * it is not presented as AI-generated, only as a starting point to edit.
 */
export function generateInspirationPrompt(messages: Messages): string {
  const { buildingTypes, styles, materials, settings, moods, template } = messages.textToImage.inspiration;
  return template(pickRandom(buildingTypes), pickRandom(styles), pickRandom(materials), pickRandom(settings), pickRandom(moods));
}
