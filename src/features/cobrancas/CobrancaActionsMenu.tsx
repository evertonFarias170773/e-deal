"use client";

import { useRouter } from "next/navigation";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { useAppToast } from "@/components/common/AppToast";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { canLiberarParaPedido, isCreditoPendente, isPropostaLiberadaParaPedido } from "@/features/cobrancas/cobrancas-utils";
import type { Cobranca } from "@/features/cobrancas/types";

type CobrancaActionsMenuProps = {
  cobranca: Cobranca;
  label?: string;
};

export function CobrancaActionsMenu({ cobranca, label }: CobrancaActionsMenuProps) {
  const router = useRouter();
  const { showToast } = useAppToast();
  const { confirmPagamento, cancelCobranca, liberarParaPedido, getCobrancasByProposta } = useCobrancas();
  const cobrancasDaProposta = getCobrancasByProposta(cobranca.id_int);
  const propostaLiberada = isPropostaLiberadaParaPedido(cobrancasDaProposta);
  const podeLiberarParaPedido = canLiberarParaPedido(cobrancasDaProposta);

  async function copyValue(value: string | undefined, successTitle: string, emptyTitle: string) {
    if (!value) {
      showToast({ type: "warning", title: emptyTitle });
      return;
    }

    await navigator.clipboard?.writeText(value);
    showToast({ type: "success", title: successTitle });
  }

  function handleConfirm() {
    confirmPagamento(cobranca.id);
    showToast({ type: "success", title: "Pagamento confirmado no mock." });
  }

  function handleCancel() {
    const confirmed = window.confirm("Cancelar cobrança mockada? Esta ação altera apenas o estado visual.");

    if (!confirmed) {
      return;
    }

    cancelCobranca(cobranca.id, "Cancelamento mockado solicitado pelo usuário.");
    showToast({ type: "warning", title: "Cobrança cancelada no mock." });
  }

  function handleLiberarPedido() {
    const liberou = liberarParaPedido(cobranca.id_int);

    showToast({
      type: liberou ? "success" : "warning",
      title: liberou ? "Proposta liberada para pedido no mock." : "Ainda não é possível liberar para pedido."
    });
  }

  function handleAnaliseCredito() {
    if (isCreditoPendente(cobranca)) {
      router.push(`/cobrancas/${cobranca.id}`);
      return;
    }

    showToast({ type: "info", title: "Esta cobrança não possui crédito pendente." });
  }

  const items = [
    { label: "Ver cobrança", onClick: () => router.push(`/cobrancas/${cobranca.id}`) },
    { label: "Abrir proposta", onClick: () => router.push(`/orcamentos/${cobranca.id_int}`) },
    { label: "Ver cliente", onClick: () => router.push(`/cadastros/${cobranca.id_cliente}`) },
    {
      label: "Ver financeiro da proposta",
      onClick: () => router.push(`/orcamentos/${cobranca.id_int}`)
    },
    {
      label: "Confirmar pagamento mockado",
      disabled: cobranca.status === "PAID" || cobranca.status === "CANCELADO",
      onClick: handleConfirm
    },
    propostaLiberada
      ? {
          label: "Pedido ainda não criado no mock",
          disabled: true
        }
      : {
          label: "Liberar para pedido",
          disabled: !podeLiberarParaPedido,
          onClick: handleLiberarPedido
        },
    {
      label: "Analisar crédito",
      disabled: !isCreditoPendente(cobranca),
      onClick: handleAnaliseCredito
    },
    ...(cobranca.tipo_cobranca !== "CARD_PARCELADO" ? [
      {
        label: "Copiar PIX",
        disabled: !cobranca.pix_copia_cola,
        onClick: () => void copyValue(cobranca.pix_copia_cola, "PIX copiado.", "Esta cobrança não possui PIX mockado.")
      },
      {
        label: "Copiar linha digitável",
        disabled: !cobranca.linha_digitavel,
        onClick: () => void copyValue(cobranca.linha_digitavel, "Linha digitável copiada.", "Esta cobrança não possui boleto mockado.")
      }
    ] : []),
    {
      label: "Cancelar cobrança",
      destructive: true,
      disabled: cobranca.status === "CANCELADO",
      onClick: handleCancel
    }
  ];

  return (
    <ActionsMenu
      label={label}
      items={items}
    />
  );
}
