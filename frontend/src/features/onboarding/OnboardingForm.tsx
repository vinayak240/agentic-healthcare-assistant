import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { CreateUserInput } from '../../lib/api/types';

interface OnboardingFormProps {
  onSubmit: (input: CreateUserInput) => Promise<void>;
  pending: boolean;
  error: string | null;
  bootError: string | null;
}

type StepKey = 'identity' | 'allergies' | 'conditions' | 'history' | 'review';

interface StepDefinition {
  key: StepKey;
  title: string;
  description: string;
  optional?: boolean;
}

const steps: StepDefinition[] = [
  {
    key: 'identity',
    title: 'Let’s create your profile',
    description: 'We use your details to personalize medical guidance and keep your sessions linked.',
  },
  {
    key: 'allergies',
    title: 'Any allergies to note?',
    description: 'Optional, but useful for medication and safety responses.',
    optional: true,
  },
  {
    key: 'conditions',
    title: 'Medical conditions',
    description: 'Optional, but improves accuracy of responses.',
    optional: true,
  },
  {
    key: 'history',
    title: 'Relevant medical history',
    description: 'Optional, but helps MediBuddy understand context.',
    optional: true,
  },
  {
    key: 'review',
    title: 'Review your profile',
    description: 'Check everything once, then create your account and head into chat.',
  },
];

const recommendationPills: Record<Exclude<StepKey, 'identity' | 'review'>, string[]> = {
  allergies: ['Penicillin', 'Peanuts', 'Dust', 'Shellfish'],
  conditions: ['Asthma', 'Diabetes', 'Hypertension', 'Thyroid'],
  history: ['Appendectomy', 'Migraine', 'Fracture', 'Childhood asthma'],
};

function normalizeList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function appendRecommendation(currentValue: string, recommendation: string): string {
  const entries = normalizeList(currentValue);

  if (entries.some((entry) => entry.toLowerCase() === recommendation.toLowerCase())) {
    return currentValue;
  }

  return [...entries, recommendation].join(', ');
}

function PillButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[12px] bg-[#edf1ff] px-4 py-2 text-xs font-semibold text-[#5b6a9d] transition duration-200 hover:-translate-y-0.5 hover:bg-[#dce5ff] hover:text-[#315ee8]"
    >
      {label}
    </button>
  );
}

