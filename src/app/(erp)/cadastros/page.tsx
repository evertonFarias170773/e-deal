import { Suspense } from "react";
import { CadastrosListPage } from "@/features/cadastros";

export default function CadastrosRoute() {
  return (
    // A tela lê os filtros da URL (useSearchParams), que exige limite de Suspense.
    <Suspense fallback={null}>
      <CadastrosListPage />
    </Suspense>
  );
}
