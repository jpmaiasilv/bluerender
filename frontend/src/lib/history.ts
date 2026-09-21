import {
  HistoryEntry,
  isIdeaGeneratorHistoryEntry,
  isPlantaHumanizadaHistoryEntry,
  isRenderHistoryEntry,
  isTextToImageHistoryEntry,
} from '../types';
import { Messages } from '../i18n/types';

const STORAGE_KEY = 'render-lab:history';
const MAX_ENTRIES = 100;

/** Shared by History and Home's "Projetos recentes" — a single place for how a history entry gets its display title. */
export function historyEntryTitle(entry: HistoryEntry, messages: Messages): string {
  if (isTextToImageHistoryEntry(entry)) {
    return messages.textToImage.styles[entry.settings.style] ? `${messages.textToImage.styles[entry.settings.style]} · ${entry.prompt}` : entry.prompt;
  }
  if (isIdeaGeneratorHistoryEntry(entry)) {
    const styleLabel = messages.ideaGenerator.styles[entry.settings.style];
    return styleLabel ? `${styleLabel} · ${entry.settings.space}` : entry.settings.space;
  }
  if (isRenderHistoryEntry(entry)) {
    return messages.fields.renderStyles[entry.settings.renderStyle] ?? entry.settings.renderStyle;
  }
  if (isPlantaHumanizadaHistoryEntry(entry)) {
    if (entry.cleaned) return messages.plantaHumanizada.cleanupHistoryLabel;
    return messages.plantaHumanizada.renderStyles[entry.settings.renderStyle] ?? entry.settings.renderStyle;
  }
  return entry.prompt;
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Omit<HistoryEntry, 'toolId'> & { toolId?: HistoryEntry['toolId'] }>;
    // Entries saved before "toolId" existed are all Render IA generations.
    return parsed.map((entry) => ({ ...entry, toolId: entry.toolId ?? 'render' }));
  } catch {
    return [];
  }
}

export function saveHistoryEntry(entry: HistoryEntry): HistoryEntry[] {
  const next = [entry, ...loadHistory()].slice(0, MAX_ENTRIES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
