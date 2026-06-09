"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { CobrancaActionsMenu } from "@/features/cobrancas/CobrancaActionsMenu";
import { CobrancaHistoricoPanel } from "@/features/cobrancas/CobrancaHistoricoPanel";
import { CobrancaStatusBadge } from "@/features/cobrancas/CobrancaStatusBadge";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import {
  canLiberarParaPedido,
  getTipoCobrancaLabel,
  isCobrancaVencida,
  isPropostaLiberadaParaPedido
} from "@/features/cobrancas/cobrancas-utils";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDate } from "@/lib/formatters/date";
import type { Cobranca } from "@/features/cobrancas/types";

type CobrancaDetailProps = {
  cobrancaId: string;
};

function getValorCobranca(cobranca: Cobranca) {
  const tipoNormalized = cobranca.tipo_cobranca?.trim().toUpperCase().replace(/_/g, "-");
  if (tipoNormalized === "CARD-PARCELADO" && typeof cobranca.cartao_valor_final === "number" && cobranca.cartao_valor_final > 0) {
    return cobranca.cartao_valor_final;
  }
  return cobranca.valor;
}

function renderShortUrl(url: string | undefined, token: string | undefined) {
  if (!url) return "-";
  if (token && url.includes(token)) {
    return `pay.ai-ideal.com.br/i/${token}`;
  }
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname;
    const path = parsed.pathname;
    if (path.length > 15) {
      return `${domain}${path.substring(0, 10)}...${path.substring(path.length - 5)}`;
    }
    return `${domain}${path}`;
  } catch {
    if (url.length > 30) {
      return `${url.substring(0, 20)}...${url.substring(url.length - 8)}`;
    }
    return url;
  }
}

