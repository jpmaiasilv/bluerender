import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../../layouts/AuthLayout';
import { useAuth } from '../../lib/auth/AuthProvider';
import { useLanguage } from '../../i18n';

/**
 * Landing point for every Supabase redirect: OAuth, email confirmation, and
 * password recovery links all point here. `detectSessionInUrl: true` on the
 * client (see lib/supabase.ts) means the session from the URL is already
 * applied by the time AuthProvider's initial getSession() resolves — this
 * page just waits for that, then routes onward.
 */
export function AuthCallbackPage() {
  const { messages } = useLanguage();
  const { session, isLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const t = messages.auth.callback;

  if (isLoading) {
    return (
      <AuthLayout title={t.processing}>
        <div className="flex justify-center py-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-sapphire border-t-transparent" />
        </div>
      </AuthLayout>
    );
  }

  if (session) {
    const next = searchParams.get('next');
    return <Navigate to={next ?? '/painel'} replace />;
  }

  return (
    <AuthLayout title={t.errorTitle}>
      <Link to="/login" className="text-sm font-medium text-sapphire hover:underline">
        {t.backToLogin}
      </Link>
    </AuthLayout>
  );
}
