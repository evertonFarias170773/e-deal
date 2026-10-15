import { Suspense } from "react";
import { NotasFiscaisPage } from "@/features/fiscal/NotasFiscaisPage";
import { PermissionGuard } from "@/components/common/PermissionGuard";
import { CobrancasProvider } from "@/features/cobrancas/CobrancasProvider";

export default function Page() {
  return (
    <PermissionGuard permission="fiscal.view">
      {/* A tela lê a aba e os filtros da URL (useSearchParams), que exige limite de Suspense. */}
      <Suspense fallback={null}>
        {/* Os modais de boleto desta tela (Preparar boletos, Revisar geração bancária)
            atualizam a lista de cobranças. Desde 15/10/2026 o provider não fica no
            topo do app, então a tela o monta aqui — só a lista, não o detalhe da nota. */}
        <CobrancasProvider>
          <NotasFiscaisPage />
        </CobrancasProvider>
      </Suspense>
    </PermissionGuard>
  );
}
