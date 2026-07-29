import { Suspense } from "react";
import { ExpedicaoPage } from "@/features/expedicao";

export default function ExpedicaoRoute() {
  return (
    // A tela lê os filtros da URL (useSearchParams), que exige limite de Suspense.
    <Suspense fallback={null}>
      <ExpedicaoPage />
    </Suspense>
  );
}
