import { Suspense } from "react";
import { CobrancasList } from "@/features/cobrancas";
import { PermissionGuard } from "@/components/common/PermissionGuard";

export default function CobrancasRoute() {
  return (
    <PermissionGuard permission="conferencia.view">
      {/* A tela lê os filtros da URL (useSearchParams), que exige limite de Suspense. */}
      <Suspense fallback={null}>
        <CobrancasList />
      </Suspense>
    </PermissionGuard>
  );
}
