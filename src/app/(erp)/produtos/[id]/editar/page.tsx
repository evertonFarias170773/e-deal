import { notFound } from "next/navigation";
import { ProdutoFormRouteClient } from "@/features/produtos/ProdutoFormRouteClient";

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

  return <ProdutoFormRouteClient idProduto={idProduto} />;
}
