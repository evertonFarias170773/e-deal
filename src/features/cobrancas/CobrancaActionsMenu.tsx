"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { useAppToast } from "@/components/common/AppToast";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { useAuth } from "@/features/auth/AuthProvider";
import { isCreditoPendente, isPendenteAprovacao } from "@/features/cobrancas/cobrancas-utils";
import { useGlobalChat } from "@/features/chat/context/GlobalChatContext";
import { AnaliseCreditoModal } from "./AnaliseCreditoModal";
import { CancelCobrancaModal } from "./CancelCobrancaModal";
import { AutorizarFaturamentoModal } from "./AutorizarFaturamentoModal";
import { ConfirmarLiberacaoModal } from "./ConfirmarLiberacaoModal";
import { PrepararBoletosModal } from "./PrepararBoletosModal";
import { RevisarGeracaoBancariaModal } from "@/features/contas-a-receber/components/RevisarGeracaoBancariaModal";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Cobranca } from "@/features/cobrancas/types";

type CobrancaActionsMenuProps = {
  cobranca: Cobranca;
  label?: string;
};

function isEmpresaValida(cobranca: Pick<Cobranca, "id_empresa">) {
  const idEmpresa = Number(cobranca.id_empresa);
  return Number.isFinite(idEmpresa) && idEmpresa !== 0;
}

function isEmitirBoletos(cobranca: Cobranca, existingBoletoIdInts?: Set<number>) {
  const tipo = (cobranca.tipo_cobranca || "").toUpperCase();
  const status = (cobranca.status || "").toUpperCase();
  
  const isEFaturado = tipo === "E-FATURADO";
  const isCorrectStatus = status === "A_RECEBER" || status === "A_VENCER";
  const isConfirmedIfAvencer = status !== "A_VENCER" || cobranca.confirmado === true;
  const isBoletoEnviadooFalse = cobranca.boleto_enviadoo === false;
  
  const hasNoMatchingBoleto = !existingBoletoIdInts || !cobranca.id_int || !existingBoletoIdInts.has(Number(cobranca.id_int));
  
  return (
    isEFaturado &&
    isCorrectStatus &&
    isConfirmedIfAvencer &&
    isBoletoEnviadooFalse &&
    hasNoMatchingBoleto &&
    isEmpresaValida(cobranca)
  );
}

