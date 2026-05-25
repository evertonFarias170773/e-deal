import { cn } from "@/lib/utils";

type LoadingSkeletonProps = {
  variant?: "page" | "table" | "cards";
  rows?: number;
};

export function LoadingSkeleton({ variant = "cards", rows = 5 }: LoadingSkeletonProps) {
  if (variant === "page") {
    return (
      <div className="space-y-6">
        <div className="h-32 animate-pulse rounded-3xl bg-slate-200" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-40 animate-pulse rounded-3xl bg-slate-200" />
          ))}
        </div>
      </div>
    );
  }

  if (variant === "table") {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-4">
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className={cn("grid grid-cols-5 gap-4 py-4", index !== rows - 1 && "border-b border-slate-100")}
          >
            {Array.from({ length: 5 }).map((__, cellIndex) => (
              <div key={cellIndex} className="h-4 animate-pulse rounded-full bg-slate-200" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-36 animate-pulse rounded-3xl border border-slate-200 bg-white" />
      ))}
    </div>
  );
}
