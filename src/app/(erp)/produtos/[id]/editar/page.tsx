import { notFound } from "next/navigation";
import { ProdutoFormRouteClient } from "@/features/produtos/ProdutoFormRouteClient";
import { PermissionGuard } from "@/components/common/PermissionGuard";

type EditarProdutoRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditarProdutoRoute({ params }: EditarProdutoRouteProps) {
  const { id } = await params;
  const idProduto = Number(id);

  if (!Number.isFinite(idProduto)) {
    notFound();
  }

  return (
    <PermissionGuard permission="produtos.edit">
      <ProdutoFormRouteClient idProduto={idProduto} />
    </PermissionGuard>
  );
}