export function OnboardingForm({
  onSubmit,
  pending,
  error,
  bootError,
}: OnboardingFormProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [allergies, setAllergies] = useState('');
  const [medicalConditions, setMedicalConditions] = useState('');
  const [medicalHistory, setMedicalHistory] = useState('');

  const activeStep = steps[stepIndex];

  const reviewItems = useMemo(
    () => [
      { label: 'Full name', value: name.trim() || 'Not added yet' },
      { label: 'Email', value: email.trim() || 'Not added yet' },
      { label: 'Allergies', value: normalizeList(allergies).join(', ') || 'No allergies added' },
      {
        label: 'Medical conditions',
        value: normalizeList(medicalConditions).join(', ') || 'No conditions added',
      },
      {
        label: 'Medical history',
        value: normalizeList(medicalHistory).join(', ') || 'No history added',
      },
    ],
    [allergies, email, medicalConditions, medicalHistory, name],
  );

  const canAdvanceIdentity = name.trim().length > 0 && email.trim().length > 0;
  const completionRatio =
    stepIndex === 0 && !canAdvanceIdentity ? 0 : ((stepIndex + 1) / steps.length) * 100;

  const handleContinue = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (activeStep.key === 'identity' && !canAdvanceIdentity) {
      return;
    }

    if (activeStep.key === 'review') {
      await onSubmit({
        name: name.trim(),
        email: email.trim(),
        allergies: normalizeList(allergies),
        medicalConditions: normalizeList(medicalConditions),
        medicalHistory: normalizeList(medicalHistory),
      });
      return;
    }

    setStepIndex((current) => Math.min(current + 1, steps.length - 1));
  };

  const canSubmit =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    !pending;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#f4f2ff_0%,#f5f8ff_45%,#f7fbff_100%)] text-slate-900">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-8rem] top-[-8rem] h-72 w-72 rounded-full bg-[#d9e4ff] blur-3xl" />
        <div className="absolute bottom-[-6rem] right-[-4rem] h-72 w-72 rounded-full bg-[#eae0ff] blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="w-full max-w-4xl">
          <section className="animate-slide-up rounded-[24px] border border-white/65 bg-white/88 p-6 shadow-[0_32px_100px_rgba(77,98,179,0.14)] backdrop-blur sm:p-8 lg:p-10">
            <header className="mb-8 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#5a6ca8]">
                  MediBuddy
                </p>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                  Complete your health profile
                </h1>
                <p className="mt-3 text-sm text-slate-500">
                  Already a user?{' '}
                  <Link
                    to="/login"
                    className="font-semibold text-[#3867ff] transition hover:text-[#244fcb]"
                  >
                    Log in
                  </Link>
                </p>
              </div>
              <div className="rounded-[14px] bg-white px-3 py-2 text-xs font-semibold text-[#3867ff] shadow-sm">
                {Math.round(completionRatio)}% Complete
              </div>
            </header>

            <div className="mb-8">
              <div className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.22em] text-[#6b789d]">
                <span>{`Step ${stepIndex + 1} of ${steps.length}`}</span>
                <span>{activeStep.optional ? 'Optional' : 'Required'}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[#e8edff]">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#3867ff_0%,#7b98ff_100%)] transition-[width] duration-500 ease-out"
                  style={{ width: `${completionRatio}%` }}
                />
              </div>
            </div>

            <form className="space-y-6" onSubmit={handleContinue}>
              <div className="animate-fade-up">
                <h2 className="text-[2rem] font-semibold tracking-tight text-slate-950">
                  {activeStep.title}
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                  {activeStep.description}
                </p>
              </div>

              {activeStep.key === 'identity' && (
                <div className="animate-fade-up space-y-5">
                  <label className="block space-y-2">
                    <span className="text-sm font-semibold text-slate-700">Full name</span>
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Aarav Sharma"
                      required
                      maxLength={200}
                      className="w-full rounded-[14px] border border-[#e2e8ff] bg-[#f8faff] px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-[#7d9cff] focus:ring-3 focus:ring-[#dfe8ff]"
                    />
                  </label>
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
              )}

              {(activeStep.key === 'allergies' ||
                activeStep.key === 'conditions' ||
                activeStep.key === 'history') && (
                <div className="animate-fade-up space-y-4">
                  <label className="block space-y-3">
                    <span className="text-sm font-semibold text-slate-700">
                      {activeStep.key === 'allergies'
                        ? 'Add allergies'
                        : activeStep.key === 'conditions'
                          ? 'Add medical conditions'
                          : 'Add medical history'}
                    </span>
                    <div className="flex items-center rounded-[14px] border border-[#e2e8ff] bg-[#f7f9ff] px-4 py-3">
                      <input
                        value={
                          activeStep.key === 'allergies'
                            ? allergies
                            : activeStep.key === 'conditions'
                              ? medicalConditions
                              : medicalHistory
                        }
                        onChange={(event) => {
                          const nextValue = event.target.value;

                          if (activeStep.key === 'allergies') {
                            setAllergies(nextValue);
                            return;
                          }

                          if (activeStep.key === 'conditions') {
                            setMedicalConditions(nextValue);
                            return;
                          }

                          setMedicalHistory(nextValue);
                        }}
                        placeholder={
                          activeStep.key === 'allergies'
                            ? 'e.g. penicillin, peanuts'
                            : activeStep.key === 'conditions'
                              ? 'e.g. asthma, diabetes'
                              : 'e.g. appendectomy, migraine'
                        }
                        className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                      />
                      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-slate-400">
                        <path
                          d="m21 21-4.35-4.35m1.85-4.9a6.75 6.75 0 1 1-13.5 0 6.75 6.75 0 0 1 13.5 0Z"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                      </svg>
                    </div>
                  </label>

                  <div className="flex flex-wrap gap-2">
                    {recommendationPills[activeStep.key].map((pill) => (
                      <PillButton
                        key={pill}
                        label={pill}
                        onClick={() => {
                          if (activeStep.key === 'allergies') {
                            setAllergies((current) => appendRecommendation(current, pill));
                            return;
                          }

                          if (activeStep.key === 'conditions') {
                            setMedicalConditions((current) => appendRecommendation(current, pill));
                            return;
                          }

                          setMedicalHistory((current) => appendRecommendation(current, pill));
                        }}
                      />
                    ))}
                  </div>

                  <p className="text-sm italic text-slate-400">You can update this anytime.</p>

                  {normalizeList(
                    activeStep.key === 'allergies'
                      ? allergies
                      : activeStep.key === 'conditions'
                        ? medicalConditions
                        : medicalHistory,
                  ).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {normalizeList(
                        activeStep.key === 'allergies'
                          ? allergies
                          : activeStep.key === 'conditions'
                            ? medicalConditions
                            : medicalHistory,
                      ).map((item) => (
                        <span
                          key={item}
                          className="rounded-[12px] border border-[#d7e1ff] bg-[#eff4ff] px-3 py-1.5 text-xs font-semibold text-[#3f63c7]"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  )}

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
                          Privacy first
                        </p>
                        <p className="mt-1 leading-6 text-slate-500">
                          Your health details are only used to personalize insights in your
                          MediBuddy experience.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeStep.key === 'review' && (
                <div className="animate-fade-up space-y-4">
                  <div className="grid gap-3">
                    {reviewItems.map((item) => (
                      <div
                        key={item.label}
                        className="rounded-[14px] border border-[#e8ecff] bg-[#f8faff] px-4 py-4"
                      >
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6c79a8]">
                          {item.label}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-700">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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

              <div className="flex items-center justify-between gap-4 pt-2">
                <div className="flex items-center gap-3">
                  {stepIndex > 0 && (
                    <button
                      type="button"
                      onClick={() => setStepIndex((current) => Math.max(current - 1, 0))}
                      className="rounded-[12px] px-4 py-3 text-sm font-semibold text-slate-500 transition hover:bg-[#eef2ff] hover:text-slate-900"
                    >
                      Back
                    </button>
                  )}

                  {activeStep.optional && activeStep.key !== 'review' && (
                    <button
                      type="button"
                      onClick={() => setStepIndex((current) => Math.min(current + 1, steps.length - 1))}
                      className="rounded-[12px] px-4 py-3 text-sm font-semibold text-slate-400 transition hover:bg-[#f4f6ff] hover:text-slate-600"
                    >
                      Skip
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={(activeStep.key === 'identity' && !canAdvanceIdentity) || (activeStep.key === 'review' && !canSubmit)}
                  className="inline-flex min-w-44 items-center justify-center rounded-[14px] bg-[linear-gradient(90deg,#3867ff_0%,#2f62ef_100%)] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(56,103,255,0.24)] transition duration-200 hover:translate-y-[-1px] hover:shadow-[0_18px_38px_rgba(56,103,255,0.3)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {activeStep.key === 'review'
                    ? pending
                      ? 'Creating profile...'
                      : 'Create profile'
                    : 'Continue'}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
