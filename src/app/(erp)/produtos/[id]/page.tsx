import { notFound } from "next/navigation";
import { ProdutoDetailRouteClient } from "@/features/produtos/ProdutoDetailRouteClient";
import { PermissionGuard } from "@/components/common/PermissionGuard";

type ProdutoDetailRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ProdutoDetailRoute({ params }: ProdutoDetailRouteProps) {
  const { id } = await params;
  const idProduto = Number(id);

  if (!Number.isFinite(idProduto)) {
    notFound();
  }

  return (
    <PermissionGuard permission="produtos.view">
      <ProdutoDetailRouteClient idProduto={idProduto} />
    </PermissionGuard>
  );
}
