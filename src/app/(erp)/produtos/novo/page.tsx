import { ProdutoFormPage } from "@/features/produtos/ProdutoFormPage";
import { PermissionGuard } from "@/components/common/PermissionGuard";

export default function NovoProdutoRoute() {
  return (
    <PermissionGuard permission="produtos.create">
      <ProdutoFormPage mode="new" />
    </PermissionGuard>
  );
}
