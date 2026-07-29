import { Suspense } from "react";
import { OrcamentoFormPage } from "@/features/orcamentos/OrcamentoFormPage";

export default function NovoOrcamentoRoute() {
  return (
    // O editor lê a aba da URL (useSearchParams), que exige limite de Suspense.
    <Suspense fallback={null}>
      <OrcamentoFormPage mode="new" />
    </Suspense>
  );
}
