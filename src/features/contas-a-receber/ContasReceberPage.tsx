"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import { codecs } from "@/lib/url-state";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useDebouncedInput } from "@/hooks/useDebouncedValue";
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
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
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

type ActiveTab = "CARTEIRA" | "BOLETOS" | "DEPOSITOS" | "CARTOES" | "PREVISAO";
type TipoFilter = "TODOS" | "BOLETO" | "DEPOSITO" | "CARTAO";
type StatusFilter = "TODOS" | "A_VENCER" | "VENCIDOS" | "PAID" | "VENCIDO" | "CANCELADO" | "NAO_REGISTRADO";
type FormaRecebimento = "PIX" | "CARTAO" | "DINHEIRO" | "BONIFICADO" | "OUTROS";

const FORMAS_RECEBIMENTO: Array<{ value: FormaRecebimento; label: string }> = [
  { value: "PIX", label: "PIX" },
  { value: "CARTAO", label: "Cartão" },
  { value: "DINHEIRO", label: "Dinheiro" },
  { value: "BONIFICADO", label: "Bonificado" },
  { value: "OUTROS", label: "Outros" }
];

// Ações de ciclo de vida do título (aba Boletos/Depósitos): agrupadas em um único
// prop para não multiplicar callbacks no encadeamento até BoletoActions.
type BoletoLifecycleOps = {
  cancelarParaDeposito: (item: BoletoDepositoMock) => void;
  editarDeposito: (item: BoletoDepositoMock) => void;
  transformarEmBoleto: (item: BoletoDepositoMock) => void;
};

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

const ABAS = ["CARTEIRA", "BOLETOS", "DEPOSITOS", "CARTOES", "PREVISAO"] as const;
const STATUS_FILTROS = [
  "TODOS",
  "A_VENCER",
  "VENCIDOS",
  "PAID",
  "VENCIDO",
  "CANCELADO",
  "NAO_REGISTRADO"
] as const;

