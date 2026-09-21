import fs from 'node:fs';
import path from 'node:path';

/**
 * Persistent (survives a server restart, unlike services/generationLog.ts's
 * in-memory array) append-only log of every PAID job's CREATION — added
 * directly in response to the 2026-09-19 incident: an unauthorized real
 * generation (job 911351d4-...) ran and debited credits with no way to
 * trace its origin afterward, because nothing about job creation was ever
 * persisted (only in-memory `jobs` Maps, gone on restart, and no request-level
 * logging — no IP, no user-agent — existed at all).
 *
 * Deliberately minimal and NEVER includes sensitive data: no image bytes, no
 * API keys, no full request bodies — only what's needed to answer "who/what
 * created this job and when" after the fact.
 */
const LOG_PATH = path.join(__dirname, '..', '..', 'private-diagnostics', 'job-creation-log.jsonl');

export interface JobCreationLogEntry {
  timestamp: string;
  route: string;
  jobId: string;
  idempotencyKey: string | null;
  /** True when this call reused an EXISTING job for a previously-seen idempotency key, rather than creating a new one — makes duplicate-submit attempts visible in the log too. */
  reusedExistingJob: boolean;
  ip: string | null;
  userAgent: string | null;
}

export function logJobCreation(entry: Omit<JobCreationLogEntry, 'timestamp'>): void {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, `${line}\n`);
}

/** Read-only — for forensics/inspection scripts and tests. Never used by any request-handling code path. */
export function readJobCreationLog(): JobCreationLogEntry[] {
  if (!fs.existsSync(LOG_PATH)) return [];
  return fs
    .readFileSync(LOG_PATH, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as JobCreationLogEntry);
}

export function getJobCreationLogPath(): string {
  return LOG_PATH;
}
