import { EditorElement } from './types';

const KEY_PREFIX = 'render-lab:planta-editor:';

/** Keyed by the result's requestId — reopening the editor for the same generated image restores where the user left off. */
export function saveEditorState(requestId: string, elements: EditorElement[]): void {
  try {
    localStorage.setItem(KEY_PREFIX + requestId, JSON.stringify(elements));
  } catch {
    // Non-critical — worst case the user's annotations aren't restored next time.
  }
}

export function loadEditorState(requestId: string): EditorElement[] | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + requestId);
    return raw ? (JSON.parse(raw) as EditorElement[]) : null;
  } catch {
    return null;
  }
}
