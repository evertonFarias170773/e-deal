import { Suspense } from "react";
import { OrcamentosListPage } from "@/features/orcamentos";

export default function OrcamentosRoute() {
  return (
    // A tela lê os filtros da URL (useSearchParams), que exige limite de Suspense.
    <Suspense fallback={null}>
      <OrcamentosListPage />
    </Suspense>
  );
}
