// --- Clients: core domain types ---
//
// New module — there was no real Clients entity before this (Project/
// FinancialTransaction's "clientId" fields were free text). Organization-
// scoped from the start, backed only by Supabase (see supabaseRepository.ts)
// — there is no IndexedDB implementation, since this module didn't exist
// locally to preserve.

export interface Client {
  id: string;
  organizationId: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClientInput {
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
}
