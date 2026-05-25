import { notFound } from "next/navigation";
import { ProdutoDetailPage } from "@/features/produtos/ProdutoDetailPage";
import { getProdutoById } from "@/lib/mocks/produtos.mock";

type ProdutoDetailRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ProdutoDetailRoute({ params }: ProdutoDetailRouteProps) {
  const { id } = await params;
  const produto = getProdutoById(Number(id));

  if (!produto) {
    notFound();
  }

  return <ProdutoDetailPage produto={produto} />;
}
