import { CadastroFormPage } from "@/features/cadastros/CadastroFormPage";
import type { CadastroCategoria } from "@/features/cadastros/types";

const CATEGORIAS_VALIDAS: CadastroCategoria[] = ["CLIENTE", "TRANSPORTADORA", "FORNECEDOR", "ORGAO_PUBLICO"];

export default async function NovoCadastroRoute({
  searchParams
}: {
  searchParams: Promise<{ categoria?: string }>;
}) {
  const params = await searchParams;
  const bruta = (params.categoria ?? "").toUpperCase() as CadastroCategoria;
  const categoriaInicial = CATEGORIAS_VALIDAS.includes(bruta) ? bruta : undefined;
  return <CadastroFormPage mode="new" categoriaInicial={categoriaInicial} />;
}
