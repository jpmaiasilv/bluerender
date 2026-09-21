const KEY_PREFIX = 'render-lab:management-migration:';

/** Scoped per organization id — never a single global boolean, since a
 * device could belong to (or switch between) different escritórios. */
export function isManagementMigrationDone(organizationId: string): boolean {
  try {
    return localStorage.getItem(KEY_PREFIX + organizationId) === 'done';
  } catch {
    return false;
  }
}

export function markManagementMigrationDone(organizationId: string): void {
  try {
    localStorage.setItem(KEY_PREFIX + organizationId, 'done');
  } catch {
    // Non-critical — worst case the sync prompt is offered again next reload.
  }
}
