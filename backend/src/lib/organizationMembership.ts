import { getSupabaseAdmin } from './supabaseAdmin';

/**
 * The backend reads organization_members directly with the service_role key
 * (which bypasses RLS), so it must replicate the same membership/role checks
 * the database's RLS policies already enforce for normal (anon/authenticated)
 * clients — otherwise a caller could pass any organizationId and act on an
 * organization they don't belong to.
 */

async function getRole(userId: string, organizationId: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('organization_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data.role as string;
}

export async function isOrganizationMember(userId: string, organizationId: string): Promise<boolean> {
  return (await getRole(userId, organizationId)) !== null;
}

export async function isOrganizationAdmin(userId: string, organizationId: string): Promise<boolean> {
  const role = await getRole(userId, organizationId);
  return role === 'owner' || role === 'admin';
}
