"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CreditCard, FileText, Search, WalletCards, MessageSquare, Paperclip } from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { StatusBadge } from "@/components/common/StatusBadge";
import { SummaryCard } from "@/components/common/SummaryCard";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDateTime } from "@/lib/formatters/date";
import { buildPropostaInformalText } from "@/features/orcamentos/orcamento-utils";
import { useOrcamentosReadOnlyData } from "@/features/orcamentos/hooks/useOrcamentosReadOnlyData";
import type { OrcamentoListItem } from "@/features/orcamentos/mappers";
import {
  gerarPDFProposta,
  duplicarProposta,
  getPropostaChatResumos,
  loadChatReadInfo,
  getPropostaDetailById,
  updatePropostaStatusInterno,
  liberarPropostaParaProducao,
  retirarPropostaDaProducao,
  type PropostaChatResumo
} from "@/features/orcamentos/services/orcamentos.service";
import { useGlobalChat } from "@/features/chat/context/GlobalChatContext";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { PropostaCobrancaPanel } from "@/features/cobrancas/PropostaCobrancaPanel";
import { LiberarProducaoModal } from "@/features/orcamentos/components/LiberarProducaoModal";
import type { Proposta } from "@/features/orcamentos/types";


const filterClass = "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none";
const defaultStatusOrder = [
  "NOVO", 
  "AGUARDANDO", 
  "AGUARDANDO / PENDENTE",
  "EM ARTE",
  "LIBERADO", 
  "REVISAO ATENDENTE", 
  "REVISAO PRODUCAO",
  "EM PRODUCAO", 
  "EM IMPRESSAO", 
  "EM ACABAMENTO", 
  "EXPEDICAO", 
  "A RETIRAR", 
  "EM TRANSITO", 
  "ENTREGUE", 
  "CANCELADO"
];

function normalize(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function getSearchableProposalText(item: OrcamentoListItem) {
  return normalize(
    [
      item.id_int,
      item.clienteId,
      item.clienteNome,
      item.documento,
      item.vendedor,
      item.statusLabel,
      item.tipoCobrancaLabel,
      item.modelo,
      item.createdAt,
      item.osIdeal,
      formatCurrency(item.total)
    ]
      .map((value) => String(value ?? ""))
      .join(" ")
  );
}

function getSearchableProposalDigits(item: OrcamentoListItem) {
  return [
    item.id_int,
    item.clienteId,
    item.documento,
    item.total,
    item.osIdeal
  ]
    .map((value) => onlyDigits(value))
    .join(" ");
}

function getMonthKeyFromDate(value: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit"
  }).format(value);
}

function getMonthKeyFromIso(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? getMonthKeyFromDate(date) : "";
}

function getPeriodKeyFromProposal(item: OrcamentoListItem) {
  return item.periodoKey || getMonthKeyFromIso(item.createdAt) || "";
}

type PeriodOption = {
  value: string;
  label: string;
};

function formatPeriodLabel(date: Date) {
  const monthLabel = new Intl.DateTimeFormat("pt-BR", {
    month: "short"
  })
    .format(date)
    .replace(".", "");

  const formattedMonth = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
  const year = String(date.getFullYear()).slice(2);

  return `${formattedMonth}/${year}`;
}

function getPeriodValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function buildLastSixPeriodOptions() {
  const today = new Date();
  const periods = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() - index, 1);

    return {
      label: formatPeriodLabel(date),
      value: getPeriodValue(date)
    } satisfies PeriodOption;
  });

  return periods satisfies PeriodOption[];
}

function getSelectedPeriodLabel(periodo: string, periodOptions: PeriodOption[]) {
  return periodOptions.find((option) => option.value === periodo)?.label ?? "período selecionado";
}

function normalizeProposalStatus(status: string | null | undefined) {
  // Retained for fallback but we shouldn't rely on it for logic.
  // The mappers.ts now handles it correctly, so we'll just return the upper case.
  return String(status ?? "").trim().toUpperCase() || "SEM_STATUS";
}

function isEmAbertoStatus(status: string | null | undefined) {
  const s = normalizeProposalStatus(status);
  return ["NOVO", "NOVO / EM ARTE", "SEM_STATUS"].includes(s);
}

function isAguardandoStatus(status: string | null | undefined) {
  const s = normalizeProposalStatus(status);
  return ["AGUARDANDO", "AGUARDANDO / EM ARTE", "AGUARDANDO / PENDENTE"].includes(s);
}

function isAprovadaStatus(status: string | null | undefined) {
  const s = normalizeProposalStatus(status);
  // Reúne as aprovadas, liberadas e em revisão antes da fábrica rodar pesado
  // Conservador: Inclui produção e expedição para que o valor total aprovado daquele mês
  // não diminua quando a proposta entra na fábrica.
  const isAprov = ["LIBERADO", "LIBERADO / EM ARTE", "REVISAO ATENDENTE", "REVISAO PRODUCAO"].includes(s);
  return isAprov || isProducaoExpedicaoStatus(status);
}

