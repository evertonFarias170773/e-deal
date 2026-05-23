import { notFound } from "next/navigation";
import { ProdutoFormPage } from "@/features/produtos/ProdutoFormPage";
import { getProdutoById } from "@/lib/mocks/produtos.mock";

type EditarProdutoRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditarProdutoRoute({ params }: EditarProdutoRouteProps) {
  const { id } = await params;
  const produto = getProdutoById(Number(id));

  if (!produto) {
    notFound();
  }

  return <ProdutoFormPage mode="edit" produto={produto} />;
}
