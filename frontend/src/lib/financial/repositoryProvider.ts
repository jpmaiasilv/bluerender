import { SupabaseCategoryRepository, SupabaseFinancialRepository } from './supabaseRepository';
import { CategoryRepository, FinancialRepository } from './repository';

/**
 * The one place in the app that decides which repository implementation
 * backs the financial module. Attachments are not a financial concern —
 * they're project_files rows (see lib/projectFiles/projectFileRepositoryProvider.ts),
 * referenced from a transaction by attachmentFileId.
 */
export interface FinancialRepositories {
  financial: FinancialRepository;
  categories: CategoryRepository;
}

let cachedOrgId: string | null = null;
let cached: FinancialRepositories | null = null;

export function getFinancialRepositories(organizationId: string): FinancialRepositories {
  if (!cached || cachedOrgId !== organizationId) {
    cached = {
      financial: new SupabaseFinancialRepository(organizationId),
      categories: new SupabaseCategoryRepository(organizationId),
    };
    cachedOrgId = organizationId;
  }
  return cached;
}
