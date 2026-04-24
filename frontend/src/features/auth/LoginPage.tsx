import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

interface LoginPageProps {
  onSubmit: (email: string) => Promise<void>;
  pending: boolean;
  error: string | null;
  bootError: string | null;
}

export function LoginPage({ onSubmit, pending, error, bootError }: LoginPageProps) {
  const [email, setEmail] = useState('');

  const canSubmit = email.trim().length > 0 && !pending;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit(email.trim().toLowerCase());
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#f4f2ff_0%,#f5f8ff_45%,#f7fbff_100%)] text-slate-900">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-8rem] top-[-8rem] h-72 w-72 rounded-full bg-[#d9e4ff] blur-3xl" />
        <div className="absolute bottom-[-6rem] right-[-4rem] h-72 w-72 rounded-full bg-[#eae0ff] blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="w-full max-w-2xl">
          <section className="animate-slide-up rounded-[24px] border border-white/65 bg-white/88 p-6 shadow-[0_32px_100px_rgba(77,98,179,0.14)] backdrop-blur sm:p-8 lg:p-10">
            <header className="mb-8">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#5a6ca8]">
                  MediBuddy
                </p>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                  Welcome back
                </h1>
                <p className="mt-3 text-sm text-slate-500">
                  Not a user?{' '}
                  <Link
                    to="/onboarding"
                    className="font-semibold text-[#3867ff] transition hover:text-[#244fcb]"
                  >
                    Sign Up
                  </Link>
                </p>
              </div>
            </header>

            <form className="space-y-6" onSubmit={handleSubmit}>
              <div className="animate-fade-up space-y-5">
                <label className="block space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="aarav@example.com"
                    required
                    maxLength={320}
                    className="w-full rounded-[14px] border border-[#e2e8ff] bg-[#f8faff] px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-[#7d9cff] focus:ring-3 focus:ring-[#dfe8ff]"
                  />
                </label>
              </div>

              <div className="rounded-[16px] border border-[#e9edff] bg-[#f6f7ff] px-5 py-4 text-sm text-slate-600">
                <div className="flex items-start gap-3">
                  <div className="rounded-[12px] bg-[#e6ecff] p-2 text-[#3867ff]">
                    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                      <path
                        d="M12 3.75 5.25 6.6v5.07c0 4.18 2.67 8.08 6.75 9.33 4.08-1.25 6.75-5.15 6.75-9.33V6.6L12 3.75Z"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      />
                      <path d="M12 8.75v4.5m0 2.5h.01" stroke="currentColor" strokeWidth="1.8" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#4c76ef]">
                      Quick access
                    </p>
                    <p className="mt-1 leading-6 text-slate-500">
                      This prototype uses email-only login for now. If your email is not found, use
                      Sign Up to create your profile first.
                    </p>
                  </div>
                </div>
              </div>

              {bootError && (
                <div className="rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {bootError}
                </div>
              )}

              {error && (
                <div className="rounded-[14px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-end gap-4 pt-2">
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="inline-flex min-w-44 items-center justify-center rounded-[14px] bg-[linear-gradient(90deg,#3867ff_0%,#2f62ef_100%)] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(56,103,255,0.24)] transition duration-200 hover:translate-y-[-1px] hover:shadow-[0_18px_38px_rgba(56,103,255,0.3)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pending ? 'Logging in...' : 'Log in'}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
