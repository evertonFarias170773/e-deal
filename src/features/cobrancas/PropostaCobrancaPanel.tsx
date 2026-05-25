"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CreditCard, Landmark, QrCode, ReceiptText, X } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { Field, PanelCard, inputClass } from "@/features/cobrancas/form-ui";
import type { Cobranca, CobrancaParcelaSimulada, CobrancaTipo, CriarCobrancaFormValues } from "@/features/cobrancas/types";
import type { Proposta } from "@/features/orcamentos/types";
import {
  getLiberacaoPedidoLabel,
  getLiberacaoPedidoStatus,
  getLiberacaoPedidoTone,
  getSituacaoFinanceiraPropostaLabel,
  isCreditoPendente,
  isPropostaLiberadaParaPedido
} from "@/features/cobrancas/cobrancas-utils";
import { formatCurrency } from "@/lib/formatters/currency";
import {
  createParcelasSimuladas,
  criarCobrancaInitialValues,
  getCobrancaTipoLabel,
  getEmpresaRecebedoraByProposta,
  getMensagemTipoIndisponivel,
  isTipoDisponivelParaEmpresa
} from "@/lib/mocks/pagamentos.mock";

type PropostaCobrancaPanelProps = {
  proposta: Proposta;
  isModalOpen?: boolean;
  onOpenModal?: () => void;
  onCloseModal?: () => void;
  defaultModalOpen?: boolean;
};

