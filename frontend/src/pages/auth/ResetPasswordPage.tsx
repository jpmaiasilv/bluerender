import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout } from '../../layouts/AuthLayout';
import { useAuth } from '../../lib/auth/AuthProvider';
import { mapAuthError } from '../../lib/auth/errors';
import { useLanguage } from '../../i18n';

const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-muted focus:border-sapphire focus:ring-1 focus:ring-sapphire';

export function ResetPasswordPage() {
  const { messages } = useLanguage();
  const { session, isLoading, updatePassword } = useAuth();
  const t = messages.auth.resetPassword;

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (isLoading) {
    return (
      <AuthLayout title={t.title}>
        <div className="flex justify-center py-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-sapphire border-t-transparent" />
        </div>
      </AuthLayout>
    );
  }

  if (!session) {
    return (
      <AuthLayout title={t.invalidLinkTitle}>
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-ink-secondary">{t.invalidLinkMessage}</p>
          <Link to="/esqueci-senha" className="mt-2 text-sm font-medium text-sapphire hover:underline">
            {t.backToLogin}
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (success) {
    return (
      <AuthLayout title={t.successTitle}>
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-ink-secondary">{t.successMessage}</p>
          <Link
            to="/painel"
            className="mt-2 rounded-lg bg-sapphire px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sapphire-hover"
          >
            {t.goToApp}
          </Link>
        </div>
      </AuthLayout>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError(t.passwordMismatch);
      return;
    }
    setSubmitting(true);
    try {
      await updatePassword(password);
      setSuccess(true);
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
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">
            {t.newPasswordLabel}
          </span>
          <input
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">
            {t.confirmPasswordLabel}
          </span>
          <input
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
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
      </form>
    </AuthLayout>
  );
}
