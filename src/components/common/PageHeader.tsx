import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  subtitle: string;
  context?: string;
  action?: ReactNode;
};

export function PageHeader({ title, subtitle, context, action }: PageHeaderProps) {
  return (
    <div
      className="flex flex-col gap-4 rounded-2xl p-5 shadow-md lg:flex-row lg:items-center lg:justify-between"
      style={{
        background: "var(--primary)",
        border: "1px solid color-mix(in srgb, var(--primary) 80%, black)"
      }}
    >
      <div>
        {context ? (
          <span
            className="mb-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide"
            style={{
              background: "rgba(255,255,255,0.15)",
              color: "rgba(255,255,255,0.9)"
            }}
          >
            {context}
          </span>
        ) : null}
        <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">
          {title}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6" style={{ color: "rgba(255,255,255,0.72)" }}>
          {subtitle}
        </p>
      </div>
      {action ? (
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      ) : null}
    </div>
  );
}
