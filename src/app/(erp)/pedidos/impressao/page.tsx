import { Suspense } from "react";
import { PainelImpressaoPage } from "@/features/pedidos";

export default function PedidosImpressaoRoute() {
  return (
    // A tela lê os filtros da URL (useSearchParams), que exige limite de Suspense.
    <Suspense fallback={null}>
      <PainelImpressaoPage />
    </Suspense>
  );
}
