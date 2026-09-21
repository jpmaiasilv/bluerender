import { FormEvent, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { AuthLayout } from '../../layouts/AuthLayout';
import { useAuth } from '../../lib/auth/AuthProvider';
import { mapAuthError } from '../../lib/auth/errors';
import { useLanguage } from '../../i18n';

const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-muted focus:border-sapphire focus:ring-1 focus:ring-sapphire';

export function LoginPage() {
  const { messages } = useLanguage();
  const { session, isLoading, signIn } = useAuth();
  const location = useLocation();
  const t = messages.auth.login;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isLoading && session) {
    const from = (location.state as { from?: { pathname?: string } } | null)?.from;
    return <Navigate to={from?.pathname ?? '/painel'} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(messages.auth.errors[mapAuthError(err)]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title={t.title} subtitle={t.subtitle}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.emailLabel}</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t.emailPlaceholder}
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.passwordLabel}</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t.passwordPlaceholder}
            className={inputClass}
          />
        </label>

        {error && <p className="text-sm text-danger">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-1 rounded-lg bg-sapphire px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sapphire-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? t.submitting : t.submit}
        </button>

        <Link to="/esqueci-senha" className="text-center text-sm text-sapphire hover:underline">
          {t.forgotPassword}
        </Link>
      </form>

      <div className="mt-6 border-t border-border pt-5 text-center text-sm text-ink-secondary">
        {t.noAccount}{' '}
        <Link to="/cadastro" className="font-medium text-sapphire hover:underline">
          {t.createAccount}
        </Link>
      </div>
    </AuthLayout>
  );
}
