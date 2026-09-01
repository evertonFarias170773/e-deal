import { Suspense } from "react";
import { notFound } from "next/navigation";
import { CadastroDetailPage } from "@/features/cadastros/CadastroDetailPage";
import { getCadastroDetailReadOnly } from "@/features/cadastros/services/cadastros.service";
import { createClient } from "@/lib/supabase/server";

type CadastroDetailRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function CadastroDetailRoute({ params }: CadastroDetailRouteProps) {
  const { id } = await params;
  // Mesma razao da rota de edicao: no servidor, sem os cookies da sessao, a
  // leitura fala como `anon` e volta vazia desde o fechamento do acesso anonimo
  // a `clientes` (01/09/2026).
  const supabase = await createClient();
  const { cadastro, source } = await getCadastroDetailReadOnly(id, supabase);

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
