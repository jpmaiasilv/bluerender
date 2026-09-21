import { useAuth } from '../../lib/auth/AuthProvider';

/**
 * Where each CTA on the sales page should actually go, based on real auth
 * state — never a guessed/invented route. Signed-out visitors go through the
 * real signup flow (/cadastro); signed-in visitors go straight into the
 * product instead of being asked to sign up again.
 */
export function useSalesCta() {
  const { session } = useAuth();
  const authenticated = Boolean(session);
  return {
    authenticated,
    /** Primary "create a render" CTAs. */
    primaryHref: authenticated ? '/render' : '/cadastro',
    /** Pricing CTAs — into the real (already-built) plan picker once signed in. */
    pricingHref: authenticated ? '/configuracoes/plano' : '/cadastro',
    loginHref: '/login',
    toolHref: (path: string) => (authenticated ? path : '/cadastro'),
  };
}
