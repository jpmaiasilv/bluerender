import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth/AuthProvider';
import { Logo } from './Logo';

/**
 * Gates every route nested under it: no session -> redirect to /login
 * (remembering where the user was headed); session still being recovered ->
 * a brief loading screen (never a login flash); session present -> render.
 */
export function ProtectedRoute() {
  const { session, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface">
        <Logo size={32} className="animate-pulse" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
