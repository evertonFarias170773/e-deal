"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarDays,
  Search,
  TrendingUp,
  Wallet,
  X
} from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { PageHeader } from "@/components/common/PageHeader";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { StatusBadge } from "@/components/common/StatusBadge";
import { SummaryCard } from "@/components/common/SummaryCard";
import { useAppToast } from "@/components/common/AppToast";
import { formatCurrency } from "@/lib/formatters/currency";
import {
  getTipoRecebivelLabel
} from "@/lib/mocks/contas-receber.mock";
import type {
  BoletoDepositoMock
} from "@/lib/mocks/contas-receber.mock";
import { getContasReceberReadOnlyData } from "@/features/contas-a-receber/services/contas-receber.service";
import { RevisarGeracaoBancariaModal } from "./components/RevisarGeracaoBancariaModal";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";

type ActiveTab = "CARTEIRA" | "BOLETOS" | "VENCIMENTOS" | "CARTOES" | "PREVISAO";
type TipoFilter = "TODOS" | "BOLETO" | "DEPOSITO" | "CARTAO";
type StatusFilter = "TODOS" | "A_VENCER" | "VENCIDOS" | "PAID" | "VENCIDO" | "CANCELADO" | "NAO_REGISTRADO";

function getResolvedPdfUrl(urlOrPath?: string): string {
  if (!urlOrPath) return "";
  if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
    return urlOrPath;
  }
  const parts = urlOrPath.split("/");
  if (parts.length > 1) {
    const bucket = parts[0];
    const path = parts.slice(1).join("/");
    const client = getSupabaseClient();
    if (client) {
      const { data } = client.storage.from(bucket).getPublicUrl(path);
      if (data?.publicUrl) {
        return data.publicUrl;
      }
    }
  }
  return urlOrPath;
}

interface C6PaymentInfo {
  date: string;
  amount: number;
}

interface C6QueryResult {
  id: string;
  amount: number;
  due_date: string;
  status: string;
  payments: C6PaymentInfo[];
}

const filterClass = "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none w-full";

