"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, CreditCard, FileText, Package, Truck, Paperclip } from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { PropostaCobrancaPanel } from "@/features/cobrancas/PropostaCobrancaPanel";
import { useAuth } from "@/features/auth/AuthProvider";
import { getLiberacaoPedidoLabel, getLiberacaoPedidoStatus } from "@/features/cobrancas/cobrancas-utils";
import { SummaryCard } from "@/components/common/SummaryCard";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDate } from "@/lib/formatters/date";
import { formatWeightFromGrams } from "@/lib/formatters/weight";
import type { Proposta, PropostaStatus } from "@/features/orcamentos/types";
import { buildPropostaInformalText, getCobrancaLabel } from "@/features/orcamentos/orcamento-utils";
import { getClienteBonusPercent } from "@/features/orcamentos/orcamento-utils";

import { useOrcamentoDetail } from "@/features/orcamentos/hooks/useOrcamentoDetail";
import {
  gerarPDFProposta,
  duplicarProposta,
  registrarMensagemSistemaProposta,
  getPropostaChatResumos,
  loadChatReadInfo,
  type PropostaChatResumo
} from "@/features/orcamentos/services/orcamentos.service";
import { useGlobalChat } from "@/features/chat/context/GlobalChatContext";

type OrcamentoDetailPageProps = {
  idInt: number;
};

