import { Suspense } from "react";
import { NotasFiscaisPage } from "@/features/fiscal/NotasFiscaisPage";
import { PermissionGuard } from "@/components/common/PermissionGuard";

export default function Page() {
  return (
    <PermissionGuard permission="fiscal.view">
      {/* A tela lê a aba e os filtros da URL (useSearchParams), que exige limite de Suspense. */}
      <Suspense fallback={null}>
        <NotasFiscaisPage />
      </Suspense>
    </PermissionGuard>
  );
}
