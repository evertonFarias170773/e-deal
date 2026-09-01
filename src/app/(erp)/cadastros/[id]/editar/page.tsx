import { notFound } from "next/navigation";
import { CadastroFormPage } from "@/features/cadastros/CadastroFormPage";
import { getCadastroCompleto } from "@/features/cadastros/services/cadastros.service";
import { createClient } from "@/lib/supabase/server";

type EditarCadastroRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditarCadastroRoute({ params }: EditarCadastroRouteProps) {
  const { id } = await params;
  // Cliente de SERVIDOR, que carrega os cookies da sessao. O cliente padrao do
  // service e o anonimo do navegador, e desde 01/09/2026 `anon` nao le mais
  // `clientes` — aqui, no servidor, ele voltava vazio e a rota caia no 404.
  const supabase = await createClient();
  const { cadastro } = await getCadastroCompleto(id, supabase);

  if (!cadastro) {
    notFound();
  }

  return <CadastroFormPage mode="edit" cadastro={cadastro} />;
}
