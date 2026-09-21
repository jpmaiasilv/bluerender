import { Organization, OrganizationMembership, OrganizationRole, Profile } from './types';

interface ProfileRow {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

interface OrganizationRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

interface OrganizationMemberRow {
  organization_id: string;
  user_id: string;
  role: OrganizationRole;
  created_at: string;
}

export function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    phone: row.phone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapOrganizationMembership(row: OrganizationMemberRow): OrganizationMembership {
  return {
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role,
    createdAt: row.created_at,
  };
}
