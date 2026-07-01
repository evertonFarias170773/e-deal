import type { StatusTone } from "@/lib/types";
import { humanizeStatus } from "@/lib/formatters/status";
import { cn } from "@/lib/utils";

const toneByStatus: Record<string, StatusTone> = {
  // PedidoStatus
  BOLETIM_FINALIZADO: "info",
  BLOQUEADO: "danger",
  NOVO: "info",
  NOVO_ARTE_APROVADA: "info",
  AGUARDANDO_ARTE_APROVADA: "warning",
  ARTE_EM_ANDAMENTO: "info",
  AGUARDANDO_APROVACAO_CLIENTE: "warning",
  AGUARDANDO_APROVACAO_ATENDENTE: "warning",
  AGUARDANDO_OS: "info",
  EM_IMPRESSAO: "special",
  EM_ACABAMENTO: "special",
  REVISAO_FINAL: "special",
  PRONTO_EXPEDICAO: "success",
  EXPEDIDO: "success",
  CANCELADO: "neutral",

  // ArteStatus
  PENDENTE: "warning",
  EM_CRIACAO: "info",
  EM_REVISAO_INTERNA: "info",
  AGUARDANDO_CLIENTE: "warning",
  REPROVADA_CLIENTE: "danger",
  APROVADA_CLIENTE: "success",
  LIBERADA: "success",
  IMPRESSA: "success",
  NAO_NECESSARIA: "neutral",
  DESIGN_ATRIBUIDO: "info",

  // ProducaoStatus
  CONCLUIDA: "success",
  PAUSADA: "danger",

  PRONTA_PARA_ENVIO: "info",
  // Existing statuses
  APROVADO: "success",
  AUTORIZADA: "success",
  PAID: "success",
  CONFIRMADO: "success",
  LIBERADA_PARA_PEDIDO: "success",
  PRONTA_PARA_LIBERACAO: "info",
  A_VENCER: "warning",
  DEPOSITO_CONTA: "success",
  BOLETO_REGISTRADO: "success",
  A_RECEBER_CRIADO: "warning",
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
  DENEGADA: "neutral",
  RASCUNHO: "neutral",
  NAO_CONFIRMADO: "neutral",
  OBRIGATORIA: "danger",
  OPCIONAL: "neutral",
  MULTIPLA: "info",
  ESCOLHA_UNICA: "warning",
  ATIVO: "success",
  INATIVO: "neutral",
  FALHA_INTEGRACAO: "danger",
  RETORNO_FOCUS: "danger",
  NAO_ENCONTRADA_FOCUS: "danger"
};

const toneStyles: Record<StatusTone, string> = {
  success: "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  info:    "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  warning: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  danger:  "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300",
  neutral: "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  special: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300"
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
