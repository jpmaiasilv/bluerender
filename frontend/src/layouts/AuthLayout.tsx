import { ReactNode } from 'react';
import { Logo } from '../components/Logo';

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/** Shared shell for every standalone auth screen (login, signup, password reset, callback). */
export function AuthLayout({ title, subtitle, children }: Props) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-secondary px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo size={32} />
        </div>
        <div className="rounded-2xl border border-border bg-surface p-8 shadow-card">
          <h1 className="text-lg font-semibold text-ink">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-secondary">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
