import type { ReactNode } from "react";
import { AppLayout } from "@/components/app-shell/AppLayout";
import { AuthGuard } from "@/features/auth/AuthGuard";

export default function ErpLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <AppLayout>{children}</AppLayout>
    </AuthGuard>
  );
}
