import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { Organization, OrganizationMembership, Profile } from './types';
import { mapOrganization, mapOrganizationMembership, mapProfile } from './mappers';

const CURRENT_ORG_STORAGE_KEY = 'render-lab:current-organization-id';

function readStoredOrganizationId(): string | null {
  try {
    return localStorage.getItem(CURRENT_ORG_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistOrganizationId(id: string) {
  try {
    localStorage.setItem(CURRENT_ORG_STORAGE_KEY, id);
  } catch {
    // Non-critical — worst case the org picker defaults to the first membership next time.
  }
}

function clearStoredOrganizationId() {
  try {
    localStorage.removeItem(CURRENT_ORG_STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

export interface SignUpResult {
  /** True when Supabase's email-confirmation setting is on and the account has no session yet. */
  needsEmailConfirmation: boolean;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  organizations: Organization[];
  /**
   * The active org for this browser tab. Only a UI preference — never a
   * security boundary. The database enforces access exclusively through RLS
   * (see is_organization_member/admin/owner in the auth foundation migration).
   */
  currentOrganization: Organization | null;
  /** The signed-in user's role within currentOrganization, or null while that can't be determined. */
  currentOrganizationRole: OrganizationMembership['role'] | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<SignUpResult>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshOrganizations: () => Promise<void>;
  setCurrentOrganizationId: (id: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

/**
 * Single source of truth for auth/session/profile/org state — every screen
 * reads it from here instead of calling supabase.auth.getSession() directly.
 * Financeiro and Fluxo de Projetos are untouched by this: they keep reading
 * their own IndexedDB repositories exactly as before.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [memberships, setMemberships] = useState<OrganizationMembership[]>([]);
  const [currentOrganizationId, setCurrentOrganizationIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Per-user guard so ensure_default_organization() is only ever called once
  // per signed-in user per tab session. The RPC is itself idempotent
  // server-side (advisory lock + existing-membership check), so this is a
  // network-round-trip optimization, not the actual duplication safeguard.
  const bootstrappedUserId = useRef<string | null>(null);

  const loadProfileAndOrganizations = useCallback(async (userId: string) => {
    if (!supabase) return;

    if (bootstrappedUserId.current !== userId) {
      bootstrappedUserId.current = userId;
      const { data: orgId, error } = await supabase.rpc('ensure_default_organization');
      if (error) {
        // eslint-disable-next-line no-console
        console.error('[auth] ensure_default_organization failed:', error.message);
      } else if (orgId) {
        // Seeds default project stages / financial categories for a brand-new
        // org — both idempotent server-side (see management_foundation
        // migration), so calling them again for an existing org is a no-op.
        const [stagesResult, categoriesResult] = await Promise.all([
          supabase.rpc('ensure_default_project_stages', { target_org_id: orgId }),
          supabase.rpc('ensure_default_financial_categories', { target_org_id: orgId }),
        ]);
        if (stagesResult.error) {
          // eslint-disable-next-line no-console
          console.error('[auth] ensure_default_project_stages failed:', stagesResult.error.message);
        }
        if (categoriesResult.error) {
          // eslint-disable-next-line no-console
          console.error('[auth] ensure_default_financial_categories failed:', categoriesResult.error.message);
        }
      }
    }

    const [profileResult, memberResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('organization_members').select('organization_id, user_id, role, created_at').eq('user_id', userId),
    ]);

    if (profileResult.data) setProfile(mapProfile(profileResult.data));

    const memberRows = memberResult.data ?? [];
    setMemberships(memberRows.map(mapOrganizationMembership));

    const orgIds = memberRows.map((m) => m.organization_id as string);
    if (orgIds.length === 0) {
      setOrganizations([]);
      setCurrentOrganizationIdState(null);
      return;
    }

    const { data: orgRows } = await supabase.from('organizations').select('*').in('id', orgIds);
    const orgs = (orgRows ?? []).map(mapOrganization);
    setOrganizations(orgs);

    const storedId = readStoredOrganizationId();
    const resolved = orgs.find((o) => o.id === storedId) ?? orgs[0] ?? null;
    setCurrentOrganizationIdState(resolved?.id ?? null);
    if (resolved) persistOrganizationId(resolved.id);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      if (data.session?.user) {
        await loadProfileAndOrganizations(data.session.user.id);
      }
      if (!cancelled) setIsLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);

      if (event === 'SIGNED_OUT') {
        setProfile(null);
        setOrganizations([]);
        setMemberships([]);
        setCurrentOrganizationIdState(null);
        bootstrappedUserId.current = null;
        return;
      }

      if (nextSession?.user) {
        loadProfileAndOrganizations(nextSession.user.id);
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [loadProfileAndOrganizations]);

  async function signIn(email: string, password: string) {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signUp(email: string, password: string, fullName: string): Promise<SignUpResult> {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) throw error;
    return { needsEmailConfirmation: !data.session };
  }

  /**
   * Prepared for when the Google provider is enabled in the Supabase
   * Dashboard (Authentication -> Providers). As of this writing the project
   * returns "Unsupported provider: provider is not enabled" for Google, so
   * no UI calls this yet — see the auth foundation report for the exact
   * Dashboard steps still needed.
   */
  async function signInWithGoogle() {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) throw error;
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    clearStoredOrganizationId();
    // IndexedDB (Financeiro, Fluxo de Projetos) is intentionally left untouched.
  }

  async function requestPasswordReset(email: string) {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/redefinir-senha`,
    });
    if (error) throw error;
  }

  async function updatePassword(newPassword: string) {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  async function refreshProfile() {
    if (!supabase || !session?.user) return;
    const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    if (data) setProfile(mapProfile(data));
  }

  async function refreshOrganizations() {
    if (!session?.user) return;
    await loadProfileAndOrganizations(session.user.id);
  }

  function setCurrentOrganizationId(id: string) {
    setCurrentOrganizationIdState(id);
    persistOrganizationId(id);
  }

  const currentOrganization = organizations.find((o) => o.id === currentOrganizationId) ?? null;
  const currentOrganizationRole = memberships.find((m) => m.organizationId === currentOrganizationId)?.role ?? null;

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    profile,
    organizations,
    currentOrganization,
    currentOrganizationRole,
    isLoading,
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
    requestPasswordReset,
    updatePassword,
    refreshProfile,
    refreshOrganizations,
    setCurrentOrganizationId,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
