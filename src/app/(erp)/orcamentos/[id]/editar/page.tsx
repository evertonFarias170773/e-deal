import { notFound } from "next/navigation";
import { OrcamentoFormPage } from "@/features/orcamentos/OrcamentoFormPage";
import { getPropostaById } from "@/lib/mocks/propostas.mock";

type EditarOrcamentoRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditarOrcamentoRoute({ params }: EditarOrcamentoRouteProps) {
  const { id } = await params;
  const proposta = getPropostaById(Number(id));

  if (!proposta) {
    notFound();
  }

  return <OrcamentoFormPage mode="edit" proposta={proposta} />;
}
