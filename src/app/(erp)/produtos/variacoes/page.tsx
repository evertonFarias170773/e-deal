import { ProdutoVariacoesListPage } from "@/features/produtos/variacoes/ProdutoVariacoesListPage";
import { PermissionGuard } from "@/components/common/PermissionGuard";

export default function ProdutoVariacoesRoute() {
  return (
    <PermissionGuard permission="variacoes.view">
      <ProdutoVariacoesListPage />
    </PermissionGuard>
  );
}