export function CobrancaDetail({ cobrancaId }: CobrancaDetailProps) {
  const router = useRouter();
  const { showToast } = useAppToast();
  const { getCobrancaById, cancelCobranca, getCobrancasByProposta, liberarParaPedido, source, refreshCobrancas } = useCobrancas();
  const cobranca = getCobrancaById(cobrancaId) as NonNullable<ReturnType<typeof getCobrancaById>>;

  if (!cobranca) {
    return (
      <div data-cobranca-detail-source={source} className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <span className="text-xs font-semibold uppercase tracking-wide text-[#0b7774]">Detalhe da cobrança</span>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">Cobrança não encontrada</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          O identificador informado não existe no conjunto de dados carregado. Volte para a lista e tente novamente.
        </p>
      </div>
    );
  }

  const cobrancaAtual = cobranca;
  const cobrancasDaProposta = getCobrancasByProposta(cobrancaAtual.id_int);
  const propostaLiberada = isPropostaLiberadaParaPedido(cobrancasDaProposta);
  const podeLiberarParaPedido = canLiberarParaPedido(cobrancasDaProposta);

  const tipoNormalized = cobrancaAtual.tipo_cobranca?.trim().toUpperCase().replace(/_/g, "-");
  const isFaturado = tipoNormalized === "E-FATURADO" || tipoNormalized === "FATURADO";
  const valorExibicao = getValorCobranca(cobrancaAtual);

  async function copyValue(value: string | undefined, successTitle: string) {
    if (!value) {
      return;
    }
    await navigator.clipboard?.writeText(value);
    showToast({ type: "success", title: successTitle });
  }

  function handleCancel() {
    if (source === "supabase") {
      showToast({ type: "warning", title: "Cancelamento manual indisponível para cobranças reais." });
      return;
    }
    const confirmed = window.confirm("Cancelar cobrança? Esta ação altera apenas o estado visual.");

    if (!confirmed) {
      return;
    }

    cancelCobranca(cobrancaAtual.id, "Cancelamento solicitado a partir do detalhe.");
    showToast({ type: "warning", title: "Cobrança cancelada." });
  }

  function handleLiberarPedido() {
    if (source === "supabase") {
      showToast({ type: "warning", title: "Liberação de pedido automática desativada nesta etapa de testes." });
      return;
    }
    const liberou = liberarParaPedido(cobrancaAtual.id_int);
    showToast({
      type: liberou ? "success" : "warning",
      title: liberou ? "Proposta liberada para pedido." : "Ainda não é possível liberar para pedido."
    });
  }

  return (
    <div data-cobranca-detail-source={source} className="space-y-4 max-w-5xl mx-auto">
      <div>
        <Link href="/cobrancas" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar para cobranças
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Cobrança #{cobrancaAtual.id_pagamento}</span>
          <h1 className="text-xl font-bold text-slate-900 mt-0.5">
            {cobrancaAtual.cliente}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Vínculo: Proposta #{cobrancaAtual.id_int} • CPF/CNPJ: {cobrancaAtual.documento || "-"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CobrancaStatusBadge cobranca={cobrancaAtual} />
          <CobrancaActionsMenu cobranca={cobrancaAtual} />
        </div>
      </div>

      {source === "supabase" && tipoNormalized === "PIX" && !cobrancaAtual.pix_copia_cola ? (
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-teal-800 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm">
          <div>
            <p className="font-semibold">Gerando código PIX...</p>
            <p className="text-xs text-teal-700 mt-0.5">Aguardando registro do pagamento no banco.</p>
          </div>
          <button
            type="button"
            onClick={async () => {
              await refreshCobrancas();
              showToast({ type: "info", title: "Dados atualizados." });
            }}
            className="inline-flex items-center justify-center rounded-xl bg-teal-800 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-teal-900"
          >
            Atualizar status
          </button>
        </div>
      ) : null}

      {isCobrancaVencida(cobrancaAtual) ? (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-orange-800 text-sm">
          <p className="font-semibold">Vencimento Excedido</p>
          <p className="text-xs text-orange-700 mt-0.5">
            O prazo de vencimento desta cobrança expirou.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2 space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <h2 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2 mb-3">Informações Financeiras</h2>
            
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 text-xs">
              <div>
                <span className="text-slate-500 block mb-0.5">Valor</span>
                <span className="font-bold text-slate-900 text-sm">{formatCurrency(valorExibicao)}</span>
                {tipoNormalized === "CARD-PARCELADO" && cobrancaAtual.cartao_parcelas ? (
                  <span className="text-[10px] text-slate-500 block">Parcelado em {cobrancaAtual.cartao_parcelas}x</span>
                ) : null}
              </div>

              <div>
                <span className="text-slate-500 block mb-0.5">Vencimento</span>
                <span className="font-semibold text-slate-900">
                  {cobrancaAtual.vencimento ? formatDate(cobrancaAtual.vencimento) : "-"}
                </span>
                {cobrancaAtual.paid_at ? (
                  <span className="text-[10px] text-teal-600 block font-medium">Pago em {formatDate(cobrancaAtual.paid_at)}</span>
                ) : (
                  <span className="text-[10px] text-slate-400 block">Aguardando pagamento</span>
                )}
              </div>

              <div>
                <span className="text-slate-500 block mb-0.5">Tipo de cobrança</span>
                <span className="font-semibold text-slate-900">
                  {getTipoCobrancaLabel(cobrancaAtual.tipo_cobranca)}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block mb-0.5">Empresa recebedora</span>
                <span className="font-semibold text-slate-900">{cobrancaAtual.empresa || "-"}</span>
              </div>

              <div>
                <span className="text-slate-500 block mb-0.5">Vendedor</span>
                <span className="font-semibold text-slate-900">
                  {cobrancaAtual.proposta?.vendedor || cobrancaAtual.atendente || "-"}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block mb-0.5">OS Ideal</span>
                <span className="font-semibold text-slate-900">{cobrancaAtual.os_ideal || "-"}</span>
              </div>
            </div>

            {cobrancaAtual.condicao_pagamento && (
              <div className="mt-4 pt-3 border-t border-slate-100 text-xs">
                <span className="text-slate-500 block mb-0.5">Condição comercial</span>
                <span className="font-semibold text-slate-800">{cobrancaAtual.condicao_pagamento}</span>
              </div>
            )}
            
            {cobrancaAtual.obs_v2 && (
              <div className="mt-2 pt-2 border-t border-slate-100 text-xs">
                <span className="text-slate-500 block mb-0.5">Observações</span>
                <p className="text-slate-700 leading-relaxed">{cobrancaAtual.obs_v2}</p>
              </div>
            )}
          </div>

          {(cobrancaAtual.url_cobranca || cobrancaAtual.pix_copia_cola || cobrancaAtual.linha_digitavel || cobrancaAtual.url_pdf) ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <h2 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2 mb-3">Links e Códigos de Pagamento</h2>
              
              <div className="space-y-3 text-xs">
                {cobrancaAtual.url_cobranca && !isFaturado && (
                  <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between p-2 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="truncate">
                      <span className="text-slate-500 block text-[10px]">Link de Pagamento</span>
                      <span className="font-mono text-slate-700 truncate block max-w-md" title={cobrancaAtual.url_cobranca}>
                        {renderShortUrl(cobrancaAtual.url_cobranca, cobrancaAtual.token_publico)}
                      </span>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <a
                        href={cobrancaAtual.url_cobranca}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg bg-teal-600 px-2.5 py-1 text-white font-semibold hover:bg-teal-700 transition"
                      >
                        Abrir
                      </a>
                      <button
                        type="button"
                        onClick={() => void copyValue(cobrancaAtual.url_cobranca, "Link de pagamento copiado.")}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50 transition font-semibold"
                      >
                        Copiar
                      </button>
                    </div>
                  </div>
                )}

                {cobrancaAtual.pix_copia_cola && (
                  <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between p-2 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="truncate text-left w-full sm:w-auto">
                      <span className="text-slate-500 block text-[10px]">Código PIX Copia e Cola</span>
                      <span className="font-mono text-slate-700 truncate block max-w-md" title={cobrancaAtual.pix_copia_cola}>
                        {cobrancaAtual.pix_copia_cola}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyValue(cobrancaAtual.pix_copia_cola, "Código PIX copiado.")}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50 transition shrink-0 font-semibold"
                    >
                      Copiar PIX
                    </button>
                  </div>
                )}

                {cobrancaAtual.linha_digitavel && (
                  <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between p-2 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="truncate text-left w-full sm:w-auto">
                      <span className="text-slate-500 block text-[10px]">Linha Digitável</span>
                      <span className="font-mono text-slate-700 truncate block max-w-md" title={cobrancaAtual.linha_digitavel}>
                        {cobrancaAtual.linha_digitavel}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyValue(cobrancaAtual.linha_digitavel, "Linha digitável copiada.")}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50 transition shrink-0 font-semibold"
                    >
                      Copiar Código
                    </button>
                  </div>
                )}

                {cobrancaAtual.url_pdf && (
                  <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-100">
                    <div>
                      <span className="text-slate-500 block text-[10px]">Documento da Cobrança</span>
                      <span className="font-medium text-slate-700">Arquivo PDF da cobrança</span>
                    </div>
                    <a
                      href={cobrancaAtual.url_pdf}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50 transition font-semibold"
                    >
                      Visualizar PDF
                    </a>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <CobrancaHistoricoPanel cobranca={cobrancaAtual} />
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <h2 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2 mb-3">Ações Administrativas</h2>
            <div className="space-y-2 text-xs">
              
              {source === "supabase" ? (
                <button
                  type="button"
                  onClick={async () => {
                    await refreshCobrancas();
                    showToast({ type: "info", title: "Dados atualizados." });
                  }}
                  className="w-full rounded-xl bg-[#0b2f4a] py-2 px-3 text-white font-semibold hover:bg-[#123f61] transition text-center"
                >
                  Atualizar do Supabase
                </button>
              ) : (
                cobrancaAtual.token_publico && (
                  <button
                    type="button"
                    onClick={() => router.push(`/pagamento/${cobrancaAtual.token_publico}`)}
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 px-3 text-slate-700 hover:bg-slate-50 transition font-semibold text-center"
                  >
                    Visualizar Página de Checkout
                  </button>
                )
              )}

              {source !== "supabase" && (
                propostaLiberada ? (
                  <button
                    type="button"
                    disabled
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 px-3 text-slate-400 cursor-not-allowed font-semibold text-center"
                  >
                    Pedido já liberado
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleLiberarPedido}
                    disabled={!podeLiberarParaPedido}
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 px-3 text-slate-700 hover:bg-slate-50 transition disabled:opacity-50 font-semibold text-center"
                  >
                    Liberar para pedido
                  </button>
                )
              )}

              {cobrancaAtual.status !== "CANCELADO" && source !== "supabase" && (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="w-full rounded-xl border border-red-200 bg-red-50 py-2 px-3 text-red-700 hover:bg-red-100 transition font-semibold text-center"
                >
                  Cancelar cobrança
                </button>
              )}
              
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