export function PropostaCobrancaPanel({
  proposta,
  isModalOpen,
  onOpenModal,
  onCloseModal,
  defaultModalOpen = false
}: PropostaCobrancaPanelProps) {
  const { showToast } = useAppToast();
  const { createCobranca, getCobrancasByProposta } = useCobrancas();
  const [internalModalOpen, setInternalModalOpen] = useState(defaultModalOpen);
  const [isSaving, setIsSaving] = useState(false);
  const [parcelasCartao, setParcelasCartao] = useState(2);
  const empresa = getEmpresaRecebedoraByProposta(proposta);
  const cobrancasDaProposta = getCobrancasByProposta(proposta.id_int);
  const cobrancasAtivas = cobrancasDaProposta.filter((item) => item.status !== "CANCELADO");
  const liberacaoStatus = getLiberacaoPedidoStatus(cobrancasDaProposta);
  const propostaLiberada = isPropostaLiberadaParaPedido(cobrancasDaProposta);
  const isControlled = typeof isModalOpen === "boolean";
  const modalOpen = isControlled ? Boolean(isModalOpen) : internalModalOpen;
  const totalCobradoReal = cobrancasAtivas.reduce((total, item) => total + getValorCobranca(item), 0);
  const hasCobrancaExcedente = totalCobradoReal > proposta.resumo.valorTotal;
  const totalGerado = Math.min(totalCobradoReal, proposta.resumo.valorTotal);
  const saldoRestante = Math.max(proposta.resumo.valorTotal - totalCobradoReal, 0);
  const situacaoFinanceira = getSituacaoFinanceiraPropostaLabel(cobrancasDaProposta);

  function buildInitialFormState(): CriarCobrancaFormValues {
    return {
      ...criarCobrancaInitialValues,
      propostaIdInt: proposta.id_int,
      valor: saldoRestante > 0 || cobrancasAtivas.length > 0 ? saldoRestante : proposta.resumo.valorTotal,
      descricao: `Cobrança da proposta #${proposta.id_int}`,
      observacao: proposta.observacoes,
      condicaoPagamento: proposta.formaPagamento,
      vencimento: "2026-05-30"
    };
  }

  const [form, setForm] = useState<CriarCobrancaFormValues>(buildInitialFormState);
  const parcelas = useMemo(() => createParcelasSimuladas(form.valor || 0), [form.valor]);
  const tipoDisponivel = isTipoDisponivelParaEmpresa(proposta.empresa, form.tipoCobranca);
  const indisponibilidadeMensagem = getMensagemTipoIndisponivel(proposta.empresa, form.tipoCobranca);

  const analiseCredito = useMemo(() => {
    const disponivel = proposta.cliente.creditoDisponivel;
    const limite = proposta.cliente.limiteCredito;
    const utilizado = Math.max(0, limite - disponivel);
    const aprovado = disponivel >= form.valor;

    return {
      limite,
      utilizado,
      disponivel,
      valorSolicitado: form.valor,
      risco: proposta.cliente.riscoCredito,
      statusAnalise: aprovado ? "APROVADO" as const : "AGUARDANDO_FINANCEIRO" as const,
      mensagem: aprovado ? "Crédito disponível. Faturamento liberado." : "Crédito insuficiente. Solicitação enviada ao financeiro."
    };
  }, [form.valor, proposta]);

  useEffect(() => {
    setForm(buildInitialFormState());
    setParcelasCartao(2);
  }, [proposta, saldoRestante]);

  useEffect(() => {
    if (!modalOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeModal();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [modalOpen]);

  function openModal() {
    if (!isControlled) {
      setInternalModalOpen(true);
    }

    onOpenModal?.();
  }

  function closeModal() {
    if (!isControlled) {
      setInternalModalOpen(false);
    }

    onCloseModal?.();
  }

  function patchForm(patch: Partial<CriarCobrancaFormValues>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function handleTipoChange(tipo: CobrancaTipo) {
    if (tipo === "CARD_PARCELADO") {
      patchForm({
        tipoCobranca: tipo,
        parcelaSelecionada: getParcelaByQuantidade(parcelas, parcelasCartao),
        condicaoPagamento: `${parcelasCartao}x`
      });
      return;
    }

    patchForm({
      tipoCobranca: tipo,
      parcelaSelecionada: undefined,
      condicaoPagamento: tipo === "E-FATURADO" ? "Faturado" : proposta.formaPagamento,
      vencimento: tipo === "BOLETO" || tipo === "E-FATURADO" ? form.vencimento || "2026-05-30" : form.vencimento
    });
  }

  function handleParcelasCartaoChange(value: number) {
    const quantidade = Math.min(12, Math.max(1, Number.isNaN(value) ? 1 : value));
    setParcelasCartao(quantidade);
    patchForm({
      parcelaSelecionada: getParcelaByQuantidade(parcelas, quantidade),
      condicaoPagamento: `${quantidade}x`
    });
  }

  async function handleSubmit() {
    if (!form.osIdeal.trim()) {
      showToast({ type: "error", title: "Informe a OS Ideal temporária para gerar a cobrança." });
      return;
    }

    if (!form.tipoCobranca) {
      showToast({ type: "error", title: "Selecione uma forma de pagamento." });
      return;
    }

    if (saldoRestante <= 0) {
      showToast({ type: "warning", title: "Esta proposta não possui saldo restante para nova cobrança." });
      return;
    }

    if (form.valor <= 0) {
      showToast({ type: "error", title: "Informe um valor de cobrança maior que zero." });
      return;
    }

    if (!tipoDisponivel) {
      showToast({ type: "warning", title: indisponibilidadeMensagem || "Tipo indisponível para a empresa da proposta." });
      return;
    }

    if ((form.tipoCobranca === "BOLETO" || form.tipoCobranca === "E-FATURADO") && !form.vencimento) {
      showToast({ type: "error", title: "Informe a data de vencimento para continuar." });
      return;
    }

    const payload: CriarCobrancaFormValues = {
      ...form,
      descricao: `Cobrança ${getCobrancaTipoLabel(form.tipoCobranca)} da proposta #${proposta.id_int}`,
      parcelaSelecionada:
        form.tipoCobranca === "CARD_PARCELADO"
          ? getParcelaByQuantidade(parcelas, parcelasCartao)
          : undefined
    };

    setIsSaving(true);
    await new Promise((resolve) => window.setTimeout(resolve, 850));
    createCobranca(payload);

    showToast({
      type: "success",
      title: "Cobrança criada com sucesso."
    });

    setForm(buildInitialFormState());
    setParcelasCartao(2);
    setIsSaving(false);
    closeModal();
  }

  const opcoesPagamento: Array<{
    id: CobrancaTipo;
    label: string;
    icon: typeof QrCode;
    blockedText?: string;
  }> = [
    { id: "PIX", label: "PIX", icon: QrCode },
    { id: "BOLETO", label: "Boleto", icon: ReceiptText },
    { id: "CREDIT_CARD", label: "Cartão", icon: CreditCard },
    { id: "CARD_PARCELADO", label: "Cartão parcelado", icon: CreditCard },
    { id: "E-FATURADO", label: "Faturado", icon: Landmark }
  ];

  return (
    <div className="space-y-6">
      <PanelCard
        title="Cobranças já geradas"
        description="A cobrança continua nascendo dentro da proposta. O modal de criação foi simplificado para um fluxo rápido e operacional."
      >
        <div className="rounded-3xl border border-[#d7e5e8] bg-slate-50 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-800">
                Proposta #{proposta.id_int} • {proposta.cliente.nome} • {empresa?.nome ?? proposta.empresa}
              </p>
              <p className="text-sm text-slate-600">
                Total {formatCurrency(proposta.resumo.valorTotal)} • Já cobrado {formatCurrency(totalGerado)} • Saldo {formatCurrency(saldoRestante)}
              </p>
              {hasCobrancaExcedente ? (
                <p className="text-xs font-semibold text-orange-700">Cobranças excedem o valor da proposta no mock.</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={getLiberacaoPedidoLabel(liberacaoStatus)} tone={getLiberacaoPedidoTone(liberacaoStatus)} />
                {propostaLiberada ? <StatusBadge status="LIBERADA_PARA_PEDIDO" tone="success" /> : null}
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                href="/cobrancas"
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Conferência financeira
              </Link>
              <button
                type="button"
                onClick={openModal}
                className="inline-flex items-center justify-center rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
              >
                Gerar cobrança
              </button>
            </div>
          </div>
        </div>

        <div className="mt-5">
          <CobrancasDaPropostaList cobrancas={cobrancasDaProposta} />
        </div>
      </PanelCard>

      {modalOpen ? (
        <div className="fixed inset-0 z-[70] bg-slate-950/60 p-2 sm:p-6" role="dialog" aria-modal="true" onClick={(event) => {
          if (event.target === event.currentTarget) {
            closeModal();
          }
        }}>
          <div className="mx-auto flex h-[calc(100vh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl sm:h-auto sm:max-h-[94vh] sm:rounded-[28px]">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-4 sm:p-5 md:p-6">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">Criar cobrança</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {proposta.cliente.nome} • {empresa?.nome ?? proposta.empresa} • Total {formatCurrency(proposta.resumo.valorTotal)} • Já cobrado {formatCurrency(totalGerado)} • Saldo {formatCurrency(saldoRestante)}
                </p>
                <p className="mt-1 text-xs text-slate-500">Proposta #{proposta.id_int} • Situação {situacaoFinanceira}</p>
                {hasCobrancaExcedente ? (
                  <p className="mt-1 text-xs font-semibold text-orange-700">Cobranças excedem o valor da proposta no mock.</p>
                ) : null}
              </div>
              <button type="button" onClick={closeModal} className="rounded-2xl bg-slate-100 p-2 text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5 md:p-6">
              <PanelCard
                title="Dados da cobrança"
                description="Preencha os dados essenciais para gerar a cobrança mockada."
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Empresa recebedora">
                    <input readOnly value={empresa?.labelCurta ?? proposta.empresa} className={`${inputClass} cursor-not-allowed bg-slate-100 text-slate-500`} />
                  </Field>
                  <Field label="Forma de pagamento selecionada">
                    <input readOnly value={getCobrancaTipoLabel(form.tipoCobranca)} className={`${inputClass} cursor-not-allowed bg-slate-100 text-slate-500`} />
                  </Field>
                  <Field label="OS Ideal *">
                    <input
                      value={form.osIdeal}
                      onChange={(event) => patchForm({ osIdeal: event.target.value })}
                      className={inputClass}
                      placeholder="Ex.: OS-IDEAL-2101"
                    />
                  </Field>
                  <Field label="Valor da cobrança *">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={form.valor}
                      onChange={(event) => patchForm({ valor: Number(event.target.value) || 0 })}
                      className={inputClass}
                    />
                  </Field>
                  {form.tipoCobranca === "BOLETO" || form.tipoCobranca === "E-FATURADO" ? (
                    <Field label="Data de vencimento *">
                      <input type="date" value={form.vencimento} onChange={(event) => patchForm({ vencimento: event.target.value })} className={inputClass} />
                    </Field>
                  ) : null}
                  <div className="md:col-span-2">
                    <Field label="Observações">
                      <textarea
                        value={form.observacao}
                        onChange={(event) => patchForm({ observacao: event.target.value })}
                        className={`${inputClass} min-h-24 resize-y`}
                        placeholder="Observação opcional"
                      />
                    </Field>
                  </div>
                </div>
              </PanelCard>

              <PanelCard
                title="Forma de pagamento"
                description="Escolha uma opção operacional. Detalhes técnicos de geração ficam para backend e detalhe da cobrança."
              >
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                  {opcoesPagamento.map((opcao) => {
                    const Icon = opcao.icon;
                    const selected = form.tipoCobranca === opcao.id;
                    const available = isTipoDisponivelParaEmpresa(proposta.empresa, opcao.id);
                    const disabledText = available ? "" : "Indisponível para esta empresa no mock.";

                    return (
                      <button
                        key={opcao.id}
                        type="button"
                        disabled={!available}
                        onClick={() => handleTipoChange(opcao.id)}
                        className={`rounded-2xl border px-3 py-2 text-left transition ${
                          selected
                            ? "border-[#0f9f9a] bg-[#dff8f6]"
                            : "border-slate-200 bg-white hover:bg-slate-50"
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                        title={disabledText}
                      >
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-slate-700" />
                          <span className="text-sm font-semibold text-slate-900">{opcao.label}</span>
                        </div>
                        {!available ? <p className="mt-1 text-[11px] text-slate-500">Indisponível no mock</p> : null}
                      </button>
                    );
                  })}
                </div>
                {!tipoDisponivel ? (
                  <p className="mt-3 text-xs text-orange-700">{indisponibilidadeMensagem || "Indisponível para esta empresa no mock."}</p>
                ) : null}
              </PanelCard>

              {form.tipoCobranca === "CARD_PARCELADO" ? (
                <PanelCard
                  title="Campos mínimos do cartão parcelado"
                  description="Apenas a quantidade de parcelas é necessária nesta etapa."
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Quantidade de parcelas">
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={parcelasCartao}
                        onChange={(event) => handleParcelasCartaoChange(Number(event.target.value))}
                        className={inputClass}
                      />
                    </Field>
                  </div>
                </PanelCard>
              ) : null}

              {form.tipoCobranca === "E-FATURADO" ? (
                <PanelCard
                  title="Campos mínimos do faturado"
                  description="Condição comercial e aviso resumido de crédito."
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Condição comercial">
                      <input
                        value={form.condicaoPagamento}
                        onChange={(event) => patchForm({ condicaoPagamento: event.target.value })}
                        className={inputClass}
                        placeholder="Ex.: Faturado 28 dias"
                      />
                    </Field>
                  </div>
                  <p className={`mt-3 rounded-2xl border px-3 py-2 text-sm ${analiseCredito.disponivel >= form.valor ? "border-teal-200 bg-teal-50 text-teal-800" : "border-orange-200 bg-orange-50 text-orange-800"}`}>
                    {analiseCredito.disponivel >= form.valor
                      ? "Crédito disponível. Será criado como A_VENCER confirmado."
                      : "Crédito insuficiente. Será enviado para análise do financeiro."}
                  </p>
                </PanelCard>
              ) : null}

              <p className="text-sm text-slate-600">
                Esta proposta já possui <strong className="text-slate-900">{cobrancasDaProposta.length}</strong> cobrança(s) gerada(s).
              </p>
            </div>

            <div className="border-t border-slate-100 bg-white p-4 sm:p-5 md:p-6">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-sm font-semibold text-slate-700">
                  Proposta #{proposta.id_int} • {getCobrancaTipoLabel(form.tipoCobranca)} • {formatCurrency(form.parcelaSelecionada?.valorFinal ?? form.valor)}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isSaving || !tipoDisponivel}
                    className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
                  >
                    {isSaving ? "Gerando cobrança..." : "Gerar cobrança"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CobrancasDaPropostaList({ cobrancas, compact = false }: { cobrancas: Cobranca[]; compact?: boolean }) {
  if (!cobrancas.length) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
        Nenhuma cobrança criada para esta proposta ainda. Gere a primeira cobrança por aqui para alimentar `pagamentos_v2` no mock.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {cobrancas.map((cobranca) => (
        <div key={cobranca.id} className={`rounded-3xl border border-slate-200 bg-slate-50 ${compact ? "p-4" : "p-5"}`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{cobranca.id_pagamento}</p>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                <MiniInfo label="Tipo" value={getCobrancaTipoLabel(cobranca.tipo_cobranca)} />
                <MiniInfo label="OS Ideal" value={cobranca.os_ideal} />
                <MiniInfo label="Valor" value={formatCurrency(getValorCobranca(cobranca))} />
                <MiniInfo label="Status" value={cobranca.status} />
                <MiniInfo label="Confirmado" value={cobranca.confirmado ? "Sim" : "Não"} />
                <MiniInfo label="Cliente" value={cobranca.cliente} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={cobranca.status} />
              {isCreditoPendente(cobranca) ? <StatusBadge status="AGUARDANDO_CREDITO" tone="warning" /> : null}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Link
              href={`/cobrancas/${cobranca.id}`}
              className="inline-flex items-center justify-center rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white"
            >
              Ver cobrança
            </Link>
            <Link
              href="/cobrancas"
              className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Conferência financeira
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function getValorCobranca(cobranca: Cobranca) {
  return cobranca.cartao_valor_final ?? cobranca.valor;
}

function getParcelaByQuantidade(parcelas: CobrancaParcelaSimulada[], quantidade: number): CobrancaParcelaSimulada {
  const existing = parcelas.find((item) => item.parcelas === quantidade);

  if (existing) {
    return existing;
  }

  return {
    parcelas: quantidade,
    taxaPercentual: 0,
    valorTaxa: 0,
    valorFinal: parcelas[0]?.valorFinal ?? 0,
    valorParcela: (parcelas[0]?.valorFinal ?? 0) / Math.max(quantidade, 1),
    rotulo: `${quantidade}x`
  };
}
