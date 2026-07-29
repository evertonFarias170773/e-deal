import { Suspense } from "react";
import { notFound } from "next/navigation";
import { CadastroDetailPage } from "@/features/cadastros/CadastroDetailPage";
import { getCadastroDetailReadOnly } from "@/features/cadastros/services/cadastros.service";

type CadastroDetailRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function CadastroDetailRoute({ params }: CadastroDetailRouteProps) {
  const { id } = await params;
  const { cadastro, source } = await getCadastroDetailReadOnly(id);

  if (!cadastro) {
    notFound();
  }

  return (
    // A sub-lista de propostas lê seus filtros da URL (useSearchParams).
    <Suspense fallback={null}>
      <CadastroDetailPage cadastro={cadastro} dataSource={source} />
    </Suspense>
  );
}
