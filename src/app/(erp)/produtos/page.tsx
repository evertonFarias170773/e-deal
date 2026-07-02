import { ProdutosListPage } from "@/features/produtos/ProdutosListPage";
import { PermissionGuard } from "@/components/common/PermissionGuard";

export default function ProdutosRoute() {
  return (
    <PermissionGuard permission="produtos.view">
      <ProdutosListPage />
    </PermissionGuard>
  );
}
