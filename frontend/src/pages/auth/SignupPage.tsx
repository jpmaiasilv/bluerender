import { FormEvent, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { AuthLayout } from '../../layouts/AuthLayout';
import { useAuth } from '../../lib/auth/AuthProvider';
import { mapAuthError } from '../../lib/auth/errors';
import { useLanguage } from '../../i18n';

const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-muted focus:border-sapphire focus:ring-1 focus:ring-sapphire';

export function SignupPage() {
  const { messages } = useLanguage();
  const { session, isLoading, signUp } = useAuth();
  const t = messages.auth.signup;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationPending, setConfirmationPending] = useState(false);

  if (!isLoading && session) return <Navigate to="/painel" replace />;

  if (confirmationPending) {
    return (
      <AuthLayout title={t.confirmEmailTitle}>
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sapphire-light text-sapphire">
            <MailCheck size={22} />
          </div>
          <p className="text-sm text-ink-secondary">{t.confirmEmailMessage}</p>
          <Link to="/login" className="mt-2 text-sm font-medium text-sapphire hover:underline">
            {t.backToLogin}
          </Link>
        </div>
      </AuthLayout>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await signUp(email, password, name);
      if (result.needsEmailConfirmation) {
        setConfirmationPending(true);
      }
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
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.nameLabel}</span>
          <input
            type="text"
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.namePlaceholder}
            className={inputClass}
          />
        </label>

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
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t.passwordPlaceholder}
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-ink-muted">{t.passwordHint}</span>
        </label>

        {error && <p className="text-sm text-danger">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-1 rounded-lg bg-sapphire px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sapphire-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? t.submitting : t.submit}
        </button>
      </form>

      <div className="mt-6 border-t border-border pt-5 text-center text-sm text-ink-secondary">
        {t.haveAccount}{' '}
        <Link to="/login" className="font-medium text-sapphire hover:underline">
          {t.signIn}
        </Link>
      </div>
    </AuthLayout>
  );
}