export function ContasReceberPage() {
  const router = useRouter();
  const { showToast } = useAppToast();
  const { recalcularBoletoIdIntsLocal } = useCobrancas();
  const { user: usuarioLogado } = useAuth();
  const [recebiveis, setRecebiveis] = useState<BoletoDepositoMock[]>([]);
  const [boletosDepositos, setBoletosDepositos] = useState<BoletoDepositoMock[]>([]);
  const [dataSource, setDataSource] = useState<"supabase" | "mock">("supabase");
  const [isLoadingSource, setIsLoadingSource] = useState(true);
  
  // Date states initialized to dynamic client dates
  const [today, setToday] = useState("2026-06-04");
  const [firstDayOfMonth, setFirstDayOfMonth] = useState("2026-06-01");
  const [lastDayOfMonth, setLastDayOfMonth] = useState("2026-06-30");

  const [tipo, setTipo] = useState<TipoFilter>("TODOS");
  const [isAvulsoFilter, setIsAvulsoFilter] = useState<"TODOS" | "SIM" | "NAO">("TODOS");
  const [isFaturadoFilter, setIsFaturadoFilter] = useState<"TODOS" | "SIM" | "NAO">("TODOS");

  // Filtros da tela na URL: sobrevivem a atualizar a página, sair e voltar, ao
  // histórico do navegador e a um link copiado.
  //
  // O período tem padrão dinâmico (mês corrente, calculado no cliente), por isso
  // fica fora da URL enquanto não for alterado. Links antigos com `?search=` da
  // preparação de boletos abriam sem período para não esconder o título procurado;
  // esse acordo é preservado transformando a ausência de período em padrão vazio
  // quando o parâmetro legado está presente.
  const paramsAtuais = useSearchParams();
  const veioDeLinkLegadoComBusca =
    Boolean(paramsAtuais?.get("search")) && !paramsAtuais?.has("ini") && !paramsAtuais?.has("fim");

  const filtrosSchema = useMemo(
    () => ({
      q: { codec: codecs.texto(), default: "", alias: ["search"] as const },
      aba: { codec: codecs.enumOf(ABAS), default: "CARTEIRA" as ActiveTab },
      emp: { codec: codecs.texto(), default: "TODAS" },
      status: { codec: codecs.enumOf(STATUS_FILTROS), default: "TODOS" as StatusFilter },
      ini: {
        codec: codecs.dataIsoOuTodas(),
        default: veioDeLinkLegadoComBusca ? "" : firstDayOfMonth
      },
      fim: {
        codec: codecs.dataIsoOuTodas(),
        default: veioDeLinkLegadoComBusca ? "" : lastDayOfMonth
      },
      autoRegister: { codec: codecs.booleano(), default: false }
    }),
    [firstDayOfMonth, lastDayOfMonth, veioDeLinkLegadoComBusca]
  );

  const { filters, setFilter, setFilters } = useUrlFilters(filtrosSchema);

  // Nomes locais preservados: o restante da tela continua lendo estas variáveis.
  const activeTab = filters.aba;
  const search = filters.q;
  const empresa = filters.emp;
  const status = filters.status;
  const dataInicial = filters.ini;
  const dataFinal = filters.fim;

  // O campo responde a cada tecla; a URL (e a filtragem) só depois da pausa.
  const [buscaDigitada, setBuscaDigitada] = useDebouncedInput(search, (valor) =>
    setFilter("q", valor)
  );
  const [detailItem, setDetailItem] = useState<BoletoDepositoMock | null>(null);

  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [selectedBoletoRef, setSelectedBoletoRef] = useState<string | null>(null);
  const [selectedBoletoCliente, setSelectedBoletoCliente] = useState<string | null>(null);
  const [selectedBoletoIdInt, setSelectedBoletoIdInt] = useState<number | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [cancelTarget, setCancelTarget] = useState<BoletoDepositoMock | null>(null);
  const [isCanceling, setIsCanceling] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<BoletoDepositoMock | null>(null);
  const [isConfirmingBaixa, setIsConfirmingBaixa] = useState(false);
  const [confirmBankCancelDone, setConfirmBankCancelDone] = useState(false);
  const [formaRecebimento, setFormaRecebimento] = useState<FormaRecebimento | "">("");
  const [obsRecebimento, setObsRecebimento] = useState("");

  // Prorrogar vencimento (cancela original + gera substituto)
  const [prorrogarTarget, setProrrogarTarget] = useState<BoletoDepositoMock | null>(null);
  const [prorrogarNovoVenc, setProrrogarNovoVenc] = useState("");
  const [prorrogarMotivo, setProrrogarMotivo] = useState("");
  const [isProrrogando, setIsProrrogando] = useState(false);
  const [prorrogarBankCancelDone, setProrrogarBankCancelDone] = useState(false);

  // Cancelar boleto -> depósito futuro
  const [depConvertTarget, setDepConvertTarget] = useState<BoletoDepositoMock | null>(null);
  const [isConvertingDep, setIsConvertingDep] = useState(false);
  const [depConvertBankDone, setDepConvertBankDone] = useState(false);

  // Editar depósito (somente vencimento)
  const [editDepTarget, setEditDepTarget] = useState<BoletoDepositoMock | null>(null);
  const [editDepVenc, setEditDepVenc] = useState("");
  const [isEditingDep, setIsEditingDep] = useState(false);

  // Transformar depósito -> boleto
  const [transformTarget, setTransformTarget] = useState<BoletoDepositoMock | null>(null);
  const [isTransforming, setIsTransforming] = useState(false);
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
      // O período em si vem da URL (ou do padrão do mês corrente, calculado acima).
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
  const autoRegisterConsumidoRef = useRef(false);

  useEffect(() => {
    if (isLoadingSource) return;

    const autoRegister = filters.autoRegister;
    const searchParam = filters.q;

    if (autoRegister && searchParam && !autoRegisterConsumidoRef.current) {
      autoRegisterConsumidoRef.current = true;
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

        // Limpar autoRegister da URL para evitar loops e reabertura indesejada.
        setFilter("autoRegister", false);
      }
    }
  }, [isLoadingSource, boletosDepositos, filters.autoRegister, filters.q, setFilter]);

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

  const filteredRecebiveisSemData = useMemo(
    () => filterVisibleRows(recebiveis, { ...filterState, dataInicial: "", dataFinal: "" }, status, today),
    [recebiveis, filterState, status, today]
  );

  const filteredBoletosSemData = useMemo(
    () => filterVisibleRows(boletosDepositos, { ...filterState, dataInicial: "", dataFinal: "" }, status, today),
    [boletosDepositos, filterState, status, today]
  );

  const activeItemsForCards = useMemo(() => {
    if (activeTab === "BOLETOS" || activeTab === "DEPOSITOS") {
      return filteredBoletos.filter(item => item.tipo === (activeTab === "BOLETOS" ? "BOLETO" : "DEPOSITO"));
    }
    return filteredRecebiveis;
  }, [activeTab, filteredRecebiveis, filteredBoletos]);

  const activeItemsForCardsSemData = useMemo(() => {
    if (activeTab === "BOLETOS" || activeTab === "DEPOSITOS") {
      return filteredBoletosSemData.filter(item => item.tipo === (activeTab === "BOLETOS" ? "BOLETO" : "DEPOSITO"));
    }
    return filteredRecebiveisSemData;
  }, [activeTab, filteredRecebiveisSemData, filteredBoletosSemData]);

  const resumo = useMemo(
    () => buildResumoVisible(activeItemsForCards, activeItemsForCardsSemData, today),
    [activeItemsForCards, activeItemsForCardsSemData, today]
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
    const item =
      boletosDepositos.find((row) => row.id === id) ||
      recebiveis.find((row) => row.id === id);

    if (!item) {
      showToast({ type: "error", title: "Registro não encontrado para baixa." });
      return;
    }
    if (item.status === "PAID" || item.paid_at) {
      showToast({ type: "warning", title: "Este título já está baixado." });
      return;
    }
    if (item.status === "CANCELADO") {
      showToast({ type: "warning", title: "Título cancelado não pode ser baixado." });
      return;
    }

    setConfirmBankCancelDone(false);
    setFormaRecebimento("");
    setObsRecebimento("");
    setConfirmTarget(item);
  }

  function cancelRecebivel(id: string) {
    const item =
      boletosDepositos.find((row) => row.id === id) ||
      recebiveis.find((row) => row.id === id);

    if (!item) {
      showToast({ type: "error", title: "Registro não encontrado para cancelamento." });
      return;
    }
    if (item.status === "CANCELADO") {
      showToast({ type: "warning", title: "Este título já está cancelado." });
      return;
    }

    setCancelTarget(item);
  }

  function abrirProrrogar(id: string) {
    const item = boletosDepositos.find((row) => row.id === id) || recebiveis.find((row) => row.id === id);
    if (!item) {
      showToast({ type: "error", title: "Registro não encontrado para prorrogação." });
      return;
    }
    setProrrogarNovoVenc("");
    setProrrogarMotivo("");
    setProrrogarBankCancelDone(false);
    setProrrogarTarget(item);
  }

  const confirmadoPorLabel = () =>
    usuarioLogado?.nomeUsuario || usuarioLogado?.name || usuarioLogado?.email || "Financeiro";

  // 1) Prorrogar: cancela o boleto atual no banco e cria um substituto com o novo
  //    vencimento, registrando-o pelo fluxo oficial. Nunca deixa 2 boletos ativos.
  async function handleProrrogar() {
    const item = prorrogarTarget;
    if (!item || isProrrogando) return;

    const isRegistered = Boolean(item.id_boleto_c6 || item.linha_digitavel || item.nosso_numero);
    if (item.status === "PAID" || item.paid_at || item.status === "CANCELADO") {
      showToast({ type: "warning", title: "Este título não está mais em situação de prorrogação." });
      setProrrogarTarget(null);
      return;
    }
    if (!isRegistered) {
      showToast({ type: "warning", title: "Somente boletos registrados no banco podem ser prorrogados." });
      return;
    }
    const vencAtual = String(item.vencimento).slice(0, 10);
    if (!prorrogarNovoVenc) {
      showToast({ type: "warning", title: "Selecione a nova data de vencimento." });
      return;
    }
    if (prorrogarNovoVenc <= vencAtual) {
      showToast({ type: "warning", title: "A nova data deve ser posterior ao vencimento atual." });
      return;
    }
    if (prorrogarNovoVenc < today) {
      showToast({ type: "warning", title: "A nova data não pode ser anterior a hoje." });
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      showToast({ type: "error", title: "Supabase não configurado." });
      return;
    }

    setIsProrrogando(true);
    let bancoCancelado = prorrogarBankCancelDone;
    try {
      const idEmpresa = Number(item.id_empresa || 1);

      // Ler a linha original completa ANTES de cancelar, para uma cópia fiel.
      const { data: origRow, error: origFetchErr } = await client
        .from("boletos")
        .select("*")
        .eq("id", item.id)
        .maybeSingle();
      if (origFetchErr || !origRow) {
        throw new Error(`Falha ao ler o título original: ${origFetchErr?.message || "não encontrado"}`);
      }

      // (a) Cancelar o boleto original no banco (uma única vez; retry não repete).
      if (!bancoCancelado) {
        const { consultarDetalhesBoletoC6 } = await import("@/features/cobrancas/services/pagamentos-v2.service");
        const detalhes = await consultarDetalhesBoletoC6(String(item.id_boleto_c6), idEmpresa);
        const statusC6 = String(detalhes?.status || "").toUpperCase();
        const temPagamento = Array.isArray(detalhes?.payments) && detalhes.payments.length > 0;
        if (statusC6 === "PAID" || temPagamento) {
          showToast({
            type: "warning",
            title: "O banco indica este boleto como pago.",
            description: "Prorrogação bloqueada para evitar duplicidade."
          });
          return;
        }
        if (!statusC6.includes("CANCEL")) {
          const { deleteBoletoFromBankViaN8n } = await import("@/features/nfe/services/nfe.service");
          await deleteBoletoFromBankViaN8n(item.id, String(item.id_boleto_c6), idEmpresa);
        }
        bancoCancelado = true;
        setProrrogarBankCancelDone(true);
      }

      const confirmadoPor = confirmadoPorLabel();
      const agoraIso = new Date().toISOString();
      const diasProrg = Math.round(
        (new Date(`${prorrogarNovoVenc}T00:00:00`).getTime() - new Date(`${vencAtual}T00:00:00`).getTime()) / 86400000
      );
      const motivoTxt = prorrogarMotivo.trim();

      // (b) Marcar o ORIGINAL como cancelado/substituído. A guarda .in impede
      //     duplicar o substituto num retry (se já não estiver ativo, aborta).
      const { data: origUpd, error: origErr } = await client
        .from("boletos")
        .update({
          status: "CANCELADO",
          is_prorrogado: true,
          motivo_prorg: `Prorrogado por ${confirmadoPor} em ${agoraIso}: venc ${vencAtual} -> ${prorrogarNovoVenc}. Substituído por novo título.${motivoTxt ? ` Motivo: ${motivoTxt}` : ""}`
        })
        .eq("id", item.id)
        .in("status", ["A_VENCER", "VENCIDO", "GERADO"])
        .select("id");
      if (origErr) throw new Error(`Falha ao cancelar o título original: ${origErr.message}`);
      if (!origUpd || origUpd.length === 0) {
        throw new Error("O título original já não está em situação de prorrogação (pode já ter sido prorrogado). Nenhum novo título foi criado.");
      }

      // (c) Criar o substituto (cópia fiel; só o vencimento muda; ainda não registrado).
      const payloadNovo = {
        id_int: origRow.id_int ?? null,
        id_cliente: origRow.id_cliente ?? null,
        id_empresa: origRow.id_empresa ?? null,
        empresa: origRow.empresa ?? null,
        nome_cliente: origRow.nome_cliente ?? null,
        documento: origRow.documento ?? null,
        n_nf: origRow.n_nf ?? null,
        ext_reference: origRow.ext_reference ?? null,
        parcela: origRow.parcela,
        total_parcelas: origRow.total_parcelas ?? origRow.parcela,
        valor: origRow.valor,
        vencimento: prorrogarNovoVenc,
        descricao: origRow.descricao ?? "",
        multa: origRow.multa ?? 0,
        juros_dia: origRow.juros_dia ?? 0,
        deposito_conta: false,
        status: "A_VENCER",
        is_faturado: origRow.is_faturado ?? true,
        is_avulso: origRow.is_avulso ?? false,
        id_pagamento: origRow.id_pagamento ?? null,
        is_prorrogado: true,
        dias_prorg: diasProrg,
        motivo_prorg: `Prorrogação do título ${origRow.id_pagamento || origRow.id} (venc original ${vencAtual}) por ${confirmadoPor} em ${agoraIso}.${motivoTxt ? ` Motivo: ${motivoTxt}` : ""}`
      };
      const { data: novoBoleto, error: insErr } = await client
        .from("boletos")
        .insert(payloadNovo)
        .select("*")
        .maybeSingle();
      if (insErr || !novoBoleto) {
        throw new Error(`Original cancelado, mas falhou ao criar o novo título: ${insErr?.message || "sem retorno"}.`);
      }

      // (d) Registrar o substituto no banco. Falha aqui = mantém PENDENTE (não fatal).
      let registroOk = false;
      let registroErro = "";
      try {
        const { registerBoletoViaN8n } = await import("@/features/nfe/services/nfe.service");
        const result = await registerBoletoViaN8n(novoBoleto);
        if (result && result.data) {
          const c6 = result.data;
          const updates: Record<string, string | null> = {};
          let vs = "A_VENCER";
          if (c6.status && ["A_RECEBER", "A_VENCER", "PAID", "CANCELADO"].includes(String(c6.status))) {
            vs = String(c6.status);
          }
          updates.status = vs;
          const idB = c6.id_boleto_c6 || c6.id;
          if (idB) updates.id_boleto_c6 = idB;
          if (c6.nosso_numero || c6.our_number) updates.nosso_numero = c6.nosso_numero || c6.our_number;
          if (c6.linha_digitavel || c6.digitable_line) updates.linha_digitavel = c6.linha_digitavel || c6.digitable_line;
          if (c6.codigo_barras || c6.bar_code) updates.codigo_barras = c6.codigo_barras || c6.bar_code;
          const urlPdf = c6.url_pdf || c6.pdf_url || c6.pdfUrl || c6.urlPdf || c6.pdf_storage || c6.url || c6.pdf || null;
          if (urlPdf) updates.url_pdf = urlPdf;
          const pdfStorage = c6.pdf_storage || c6.storage_path || null;
          if (pdfStorage) updates.pdf_storage = pdfStorage;
          await client.from("boletos").update(updates).eq("id", novoBoleto.id);
        }
        registroOk = true;
      } catch (regErr) {
        registroErro = regErr instanceof Error ? regErr.message : String(regErr);
      }

      if (item.id_int) await recalcularBoletoIdIntsLocal(Number(item.id_int));
      setRefreshTrigger((prev) => prev + 1);
      setProrrogarTarget(null);
      setProrrogarNovoVenc("");
      setProrrogarMotivo("");
      setProrrogarBankCancelDone(false);

      if (registroOk) {
        showToast({
          type: "success",
          title: "Boleto prorrogado.",
          description: `Original cancelado no banco e novo boleto registrado para ${formatLocalDate(prorrogarNovoVenc)}.`
        });
      } else {
        showToast({
          type: "warning",
          title: "Prorrogado, mas o registro bancário do novo boleto falhou.",
          description: `O novo título ficou PENDENTE de registro — registre-o depois. ${registroErro}`
        });
      }
    } catch (err) {
      console.error("[ContasReceberPage] falha na prorrogação:", err);
      showToast({
        type: "error",
        title: "Erro na prorrogação",
        description: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setIsProrrogando(false);
    }
  }

  // 2) Cancelar boleto -> depósito futuro: cancela no banco e mantém o recebível
  //    ativo como depósito (sem cobrança bancária). Não marca cancelado/pago.
  async function handleCancelarParaDeposito() {
    const item = depConvertTarget;
    if (!item || isConvertingDep) return;
    const isRegistered = Boolean(item.id_boleto_c6 || item.linha_digitavel || item.nosso_numero);
    if (item.status === "PAID" || item.paid_at || item.status === "CANCELADO") {
      showToast({ type: "warning", title: "Este título não está em situação de cancelamento." });
      setDepConvertTarget(null);
      return;
    }
    const client = getSupabaseClient();
    if (!client) {
      showToast({ type: "error", title: "Supabase não configurado." });
      return;
    }
    setIsConvertingDep(true);
    let bancoCancelado = depConvertBankDone;
    try {
      const idEmpresa = Number(item.id_empresa || 1);
      if (isRegistered && !bancoCancelado) {
        const { consultarDetalhesBoletoC6 } = await import("@/features/cobrancas/services/pagamentos-v2.service");
        const detalhes = await consultarDetalhesBoletoC6(String(item.id_boleto_c6), idEmpresa);
        const statusC6 = String(detalhes?.status || "").toUpperCase();
        const temPagamento = Array.isArray(detalhes?.payments) && detalhes.payments.length > 0;
        if (statusC6 === "PAID" || temPagamento) {
          showToast({
            type: "warning",
            title: "O banco indica este boleto como pago.",
            description: "Cancelamento bloqueado para evitar duplicidade."
          });
          return;
        }
        if (!statusC6.includes("CANCEL")) {
          const { deleteBoletoFromBankViaN8n } = await import("@/features/nfe/services/nfe.service");
          await deleteBoletoFromBankViaN8n(item.id, String(item.id_boleto_c6), idEmpresa);
        }
        bancoCancelado = true;
        setDepConvertBankDone(true);
      }

      const { data: upd, error } = await client
        .from("boletos")
        .update({
          deposito_conta: true,
          id_boleto_c6: null,
          nosso_numero: null,
          linha_digitavel: null,
          codigo_barras: null,
          url_pdf: null,
          pdf_storage: null
        })
        .eq("id", item.id)
        .in("status", ["A_VENCER", "VENCIDO", "GERADO"])
        .select("id");
      if (error) throw new Error(`Falha ao converter em depósito: ${error.message}`);
      if (!upd || upd.length === 0) {
        throw new Error("O título não está mais em situação de conversão.");
      }

      showToast({ type: "success", title: "Boleto cancelado no banco e mantido como depósito futuro." });
      if (item.id_int) await recalcularBoletoIdIntsLocal(Number(item.id_int));
      setDepConvertTarget(null);
      setDepConvertBankDone(false);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error("[ContasReceberPage] falha ao converter boleto em depósito:", err);
      showToast({
        type: "error",
        title: "Erro ao cancelar/converter",
        description: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setIsConvertingDep(false);
    }
  }

  // 3) Editar depósito: altera somente o vencimento pelo serviço oficial.
  async function handleEditarDeposito() {
    const item = editDepTarget;
    if (!item || isEditingDep) return;
    if (item.status === "PAID" || item.paid_at || item.status === "CANCELADO") {
      showToast({ type: "warning", title: "Este depósito não pode ser editado." });
      setEditDepTarget(null);
      return;
    }
    if (!item.deposito_conta) {
      showToast({ type: "warning", title: "Somente depósitos podem ser editados aqui." });
      setEditDepTarget(null);
      return;
    }
    if (!editDepVenc) {
      showToast({ type: "warning", title: "Selecione a nova data de vencimento." });
      return;
    }
    setIsEditingDep(true);
    try {
      const { updateBoletoInDb } = await import("@/features/nfe/services/nfe.service");
      await updateBoletoInDb(item.id, { vencimento: editDepVenc });
      showToast({
        type: "success",
        title: "Depósito atualizado.",
        description: `Vencimento alterado de ${formatLocalDate(String(item.vencimento).slice(0, 10))} para ${formatLocalDate(editDepVenc)}.`
      });
      if (item.id_int) await recalcularBoletoIdIntsLocal(Number(item.id_int));
      setEditDepTarget(null);
      setEditDepVenc("");
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error("[ContasReceberPage] falha ao editar depósito:", err);
      showToast({
        type: "error",
        title: "Erro ao editar depósito",
        description: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setIsEditingDep(false);
    }
  }

  // 4) Transformar depósito -> boleto: muda o tipo e segue para Revisar Geração
  //    Bancária. Se a conversão falhar, mantém como depósito.
  async function handleTransformarEmBoleto() {
    const item = transformTarget;
    if (!item || isTransforming) return;
    if (item.status === "PAID" || item.paid_at || item.status === "CANCELADO") {
      showToast({ type: "warning", title: "Este depósito não pode ser convertido." });
      setTransformTarget(null);
      return;
    }
    if (!item.deposito_conta) {
      showToast({ type: "warning", title: "Somente depósitos podem ser convertidos em boleto." });
      setTransformTarget(null);
      return;
    }
    setIsTransforming(true);
    try {
      const { updateBoletoInDb } = await import("@/features/nfe/services/nfe.service");
      await updateBoletoInDb(item.id, { deposito_conta: false });
      if (item.id_int) await recalcularBoletoIdIntsLocal(Number(item.id_int));
      setRefreshTrigger((prev) => prev + 1);
      // Seguir o fluxo oficial de Revisar Geração Bancária para registrar no banco.
      setSelectedBoletoRef(item.ext_reference || null);
      setSelectedBoletoCliente(item.cliente);
      setSelectedBoletoIdInt(item.id_int || null);
      setReviewModalOpen(true);
      setTransformTarget(null);
      showToast({
        type: "info",
        title: "Depósito convertido em boleto.",
        description: "Revise e registre no banco pela geração bancária. Sem registro, permanece como boleto pendente."
      });
    } catch (err) {
      console.error("[ContasReceberPage] falha ao transformar depósito em boleto:", err);
      showToast({
        type: "error",
        title: "Erro ao converter",
        description: `${err instanceof Error ? err.message : String(err)} O registro permanece como depósito.`
      });
    } finally {
      setIsTransforming(false);
    }
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

  async function handleConfirmarCancelamento() {
    const item = cancelTarget;
    if (!item || isCanceling) return;

    if (item.status === "CANCELADO") {
      setCancelTarget(null);
      return;
    }
    if (item.status === "PAID" || item.paid_at) {
      showToast({ type: "error", title: "Título liquidado não pode ser cancelado." });
      return;
    }

    const isDeposito = item.tipo === "DEPOSITO";
    const registradoNoBanco = !isDeposito && Boolean(item.id_boleto_c6);

    setIsCanceling(true);
    try {
      if (registradoNoBanco) {
        // Regra oficial: cancelar no C6 via n8n antes de qualquer escrita local
        const { deleteBoletoFromBankViaN8n } = await import("@/features/nfe/services/nfe.service");
        await deleteBoletoFromBankViaN8n(item.id, String(item.id_boleto_c6), Number(item.id_empresa || 1));
      }

      const client = getSupabaseClient();
      if (!client) throw new Error("Supabase não configurado.");

      const { error: updateError } = await client
        .from("boletos")
        .update({ status: "CANCELADO" })
        .eq("id", item.id);

      if (updateError) {
        if (registradoNoBanco) {
          // O banco já confirmou o cancelamento; não silenciar a divergência local
          showToast({
            type: "warning",
            title: "Cancelado no banco, mas houve falha ao atualizar o título local.",
            description: updateError.message
          });
        } else {
          throw new Error(updateError.message);
        }
      } else {
        showToast({
          type: "success",
          title: isDeposito
            ? "Depósito em conta cancelado."
            : registradoNoBanco
              ? "Boleto cancelado no banco e no Contas a Receber."
              : "Boleto cancelado no Contas a Receber."
        });
      }

      if (item.id_int) {
        await recalcularBoletoIdIntsLocal(Number(item.id_int));
      }

      setCancelTarget(null);
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error("[ContasReceberPage] falha ao cancelar título:", err);
      showToast({
        type: "error",
        title: registradoNoBanco ? "Erro no cancelamento bancário" : "Erro ao cancelar título",
        description: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setIsCanceling(false);
    }
  }

  const cancelIsDeposito = cancelTarget?.tipo === "DEPOSITO";
  const cancelRegistradoBanco = Boolean(cancelTarget && !cancelIsDeposito && cancelTarget.id_boleto_c6);
  const cancelBloqueado = Boolean(cancelTarget && (cancelTarget.status === "PAID" || cancelTarget.paid_at));

  const confirmIsDeposito = confirmTarget?.tipo === "DEPOSITO";
  const confirmRegistradoBanco = Boolean(confirmTarget && !confirmIsDeposito && confirmTarget.id_boleto_c6);
  const baixaFormValida =
    Boolean(formaRecebimento) &&
    (formaRecebimento !== "OUTROS" || obsRecebimento.trim().length > 0);

  async function handleConfirmarBaixa() {
    const item = confirmTarget;
    if (!item || isConfirmingBaixa) return;

    // 1. Validar se o título ainda pode ser baixado
    if (item.status === "PAID" || item.paid_at || item.status === "CANCELADO") {
      showToast({ type: "warning", title: "Este título não está mais em situação de baixa." });
      setConfirmTarget(null);
      return;
    }

    // 1b. Forma de recebimento é obrigatória; observação obrigatória para OUTROS.
    //     Retorna sem fechar o modal para o usuário corrigir.
    if (!formaRecebimento) {
      showToast({ type: "warning", title: "Selecione a forma de recebimento." });
      return;
    }
    if (formaRecebimento === "OUTROS" && !obsRecebimento.trim()) {
      showToast({ type: "warning", title: "Descreva a forma em Observação (obrigatório para OUTROS)." });
      return;
    }

    const isDeposito = item.tipo === "DEPOSITO";
    const registradoNoBanco = !isDeposito && Boolean(item.id_boleto_c6);
    let bancoCancelado = confirmBankCancelDone;

    setIsConfirmingBaixa(true);
    try {
      // 2. Cancelamento bancário oficial (apenas boleto registrado, uma única vez)
      if (registradoNoBanco && !bancoCancelado) {
        let precisaCancelarNoBanco = true;

        try {
          const { consultarDetalhesBoletoC6 } = await import("@/features/cobrancas/services/pagamentos-v2.service");
          const detalhes = await consultarDetalhesBoletoC6(String(item.id_boleto_c6), Number(item.id_empresa || 1));
          const statusC6 = String(detalhes?.status || "").toUpperCase();
          const temPagamento = Array.isArray(detalhes?.payments) && detalhes.payments.length > 0;

          if (statusC6 === "PAID" || temPagamento) {
            showToast({
              type: "warning",
              title: "O banco informa este boleto como pago.",
              description:
                "Baixa manual bloqueada para evitar duplicidade. Use 'Consultar pagamento C6' para liquidar com a data oficial do banco."
            });
            return;
          }

          // Cobrança já cancelada/inativa no banco: seguir sem novo cancelamento
          if (statusC6.includes("CANCEL")) {
            precisaCancelarNoBanco = false;
          }
        } catch (consultaErr) {
          throw new Error(
            `Não foi possível validar a situação do boleto no banco: ${consultaErr instanceof Error ? consultaErr.message : String(consultaErr)}`
          );
        }

        if (precisaCancelarNoBanco) {
          const { deleteBoletoFromBankViaN8n } = await import("@/features/nfe/services/nfe.service");
          await deleteBoletoFromBankViaN8n(item.id, String(item.id_boleto_c6), Number(item.id_empresa || 1));
        }

        bancoCancelado = true;
        setConfirmBankCancelDone(true);
      }

      // 3. Baixa local pelo padrão oficial do Contas a Receber (status PAID + paid_at + autoria)
      const client = getSupabaseClient();
      if (!client) throw new Error("Supabase não configurado.");

      const paidAt = new Date().toISOString();
      const confirmadoPor =
        usuarioLogado?.nomeUsuario || usuarioLogado?.name || usuarioLogado?.email || "Financeiro";

      const { data: updatedRows, error: updateError } = await client
        .from("boletos")
        .update({
          status: "PAID",
          paid_at: paidAt,
          confirmado_por: confirmadoPor,
          forma_recebimento: formaRecebimento,
          obs_recebimento: obsRecebimento.trim() || null
        })
        .eq("id", item.id)
        .in("status", ["A_VENCER", "VENCIDO", "GERADO"])
        .select("id");

      if (updateError) {
        throw new Error(`Falha na baixa local: ${updateError.message}`);
      }
      if (!updatedRows || updatedRows.length === 0) {
        throw new Error(
          "Falha na baixa local: o título não está mais em situação de baixa (status atual pode ter mudado)."
        );
      }

      showToast({
        type: "success",
        title: isDeposito
          ? "Depósito confirmado como recebido."
          : registradoNoBanco
            ? "Boleto cancelado no banco e recebimento confirmado."
            : "Recebimento confirmado."
      });

      // 4. Atualizar status, cards e listagem
      if (item.id_int) {
        await recalcularBoletoIdIntsLocal(Number(item.id_int));
      }
      setConfirmTarget(null);
      setConfirmBankCancelDone(false);
      setFormaRecebimento("");
      setObsRecebimento("");
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error("[ContasReceberPage] falha ao confirmar recebimento:", err);
      const mensagem = err instanceof Error ? err.message : String(err);
      const falhaAposCancelamento = registradoNoBanco && bancoCancelado;

      showToast({
        type: "error",
        title: falhaAposCancelamento
          ? "Crítico: boleto cancelado no banco, mas a baixa local falhou."
          : mensagem.startsWith("Falha na baixa local")
            ? "Erro na baixa local"
            : "Erro no cancelamento bancário",
        description: falhaAposCancelamento
          ? `${mensagem} Tente novamente — o cancelamento bancário não será repetido.`
          : mensagem
      });
    } finally {
      setIsConfirmingBaixa(false);
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
    { id: "BOLETOS", label: "Boletos" },
    { id: "DEPOSITOS", label: "Depósitos" },
    { id: "CARTOES", label: "Cartões a receber" },
    { id: "PREVISAO", label: "Previsão de recebimento" }
  ];

  return (
    <div className="space-y-6" data-contas-receber-source={dataSource}>
      <PageHeader
        title="Contas a receber"
        subtitle="Carteira financeira de boletos e previsões para acompanhamento de fluxos operacionais e recebíveis."
        context="Financeiro / Gestão de recebíveis"
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="flex flex-col gap-2 rounded-3xl border border-[#d7e5e8] bg-white p-6 shadow-sm">
          <span className="text-sm font-semibold text-slate-500 flex items-center gap-2">Período de consulta</span>
          <div className="flex gap-2 w-full mt-2">
            <input
              type="date"
              value={dataInicial}
              onChange={(event) => setFilter("ini", event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none"
              aria-label="Data inicial"
            />
            <input
              type="date"
              value={dataFinal}
              onChange={(event) => setFilter("fim", event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none"
              aria-label="Data final"
            />
          </div>
        </div>
        <SummaryCard title="Vencidos reais" value={formatCurrency(resumo.vencidos)} description="Cobranças vencidas reais (A Receber expirado / Vencido)." tone="danger" icon={AlertTriangle} />
        <SummaryCard title="Previsão futura" value={formatCurrency(resumo.previsaoFutura)} description="Previsões financeiras e recebíveis futuros de caixa." tone="info" icon={Wallet} />
        <SummaryCard title="Pagos" value={formatCurrency(resumo.pagos)} description="Cobranças e premissas quitadas no período." tone="success" icon={TrendingUp} />
      </section>

      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-8">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 xl:col-span-2">
            <Search className="h-4 w-4 text-[#0f9f9a] shrink-0" />
            <input
              value={buscaDigitada}
              onChange={(event) => setBuscaDigitada(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-900 outline-none"
              placeholder="Buscar por cliente, id, pagamento, OS ou CPF/CNPJ"
            />
          </label>

          <select value={empresa} onChange={(event) => setFilter("emp", event.target.value)} className={filterClass}>
            <option value="TODAS">Todas as empresas</option>
            {empresaOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <select value={status} onChange={(event) => setFilter("status", event.target.value as StatusFilter)} className={filterClass}>
            <option value="TODOS">Todos status</option>
            <option value="A_VENCER">Previsão futura / E-Faturado (A Vencer)</option>
            <option value="VENCIDOS">Vencidos</option>
            <option value="PAID">Pagos</option>
            <option value="CANCELADO">Cancelados</option>
            <option value="NAO_REGISTRADO">Boletos não registrados</option>
          </select>

          <button
            type="button"
            onClick={() => {
              // Volta os filtros ao padrão, o que os remove da URL. A aba continua
              // onde está: limpar filtros nunca mudou de aba nesta tela.
              setFilters({
                q: "",
                emp: "TODAS",
                status: "TODOS",
                ini: firstDayOfMonth,
                fim: lastDayOfMonth
              });
              setBuscaDigitada("");
              setTipo("TODOS");
              setIsAvulsoFilter("TODOS");
              setIsFaturadoFilter("TODOS");
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
              onClick={() => setFilter("aba", tab.id)}
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

      {activeTab === "BOLETOS" || activeTab === "DEPOSITOS" ? (
        <BoletosDepositosTab
          items={filteredBoletos.filter(item => activeTab === "BOLETOS" ? item.tipo === "BOLETO" : item.tipo === "DEPOSITO")}
          today={today}
          onConfirm={confirmRecebimento}
          onCancel={cancelRecebivel}
          onCopy={copyLinhaDigitavel}
          onPdf={openPdf}
          onProrrogar={abrirProrrogar}
          onLifecycle={{
            cancelarParaDeposito: (item) => {
              setDepConvertBankDone(false);
              setDepConvertTarget(item);
            },
            editarDeposito: (item) => {
              setEditDepVenc(String(item.vencimento).slice(0, 10));
              setEditDepTarget(item);
            },
            transformarEmBoleto: (item) => setTransformTarget(item)
          }}
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

            {activeTab === "CARTOES" ? <CartoesFaturadoTab items={recebiveis} today={today} /> : null}
      {activeTab === "PREVISAO" ? <PrevisaoCaixaTab items={filteredRecebiveis} itemsSemData={filteredRecebiveisSemData} boletos={filteredBoletos} today={today} dataInicial={dataInicial} dataFinal={dataFinal} /> : null}

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

      {confirmTarget && (
        <div className="fixed inset-0 z-[10000] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden p-6 transform transition-all scale-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="p-3 bg-teal-50 text-teal-600 rounded-2xl">
                <Wallet className="h-8 w-8" />
              </div>
              <div className="space-y-2">
                <h4 className="text-base font-bold text-slate-900">Confirmar recebimento?</h4>
                <p className="text-xs text-slate-500 leading-relaxed text-left">
                  {confirmIsDeposito
                    ? "O título de depósito em conta será baixado como PAGO no Contas a Receber."
                    : confirmRegistradoBanco
                      ? confirmBankCancelDone
                        ? "O cancelamento bancário já foi concluído. Ao confirmar, apenas a baixa local será executada novamente."
                        : "Este boleto possui registro bancário ativo. A confirmação irá primeiro CANCELAR o boleto no C6 Bank pela integração oficial e, somente após a resposta positiva do banco, o título será baixado como PAGO. Se o banco indicar o boleto como pago, a baixa manual será bloqueada."
                      : "O título será baixado como PAGO no Contas a Receber."}
                </p>
              </div>
              <div className="w-full rounded-2xl bg-slate-50 border border-slate-100 p-3 text-left text-xs text-slate-600 space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400 font-semibold">Cliente</span>
                  <span className="font-medium text-slate-800 truncate">{confirmTarget.cliente}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400 font-semibold">Valor</span>
                  <span className="font-mono font-semibold text-slate-800">{formatCurrency(confirmTarget.valor)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400 font-semibold">Vencimento</span>
                  <span className="font-mono font-medium text-slate-800">{formatLocalDate(confirmTarget.vencimento)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400 font-semibold">Tipo</span>
                  <span className="font-medium text-slate-800">
                    {confirmIsDeposito
                      ? "Depósito em conta"
                      : confirmRegistradoBanco
                        ? "Boleto registrado no banco"
                        : "Boleto sem registro bancário"}
                  </span>
                </div>
              </div>

              {!confirmIsDeposito && (
                <div className="w-full rounded-2xl bg-amber-50 border border-amber-200 p-3 text-left text-[11px] leading-relaxed text-amber-800">
                  Esta ação confirma um <strong>pagamento recebido fora do boleto</strong> (ex.: PIX, dinheiro).
                  {confirmRegistradoBanco
                    ? " O boleto registrado no banco será cancelado no C6 antes da baixa."
                    : ""}
                </div>
              )}

              <div className="w-full text-left space-y-1.5">
                <label htmlFor="forma-recebimento" className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Forma de recebimento <span className="text-red-500">*</span>
                </label>
                <select
                  id="forma-recebimento"
                  value={formaRecebimento}
                  disabled={isConfirmingBaixa}
                  onChange={(event) => setFormaRecebimento(event.target.value as FormaRecebimento | "")}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-teal-500 disabled:bg-slate-50"
                >
                  <option value="">Selecione…</option>
                  {FORMAS_RECEBIMENTO.map((forma) => (
                    <option key={forma.value} value={forma.value}>
                      {forma.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="w-full text-left space-y-1.5">
                <label htmlFor="obs-recebimento" className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Observação{" "}
                  {formaRecebimento === "OUTROS" ? (
                    <span className="text-red-500">*</span>
                  ) : (
                    <span className="font-normal normal-case text-slate-400">(opcional)</span>
                  )}
                </label>
                <textarea
                  id="obs-recebimento"
                  value={obsRecebimento}
                  disabled={isConfirmingBaixa}
                  onChange={(event) => setObsRecebimento(event.target.value)}
                  rows={2}
                  placeholder={formaRecebimento === "OUTROS" ? "Descreva a forma de recebimento" : "Observação do recebimento (opcional)"}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-teal-500 disabled:bg-slate-50"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3 justify-stretch">
              <button
                type="button"
                disabled={isConfirmingBaixa}
                onClick={() => {
                  setConfirmTarget(null);
                  setConfirmBankCancelDone(false);
                  setFormaRecebimento("");
                  setObsRecebimento("");
                }}
                className="flex-1 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-slate-200 rounded-xl transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isConfirmingBaixa || !baixaFormValida}
                title={!baixaFormValida ? "Selecione a forma de recebimento (e a observação, quando OUTROS)." : undefined}
                onClick={() => void handleConfirmarBaixa()}
                className="flex-1 py-2.5 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isConfirmingBaixa ? "Processando..." : "Confirmar recebimento"}
              </button>
            </div>
          </div>
        </div>
      )}

      {prorrogarTarget && (
        <div className="fixed inset-0 z-[10000] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden p-6 transform transition-all scale-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="p-3 bg-amber-50 text-amber-500 rounded-2xl">
                <CalendarDays className="h-8 w-8" />
              </div>
              <div className="space-y-2">
                <h4 className="text-base font-bold text-slate-900">Prorrogar vencimento?</h4>
                <p className="text-xs text-slate-500 leading-relaxed text-left">
                  O boleto atual será <strong>cancelado no banco</strong> e <strong>substituído</strong> por um novo boleto com o novo vencimento, registrado pela integração oficial. Valor, cliente, proposta, descrição, multa e juros são preservados.
                </p>
              </div>
              <div className="w-full rounded-2xl bg-slate-50 border border-slate-100 p-3 text-left text-xs text-slate-600 space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400 font-semibold">Cliente</span>
                  <span className="font-medium text-slate-800 truncate">{prorrogarTarget.cliente}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400 font-semibold">Valor</span>
                  <span className="font-mono font-semibold text-slate-800">{formatCurrency(prorrogarTarget.valor)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400 font-semibold">Vencimento atual</span>
                  <span className="font-mono font-medium text-slate-800">{formatLocalDate(prorrogarTarget.vencimento)}</span>
                </div>
              </div>
              <div className="w-full text-left space-y-1.5">
                <label htmlFor="prorrogar-venc" className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Nova data de vencimento <span className="text-red-500">*</span>
                </label>
                <input
                  id="prorrogar-venc"
                  type="date"
                  value={prorrogarNovoVenc}
                  min={today}
                  disabled={isProrrogando}
                  onChange={(event) => setProrrogarNovoVenc(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-amber-500 disabled:bg-slate-50 font-mono"
                />
              </div>
              <div className="w-full text-left space-y-1.5">
                <label htmlFor="prorrogar-motivo" className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Motivo <span className="font-normal normal-case text-slate-400">(opcional)</span>
                </label>
                <textarea
                  id="prorrogar-motivo"
                  value={prorrogarMotivo}
                  disabled={isProrrogando}
                  onChange={(event) => setProrrogarMotivo(event.target.value)}
                  rows={2}
                  placeholder="Motivo da prorrogação"
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-amber-500 disabled:bg-slate-50"
                />
              </div>
            </div>
            <div className="mt-6 flex items-center gap-3 justify-stretch">
              <button
                type="button"
                disabled={isProrrogando}
                onClick={() => {
                  setProrrogarTarget(null);
                  setProrrogarNovoVenc("");
                  setProrrogarMotivo("");
                  setProrrogarBankCancelDone(false);
                }}
                className="flex-1 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-slate-200 rounded-xl transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isProrrogando || !prorrogarNovoVenc}
                onClick={() => void handleProrrogar()}
                className="flex-1 py-2.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isProrrogando ? "Processando..." : "Prorrogar vencimento"}
              </button>
            </div>
          </div>
        </div>
      )}

      {depConvertTarget && (
        <div className="fixed inset-0 z-[10000] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden p-6 transform transition-all scale-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="p-3 bg-orange-50 text-orange-500 rounded-2xl">
                <AlertTriangle className="h-8 w-8" />
              </div>
              <div className="space-y-2">
                <h4 className="text-base font-bold text-slate-900">Cancelar boleto e manter como depósito?</h4>
                <p className="text-xs text-slate-500 leading-relaxed text-left">
                  Este boleto será cancelado no banco e o recebível continuará ativo como <strong>depósito futuro</strong>, sem cobrança bancária. Valor, cliente, proposta, vencimento e histórico são preservados.
                </p>
              </div>
              <div className="w-full rounded-2xl bg-slate-50 border border-slate-100 p-3 text-left text-xs text-slate-600 space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400 font-semibold">Cliente</span>
                  <span className="font-medium text-slate-800 truncate">{depConvertTarget.cliente}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400 font-semibold">Valor</span>
                  <span className="font-mono font-semibold text-slate-800">{formatCurrency(depConvertTarget.valor)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400 font-semibold">Vencimento</span>
                  <span className="font-mono font-medium text-slate-800">{formatLocalDate(depConvertTarget.vencimento)}</span>
                </div>
              </div>
            </div>
            <div className="mt-6 flex items-center gap-3 justify-stretch">
              <button
                type="button"
                disabled={isConvertingDep}
                onClick={() => {
                  setDepConvertTarget(null);
                  setDepConvertBankDone(false);
                }}
                className="flex-1 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-slate-200 rounded-xl transition disabled:opacity-50"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={isConvertingDep}
                onClick={() => void handleCancelarParaDeposito()}
                className="flex-1 py-2.5 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 rounded-xl transition disabled:opacity-60"
              >
                {isConvertingDep ? "Processando..." : "Cancelar → depósito"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editDepTarget && (
        <div className="fixed inset-0 z-[10000] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden p-6 transform transition-all scale-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
                <CalendarDays className="h-8 w-8" />
              </div>
              <div className="space-y-2">
                <h4 className="text-base font-bold text-slate-900">Editar depósito</h4>
                <p className="text-xs text-slate-500 leading-relaxed text-left">
                  Altere a data de vencimento do depósito. Valor, cliente e proposta permanecem inalterados.
                </p>
              </div>
              <div className="w-full rounded-2xl bg-slate-50 border border-slate-100 p-3 text-left text-xs text-slate-600 space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400 font-semibold">Cliente</span>
                  <span className="font-medium text-slate-800 truncate">{editDepTarget.cliente}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400 font-semibold">Valor</span>
                  <span className="font-mono font-semibold text-slate-800">{formatCurrency(editDepTarget.valor)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400 font-semibold">Vencimento atual</span>
                  <span className="font-mono font-medium text-slate-800">{formatLocalDate(editDepTarget.vencimento)}</span>
                </div>
              </div>
              <div className="w-full text-left space-y-1.5">
                <label htmlFor="edit-dep-venc" className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Nova data de vencimento <span className="text-red-500">*</span>
                </label>
                <input
                  id="edit-dep-venc"
                  type="date"
                  value={editDepVenc}
                  disabled={isEditingDep}
                  onChange={(event) => setEditDepVenc(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-blue-500 disabled:bg-slate-50 font-mono"
                />
              </div>
            </div>
            <div className="mt-6 flex items-center gap-3 justify-stretch">
              <button
                type="button"
                disabled={isEditingDep}
                onClick={() => {
                  setEditDepTarget(null);
                  setEditDepVenc("");
                }}
                className="flex-1 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-slate-200 rounded-xl transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isEditingDep || !editDepVenc}
                onClick={() => void handleEditarDeposito()}
                className="flex-1 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isEditingDep ? "Salvando..." : "Salvar vencimento"}
              </button>
            </div>
          </div>
        </div>
      )}

      {transformTarget && (
        <div className="fixed inset-0 z-[10000] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden p-6 transform transition-all scale-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="p-3 bg-sky-50 text-sky-600 rounded-2xl">
                <TrendingUp className="h-8 w-8" />
              </div>
              <div className="space-y-2">
                <h4 className="text-base font-bold text-slate-900">Transformar depósito em boleto?</h4>
                <p className="text-xs text-slate-500 leading-relaxed text-left">
                  O recebível manterá valor, cliente, proposta e vencimento, mudará para <strong>boleto</strong> e seguirá para &quot;Revisar Geração Bancária&quot; para registro no banco. Se não for registrado, permanece como boleto pendente.
                </p>
              </div>
              <div className="w-full rounded-2xl bg-slate-50 border border-slate-100 p-3 text-left text-xs text-slate-600 space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400 font-semibold">Cliente</span>
                  <span className="font-medium text-slate-800 truncate">{transformTarget.cliente}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400 font-semibold">Valor</span>
                  <span className="font-mono font-semibold text-slate-800">{formatCurrency(transformTarget.valor)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400 font-semibold">Vencimento</span>
                  <span className="font-mono font-medium text-slate-800">{formatLocalDate(transformTarget.vencimento)}</span>
                </div>
              </div>
            </div>
            <div className="mt-6 flex items-center gap-3 justify-stretch">
              <button
                type="button"
                disabled={isTransforming}
                onClick={() => setTransformTarget(null)}
                className="flex-1 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-slate-200 rounded-xl transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isTransforming}
                onClick={() => void handleTransformarEmBoleto()}
                className="flex-1 py-2.5 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl transition disabled:opacity-60"
              >
                {isTransforming ? "Processando..." : "Transformar em boleto"}
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelTarget && (
        <div className="fixed inset-0 z-[10000] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden p-6 transform transition-all scale-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex flex-col items-center text-center gap-4">
              <div className={`p-3 rounded-2xl ${cancelBloqueado ? "bg-slate-100 text-slate-500" : "bg-red-50 text-red-500"}`}>
                <AlertTriangle className="h-8 w-8" />
              </div>
              <div className="space-y-2">
                <h4 className="text-base font-bold text-slate-900">
                  {cancelBloqueado
                    ? "Cancelamento não permitido"
                    : cancelIsDeposito
                      ? "Cancelar depósito em conta?"
                      : "Cancelar boleto?"}
                </h4>
                <p className="text-xs text-slate-500 leading-relaxed text-left">
                  {cancelBloqueado
                    ? "Este título está liquidado (pago) e não pode ser cancelado pela regra financeira."
                    : cancelIsDeposito
                      ? "O título de depósito em conta será marcado como CANCELADO no Contas a Receber. Não há registro bancário envolvido e o histórico é preservado pela auditoria."
                      : cancelRegistradoBanco
                        ? "O boleto será cancelado no C6 Bank pela integração oficial. Somente após a confirmação do banco o título será marcado como CANCELADO no Contas a Receber. Em caso de falha bancária, nada é alterado."
                        : "Este boleto ainda não possui registro bancário. O título será marcado como CANCELADO apenas no Contas a Receber, com histórico preservado pela auditoria."}
                </p>
              </div>
              <div className="w-full rounded-2xl bg-slate-50 border border-slate-100 p-3 text-left text-xs text-slate-600 space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400 font-semibold">Cliente</span>
                  <span className="font-medium text-slate-800 truncate">{cancelTarget.cliente}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400 font-semibold">Valor</span>
                  <span className="font-mono font-semibold text-slate-800">{formatCurrency(cancelTarget.valor)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400 font-semibold">Tipo</span>
                  <span className="font-medium text-slate-800">
                    {cancelIsDeposito
                      ? "Depósito em conta"
                      : cancelRegistradoBanco
                        ? "Boleto registrado no banco"
                        : "Boleto sem registro bancário"}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3 justify-stretch">
              <button
                type="button"
                disabled={isCanceling}
                onClick={() => setCancelTarget(null)}
                className="flex-1 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-slate-200 rounded-xl transition disabled:opacity-50"
              >
                {cancelBloqueado ? "Fechar" : "Voltar"}
              </button>
              {!cancelBloqueado && (
                <button
                  type="button"
                  disabled={isCanceling}
                  onClick={() => void handleConfirmarCancelamento()}
                  className="flex-1 py-2.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition disabled:opacity-60"
                >
                  {isCanceling ? "Cancelando..." : "Confirmar cancelamento"}
                </button>
              )}
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
  onGerarPdfBoleto,
  onLifecycle
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
  onLifecycle?: BoletoLifecycleOps;
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
                  <BoletoActions item={item} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onProrrogar={onProrrogar!} onLifecycle={onLifecycle} onDetail={onDetail} onNavigate={onNavigate} onRegister={onRegister!} onDeleteFromBank={onDeleteFromBank!} onConsultaC6={onConsultaC6} onConsultarPdf={onConsultarPdf} onGerarPdfBoleto={onGerarPdfBoleto} />
                </div>
              );
            }, align: "right" }
          ]}
          renderCard={(item) => <RecebivelCard key={item.id} item={item} today={today} onRegister={onRegister!} actions={<BoletoActions item={item} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onProrrogar={onProrrogar!} onLifecycle={onLifecycle} onDetail={onDetail} onNavigate={onNavigate} onRegister={onRegister!} onDeleteFromBank={onDeleteFromBank!} onConsultaC6={onConsultaC6} onConsultarPdf={onConsultarPdf} onGerarPdfBoleto={onGerarPdfBoleto} label="Mais" />} />}
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
  onGerarPdfBoleto,
  onLifecycle
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
  onLifecycle: BoletoLifecycleOps;
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
      <GroupedSection title="Vencidos" tone="danger" items={vencidos} today={today} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} isBoletoTab onProrrogar={onProrrogar} onLifecycle={onLifecycle} onRegister={onRegister} onDeleteFromBank={onDeleteFromBank} onConsultaC6={onConsultaC6} onConsultarPdf={onConsultarPdf} onGerarPdfBoleto={onGerarPdfBoleto} />
      <GroupedSection title="Previsão futura / E-Faturado" tone="info" items={previsaoFutura} today={today} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} isBoletoTab onProrrogar={onProrrogar} onLifecycle={onLifecycle} onRegister={onRegister} onDeleteFromBank={onDeleteFromBank} onConsultaC6={onConsultaC6} onConsultarPdf={onConsultarPdf} onGerarPdfBoleto={onGerarPdfBoleto} />
      <GroupedSection title="Pagos" tone="success" items={pagos} today={today} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} isBoletoTab onProrrogar={onProrrogar} onLifecycle={onLifecycle} onRegister={onRegister} onDeleteFromBank={onDeleteFromBank} onConsultaC6={onConsultaC6} onConsultarPdf={onConsultarPdf} onGerarPdfBoleto={onGerarPdfBoleto} />
      <GroupedSection title="Cancelados" tone="neutral" items={cancelados} today={today} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} isBoletoTab onProrrogar={onProrrogar} onLifecycle={onLifecycle} onRegister={onRegister} onDeleteFromBank={onDeleteFromBank} onConsultaC6={onConsultaC6} onConsultarPdf={onConsultarPdf} onGerarPdfBoleto={onGerarPdfBoleto} />
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

function getFirstDayOfMonth(baseDate: string, addMonths: number) {
  const date = new Date(`${baseDate}T00:00:00-03:00`);
  date.setMonth(date.getMonth() + addMonths);
  date.setDate(1);
  return date.toISOString().slice(0, 10);
}

function getLastDayOfMonth(baseDate: string, addMonths: number) {
  const date = new Date(`${baseDate}T00:00:00-03:00`);
  date.setMonth(date.getMonth() + addMonths + 1);
  date.setDate(0);
  return date.toISOString().slice(0, 10);
}

function formatSubtitle(start: string, end: string) {
  const s = start.split("-");
  const e = end.split("-");
  return `de ${s[2]}/${s[1]} até ${e[2]}/${e[1]} ${e[0]}`;
}

function calculatePrevisaoFixed(items: BoletoDepositoMock[], today: string) {
  const w1End = addDays(today, 6);
  const qEnd = addDays(today, 14); // Quinzena = 15 dias (hoje + 14)
  
  const m30End = addDays(today, 30);
  const m90End = addDays(today, 90);
  
  const ranges = [
    { label: "Semana atual", start: today, end: w1End, subtitle: formatSubtitle(today, w1End) },
    { label: "Quinzena", start: today, end: qEnd, subtitle: formatSubtitle(today, qEnd) },
    { label: "Até 30 dias", start: today, end: m30End, subtitle: formatSubtitle(today, m30End) },
    { label: "Até 90 dias", start: today, end: m90End, subtitle: formatSubtitle(today, m90End) },
  ];
  
  return ranges.map(range => {
    const total = items
      .filter(item => {
        const vDate = item.vencimento ? item.vencimento.slice(0, 10) : "";
        return vDate >= range.start && vDate <= range.end;
      })
      .reduce((sum, item) => sum + (item.valor_atualizado ?? item.valor), 0);
      
    return { ...range, total };
  });
}

function PrevisaoCaixaTab({ items, itemsSemData, boletos, today, dataInicial, dataFinal }: { items: BoletoDepositoMock[]; itemsSemData?: BoletoDepositoMock[]; boletos: BoletoDepositoMock[]; today: string; dataInicial: string; dataFinal: string }) {
  const previsaoItems = items.filter((item) => isAllowedTipo(item.tipo) && item.status === "A_VENCER");
  const previsaoItemsSemData = (itemsSemData || items).filter((item) => isAllowedTipo(item.tipo) && item.status === "A_VENCER");
  
  const weekly = calculatePrevisaoFixed(previsaoItemsSemData, today);
  
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
          </div>
        </div>
        <div className="space-y-3">
          {weekly.map((row) => (
            <div key={row.label} className="rounded-2xl bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <div className="flex flex-col">
                  <span className="font-semibold text-slate-700">{row.label}</span>
                  <span className="text-xs text-slate-500">{row.subtitle}</span>
                </div>
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
  const { user } = useAuth();
  const canAdmin = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "contas_receber.admin");
  const canBaixa = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "contas_receber.baixa");

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
    { label: "Abrir PDF Boleto", disabled: !item.url_pdf && !item.pdf_storage, onClick: () => onPdf(item.url_pdf || item.pdf_storage) }
  );

  if (canBaixa) {
    actionItems.push({ label: "Confirmar recebimento", disabled: item.status === "PAID" || item.status === "CANCELADO", onClick: () => onConfirm(item.id) });
  }

  if (canAdmin) {
    actionItems.push({ label: "Cancelar recebível", destructive: true, disabled: item.status === "CANCELADO" || item.status === "PAID", onClick: () => onCancel(item.id) });
  }

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
  onLifecycle,
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
  onLifecycle?: BoletoLifecycleOps;
  label?: string;
}) {
  const isRegistered = !!(item.id_boleto_c6 || item.nosso_numero || item.linha_digitavel);
  const showRegister = !!onRegister && item.tipo === "BOLETO" && !item.deposito_conta && !isRegistered && item.status !== "PAID" && item.status !== "CANCELADO";
  const showDelete = !!onDeleteFromBank && item.tipo === "BOLETO" && !item.deposito_conta && isRegistered && item.status !== "PAID" && item.status !== "CANCELADO";
  const showConsultaC6 = !!item.id_boleto_c6 && item.status !== "PAID" && item.tipo === "BOLETO";
  const showConsultarPdf = !!item.id_boleto_c6 && !item.url_pdf && !item.pdf_storage && item.tipo === "BOLETO";

  const { user } = useAuth();
  const canAdmin = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "contas_receber.admin");
  const canBaixa = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "contas_receber.baixa");

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

  if (showRegister && canAdmin) {
    actionItems.push({ label: "Registrar boleto", onClick: () => onRegister!(item) });
  }

  if (showDelete && canAdmin) {
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
    { label: "Abrir PDF Boleto", disabled: !item.url_pdf && !item.pdf_storage, onClick: () => onPdf(item.url_pdf || item.pdf_storage) }
  );

  if (canBaixa) {
    actionItems.push({ label: "Confirmar recebimento", disabled: item.status === "PAID" || item.status === "CANCELADO", onClick: () => onConfirm(item.id) });
  }

  const naoOperavel = item.status === "PAID" || item.status === "CANCELADO" || !!item.paid_at;

  if (canAdmin) {
    if (item.deposito_conta) {
      // Depósito: editar vencimento, transformar em boleto, cancelar (total).
      if (onLifecycle) {
        actionItems.push({ label: "Editar depósito", disabled: naoOperavel, onClick: () => onLifecycle.editarDeposito(item) });
        actionItems.push({ label: "Transformar em boleto", disabled: naoOperavel, onClick: () => onLifecycle.transformarEmBoleto(item) });
      }
      actionItems.push({ label: "Cancelar recebível", destructive: true, disabled: naoOperavel, onClick: () => onCancel(item.id) });
    } else {
      // Boleto: prorrogar (só registrado) e cancelar -> depósito futuro.
      if (isRegistered) {
        actionItems.push({ label: "Prorrogar vencimento", disabled: naoOperavel, onClick: () => onProrrogar(item.id) });
      }
      if (onLifecycle) {
        actionItems.push({ label: "Cancelar boleto", destructive: true, disabled: naoOperavel, onClick: () => onLifecycle.cancelarParaDeposito(item) });
      }
    }
  }

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
      <p className="mt-2 text-sm font-semibold text-slate-900 break-words break-all">{value}</p>
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

function buildResumoVisible(recebiveis: BoletoDepositoMock[], recebiveisSemData: BoletoDepositoMock[], today: string) {
  const carteira = recebiveis.filter((item) => isAllowedTipo(item.tipo));
  const carteiraSemData = recebiveisSemData.filter((item) => isAllowedTipo(item.tipo));

  return {
    vencidos: carteiraSemData.filter((item) => isVisualVencido(item, today)).reduce((total, item) => total + (item.valor_atualizado ?? item.valor), 0),
    carteiraAtiva: 0, // A_RECEBER completely excluded from cards
    previsaoFutura: carteiraSemData.filter((item) => item.status === "A_VENCER").reduce((total, item) => total + (item.valor_atualizado ?? item.valor), 0),
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
