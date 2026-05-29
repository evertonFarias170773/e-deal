import { cn } from "@/lib/utils";

type LoadingSkeletonProps = {
  variant?: "page" | "table" | "cards";
  rows?: number;
};

export function LoadingSkeleton({ variant = "cards", rows = 5 }: LoadingSkeletonProps) {
  if (variant === "page") {
    return (
      <div className="space-y-6">
        <div
          className="h-32 animate-pulse rounded-2xl"
          style={{ background: "var(--border)" }}
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-40 animate-pulse rounded-2xl"
              style={{ background: "var(--border)" }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (variant === "table") {
    return (
      <div
        className="rounded-2xl p-4"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)"
        }}
      >
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className={cn("grid grid-cols-5 gap-4 py-4", index !== rows - 1 && "border-b")}
            style={{ borderColor: "var(--border)" }}
          >
            {Array.from({ length: 5 }).map((__, cellIndex) => (
              <div
                key={cellIndex}
                className="h-4 animate-pulse rounded-full"
                style={{ background: "var(--border)" }}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-36 animate-pulse rounded-2xl"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)"
          }}
        />
      ))}
    </div>
  );
}
