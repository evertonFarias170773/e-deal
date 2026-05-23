import type { StatusTone } from "@/lib/types";
import { humanizeStatus } from "@/lib/formatters/status";
import { cn } from "@/lib/utils";

const toneByStatus: Record<string, StatusTone> = {
  APROVADO: "success",
  AUTORIZADA: "success",
  PAID: "success",
  CONFIRMADO: "success",
  LIBERADA_PARA_PEDIDO: "success",
  PRONTA_PARA_LIBERACAO: "info",
  A_VENCER: "warning",
  PENDENTE: "warning",
  AGUARDANDO_CREDITO: "warning",
  AGUARDANDO: "info",
  AGUARDANDO_PAGAMENTO: "info",
  PROCESSANDO: "info",
  A_RECEBER: "info",
  CARD_PARCELADO: "special",
  PARCIALMENTE_APROVADA: "special",
  VENCIDO: "danger",
  REJEITADA: "danger",
  ERRO: "danger",
  ERRO_AUTORIZACAO: "danger",
  BLOQUEADA_VALIDACAO: "danger",
  CANCELADO: "neutral",
  DENEGADA: "neutral",
  RASCUNHO: "neutral",
  NAO_CONFIRMADO: "neutral"
};

const toneStyles: Record<StatusTone, string> = {
  success: "border-teal-200 bg-teal-50 text-teal-700",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  warning: "border-orange-200 bg-orange-50 text-orange-700",
  danger: "border-red-200 bg-red-50 text-red-700",
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  special: "border-teal-200 bg-teal-50 text-teal-700"
};

type StatusBadgeProps = {
  status: string;
  tone?: StatusTone;
};

export function StatusBadge({ status, tone }: StatusBadgeProps) {
  const resolvedTone = tone ?? toneByStatus[status] ?? "neutral";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
        toneStyles[resolvedTone]
      )}
    >
      {humanizeStatus(status)}
    </span>
  );
}