export function OrcamentoDetailPage({ idInt }: OrcamentoDetailPageProps) {
  const router = useRouter();
  const { showToast } = useAppToast();
  const { user } = useAuth();
  const { getCobrancasByProposta } = useCobrancas();
  const [isCobrancaModalOpen, setIsCobrancaModalOpen] = useState(false);
  const { openChat } = useGlobalChat();
  const { proposta, loading, error } = useOrcamentoDetail(idInt);
  const [chatResumo, setChatResumo] = useState<PropostaChatResumo | null>(null);

  const fetchChatResumo = useCallback(async () => {
    try {
      const freshReadInfo = loadChatReadInfo(user);
      const resMap = await getPropostaChatResumos([idInt], user?.id, freshReadInfo);
      if (resMap && resMap[idInt]) {
        setChatResumo(resMap[idInt]);
      } else {
        setChatResumo(null);
      }
    } catch (err) {
      console.error("[OrcamentoDetailPage] Erro ao buscar resumo do chat:", err);
    }
  }, [idInt, user]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const freshReadInfo = loadChatReadInfo(user);
        const resMap = await getPropostaChatResumos([idInt], user?.id, freshReadInfo);
        if (!active) return;
        if (resMap && resMap[idInt]) {
          setChatResumo(resMap[idInt]);
        } else {
          setChatResumo(null);
        }
      } catch (err) {
        console.error("[OrcamentoDetailPage] Erro ao buscar resumo do chat:", err);
      }
    })();
    return () => {
      active = false;
    };
  }, [idInt, user]);

  useEffect(() => {
    if (typeof window !== "undefined" && proposta) {
      const params = new URLSearchParams(window.location.search);
      if (params.get("chat") === "open") {
        openChat(proposta.id_int, {
          clienteNome: proposta.cliente?.nome,
          idCliente: proposta.cliente?.idCliente,
          onMessagesUpdated: (summary) => setChatResumo(summary),
          onClose: () => {
            void fetchChatResumo();
          }
        });
        const newUrl = window.location.pathname;
        window.history.replaceState({}, "", newUrl);
      }
    }
  }, [proposta, openChat, fetchChatResumo]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center space-y-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#0b2f4a] border-t-transparent mx-auto"></div>
          <p className="text-slate-500 font-semibold text-sm">Carregando detalhes do orçamento...</p>
        </div>
      </div>
    );
  }

  if (error || !proposta) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-center max-w-lg mx-auto mt-12 space-y-4">
        <h2 className="text-lg font-bold text-red-800">Falha ao carregar orçamento</h2>
        <p className="text-sm text-red-600">{error || "Não foi possível encontrar a proposta solicitada."}</p>
        <div className="pt-2">
          <Link
            href="/orcamentos"
            className="inline-flex items-center gap-2 rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para a lista
          </Link>
        </div>
      </div>
    );
  }

  const isClienteNaoCadastrado = proposta.clienteNaoCadastrado || proposta.cliente.idCliente === null || proposta.cliente.idCliente === undefined || Number(proposta.cliente.idCliente) === 0;
  const freteEscolhido = proposta.fretes.find((frete) => frete.id === proposta.freteEscolhidoId);
  const cobrancasDaProposta = getCobrancasByProposta(proposta.id_int);
  const cobrancasAtivas = cobrancasDaProposta.filter((item) => item.status !== "CANCELADO");
  const totalCobradoReal = cobrancasAtivas.reduce((total, item) => total + (item.cartao_valor_final ?? item.valor), 0);
  const totalPropostaRounded = Math.round(proposta.resumo.valorTotal * 100) / 100;
  const totalCobradoRealRounded = Math.round(totalCobradoReal * 100) / 100;
  const saldoRestante = Math.max(totalPropostaRounded - totalCobradoRealRounded, 0);

  const liberacaoFinanceira = getLiberacaoPedidoLabel(getLiberacaoPedidoStatus(cobrancasDaProposta));
  const informalText = buildPropostaInformalText({
    id_int: proposta.id_int,
    clienteNome: proposta.cliente.nome,
    itens: proposta.itens,
    frete: freteEscolhido,
    resumo: proposta.resumo,
    formaPagamento: proposta.formaPagamento
  });

  async function copyInformal() {
    await navigator.clipboard?.writeText(informalText);
    showToast({ type: "success", title: "Resumo copiado", description: "Proposta informal copiada para WhatsApp." });
  }

  async function handleGerarPDF() {
    if (!proposta) return;
    const isUnregistered = proposta.clienteNaoCadastrado || proposta.cliente.idCliente === null || proposta.cliente.idCliente === undefined || Number(proposta.cliente.idCliente) === 0;
    if (isUnregistered) {
      showToast({
        type: "warning",
        title: "Geração de PDF bloqueada",
        description: "Para gerar PDF, primeiro cadastre ou vincule um cliente à proposta."
      });
      return;
    }

    const empresaLower = (proposta.empresa || "").toLowerCase();
    let idEmpresa: number | null = null;
    if (empresaLower.includes("grafica") || empresaLower.includes("ingresso")) {
      idEmpresa = 1;
    } else if (empresaLower.includes("biro")) {
      idEmpresa = 2;
    } else if (empresaLower.includes("e3") || empresaLower.includes("brindes")) {
      idEmpresa = 3;
    }

    if (idEmpresa === null) {
      showToast({
        type: "error",
        title: "Empresa inválida",
        description: "A empresa selecionada para a proposta não é suportada para geração de PDF (use Ideal Grafica, Ideal Biro ou E3 Brindes)."
      });
      return;
    }

    showToast({
      type: "info",
      title: "Gerando PDF",
      description: "Aguarde enquanto geramos o PDF da proposta comercial..."
    });

    try {
      const res = await gerarPDFProposta(proposta.id_int, idEmpresa);
      if (res.success && res.url) {
        window.open(res.url, "_blank");
        showToast({
          type: "success",
          title: "PDF Gerado",
          description: "O PDF da proposta foi aberto em uma nova aba."
        });
        void fetchChatResumo();
      } else {
        showToast({
          type: "error",
          title: "Falha na geração",
          description: "Não foi possível gerar o PDF da proposta."
        });
        console.error("[Edge Function Error] Falha ao gerar PDF da proposta:", res.errorMessage);
      }
    } catch (err) {
      showToast({
        type: "error",
        title: "Erro inesperado",
        description: "Ocorreu um erro ao tentar gerar o PDF."
      });
      console.error("[PDF Error] Erro ao chamar Edge Function:", err);
    }
  }

  async function handleDuplicarProposta() {
    if (!proposta) return;
    const ok = window.confirm("Deseja realmente duplicar esta proposta?");
    if (!ok) return;

    showToast({
      type: "info",
      title: "Duplicando proposta",
      description: "Aguarde enquanto a proposta é duplicada..."
    });

    try {
      const res = await duplicarProposta(proposta.id_int);
      if (res.success && res.novoIdInt) {
        showToast({
          type: "success",
          title: "Proposta duplicada",
          description: "Proposta duplicada com sucesso. Redirecionando..."
        });
        window.setTimeout(() => {
          router.push(`/orcamentos/${res.novoIdInt}/editar`);
        }, 1200);
      } else {
        showToast({
          type: "error",
          title: "Erro ao duplicar",
          description: res.errorMessage || "Não foi possível duplicar a proposta."
        });
      }
    } catch (err) {
      console.error("[Duplicação] Erro:", err);
      showToast({
        type: "error",
        title: "Erro inesperado",
        description: "Ocorreu um erro interno ao tentar duplicar."
      });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/orcamentos" className="inline-flex items-center gap-2 rounded-2xl border border-[#d7e5e8] bg-white px-3 py-2 text-sm font-semibold text-[#0b2f4a] shadow-sm transition hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" />
          Voltar para orcamentos
        </Link>
      </div>

      <PageHeader
        title={`Proposta #${proposta.id_int}`}
        subtitle={`${proposta.cliente.nome}${isClienteNaoCadastrado ? " (Sem cadastro)" : ""} - ${proposta.empresa} - ${formatDate(proposta.data)}`}
        context="Detalhe da proposta"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {saldoRestante > 0 && !isClienteNaoCadastrado && (
              <button
                type="button"
                onClick={() => setIsCobrancaModalOpen(true)}
                className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
              >
                Gerar cobrança
              </button>
            )}
            <StatusBadge status={proposta.status} tone={getStatusTone(proposta.status)} />
            <ActionsMenu
              items={[
                {
                  label: "Editar proposta",
                  onClick: () => router.push(`/orcamentos/${proposta.id_int}/editar`),
                  disabled: cobrancasDaProposta.length > 0
                },
                {
                  label: chatResumo && chatResumo.total_mensagens > 0
                    ? `Ver chat interno (${chatResumo.total_mensagens})`
                    : "Ver chat interno",
                  onClick: () => {
                    openChat(proposta.id_int, {
                      clienteNome: proposta.cliente?.nome,
                      idCliente: proposta.cliente?.idCliente,
                      onMessagesUpdated: (summary) => setChatResumo(summary),
                      onClose: () => {
                        void fetchChatResumo();
                      }
                    });
                  }
                },
                { label: "Duplicar proposta", onClick: () => void handleDuplicarProposta() },
                { label: "Copiar proposta informal", onClick: () => void copyInformal() },
                { label: "Gerar PDF da proposta", onClick: () => void handleGerarPDF() },
                ...(saldoRestante > 0 && !isClienteNaoCadastrado ? [{ label: "Gerar cobranca", onClick: () => setIsCobrancaModalOpen(true) }] : []),
                {
                  label: "Cancelar proposta",
                  destructive: true,
                  onClick: () => {
                    showToast({
                      type: "warning",
                      title: "Cancelamento da proposta",
                      description: "O cancelamento da proposta foi solicitado."
                    });
                    void registrarMensagemSistemaProposta({
                      idInt: proposta.id_int,
                      idCliente: proposta.cliente?.idCliente,
                      mensagem: "Proposta cancelada.",
                      setor: "Comercial"
                    }).catch((err) => console.warn("[Cancel Proposta Timeline Error]", err));
                  }
                }
              ]}
            />
          </div>
        }
      />

      {cobrancasDaProposta.length > 0 && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-800 shadow-sm flex flex-col gap-1.5">
          <h2 className="font-semibold text-base">Edição Bloqueada</h2>
          <p className="text-sm font-semibold text-amber-700">
            Esta proposta possui cobrança gerada. Para alterar, exclua primeiro a cobrança pendente.
          </p>
        </div>
      )}

      {proposta.cliente.restricao ? (
        <div className="rounded-3xl border border-orange-200 bg-orange-50 p-5 text-orange-800">
          <h2 className="font-semibold">Cliente com restricao</h2>
          <p className="mt-1 text-sm">Revise credito, documento e observacoes antes de gerar cobranca ou aprovar esta proposta.</p>
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Subtotal produtos" value={formatCurrency(proposta.resumo.subtotalProdutos)} description="Soma dos itens da proposta." tone="info" icon={Package} />
        <SummaryCard title="Frete escolhido" value={formatCurrency(proposta.resumo.frete)} description={freteEscolhido ? `${freteEscolhido.transportadora} - ${freteEscolhido.prazo}` : "Frete nao definido."} tone="warning" icon={Truck} />
        <SummaryCard title="Total final" value={formatCurrency(proposta.resumo.valorTotal)} description={`Pagamento: ${proposta.formaPagamento}.`} tone="success" icon={FileText} />
        <SummaryCard
          title="Cobranças"
          value={cobrancasAtivas.length ? `${cobrancasAtivas.length} gerada(s)` : getCobrancaLabel(proposta.cobrancaStatus)}
          description={
            cobrancasAtivas.length
              ? `${formatCurrency(totalCobradoReal)} • ${liberacaoFinanceira}.`
              : "Criação principal acontece dentro desta proposta; conferência fica no módulo financeiro."
          }
          tone="neutral"
          icon={CreditCard}
        />
      </section>

      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-2 shadow-sm">
        <div className="flex gap-2 overflow-x-auto">
          <button
            type="button"
            className="shrink-0 rounded-2xl px-4 py-2.5 text-sm font-semibold bg-[#0b2f4a] text-white transition"
          >
            Detalhes da proposta
          </button>
          <button
            type="button"
            onClick={() => {
              openChat(proposta.id_int, {
                clienteNome: proposta.cliente?.nome,
                idCliente: proposta.cliente?.idCliente,
                onMessagesUpdated: (summary) => setChatResumo(summary),
                onClose: () => {
                  void fetchChatResumo();
                }
              });
            }}
            className={`shrink-0 rounded-2xl px-4 py-2.5 text-sm font-semibold transition flex items-center gap-1.5 ${
              chatResumo?.has_recusado
                ? "text-red-700 bg-red-50 hover:bg-red-100 border border-red-200"
                : chatResumo?.has_pendente
                ? "text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200"
                : chatResumo && chatResumo.nao_lidas_count > 0
                ? "text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200"
                : "text-slate-600 hover:bg-slate-50"
            }`}
            title={chatResumo ? `Chat interno (${chatResumo.nao_lidas_count} não lidas de ${chatResumo.total_mensagens} total)` : "Chat interno"}
          >
            <span>Chat interno</span>
            {chatResumo && chatResumo.nao_lidas_count > 0 && (
              <span className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[9px] font-extrabold leading-none ${
                chatResumo.has_recusado
                  ? "bg-red-600 text-white"
                  : chatResumo.has_pendente
                  ? "bg-amber-600 text-white"
                  : "bg-blue-600 text-white"
              }`}>
                {chatResumo.nao_lidas_count}
              </span>
            )}
            {chatResumo && chatResumo.total_anexos > 0 && (
              <span className="inline-flex items-center text-slate-400" title={`${chatResumo.total_anexos} anexo(s)`}>
                <Paperclip className="h-3.5 w-3.5" />
              </span>
            )}
          </button>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <DetailCard title={isClienteNaoCadastrado ? "Cliente e entrega (Sem cadastro)" : "Cliente, contato e entrega"}>
            <div className="grid gap-3 md:grid-cols-2">
              {isClienteNaoCadastrado ? (
                <>
                  <InfoBox label="Cliente" value={proposta.cliente.nome} detail="Orçamento rápido (sem cadastro)" />
                  <InfoBox label="Vendedor responsável" value={proposta.vendedor} detail="ERP Ideal" />
                  <InfoBox label="CEP de entrega" value={proposta.enderecoEntrega.cep} detail="Logística rápida" />
                </>
              ) : (
                <>
                  <InfoBox label="Cliente" value={`${proposta.cliente.nome} (#${proposta.cliente.idCliente})`} detail={proposta.cliente.documento} />
                  <InfoBox label="Contato responsavel" value={proposta.contato.nome} detail={`${proposta.contato.whatsapp} - ${proposta.contato.email}`} />
                  <InfoBox label="Endereco de entrega" value={`${proposta.enderecoEntrega.endereco}, ${proposta.enderecoEntrega.numero}`} detail={`${proposta.enderecoEntrega.cidade}/${proposta.enderecoEntrega.uf} - CEP ${proposta.enderecoEntrega.cep}`} />
                  <InfoBox label="Comprador / autorizado" value={proposta.compradorAutorizado?.nome ?? "Cliente principal"} detail={proposta.compradorAutorizado?.tipoRelacao ?? "Sem vinculo comercial selecionado"} />
                </>
              )}
            </div>
          </DetailCard>

          <DetailCard title="Produtos da proposta">
            <div className="space-y-4">
              {proposta.itens.map((item) => (
                <div key={item.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="grid gap-3 lg:grid-cols-[1fr_110px_130px_130px] lg:items-start">
                    <div>
                      <p className="font-semibold text-slate-950">#{item.id_produto} - {item.nome}</p>
                      <p className="mt-1 text-sm text-slate-500">{item.formato} | {item.descricaoModelo}</p>
                    </div>
                    <InfoPill label="Qtd." value={item.quantidade.toLocaleString("pt-BR")} />
                    <InfoPill label="Prazo" value={item.prazo} />
                    <InfoPill label="Subtotal" value={formatCurrency(item.subtotal)} />
                  </div>
                  {item.variacoesEscolhidas.length ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {item.variacoesEscolhidas.map((escolha) => (
                        <span key={escolha.id} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                          {escolha.variacao.nome}: {escolha.tipo.variacao} (+{formatCurrency(escolha.tipo.v_extra)} / {formatWeightFromGrams(escolha.tipo.peso, { mode: "g" })})
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </DetailCard>

          <DetailCard title="Fretes disponiveis">
            <div className="grid gap-3 md:grid-cols-2">
              {proposta.fretes.map((frete) => (
                <div key={frete.id} className={`rounded-3xl border p-4 ${frete.escolhido ? "border-teal-200 bg-teal-50" : "border-slate-200 bg-slate-50"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-950">{frete.transportadora}</p>
                      <p className="text-sm text-slate-500">{frete.servico} - {frete.prazo}</p>
                    </div>
                    {frete.escolhido ? <StatusBadge status="ESCOLHIDO" tone="success" /> : null}
                  </div>
                  <p className="mt-3 text-lg font-bold text-slate-950">{formatCurrency(frete.valor)}</p>
                  <p className="mt-1 text-sm text-slate-500">{frete.observacao}</p>
                </div>
              ))}
            </div>
          </DetailCard>
        </div>

        <div className="space-y-6">
          <DetailCard title="Resumo de valores">
            <ResumoValores proposta={proposta} />
          </DetailCard>

          <DetailCard title="Proposta informal">
            <textarea readOnly value={informalText} className="min-h-72 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 outline-none" />
            <button type="button" onClick={copyInformal} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0b2f4a] px-4 py-3 text-sm font-semibold text-white">
              <Copy className="h-4 w-4" />
              Copiar resumo para WhatsApp
            </button>
          </DetailCard>
        </div>
      </section>

      <PropostaCobrancaPanel
        proposta={proposta}
        isModalOpen={isCobrancaModalOpen}
        onOpenModal={() => setIsCobrancaModalOpen(true)}
        onCloseModal={() => setIsCobrancaModalOpen(false)}
      />
    </div>
  );
}

function DetailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function InfoBox({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function ResumoValores({ proposta }: { proposta: Proposta }) {
  const bonusPercent = proposta.cliente ? getClienteBonusPercent(proposta.cliente) : 0;
  const rows = [
    ["Subtotal bruto", formatCurrency(proposta.resumo.subtotalBrutoProdutos)],
    ["Descontos individuais", `-${formatCurrency(proposta.resumo.descontosIndividuais)}`],
    [`Tabela especial do cliente aplicada${bonusPercent > 0 ? ` (-${bonusPercent}%)` : ""}`, `-${formatCurrency(proposta.resumo.acrescimoBonus)}`],
    ["Subtotal produtos", formatCurrency(proposta.resumo.subtotalProdutos)],
    ["Desconto geral", `-${formatCurrency(proposta.resumo.descontoGeral)}`],
    ["Frete", formatCurrency(proposta.resumo.frete)],
    ["Peso total", formatWeightFromGrams(proposta.resumo.pesoTotal)],
    ["Prazo de produção", proposta.resumo.prazoProducao],
    ["Prazo de entrega", proposta.resumo.prazoEntrega]
  ];

  return (
    <div className="space-y-3">
      {rows.map(([label, value]) => {
        const isDiscount = value.startsWith("-");
        const valueClass = isDiscount ? "text-teal-600 font-medium" : "text-slate-900";
        return (
          <div key={label} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-500">{label}</span>
            <strong className={`text-right ${valueClass}`}>{value}</strong>
          </div>
        );
      })}
      <div className="border-t border-slate-200 pt-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-slate-600">Total final</span>
          <strong className="text-xl text-[#0b2f4a] font-extrabold">{formatCurrency(proposta.resumo.valorTotal)}</strong>
        </div>
      </div>
    </div>
  );
}

function getStatusTone(status: PropostaStatus) {
  if (status === "APROVADO") return "success";
  if (status === "AGUARDANDO") return "warning";
  if (status === "CANCELADO") return "neutral";
  return "info";
}
