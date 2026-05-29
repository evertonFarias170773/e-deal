import { OrcamentoFormPage } from "@/features/orcamentos/OrcamentoFormPage";

type EditarOrcamentoRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditarOrcamentoRoute({ params }: EditarOrcamentoRouteProps) {
  const { id } = await params;
  const idInt = Number(id);

  return <OrcamentoFormPage mode="edit" idInt={idInt} />;
}

