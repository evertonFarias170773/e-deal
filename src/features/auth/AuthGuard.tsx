"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { useAuth } from "@/features/auth/AuthProvider";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <LoadingSkeleton variant="page" />
      </div>
    );
  }

  return children;
}
