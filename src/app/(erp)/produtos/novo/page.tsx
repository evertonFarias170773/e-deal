import { ProdutoFormPage } from "@/features/produtos/ProdutoFormPage";
import { PermissionGuard } from "@/components/common/PermissionGuard";

/**
 * `?duplicarDe=<id_produto>` abre esta mesma tela como "Duplicar produto"
 * (22/08/2026): o formulario nasce preenchido com os dados da origem e com o
 * campo de ID em branco. A rota nao muda e o guard e o mesmo — duplicar CRIA,
 * entao continua exigindo `produtos.create`.
 */
export default async function NovoProdutoRoute({
  searchParams
}: {
  searchParams: Promise<{ duplicarDe?: string }>;
}) {
  const { duplicarDe } = await searchParams;
  const origem = Number(duplicarDe);
  const duplicarDeValido = Number.isInteger(origem) && origem > 0 ? origem : undefined;

  return (
    <PermissionGuard permission="produtos.create">
      <ProdutoFormPage mode="new" duplicarDe={duplicarDeValido} />
    </PermissionGuard>
  );
}
