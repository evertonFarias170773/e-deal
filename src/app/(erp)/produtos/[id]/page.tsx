import { notFound } from "next/navigation";
import { ProdutoDetailRouteClient } from "@/features/produtos/ProdutoDetailRouteClient";

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

  return <ProdutoDetailRouteClient idProduto={idProduto} />;
}
