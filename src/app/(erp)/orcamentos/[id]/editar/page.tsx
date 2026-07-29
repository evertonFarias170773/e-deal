import { Suspense } from "react";
import { OrcamentoFormPage } from "@/features/orcamentos/OrcamentoFormPage";

type EditarOrcamentoRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditarOrcamentoRoute({ params }: EditarOrcamentoRouteProps) {
  const { id } = await params;
  const idInt = Number(id);

  return (
    // O editor lê a aba da URL (useSearchParams), que exige limite de Suspense.
    <Suspense fallback={null}>
      <OrcamentoFormPage mode="edit" idInt={idInt} />
    </Suspense>
  );
}

