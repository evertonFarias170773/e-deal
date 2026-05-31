"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, Landmark, QrCode, ReceiptText, X } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { Field, PanelCard, inputClass } from "@/features/cobrancas/form-ui";
import type { Cobranca, CobrancaTipo, CriarCobrancaFormValues } from "@/features/cobrancas/types";
import type { Proposta } from "@/features/orcamentos/types";
import {
  getLiberacaoPedidoLabel,
  getLiberacaoPedidoStatus,
  getLiberacaoPedidoTone,
  getSituacaoFinanceiraPropostaLabel,
  isCreditoPendente,
  isPropostaLiberadaParaPedido,
  EMPRESAS_RECEBEDORAS_FIXAS,
  roundMoney
} from "@/features/cobrancas/cobrancas-utils";
import { formatCurrency } from "@/lib/formatters/currency";
import {
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
  const { createCobranca, getCobrancasByProposta, source } = useCobrancas();
  const [internalModalOpen, setInternalModalOpen] = useState(defaultModalOpen);
  const [isSaving, setIsSaving] = useState(false);
  const idEmpresaReal = source === "supabase" ? getEmpresaIdByNome(proposta.empresa) : null;
  const empresa = source === "supabase"
    ? EMPRESAS_RECEBEDORAS_FIXAS.find((e) => e.id === idEmpresaReal)
    : getEmpresaRecebedoraByProposta(proposta);
  const cobrancasDaProposta = getCobrancasByProposta(proposta.id_int);
  const cobrancasAtivas = cobrancasDaProposta.filter((item) => item.status !== "CANCELADO");
  const liberacaoStatus = getLiberacaoPedidoStatus(cobrancasDaProposta);
  const propostaLiberada = isPropostaLiberadaParaPedido(cobrancasDaProposta);
  const isControlled = typeof isModalOpen === "boolean";
  const totalPropostaRounded = roundMoney(proposta.resumo.valorTotal);
  const totalCobradoReal = cobrancasAtivas.reduce((total, item) => total + getValorCobranca(item), 0);
  const totalCobradoRealRounded = roundMoney(totalCobradoReal);
  const hasCobrancaExcedente = totalCobradoRealRounded > totalPropostaRounded;
  const totalGerado = Math.min(totalCobradoRealRounded, totalPropostaRounded);
  const saldoRestante = Math.max(totalPropostaRounded - totalCobradoRealRounded, 0);
  const modalOpen = (isControlled ? Boolean(isModalOpen) : internalModalOpen) && (saldoRestante > 0);
  const situacaoFinanceira = getSituacaoFinanceiraPropostaLabel(cobrancasDaProposta);

  function buildInitialFormState(): CriarCobrancaFormValues {
    const cobrancaComOs = cobrancasDaProposta.find((item) => item.os_ideal && item.os_ideal.trim() !== "");
    const defaultOsIdeal = cobrancaComOs ? cobrancaComOs.os_ideal.trim() : "";

    return {
      ...criarCobrancaInitialValues,
      propostaIdInt: proposta.id_int,
      valor: roundMoney(saldoRestante),
      descricao: saldoRestante < totalPropostaRounded
        ? `Cobrança complementar da proposta #${proposta.id_int}`
        : `Cobrança da proposta #${proposta.id_int}`,
      observacao: proposta.observacoes,
      condicaoPagamento: proposta.formaPagamento,
      vencimento: "2026-05-30",
      osIdeal: defaultOsIdeal
    };
  }

  const [form, setForm] = useState<CriarCobrancaFormValues>(buildInitialFormState);
  const tipoDisponivel = source === "supabase"
    ? (form.tipoCobranca === "PIX"
        ? (idEmpresaReal === 1 || idEmpresaReal === 2 || idEmpresaReal === 3)
        : form.tipoCobranca === "BOLETO"
          ? (idEmpresaReal === 1 || idEmpresaReal === 3)
          : form.tipoCobranca === "CARD_PARCELADO"
            ? (idEmpresaReal === 1 || idEmpresaReal === 3)
            : false)
    : isTipoDisponivelParaEmpresa(proposta.empresa, form.tipoCobranca);

  const indisponibilidadeMensagem = source === "supabase"
    ? (form.tipoCobranca === "PIX"
        ? (idEmpresaReal === 1 || idEmpresaReal === 2 || idEmpresaReal === 3 ? "" : "PIX real disponível apenas para as empresas Ideal Gráfica, Ideal Birô e E3 Brindes.")
        : form.tipoCobranca === "BOLETO"
          ? (idEmpresaReal === 1 || idEmpresaReal === 3 ? "" : "Boleto real disponível apenas para as empresas Ideal Gráfica e E3 Brindes.")
          : form.tipoCobranca === "CARD_PARCELADO"
            ? (idEmpresaReal === 1 || idEmpresaReal === 3 ? "" : "Cartão de crédito real disponível apenas para as empresas Ideal Gráfica e E3 Brindes.")
            : "Esta forma de pagamento está em preparação para o ambiente real.")
    : getMensagemTipoIndisponivel(proposta.empresa, form.tipoCobranca);

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

  const openModal = useCallback(() => {
    if (saldoRestante <= 0) {
      showToast({
        type: "warning",
        title: "Ação bloqueada",
        description: "Esta proposta já foi totalmente cobrada (saldo restante é R$ 0,00)."
      });
      return;
    }

    // Reset do formulário apenas ao abrir o modal para evitar sobrescrever edição em andamento.
    setForm(buildInitialFormState());

    if (!isControlled) {
      setInternalModalOpen(true);
    }

    onOpenModal?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isControlled, onOpenModal, saldoRestante]);

  const closeModal = useCallback(() => {
    if (!isControlled) {
      setInternalModalOpen(false);
    }

    onCloseModal?.();
  }, [isControlled, onCloseModal]);

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
  }, [closeModal, modalOpen]);

  function patchForm(patch: Partial<CriarCobrancaFormValues>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function handleTipoChange(tipo: CobrancaTipo) {
    patchForm({
      tipoCobranca: tipo,
      parcelaSelecionada: undefined,
      condicaoPagamento: tipo === "CARD_PARCELADO" ? "Cartão de crédito" : (tipo === "E-FATURADO" ? "Faturado" : proposta.formaPagamento),
      vencimento: tipo === "BOLETO" || tipo === "E-FATURADO" ? form.vencimento || "2026-05-30" : form.vencimento
    });
  }

  async function handleSubmit() {
    if (isSaving) {
      return;
    }

    if (!form.osIdeal.trim()) {
      showToast({ type: "error", title: "Informe a OS Ideal temporária para gerar a cobrança." });
      return;
    }

    if (!form.tipoCobranca) {
      showToast({ type: "error", title: "Selecione uma forma de pagamento." });
      return;
    }

    const roundedValor = roundMoney(form.valor);
    const roundedSaldoRestante = roundMoney(saldoRestante);

    if (roundedSaldoRestante <= 0) {
      showToast({ type: "warning", title: "Esta proposta não possui saldo restante para nova cobrança." });
      return;
    }

    if (roundedValor <= 0) {
      showToast({ type: "error", title: "Informe um valor de cobrança maior que zero." });
      return;
    }

    if (roundedValor > roundedSaldoRestante) {
      showToast({
        type: "error",
        title: `O valor da cobrança (${formatCurrency(roundedValor)}) não pode ser maior que o saldo restante (${formatCurrency(roundedSaldoRestante)}).`
      });
      return;
    }

    if (source === "supabase" && form.tipoCobranca !== "PIX" && form.tipoCobranca !== "BOLETO" && form.tipoCobranca !== "CARD_PARCELADO") {
      showToast({ type: "warning", title: "Forma de pagamento em preparação. Selecione PIX, Boleto ou Cartão para testes reais." });
      return;
    }

    if (source === "supabase" && idEmpresaReal !== 1 && idEmpresaReal !== 2 && idEmpresaReal !== 3) {
      showToast({ type: "error", title: "Criação de cobrança real disponível apenas para as empresas Ideal Gráfica, Ideal Birô e E3 Brindes nesta etapa." });
      return;
    }

    if (source === "supabase" && form.tipoCobranca === "BOLETO" && idEmpresaReal === 2) {
      showToast({ type: "error", title: "Geração de boleto real não disponível para a empresa Ideal Birô." });
      return;
    }

    if (source === "supabase" && form.tipoCobranca === "CARD_PARCELADO" && idEmpresaReal === 2) {
      showToast({ type: "error", title: "Geração de cartão de crédito real não disponível para a empresa Ideal Birô." });
      return;
    }

    if (source === "supabase" && form.tipoCobranca === "BOLETO") {
      const emailCliente = proposta.contato?.email?.trim() || proposta.cliente?.email?.trim() || "";
      if (!emailCliente) {
        showToast({ type: "error", title: "Cliente sem e-mail cadastrado para geração do boleto." });
        return;
      }
    }

    if (source === "supabase") {
      if (!proposta.cliente || !proposta.cliente.nome?.trim()) {
        showToast({ type: "error", title: "Nome do cliente é obrigatório para gerar cobrança real." });
        return;
      }
      if (!proposta.cliente.documento?.trim()) {
        showToast({ type: "error", title: "Documento (CPF/CNPJ) do cliente é obrigatório para gerar cobrança real." });
        return;
      }
      if (!proposta.enderecoEntrega || !proposta.enderecoEntrega.endereco?.trim()) {
        showToast({ type: "error", title: "Logradouro do endereço de entrega é obrigatório para gerar cobrança real." });
        return;
      }
      if (!proposta.enderecoEntrega.cidade?.trim()) {
        showToast({ type: "error", title: "Cidade do endereço de entrega é obrigatória para gerar cobrança real." });
        return;
      }
      if (!proposta.enderecoEntrega.uf?.trim()) {
        showToast({ type: "error", title: "UF do endereço de entrega é obrigatória para gerar cobrança real." });
        return;
      }
      if (!proposta.enderecoEntrega.cep?.trim()) {
        showToast({ type: "error", title: "CEP do endereço de entrega é obrigatório para gerar cobrança real." });
        return;
      }
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
      valor: roundedValor,
      descricao: `Cobrança ${getCobrancaTipoLabel(form.tipoCobranca)} da proposta #${proposta.id_int}`,
      parcelaSelecionada: undefined
    };

    setIsSaving(true);
    try {
      if (source !== "supabase") {
        await new Promise((resolve) => window.setTimeout(resolve, 850));
      }
      await createCobranca(payload, proposta);

      showToast({
        type: "success",
        title: source === "supabase" ? "Cobrança real criada com sucesso!" : "Cobrança criada com sucesso."
      });

      setForm(buildInitialFormState());
      closeModal();
    } catch (error: unknown) {
      console.error("[PropostaCobrancaPanel] Erro ao criar cobrança:", error);
      const errorMessage = error instanceof Error ? error.message : "Verifique sua conexão ou tente novamente.";
      showToast({
        type: "error",
        title: "Erro ao criar cobrança",
        description: errorMessage
      });
    } finally {
      setIsSaving(false);
    }
  }

  const opcoesPagamento: Array<{
    id: CobrancaTipo;
    label: string;
    icon: typeof QrCode;
    blockedText?: string;
  }> = [
    { id: "PIX", label: "PIX", icon: QrCode },
    { id: "BOLETO", label: "Boleto", icon: ReceiptText },
    { id: "CARD_PARCELADO", label: "Cartão de crédito", icon: CreditCard },
    { id: "E-FATURADO", label: "Faturado", icon: Landmark }
  ];

  const hasCobrancas = cobrancasDaProposta.length > 0;

  return (
    <div className="space-y-6">
      <PanelCard
        title="Cobranças já geradas"
        description="A cobrança continua nascendo dentro da proposta. O modal de criação foi simplificado para um fluxo rápido e operacional."
      >
        {!hasCobrancas ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center flex flex-col items-center justify-center gap-4">
            <p className="text-sm font-medium text-slate-600">
              Nenhuma cobrança criada para esta proposta ainda.
            </p>
            {saldoRestante > 0 && (
              <button
                type="button"
                onClick={openModal}
                className="inline-flex items-center justify-center rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
              >
                Gerar cobrança
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="rounded-3xl border border-[#d7e5e8] bg-slate-50 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-800">
                    Proposta #{proposta.id_int} • {proposta.cliente.nome} • {empresa?.nome ?? proposta.empresa}
                  </p>
                  <p className="text-sm text-slate-600">
                    Total {formatCurrency(totalPropostaRounded)} • Já cobrado {formatCurrency(totalGerado)} • Saldo {formatCurrency(saldoRestante)}
                  </p>
                  {hasCobrancaExcedente ? (
                    <p className="text-xs font-semibold text-orange-700">
                      {source === "supabase"
                        ? "Atenção: o total das cobranças excede o valor total da proposta."
                        : "Cobranças excedem o valor da proposta no mock."}
                    </p>
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
                  {saldoRestante > 0 && (
                    <button
                      type="button"
                      onClick={openModal}
                      className="inline-flex items-center justify-center rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
                    >
                      Gerar cobrança
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5">
              <CobrancasDaPropostaList cobrancas={cobrancasDaProposta} />
            </div>
          </>
        )}
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
                  {proposta.cliente.nome} • {empresa?.nome ?? proposta.empresa} • Total {formatCurrency(totalPropostaRounded)} • Já cobrado {formatCurrency(totalGerado)} • Saldo {formatCurrency(saldoRestante)}
                </p>
                <p className="mt-1 text-xs text-slate-500">Proposta #{proposta.id_int} • Situação {situacaoFinanceira}</p>
                {hasCobrancaExcedente ? (
                  <p className="mt-1 text-xs font-semibold text-orange-700">
                    {source === "supabase"
                      ? "Atenção: o total das cobranças excede o valor total da proposta."
                      : "Cobranças excedem o valor da proposta no mock."}
                  </p>
                ) : null}
              </div>
              <button type="button" onClick={closeModal} className="rounded-2xl bg-slate-100 p-2 text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5 md:p-6">
              <PanelCard
                title="Dados da cobrança"
                description={source === "supabase"
                  ? "Preencha os dados essenciais para gerar a cobrança real."
                  : "Preencha os dados essenciais para gerar a cobrança mockada."}
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
                    {saldoRestante < totalPropostaRounded && (
                      <p className="mt-1.5 text-xs text-amber-700 font-semibold bg-amber-50/70 border border-amber-100 rounded-xl p-2.5">
                        ⚠️ Cobrança complementar. Saldo restante: {formatCurrency(saldoRestante)}.
                      </p>
                    )}
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
                    const available = source === "supabase"
                      ? (opcao.id === "PIX"
                          ? (idEmpresaReal === 1 || idEmpresaReal === 2 || idEmpresaReal === 3)
                          : opcao.id === "BOLETO"
                            ? (idEmpresaReal === 1 || idEmpresaReal === 3)
                            : opcao.id === "CARD_PARCELADO"
                              ? (idEmpresaReal === 1 || idEmpresaReal === 3)
                              : true)
                      : isTipoDisponivelParaEmpresa(proposta.empresa, opcao.id);
                    const isRealBlocked = source === "supabase" && opcao.id === "E-FATURADO";
                    const isActuallyDisabled = !available || isRealBlocked;
                    const disabledText = isRealBlocked
                      ? "Forma de pagamento em preparação no ambiente real."
                      : available
                        ? ""
                        : "Indisponível para esta empresa.";

                    return (
                      <button
                        key={opcao.id}
                        type="button"
                        disabled={isActuallyDisabled}
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
                        {!available ? (
                          <p className="mt-1 text-[11px] text-slate-500">Indisponível</p>
                        ) : isRealBlocked ? (
                          <p className="mt-1 text-[11px] text-orange-600 font-semibold">Em preparação</p>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                {!tipoDisponivel ? (
                  <p className="mt-3 text-xs text-orange-700">{indisponibilidadeMensagem || "Indisponível para esta empresa."}</p>
                ) : null}
              </PanelCard>

              {/* Painel de parcelas removido por solicitação */}

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

function CobrancasDaPropostaList({ cobrancas }: { cobrancas: Cobranca[] }) {
  const { showToast } = useAppToast();

  if (!cobrancas.length) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500 text-center">
        Nenhuma cobrança criada para esta proposta ainda.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {cobrancas.map((cobranca) => {
        const valorCobranca = getValorCobranca(cobranca);
        const isBoleto = cobranca.tipo_cobranca === "BOLETO";
        const isPix = cobranca.tipo_cobranca === "PIX";
        const isCard = cobranca.tipo_cobranca === "CARD_PARCELADO";
        const boletoUrl = cobranca.url_pdf || cobranca.pix_copia_cola || "";

        return (
          <div
            key={cobranca.id}
            className="rounded-2xl border border-slate-200 bg-white hover:border-slate-300 transition duration-150 shadow-sm"
          >
            {/* Desktop Layout */}
            <div className="hidden lg:grid lg:grid-cols-[1fr_1.3fr_1.3fr_1fr_1.2fr_2.2fr] lg:gap-4 lg:items-center p-4">
              {/* Col 1: Identificador */}
              <div className="truncate">
                <p className="text-sm font-bold text-slate-900">{cobranca.id_pagamento}</p>
              </div>

              {/* Col 2: Cliente */}
              <div className="truncate" title={cobranca.cliente}>
                <p className="text-xs text-slate-600 truncate">{cobranca.cliente}</p>
              </div>

              {/* Col 3: Tipo + OS Ideal */}
              <div>
                <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800">
                  {getCobrancaTipoLabel(cobranca.tipo_cobranca)}
                </span>
                <p className="mt-1 text-[11px] text-slate-500">
                  OS: <span className="font-semibold text-slate-700">{cobranca.os_ideal || "-"}</span>
                </p>
              </div>

              {/* Col 4: Valor */}
              <div>
                <p className="text-sm font-bold text-slate-900">
                  {formatCurrency(valorCobranca)}
                </p>
                {cobranca.tipo_cobranca === "CARD_PARCELADO" && cobranca.cartao_parcelas ? (
                  <p className="text-[10px] text-slate-500">{cobranca.cartao_parcelas}x</p>
                ) : null}
              </div>

              {/* Col 5: Confirmação */}
              <div>
                {cobranca.status === "CANCELADO" ? (
                  <StatusBadge status="CANCELADO" />
                ) : cobranca.confirmado ? (
                  <StatusBadge status="CONFIRMADO" />
                ) : isCreditoPendente(cobranca) ? (
                  <StatusBadge status="AGUARDANDO_CREDITO" />
                ) : cobranca.status === "A_VENCER" ? (
                  <StatusBadge status="A_VENCER" />
                ) : (
                  <StatusBadge status="NAO_CONFIRMADO" />
                )}
              </div>

              {/* Col 6: Ações */}
              <div className="flex items-center justify-end gap-1.5 flex-wrap">
                {isBoleto ? (
                  <>
                    {boletoUrl ? (
                      <a
                        href={boletoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-xl bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-700 shadow-sm"
                      >
                        Abrir boleto
                      </a>
                    ) : (
                      <button
                        disabled
                        className="inline-flex items-center justify-center rounded-xl bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-400 cursor-not-allowed"
                        title="Boleto ainda não disponível"
                      >
                        Indisponível
                      </button>
                    )}
                    {boletoUrl && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(boletoUrl);
                            showToast({ type: "success", title: "Link do boleto copiado!" });
                          } catch {
                            showToast({ type: "error", title: "Erro ao copiar link." });
                          }
                        }}
                        className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                        title="Copiar link do boleto"
                      >
                        Copiar link
                      </button>
                    )}
                  </>
                ) : isPix ? (
                  <>
                    {cobranca.url_cobranca && (
                      <a
                        href={cobranca.url_cobranca}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-xl border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 transition hover:bg-teal-100"
                      >
                        Abrir checkout
                      </a>
                    )}
                    {cobranca.pix_copia_cola && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(cobranca.pix_copia_cola || "");
                            showToast({ type: "success", title: "PIX Copia e Cola copiado!" });
                          } catch {
                            showToast({ type: "error", title: "Erro ao copiar PIX." });
                          }
                        }}
                        className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                        title="Copiar código PIX"
                      >
                        Copiar PIX
                      </button>
                    )}
                  </>
                ) : isCard ? (
                  <>
                    {cobranca.cartao_checkout_url ? (
                      <a
                        href={cobranca.cartao_checkout_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-xl bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-700 shadow-sm"
                      >
                        Abrir checkout cartão
                      </a>
                    ) : cobranca.url_cobranca ? (
                      <a
                        href={cobranca.url_cobranca}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-xl border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 transition hover:bg-teal-100"
                      >
                        Escolher parcelas
                      </a>
                    ) : (
                      <button
                        disabled
                        className="inline-flex items-center justify-center rounded-xl bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-400 cursor-not-allowed"
                        title="Página do cartão ainda não disponível"
                      >
                        Indisponível
                      </button>
                    )}
                  </>
                ) : (
                  cobranca.url_cobranca && (
                    <a
                      href={cobranca.url_cobranca}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center rounded-xl border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 transition hover:bg-teal-100"
                    >
                      Abrir checkout
                    </a>
                  )
                )}

                <Link
                  href={`/cobrancas/${cobranca.id}`}
                  className="inline-flex items-center justify-center rounded-xl bg-[#0b2f4a] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#123f61]"
                >
                  Ver cobrança
                </Link>
                <Link
                  href="/cobrancas"
                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  title="Conferência financeira"
                >
                  Conferência
                </Link>
              </div>
            </div>

            {/* Mobile Layout */}
            <div className="lg:hidden p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-900">{cobranca.id_pagamento}</p>
                  <p className="text-xs text-slate-500 truncate max-w-[200px]" title={cobranca.cliente}>
                    {cobranca.cliente}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-900">
                    {formatCurrency(valorCobranca)}
                  </p>
                  <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800">
                    {getCobrancaTipoLabel(cobranca.tipo_cobranca)}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-2 py-2 border-t border-b border-slate-100 text-xs">
                <div>
                  <span className="text-slate-500">OS Ideal: </span>
                  <span className="font-semibold text-slate-800">{cobranca.os_ideal || "-"}</span>
                </div>
                <div>
                  <span className="text-slate-500">Confirmado: </span>
                  <span className="font-semibold text-slate-800">{cobranca.confirmado ? "Sim" : "Não"}</span>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                <div>
                  {cobranca.status === "CANCELADO" ? (
                    <StatusBadge status="CANCELADO" />
                  ) : cobranca.confirmado ? (
                    <StatusBadge status="CONFIRMADO" />
                  ) : isCreditoPendente(cobranca) ? (
                    <StatusBadge status="AGUARDANDO_CREDITO" />
                  ) : cobranca.status === "A_VENCER" ? (
                    <StatusBadge status="A_VENCER" />
                  ) : (
                    <StatusBadge status="NAO_CONFIRMADO" />
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {isBoleto ? (
                    <>
                      {boletoUrl ? (
                        <a
                          href={boletoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center rounded-xl bg-teal-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-700 shadow-sm"
                        >
                          Abrir boleto
                        </a>
                      ) : (
                        <button
                          disabled
                          className="inline-flex items-center justify-center rounded-xl bg-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-400 cursor-not-allowed"
                        >
                          Indisponível
                        </button>
                      )}
                    </>
                  ) : isPix ? (
                    <>
                      {cobranca.url_cobranca && (
                        <a
                          href={cobranca.url_cobranca}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center rounded-xl border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-800 transition hover:bg-teal-100"
                        >
                          Checkout
                        </a>
                      )}
                    </>
                  ) : isCard ? (
                    <>
                      {cobranca.cartao_checkout_url ? (
                        <a
                          href={cobranca.cartao_checkout_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center rounded-xl bg-teal-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-700 shadow-sm"
                        >
                          Abrir checkout cartão
                        </a>
                      ) : cobranca.url_cobranca ? (
                        <a
                          href={cobranca.url_cobranca}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center rounded-xl border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-800 transition hover:bg-teal-100"
                        >
                          Escolher parcelas
                        </a>
                      ) : (
                        <button
                          disabled
                          className="inline-flex items-center justify-center rounded-xl bg-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-400 cursor-not-allowed"
                        >
                          Indisponível
                        </button>
                      )}
                    </>
                  ) : (
                    cobranca.url_cobranca && (
                      <a
                        href={cobranca.url_cobranca}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-xl border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-800 transition hover:bg-teal-100"
                      >
                        Checkout
                      </a>
                    )
                  )}
                  <Link
                    href={`/cobrancas/${cobranca.id}`}
                    className="inline-flex items-center justify-center rounded-xl bg-[#0b2f4a] px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-[#123f61]"
                  >
                    Ver
                  </Link>
                  <Link
                    href="/cobrancas"
                    className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Painel
                  </Link>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getValorCobranca(cobranca: Cobranca) {
  return cobranca.cartao_valor_final ?? cobranca.valor;
}



function getEmpresaIdByNome(nome: string | undefined): number {
  if (!nome) return 1;
  const normalized = nome.trim().toUpperCase();
  if (normalized.includes("IDEAL GRÁFICA") || normalized.includes("IDEAL GRAFICA") || normalized.includes("INGRESSO IDEAL")) {
    return 1;
  }
  if (normalized.includes("IDEAL BIRÔ") || normalized.includes("IDEAL BIRO") || normalized.includes("BIRO")) {
    return 2;
  }
  if (normalized.includes("E3 BRINDES") || normalized.includes("E3")) {
    return 3;
  }
  return 1; // Default
}
