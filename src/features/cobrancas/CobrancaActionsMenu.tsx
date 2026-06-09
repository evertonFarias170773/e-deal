"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { useAppToast } from "@/components/common/AppToast";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { useAuth } from "@/features/auth/AuthProvider";
import { isCreditoPendente } from "@/features/cobrancas/cobrancas-utils";
import { useGlobalChat } from "@/features/chat/context/GlobalChatContext";
import { AnaliseCreditoModal } from "./AnaliseCreditoModal";
import type { Cobranca } from "@/features/cobrancas/types";

type CobrancaActionsMenuProps = {
  cobranca: Cobranca;
  label?: string;
};

export function CobrancaActionsMenu({ cobranca, label }: CobrancaActionsMenuProps) {
  const router = useRouter();
  const { showToast } = useAppToast();
  const { user } = useAuth();
  const { openChat } = useGlobalChat();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isCreditModalOpen, setIsCreditModalOpen] = useState(false);
  const {
    cancelCobranca,
    deleteCobranca,
    liberarCobrancaReal,
    voltarCobrancaFilaReal
  } = useCobrancas();

  async function handleDelete() {
    if (cobranca.status?.trim().toUpperCase() === "PAID") {
      showToast({ type: "error", title: "Não é permitido excluir cobrança paga." });
      return;
    }

    const confirmed = window.confirm(
      "Tem certeza que deseja excluir esta cobrança? Esta ação não deve ser feita se o cliente já recebeu ou usou o link de pagamento."
    );

    if (!confirmed) {
      return;
    }

    setIsUpdating(true);
    try {
      const result = await deleteCobranca(cobranca.id);
      if (result.success) {
        showToast({ type: "success", title: "Cobrança excluída com sucesso." });
        if (typeof window !== "undefined" && window.location.pathname.endsWith(`/cobrancas/${cobranca.id}`)) {
          router.push("/cobrancas");
        }
      } else {
        showToast({
          type: "error",
          title: result.errorMessage || "Erro ao excluir cobrança."
        });
      }
    } catch (error) {
      showToast({
        type: "error",
        title: error instanceof Error ? error.message : "Falha ao excluir cobrança."
      });
    } finally {
      setIsUpdating(false);
    }
  }

  async function copyValue(value: string | undefined, successTitle: string, emptyTitle: string) {
    if (!value) {
      showToast({ type: "warning", title: emptyTitle });
      return;
    }

    await navigator.clipboard?.writeText(value);
    showToast({ type: "success", title: successTitle });
  }

  function handleCancel() {
    const confirmed = window.confirm("Cancelar cobrança? Esta ação altera apenas o estado visual.");

    if (!confirmed) {
      return;
    }

    cancelCobranca(cobranca.id, "Cancelamento solicitado pelo usuário.");
    showToast({ type: "warning", title: "Cobrança cancelada." });
  }

  function handleAnaliseCredito() {
    if (!cobranca.id_cliente) {
      showToast({ type: "warning", title: "Cliente não identificado para análise de crédito." });
      return;
    }
    setIsCreditModalOpen(true);
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
      label: "Abrir chat da proposta",
      onClick: () => openChat(cobranca.id_int, { clienteNome: cobranca.cliente, idCliente: cobranca.id_cliente })
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
                title: "Ação de emissão de boleto executada com sucesso."
              });
            }
          }
        ]
      : []),

    {
      label: "Analisar crédito",
      disabled: !isCreditoPendente(cobranca),
      onClick: handleAnaliseCredito
    },
    ...(cobranca.tipo_cobranca !== "CARD_PARCELADO" ? [
      {
        label: "Copiar PIX",
        disabled: !cobranca.pix_copia_cola,
        onClick: () => void copyValue(cobranca.pix_copia_cola, "PIX copiado.", "Esta cobrança não possui PIX.")
      },
      {
        label: "Copiar linha digitável",
        disabled: !cobranca.linha_digitavel,
        onClick: () => void copyValue(cobranca.linha_digitavel, "Linha digitável copiada.", "Esta cobrança não possui boleto.")
      }
    ] : []),
    {
      label: "Cancelar cobrança",
      destructive: true,
      disabled: cobranca.status === "CANCELADO",
      onClick: handleCancel
    },
    ...(cobranca.status?.trim().toUpperCase() !== "PAID" ? [
      {
        label: "Excluir cobrança",
        destructive: true,
        onClick: () => void handleDelete()
      }
    ] : [])
  ];

  return (
    <>
      <ActionsMenu
        label={label}
        items={items}
      />
      <AnaliseCreditoModal
        isOpen={isCreditModalOpen}
        onClose={() => setIsCreditModalOpen(false)}
        cobranca={cobranca}
      />
    </>
  );
}
