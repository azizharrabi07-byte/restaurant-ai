import type { ReactNode } from "react";

interface StepHeadingProps {
  eyebrow: string;
  title: string;
  description?: string;
  children?: ReactNode;
}

export function StepHeading({ eyebrow, title, description, children }: StepHeadingProps) {
  return (
    <div className="mb-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2 font-medium">
            {eyebrow}
          </p>
          <h2 className="text-3xl sm:text-4xl font-serif italic text-white mb-2">{title}</h2>
          {description && (
            <p className="text-white/40 max-w-lg text-sm sm:text-base leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {children && <div className="shrink-0">{children}</div>}
      </div>
    </div>
  );
}