import { Suspense } from "react";
import { ContasReceberPage } from "@/features/contas-a-receber";
import { PermissionGuard } from "@/components/common/PermissionGuard";

export default function ContasAReceberRoute() {
  return (
    <PermissionGuard permission="contas_receber.view">
      {/* A tela lê os filtros da URL (useSearchParams), que exige limite de Suspense. */}
      <Suspense fallback={null}>
        <ContasReceberPage />
      </Suspense>
    </PermissionGuard>
  );
}
