import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  subtitle: string;
  context?: string;
  action?: ReactNode;
};

export function PageHeader({ title, subtitle, context, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <div>
        {context ? (
          <span className="mb-3 inline-flex rounded-full bg-[#dff8f6] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#0b7774]">
            {context}
          </span>
        ) : null}
        <h1 className="text-2xl font-bold tracking-tight text-slate-950 md:text-3xl">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{subtitle}</p>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}
