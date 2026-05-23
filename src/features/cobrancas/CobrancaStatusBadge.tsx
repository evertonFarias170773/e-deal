import { StatusBadge } from "@/components/common/StatusBadge";
import type { Cobranca } from "@/features/cobrancas/types";
import { getCobrancaStatusTone } from "@/features/cobrancas/cobrancas-utils";

type CobrancaStatusBadgeProps = {
  cobranca: Pick<Cobranca, "status" | "confirmado">;
  showConfirmed?: boolean;
};

export function CobrancaStatusBadge({ cobranca, showConfirmed = false }: CobrancaStatusBadgeProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status={cobranca.status} tone={getCobrancaStatusTone(cobranca.status)} />
      {showConfirmed ? (
        <StatusBadge status={cobranca.confirmado ? "CONFIRMADO" : "NAO_CONFIRMADO"} tone={cobranca.confirmado ? "success" : "neutral"} />
      ) : null}
    </div>
  );
}