export function CobrancaActionsMenu({ cobranca, label }: CobrancaActionsMenuProps) {
  const router = useRouter();
  const { showToast } = useAppToast();
  const { user } = useAuth();
  const { openChat } = useGlobalChat();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isCreditModalOpen, setIsCreditModalOpen] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [isAutorizarModalOpen, setIsAutorizarModalOpen] = useState(false);
  const [isLiberarModalOpen, setIsLiberarModalOpen] = useState(false);
  const [isPrepararBoletosOpen, setIsPrepararBoletosOpen] = useState(false);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [justLaunchedExtRef, setJustLaunchedExtRef] = useState("");

  const {
    liberarCobrancaReal,
    voltarCobrancaFilaReal,
    refreshCobrancas,
    existingBoletoIdInts
  } = useCobrancas();

  async function copyValue(value: string | undefined, successTitle: string, emptyTitle: string) {
    if (!value) {
      showToast({ type: "warning", title: emptyTitle });
      return;
    }

    await navigator.clipboard?.writeText(value);
    showToast({ type: "success", title: successTitle });
  }

  function handleAnaliseCredito() {
    if (!cobranca.id_cliente) {
      showToast({ type: "warning", title: "Cliente não identificado para análise de crédito." });
      return;
    }
    setIsCreditModalOpen(true);
  }

  async function handleCreditApproved() {
    setIsUpdating(true);
    try {
      const operador = user?.name || "Sistema";
      const success = await liberarCobrancaReal(cobranca.id, operador, "A_VENCER", false, "autorizar_faturamento");
      if (success) {
        const client = getSupabaseClient();
        if (client) {
          await client.from("propostas_chat").insert([
            {
              id_int: cobranca.id_int,
              id_cliente: cobranca.id_cliente,
              mensagem: "Faturamento liberado após atualização do limite de crédito. Encaminhado para conferência humana.",
              tipo: "SISTEMA",
              autor_nome: user?.name || "Sistema",
              setor: "Financeiro",
              visivel_externo: false
            }
          ]);
        }
        showToast({ type: "success", title: "Faturamento aprovado automaticamente (limite suficiente)!" });
        setIsCreditModalOpen(false);
      }
    } catch (error) {
      showToast({
        type: "error",
        title: error instanceof Error ? error.message : "Falha ao liberar faturamento."
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

  if (isEmitirBoletos(cobranca, existingBoletoIdInts)) {
    return (
      <>
        <ActionsMenu
          label={label}
          items={[
            { label: "Ver cobrança", onClick: () => router.push(`/cobrancas/${cobranca.id}`) },
            { label: "Abrir proposta", onClick: () => router.push(`/orcamentos/${cobranca.id_int}`) },
            { label: "Ver cliente", onClick: () => router.push(`/cadastros/${cobranca.id_cliente}`) },
            {
              label: "Abrir chat da proposta",
              onClick: () => openChat(cobranca.id_int, { clienteNome: cobranca.cliente, idCliente: cobranca.id_cliente })
            },
            {
              label: "Preparar boletos",
              onClick: () => setIsPrepararBoletosOpen(true)
            },
            {
              label: "Cancelar cobrança",
              destructive: true,
              disabled: cobranca.status === "CANCELADO",
              onClick: () => setIsCancelModalOpen(true)
            }
          ]}
        />
        <CancelCobrancaModal
          isOpen={isCancelModalOpen}
          onClose={() => setIsCancelModalOpen(false)}
          cobrancaId={cobranca.id}
        />
        <PrepararBoletosModal
          isOpen={isPrepararBoletosOpen}
          onClose={() => setIsPrepararBoletosOpen(false)}
          cobranca={cobranca}
          onSuccess={(extRef) => {
            setIsPrepararBoletosOpen(false);
            setJustLaunchedExtRef(extRef);
            setIsReviewModalOpen(true);
            void refreshCobrancas();
          }}
        />
        <RevisarGeracaoBancariaModal
          isOpen={isReviewModalOpen}
          onClose={() => setIsReviewModalOpen(false)}
          extReference={justLaunchedExtRef}
          nomeCliente={cobranca.cliente}
          valorTotalNf={cobranca.valor}
          onSaveSuccess={() => {
            void refreshCobrancas();
          }}
        />
      </>
    );
  }

  const items = [
    { label: "Ver cobrança", onClick: () => router.push(`/cobrancas/${cobranca.id}`) },
    { label: "Abrir proposta", onClick: () => router.push(`/orcamentos/${cobranca.id_int}`) },
    { label: "Ver cliente", onClick: () => router.push(`/cadastros/${cobranca.id_cliente}`) },
    {
      label: "Abrir chat da proposta",
      onClick: () => openChat(cobranca.id_int, { clienteNome: cobranca.cliente, idCliente: cobranca.id_cliente })
    },
    // Real Supabase confirmation actions (Liberar OS / Autorizar faturamento / Voltar para fila)
    ...(
      !cobranca.confirmado
        ? isPendenteAprovacao(cobranca)
          ? (user?.isAdmin || user?.isSuperAdmin)
            ? [
                {
                  label: "Autorizar faturamento",
                  onClick: () => {
                    if (!cobranca.id) {
                      showToast({ type: "error", title: "ID da cobrança inválido para autorização." });
                      return;
                    }
                    setIsAutorizarModalOpen(true);
                  }
                }
              ]
            : []
          : (cobranca.status === "PAID" || cobranca.status === "A_VENCER")
            ? [
                {
                  label: "Confirmar Conferência",
                  onClick: () => {
                    if (!cobranca.id) {
                      showToast({ type: "error", title: "ID da cobrança inválido para liberação." });
                      return;
                    }
                    setIsLiberarModalOpen(true);
                  }
                }
              ]
            : []
        : (cobranca.status === "PAID" || cobranca.status === "A_VENCER")
          ? [
              {
                label: isUpdating ? "Estornando..." : "Voltar para lista principal",
                disabled: isUpdating,
                onClick: () => void handleVoltarFilaReal()
              }
            ]
          : []
    ),
    ...(cobranca.tipo_cobranca?.toUpperCase() === "E-FATURADO" &&
    cobranca.status === "A_VENCER" &&
    Boolean(cobranca.confirmado) &&
    !Boolean(cobranca.boleto_enviadoo)
      ? [
          {
            label: "Preparar boletos",
            onClick: () => setIsPrepararBoletosOpen(true)
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
      onClick: () => setIsCancelModalOpen(true)
    }
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
        onCreditApproved={handleCreditApproved}
      />
      <CancelCobrancaModal
        isOpen={isCancelModalOpen}
        onClose={() => setIsCancelModalOpen(false)}
        cobrancaId={cobranca.id}
      />
      <AutorizarFaturamentoModal
        isOpen={isAutorizarModalOpen}
        onClose={() => setIsAutorizarModalOpen(false)}
        cobranca={cobranca}
      />
      <ConfirmarLiberacaoModal
        isOpen={isLiberarModalOpen}
        onClose={() => setIsLiberarModalOpen(false)}
        cobranca={cobranca}
      />
      <PrepararBoletosModal
        isOpen={isPrepararBoletosOpen}
        onClose={() => setIsPrepararBoletosOpen(false)}
        cobranca={cobranca}
        onSuccess={(extRef) => {
          setIsPrepararBoletosOpen(false);
          setJustLaunchedExtRef(extRef);
          setIsReviewModalOpen(true);
          void refreshCobrancas();
        }}
      />
      <RevisarGeracaoBancariaModal
        isOpen={isReviewModalOpen}
        onClose={() => setIsReviewModalOpen(false)}
        extReference={justLaunchedExtRef}
        nomeCliente={cobranca.cliente}
        valorTotalNf={cobranca.valor}
        onSaveSuccess={() => {
          void refreshCobrancas();
        }}
      />
    </>
  );
}
