import { notFound } from "next/navigation";
import { OrcamentoDetailPage } from "@/features/orcamentos/OrcamentoDetailPage";
import { getPropostaById } from "@/lib/mocks/propostas.mock";

type OrcamentoDetailRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function OrcamentoDetailRoute({ params }: OrcamentoDetailRouteProps) {
  const { id } = await params;
  const proposta = getPropostaById(Number(id));

  if (!proposta) {
    notFound();
  }

  return <OrcamentoDetailPage proposta={proposta} />;
}
