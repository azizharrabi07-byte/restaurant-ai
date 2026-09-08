import type { ReactNode } from "react";

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
      <div>
        <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2 font-medium font-mono">
          {eyebrow}
        </p>
        <h1 className="text-2xl sm:text-3xl font-serif italic text-white tracking-tight leading-tight">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 text-sm text-white/40 max-w-xl leading-relaxed">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}