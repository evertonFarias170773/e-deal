import { ProdutoVariacaoFormPage } from "@/features/produtos/variacoes/ProdutoVariacaoFormPage";
import { PermissionGuard } from "@/components/common/PermissionGuard";

export default function NovaProdutoVariacaoRoute() {
  return (
    <PermissionGuard permission="variacoes.create">
      <ProdutoVariacaoFormPage mode="new" />
    </PermissionGuard>
  );
}