function isProducaoExpedicaoStatus(status: string | null | undefined) {
  const s = normalizeProposalStatus(status);
  return [
    "EM PRODUCAO", "EM IMPRESSAO", "EM ACABAMENTO", 
    "EXPEDICAO", "A RETIRAR", "EM TRANSITO", "ENTREGUE"
  ].includes(s);
}

function sumPropostaTotal(items: OrcamentoListItem[]) {
  return items.reduce((acc, item) => acc + (Number(item.total) || 0), 0);
}

function getStatusTone(status: string) {
  const normalized = normalize(status);
  if (normalized.includes("aprov") || normalized.includes("liberad")) return "success";
  if (normalized.includes("aguard") || normalized.includes("pend")) return "warning";
  if (normalized.includes("cancel")) return "neutral";
  return "info";
}

export function OrcamentosListPageReal() {
  const router = useRouter();
  const { showToast } = useAppToast();
  const { user } = useAuth();
  const { getCobrancasByProposta } = useCobrancas();

  const canCancelarProposta = Boolean(
    user?.isSuperAdmin ||
    user?.isAdmin ||
    hasPermissao(user, "propostas.cancelar")
  );

  useEffect(() => {
    if (user) {
      console.log("[Auditoria Homologação Fase 4.1] Listagem de Propostas:", {
        usuario: user.email || user.name || `ID: ${user.id}`,
        acao: "visualizar_botao_cancelamento_listagem",
        permissaoAvaliada: "propostas.cancelar",
        resultado: canCancelarProposta
      });
    }
  }, [user, canCancelarProposta]);
  const [selectedPropostaForCobranca, setSelectedPropostaForCobranca] = useState<Proposta | null>(null);
  const [isCobrancaModalOpen, setIsCobrancaModalOpen] = useState(false);
  const [isLoadingCobrancaProposta, setIsLoadingCobrancaProposta] = useState(false);

  const [isLiberarModalOpen, setIsLiberarModalOpen] = useState(false);
  const [selectedPropostaForLiberar, setSelectedPropostaForLiberar] = useState<OrcamentoListItem | null>(null);
  const [isLiberarSubmitting, setIsLiberarSubmitting] = useState(false);

  const periodOptions = buildLastSixPeriodOptions();
  const [periodo, setPeriodo] = useState(periodOptions[0]?.value ?? getPeriodValue(new Date()));
  const { propostas, source, warnings, detectedColumns, loadedCount, isLoading, errorMessage, triggerRefresh } = useOrcamentosReadOnlyData(periodo);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("TODOS");
  const [modelo, setModelo] = useState("TODOS_MODELOS");
  const [vendedor, setVendedor] = useState("TODOS");
  const [filterTipoCobranca, setFilterTipoCobranca] = useState("TODOS");
  const [filterAvulso, setFilterAvulso] = useState<"TODOS" | "PEDIDOS" | "ORCAMENTOS">("TODOS");
  const [chatResumos, setChatResumos] = useState<Record<number, PropostaChatResumo>>({});

  const { openChat } = useGlobalChat();

  function handleOpenChat(item: OrcamentoListItem) {
    openChat(item.id_int, {
      clienteNome: item.clienteNome,
      idCliente: item.clienteId,
      onMessagesUpdated: (summary) => {
        setChatResumos((prev) => ({
          ...prev,
          [summary.id_int]: summary
        }));
      },
      onClose: async () => {
        try {
          const freshReadInfo = loadChatReadInfo(user);
          const singleRes = await getPropostaChatResumos([item.id_int], user?.id, freshReadInfo);
          if (singleRes && singleRes[item.id_int]) {
            setChatResumos((prev) => ({
              ...prev,
              [item.id_int]: singleRes[item.id_int]
            }));
          }
        } catch (err) {
          console.error("[OrcamentosListPageReal] Erro ao carregar resumo unitário pós-fechamento:", err);
        }
      }
    });
  }

  const statusOptions = useMemo(() => {
    const values = Array.from(new Set(propostas.map((item) => {
      if (item.status && item.status.includes("EM ARTE")) {
        return "EM ARTE";
      }
      return item.status;
    }))).filter(Boolean);
    
    const ordered = values.sort((a, b) => {
      const indexA = defaultStatusOrder.indexOf(a as string);
      const indexB = defaultStatusOrder.indexOf(b as string);
      if (indexA === -1 && indexB === -1) return (a as string).localeCompare(b as string, "pt-BR");
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });

    return ["TODOS", ...ordered];
  }, [propostas]);

  const vendedorOptions = useMemo(
    () => Array.from(new Set(propostas.map((item) => item.vendedor).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [propostas]
  );

  const modeloOptions = useMemo(
    () => [
      { value: "TODOS_MODELOS", label: "Todos modelos" },
      { value: "AVULSO", label: "AVULSO" },
      { value: "PROPOSTA", label: "PROPOSTA" }
    ],
    []
  );

  const filteredPropostas = useMemo(() => {
    const normalizedSearch = normalize(search.trim());
    const digitsSearch = onlyDigits(search);

    return propostas.filter((item) => {
      const searchableText = getSearchableProposalText(item);
      const searchableDigits = getSearchableProposalDigits(item);
      const matchesSearch =
        !normalizedSearch && !digitsSearch
          ? true
          : (normalizedSearch && searchableText.includes(normalizedSearch)) ||
            (digitsSearch && searchableDigits.includes(digitsSearch));
      const matchesStatus = status === "TODOS" || (status === "EM ARTE" ? item.status?.includes("EM ARTE") : item.status === status);
      const matchesModelo =
        modelo === "TODOS_MODELOS" ||
        (modelo === "AVULSO" ? item.isAvulsoRaw === true : item.isAvulsoRaw !== true);
      const matchesVendedor = vendedor === "TODOS" || item.vendedor === vendedor;
      const matchesPeriodo =
        periodo === "all" ||
        (() => {
          const target = new Date(item.createdAt);
          const [y, m] = periodo.split("-").map(Number);
          return target.getFullYear() === y && target.getMonth() + 1 === m;
        })();

      let matchesAvulso = true;
      if (filterAvulso === "PEDIDOS") matchesAvulso = !item.isAvulsoRaw;
      if (filterAvulso === "ORCAMENTOS") matchesAvulso = !!item.isAvulsoRaw;

      let matchesTipoCobranca = true;
      if (filterTipoCobranca !== "TODOS") {
        const hasCartao = filterTipoCobranca === "CARTAO";
        matchesTipoCobranca = item.tiposCobranca.some(t => {
          const upper = t.trim().toUpperCase();
          if (hasCartao) {
            return upper.includes("CARD") || upper.includes("CARTAO") || upper.includes("CARTÃO");
          }
          return upper === filterTipoCobranca;
        });
      }

      return matchesSearch && matchesStatus && matchesModelo && matchesVendedor && matchesPeriodo && matchesAvulso && matchesTipoCobranca;
    }).sort((a, b) => {
      const dateA = new Date(a.updatedAt || a.createdAt).getTime();
      const dateB = new Date(b.updatedAt || b.createdAt).getTime();
      return dateB - dateA;
    });
  }, [modelo, periodo, propostas, search, status, vendedor, filterAvulso, filterTipoCobranca]);

  // Identify visible/rendered proposal IDs (up to 100) to batch query summaries
  const visibleIdInts = useMemo(() => {
    return filteredPropostas.slice(0, 100).map((p) => p.id_int);
  }, [filteredPropostas]);

  useEffect(() => {
    if (visibleIdInts.length === 0) return;
    let active = true;
    void (async () => {
      try {
        const freshReadInfo = loadChatReadInfo(user);
        const resMap = await getPropostaChatResumos(visibleIdInts, user?.id, freshReadInfo);
        if (!active) return;
        setChatResumos((prev) => ({ ...prev, ...resMap }));
      } catch (err) {
        console.error("[OrcamentosListPageReal] Erro ao buscar resumos do chat em lote:", err);
      }
    })();
    return () => {
      active = false;
    };
  }, [visibleIdInts, user]);

  const periodoSelecionadoLabel = useMemo(() => getSelectedPeriodLabel(periodo, periodOptions), [periodOptions, periodo]);
  const emAbertoItens = useMemo(
    () => propostas.filter((item) => isEmAbertoStatus(item.statusInterno)),
    [propostas]
  );
  const aprovadasItens = useMemo(
    () => propostas.filter((item) => isAprovadaStatus(item.statusInterno)),
    [propostas]
  );
  const aguardandoItens = useMemo(
    () => propostas.filter((item) => isAguardandoStatus(item.statusInterno)),
    [propostas]
  );
  const emAbertoResumo = useMemo(
    () => ({
      quantidade: emAbertoItens.length,
      total: sumPropostaTotal(emAbertoItens)
    }),
    [emAbertoItens]
  );
  const pedidosItens = useMemo(
    () => propostas.filter((item) => !item.isAvulsoRaw),
    [propostas]
  );
  const orcamentosItens = useMemo(
    () => propostas.filter((item) => item.isAvulsoRaw),
    [propostas]
  );
  const pedidosResumo = useMemo(
    () => ({
      quantidade: pedidosItens.length,
      total: sumPropostaTotal(pedidosItens)
    }),
    [pedidosItens]
  );
  const orcamentosResumo = useMemo(
    () => ({
      quantidade: orcamentosItens.length,
      total: sumPropostaTotal(orcamentosItens)
    }),
    [orcamentosItens]
  );
  const aprovadasResumo = useMemo(
    () => ({
      quantidade: aprovadasItens.length,
      total: sumPropostaTotal(aprovadasItens)
    }),
    [aprovadasItens]
  );
  const aguardandoResumo = useMemo(
    () => ({
      quantidade: aguardandoItens.length,
      total: sumPropostaTotal(aguardandoItens)
    }),
    [aguardandoItens]
  );

  useEffect(() => {
    console.info("[Orcamentos][ReadOnly]", {
      source,
      loadedCount,
      warnings,
      detectedColumns: detectedColumns.slice(0, 20)
    });
  }, [detectedColumns, loadedCount, source, warnings]);



  async function handleGerarPDFForListItem(item: OrcamentoListItem) {
    const isUnregistered = !item.clienteId || item.clienteId === "0" || item.clienteId === "null";
    if (isUnregistered) {
      showToast({
        type: "warning",
        title: "Geração de PDF bloqueada",
        description: "Para gerar PDF, primeiro cadastre ou vincule um cliente à proposta."
      });
      return;
    }

    const labelLower = (item.empresaLabel || "").toLowerCase();
    let idEmpresa: number | null = null;
    if (labelLower.includes("grafica") || labelLower.includes("ingresso")) {
      idEmpresa = 1;
    } else if (labelLower.includes("biro")) {
      idEmpresa = 2;
    } else if (labelLower.includes("e3") || labelLower.includes("brindes")) {
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
      const res = await gerarPDFProposta(item.id_int, idEmpresa);
      if (res.success && res.url) {
        window.open(res.url, "_blank");
        showToast({
          type: "success",
          title: "PDF Gerado",
          description: "O PDF da proposta foi aberto em uma nova aba."
        });
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

  async function handleDuplicarPropostaForListItem(item: OrcamentoListItem) {
    const ok = window.confirm(`Deseja realmente duplicar a proposta #${item.id_int}?`);
    if (!ok) return;

    showToast({
      type: "info",
      title: "Duplicando proposta",
      description: "Aguarde enquanto a proposta é duplicada..."
    });

    try {
      const res = await duplicarProposta(item.id_int);
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
        description: "Ocorreu um erro ao tentar duplicar."
      });
    }
  }

  async function handleOpenCobrancaModal(item: OrcamentoListItem) {
    if (isLoadingCobrancaProposta) return;
    setIsLoadingCobrancaProposta(true);
    showToast({
      type: "info",
      title: "Carregando proposta",
      description: "Aguarde enquanto os dados da proposta são carregados..."
    });

    try {
      const data = await getPropostaDetailById(item.id_int);
      if (data) {
        // Calculate saldoRestante using the exact same rule as PropostaCobrancaPanel:
        const cobrancasDaProposta = getCobrancasByProposta(item.id_int);
        const cobrancasAtivas = cobrancasDaProposta.filter((c) => c.status !== "CANCELADO");
        const totalCobradoReal = cobrancasAtivas.reduce((total, c) => total + (c.cartao_valor_final ?? c.valor), 0);
        const totalPropostaRounded = Math.round(data.resumo.valorTotal * 100) / 100;
        const totalCobradoRealRounded = Math.round(totalCobradoReal * 100) / 100;
        const saldoRestante = totalPropostaRounded - totalCobradoRealRounded;

        if (saldoRestante <= 0) {
          showToast({
            type: "warning",
            title: "Ação bloqueada",
            description: "Esta proposta já foi totalmente cobrada (saldo restante é R$ 0,00)."
          });
          return;
        }

        setSelectedPropostaForCobranca(data);
        setIsCobrancaModalOpen(true);
      } else {
        throw new Error("Proposta não encontrada.");
      }
    } catch (err) {
      console.error("[OrcamentosListPageReal] Error loading proposal for cobranca:", err);
      showToast({
        type: "error",
        title: "Erro ao carregar proposta",
        description: err instanceof Error ? err.message : "Não foi possível carregar os detalhes."
      });
    } finally {
      setIsLoadingCobrancaProposta(false);
    }
  }

  async function handleLiberarProducao(item: OrcamentoListItem) {
    setSelectedPropostaForLiberar(item);
    setIsLiberarModalOpen(true);
  }

  async function confirmLiberarProducao() {
    if (!selectedPropostaForLiberar) return;

    setIsLiberarSubmitting(true);
    showToast({
      type: "info",
      title: "Liberando para produção...",
      description: "Aguarde a validação das regras."
    });

    try {
      const res = await liberarPropostaParaProducao(selectedPropostaForLiberar.id_int);
      if (res.success) {
        showToast({
          type: "success",
          title: "Proposta liberada",
          description: "A proposta agora está na lista de Produção/Pedidos."
        });
        setIsLiberarModalOpen(false);
        setSelectedPropostaForLiberar(null);
        triggerRefresh();
      } else {
        throw new Error(res.errorMessage || "Erro desconhecido.");
      }
    } catch (err) {
      console.error("[OrcamentosListPageReal] Error sending to production:", err);
      showToast({
        type: "error",
        title: "Erro de Validação",
        description: err instanceof Error ? err.message : "Não foi possível enviar para produção."
      });
    } finally {
      setIsLiberarSubmitting(false);
    }
  }

  async function handleRetirarProducao(item: OrcamentoListItem) {
    const ok = window.confirm(`Deseja RETIRAR a proposta #${item.id_int} da fila de produção?`);
    if (!ok) return;

    showToast({
      type: "info",
      title: "Atualizando status",
      description: "Aguarde..."
    });

    try {
      const res = await retirarPropostaDaProducao(item.id_int);
      if (res.success) {
        showToast({
          type: "success",
          title: "Proposta retirada",
          description: "A proposta foi retirada da lista de Produção."
        });
        triggerRefresh();
      } else {
        throw new Error(res.errorMessage || "Erro desconhecido.");
      }
    } catch (err) {
      console.error("[OrcamentosListPageReal] Error removing from production:", err);
      showToast({
        type: "error",
        title: "Erro ao retirar",
        description: err instanceof Error ? err.message : "Não foi possível remover da produção."
      });
    }
  }

  async function handleCopiarPropostaInformal(item: OrcamentoListItem) {
    showToast({
      type: "info",
      title: "Carregando proposta",
      description: "Aguarde enquanto os dados da proposta são carregados..."
    });

    try {
      const data = await getPropostaDetailById(item.id_int);
      if (data) {
        const frete = data.fretes.find((freteItem) => freteItem.id === data.freteEscolhidoId);
        const text = buildPropostaInformalText({
          id_int: data.id_int,
          clienteNome: data.cliente?.nome || "Cliente não cadastrado",
          itens: data.itens,
          frete,
          resumo: data.resumo,
          formaPagamento: data.formaPagamento,
          cidade: data.enderecoEntrega?.cidade,
          uf: data.enderecoEntrega?.uf
        });

        await navigator.clipboard?.writeText(text);
        showToast({ type: "success", title: "Resumo copiado", description: "Proposta informal copiada para WhatsApp." });
      } else {
        throw new Error("Proposta não encontrada.");
      }
    } catch (err) {
      console.error("[OrcamentosListPageReal] Error copying proposal informal text:", err);
      showToast({
        type: "error",
        title: "Erro ao copiar proposta",
        description: err instanceof Error ? err.message : "Não foi possível carregar os detalhes."
      });
    }
  }

  function getActions(item: OrcamentoListItem) {
    const isClienteNaoCadastrado = !item.clienteId || item.clienteId === "0" || item.clienteId === "null";
    const chatResumo = chatResumos[item.id_int];
    const chatLabel = chatResumo && chatResumo.nao_lidas_count > 0
      ? `Ver chat interno (${chatResumo.nao_lidas_count} não lidas)`
      : "Ver chat interno";

    return [
      {
        label: "Ver proposta",
        onClick: () => {
          const tab = item.isAvulsoRaw === true ? "pagamentos" : "produtos";
          router.push(`/orcamentos/${item.id_int}?tab=${tab}`);
        }
      },
      { label: chatLabel, onClick: () => handleOpenChat(item) },
      {
        label: "Editar proposta",
        onClick: () => {
          const tab = item.isAvulsoRaw === true ? "pagamentos" : "produtos";
          router.push(`/orcamentos/${item.id_int}/editar?tab=${tab}`);
        }
      },
      { label: "Duplicar proposta", onClick: () => void handleDuplicarPropostaForListItem(item) },
      {
        label: "Copiar proposta informal",
        onClick: () => void handleCopiarPropostaInformal(item)
      },
      { label: "Gerar PDF da proposta", onClick: () => void handleGerarPDFForListItem(item) },
      ...(!isClienteNaoCadastrado ? [{ label: "Gerar cobrança", onClick: () => void handleOpenCobrancaModal(item) }] : []),
      ...(canCancelarProposta ? [{ label: "Cancelar proposta", destructive: true, onClick: () => showToast({ type: "warning", title: "Cancelamento ainda nao conectado." }) }] : []),
      ...(!item.is_prd_aprovado && item.isAvulsoRaw !== true && item.statusInterno === "REVISAO ATENDENTE" ? [{ label: "Liberar para Produção", onClick: () => void handleLiberarProducao(item) }] : []),
      ...(item.is_prd_aprovado && (user?.isSuperAdmin || user?.isAdmin) ? [{ label: "Retirar da Produção", destructive: true, onClick: () => void handleRetirarProducao(item) }] : [])
    ];
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orcamentos"
        subtitle="Monte e acompanhe propostas comerciais com cliente, cobrança vinculada e resumo operacional."
        context="Orcamentos / Propostas"
        action={
          <button
            type="button"
            onClick={() => router.push("/orcamentos/novo")}
            className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
          >
            + Nova proposta
          </button>
        }
      />

      {isLoading ? (
        <section className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-36 animate-pulse rounded-3xl border border-slate-200 bg-white dark:bg-slate-800/40 dark:border-slate-700" />
          ))}
        </section>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          <div onClick={() => setFilterAvulso(prev => prev === "PEDIDOS" ? "TODOS" : "PEDIDOS")} className={`cursor-pointer transition rounded-3xl ${filterAvulso === "PEDIDOS" ? "ring-4 ring-teal-500 scale-[1.02]" : "hover:scale-[1.02]"}`}>
            <SummaryCard
              title="Pedidos"
              value={pedidosResumo.quantidade.toString()}
              description={
                <span>
                  Soma em {periodoSelecionadoLabel}:{" "}
                  <strong className="text-base font-bold text-slate-900">{formatCurrency(pedidosResumo.total)}</strong>
                </span>
              }
              tone={filterAvulso === "PEDIDOS" ? "success" : "info"}
              icon={FileText}
            />
          </div>
          <div onClick={() => setFilterAvulso(prev => prev === "ORCAMENTOS" ? "TODOS" : "ORCAMENTOS")} className={`cursor-pointer transition rounded-3xl ${filterAvulso === "ORCAMENTOS" ? "ring-4 ring-teal-500 scale-[1.02]" : "hover:scale-[1.02]"}`}>
            <SummaryCard
              title="Orçamentos"
              value={orcamentosResumo.quantidade.toString()}
              description={
                <span>
                  Soma em {periodoSelecionadoLabel}:{" "}
                  <strong className="text-base font-bold text-slate-900">{formatCurrency(orcamentosResumo.total)}</strong>
                </span>
              }
              tone={filterAvulso === "ORCAMENTOS" ? "success" : "info"}
              icon={FileText}
            />
          </div>
          <SummaryCard
            title="Em aberto"
            value={emAbertoResumo.quantidade.toString()}
            description={
              <span>
                Soma em {periodoSelecionadoLabel}:{" "}
                <strong className="text-base font-bold text-slate-900">{formatCurrency(emAbertoResumo.total)}</strong>
              </span>
            }
            tone="info"
            icon={FileText}
          />
          <SummaryCard
            title="Liberadas"
            value={aprovadasResumo.quantidade.toString()}
            description={
              <span>
                Soma em {periodoSelecionadoLabel}:{" "}
                <strong className="text-base font-bold text-slate-900">{formatCurrency(aprovadasResumo.total)}</strong>
              </span>
            }
            tone="success"
            icon={WalletCards}
          />
          <SummaryCard
            title="Aguardando"
            value={aguardandoResumo.quantidade.toString()}
            description={
              <span>
                Soma em {periodoSelecionadoLabel}:{" "}
                <strong className="text-base font-bold text-slate-900">{formatCurrency(aguardandoResumo.total)}</strong>
              </span>
            }
            tone="warning"
            icon={CreditCard}
          />
        </section>
      )}

      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm">
        <div className="grid gap-3 xl:grid-cols-[1fr_170px_170px_170px_150px_auto]">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Search className="h-4 w-4 text-[#0f9f9a]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-900 outline-none"
              placeholder="Buscar por proposta, cliente, ID cliente, valor ou OS Ideal"
            />
          </label>

          <select value={status} onChange={(event) => setStatus(event.target.value)} className={filterClass}>
            <option value="TODOS">Todos status</option>
            {statusOptions.filter((item) => item !== "TODOS").map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <select value={modelo} onChange={(event) => setModelo(event.target.value)} className={filterClass}>
            {modeloOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select value={vendedor} onChange={(event) => setVendedor(event.target.value)} className={filterClass}>
            <option value="TODOS">Todos vendedores</option>
            {vendedorOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <select value={filterTipoCobranca} onChange={(event) => setFilterTipoCobranca(event.target.value)} className={filterClass}>
            <option value="TODOS">Todas cobranças</option>
            <option value="PIX">PIX</option>
            <option value="BOLETO">BOLETO</option>
            <option value="E-FATURADO">E-FATURADO</option>
            <option value="CARTAO">CARTÃO</option>
          </select>

          <select value={periodo} onChange={(event) => setPeriodo(event.target.value)} className={filterClass}>
            {periodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              setSearch("");
              setStatus("TODOS");
              setModelo("TODOS_MODELOS");
              setVendedor("TODOS");
              setFilterTipoCobranca("TODOS");
              setFilterAvulso("TODOS");
              setPeriodo(periodOptions[0]?.value ?? getPeriodValue(new Date()));
            }}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Limpar filtros
          </button>
        </div>
      </section>

      <ResponsiveList<OrcamentoListItem>
        items={filteredPropostas}
        getKey={(proposta) => proposta.id}
        isLoading={isLoading}
        onRowClick={(proposta) => {
          const tab = proposta.isAvulsoRaw === true ? "pagamentos" : "produtos";
          router.push(`/orcamentos/${proposta.id_int}/editar?tab=${tab}`);
        }}
        emptyTitle="Nenhuma proposta encontrada"
        emptyDescription="Ajuste os filtros ou crie uma nova proposta para comecar."
        columns={[
          { header: "N°", cell: (proposta) => <span className="font-semibold text-slate-950">{proposta.id_int}</span> },
          {
            header: "id - Cliente",
            cell: (proposta) => {
              const isClienteNaoCadastrado = !proposta.clienteId || proposta.clienteId === "0";
              return (
                <div>
                  <p className="font-medium text-slate-900">
                    {isClienteNaoCadastrado ? (
                      <>
                        {proposta.clienteNome}
                        <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/20">Sem cadastro</span>
                      </>
                    ) : (
                      <>{proposta.clienteId} - {proposta.clienteNome}</>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">{proposta.documento || ""}</p>
                </div>
              );
            }
          },
          { header: "Tipo cobrança", cell: (proposta) => proposta.tipoCobrancaLabel, align: "center" },
          { header: "Data / Hora", cell: (proposta) => <span>{(proposta.updatedAt || proposta.createdAt) ? formatDateTime(proposta.updatedAt || proposta.createdAt) : "-"}</span>, align: "center" },
          { header: "Atendente", cell: (proposta) => proposta.vendedor },
          { header: "Status", cell: (proposta) => <StatusBadge status={proposta.statusLabel} tone={getStatusTone(proposta.status)} />, align: "center" },
          { header: "Valor total", cell: (proposta) => formatCurrency(proposta.total), align: "right" },
          { header: "Modelo", cell: (proposta) => proposta.modelo, align: "center" },
          {
            header: "Ações",
            cell: (proposta) => {
              const resumo = chatResumos[proposta.id_int];
              let btnClass = "text-slate-400 hover:bg-slate-100 hover:text-[#0b2f4a]";
              let titleText = "Chat interno";

              if (resumo) {
                if (resumo.has_recusado) {
                  btnClass = "text-red-600 bg-red-50/60 hover:bg-red-100 hover:text-red-700";
                  titleText = `Chat interno (${resumo.total_mensagens} msg) - Recusado`;
                } else if (resumo.has_pendente) {
                  btnClass = "text-amber-600 bg-amber-50/60 hover:bg-amber-100 hover:text-amber-700";
                  titleText = `Chat interno (${resumo.total_mensagens} msg) - Pendência`;
                } else if (resumo.nao_lidas_count > 0) {
                  btnClass = "text-blue-600 bg-blue-50/60 hover:bg-blue-100 hover:text-blue-700";
                  titleText = `Chat interno (${resumo.nao_lidas_count} não lida(s) de ${resumo.total_mensagens} total)`;
                } else if (resumo.total_mensagens > 0) {
                  btnClass = "text-slate-600 bg-slate-50 hover:bg-slate-100 hover:text-slate-800";
                  titleText = `Chat interno (${resumo.total_mensagens} msg)`;
                }
              }

              return (
                <div className="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => handleOpenChat(proposta)}
                    className={`relative rounded-xl p-2 transition flex items-center justify-center ${btnClass}`}
                    title={titleText}
                  >
                    <MessageSquare className="h-4 w-4" />
                    {resumo && resumo.nao_lidas_count > 0 && (
                      <span className={`absolute -top-1 -right-1 inline-flex items-center justify-center rounded-full px-1 text-[8px] font-extrabold leading-none h-4 min-w-[16px] text-white ${
                        resumo.has_recusado
                          ? "bg-red-600"
                          : resumo.has_pendente
                          ? "bg-amber-500"
                          : "bg-blue-600"
                      }`}>
                        {resumo.nao_lidas_count}
                      </span>
                    )}
                    {resumo && resumo.total_anexos > 0 && (
                      <span className="absolute -bottom-0.5 -right-0.5 bg-slate-500 text-white rounded-full p-0.5 border border-white" title={`${resumo.total_anexos} anexo(s)`}>
                        <Paperclip className="h-2 w-2" />
                      </span>
                    )}
                  </button>
                  <ActionsMenu items={getActions(proposta)} />
                </div>
              );
            },
            align: "right"
          }
        ]}
        renderCard={(proposta) => (
          <article key={proposta.id} className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">N° {proposta.id_int}</p>
                <h3 className="mt-2 font-semibold text-slate-950">
                  {(!proposta.clienteId || proposta.clienteId === "0") ? (
                    <>
                      {proposta.clienteNome}
                      <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/20">Sem cadastro</span>
                    </>
                  ) : (
                    <>{proposta.clienteId || "—"} - {proposta.clienteNome}</>
                  )}
                </h3>
                <p className="mt-1 text-sm text-slate-500">{proposta.vendedor}</p>
              </div>
              <StatusBadge status={proposta.statusLabel} tone={getStatusTone(proposta.status)} />
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-600">
              <p>Tipo cobrança: {proposta.tipoCobrancaLabel}</p>
              <p>Data / Hora: {(proposta.updatedAt || proposta.createdAt) ? formatDateTime(proposta.updatedAt || proposta.createdAt) : "-"}</p>
              <p>Modelo: {proposta.modelo}</p>
              <p className="font-semibold text-slate-900">Valor total: {formatCurrency(proposta.total)}</p>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const tab = proposta.isAvulsoRaw === true ? "pagamentos" : "produtos";
                    router.push(`/orcamentos/${proposta.id_int}?tab=${tab}`);
                  }}
                  className="rounded-2xl bg-[#0b2f4a] px-4 py-2 text-sm font-semibold text-white"
                >
                  Ver
                </button>
                {(() => {
                  const resumo = chatResumos[proposta.id_int];
                  let btnStyle = "border-slate-200 bg-white text-slate-700 hover:bg-slate-50";
                  let badgeBg = "bg-blue-600";
                  if (resumo) {
                    if (resumo.has_recusado) {
                      btnStyle = "border-red-200 bg-red-50 text-red-700 hover:bg-red-100";
                      badgeBg = "bg-red-600";
                    } else if (resumo.has_pendente) {
                      btnStyle = "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100";
                      badgeBg = "bg-amber-500";
                    } else if (resumo.nao_lidas_count > 0) {
                      btnStyle = "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100";
                      badgeBg = "bg-blue-600";
                    } else if (resumo.total_mensagens > 0) {
                      btnStyle = "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100";
                    }
                  }
                  return (
                    <button
                      type="button"
                      onClick={() => handleOpenChat(proposta)}
                      className={`inline-flex items-center gap-1.5 rounded-2xl border px-3 py-2 text-sm font-semibold transition ${btnStyle}`}
                    >
                      <MessageSquare className="h-4 w-4" />
                      <span>Chat</span>
                      {resumo && resumo.nao_lidas_count > 0 && (
                        <span className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[9px] font-extrabold text-white leading-none ${badgeBg}`}>
                          {resumo.nao_lidas_count}
                        </span>
                      )}
                      {resumo && resumo.total_anexos > 0 && (
                        <span className="text-slate-400" title={`${resumo.total_anexos} anexo(s)`}>
                          <Paperclip className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </button>
                  );
                })()}
              </div>
              <ActionsMenu label="Mais" items={getActions(proposta).filter((item) => item.label !== "Ver proposta")} />
            </div>
          </article>
        )}
      />

      {!isLoading ? (
        <section className={`rounded-3xl border border-dashed p-4 text-sm ${
          errorMessage
            ? "border-red-300 bg-red-50 text-red-800 dark:bg-red-950/20 dark:border-red-800 dark:text-red-300"
            : "border-slate-300 bg-slate-50 text-slate-600 dark:bg-slate-800/20 dark:border-slate-700 dark:text-slate-400"
        }`}>
          <div className="flex items-start gap-3">
            <CalendarDays className={`mt-0.5 h-4 w-4 ${errorMessage ? "text-red-600" : "text-[#0f9f9a]"}`} />
            <div>
              <p className="font-semibold">
                {errorMessage
                  ? "Erro ao conectar com o banco de dados Supabase"
                  : `Dados reais carregados em public.propostas (${loadedCount} registros).`}
              </p>
              {errorMessage && (
                <p className="mt-1 text-xs">
                  {errorMessage}
                </p>
              )}
            </div>
          </div>
          {!errorMessage ? (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Colunas detectadas: {detectedColumns.slice(0, 20).join(", ")}
              {detectedColumns.length > 20 ? "..." : ""}
            </p>
          ) : null}
        </section>
      ) : null}

      {isCobrancaModalOpen && selectedPropostaForCobranca && (
        <PropostaCobrancaPanel
          proposta={selectedPropostaForCobranca}
          isModalOpen={isCobrancaModalOpen}
          onOpenModal={() => setIsCobrancaModalOpen(true)}
          onCloseModal={() => {
            setIsCobrancaModalOpen(false);
            setSelectedPropostaForCobranca(null);
          }}
          onlyModal={true}
        />
      )}

      {selectedPropostaForLiberar && (
        <LiberarProducaoModal
          propostaId={selectedPropostaForLiberar.id_int}
          isOpen={isLiberarModalOpen}
          isSubmitting={isLiberarSubmitting}
          onClose={() => setIsLiberarModalOpen(false)}
          onConfirm={() => void confirmLiberarProducao()}
        />
      )}
    </div>
  );
}
