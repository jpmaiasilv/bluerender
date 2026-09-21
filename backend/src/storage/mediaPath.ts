import fs from 'node:fs';
import path from 'node:path';
import { RESULTS_DIR } from './resultStore';
import { UPLOADS_DIR } from './uploadStore';

/**
 * Resolves a public media URL path (as stored in an EditorMediaRef — always
 * "/results/xxx" or "/uploads/xxx") to a real local file path, for the video
 * export pipeline to feed to ffmpeg.
 *
 * Never trusts the URL beyond its filename: rejects anything containing a
 * path separator or "..", then re-checks the resolved absolute path is still
 * inside the expected directory. This is the only place export accepts a
 * client-supplied path, so it's the one place path traversal must be blocked.
 */
export function resolvePublicMediaPath(urlPath: string): string | null {
  const match = /^\/(results|uploads)\/([^/]+)$/.exec(urlPath);
  if (!match) return null;

  const [, kind, filename] = match;
  if (filename.includes('..') || filename.includes('\\')) return null;

  const baseDir = kind === 'results' ? RESULTS_DIR : UPLOADS_DIR;
  const resolved = path.join(baseDir, filename);
  const resolvedBase = path.resolve(baseDir) + path.sep;

  if (!path.resolve(resolved).startsWith(resolvedBase)) return null;
  if (!fs.existsSync(resolved)) return null;

  return resolved;
}
