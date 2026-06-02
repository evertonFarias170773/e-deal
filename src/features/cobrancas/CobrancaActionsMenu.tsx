"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { useAppToast } from "@/components/common/AppToast";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { useAuth } from "@/features/auth/AuthProvider";
import { isCreditoPendente } from "@/features/cobrancas/cobrancas-utils";
import type { Cobranca } from "@/features/cobrancas/types";

type CobrancaActionsMenuProps = {
  cobranca: Cobranca;
  label?: string;
};

export function CobrancaActionsMenu({ cobranca, label }: CobrancaActionsMenuProps) {
  const router = useRouter();
  const { showToast } = useAppToast();
  const { user } = useAuth();
  const [isUpdating, setIsUpdating] = useState(false);
  const {
    confirmPagamento,
    cancelCobranca,
    liberarCobrancaReal,
    voltarCobrancaFilaReal
  } = useCobrancas();

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



  function handleAnaliseCredito() {
    if (isCreditoPendente(cobranca)) {
      router.push(`/cobrancas/${cobranca.id}`);
      return;
    }

    showToast({ type: "info", title: "Esta cobrança não possui crédito pendente." });
  }

  async function handleLiberarOSReal() {
    if (!cobranca.id) {
      showToast({ type: "error", title: "ID da cobrança inválido para liberação." });
      return;
    }

    const confirmed = window.confirm("Tem certeza que quer liberar esta proposta para produção?");
    if (!confirmed) {
      return;
    }

    setIsUpdating(true);
    try {
      const operador = user?.name || "Operador Financeiro";
      const success = await liberarCobrancaReal(cobranca.id, operador);
      if (success) {
        showToast({ type: "success", title: "OS liberada para produção com sucesso!" });
      }
    } catch (error) {
      showToast({
        type: "error",
        title: error instanceof Error ? error.message : "Falha ao liberar OS."
      });
    } finally {
      setIsUpdating(false);
    }
  }

  async function handleVoltarFilaReal() {
    if (!cobranca.id) {
      showToast({ type: "error", title: "ID da cobrança inválido para estorno." });
      return;
    }

    const confirmed = window.confirm("Tem certeza que quer voltar esta OS para a lista principal de conferência?");
    if (!confirmed) {
      return;
    }

    setIsUpdating(true);
    try {
      const success = await voltarCobrancaFilaReal(cobranca.id);
      if (success) {
        showToast({ type: "success", title: "OS retornada à fila de conferência." });
      }
    } catch (error) {
      showToast({
        type: "error",
        title: error instanceof Error ? error.message : "Falha ao retornar OS para a fila."
      });
    } finally {
      setIsUpdating(false);
    }
  }

  const items = [
    { label: "Ver cobrança", onClick: () => router.push(`/cobrancas/${cobranca.id}`) },
    { label: "Abrir proposta", onClick: () => router.push(`/orcamentos/${cobranca.id_int}`) },
    { label: "Ver cliente", onClick: () => router.push(`/cadastros/${cobranca.id_cliente}`) },
    {
      label: "Ver financeiro da proposta",
      onClick: () => router.push(`/orcamentos/${cobranca.id_int}`)
    },
    // Real Supabase confirmation actions (Liberar OS / Voltar para fila)
    ...((cobranca.status === "PAID" || cobranca.status === "A_VENCER")
      ? [
          !cobranca.confirmado
            ? {
                label: isUpdating ? "Liberando..." : "Liberar OS",
                disabled: isUpdating,
                onClick: () => void handleLiberarOSReal()
              }
            : {
                label: isUpdating ? "Estornando..." : "Voltar para lista principal",
                disabled: isUpdating,
                onClick: () => void handleVoltarFilaReal()
              }
        ]
      : []),
    ...(cobranca.tipo_cobranca?.toUpperCase() === "E-FATURADO" &&
    cobranca.status === "A_VENCER" &&
    Boolean(cobranca.confirmado) &&
    !Boolean(cobranca.boleto_enviadoo)
      ? [
          {
            label: "Emitir boleto",
            onClick: () => {
              showToast({
                type: "info",
                title: "Ação de emissão de boleto simulada com sucesso."
              });
            }
          }
        ]
      : []),
    {
      label: "Confirmar pagamento mockado",
      disabled: cobranca.status === "PAID" || cobranca.status === "CANCELADO",
      onClick: handleConfirm
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
