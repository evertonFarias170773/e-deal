import { Suspense } from "react";
import { RegistroRecebiveisPage } from "@/features/contas-a-receber/registro-recebiveis/RegistroRecebiveisPage";
import { PermissionGuard } from "@/components/common/PermissionGuard";

export default function RegistroRecebiveisRoute() {
  return (
    <PermissionGuard permission="contas_receber.view">
      {/* A tela lê os filtros da URL (useSearchParams), que exige limite de Suspense. */}
      <Suspense fallback={null}>
        <RegistroRecebiveisPage />
      </Suspense>
    </PermissionGuard>
  );
}
