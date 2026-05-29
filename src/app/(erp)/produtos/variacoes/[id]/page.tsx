import { notFound } from "next/navigation";
import { ProdutoVariacaoFormPage } from "@/features/produtos/variacoes/ProdutoVariacaoFormPage";

type EditarProdutoVariacaoRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditarProdutoVariacaoRoute({ params }: EditarProdutoVariacaoRouteProps) {
  const { id } = await params;
  const idVariacao = Number(id);

  if (!Number.isInteger(idVariacao) || idVariacao <= 0) {
    notFound();
  }

  return <ProdutoVariacaoFormPage mode="edit" id={idVariacao} />;
}
