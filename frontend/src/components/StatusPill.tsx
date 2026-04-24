interface StatusPillProps {
  tone: 'healthy' | 'warning' | 'neutral';
  label: string;
}

const toneClasses: Record<StatusPillProps['tone'], string> = {
  healthy: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  neutral: 'border-slate-200 bg-slate-50 text-slate-600',
};

export function StatusPill({ tone, label }: StatusPillProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${toneClasses[tone]}`}
    >
      {label}
    </span>
  );
}