export function ContasReceberPage() {
  const router = useRouter();
  const { showToast } = useAppToast();
  const { recalcularBoletoIdIntsLocal } = useCobrancas();
  const [activeTab, setActiveTab] = useState<ActiveTab>("CARTEIRA");
  const [recebiveis, setRecebiveis] = useState<BoletoDepositoMock[]>([]);
  const [boletosDepositos, setBoletosDepositos] = useState<BoletoDepositoMock[]>([]);
  const [dataSource, setDataSource] = useState<"supabase" | "mock">("supabase");
  const [isLoadingSource, setIsLoadingSource] = useState(true);
  
  // Date states initialized to dynamic client dates
  const [today, setToday] = useState("2026-06-04");
  const [firstDayOfMonth, setFirstDayOfMonth] = useState("2026-06-01");
  const [lastDayOfMonth, setLastDayOfMonth] = useState("2026-06-30");

  const [search, setSearch] = useState("");
  const [empresa, setEmpresa] = useState("TODAS");
  const [tipo, setTipo] = useState<TipoFilter>("TODOS");
  const [status, setStatus] = useState<StatusFilter>("TODOS");
  const [dataInicial, setDataInicial] = useState("2026-06-01");
  const [dataFinal, setDataFinal] = useState("2026-06-30");
  const [isAvulsoFilter, setIsAvulsoFilter] = useState<"TODOS" | "SIM" | "NAO">("TODOS");
  const [isFaturadoFilter, setIsFaturadoFilter] = useState<"TODOS" | "SIM" | "NAO">("TODOS");
  const [detailItem, setDetailItem] = useState<BoletoDepositoMock | null>(null);

  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [selectedBoletoRef, setSelectedBoletoRef] = useState<string | null>(null);
  const [selectedBoletoCliente, setSelectedBoletoCliente] = useState<string | null>(null);
  const [selectedBoletoIdInt, setSelectedBoletoIdInt] = useState<number | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [deletingBoletoId, setDeletingBoletoId] = useState<string | null>(null);
  const [confirmDeleteBoleto, setConfirmDeleteBoleto] = useState<BoletoDepositoMock | null>(null);

  // States for C6 manual query integration
  const [selectedBoletoForC6Query, setSelectedBoletoForC6Query] = useState<BoletoDepositoMock | null>(null);
  const [c6QueryResult, setC6QueryResult] = useState<C6QueryResult | null>(null);
  const [isC6Querying, setIsC6Querying] = useState(false);
  const [isC6Updating, setIsC6Updating] = useState(false);

  // Hydrate client-side dynamic dates safely
  useEffect(() => {
    const timer = setTimeout(() => {
      const d = new Date();
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const clientToday = `${year}-${month}-${day}`;
      const clientFirstDay = `${year}-${month}-01`;
      const lastDay = new Date(year, d.getMonth() + 1, 0).getDate();
      const clientLastDay = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
      
      setToday(clientToday);
      setFirstDayOfMonth(clientFirstDay);
      setLastDayOfMonth(clientLastDay);

      // Ler o parâmetro search da URL
      const params = new URLSearchParams(window.location.search);
      const searchParam = params.get("search");
      if (searchParam) {
        setSearch(searchParam);
        setDataInicial("");
        setDataFinal("");
      } else {
        setDataInicial(clientFirstDay);
        setDataFinal(clientLastDay);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Fetch read-only data on mount
  useEffect(() => {
    let isMounted = true;

    async function loadContasReceber() {
      setIsLoadingSource(true);
      try {
        const result = await getContasReceberReadOnlyData();
        if (!isMounted) return;

        console.log("[ContasReceber] dados carregados.", {
          source: result.source,
          recebiveis: result.recebiveis.length,
          boletosDepositos: result.boletosDepositos.length
        });
        setRecebiveis(result.recebiveis);
        setBoletosDepositos(result.boletosDepositos);
        setDataSource(result.source);
      } catch (error) {
        console.log("[ContasReceber] erro ao carregar dados read-only.", { error });
        if (!isMounted) return;

        setRecebiveis([]);
        setBoletosDepositos([]);
        setDataSource("supabase");
      } finally {
        if (isMounted) {
          setIsLoadingSource(false);
        }
      }
    }

    void loadContasReceber();

    return () => {
      isMounted = false;
    };
  }, [refreshTrigger]);
  
  // Efeito para abertura automática inteligente do modal de registro bancário
  useEffect(() => {
    if (isLoadingSource) return;

    const params = new URLSearchParams(window.location.search);
    const autoRegister = params.get("autoRegister") === "true";
    const searchParam = params.get("search");

    if (autoRegister && searchParam) {
      const idIntBuscado = Number(searchParam);
      if (!Number.isNaN(idIntBuscado)) {
        // Procurar boletos elegíveis para registro bancário da proposta buscada
        const elegiveis = boletosDepositos.filter(item => 
          item.id_int === idIntBuscado &&
          item.status !== "CANCELADO" &&
          !item.deposito_conta &&
          !item.id_boleto_c6 &&
          !item.linha_digitavel
        );

        if (elegiveis.length > 0) {
          const primeiro = elegiveis[0];
          setTimeout(() => {
            setSelectedBoletoRef(primeiro.ext_reference || primeiro.id);
            setSelectedBoletoCliente(primeiro.cliente);
            setSelectedBoletoIdInt(primeiro.id_int);
            setReviewModalOpen(true);
          }, 0);
        }

        // Limpar autoRegister da URL para evitar loops e reabertura indesejada
        params.delete("autoRegister");
        const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
        window.history.replaceState(null, '', newUrl);
      }
    }
  }, [isLoadingSource, boletosDepositos]);

  const filterState = useMemo(() => ({
    search,
    empresa,
    tipo,
    status,
    dataInicial,
    dataFinal,
    isAvulso: isAvulsoFilter,
    isFaturado: isFaturadoFilter
  }), [search, empresa, tipo, status, dataInicial, dataFinal, isAvulsoFilter, isFaturadoFilter]);

  const filteredRecebiveis = useMemo(
    () => filterVisibleRows(recebiveis, filterState, status, today),
    [recebiveis, filterState, status, today]
  );

  const filteredBoletos = useMemo(
    () => filterVisibleRows(boletosDepositos, filterState, status, today),
    [boletosDepositos, filterState, status, today]
  );

  const activeItemsForCards = useMemo(() => {
    if (activeTab === "BOLETOS") {
      return filteredBoletos;
    }
    return filteredRecebiveis;
  }, [activeTab, filteredRecebiveis, filteredBoletos]);

  const resumo = useMemo(
    () => buildResumoVisible(activeItemsForCards, today),
    [activeItemsForCards, today]
  );

  const empresaOptions = useMemo(() => {
    const empresas = Array.from(
      new Set(
        recebiveis
          .map((item) => item.empresa_original?.trim() || item.empresa || "")
          .filter((value) => Boolean(value))
      )
    );

    return empresas.sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [recebiveis]);

  function confirmRecebimento(id: string) {
    const paidAt = new Date().toISOString();
    setRecebiveis((current) =>
      current.map((item) => item.id === id ? { ...item, status: "PAID", confirmado: true, paid_at: paidAt } : item)
    );
    setBoletosDepositos((current) =>
      current.map((item) => item.id === id ? { ...item, status: "PAID", confirmado: true, paid_at: paidAt } : item)
    );
    showToast({ type: "success", title: "Recebimento confirmado no mock." });
  }

  function cancelRecebivel(id: string) {
    const confirmed = window.confirm("Cancelar recebível mockado? Nenhum backend real será acionado.");
    if (!confirmed) return;

    setRecebiveis((current) => current.map((item) => item.id === id ? { ...item, status: "CANCELADO", confirmado: false } : item));
    setBoletosDepositos((current) => current.map((item) => item.id === id ? { ...item, status: "CANCELADO", confirmado: false } : item));
    showToast({ type: "warning", title: "Recebível cancelado no mock." });
  }

  function prorrogarBoleto(id: string) {
    setBoletosDepositos((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const nextDate = addDays(item.vencimento, 7);
        return {
          ...item,
          vencimento: nextDate,
          status: "A_VENCER",
          dias_atraso: undefined,
          observacao: "Vencimento prorrogado no mock; status financeiro permanece A_VENCER."
        };
      })
    );
    showToast({ type: "info", title: "Vencimento prorrogado em 7 dias no mock." });
  }

  async function copyLinhaDigitavel(value?: string) {
    if (!value) {
      showToast({ type: "warning", title: "Este item não possui linha digitável." });
      return;
    }

    await navigator.clipboard?.writeText(value);
    showToast({ type: "success", title: "Linha digitável copiada." });
  }

  function openPdf(url?: string) {
    if (!url) {
      showToast({ type: "warning", title: "Este item não possui PDF de boleto associado." });
      return;
    }
    window.open(getResolvedPdfUrl(url), "_blank");
  }

  async function handleDeleteBoletoFromBank(boleto: BoletoDepositoMock) {
    if (!boleto.id_boleto_c6) return;
    setDeletingBoletoId(boleto.id);
    try {
      const { deleteBoletoFromBankViaN8n } = await import("@/features/nfe/services/nfe.service");
      await deleteBoletoFromBankViaN8n(boleto.id, String(boleto.id_boleto_c6), Number(boleto.id_empresa || 1));
      
      const { getSupabaseClient } = await import("@/lib/supabase/client");
      const client = getSupabaseClient();
      if (client) {
        // Fallback update no Supabase local por segurança: marcar como CANCELADO mas manter histórico do C6
        const { error: updateError } = await client
          .from("boletos")
          .update({
            status: "CANCELADO"
          })
          .eq("id", boleto.id);

        if (updateError) {
          console.error("[ContasReceberPage] failed fallback update for delete:", updateError);
        }
      }

      showToast({
        type: "success",
        title: "Boleto removido do banco. O contas a receber foi mantido."
      });

      if (boleto.id_int) {
        await recalcularBoletoIdIntsLocal(Number(boleto.id_int));
      }

      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error("[ContasReceberPage] failed to delete boleto:", err);
      showToast({
        type: "error",
        title: "Erro ao excluir boleto",
        description: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setDeletingBoletoId(null);
    }
  }

  async function handleQueryC6(boleto: BoletoDepositoMock) {
    if (!boleto.id_boleto_c6) {
      showToast({ type: "warning", title: "Código C6 não encontrado no boleto." });
      return;
    }
    setIsC6Querying(true);
    try {
      const { consultarDetalhesBoletoC6 } = await import("@/features/cobrancas/services/pagamentos-v2.service");
      const data = await consultarDetalhesBoletoC6(boleto.id_boleto_c6, Number(boleto.id_empresa || 1));

      if (!data) {
        throw new Error("Nenhum dado retornado da consulta C6.");
      }

      // Validations
      if (data.id !== boleto.id_boleto_c6) {
        throw new Error(`O código retornado (${data.id}) não corresponde ao código consultado (${boleto.id_boleto_c6}).`);
      }

      if (data.status !== "PAID") {
        showToast({
          type: "warning",
          title: "Boleto não está pago no C6.",
          description: `Status retornado: ${data.status || "Desconhecido"}`
        });
        setIsC6Querying(false);
        return;
      }

      if (!data.payments || !Array.isArray(data.payments) || data.payments.length === 0 || !data.payments[0].date) {
        throw new Error("O C6 retornou status PAID, mas sem data de pagamento associada.");
      }

      const c6Amount = Number(data.payments[0].amount ?? data.amount);
      const expectedAmount1 = Number(boleto.valor);
      const expectedAmount2 = Number(boleto.valor_atualizado ?? boleto.valor);

      const matchesAmount1 = Math.abs(c6Amount - expectedAmount1) < 0.01;
      const matchesAmount2 = Math.abs(c6Amount - expectedAmount2) < 0.01;

      if (!matchesAmount1 && !matchesAmount2) {
        throw new Error(
          `O valor pago no C6 (${formatCurrency(c6Amount)}) não é compatível com o valor original (${formatCurrency(expectedAmount1)}) ou atualizado (${formatCurrency(expectedAmount2)}) do boleto.`
        );
      }

      // Success! Set the validated result to transition to Step 2
      setC6QueryResult(data);
    } catch (err) {
      console.error("[ContasReceberPage] webhook query C6 failed:", err);
      showToast({
        type: "error",
        title: "Falha ao consultar no C6",
        description: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setIsC6Querying(false);
    }
  }

  async function handleConfirmPaymentC6(boleto: BoletoDepositoMock, queryResult: C6QueryResult) {
    setIsC6Updating(true);
    try {
      const paymentDate = queryResult.payments[0].date;
      
      const { getSupabaseClient } = await import("@/lib/supabase/client");
      const client = getSupabaseClient();
      if (!client) {
        throw new Error("Conexão com o banco de dados (Supabase) não inicializada.");
      }

      // Exact update query requested by user:
      const { data: updatedData, error: updateError } = await client
        .from("boletos")
        .update({
          status: "PAID",
          paid_at: paymentDate
        })
        .eq("id_boleto_c6", boleto.id_boleto_c6)
        .in("status", ["A_VENCER", "VENCIDO"])
        .select();

      if (updateError) {
        throw updateError;
      }

      if (!updatedData || updatedData.length === 0) {
        throw new Error(
          "Não foi possível atualizar o boleto. O status local atual pode não ser 'A_VENCER' ou 'VENCIDO', ou o código C6 não existe."
        );
      }

      // Update local React state for immediate feedback
      setRecebiveis((current) =>
        current.map((item) =>
          item.id_boleto_c6 === boleto.id_boleto_c6
            ? { ...item, status: "PAID" as const, paid_at: paymentDate, confirmado: true }
            : item
        )
      );
      setBoletosDepositos((current) =>
        current.map((item) =>
          item.id_boleto_c6 === boleto.id_boleto_c6
            ? { ...item, status: "PAID" as const, paid_at: paymentDate, confirmado: true }
            : item
        )
      );

      showToast({
        type: "success",
        title: "Boleto liquidado com sucesso!",
        description: `Status atualizado no Supabase para PAID com pagamento em ${formatLocalDate(paymentDate.slice(0, 10))}.`
      });

      // Close modal and refresh list
      setSelectedBoletoForC6Query(null);
      setC6QueryResult(null);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error("[ContasReceberPage] failed to confirm C6 payment:", err);
      showToast({
        type: "error",
        title: "Erro ao atualizar recebível",
        description: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setIsC6Updating(false);
    }
  }

  async function handleConsultarPdfC6(boleto: BoletoDepositoMock) {
    if (!boleto.id_boleto_c6) {
      showToast({ type: "warning", title: "Código C6 não encontrado no boleto." });
      return;
    }

    showToast({
      type: "info",
      title: "Consultando PDF...",
      description: "Buscando informações do boleto no C6 Bank."
    });

    try {
      const { consultarDetalhesBoletoC6 } = await import("@/features/cobrancas/services/pagamentos-v2.service");
      const c6Data = await consultarDetalhesBoletoC6(boleto.id_boleto_c6, Number(boleto.id_empresa || 1));

      if (!c6Data) {
        throw new Error("Nenhum dado retornado do C6 Bank.");
      }

      // Mapeamento amplo de URL e storage
      const urlPdf = c6Data.url_pdf || c6Data.pdf_url || c6Data.pdfUrl || c6Data.urlPdf || c6Data.pdf_storage || c6Data.url || c6Data.pdf || c6Data.caminho_pdf || c6Data.boleto_pdf || null;
      const pdfStorage = c6Data.pdf_storage || c6Data.pdfStorage || c6Data.storage_path || null;

      if (!urlPdf) {
        showToast({
          type: "warning",
          title: "PDF ainda não disponível no C6",
          description: "O boleto foi consultado com sucesso, mas nenhuma URL de PDF foi retornada."
        });
        return;
      }

      // Conexão Supabase
      const { getSupabaseClient } = await import("@/lib/supabase/client");
      const client = getSupabaseClient();
      if (!client) {
        throw new Error("Conexão com o banco de dados (Supabase) não inicializada.");
      }

      // Update na tabela boletos
      const { data: updatedData, error: updateError } = await client
        .from("boletos")
        .update({
          url_pdf: urlPdf,
          pdf_storage: pdfStorage
        })
        .eq("id_boleto_c6", boleto.id_boleto_c6)
        .select();

      if (updateError) {
        throw updateError;
      }

      if (!updatedData || updatedData.length === 0) {
        throw new Error("Não foi possível atualizar o boleto no banco de dados.");
      }

      // Atualizar estado local para feedback imediato
      setRecebiveis((current) =>
        current.map((item) =>
          item.id_boleto_c6 === boleto.id_boleto_c6
            ? { ...item, url_pdf: urlPdf, pdf_storage: pdfStorage }
            : item
        )
      );
      setBoletosDepositos((current) =>
        current.map((item) =>
          item.id_boleto_c6 === boleto.id_boleto_c6
            ? { ...item, url_pdf: urlPdf, pdf_storage: pdfStorage }
            : item
        )
      );

      showToast({
        type: "success",
        title: "PDF atualizado!",
        description: "A URL do PDF foi obtida do C6 e salva com sucesso."
      });

      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error("[ContasReceberPage] failed to consult PDF:", err);
      showToast({
        type: "error",
        title: "Erro ao consultar PDF",
        description: err instanceof Error ? err.message : String(err)
      });
    }
  }

  async function handleGerarPdfBoletoInterno(boleto: BoletoDepositoMock) {
    if (!boleto.id) {
      showToast({ type: "warning", title: "ID do boleto não encontrado." });
      return;
    }

    // A ação Gerar/Regerar PDF do Boleto só deve aparecer se o boleto já tiver: linha_digitavel, codigo_barras, id_boleto_c6
    // Se faltar qualquer um desses campos, bloquear com mensagem clara.
    if (!boleto.linha_digitavel || !boleto.codigo_barras || !boleto.id_boleto_c6) {
      showToast({
        type: "error",
        title: "Campos obrigatórios ausentes",
        description: "Não é possível gerar o PDF. O boleto deve possuir linha digitável, código de barras e identificador C6 registrados."
      });
      return;
    }

    showToast({
      type: "info",
      title: "Gerando PDF...",
      description: "Gerando PDF interno do boleto via Edge Function."
    });

    try {
      const { gerarBoletoPdfInterno } = await import("@/features/contas-a-receber/services/contas-receber.service");
      const res = await gerarBoletoPdfInterno(boleto.id, boleto.id_empresa);

      if (!res.success) {
        throw new Error(res.errorMessage || "Falha na geração do PDF.");
      }

      // Atualizar estado local imediatamente para habilitar "Abrir PDF Boleto" sem F5
      setRecebiveis((current) =>
        current.map((item) =>
          item.id === boleto.id
            ? { ...item, url_pdf: res.url, pdf_storage: res.path }
            : item
        )
      );
      setBoletosDepositos((current) =>
        current.map((item) =>
          item.id === boleto.id
            ? { ...item, url_pdf: res.url, pdf_storage: res.path }
            : item
        )
      );

      showToast({
        type: "success",
        title: "PDF atualizado!",
        description: "O PDF interno do boleto foi criado e salvo com sucesso."
      });

      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error("[ContasReceberPage] failed to generate PDF:", err);
      showToast({
        type: "error",
        title: "Erro ao gerar PDF",
        description: err instanceof Error ? err.message : String(err)
      });
    }
  }

  const tabs: Array<{ id: ActiveTab; label: string }> = [
    { id: "CARTEIRA", label: "Carteira" },
    { id: "BOLETOS", label: "Boletos e depósitos" },
    { id: "VENCIMENTOS", label: "Vencimentos" },
    { id: "CARTOES", label: "Cartões a receber" },
    { id: "PREVISAO", label: "Previsão de caixa" }
  ];

  return (
    <div className="space-y-6" data-contas-receber-source={dataSource}>
      <PageHeader
        title="Contas a receber"
        subtitle="Carteira financeira de boletos e previsões para acompanhamento de fluxos operacionais e recebíveis."
        context="Financeiro / Gestão de recebíveis"
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Vencidos reais" value={formatCurrency(resumo.vencidos)} description="Cobranças vencidas reais (A Receber expirado / Vencido)." tone="danger" icon={AlertTriangle} />
        <SummaryCard title="Carteira ativa" value={formatCurrency(resumo.carteiraAtiva)} description="Cobranças operacionais ativas a receber em dia." tone="warning" icon={CalendarDays} />
        <SummaryCard title="Previsão futura" value={formatCurrency(resumo.previsaoFutura)} description="Previsões financeiras e recebíveis futuros de caixa." tone="info" icon={Wallet} />
        <SummaryCard title="Pagos" value={formatCurrency(resumo.pagos)} description="Cobranças e premissas quitadas no período." tone="success" icon={TrendingUp} />
      </section>

      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-8">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 xl:col-span-2">
            <Search className="h-4 w-4 text-[#0f9f9a] shrink-0" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-900 outline-none"
              placeholder="Buscar por cliente, id, pagamento, OS ou CPF/CNPJ"
            />
          </label>

          <select value={empresa} onChange={(event) => setEmpresa(event.target.value)} className={filterClass}>
            <option value="TODAS">Todas as empresas</option>
            {empresaOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <select value={tipo} onChange={(event) => setTipo(event.target.value as TipoFilter)} className={filterClass}>
            <option value="TODOS">Todos os tipos</option>
            <option value="BOLETO">Boleto</option>
            <option value="DEPOSITO">Depósito</option>
            <option value="CARTAO">Cartão</option>
          </select>

          <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} className={filterClass}>
            <option value="TODOS">Todos status</option>
            <option value="A_VENCER">Previsão futura / E-Faturado (A Vencer)</option>
            <option value="VENCIDOS">Vencidos</option>
            <option value="PAID">Pagos</option>
            <option value="CANCELADO">Cancelados</option>
            <option value="NAO_REGISTRADO">Boletos não registrados</option>
          </select>

          <input
            type="date"
            value={dataInicial}
            onChange={(event) => setDataInicial(event.target.value)}
            className={filterClass}
            aria-label="Data inicial"
          />

          <input
            type="date"
            value={dataFinal}
            onChange={(event) => setDataFinal(event.target.value)}
            className={filterClass}
            aria-label="Data final"
          />

          <button
            type="button"
            onClick={() => {
              setSearch("");
              setEmpresa("TODAS");
              setTipo("TODOS");
              setStatus("TODOS");
              setIsAvulsoFilter("TODOS");
              setIsFaturadoFilter("TODOS");
              setDataInicial(firstDayOfMonth);
              setDataFinal(lastDayOfMonth);
            }}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 w-full"
          >
            Limpar filtros
          </button>
        </div>
      </section>

      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-2 shadow-sm">
        <div className="flex gap-2 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${
                activeTab === tab.id ? "bg-[#0b2f4a] text-white" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "CARTEIRA" ? (
        <CarteiraTab
          items={filteredRecebiveis}
          today={today}
          onConfirm={confirmRecebimento}
          onCancel={cancelRecebivel}
          onCopy={copyLinhaDigitavel}
          onPdf={openPdf}
          onDetail={setDetailItem}
          onNavigate={(path) => router.push(path)}
          onRegister={(item) => {
            setSelectedBoletoRef(item.ext_reference || null);
            setSelectedBoletoCliente(item.cliente);
            setSelectedBoletoIdInt(item.id_int || null);
            setReviewModalOpen(true);
          }}
          onConsultaC6={(item) => {
            setSelectedBoletoForC6Query(item);
            setC6QueryResult(null);
          }}
          onConsultarPdf={handleConsultarPdfC6}
          onGerarPdfBoleto={handleGerarPdfBoletoInterno}
        />
      ) : null}

      {activeTab === "BOLETOS" ? (
        <BoletosDepositosTab
          items={filteredBoletos}
          today={today}
          onConfirm={confirmRecebimento}
          onCancel={cancelRecebivel}
          onCopy={copyLinhaDigitavel}
          onPdf={openPdf}
          onProrrogar={prorrogarBoleto}
          onDetail={setDetailItem}
          onNavigate={(path) => router.push(path)}
          onRegister={(item) => {
            setSelectedBoletoRef(item.ext_reference || null);
            setSelectedBoletoCliente(item.cliente);
            setSelectedBoletoIdInt(item.id_int || null);
            setReviewModalOpen(true);
          }}
          onDeleteFromBank={(item) => {
            setConfirmDeleteBoleto(item);
          }}
          onConsultaC6={(item) => {
            setSelectedBoletoForC6Query(item);
            setC6QueryResult(null);
          }}
          onConsultarPdf={handleConsultarPdfC6}
          onGerarPdfBoleto={handleGerarPdfBoletoInterno}
        />
      ) : null}

      {activeTab === "VENCIMENTOS" ? <VencimentosTab items={recebiveis} today={today} /> : null}
      {activeTab === "CARTOES" ? <CartoesFaturadoTab items={recebiveis} today={today} /> : null}
      {activeTab === "PREVISAO" ? <PrevisaoCaixaTab items={recebiveis} boletos={boletosDepositos} today={today} /> : null}

      <section className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
        Contas a Receber é a carteira financeira de acompanhamento. A criação de cobranças e baixas reais permanecem gerenciadas no módulo operacional.
      </section>

      {isLoadingSource ? (
        <section className="rounded-3xl border border-dashed border-slate-350 bg-sky-50/50 p-4 text-sm leading-6 text-sky-850 animate-pulse">
          Buscando registros em tempo real na tabela public.boletos no Supabase.
        </section>
      ) : (
        <section className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500 flex justify-between items-center">
          <span>Fonte ativa de dados: <strong className="uppercase">{dataSource}</strong></span>
          <span>Dados atualizados da tabela public.boletos.</span>
        </section>
      )}

      {detailItem ? <RecebivelDetailModal item={detailItem} today={today} onClose={() => setDetailItem(null)} /> : null}

      <RevisarGeracaoBancariaModal
        isOpen={reviewModalOpen}
        onClose={() => {
          setReviewModalOpen(false);
          setSelectedBoletoRef(null);
          setSelectedBoletoCliente(null);
          setSelectedBoletoIdInt(null);
        }}
        extReference={selectedBoletoRef || ""}
        nomeCliente={selectedBoletoCliente || undefined}
        idInt={selectedBoletoIdInt || undefined}
        onSaveSuccess={() => {
          setRefreshTrigger(prev => prev + 1);
        }}
      />

      {confirmDeleteBoleto && (
        <div className="fixed inset-0 z-[10000] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden p-6 transform transition-all scale-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="p-3 bg-red-50 text-red-500 rounded-2xl">
                <AlertTriangle className="h-8 w-8" />
              </div>
              <div className="space-y-2">
                <h4 className="text-base font-bold text-slate-900">
                  Excluir boleto do banco?
                </h4>
                <p className="text-xs text-slate-500 leading-relaxed text-left">
                  Esta ação cancela/remove apenas o registro bancário do boleto no C6. O contas a receber continuará existindo no ERP e poderá ser revisado ou registrado novamente.
                </p>
              </div>
            </div>
            
            <div className="mt-6 flex items-center gap-3 justify-stretch">
              <button
                type="button"
                onClick={() => setConfirmDeleteBoleto(null)}
                className="flex-1 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-slate-200 rounded-xl transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deletingBoletoId !== null}
                onClick={() => {
                  const boleto = confirmDeleteBoleto;
                  setConfirmDeleteBoleto(null);
                  void handleDeleteBoletoFromBank(boleto);
                }}
                className="flex-1 py-2.5 text-xs font-bold text-white bg-red-650 hover:bg-red-700 rounded-xl transition"
              >
                {deletingBoletoId ? "Excluindo..." : "Excluir boleto do banco"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedBoletoForC6Query && (
        <div className="fixed inset-0 z-[10000] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-lg w-full overflow-hidden p-6 transform transition-all scale-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-[#0f9f9a] bg-teal-50 px-2.5 py-1 rounded-full">
                  Integração C6 Bank
                </span>
                <h3 className="mt-3 text-lg font-bold text-slate-900">
                  {c6QueryResult ? "Confirmar Baixa de Pagamento" : "Consultar Pagamento C6"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isC6Querying || isC6Updating) return;
                  setSelectedBoletoForC6Query(null);
                  setC6QueryResult(null);
                }}
                disabled={isC6Querying || isC6Updating}
                className="rounded-2xl bg-slate-100 p-2 text-slate-700 transition hover:bg-slate-200 disabled:opacity-50"
                aria-label="Fechar consulta"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {!c6QueryResult ? (
              // Step 1: Pre-query Confirmation
              <div className="mt-6 space-y-4">
                <p className="text-sm text-slate-500 leading-relaxed">
                  Deseja consultar o status deste boleto diretamente no C6 Bank? Confirme os dados abaixo antes de prosseguir.
                </p>

                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Cliente</span>
                    <strong className="text-slate-900 text-right max-w-[70%] truncate">
                      {selectedBoletoForC6Query.cliente}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Valor Atual</span>
                    <strong className="text-[#0b2f4a]">
                      {formatCurrency(selectedBoletoForC6Query.valor_atualizado ?? selectedBoletoForC6Query.valor)}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Vencimento</span>
                    <strong className="text-slate-900">
                      {formatLocalDate(selectedBoletoForC6Query.vencimento)}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Código C6</span>
                    <code className="text-slate-800 bg-slate-200 px-1.5 py-0.5 rounded text-xs">
                      {selectedBoletoForC6Query.id_boleto_c6}
                    </code>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Status Local</span>
                    <strong className="text-slate-900 uppercase">
                      {humanizeLocalStatus(getVisualStatus(selectedBoletoForC6Query, today))}
                    </strong>
                  </div>
                </div>

                <div className="flex items-center gap-3 justify-stretch mt-6">
                  <button
                    type="button"
                    disabled={isC6Querying}
                    onClick={() => {
                      setSelectedBoletoForC6Query(null);
                      setC6QueryResult(null);
                    }}
                    className="flex-1 py-3 text-sm font-semibold text-slate-500 hover:text-slate-850 hover:bg-slate-50 border border-slate-200 rounded-2xl transition disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={isC6Querying}
                    onClick={() => void handleQueryC6(selectedBoletoForC6Query)}
                    className="flex-1 py-3 text-sm font-semibold text-white bg-[#0f9f9a] hover:bg-[#0c7c78] rounded-2xl transition disabled:opacity-75 flex items-center justify-center gap-2"
                  >
                    {isC6Querying ? (
                      <>
                        <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Consultando...
                      </>
                    ) : (
                      "Consultar no C6"
                    )}
                  </button>
                </div>
              </div>
            ) : (
              // Step 2: Final Confirmation
              <div className="mt-6 space-y-4">
                <div className="p-4 bg-emerald-50 text-emerald-800 rounded-2xl border border-emerald-100 flex items-start gap-3">
                  <span className="bg-emerald-500 text-white rounded-full p-0.5 mt-0.5">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <div>
                    <h4 className="font-bold text-sm">Pagamento encontrado no C6!</h4>
                    <p className="text-xs mt-1 text-emerald-700 leading-relaxed text-left">
                      Deseja atualizar este recebível como pago? Esta ação atualizará a tabela local no Supabase.
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Valor Pago</span>
                    <strong className="text-emerald-700 font-bold text-base">
                      {formatCurrency(Number(c6QueryResult.payments?.[0]?.amount ?? c6QueryResult.amount))}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Data do Pagamento</span>
                    <strong className="text-slate-900">
                      {formatLocalDate(c6QueryResult.payments?.[0]?.date?.slice(0, 10) || "")}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Código C6</span>
                    <code className="text-slate-800 bg-slate-200 px-1.5 py-0.5 rounded text-xs">
                      {c6QueryResult.id}
                    </code>
                  </div>
                </div>

                <div className="flex items-center gap-3 justify-stretch mt-6">
                  <button
                    type="button"
                    disabled={isC6Updating}
                    onClick={() => {
                      setC6QueryResult(null);
                    }}
                    className="flex-1 py-3 text-sm font-semibold text-slate-500 hover:text-slate-850 hover:bg-slate-50 border border-slate-200 rounded-2xl transition disabled:opacity-50"
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    disabled={isC6Updating}
                    onClick={() => void handleConfirmPaymentC6(selectedBoletoForC6Query, c6QueryResult)}
                    className="flex-1 py-3 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-2xl transition disabled:opacity-75 flex items-center justify-center gap-2"
                  >
                    {isC6Updating ? (
                      <>
                        <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Confirmando...
                      </>
                    ) : (
                      "Sim, atualizar recebível"
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function GroupedSection({
  title,
  tone,
  items,
  today,
  onConfirm,
  onCancel,
  onCopy,
  onPdf,
  onDetail,
  onNavigate,
  isBoletoTab = false,
  onProrrogar,
  onRegister,
  onDeleteFromBank,
  onConsultaC6,
  onConsultarPdf,
  onGerarPdfBoleto
}: {
  title: string;
  tone: "danger" | "warning" | "info" | "success" | "neutral";
  items: BoletoDepositoMock[];
  today: string;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  onCopy: (value?: string) => void;
  onPdf: (url?: string) => void;
  onDetail: (item: BoletoDepositoMock) => void;
  onNavigate: (path: string) => void;
  isBoletoTab?: boolean;
  onProrrogar?: (id: string) => void;
  onRegister?: (item: BoletoDepositoMock) => void;
  onDeleteFromBank?: (item: BoletoDepositoMock) => void;
  onConsultaC6?: (item: BoletoDepositoMock) => void;
  onConsultarPdf?: (item: BoletoDepositoMock) => void;
  onGerarPdfBoleto?: (item: BoletoDepositoMock) => void;
}) {
  if (items.length === 0) return null;

  const totalSum = items.reduce((acc, item) => acc + (item.valor_atualizado ?? item.valor), 0);
  const isPaidSection = title === "Pagos";

  const toneClasses = {
    danger: { bg: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/50", dot: "bg-red-500" },
    warning: { bg: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/50", dot: "bg-amber-500" },
    info: { bg: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/20 dark:text-sky-400 dark:border-sky-900/50", dot: "bg-sky-500" },
    success: { bg: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/50", dot: "bg-emerald-500" },
    neutral: { bg: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900/20 dark:text-slate-400 dark:border-slate-800/50", dot: "bg-slate-500" }
  };

  const selectedTone = toneClasses[tone] || toneClasses.neutral;

  return (
    <div className="space-y-3 mb-6">
      <div className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl border ${selectedTone.bg} px-4 py-2.5 text-xs font-bold uppercase tracking-wide`}>
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${selectedTone.dot}`} />
          <span>{title} ({items.length})</span>
        </div>
        <div>Total: {formatCurrency(totalSum)}</div>
      </div>

      {isBoletoTab ? (
        <ResponsiveList<BoletoDepositoMock>
          items={items}
          getKey={(item) => item.id}
          columns={[
            { header: "N°", cell: (item) => <strong className="text-slate-950">{item.id_pagamento}</strong> },
            { header: "N° / OS", cell: (item) => <div><p>{item.id_int}</p><p className="text-xs text-slate-500">{item.os_ideal}</p></div> },
            { header: "Parc.", cell: (item) => item.parcela ? `${item.parcela}/${item.total_parcelas ?? item.parcela}` : "-", align: "center" },
            { header: "Cliente", cell: (item) => item.cliente },
            { header: "Empresa", cell: (item) => item.empresa },
            { header: "Tipo", cell: (item) => getTipoRecebivelLabel(item.tipo) },
            { header: "Venc.", cell: (item) => formatLocalDate(item.vencimento), align: "center" },
            { header: "Total", cell: (item) => formatCurrency(item.valor_atualizado ?? item.valor), align: "right" },
            { header: "Status", cell: (item) => <StatusBadge status={getVisualStatus(item, today)} tone={getVisualStatusTone(item, today)} />, align: "center" },
            ...(isPaidSection ? [
              { header: "Dt. Pagto", cell: (item: BoletoDepositoMock) => item.paid_at ? formatPaidAtDate(item.paid_at) : "-", align: "center" as const }
            ] : []),
            { header: "Linha/Ref.", cell: (item) => item.linha_digitavel ?? item.referencia ?? "-" },
            { header: "Ações", cell: (item) => {
              const isVisualAReceberCriado = getVisualStatus(item, today) === "A_RECEBER_CRIADO";
              return (
                <div className="flex items-center justify-end gap-2">
                  {isVisualAReceberCriado && onRegister && (
                    <button
                      onClick={() => onRegister(item)}
                      className="px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm transition"
                    >
                      Registrar
                    </button>
                  )}
                  <BoletoActions item={item} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onProrrogar={onProrrogar!} onDetail={onDetail} onNavigate={onNavigate} onRegister={onRegister!} onDeleteFromBank={onDeleteFromBank!} onConsultaC6={onConsultaC6} onConsultarPdf={onConsultarPdf} onGerarPdfBoleto={onGerarPdfBoleto} />
                </div>
              );
            }, align: "right" }
          ]}
          renderCard={(item) => <RecebivelCard key={item.id} item={item} today={today} onRegister={onRegister!} actions={<BoletoActions item={item} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onProrrogar={onProrrogar!} onDetail={onDetail} onNavigate={onNavigate} onRegister={onRegister!} onDeleteFromBank={onDeleteFromBank!} onConsultaC6={onConsultaC6} onConsultarPdf={onConsultarPdf} onGerarPdfBoleto={onGerarPdfBoleto} label="Mais" />} />}
        />
      ) : (
        <ResponsiveList<BoletoDepositoMock>
          items={items}
          getKey={(item) => item.id}
          columns={[
            { header: "N°", cell: (item) => <strong className="text-slate-950">{item.id_pagamento}</strong> },
            { header: "N° / OS", cell: (item) => <div><p>{item.id_int}</p><p className="text-xs text-slate-500">{item.os_ideal}</p></div> },
            { header: "Cliente", cell: (item) => <div><p className="font-medium text-slate-900">{item.cliente}</p><p className="text-xs text-slate-500">{item.documento}</p></div> },
            { header: "Empresa", cell: (item) => item.empresa },
            { header: "Tipo", cell: (item) => getTipoRecebivelLabel(item.tipo) },
            { header: "Status", cell: (item) => <StatusBadge status={getVisualStatus(item, today)} tone={getVisualStatusTone(item, today)} />, align: "center" },
            ...(isPaidSection ? [
              { header: "Dt. Pagto", cell: (item: BoletoDepositoMock) => item.paid_at ? formatPaidAtDate(item.paid_at) : "-", align: "center" as const }
            ] : []),
            { header: "Total", cell: (item) => formatCurrency(item.valor_atualizado ?? item.valor), align: "right" },
            { header: "Venc.", cell: (item) => formatLocalDate(item.vencimento), align: "center" },
            { header: "Conf.", cell: (item) => <StatusBadge status={item.confirmado ? "CONFIRMADO" : "NAO_CONFIRMADO"} tone={item.confirmado ? "success" : "neutral"} />, align: "center" },
            { header: "Ações", cell: (item) => {
              const isVisualAReceberCriado = getVisualStatus(item, today) === "A_RECEBER_CRIADO";
              return (
                <div className="flex items-center justify-end gap-2">
                  {isVisualAReceberCriado && onRegister && (
                    <button
                      onClick={() => onRegister(item)}
                      className="px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm transition"
                    >
                      Registrar
                    </button>
                  )}
                  <RecebivelActions item={item} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} onRegister={onRegister} onConsultaC6={onConsultaC6} onConsultarPdf={onConsultarPdf} onGerarPdfBoleto={onGerarPdfBoleto} />
                </div>
              );
            }, align: "right" }
          ]}
          renderCard={(item) => <RecebivelCard key={item.id} item={item} today={today} onRegister={onRegister} actions={<RecebivelActions item={item} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} onRegister={onRegister} onConsultaC6={onConsultaC6} onConsultarPdf={onConsultarPdf} onGerarPdfBoleto={onGerarPdfBoleto} label="Mais" />} />}
        />
      )}
    </div>
  );
}

function CarteiraTab({
  items,
  today,
  onConfirm,
  onCancel,
  onCopy,
  onPdf,
  onDetail,
  onNavigate,
  onRegister,
  onConsultaC6,
  onConsultarPdf,
  onGerarPdfBoleto
}: {
  items: BoletoDepositoMock[];
  today: string;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  onCopy: (value?: string) => void;
  onPdf: (url?: string) => void;
  onDetail: (item: BoletoDepositoMock) => void;
  onNavigate: (path: string) => void;
  onRegister?: (item: BoletoDepositoMock) => void;
  onConsultaC6?: (item: BoletoDepositoMock) => void;
  onConsultarPdf?: (item: BoletoDepositoMock) => void;
  onGerarPdfBoleto?: (item: BoletoDepositoMock) => void;
}) {
  const vencidos = useMemo(() => items.filter((item) => isVisualVencido(item, today)), [items, today]);
  const previsaoFutura = useMemo(() => items.filter((item) => item.status === "A_VENCER"), [items]);
  const pagos = useMemo(() => items.filter((item) => item.status === "PAID"), [items]);
  const cancelados = useMemo(() => items.filter((item) => item.status === "CANCELADO"), [items]);

  const hasItems = items.length > 0;

  if (!hasItems) {
    return (
      <ResponsiveList<BoletoDepositoMock>
        items={[]}
        getKey={(item) => item.id}
        emptyTitle="Nenhum recebível encontrado"
        emptyDescription="Ajuste os filtros para localizar recebíveis na carteira financeira."
        columns={[]}
        renderCard={() => null}
      />
    );
  }

  return (
    <div className="space-y-2">
      <GroupedSection title="Vencidos" tone="danger" items={vencidos} today={today} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} onRegister={onRegister} onConsultaC6={onConsultaC6} onConsultarPdf={onConsultarPdf} onGerarPdfBoleto={onGerarPdfBoleto} />
      <GroupedSection title="Previsão futura / E-Faturado" tone="info" items={previsaoFutura} today={today} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} onRegister={onRegister} onConsultaC6={onConsultaC6} onConsultarPdf={onConsultarPdf} onGerarPdfBoleto={onGerarPdfBoleto} />
      <GroupedSection title="Pagos" tone="success" items={pagos} today={today} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} onRegister={onRegister} onConsultaC6={onConsultaC6} onConsultarPdf={onConsultarPdf} onGerarPdfBoleto={onGerarPdfBoleto} />
      <GroupedSection title="Cancelados" tone="neutral" items={cancelados} today={today} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} onRegister={onRegister} onConsultaC6={onConsultaC6} onConsultarPdf={onConsultarPdf} onGerarPdfBoleto={onGerarPdfBoleto} />
    </div>
  );
}

function BoletosDepositosTab({
  items,
  today,
  onConfirm,
  onCancel,
  onCopy,
  onPdf,
  onProrrogar,
  onDetail,
  onNavigate,
  onRegister,
  onDeleteFromBank,
  onConsultaC6,
  onConsultarPdf,
  onGerarPdfBoleto
}: {
  items: BoletoDepositoMock[];
  today: string;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  onCopy: (value?: string) => void;
  onPdf: (url?: string) => void;
  onProrrogar: (id: string) => void;
  onDetail: (item: BoletoDepositoMock) => void;
  onNavigate: (path: string) => void;
  onRegister: (item: BoletoDepositoMock) => void;
  onDeleteFromBank: (item: BoletoDepositoMock) => void;
  onConsultaC6?: (item: BoletoDepositoMock) => void;
  onConsultarPdf?: (item: BoletoDepositoMock) => void;
  onGerarPdfBoleto?: (item: BoletoDepositoMock) => void;
}) {
  const vencidos = useMemo(() => items.filter((item) => isVisualVencido(item, today)), [items, today]);
  const previsaoFutura = useMemo(() => items.filter((item) => item.status === "A_VENCER"), [items]);
  const pagos = useMemo(() => items.filter((item) => item.status === "PAID"), [items]);
  const cancelados = useMemo(() => items.filter((item) => item.status === "CANCELADO"), [items]);

  const hasItems = items.length > 0;

  if (!hasItems) {
    return (
      <ResponsiveList<BoletoDepositoMock>
        items={[]}
        getKey={(item) => item.id}
        emptyTitle="Nenhum boleto ou depósito encontrado"
        emptyDescription="Ajuste os filtros para localizar boletos, depósitos ou outros recebíveis."
        columns={[]}
        renderCard={() => null}
      />
    );
  }

  return (
    <div className="space-y-2">
      <GroupedSection title="Vencidos" tone="danger" items={vencidos} today={today} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} isBoletoTab onProrrogar={onProrrogar} onRegister={onRegister} onDeleteFromBank={onDeleteFromBank} onConsultaC6={onConsultaC6} onConsultarPdf={onConsultarPdf} onGerarPdfBoleto={onGerarPdfBoleto} />
      <GroupedSection title="Previsão futura / E-Faturado" tone="info" items={previsaoFutura} today={today} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} isBoletoTab onProrrogar={onProrrogar} onRegister={onRegister} onDeleteFromBank={onDeleteFromBank} onConsultaC6={onConsultaC6} onConsultarPdf={onConsultarPdf} onGerarPdfBoleto={onGerarPdfBoleto} />
      <GroupedSection title="Pagos" tone="success" items={pagos} today={today} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} isBoletoTab onProrrogar={onProrrogar} onRegister={onRegister} onDeleteFromBank={onDeleteFromBank} onConsultaC6={onConsultaC6} onConsultarPdf={onConsultarPdf} onGerarPdfBoleto={onGerarPdfBoleto} />
      <GroupedSection title="Cancelados" tone="neutral" items={cancelados} today={today} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} isBoletoTab onProrrogar={onProrrogar} onRegister={onRegister} onDeleteFromBank={onDeleteFromBank} onConsultaC6={onConsultaC6} onConsultarPdf={onConsultarPdf} onGerarPdfBoleto={onGerarPdfBoleto} />
    </div>
  );
}

function VencimentosTab({ items, today }: { items: BoletoDepositoMock[]; today: string }) {
  const visibleItems = items.filter((item) => isAllowedTipo(item.tipo) && item.status === "VENCIDO");
  const groups = [
    { title: "Vencidos", items: visibleItems.filter((item) => isVisualVencido(item, today)), tone: "danger" as const },
    { title: "Vencem hoje", items: visibleItems.filter((item) => item.vencimento === today), tone: "warning" as const },
    { title: "Próximos 7 dias", items: visibleItems.filter((item) => isWithinDays(item.vencimento, 7, today)), tone: "info" as const },
    { title: "Próximos 30 dias", items: visibleItems.filter((item) => isWithinDays(item.vencimento, 30, today)), tone: "neutral" as const }
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {groups.map((group) => (
        <section key={group.title} className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-950">{group.title}</h2>
            <StatusBadge status={`${group.items.length} item(ns)`} tone={group.tone} />
          </div>
          <div className="space-y-3">
            {group.items.length ? group.items.map((item) => <MiniRecebivel key={`${group.title}-${item.id}`} item={item} />) : <p className="text-sm text-slate-500">Nenhum recebível neste grupo.</p>}
          </div>
        </section>
      ))}
    </div>
  );
}

function CartoesFaturadoTab({ items, today }: { items: BoletoDepositoMock[]; today: string }) {
  const filtered = items.filter((item) => isAllowedTipo(item.tipo) && item.tipo === "CARTAO");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {filtered.length ? (
        filtered.map((item) => (
          <article key={item.id} className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.id_pagamento}</p>
                <h3 className="mt-2 font-semibold text-slate-950">{item.cliente}</h3>
                <p className="mt-1 text-sm text-slate-500">{item.id_int} • {item.os_ideal} • Cartão</p>
              </div>
              <StatusBadge status={getVisualStatus(item, today)} tone={getVisualStatusTone(item, today)} />
            </div>
            <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
              <p>Valor: <strong className="text-slate-900">{formatCurrency(item.valor_atualizado ?? item.valor)}</strong></p>
              <p>Vencimento: {formatLocalDate(item.vencimento)}</p>
              <p>Confirmado: {item.confirmado ? "Sim" : "Não"}</p>
              <p>Empresa: {item.empresa}</p>
            </div>
            <p className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">{item.observacao}</p>
          </article>
        ))
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600 lg:col-span-2">
          Cartões a receber ficará disponível em uma fase futura.
        </div>
      )}
    </div>
  );
}

function PrevisaoCaixaTab({ items, boletos, today }: { items: BoletoDepositoMock[]; boletos: BoletoDepositoMock[]; today: string }) {
  const previsaoItems = items.filter((item) => isAllowedTipo(item.tipo) && item.status === "A_VENCER");
  const weekly = groupByWeek(previsaoItems, today);
  const byEmpresa = groupByEmpresa(previsaoItems);
  const recebido = items.filter((item) => isAllowedTipo(item.tipo) && item.status === "PAID").reduce((total, item) => total + item.valor, 0);
  const aReceber = previsaoItems.reduce((total, item) => total + (item.valor_atualizado ?? item.valor), 0);
  const vencidos = items.filter((item) => isAllowedTipo(item.tipo) && isVisualVencido(item, today)).reduce((total, item) => total + (item.valor_atualizado ?? item.valor), 0);

  return (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <span className="rounded-2xl bg-sky-50 p-3 text-sky-700"><TrendingUp className="h-5 w-5" /></span>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Previsão por semana</h2>
            <p className="text-sm text-slate-500">Agrupamento dinâmico por vencimento.</p>
          </div>
        </div>
        <div className="space-y-3">
          {weekly.map((row) => (
            <div key={row.label} className="rounded-2xl bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold text-slate-700">{row.label}</span>
                <strong className="text-slate-950">{formatCurrency(row.total)}</strong>
              </div>
              <div className="mt-3 h-2 rounded-full bg-slate-200">
                <div className="h-2 rounded-full bg-[#0f9f9a]" style={{ width: `${Math.min(100, (row.total / Math.max(...weekly.map((item) => item.total), 1)) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <MiniResumo title="Recebidos x a vencer" rows={[["Recebido", recebido], ["A vencer", aReceber], ["Vencidos", vencidos]]} />
        <MiniResumo title="Por empresa" rows={byEmpresa.map((item) => [item.empresa, item.total])} />
        <MiniResumo title="Boletos e depósitos" rows={[
          ["Boletos", boletos.filter((item) => item.tipo === "BOLETO").reduce((total, item) => total + item.valor, 0)],
          ["Depósitos", boletos.filter((item) => item.tipo === "DEPOSITO").reduce((total, item) => total + item.valor, 0)]
        ]} />
      </section>
    </div>
  );
}

function RecebivelActions({
  item,
  onConfirm,
  onCancel,
  onCopy,
  onPdf,
  onDetail,
  onNavigate,
  onRegister,
  onConsultaC6,
  onConsultarPdf,
  onGerarPdfBoleto,
  label
}: {
  item: BoletoDepositoMock;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  onCopy: (value?: string) => void;
  onPdf: (url?: string) => void;
  onDetail: (item: BoletoDepositoMock) => void;
  onNavigate: (path: string) => void;
  onRegister?: (item: BoletoDepositoMock) => void;
  onConsultaC6?: (item: BoletoDepositoMock) => void;
  onConsultarPdf?: (item: BoletoDepositoMock) => void;
  onGerarPdfBoleto?: (item: BoletoDepositoMock) => void;
  label?: string;
}) {
  const showConsultaC6 = !!item.id_boleto_c6 && item.status !== "PAID" && item.tipo === "BOLETO";
  const showConsultarPdf = !!item.id_boleto_c6 && !item.url_pdf && !item.pdf_storage && item.tipo === "BOLETO";

  const actionItems: Array<{
    label: string;
    onClick?: () => void;
    disabled?: boolean;
    destructive?: boolean;
  }> = [
    { label: "Ver detalhe recebível", onClick: () => onDetail(item) },
    { label: "Abrir proposta", onClick: () => onNavigate(`/orcamentos/${item.id_int}`) },
    { label: "Ver cliente", onClick: () => onNavigate(`/cadastros/${item.id_cliente}`) },
  ];

  if (item.tipo === "BOLETO" && onRegister) {
    const labelReg = (!item.id_boleto_c6 && !item.linha_digitavel) ? "Registrar boleto no banco" : "Revisar geração bancária";
    actionItems.push({ label: labelReg, onClick: () => onRegister(item) });
  }

  if (showConsultaC6 && onConsultaC6) {
    actionItems.push({ label: "Consultar pagamento C6", onClick: () => onConsultaC6(item) });
  }

  if (showConsultarPdf && onConsultarPdf) {
    actionItems.push({ label: "Consultar PDF no C6", onClick: () => onConsultarPdf(item) });
  }

  // A ação Gerar/Regerar PDF do Boleto só deve aparecer se o boleto já tiver: linha_digitavel, codigo_barras, id_boleto_c6
  if (item.tipo === "BOLETO" && onGerarPdfBoleto && item.linha_digitavel && item.codigo_barras && item.id_boleto_c6) {
    const temPdf = !!(item.url_pdf || item.pdf_storage);
    actionItems.push({
      label: temPdf ? "Regerar PDF do Boleto" : "Gerar PDF do Boleto",
      onClick: () => onGerarPdfBoleto(item)
    });
  }

  actionItems.push(
    { label: "Copiar linha digitável", disabled: !item.linha_digitavel, onClick: () => void onCopy(item.linha_digitavel) },
    { label: "Abrir PDF Boleto", disabled: !item.url_pdf && !item.pdf_storage, onClick: () => onPdf(item.url_pdf || item.pdf_storage) },
    { label: "Confirmar recebimento", disabled: item.status === "PAID" || item.status === "CANCELADO", onClick: () => onConfirm(item.id) },
    { label: "Cancelar recebível", destructive: true, disabled: item.status === "CANCELADO", onClick: () => onCancel(item.id) }
  );

  return (
    <ActionsMenu
      label={label}
      items={actionItems}
    />
  );
}

function BoletoActions({
  item,
  onConfirm,
  onCancel,
  onCopy,
  onPdf,
  onProrrogar,
  onDetail,
  onNavigate,
  onRegister,
  onDeleteFromBank,
  onConsultaC6,
  onConsultarPdf,
  onGerarPdfBoleto,
  label
}: {
  item: BoletoDepositoMock;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  onCopy: (value?: string) => void;
  onPdf: (url?: string) => void;
  onProrrogar: (id: string) => void;
  onDetail: (item: BoletoDepositoMock) => void;
  onNavigate: (path: string) => void;
  onRegister?: (item: BoletoDepositoMock) => void;
  onDeleteFromBank?: (item: BoletoDepositoMock) => void;
  onConsultaC6?: (item: BoletoDepositoMock) => void;
  onConsultarPdf?: (item: BoletoDepositoMock) => void;
  onGerarPdfBoleto?: (item: BoletoDepositoMock) => void;
  label?: string;
}) {
  const isRegistered = !!(item.id_boleto_c6 || item.nosso_numero || item.linha_digitavel);
  const showRegister = !!onRegister && item.tipo === "BOLETO" && !item.deposito_conta && !isRegistered && item.status !== "PAID" && item.status !== "CANCELADO";
  const showDelete = !!onDeleteFromBank && item.tipo === "BOLETO" && !item.deposito_conta && isRegistered && item.status !== "PAID" && item.status !== "CANCELADO";
  const showConsultaC6 = !!item.id_boleto_c6 && item.status !== "PAID" && item.tipo === "BOLETO";
  const showConsultarPdf = !!item.id_boleto_c6 && !item.url_pdf && !item.pdf_storage && item.tipo === "BOLETO";

  const actionItems: Array<{
    label: string;
    onClick?: () => void;
    disabled?: boolean;
    destructive?: boolean;
  }> = [
    { label: "Ver detalhe boleto", onClick: () => onDetail(item) },
    { label: "Abrir proposta", onClick: () => onNavigate(`/orcamentos/${item.id_int}`) },
  ];

  if (item.tipo === "BOLETO" && onRegister) {
    const labelReg = (!item.id_boleto_c6 && !item.linha_digitavel) ? "Registrar boleto no banco" : "Revisar geração bancária";
    actionItems.push({ label: labelReg, onClick: () => onRegister(item) });
  }

  if (showRegister) {
    actionItems.push({ label: "Registrar boleto", onClick: () => onRegister!(item) });
  }

  if (showDelete) {
    actionItems.push({ label: "Excluir boleto do banco", destructive: true, onClick: () => onDeleteFromBank!(item) });
  }

  if (showConsultaC6 && onConsultaC6) {
    actionItems.push({ label: "Consultar pagamento C6", onClick: () => onConsultaC6(item) });
  }

  if (showConsultarPdf && onConsultarPdf) {
    actionItems.push({ label: "Consultar PDF no C6", onClick: () => onConsultarPdf(item) });
  }

  // A ação Gerar/Regerar PDF do Boleto só deve aparecer se o boleto já tiver: linha_digitavel, codigo_barras, id_boleto_c6
  if (item.tipo === "BOLETO" && onGerarPdfBoleto && item.linha_digitavel && item.codigo_barras && item.id_boleto_c6) {
    const temPdf = !!(item.url_pdf || item.pdf_storage);
    actionItems.push({
      label: temPdf ? "Regerar PDF do Boleto" : "Gerar PDF do Boleto",
      onClick: () => onGerarPdfBoleto(item)
    });
  }

  actionItems.push(
    { label: "Copiar linha digitável", disabled: !item.linha_digitavel, onClick: () => void onCopy(item.linha_digitavel) },
    { label: "Abrir PDF Boleto", disabled: !item.url_pdf && !item.pdf_storage, onClick: () => onPdf(item.url_pdf || item.pdf_storage) },
    { label: "Confirmar recebimento", disabled: item.status === "PAID" || item.status === "CANCELADO", onClick: () => onConfirm(item.id) },
    { label: "Prorrogar vencimento", disabled: item.status === "PAID" || item.status === "CANCELADO", onClick: () => onProrrogar(item.id) },
    { label: "Cancelar boleto", destructive: true, disabled: item.status === "CANCELADO", onClick: () => onCancel(item.id) }
  );

  return (
    <ActionsMenu
      label={label}
      items={actionItems}
    />
  );
}

function RecebivelCard({
  item,
  today,
  actions,
  onRegister
}: {
  item: BoletoDepositoMock;
  today: string;
  actions: ReactNode;
  onRegister?: (item: BoletoDepositoMock) => void;
}) {
  const isVisualAReceberCriado = getVisualStatus(item, today) === "A_RECEBER_CRIADO";

  return (
    <article className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">N° {item.id_pagamento}</p>
          <h3 className="mt-2 font-semibold text-slate-950">{item.cliente}</h3>
          <p className="mt-1 text-sm text-slate-500">{item.id_int} • {item.os_ideal} • {item.empresa}</p>
        </div>
        <StatusBadge status={getVisualStatus(item, today)} tone={getVisualStatusTone(item, today)} />
      </div>
      <div className="mt-4 grid gap-2 text-sm text-slate-600">
        <p>Tipo: {getTipoRecebivelLabel(item.tipo)}</p>
        <p>Total: <strong className="text-slate-900">{formatCurrency(item.valor_atualizado ?? item.valor)}</strong></p>
        {(() => {
          const effectiveDias = getEffectiveDiasAtraso(item, today);
          return effectiveDias !== null && effectiveDias > 0 ? (
            <p className="text-red-650">Atraso: <strong>{effectiveDias} dia(s)</strong></p>
          ) : null;
        })()}
        <p>Venc.: {formatLocalDate(item.vencimento)}</p>
        {(item.status === "PAID" || item.paid_at) && (
          <p>Pagto: {item.paid_at ? formatPaidAtDate(item.paid_at) : "-"}</p>
        )}
        <p>Conf.: {item.confirmado ? "Sim" : "Não"}</p>
      </div>
      <div className="mt-4 flex justify-end gap-2 items-center">
        {isVisualAReceberCriado && onRegister && (
          <button
            onClick={() => onRegister(item)}
            className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm transition shrink-0"
          >
            Registrar boleto no banco
          </button>
        )}
        {actions}
      </div>
    </article>
  );
}

function MiniRecebivel({ item }: { item: BoletoDepositoMock }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-950">{item.cliente}</p>
          <p className="text-sm text-slate-500">N° {item.id_pagamento} • {getTipoRecebivelLabel(item.tipo)}</p>
        </div>
        <strong className="text-right text-slate-950">{formatCurrency(item.valor_atualizado ?? item.valor)}</strong>
      </div>
      <p className="mt-2 text-xs text-slate-500">Venc. {formatLocalDate(item.vencimento)} • {item.empresa}</p>
    </div>
  );
}

function MiniResumo({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  return (
    <section className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <div className="mt-4 space-y-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-500">{label}</span>
            <strong className="text-right text-slate-900">{formatCurrency(value)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecebivelDetailModal({
  item,
  today,
  onClose
}: {
  item: BoletoDepositoMock;
  today: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 p-3 sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#0b7774]">Conferência de Recebível</p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">{item.id_pagamento}</h2>
            <p className="mt-1 text-sm text-slate-500">{item.cliente} • {item.id_int} • {item.os_ideal}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl bg-slate-100 p-2 text-slate-700 transition hover:bg-slate-200"
            aria-label="Fechar detalhe"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <DetailField label="Empresa" value={item.empresa} />
          <DetailField label="Tipo de cobrança" value={getTipoRecebivelLabel(item.tipo)} />
          <DetailField label="Status visual" value={humanizeLocalStatus(getVisualStatus(item, today))} />
          <DetailField label="Status financeiro" value={humanizeLocalStatus(item.status)} />
          <DetailField label="Total original" value={formatCurrency(item.valor)} />
          {item.valor_atualizado !== undefined && <DetailField label="Total atualizado" value={formatCurrency(item.valor_atualizado)} />}
          <DetailField label="Vencimento" value={formatLocalDate(item.vencimento)} />
          {(item.status === "PAID" || item.paid_at) && (
            <DetailField label="Data do Pagamento" value={item.paid_at ? formatLocalDateTime(item.paid_at) : "-"} />
          )}
          <DetailField label="Confirmado" value={item.confirmado ? "Sim" : "Não"} />
          <DetailField label="CPF / CNPJ" value={item.documento} />
          <DetailField label="Parcela" value={item.parcela ? `${item.parcela}/${item.total_parcelas ?? item.parcela}` : "-"} />
          {item.multa !== undefined && item.multa > 0 && <DetailField label="Multa aplicada" value={formatCurrency(item.multa)} />}
          {item.juros_dia !== undefined && item.juros_dia > 0 && <DetailField label="Juros por dia" value={formatCurrency(item.juros_dia)} />}
          {(() => {
            const effectiveDias = getEffectiveDiasAtraso(item, today);
            return effectiveDias !== null && effectiveDias > 0 ? (
              <DetailField label="Dias de atraso" value={`${effectiveDias} dia(s)`} />
            ) : null;
          })()}
          {item.is_avulso !== undefined && <DetailField label="Tipo de emissão" value={item.is_avulso ? "Faturamento Avulso" : "Ordem de Serviço (OS)"} />}
          {item.is_faturado !== undefined && <DetailField label="Faturamento faturado" value={item.is_faturado ? "Sim" : "Não"} />}
          {item.linha_digitavel && <DetailField label="Linha Digitável" value={item.linha_digitavel} />}
          {item.codigo_barras && <DetailField label="Código de barras" value={item.codigo_barras} />}
          {item.nosso_numero && <DetailField label="Nosso Número" value={item.nosso_numero} />}
        </div>

        <div className="mt-4 rounded-2xl bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Observação / Descrição</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">{item.observacao || "Nenhuma observação ou descrição vinculada."}</p>
        </div>

        {item.tipo === "BOLETO" && !item.url_pdf && !item.pdf_storage ? (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled
              className="w-full rounded-2xl bg-slate-50 text-slate-400 border border-slate-200 px-4 py-3 text-sm font-semibold cursor-not-allowed"
            >
              PDF ainda não disponível
            </button>
          </div>
        ) : (item.url_pdf || item.pdf_storage) && (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => window.open(getResolvedPdfUrl(item.url_pdf || item.pdf_storage), "_blank")}
              className="w-full rounded-2xl bg-[#0f9f9a] text-white px-4 py-3 text-sm font-semibold transition hover:bg-[#0c7c78]"
            >
              Visualizar PDF do boleto
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}



function matchesVisibleStatus(item: BoletoDepositoMock, status: StatusFilter, today: string) {
  if (status === "TODOS") return true;
  if (status === "VENCIDOS") return isVisualVencido(item, today);
  if (status === "A_VENCER") return item.status === "A_VENCER";
  if (status === "PAID") return item.status === "PAID";
  if (status === "CANCELADO") return item.status === "CANCELADO";
  if (status === "NAO_REGISTRADO") {
    return item.tipo === "BOLETO" &&
           !item.deposito_conta &&
           (!item.id_boleto_c6 || !item.nosso_numero || !item.linha_digitavel);
  }
  return true;
}

function buildResumoVisible(recebiveis: BoletoDepositoMock[], today: string) {
  const carteira = recebiveis.filter((item) => isAllowedTipo(item.tipo));

  return {
    vencidos: carteira.filter((item) => isVisualVencido(item, today)).reduce((total, item) => total + (item.valor_atualizado ?? item.valor), 0),
    carteiraAtiva: 0, // A_RECEBER completely excluded from cards
    previsaoFutura: carteira.filter((item) => item.status === "A_VENCER").reduce((total, item) => total + (item.valor_atualizado ?? item.valor), 0),
    pagos: carteira.filter((item) => item.status === "PAID").reduce((total, item) => total + (item.valor_atualizado ?? item.valor), 0)
  };
}

function isAllowedTipo(tipo: string) {
  return tipo === "BOLETO" || tipo === "DEPOSITO" || tipo === "CARTAO" || tipo === "E-FATURADO" || tipo === "OUTRO_RECEBIVEL";
}

function getPaidSortScore(item: BoletoDepositoMock) {
  return toMillis(item.paid_at) ?? toMillis(item.vencimento) ?? toMillis(item.created_at) ?? 0;
}

function toMillis(value?: string) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getVisualStatus(item: BoletoDepositoMock, today: string): string {
  if (item.status === "CANCELADO") return "CANCELADO";
  if (item.status === "PAID") return "PAID";
  if (isVisualVencido(item, today)) return "VENCIDO";

  if (item.deposito_conta) {
    return "DEPOSITO_CONTA";
  }

  const isRegistered = !!(item.id_boleto_c6 || item.nosso_numero || item.linha_digitavel);
  if (isRegistered) {
    return "BOLETO_REGISTRADO";
  }

  return "A_RECEBER_CRIADO";
}

function getVisualStatusTone(item: BoletoDepositoMock, today: string) {
  const vis = getVisualStatus(item, today);
  if (vis === "VENCIDO") return "danger";
  if (vis === "PAID") return "success";
  if (vis === "DEPOSITO_CONTA") return "success";
  if (vis === "BOLETO_REGISTRADO") return "success";
  if (vis === "A_RECEBER_CRIADO") return "warning";
  if (vis === "CANCELADO") return "neutral";
  return "neutral";
}

function humanizeLocalStatus(status: string) {
  const labels: Record<string, string> = {
    A_RECEBER: "Carteira em aberto (Emitida)",
    A_VENCER: "Previsão futura",
    PAID: "Pago",
    CANCELADO: "Cancelado",
    VENCIDO: "Vencido",
    DEPOSITO_CONTA: "Depósito em conta",
    BOLETO_REGISTRADO: "Boleto registrado",
    A_RECEBER_CRIADO: "A receber criado — boleto não registrado"
  };

  return labels[status] ?? status;
}

function formatLocalDate(value: string) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatPaidAtDate(paidAt: string | undefined) {
  if (!paidAt) return "-";
  return formatLocalDate(paidAt.slice(0, 10));
}

function formatLocalDateTime(value: string | undefined) {
  if (!value) return "-";
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return "-";

    if (value.length <= 10) {
      const [year, month, day] = value.split("-");
      return `${day}/${month}/${year}`;
    }

    return date.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "America/Sao_Paulo"
    });
  } catch {
    return "-";
  }
}



function isVisualVencido(item: BoletoDepositoMock, _today: string) {
  if (_today) {
    // no-op to satisfy eslint unused-vars
  }
  return item.status === "VENCIDO";
}

function getEffectiveDiasAtraso(item: BoletoDepositoMock, today: string): number | null {
  if (!isVisualVencido(item, today)) {
    return null;
  }
  if (item.dias_atraso !== undefined && item.dias_atraso !== null && item.dias_atraso > 0) {
    return item.dias_atraso;
  }
  const diff = diffDays(today, item.vencimento);
  return diff > 0 ? diff : null;
}

function isDateInRange(value: string, start: string, end: string) {
  if (start && value < start) return false;
  if (end && value > end) return false;
  return true;
}

function isWithinDays(vencimento: string, days: number, today: string) {
  const diff = diffDays(vencimento, today);
  return diff >= 0 && diff <= days;
}

function diffDays(vencimento: string, today: string) {
  const base = new Date(`${today}T00:00:00-03:00`).getTime();
  const target = new Date(`${vencimento}T00:00:00-03:00`).getTime();
  return Math.round((target - base) / 86400000);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00-03:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function groupByWeek(items: BoletoDepositoMock[], today: string) {
  const rows = [
    { label: "Semana atual", start: 0, end: 7 },
    { label: "Próximos 15 dias", start: 8, end: 15 },
    { label: "Próximos 30 dias", start: 16, end: 30 },
    { label: "Acima de 30 dias", start: 31, end: 999 }
  ];

  return rows.map((row) => ({
    label: row.label,
    total: items
      .filter((item) => {
        const diff = diffDays(item.vencimento, today);
        return diff >= row.start && diff <= row.end;
      })
      .reduce((total, item) => total + (item.valor_atualizado ?? item.valor), 0)
  }));
}

function groupByEmpresa(items: BoletoDepositoMock[]) {
  const totals = new Map<string, number>();

  for (const item of items) {
    const empresa = item.empresa_original?.trim() || item.empresa || "Empresa não informada";
    totals.set(empresa, (totals.get(empresa) ?? 0) + (item.valor_atualizado ?? item.valor));
  }

  return Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([empresa, total]) => ({ empresa, total }));
}

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function filterVisibleRows(
  items: BoletoDepositoMock[],
  filters: { 
    search: string; 
    empresa: string; 
    tipo: TipoFilter; 
    status: StatusFilter; 
    dataInicial: string; 
    dataFinal: string;
    isAvulso: "TODOS" | "SIM" | "NAO";
    isFaturado: "TODOS" | "SIM" | "NAO";
  },
  status: StatusFilter,
  today: string
) {
  const normalizedSearch = normalize(filters.search);

  const filtered = items.filter((item) => {
    if (!isAllowedTipo(item.tipo)) {
      return false;
    }

    const haystack = normalize(`${item.cliente} ${item.id_int} ${item.id_pagamento} ${item.os_ideal} ${item.documento} ${item.ext_reference || ""}`);
    const matchesSearch = !normalizedSearch || haystack.includes(normalizedSearch);
    const matchesEmpresa = filters.empresa === "TODAS" || (item.empresa_original?.trim() || item.empresa) === filters.empresa;
    const matchesTipo = filters.tipo === "TODOS" || item.tipo === filters.tipo;
    const matchesStatus = matchesVisibleStatus(item, filters.status, today);
    const matchesPeriodo = isDateInRange(item.vencimento, filters.dataInicial, filters.dataFinal);
    
    let matchesAvulso = true;
    if (filters.isAvulso === "SIM") {
      matchesAvulso = item.is_avulso === true;
    } else if (filters.isAvulso === "NAO") {
      matchesAvulso = item.is_avulso !== true;
    }

    let matchesFaturado = true;
    if (filters.isFaturado === "SIM") {
      matchesFaturado = item.is_faturado === true;
    } else if (filters.isFaturado === "NAO") {
      matchesFaturado = item.is_faturado !== true;
    }

    return matchesSearch && matchesEmpresa && matchesTipo && matchesStatus && matchesPeriodo && matchesAvulso && matchesFaturado;
  });

  if (status === "VENCIDOS" || status === "VENCIDO") {
    return [...filtered].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  }

  if (status === "A_VENCER") {
    return [...filtered].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  }

  if (status !== "PAID") {
    return filtered;
  }

  return [...filtered]
    .sort((a, b) => getPaidSortScore(b) - getPaidSortScore(a))
    .slice(0, 100);
}
