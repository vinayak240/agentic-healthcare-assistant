import type { PropsWithChildren, ReactNode } from 'react';

interface CardProps extends PropsWithChildren {
  title?: string;
  eyebrow?: string;
  aside?: ReactNode;
  className?: string;
}

export function Card({ title, eyebrow, aside, className = '', children }: CardProps) {
  return (
    <section
      className={`rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur ${className}`}
    >
      {(title || eyebrow || aside) && (
        <header className="mb-5 flex items-start justify-between gap-4">
          <div>
            {eyebrow && (
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700">
                {eyebrow}
              </p>
            )}
            {title && <h2 className="mt-2 text-2xl font-semibold text-slate-900">{title}</h2>}
          </div>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}
