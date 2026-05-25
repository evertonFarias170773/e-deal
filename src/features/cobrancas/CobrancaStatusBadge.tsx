import type { Cobranca } from "@/features/cobrancas/types";
import {
  getConferenciaStatusLabel,
  getConferenciaStatusTone
} from "@/features/cobrancas/cobrancas-utils";

type CobrancaStatusBadgeProps = {
  cobranca: Pick<Cobranca, "status" | "confirmado">;
};

export function CobrancaStatusBadge({ cobranca }: CobrancaStatusBadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
        cobranca.status === "PAID" && !cobranca.confirmado
          ? "border-orange-200 bg-orange-50 text-orange-700"
          : getConferenciaStatusTone(cobranca) === "success"
            ? "border-teal-200 bg-teal-50 text-teal-700"
            : "border-sky-200 bg-sky-50 text-sky-800"
      ].join(" ")}
    >
      {getConferenciaStatusLabel(cobranca)}
    </span>
  );
}
