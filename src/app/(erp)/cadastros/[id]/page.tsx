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

  return <CadastroDetailPage cadastro={cadastro} dataSource={source} />;
}
