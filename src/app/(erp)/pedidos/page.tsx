import { Suspense } from "react";
import { PedidosListPage } from "@/features/pedidos";

export default function PedidosRootRoute() {
  return (
    // A tela lê os filtros da URL (useSearchParams), que exige limite de Suspense.
    <Suspense fallback={null}>
      <PedidosListPage />
    </Suspense>
  );
}
