import { Suspense } from "react";
import { ProdutosListPage } from "@/features/produtos/ProdutosListPage";
import { PermissionGuard } from "@/components/common/PermissionGuard";

export default function ProdutosRoute() {
  return (
    <PermissionGuard permission="produtos.view">
      {/* A tela lê os filtros da URL (useSearchParams), que exige limite de Suspense. */}
      <Suspense fallback={null}>
        <ProdutosListPage />
      </Suspense>
    </PermissionGuard>
  );
}
