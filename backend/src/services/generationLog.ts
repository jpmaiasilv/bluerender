export interface GenerationRecord {
  generationId: string;
  timestamp: number;
  // Free-form: holds Render IA's EngineTier ('fast'|'standard'|'pro') for render
  // generations, or Imagem por Texto's T2IEngineTier ('fast'|'pro'|'ultra') for
  // text-to-image generations — this log is shared dormant infra, not yet exposed
  // via any route, so it isn't tied to either tool's specific tier type.
  engine: string;
  provider: string;
  model: string;
  creditsCharged: number;
  status: 'complete' | 'error';
  resolution: { width: number; height: number } | null;
  hasReferenceRender: boolean;
}

const MAX_RECORDS = 500;
const records: GenerationRecord[] = [];

/**
 * In-memory log of generations for this dev MVP — there is no database yet.
 * Structured so a future persistence layer can replace this module's internals
 * with real inserts/queries without callers changing.
 */
export function recordGeneration(record: GenerationRecord): void {
  records.push(record);
  if (records.length > MAX_RECORDS) records.shift();
}

export function listGenerations(): GenerationRecord[] {
  return records;
}
