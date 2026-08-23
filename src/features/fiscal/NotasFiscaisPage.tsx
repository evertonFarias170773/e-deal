"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useDebouncedInput } from "@/hooks/useDebouncedValue";
import { codecs } from "@/lib/url-state";
import { AlertTriangle, Copy, ExternalLink, FileText, Play, Loader2, CheckCircle2, X } from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { PageHeader } from "@/components/common/PageHeader";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useAppToast } from "@/components/common/AppToast";
import { formatCurrency } from "@/lib/formatters/currency";
import { humanizeStatus } from "@/lib/formatters/status";
import { useNfeReadOnlyData } from "@/features/nfe/hooks/useNfeReadOnlyData";
import { useNfseReadOnlyData } from "@/features/nfse/hooks/useNfseReadOnlyData";
import type { NfeReadModel, SupabaseNfePagamentoRow } from "@/features/nfe/types";
import type { NfseReadModel } from "@/features/nfse/types";
import type { SupabaseBoletoRow } from "@/features/contas-a-receber/types.supabase";
import { useRouter } from "next/navigation";
import { createOrReuseNfeDraft, getFaturaveisPropostas, updateNfeDraft, previewNfeRascunho, getNfeFinanceiroStatus, launchBoletosForNfe, getNfePagamentos, getNfeDisplayStatus, prepararEnvioNfe, insertNotaEvento, getNotaEventosForRefs, type SupabaseNotaEventoRow } from "@/features/nfe/services/nfe.service";
import { RevisarGeracaoBancariaModal } from "@/features/contas-a-receber/components/RevisarGeracaoBancariaModal";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";

// Fase 1 MVP
import type { FaturavelOrigem } from "./types";
import { EmissaoNfeModal } from "./components/EmissaoNfeModal";
import { ConferenciaFaturamentoModal } from "./components/ConferenciaFaturamentoModal";
import { conferirFaturamento, type ResultadoConferencia } from "./services/conferencia-faturamento";

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
function parseFocusResponse(data: any): { success: boolean; message: string } {
  if (!data) {
    return { success: false, message: "Resposta do servidor vazia." };
  }

  const normalized = Array.isArray(data) ? data[0] : data;
  const body = normalized?.body ?? normalized;

  const statusCode = Number(normalized?.statusCode ?? body?.statusCode ?? normalized?.status_code ?? body?.status_code ?? 200);
  if (statusCode >= 400) {
    const errMsg = body?.erro?.mensagem || body?.error || body?.message || body?.mensagem || "Erro processado pelo webhook.";
    return { success: false, message: `${errMsg} (Status: ${statusCode})` };
  }

  if (body.erro) {
    if (typeof body.erro === "object") {
      return { success: false, message: body.erro.mensagem || body.erro.message || JSON.stringify(body.erro) };
    }
    return { success: false, message: String(body.erro) };
  }

  if (body.error || body.errors) {
    const err = body.error || body.errors;
    return { success: false, message: typeof err === "object" ? (err.message || JSON.stringify(err)) : String(err) };
  }

  if (body.status === "erro" || body.status === "rejeitado" || body.status === "erro_autorizacao") {
    return { success: false, message: body.mensagem || body.mensagem_sefaz || "Erro retornado pela SEFAZ/Focus API." };
  }

  if (body.codigo) {
    const lowerCode = String(body.codigo).toLowerCase();
    const successCodes = ["100", "135", "sucesso", "autorizado", "cancelado", "cce_registrada"];
    if (!successCodes.includes(lowerCode)) {
      return { success: false, message: body.mensagem || body.mensagem_sefaz || `Erro retornado pela API (Código: ${body.codigo})` };
    }
  }

  if (body.mensagem_sefaz && (body.mensagem_sefaz.toLowerCase().includes("rejeicao") || body.mensagem_sefaz.toLowerCase().includes("rejeição"))) {
    return { success: false, message: body.mensagem_sefaz };
  }

  return { success: true, message: "Operação realizada com sucesso." };
}

function getFormaPagamentoLabel(forma: string) {
  if (forma === "01") return "Dinheiro";
  if (forma === "02") return "Cheque";
  if (forma === "03") return "Cartão de Crédito";
  if (forma === "04") return "Cartão de Débito";
  if (forma === "05") return "Crédito Loja";
  if (forma === "10") return "Vale Alimentação";
  if (forma === "11") return "Vale Refeição";
  if (forma === "12") return "Vale Presente";
  if (forma === "13") return "Vale Combustível";
  if (forma === "14") return "Duplicata Mercantil";
  if (forma === "15") return "Boleto Bancário";
  if (forma === "16") return "Depósito Bancário";
  if (forma === "17") return "PIX";
  if (forma === "18") return "Transferência Bancária";
  if (forma === "19") return "Fidelidade";
  return `Outros (${forma})`;
}

type ActiveTab = "FILA_FATURAMENTO" | "HISTORICO_FISCAL";

/**
 * Filtros na URL. NF-e (produto) e NFS-e (serviço) têm conjuntos próprios, com
 * prefixo, para não sobrescreverem um ao outro — os dois convivem na mesma URL.
 * Vazio significa "todos" e, por ser o padrão, não entra na URL.
 */
const ABAS = ["FILA_FATURAMENTO", "HISTORICO_FISCAL"] as const;
const EMPRESAS_EMITENTES = ["", "1", "2", "3"] as const;
const STATUS_NFE = [
  "",
  "PENDENTE",
  "PRONTA_PARA_ENVIO",
  "PROCESSANDO",
  "AUTORIZADA",
  "ERRO_ENVIO",
  "ERRO_AUTORIZACAO",
  "REJEITADA",
  "CANCELADA",
  "DENEGADA",
  "FALHA_INTEGRACAO",
  "RETORNO_FOCUS",
  "NAO_ENCONTRADA_FOCUS"
] as const;
const STATUS_NFSE = [
  "",
  "PENDENTE",
  "PRONTA_PARA_ENVIO",
  "PROCESSANDO",
  "AUTORIZADA",
  "ERRO_ENVIO",
  "REJEITADA",
  "CANCELADA"
] as const;

/**
 * `E-Faturado` e `E-FATURADO` convivem na base — 173 e 104 registros. A leitura
 * normaliza; os registros ficam como estão.
 */
function ehFaturado(tipoCobranca: string | null | undefined): boolean {
  return String(tipoCobranca ?? "").trim().toUpperCase() === "E-FATURADO";
}

/** Rótulo legível da forma de cobrança, com destaque suave só no faturado. */
function EtiquetaCobranca({ tipo }: { tipo?: string | null }) {
  const texto = String(tipo ?? "").trim();
  if (!texto) {
    return <span className="text-xs text-slate-400">Sem cobrança</span>;
  }

  const NOMES: Record<string, string> = {
    "E-FATURADO": "Faturado",
    PIX: "PIX",
    BOLETO: "Boleto",
    CARD_PARCELADO: "Cartão parcelado",
    CREDIT_CARD: "Cartão",
    "E-CREDITO": "Crédito"
  };
  const chave = texto.toUpperCase();
  const rotulo = NOMES[chave] || texto;

  const estilo = ehFaturado(texto)
    ? "border-amber-200 bg-amber-50 text-amber-800"
    : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <span className={`inline-block rounded-lg border px-2 py-0.5 text-[11px] font-semibold ${estilo}`}>
      {rotulo}
    </span>
  );
}

/**
 * Devolver a nota para rascunho apaga tambem os campos da rejeicao anterior.
 *
 * Sem isso a nota volta para PENDENTE carregando status_focus, status_sefaz e
 * mensagem_sefaz da tentativa que falhou, e passa a parecer rascunho comum na
 * lista - foi o que aconteceu com a NFE-17536-001, que guarda uma rejeicao 539
 * invisivel. O historico da tentativa continua em payload_retorno e nos eventos
 * da nota; o que se limpa e so o estado atual.
 */
const VOLTA_PARA_RASCUNHO = {
  status: "PENDENTE",
  status_focus: null,
  status_sefaz: null,
  codigo_status_sefaz: null,
  mensagem_sefaz: null,
  erro_codigo: null,
  erro_mensagem: null
} as const;

/**
 * Título com o sócio pagador quando houver; abaixo, o cliente dono da proposta.
 *
 * Sócio de verdade é `propostas.id_faturado` apontando para OUTRO cadastro que
 * não o `id_cliente` — `id_faturado` preenchido e igual ao cliente é o próprio,
 * e aí só o cliente aparece.
 */
function ClienteComSocio({
  socio,
  clienteNome,
  idCliente
}: {
  socio?: string | null;
  clienteNome: string;
  idCliente?: number | null;
}) {
  const temSocio = Boolean(String(socio ?? "").trim());
  return (
    <div className="flex flex-col">
      <span className="font-medium text-slate-950">
        {idCliente ? `${idCliente} - ` : ""}
        {clienteNome}
      </span>
      {temSocio && (
        <span className="text-xs font-medium text-indigo-700">Sócio pagador: {socio}</span>
      )}
    </div>
  );
}

/** Vendedor do pedido, dobrado sob o numero do pedido. Some quando nao ha. */
function VendedorDoPedido({ valor }: { valor?: string | null }) {
  const texto = String(valor ?? "").trim();
  if (!texto) return null;
  return <span className="text-xs text-slate-500">Vendedor: {texto}</span>;
}

/** Status do pedido, só informativo: não barra nem filtra emissão. */
function StatusDoPedido({ valor }: { valor?: string | null }) {
  const texto = String(valor ?? "").trim();
  if (!texto) return <span className="text-slate-400">-</span>;
  return (
    <span className="inline-block rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
      {humanizeStatus(texto)}
    </span>
  );
}

export function NotasFiscaisPage() {
  const router = useRouter();
  const { showToast } = useAppToast();
  const { user } = useAuth();
  const canEmitNfe = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "fiscal.emit_nfe");
  const canEmitNfse = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "fiscal.emit_nfse");
  const canCancelNf = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "fiscal.cancel_nf");
  // Aba e filtros na URL: sobrevivem ao F5, ao histórico do navegador e a um
  // link copiado. Modais e fluxos fiscais continuam em estado local.
  const filtrosSchema = useMemo(
    () => ({
      aba: { codec: codecs.enumOf(ABAS), default: "FILA_FATURAMENTO" as const },
      "nfe-q": { codec: codecs.texto(), default: "" },
      "nfe-emp": { codec: codecs.enumOf(EMPRESAS_EMITENTES), default: "" as const },
      "nfe-status": { codec: codecs.enumOf(STATUS_NFE), default: "" as const },
      // Fila: por padrão esconde a proposta que já tem nota viva. Este filtro
      // traz as escondidas de volta — faturamento parcial precisa do caminho.
      "fila-faturadas": { codec: codecs.booleano(), default: false },
      // Fila: recorta para as cobranças do tipo faturado, que são as do Financeiro.
      "fila-so-faturados": { codec: codecs.booleano(), default: false },
      "nfse-q": { codec: codecs.texto(), default: "" },
      "nfse-emp": { codec: codecs.enumOf(EMPRESAS_EMITENTES), default: "" as const },
      "nfse-status": { codec: codecs.enumOf(STATUS_NFSE), default: "" as const }
    }),
    []
  );
  const { filters, setFilter, setFilters } = useUrlFilters(filtrosSchema);

  const activeTab: ActiveTab = filters.aba;
  const [isFaturando, setIsFaturando] = useState(false);
  const [focusConfirmNote, setFocusConfirmNote] = useState<NfeReadModel | null>(null);
  // O passo em que o modal de emissao abre: IDLE pede confirmacao, QUERYING
  // ja entra consultando. Todo o resto do acompanhamento mora no componente.
  const [passoDoModal, setPassoDoModal] = useState<"IDLE" | "QUERYING">("IDLE");

  // Conferência do Faturar: quando trava, a nota não abre e este painel diz por quê.
  const [conferenciaPendente, setConferenciaPendente] = useState<{
    idInt: number;
    pedido: string;
    resultado: ResultadoConferencia;
  } | null>(null);
  const [reconferindo, setReconferindo] = useState(false);

  // State para fila faturável
  const [faturaveisList, setFaturaveisList] = useState<FaturavelOrigem[]>([]);
  const [isFilaLoading, setIsFilaLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function loadFila() {
      setIsFilaLoading(true);
      try {
        const realPropostas = await getFaturaveisPropostas();
        if (isMounted) {
          setFaturaveisList(realPropostas);
        }
      } catch (err) {
        console.error("[NotasFiscaisPage] Error loading faturaveis:", err);
      } finally {
        if (isMounted) {
          setIsFilaLoading(false);
        }
      }
    }
    void loadFila();
    return () => {
      isMounted = false;
    };
  }, []);

  // Filtros vindos da URL. As buscas respondem a cada tecla e só gravam na URL
  // depois da pausa; os selects gravam na hora.
  const nfeStatus = filters["nfe-status"];
  const nfeEmpresa = filters["nfe-emp"];
  const nfseStatus = filters["nfse-status"];
  const nfseEmpresa = filters["nfse-emp"];
  const mostrarFaturadas = filters["fila-faturadas"];
  const soFaturados = filters["fila-so-faturados"];

  const [nfeSearch, setNfeSearch] = useDebouncedInput(filters["nfe-q"], (valor) =>
    setFilter("nfe-q", valor)
  );
  const [nfseSearch, setNfseSearch] = useDebouncedInput(filters["nfse-q"], (valor) =>
    setFilter("nfse-q", valor)
  );

  /**
   * Trocar de aba limpa os filtros de NF-e, como já era antes da migração — os
   * de NFS-e continuam intocados de propósito. Tudo numa escrita só.
   */
  const trocarAba = (aba: ActiveTab) => {
    setNfeSearch("");
    setFilters({ aba, "nfe-q": "", "nfe-emp": "", "nfe-status": "" });
  };

  // Hooks de leitura original do banco
  const nfeData = useNfeReadOnlyData();
  const nfseData = useNfseReadOnlyData();

  // Históricos adicionados localmente via simulação (Fase 1 MVP)
  // Sem lista simulada: o que a tela mostra vem do banco, e so.
  const nfeListCombined = nfeData.nfeList;
  const nfseListCombined = nfseData.nfseList;

  const [nfePaymentsCountMap, setNfePaymentsCountMap] = useState<Record<string, number>>({});
  const [boletosMap, setBoletosMap] = useState<Record<string, SupabaseBoletoRow[]>>({});

  const refreshFinanceiroStatusForRef = async (ref: string) => {
    try {
      const { paymentsCountMap, boletosMap: bMap } = await getNfeFinanceiroStatus([ref]);
      setNfePaymentsCountMap(prev => ({ ...prev, ...paymentsCountMap }));
      setBoletosMap(prev => ({ ...prev, ...bMap }));
    } catch (err) {
      console.error("[NotasFiscaisPage] refreshFinanceiroStatusForRef failed:", err);
    }
  };

  useEffect(() => {
    let active = true;
    const refs = nfeListCombined.map(n => n.ref).filter(Boolean);
    if (refs.length > 0) {
      void (async () => {
        try {
          const { paymentsCountMap, boletosMap: bMap } = await getNfeFinanceiroStatus(refs);
          if (active) {
            setNfePaymentsCountMap(prev => ({ ...prev, ...paymentsCountMap }));
            setBoletosMap(prev => ({ ...prev, ...bMap }));
          }
        } catch (err) {
          console.error("[NotasFiscaisPage] loadFinanceiroStatus failed:", err);
        }
      })();
    }
    return () => {
      active = false;
    };
  }, [nfeListCombined]);

  const [cceEventsMap, setCceEventsMap] = useState<Record<string, SupabaseNotaEventoRow[]>>({});

  const refreshCceEventsForRefs = useCallback(async (refs: string[]) => {
    try {
      const events = await getNotaEventosForRefs("NFE", refs);
      setCceEventsMap(prev => {
        const next = { ...prev };
        refs.forEach(r => {
          delete next[r];
        });
        events.forEach(e => {
          if (e.ref) {
            if (!next[e.ref]) {
              next[e.ref] = [];
            }
            next[e.ref].push(e);
          }
        });
        return next;
      });
    } catch (err) {
      console.error("[NotasFiscaisPage] refreshCceEventsForRefs failed:", err);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const refs = nfeListCombined.map(n => n.ref).filter(Boolean);
    if (refs.length > 0) {
      void (async () => {
        try {
          const events = await getNotaEventosForRefs("NFE", refs);
          if (active) {
            const map: Record<string, SupabaseNotaEventoRow[]> = {};
            events.forEach(e => {
              if (e.ref) {
                if (!map[e.ref]) {
                  map[e.ref] = [];
                }
                map[e.ref].push(e);
              }
            });
            setCceEventsMap(map);
          }
        } catch (err) {
          console.error("[NotasFiscaisPage] loadCceEvents failed:", err);
        }
      })();
    }
    return () => {
      active = false;
    };
  }, [nfeListCombined]);

  const [selectedNfeForLaunch, setSelectedNfeForLaunch] = useState<NfeReadModel | null>(null);
  const [launchModalOpen, setLaunchModalOpen] = useState(false);
  const [vencimentosForLaunch, setVencimentosForLaunch] = useState<SupabaseNfePagamentoRow[]>([]);
  const [isLoadingVencimentos, setIsLoadingVencimentos] = useState(false);
  const [selectedClientForLaunch, setSelectedClientForLaunch] = useState<{ nome: string; fantasia: string; documento: string } | null>(null);
  const [isLaunchingBoleto, setIsLaunchingBoleto] = useState(false);

  const handleOpenLaunchBoletoModal = async (item: NfeReadModel) => {
    setSelectedNfeForLaunch(item);
    setLaunchModalOpen(true);
    setIsLoadingVencimentos(true);
    setSelectedClientForLaunch(null);
    setVencimentosForLaunch([]);
    try {
      const pgs = await getNfePagamentos(item.id);
      setVencimentosForLaunch(pgs || []);

      const client = getSupabaseClient();
      if (client) {
        const { data: cData } = await client
          .from("clientes")
          .select("nome, fantasia, documento")
          .eq("id_cliente", item.id_cliente)
          .single();

        if (cData) {
          setSelectedClientForLaunch({
            nome: cData.nome || "",
            fantasia: cData.fantasia || "",
            documento: cData.documento || ""
          });
        }
      }
    } catch (err) {
      console.error("[NotasFiscaisPage] failed to load vencimentos or client for launch:", err);
      showToast({ type: "error", title: "Erro ao carregar vencimentos fiscais." });
    } finally {
      setIsLoadingVencimentos(false);
    }
  };

  const [launchSuccessModalOpen, setLaunchSuccessModalOpen] = useState(false);
  const [justLaunchedNfe, setJustLaunchedNfe] = useState<NfeReadModel | null>(null);

  const [selectedNfeForReview, setSelectedNfeForReview] = useState<NfeReadModel | null>(null);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);

  const handleOpenReviewModal = (item: NfeReadModel) => {
    setSelectedNfeForReview(item);
    setReviewModalOpen(true);
  };

  // States para Carta de Correção (CCe)
  const [cceModalOpen, setCceModalOpen] = useState(false);
  const [cceText, setCceText] = useState("");
  const [cceLoading, setCceLoading] = useState(false);
  const [cceNote, setCceNote] = useState<NfeReadModel | null>(null);

  // States para Cancelamento
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelJustificativa, setCancelJustificativa] = useState("");
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelNoteNfe, setCancelNoteNfe] = useState<NfeReadModel | null>(null);
  const [cancelNoteNfse, setCancelNoteNfse] = useState<NfseReadModel | null>(null);

  const handleOpenCceModal = (note: NfeReadModel) => {
    if (!note.id_empresa) {
      showToast({ type: "error", title: "Empresa não identificada", description: "Não é possível emitir Carta de Correção sem identificar a empresa emitente." });
      return;
    }
    setCceNote(note);
    setCceText("");
    setCceModalOpen(true);
  };

  const handleOpenCancelNfeModal = (note: NfeReadModel) => {
    if (!note.id_empresa) {
      showToast({ type: "error", title: "Empresa não identificada", description: "Não é possível cancelar NF-e sem identificar a empresa emitente." });
      return;
    }
    setCancelNoteNfe(note);
    setCancelNoteNfse(null);
    setCancelJustificativa("");
    setCancelModalOpen(true);
  };

  const handleOpenCancelNfseModal = (note: NfseReadModel) => {
    if (!note.id_empresa) {
      showToast({ type: "error", title: "Empresa não identificada", description: "Não é possível cancelar NFS-e sem identificar a empresa emitente." });
      return;
    }
    setCancelNoteNfse(note);
    setCancelNoteNfe(null);
    setCancelJustificativa("");
    setCancelModalOpen(true);
  };

  const handleSendCce = async () => {
    if (!cceNote) return;
    if (!cceNote.id_empresa) {
      showToast({ type: "error", title: "Erro de validação", description: "A empresa emitente não foi identificada." });
      return;
    }
    if (cceText.trim().length < 15) {
      showToast({ type: "error", title: "Erro de validação", description: "A correção deve conter pelo menos 15 caracteres." });
      return;
    }
    setCceLoading(true);
    try {
      const response = await fetch("https://10074.hostoo.net.br/webhook/carta-correcao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_empresa: Number(cceNote.id_empresa),
          referencia: cceNote.ref,
          correcao: cceText.trim()
        })
      });

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error("A resposta da API de Carta de Correção não é um JSON válido.");
      }

      if (!response.ok) {
        const errorMsg = data.erro?.mensagem || data.error || data.message || `Erro HTTP ${response.status}`;
        throw new Error(errorMsg);
      }

      const parsed = parseFocusResponse(data);
      if (!parsed.success) throw new Error(parsed.message);

      // Inserir registro em public.notas_eventos
      const client = getSupabaseClient();
      if (client) {
        try {
          const { data: { session } } = await client.auth.getSession();
          const criadoPor = session?.user?.id || session?.user?.email || null;
          const criadoPorNome = session?.user?.user_metadata?.nome || session?.user?.user_metadata?.full_name || session?.user?.email || null;

          const normalized = Array.isArray(data) ? data[0] : data;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let focusData: any = normalized;

          if (normalized && normalized.body) {
            focusData = normalized.body;
          }

          if (focusData && focusData.payload_retorno) {
            focusData = focusData.payload_retorno;
          }

          if (focusData && typeof focusData.data === "string") {
            try {
              focusData = JSON.parse(focusData.data);
            } catch (err) {
              console.error("[CCE] Error parsing focusData.data string:", err);
            }
          } else if (focusData && focusData.data && typeof focusData.data === "object") {
            focusData = focusData.data;
          }

          if (typeof focusData === "string") {
            try {
              focusData = JSON.parse(focusData);
            } catch (err) {
              console.error("[CCE] Error parsing focusData string:", err);
            }
          }

          const payloadEnvio = {
            id_empresa: Number(cceNote.id_empresa),
            referencia: cceNote.ref,
            correcao: cceText.trim()
          };

          const eventData = {
            tipo_documento: "NFE" as const,
            ref: cceNote.ref,
            tipo_evento: "CARTA_CORRECAO" as const,
            sequencia_evento: focusData?.numero_carta_correcao ? Number(focusData.numero_carta_correcao) : null,
            status_evento: focusData?.status || null,
            status_sefaz: focusData?.status_sefaz || focusData?.codigo_status_sefaz || null,
            mensagem_sefaz: focusData?.mensagem_sefaz || null,
            caminho_xml: focusData?.caminho_xml_carta_correcao || null,
            caminho_pdf: focusData?.caminho_pdf_carta_correcao || null,
            correcao: cceText.trim(),
            payload_envio: payloadEnvio,
            payload_retorno: focusData,
            origem: "FOCUS_CCE",
            criado_por: criadoPor,
            criado_por_nome: criadoPorNome
          };

          console.log("[NotasFiscaisPage] Inserindo evento de Carta de Correção:", eventData);
          const success = await insertNotaEvento(eventData);
          if (success) {
            console.log("[CCE] Evento persistido:", eventData);
          } else {
            console.error("[CCE] Falha ao persistir evento de Carta de Correção:", eventData);
          }
          void refreshCceEventsForRefs([cceNote.ref]);
        } catch (eventErr) {
          console.error("[NotasFiscaisPage] Falha ao registrar evento da Carta de Correção:", eventErr);
        }
      }

      showToast({
        type: "success",
        title: "Sucesso!",
        description: "A solicitação foi enviada. Atualize a nota para conferir o status final."
      });
      setCceModalOpen(false);
      void nfeData.refresh();
    } catch (err) {
      console.error("[NotasFiscaisPage] Error emitting CCe:", err);
      showToast({
        type: "error",
        title: "Falha ao emitir Carta de Correção",
        description: err instanceof Error ? err.message : "Erro desconhecido."
      });
    } finally {
      setCceLoading(false);
    }
  };

  const handleSendCancel = async () => {
    const note = cancelNoteNfe || cancelNoteNfse;
    if (!note) return;
    if (!note.id_empresa) {
      showToast({ type: "error", title: "Erro de validação", description: "A empresa emitente não foi identificada." });
      return;
    }
    if (cancelJustificativa.trim().length < 15) {
      showToast({ type: "error", title: "Erro de validação", description: "A justificativa deve conter pelo menos 15 caracteres." });
      return;
    }
    setCancelLoading(true);
    try {
      const isNfse = !!cancelNoteNfse;
      const url = isNfse 
        ? "https://10074.hostoo.net.br/webhook/cancelamento-nfse" 
        : "https://10074.hostoo.net.br/webhook/cancelamento";

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_empresa: Number(note.id_empresa),
          referencia: note.ref,
          justificativa: cancelJustificativa.trim()
        })
      });

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error("A resposta da API de cancelamento não é um JSON válido.");
      }

      if (!response.ok) {
        const errorMsg = data.erro?.mensagem || data.error || data.message || `Erro HTTP ${response.status}`;
        throw new Error(errorMsg);
      }

      const parsed = parseFocusResponse(data);
      if (!parsed.success) throw new Error(parsed.message);

      // 1. Normalizar o retorno da Focus
      const normalized = Array.isArray(data) ? data[0] : data;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let focusData: any = normalized;

      if (normalized && normalized.body) {
        focusData = normalized.body;
      }
      if (focusData && focusData.payload_retorno) {
        focusData = focusData.payload_retorno;
      }
      if (focusData && typeof focusData.data === "string") {
        try {
          focusData = JSON.parse(focusData.data);
        } catch (err) {
          console.error("[Cancelamento] Error parsing focusData.data string:", err);
        }
      } else if (focusData && focusData.data && typeof focusData.data === "object") {
        focusData = focusData.data;
      }
      if (typeof focusData === "string") {
        try {
          focusData = JSON.parse(focusData);
        } catch (err) {
          console.error("[Cancelamento] Error parsing focusData string:", err);
        }
      }

      const client = getSupabaseClient();
      if (client && !isNfse) {
        try {
          const nowIso = new Date().toISOString();
          
          // 2. Atualizar notas_fiscais
          const { error: updateError } = await client
            .from("notas_fiscais")
            .update({
              status: "CANCELADA",
              status_focus: focusData?.status || null,
              status_sefaz: focusData?.status_sefaz || focusData?.codigo_status_sefaz || null,
              codigo_status_sefaz: focusData?.status_sefaz || focusData?.codigo_status_sefaz || null,
              mensagem_sefaz: focusData?.mensagem_sefaz || null,
              erro_codigo: null,
              erro_mensagem: null,
              data_cancelamento: nowIso,
              payload_retorno: focusData,
              updated_at: nowIso
            })
            .eq("id", note.id);

          if (updateError) {
            console.error("[Cancelamento] Falha ao atualizar notas_fiscais:", updateError);
          } else {
            console.log("[Cancelamento] Status da nota atualizado no banco para CANCELADA:", note.ref);
          }

          // 3. Inserir em public.notas_eventos
          const { data: { session } } = await client.auth.getSession();
          const criadoPor = session?.user?.id || session?.user?.email || null;
          const criadoPorNome = session?.user?.user_metadata?.nome || session?.user?.user_metadata?.full_name || session?.user?.email || null;

          const payloadEnvio = {
            id_empresa: Number(note.id_empresa),
            referencia: note.ref,
            justificativa: cancelJustificativa.trim()
          };

          const eventData = {
            tipo_documento: "NFE" as const,
            ref: note.ref,
            tipo_evento: "CANCELAMENTO" as const,
            status_evento: focusData?.status || null,
            status_sefaz: focusData?.status_sefaz || focusData?.codigo_status_sefaz || null,
            mensagem_sefaz: focusData?.mensagem_sefaz || null,
            caminho_xml: focusData?.caminho_xml_cancelamento || null,
            caminho_pdf: focusData?.caminho_danfe || null,
            justificativa: cancelJustificativa.trim(),
            payload_envio: payloadEnvio,
            payload_retorno: focusData,
            origem: "FOCUS_CANCELAMENTO",
            criado_por: criadoPor,
            criado_por_nome: criadoPorNome
          };

          console.log("[Cancelamento] Inserindo evento de cancelamento:", eventData);
          const success = await insertNotaEvento(eventData);
          if (success) {
            console.log("[Cancelamento] Evento de cancelamento persistido no banco.");
          } else {
            console.error("[Cancelamento] Falha ao persistir evento de cancelamento.");
          }
          
          // 4. Atualizar estado local
          nfeData.setState(prev => ({
            ...prev,
            nfeList: prev.nfeList.map(n => n.id === note.id ? { ...n, status: "CANCELADA" } : n)
          }));
          void refreshCceEventsForRefs([note.ref]);
        } catch (dbErr) {
          console.error("[Cancelamento] Erro no fluxo de persistência de cancelamento:", dbErr);
        }
      }

      showToast({
        type: "success",
        title: "Sucesso!",
        description: "A nota fiscal foi cancelada com sucesso."
      });
      setCancelModalOpen(false);
      void nfeData.refresh();
    } catch (err) {
      console.error("[NotasFiscaisPage] Error canceling note:", err);
      showToast({
        type: "error",
        title: "Falha ao cancelar nota fiscal",
        description: err instanceof Error ? err.message : "Erro desconhecido."
      });
    } finally {
      setCancelLoading(false);
    }
  };

  const handleLaunchBoletos = async () => {
    if (!selectedNfeForLaunch) return;
    const launchedParcelas = boletosMap[selectedNfeForLaunch.ref]?.map(b => Number(b.parcela)) || [];
    const toLaunch = vencimentosForLaunch.filter(pg => !launchedParcelas.includes(pg.numero_parcela));
    if (toLaunch.length === 0) return;

    setIsLaunchingBoleto(true);
    try {
      await launchBoletosForNfe(
        selectedNfeForLaunch,
        toLaunch,
        selectedClientForLaunch?.nome || selectedNfeForLaunch.nome || selectedNfeForLaunch.fantasia || "",
        selectedClientForLaunch?.documento || ""
      );

      showToast({
        type: "success",
        title: "Sucesso!",
        description: `${toLaunch.length} boleto(s) lançado(s) com sucesso no Contas a Receber.`
      });

      setJustLaunchedNfe(selectedNfeForLaunch);
      setLaunchModalOpen(false);
      setLaunchSuccessModalOpen(true);
      void refreshFinanceiroStatusForRef(selectedNfeForLaunch.ref);
    } catch (err) {
      console.error("[NotasFiscaisPage] Error launching boletos:", err);
      showToast({
        type: "error",
        title: "Erro ao lançar boletos",
        description: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setIsLaunchingBoleto(false);
    }
  };

  const isMockActive = activeTab === "FILA_FATURAMENTO"
    ? false
    : false
    ? true
    : activeTab === "HISTORICO_FISCAL"
    ? nfeData.source === "mock"
    : nfseData.source === "mock";

  const isLoading = activeTab === "FILA_FATURAMENTO"
    ? isFilaLoading
    : false
    ? false
    : activeTab === "HISTORICO_FISCAL"
    ? nfeData.isLoading
    : nfseData.isLoading;

  async function copyToClipboard(text: string, title: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast({ type: "success", title });
    } catch {
      showToast({ type: "warning", title: "Erro ao copiar para a área de transferência." });
    }
  }

  function formatDate(isoString: string | null | undefined) {
    if (!isoString) return "-";
    try {
      const date = new Date(isoString);
      if (Number.isNaN(date.getTime())) return isoString;
      const day = String(date.getDate()).padStart(2, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    } catch {
      return isoString;
    }
  }

  function getEmpresaName(id: number) {
    if (id === 1) return "INGRESSO IDEAL";
    if (id === 2) return "BIRÔ IDEAL";
    if (id === 3) return "E3 BRINDES";
    return `EMPRESA #${id}`;
  }

  function formatTime(isoString: string | null | undefined) {
    if (!isoString) return "-";
    try {
      const date = new Date(isoString);
      if (Number.isNaN(date.getTime())) return "-";
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      return `${hours}:${minutes}`;
    } catch {
      return "-";
    }
  }

  function getStatusTone(status: string) {
    const s = status.toUpperCase();
    if (s === "AUTORIZADA") return "success";
    if (["ERRO_ENVIO", "ERRO_AUTORIZACAO", "REJEITADA", "DENEGADA", "FALHA_INTEGRACAO", "RETORNO_FOCUS", "NAO_ENCONTRADA_FOCUS"].includes(s)) return "danger";
    if (["PENDENTE", "PRONTA_PARA_ENVIO", "PROCESSANDO", "PROCESSANDO_AUTORIZACAO"].includes(s)) return "warning";
    return "neutral";
  }

  function getFinanceiroStatus(
    ref: string,
    valorTotalNf: number,
    nfePaymentsCount: number | undefined,
    boletos: SupabaseBoletoRow[] | undefined
  ) {
    if (!nfePaymentsCount || nfePaymentsCount === 0) {
      return {
        status: "SEM_VENCIMENTOS",
        label: "Sem vencimentos fiscais",
        tone: "neutral" as const
      };
    }

    if (!boletos || boletos.length === 0) {
      return {
        status: "NAO_LANCADO",
        label: "Não lançado no contas a receber",
        tone: "danger" as const
      };
    }

    const totalValor = boletos.reduce((acc, b) => acc + Number(b.valor || 0), 0);
    const diff = totalValor - valorTotalNf;

    // Divergência: soma dos boletos maior que o total da NF em mais de 0.05
    if (diff > 0.05) {
      return {
        status: "DIVERGENCIA",
        label: "Divergência",
        tone: "danger" as const
      };
    }

    // Parcial: soma menor que o total em mais de 0.05
    if (diff < -0.05) {
      return {
        status: "PARCIAL",
        label: "Parcialmente lançado",
        tone: "warning" as const
      };
    }

    // A soma dos boletos é equivalente ao total da nota (+/- 0.05).
    // Verificar se todos os boletos estão marcados como depósito em conta:
    const allDeposito = boletos.every((b) => b.deposito_conta === true);
    if (allDeposito) {
      return {
        status: "DEPOSITO_CONTA",
        label: "Depósito em conta",
        tone: "success" as const
      };
    }

    // Para boletos que NÃO são depósito em conta, verificar se estão registrados
    const nonDepositoBoletos = boletos.filter((b) => b.deposito_conta !== true);
    const allRegistered =
      nonDepositoBoletos.length > 0 &&
      nonDepositoBoletos.every((b) => {
        return (
          b.id_boleto_c6 !== null &&
          b.id_boleto_c6 !== undefined &&
          b.id_boleto_c6 !== "" ||
          b.nosso_numero !== null &&
          b.nosso_numero !== undefined &&
          b.nosso_numero !== "" ||
          b.linha_digitavel !== null &&
          b.linha_digitavel !== undefined &&
          b.linha_digitavel !== ""
        );
      });

    if (allRegistered) {
      return {
        status: "BOLETO_REGISTRADO",
        label: "Boleto registrado",
        tone: "success" as const
      };
    }

    // Pelo menos um boleto não-depósito está pendente de registro
    return {
      status: "A_RECEBER_CRIADO",
      label: "A receber criado — boleto não registrado",
      tone: "warning" as const
    };
  }

  function getNfeActions(item: NfeReadModel) {
    const status = (item.status || "").toUpperCase();
    const actions: Array<{
      label: string;
      onClick?: () => void;
      disabled?: boolean;
    }> = [];

    // 1. PENDENTE / RASCUNHO
    if (status === "PENDENTE" || status === "RASCUNHO") {
      actions.push({
        label: "Editar",
        onClick: () => {
          router.push(`/notas-fiscais/${item.id}`);
        }
      });
      actions.push({
        label: "DANFE Preview",
        onClick: () => {
          void handleDanfePreview(item.ref);
        }
      });
    }

    // 2. PRONTA_PARA_ENVIO
    if (status === "PRONTA_PARA_ENVIO") {
      actions.push({
        label: "Editar última hora",
        onClick: () => {
          void handleEditarUltimaHora(item);
        }
      });
      actions.push({
        label: "DANFE Preview",
        onClick: () => {
          void handleDanfePreview(item.ref);
        }
      });
      // Quem nao pode emitir nao ve o gatilho. O servidor ja recusava com 403;
      // esconder evita o clique que so podia dar errado.
      if (canEmitNfe) {
        actions.push({
          label: "Enviar para Focus",
          onClick: () => {
            setPassoDoModal("IDLE");
            setFocusConfirmNote(item);
          }
        });
      }
    }

    // 3. PROCESSANDO / PROCESSANDO_AUTORIZACAO
    if (status === "PROCESSANDO" || status === "PROCESSANDO_AUTORIZACAO") {
      actions.push({
        label: "Consultar status",
        onClick: () => {
          setPassoDoModal("QUERYING");
          setFocusConfirmNote(item);
        }
      });
      actions.push({
        label: "Visualizar detalhes",
        onClick: () => {
          router.push(`/notas-fiscais/${item.id}`);
        }
      });
    }

    // 4. Status recuperáveis: RETORNO_FOCUS, ERRO_ENVIO, ERRO_AUTORIZACAO, NAO_ENCONTRADA_FOCUS, REJEITADA
    if (["RETORNO_FOCUS", "ERRO_ENVIO", "ERRO_AUTORIZACAO", "NAO_ENCONTRADA_FOCUS", "REJEITADA"].includes(status)) {
      actions.push({
        label: "Ver detalhes",
        onClick: () => {
          router.push(`/notas-fiscais/${item.id}`);
        }
      });
      actions.push({
        label: "Corrigir rascunho",
        onClick: () => {
          void handleCorrigirRascunho(item);
        }
      });
      actions.push({
        label: "Reenviar NF-e",
        onClick: () => {
          void handleReenviarNfe(item);
        }
      });
      actions.push({
        label: "Atualizar status",
        onClick: () => {
          setPassoDoModal("QUERYING");
          setFocusConfirmNote(item);
        }
      });
    }

    // 5. AUTORIZADA
    if (status === "AUTORIZADA") {
      if (item.url_danfe) {
        actions.push({
          label: "Abrir DANFE (PDF)",
          onClick: () => {
            window.open(item.url_danfe!, "_blank");
          }
        });
        actions.push({
          label: "Copiar Link (PDF)",
          onClick: () => {
            copyToClipboard(item.url_danfe!, "Link do DANFE copiado!");
          }
        });
      }
      if (item.url_xml) {
        actions.push({
          label: "Baixar XML",
          onClick: () => {
            const xmlUrl = `https://pay.ai-ideal.com.br/functions/v1/download-nfe-xml?ref=${encodeURIComponent(item.ref)}`;
            window.open(xmlUrl, "_blank");
          }
        });
        actions.push({
          label: "Copiar Link (XML)",
          onClick: () => {
            copyToClipboard(item.url_xml!, "Link do XML copiado!");
          }
        });
      }
      actions.push({
        label: "Visualizar detalhes",
        onClick: () => {
          router.push(`/notas-fiscais/${item.id}`);
        }
      });

      const count = nfePaymentsCountMap[item.ref] || 0;
      const bInfo = boletosMap[item.ref];
      const finStatus = getFinanceiroStatus(item.ref, item.valor_total_nf, count, bInfo);

      if (
        finStatus.status !== "BOLETO_REGISTRADO" &&
        finStatus.status !== "DEPOSITO_CONTA" &&
        finStatus.status !== "A_RECEBER_CRIADO" &&
        finStatus.status !== "SEM_VENCIMENTOS"
      ) {
        actions.push({
          label: "Lançar no Contas a Receber",
          onClick: () => {
            void handleOpenLaunchBoletoModal(item);
          }
        });
      }

      if (bInfo && bInfo.length > 0) {
        actions.push({
          label: "Revisar para gerar boletos",
          onClick: () => {
            void handleOpenReviewModal(item);
          }
        });
        actions.push({
          label: "Ver contas a receber",
          onClick: () => {
            router.push(`/contas-a-receber?search=${encodeURIComponent(item.ref)}`);
          }
        });
      }

      if (canCancelNf) {
        actions.push({
          label: "Cancelar NF-e",
          onClick: () => handleOpenCancelNfeModal(item)
        });
      }

      const events = cceEventsMap[item.ref] || [];
      const latestCceEvent = events.find(e => e.tipo_evento === "CARTA_CORRECAO");
      const payloadRetorno = item.payload_retorno as Record<string, unknown> | null;
      const fallbackPdf = payloadRetorno?.caminho_pdf_carta_correcao as string | undefined;
      const fallbackXml = payloadRetorno?.caminho_xml_carta_correcao as string | undefined;

      const hasCce = !!latestCceEvent || !!fallbackPdf || !!fallbackXml;

      if (hasCce) {
        const baseUrl = item.ambiente === "producao" ? "https://api.focusnfe.com.br" : "https://homologacao.focusnfe.com.br";
        const pdfUrl = latestCceEvent?.url_pdf || latestCceEvent?.caminho_pdf
          ? (latestCceEvent.url_pdf || `${baseUrl}${latestCceEvent.caminho_pdf}`)
          : (fallbackPdf ? `${baseUrl}${fallbackPdf}` : null);

        const xmlUrl = latestCceEvent?.url_xml || latestCceEvent?.caminho_xml
          ? (latestCceEvent.url_xml || `${baseUrl}${latestCceEvent.caminho_xml}`)
          : (fallbackXml ? `${baseUrl}${fallbackXml}` : null);

        if (pdfUrl) {
          actions.push({
            label: "Abrir Carta de Correção (PDF)",
            onClick: () => {
              window.open(pdfUrl, "_blank");
            }
          });
        }
        if (xmlUrl) {
          actions.push({
            label: "Baixar XML da Carta de Correção",
            onClick: () => {
              window.open(xmlUrl, "_blank");
            }
          });
        }
      }

      actions.push({
        label: "Carta de Correção",
        onClick: () => handleOpenCceModal(item)
      });
    }

    // 6. CANCELADA / DENEGADA
    if (status === "CANCELADA" || status === "DENEGADA") {
      actions.push({
        label: "Visualizar detalhes",
        onClick: () => {
          router.push(`/notas-fiscais/${item.id}`);
        }
      });
      if (item.url_xml) {
        actions.push({
          label: "Abrir XML",
          onClick: () => {
            window.open(item.url_xml!, "_blank");
          }
        });
      }
    }

    // Copiar Ref (sempre disponível no final)
    actions.push({
      label: "Copiar Ref",
      onClick: () => {
        copyToClipboard(item.ref, "Referência copiada!");
      }
    });

    return actions;
  }

  function getNfseActions(item: NfseReadModel) {
    const actions = [
      {
        label: "Copiar Ref",
        onClick: () => {
          copyToClipboard(item.ref, "Referência copiada!");
        },
        icon: Copy
      }
    ];

    const nfseStatus = (item.status || "").toUpperCase();
    if (nfseStatus === "AUTORIZADA") {
      if (canCancelNf) {
        actions.push({
          label: "Cancelar NFS-e",
          onClick: () => handleOpenCancelNfseModal(item),
          icon: AlertTriangle
        });
      }
    }

    if (item.url_pdf) {
      actions.push({
        label: "Abrir PDF",
        onClick: () => {
          window.open(item.url_pdf!, "_blank");
        },
        icon: ExternalLink
      });
      actions.push({
        label: "Copiar Link (PDF)",
        onClick: () => {
          copyToClipboard(item.url_pdf!, "Link do PDF copiado!");
        },
        icon: Copy
      });
    }

    if (item.url_xml) {
      actions.push({
        label: "Abrir XML",
        onClick: () => {
          window.open(item.url_xml!, "_blank");
        },
        icon: FileText
      });
      actions.push({
        label: "Copiar Link (XML)",
        onClick: () => {
          copyToClipboard(item.url_xml!, "Link do XML copiado!");
        },
        icon: Copy
      });
    }

    return actions;
  }

  async function handleDanfePreview(ref: string) {
    try {
      showToast({ type: "info", title: "Gerando preview da DANFE..." });
      const res = await previewNfeRascunho(ref);

      if (res.success) {
        if (res.url) {
          window.open(res.url, "_blank");
          showToast({ type: "success", title: "DANFE Preview aberto!" });
        } else if (res.blob) {
          const fileURL = URL.createObjectURL(res.blob);
          window.open(fileURL, "_blank");
          showToast({ type: "success", title: "DANFE Preview aberto!" });
        } else {
          throw new Error("A resposta não conteve a URL ou o arquivo PDF.");
        }
      } else {
        throw new Error(res.error || "Erro desconhecido ao gerar preview.");
      }
    } catch (err) {
      console.error("[NotasFiscaisPage] Edge Function preview failed:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      showToast({ 
        type: "error", 
        title: "Não foi possível gerar o preview da DANFE.",
        description: errMsg
      });
    }
  }

  async function handleEditarUltimaHora(item: NfeReadModel) {
    try {
      showToast({ type: "info", title: "Retornando nota ao status de rascunho..." });
      const res = await updateNfeDraft(item.id, { ref: item.ref, ...VOLTA_PARA_RASCUNHO }, [], []);
      if (res.success) {
        showToast({ type: "success", title: "Rascunho reaberto. Redirecionando..." });
        await nfeData.refresh();
        router.push(`/notas-fiscais/${item.id}`);
      } else {
        showToast({ type: "error", title: res.error || "Erro ao atualizar status da nota." });
      }
    } catch (err) {
      console.error(err);
      showToast({ type: "error", title: "Erro ao abrir edição de última hora." });
    }
  }

  async function handleCorrigirRascunho(item: NfeReadModel) {
    try {
      showToast({ type: "info", title: "Retornando nota ao status de rascunho..." });
      const res = await updateNfeDraft(item.id, { ref: item.ref, ...VOLTA_PARA_RASCUNHO }, [], []);
      if (res.success) {
        showToast({ type: "success", title: "Rascunho reaberto para correção. Redirecionando..." });
        await nfeData.refresh();
        router.push(`/notas-fiscais/${item.id}`);
      } else {
        showToast({ type: "error", title: res.error || "Erro ao atualizar status da nota." });
      }
    } catch (err) {
      console.error(err);
      showToast({ type: "error", title: "Erro ao abrir correção de rascunho." });
    }
  }

  async function handleReenviarNfe(item: NfeReadModel) {
    try {
      showToast({ type: "info", title: "Preparando reenvio da nota..." });
      
      const client = getSupabaseClient();
      if (!client) throw new Error("Sistema indisponível no momento. Tente novamente.");

      // 1. Buscar ambiente atual da empresa
      const { data: company, error: compErr } = await client
        .from("empresas")
        .select("ambiente_nfe")
        .eq("id", item.id_empresa)
        .single();

      if (compErr) {
        console.warn("[Reenviar NFe] Erro ao buscar ambiente da empresa:", compErr);
      }

      const activeEnv = company?.ambiente_nfe || (item.id_empresa === 1 ? "producao" : "homologacao");

      // 2. Se ambiente for diferente, ou se o payload_envio tiver o ambiente incorreto, atualizar no banco
      const needsEnvUpdate = activeEnv !== item.ambiente;
      const needsPayloadUpdate = !item.payload_envio || (item.payload_envio as { ambiente?: string }).ambiente !== activeEnv;

      if (needsEnvUpdate || needsPayloadUpdate) {
        console.log(`[Reenviar NFe] Atualizando ambiente para ${activeEnv} e sincronizando payload_envio`);
        const updatedPayload = item.payload_envio ? { ...item.payload_envio, ambiente: activeEnv } : null;
        const { error: updErr } = await client
          .from("notas_fiscais")
          .update({ 
            ambiente: activeEnv,
            payload_envio: updatedPayload
          })
          .eq("id", item.id);
        
        if (updErr) throw updErr;
      }

      // 3. Chamar RPC para remontar o payload e validar
      console.log("[Reenviar NFe] Executando fn_preparar_envio_nfe");
      const prepRes = await prepararEnvioNfe(item.ref);
      if (!prepRes || !prepRes.ok) {
        throw new Error(prepRes?.mensagem || "Não foi possível preparar a nota para envio. Tente novamente.");
      }

      // 4. Atualizar a listagem para refletir novo status / dados
      const refreshed = await nfeData.refresh();
      const updatedNote = refreshed?.nfeList?.find(n => n.id === item.id) || {
        ...item,
        status: "PRONTA_PARA_ENVIO",
        ambiente: activeEnv,
        payload_envio: prepRes.payload || (item.payload_envio ? { ...item.payload_envio, ambiente: activeEnv } : null)
      };

      showToast({ type: "success", title: "Nota preparada para reenvio!" });

      // 5. Abrir modal de confirmação de envio
      setPassoDoModal("IDLE");
      setFocusConfirmNote(updatedNote);
    } catch (err) {
      console.error("[Reenviar NFe] Erro ao preparar reenvio:", err);
      showToast({
        type: "error",
        title: "Erro ao preparar reenvio",
        description: err instanceof Error ? err.message : String(err)
      });
    }
  }

  // Faturamento de pedido: cria/recupera o rascunho e leva o operador ate ele.
  async function handleFaturarClick(item: FaturavelOrigem) {
    // OS e CONTRATO virariam NFS-e, que ainda nao tem caminho de emissao real.
    // Antes isso abria um painel que simulava a nota com Math.random() e DANFE
    // de exemplo. Sem caminho real, o operador ouve o motivo real.
    if (item.tipo === "OS" || item.tipo === "CONTRATO") {
      showToast({
        type: "warning",
        title: "Emissão de NFS-e ainda não disponível.",
        description: "O faturamento de Ordem de Serviço e Contrato depende da integração de NFS-e, que ainda não está ligada."
      });
      return;
    }

    if (isFaturando) return;
    setIsFaturando(true);

    try {
      const match = item.ref_origem.match(/\d+/);
      const idInt = match ? parseInt(match[0], 10) : null;
      if (!idInt) {
        showToast({ type: "warning", title: "Referência de origem inválida para faturamento." });
        setIsFaturando(false);
        return;
      }

      // A conferência roda ANTES de criar o rascunho. Faltando dado, a nota não
      // abre: o painel diz o que está errado, quem corrige e onde.
      showToast({ type: "info", title: "Conferindo os dados do pedido..." });
      const conferencia = await conferirFaturamento(idInt);
      if (!conferencia.ok) {
        setConferenciaPendente({ idInt, pedido: `#${idInt}`, resultado: conferencia });
        setIsFaturando(false);
        return;
      }

      showToast({ type: "info", title: "Criando ou recuperando rascunho de NF-e..." });
      const draft = await createOrReuseNfeDraft(idInt);
      showToast({ type: "success", title: `Rascunho ${draft.ref} carregado com sucesso!` });
      
      router.push(`/notas-fiscais/${draft.id}`);
    } catch (err) {
      console.error("[NotasFiscaisPage] Erro ao faturar:", err);
      const msg = err instanceof Error ? err.message : "Erro ao gerar rascunho da NF-e.";
      showToast({ type: "error", title: msg });
    } finally {
      setIsFaturando(false);
    }
  }

  // Filtragem da Fila de Faturamento (Unificada: NF-e e NFS-e)
  const filaJaFaturadas = faturaveisList.filter((item) => (item.notas_vivas ?? 0) > 0).length;
  const filaFaturados = faturaveisList.filter((item) => ehFaturado(item.tipo_cobranca)).length;

  const filteredFilaNfe = faturaveisList.filter((item) => {
    // Já virou nota viva: sai da fila, a menos que o operador peça para ver.
    if (!mostrarFaturadas && (item.notas_vivas ?? 0) > 0) return false;

    if (soFaturados && !ehFaturado(item.tipo_cobranca)) return false;

    if (nfeSearch) {
      const search = nfeSearch.toLowerCase().trim();
      const refStr = item.ref_origem.toLowerCase();
      const idCliStr = String(item.id_cliente);
      const nomeStr = item.cliente_nome.toLowerCase();
      const fantStr = item.cliente_fantasia.toLowerCase();

      const socioStr = String(item.socio_pagador_nome || "").toLowerCase();
      const vendedorStr = String(item.vendedor || "").toLowerCase();

      const matchesSearch =
        refStr.includes(search) ||
        idCliStr.includes(search) ||
        nomeStr.includes(search) ||
        fantStr.includes(search) ||
        socioStr.includes(search) ||
        vendedorStr.includes(search);

      if (!matchesSearch) return false;
    }

    if (nfeEmpresa) {
      if (String(item.id_empresa) !== nfeEmpresa) return false;
    }

    return true;
  });

  // Filtragem da Fila de Faturamento (NFS-e)
  const filteredFilaNfse = faturaveisList.filter((item) => {
    if (item.tipo !== "OS" && item.tipo !== "CONTRATO") return false;

    if (nfseSearch) {
      const search = nfseSearch.toLowerCase().trim();
      const refStr = item.ref_origem.toLowerCase();
      const idCliStr = String(item.id_cliente);
      const nomeStr = item.cliente_nome.toLowerCase();
      const fantStr = item.cliente_fantasia.toLowerCase();

      const matchesSearch =
        refStr.includes(search) ||
        idCliStr.includes(search) ||
        nomeStr.includes(search) ||
        fantStr.includes(search);

      if (!matchesSearch) return false;
    }

    if (nfseEmpresa) {
      if (String(item.id_empresa) !== nfseEmpresa) return false;
    }

    return true;
  });

  // Filtragem Histórico NF-e
  const filteredNfeList = nfeListCombined.filter((item) => {
    if (nfeSearch) {
      const search = nfeSearch.toLowerCase().trim();
      const numNfStr = item.numero_nf ? String(item.numero_nf) : "";
      const refStr = item.ref ? item.ref.toLowerCase() : "";
      const idCliStr = item.id_cliente ? String(item.id_cliente) : "";
      const nomeStr = item.nome ? item.nome.toLowerCase() : "";
      const fantStr = item.fantasia ? item.fantasia.toLowerCase() : "";
      // A lista mostra o sócio no título, então a busca tem de achar por ele —
      // e pelo cliente dono, que virou subtítulo.
      const socioStr = String(item.socio_pagador_nome || "").toLowerCase();
      const donoStr = String(item.cliente_principal_nome || "").toLowerCase();
      const vendedorStr = String(item.vendedor_pedido || "").toLowerCase();

      const matchesSearch =
        numNfStr.includes(search) ||
        refStr.includes(search) ||
        idCliStr.includes(search) ||
        nomeStr.includes(search) ||
        fantStr.includes(search) ||
        socioStr.includes(search) ||
        donoStr.includes(search) ||
        vendedorStr.includes(search);

      if (!matchesSearch) return false;
    }

    if (nfeEmpresa) {
      if (String(item.id_empresa) !== nfeEmpresa) return false;
    }

    if (nfeStatus) {
      const displayStatus = getNfeDisplayStatus(item);
      if (displayStatus.toUpperCase() !== nfeStatus.toUpperCase()) return false;
    }

    return true;
  });

  // Filtragem Histórico NFS-e
  const filteredNfseList = nfseListCombined.filter((item) => {
    if (nfseSearch) {
      const search = nfseSearch.toLowerCase().trim();
      const numNfseStr = item.numero_nfse ? String(item.numero_nfse) : "";
      const refStr = item.ref ? item.ref.toLowerCase() : "";
      const idCliStr = item.id_cliente ? String(item.id_cliente) : "";
      const nomeStr = item.nome ? item.nome.toLowerCase() : "";
      const fantStr = item.fantasia ? item.fantasia.toLowerCase() : "";

      const matchesSearch =
        numNfseStr.includes(search) ||
        refStr.includes(search) ||
        idCliStr.includes(search) ||
        nomeStr.includes(search) ||
        fantStr.includes(search);

      if (!matchesSearch) return false;
    }

    if (nfseEmpresa) {
      if (String(item.id_empresa) !== nfseEmpresa) return false;
    }

    if (nfseStatus) {
      if (item.status.toUpperCase() !== nfseStatus.toUpperCase()) return false;
    }

    return true;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notas fiscais"
        subtitle="Central de faturamento e consulta de notas de produto (NF-e) e serviços (NFS-e)."
        context="Fiscal / Emissão e Histórico"
      />

      {isMockActive && !isLoading ? (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 shadow-sm">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 mt-0.5 animate-bounce" />
          <div>
            <strong className="font-semibold block sm:inline">DADOS DE SIMULAÇÃO (MOCK):</strong>
            <span className="sm:ml-1">Esta tela exibe dados simulados. Nenhum registro fiscal real está sendo utilizado.</span>
          </div>
        </div>
      ) : null}

      {/* Seleção de Abas */}
      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-2 shadow-sm">
        <div className="flex gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => trocarAba("FILA_FATURAMENTO")}
            className={`shrink-0 rounded-2xl px-5 py-3 text-sm font-semibold transition ${
              activeTab === "FILA_FATURAMENTO" ? "bg-[#0b2f4a] text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Fila Faturamento ({filteredFilaNfe.length})
          </button>
          <button
            type="button"
            onClick={() => trocarAba("HISTORICO_FISCAL")}
            className={`shrink-0 rounded-2xl px-5 py-3 text-sm font-semibold transition ${
              activeTab === "HISTORICO_FISCAL" ? "bg-[#0b2f4a] text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Histórico NF-e / NFS-e
          </button>
        </div>
      </section>

      {/* Renderização da Fila NF-e */}
      {activeTab === "FILA_FATURAMENTO" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm">
            <div className="relative">
              <input
                type="text"
                placeholder="Buscar fila por Ref, ID Cliente ou Nome..."
                value={nfeSearch}
                onChange={(e) => setNfeSearch(e.target.value)}
                className="w-full rounded-2xl border border-[#d7e5e8] bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none transition focus:border-[#0b2f4a] focus:bg-white"
              />
            </div>
            <div>
              <select
                value={nfeEmpresa}
                onChange={(e) => setFilter("nfe-emp", e.target.value as (typeof EMPRESAS_EMITENTES)[number])}
                className="w-full rounded-2xl border border-[#d7e5e8] bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#0b2f4a] focus:bg-white"
              >
                <option value="">Todas as Empresas Emitentes</option>
                <option value="1">INGRESSO IDEAL</option>
                <option value="2">BIRÔ IDEAL</option>
                <option value="3">E3 BRINDES</option>
              </select>
            </div>
            <label className="sm:col-span-2 flex items-center gap-2.5 text-sm text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={soFaturados}
                onChange={(e) => setFilter("fila-so-faturados", e.target.checked)}
                className="h-4 w-4 rounded border-[#d7e5e8] text-[#0b2f4a] focus:ring-[#0b2f4a]"
              />
              <span>
                Só faturados
                <strong className="ml-1 font-semibold text-slate-800">({filaFaturados})</strong>
                <span className="ml-1 text-xs text-slate-400">— as cobranças do Financeiro</span>
              </span>
            </label>
            {filaJaFaturadas > 0 && (
              <label className="sm:col-span-2 flex items-center gap-2.5 text-sm text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={mostrarFaturadas}
                  onChange={(e) => setFilter("fila-faturadas", e.target.checked)}
                  className="h-4 w-4 rounded border-[#d7e5e8] text-[#0b2f4a] focus:ring-[#0b2f4a]"
                />
                <span>
                  Permitir faturar de novo pedidos que já têm nota
                  <strong className="ml-1 font-semibold text-slate-800">({filaJaFaturadas})</strong>
                  <span className="ml-1 text-xs text-slate-400">
                    — para faturamento parcial, que emite mais de uma nota no mesmo pedido
                  </span>
                </span>
              </label>
            )}
          </div>

          <ResponsiveList<FaturavelOrigem>
            items={filteredFilaNfe}
            getKey={(item) => `fila-nfe-${item.id}`}
            isLoading={isLoading}
            emptyTitle="Nenhuma proposta disponível para faturamento"
            emptyDescription="Nenhum pedido aprovado aguardando faturamento."
            columns={[
              {
                header: "Pedido",
                cell: (item) => {
                  const idInt = item.ref_origem.match(/\d+/)?.[0] || "-";
                  const jaTemNota = (item.notas_vivas ?? 0) > 0;
                  return (
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-950">#{idInt}</span>
                      {item.os_ideal && (
                        <span className="text-xs text-slate-500 font-mono">OS: {item.os_ideal}</span>
                      )}
                      <VendedorDoPedido valor={item.vendedor} />
                      {jaTemNota && (
                        <span className="mt-1 w-fit rounded-lg border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                          Já tem {item.notas_vivas} nota{(item.notas_vivas ?? 0) > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  );
                }
              },
              {
                header: "Cliente / Destinatário",
                cell: (item) => (
                  <ClienteComSocio
                    socio={item.socio_pagador_nome}
                    clienteNome={item.cliente_nome}
                    idCliente={item.id_cliente}
                  />
                )
              },
              {
                header: "Empresa Emitente",
                cell: (item) => (
                  <div className="flex flex-col">
                    <span className="font-medium text-slate-900">{getEmpresaName(item.id_empresa)}</span>
                    <span className="text-xs text-slate-400">ID: {item.id_empresa}</span>
                  </div>
                )
              },
              {
                header: "Valor Total",
                cell: (item) => formatCurrency(item.valor_total),
                align: "right"
              },
              {
                header: "Tipo de cobrança",
                cell: (item) => <EtiquetaCobranca tipo={item.tipo_cobranca} />,
                align: "center"
              },
              {
                header: "Status do pedido",
                cell: (item) => <StatusDoPedido valor={item.status_interno} />,
                align: "center"
              },
              {
                header: "Ação",
                cell: (item) => (
                  canEmitNfe ? (
                    <button
                      type="button"
                      onClick={() => handleFaturarClick(item)}
                      disabled={isFaturando}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#0b2f4a] px-4 py-2 text-xs font-semibold text-white hover:bg-[#061d2e] disabled:opacity-50 transition"
                    >
                      <Play className="h-3 w-3" />
                      Faturar
                    </button>
                  ) : null
                ),
                align: "right"
              }
            ]}
            renderCard={(item) => (
              <article key={`fila-nfe-card-${item.id}`} className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold px-2 py-0.5 bg-slate-100 rounded-lg text-slate-700">
                        Pedido #{item.ref_origem.match(/\d+/)?.[0] || "-"}
                      </span>
                      {item.os_ideal && (
                        <span className="text-xs text-slate-500 font-mono">OS: {item.os_ideal}</span>
                      )}
                    </div>
                    <div className="mt-2">
                      <ClienteComSocio
                        socio={item.socio_pagador_nome}
                        clienteNome={item.cliente_nome}
                        idCliente={item.id_cliente}
                      />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Vendedor: {String(item.vendedor || "").trim() || "-"}
                    </p>
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg">
                    Pendente
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm text-slate-600">
                  <p>Empresa: <strong>{getEmpresaName(item.id_empresa)}</strong></p>
                  <p className="text-right">Valor: <strong>{formatCurrency(item.valor_total)}</strong></p>
                  <p>Data: {formatDate(item.created_at)}</p>
                </div>
                <div className="flex justify-end pt-2">
                  {canEmitNfe && (
                    <button
                      type="button"
                      onClick={() => handleFaturarClick(item)}
                      disabled={isFaturando}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#0b2f4a] px-4 py-2 text-xs font-semibold text-white hover:bg-[#061d2e] disabled:opacity-50 transition"
                    >
                      <Play className="h-3 w-3" />
                      Faturar
                    </button>
                  )}
                </div>
              </article>
            )}
          />
        </div>
      ) : null}

      {/* Renderização da Fila NFS-e */}
      {false && false ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm">
            <div className="relative">
              <input
                type="text"
                placeholder="Buscar fila por Ref, ID Cliente ou Nome..."
                value={nfseSearch}
                onChange={(e) => setNfseSearch(e.target.value)}
                className="w-full rounded-2xl border border-[#d7e5e8] bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none transition focus:border-[#0b2f4a] focus:bg-white"
              />
            </div>
            <div>
              <select
                value={nfseEmpresa}
                onChange={(e) => setFilter("nfse-emp", e.target.value as (typeof EMPRESAS_EMITENTES)[number])}
                className="w-full rounded-2xl border border-[#d7e5e8] bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#0b2f4a] focus:bg-white"
              >
                <option value="">Todas as Empresas Emitentes</option>
                <option value="1">INGRESSO IDEAL</option>
                <option value="2">BIRÔ IDEAL</option>
                <option value="3">E3 BRINDES</option>
              </select>
            </div>
          </div>

          <ResponsiveList<FaturavelOrigem>
            items={filteredFilaNfse}
            getKey={(item) => `fila-nfse-${item.id}`}
            isLoading={isLoading}
            emptyTitle="Nenhum serviço pendente"
            emptyDescription="Não há Ordens de Serviços liberadas para faturamento."
            columns={[
              {
                header: "Pedido",
                cell: (item) => {
                  const idInt = item.ref_origem.match(/\d+/)?.[0] || "-";
                  return (
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-950">#{idInt}</span>
                      {item.os_ideal && (
                        <span className="text-xs text-slate-500 font-mono">OS: {item.os_ideal}</span>
                      )}
                    </div>
                  );
                }
              },
              {
                header: "Cliente / Tomador",
                cell: (item) => (
                  <div className="flex flex-col">
                    <span className="font-medium text-slate-950">{item.cliente_nome}</span>
                    <span className="text-xs text-slate-500">ID: {item.id_cliente}</span>
                  </div>
                )
              },
              {
                header: "Empresa Emitente",
                cell: (item) => (
                  <div className="flex flex-col">
                    <span className="font-medium text-slate-900">{getEmpresaName(item.id_empresa)}</span>
                    <span className="text-xs text-slate-400">ID: {item.id_empresa}</span>
                  </div>
                )
              },
              {
                header: "Valor Serviço",
                cell: (item) => formatCurrency(item.valor_total),
                align: "right"
              },
              {
                header: "Data Liberação",
                cell: (item) => formatDate(item.created_at),
                align: "center"
              },
              {
                header: "Ação",
                cell: (item) => (
                  canEmitNfse ? (
                    <button
                      type="button"
                      onClick={() => handleFaturarClick(item)}
                      disabled={isFaturando}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#0b2f4a] px-4 py-2 text-xs font-semibold text-white hover:bg-[#061d2e] disabled:opacity-50 transition"
                    >
                      <Play className="h-3 w-3" />
                      Faturar
                    </button>
                  ) : null
                ),
                align: "right"
              }
            ]}
            renderCard={(item) => (
              <article key={`fila-nfse-card-${item.id}`} className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold px-2 py-0.5 bg-slate-100 rounded-lg text-slate-700">
                        Pedido #{item.ref_origem.match(/\d+/)?.[0] || "-"}
                      </span>
                      {item.os_ideal && (
                        <span className="text-xs text-slate-500 font-mono">OS: {item.os_ideal}</span>
                      )}
                    </div>
                    <h3 className="mt-2 font-semibold text-slate-950">{item.cliente_nome}</h3>
                    <p className="text-xs text-slate-500">Cliente ID: {item.id_cliente}</p>
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg">
                    Pendente
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm text-slate-600">
                  <p>Empresa: <strong>{getEmpresaName(item.id_empresa)}</strong></p>
                  <p className="text-right">Valor: <strong>{formatCurrency(item.valor_total)}</strong></p>
                  <p>Data: {formatDate(item.created_at)}</p>
                </div>
                <div className="flex justify-end pt-2">
                  {canEmitNfse && (
                    <button
                      type="button"
                      onClick={() => handleFaturarClick(item)}
                      disabled={isFaturando}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#0b2f4a] px-4 py-2 text-xs font-semibold text-white hover:bg-[#061d2e] disabled:opacity-50 transition"
                    >
                      <Play className="h-3 w-3" />
                      Faturar
                    </button>
                  )}
                </div>
              </article>
            )}
          />
        </div>
      ) : null}

      {/* Renderização do Histórico NF-e */}
      {activeTab === "HISTORICO_FISCAL" ? (
        <div className="space-y-4">
          <h2 className="text-xl font-bold px-4 py-2 border-b">Histórico NF-e (Produtos)</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm">
            <div className="relative">
              <input
                type="text"
                placeholder="Buscar por Nº Nota, Ref, ID ou Nome..."
                value={nfeSearch}
                onChange={(e) => setNfeSearch(e.target.value)}
                className="w-full rounded-2xl border border-[#d7e5e8] bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none transition focus:border-[#0b2f4a] focus:bg-white"
              />
            </div>
            <div>
              <select
                value={nfeEmpresa}
                onChange={(e) => setFilter("nfe-emp", e.target.value as (typeof EMPRESAS_EMITENTES)[number])}
                className="w-full rounded-2xl border border-[#d7e5e8] bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#0b2f4a] focus:bg-white"
              >
                <option value="">Todas as Empresas Emitentes</option>
                <option value="1">INGRESSO IDEAL</option>
                <option value="2">BIRÔ IDEAL</option>
                <option value="3">E3 BRINDES</option>
              </select>
            </div>
            <div>
              <select
                value={nfeStatus}
                onChange={(e) => setFilter("nfe-status", e.target.value as (typeof STATUS_NFE)[number])}
                className="w-full rounded-2xl border border-[#d7e5e8] bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#0b2f4a] focus:bg-white"
              >
                <option value="">Todos os Status</option>
                <option value="PENDENTE">Pendente</option>
                <option value="PRONTA_PARA_ENVIO">Pronta para envio</option>
                <option value="PROCESSANDO">Processando</option>
                <option value="AUTORIZADA">Autorizada</option>
                <option value="ERRO_ENVIO">Erro de Envio</option>
                <option value="ERRO_AUTORIZACAO">Erro de Autorização</option>
                <option value="REJEITADA">Rejeitada</option>
                <option value="CANCELADA">Cancelada</option>
                <option value="DENEGADA">Denegada</option>
                <option value="FALHA_INTEGRACAO">Falha de Integração/Envio</option>
                <option value="RETORNO_FOCUS">Retorno Focus</option>
                <option value="NAO_ENCONTRADA_FOCUS">Não Encontrada no Focus</option>
              </select>
            </div>
          </div>

          <ResponsiveList<NfeReadModel>
            items={filteredNfeList}
            getKey={(item) => `nfe-${item.id}`}
            isLoading={isLoading}
            emptyTitle="Nenhuma NF-e encontrada"
            emptyDescription="Nenhuma nota fiscal de produto registrada."
            columns={[
              {
                header: "Nº Nota",
                cell: (item) => <span className="font-semibold text-slate-900">{item.numero_nf ?? "****"}</span>,
                align: "center"
              },
              {
                header: "Pedido",
                cell: (item) => (
                  <div className="flex flex-col">
                    <span className="font-medium text-slate-950">#{item.id_int}</span>
                    <span className="text-xs text-slate-500 font-mono">{item.ref}</span>
                    <VendedorDoPedido valor={item.vendedor_pedido} />
                  </div>
                )
              },
              {
                header: "Status",
                cell: (item) => {
                  const displayStatus = getNfeDisplayStatus(item);
                  return (
                    <div className="flex flex-col items-center gap-1">
                      <StatusBadge status={displayStatus} tone={getStatusTone(displayStatus)} />
                      <StatusDoPedido valor={item.status_pedido} />
                    </div>
                  );
                },
                align: "center"
              },
              {
                header: "Cliente",
                cell: (item) => (
                  <ClienteComSocio
                    socio={item.socio_pagador_nome}
                    clienteNome={item.cliente_principal_nome || item.nome || item.fantasia || "Sem nome cadastrado"}
                    idCliente={item.cliente_principal_id ?? item.id_cliente}
                  />
                )
              },
              {
                header: "Empresa Emitente",
                cell: (item) => (
                  <div className="flex flex-col">
                    <span className="font-medium text-slate-900">{getEmpresaName(item.id_empresa)}</span>
                    <span className="text-xs text-slate-400">ID: {item.id_empresa}</span>
                  </div>
                )
              },
              {
                header: "Valor Total",
                cell: (item) => formatCurrency(item.valor_total_nf),
                align: "right"
              },
              {
                header: "Contas a Receber",
                cell: (item) => {
                  // O alerta so faz sentido no faturado: nas demais formas a
                  // cobranca ja foi paga na origem e nao ha nada a lancar.
                  if (item.status !== "AUTORIZADA" || !ehFaturado(item.tipo_cobranca)) {
                    return <span className="text-slate-400 font-medium">-</span>;
                  }
                  const count = nfePaymentsCountMap[item.ref] || 0;
                  const bInfo = boletosMap[item.ref];
                  const finStatus = getFinanceiroStatus(item.ref, item.valor_total_nf, count, bInfo);
                  return <StatusBadge status={finStatus.label} tone={finStatus.tone} />;
                },
                align: "center"
              },
              {
                header: "Data / Hora",
                cell: (item) => (
                  <div className="flex flex-col items-center">
                    <span>{formatDate(item.created_at)}</span>
                    <span className="text-xs text-slate-400">{formatTime(item.created_at)}</span>
                  </div>
                ),
                align: "center"
              },
              {
                header: "Ações",
                cell: (item) => <ActionsMenu items={getNfeActions(item)} />,
                align: "right"
              }
            ]}
            renderCard={(item) => (
              <article key={`nfe-card-${item.id}`} className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold px-2 py-0.5 bg-slate-100 rounded-lg text-slate-700">
                        Nº {item.numero_nf ?? "****"}
                      </span>
                      <span className="text-xs text-slate-500 font-medium">Pedido #{item.id_int} • {item.ref}</span>
                    </div>
                    <div className="mt-2">
                      <ClienteComSocio
                        socio={item.socio_pagador_nome}
                        clienteNome={item.cliente_principal_nome || item.nome || item.fantasia || "Sem nome cadastrado"}
                        idCliente={item.cliente_principal_id ?? item.id_cliente}
                      />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Vendedor: {String(item.vendedor_pedido || "").trim() || "-"}
                      {String(item.status_pedido || "").trim()
                        ? ` • Pedido: ${humanizeStatus(String(item.status_pedido))}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    {(() => {
                      const displayStatus = getNfeDisplayStatus(item);
                      return <StatusBadge status={displayStatus} tone={getStatusTone(displayStatus)} />;
                    })()}
                    {item.status === "AUTORIZADA" && ehFaturado(item.tipo_cobranca) && (
                      (() => {
                        const count = nfePaymentsCountMap[item.ref] || 0;
                        const bInfo = boletosMap[item.ref];
                        const finStatus = getFinanceiroStatus(item.ref, item.valor_total_nf, count, bInfo);
                        return <StatusBadge status={finStatus.label} tone={finStatus.tone} />;
                      })()
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm text-slate-600">
                  <p>Empresa: <strong>{getEmpresaName(item.id_empresa)}</strong></p>
                  <p className="text-right">Valor: <strong>{formatCurrency(item.valor_total_nf)}</strong></p>
                  <p>Data: {formatDate(item.created_at)} {formatTime(item.created_at)}</p>
                </div>
                <div className="flex justify-end pt-2">
                  <ActionsMenu items={getNfeActions(item)} label="Ações" />
                </div>
              </article>
            )}
          />
        </div>
      ) : null}

      {/* Renderização do Histórico NFS-e */}
      {activeTab === "HISTORICO_FISCAL" ? (
        <div className="space-y-4 mt-12">
          <h2 className="text-xl font-bold px-4 py-2 border-b">Histórico NFS-e (Serviços)</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm">
            <div className="relative">
              <input
                type="text"
                placeholder="Buscar por Nº NFS-e, Ref, ID ou Nome..."
                value={nfseSearch}
                onChange={(e) => setNfseSearch(e.target.value)}
                className="w-full rounded-2xl border border-[#d7e5e8] bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none transition focus:border-[#0b2f4a] focus:bg-white"
              />
            </div>
            <div>
              <select
                value={nfseEmpresa}
                onChange={(e) => setFilter("nfse-emp", e.target.value as (typeof EMPRESAS_EMITENTES)[number])}
                className="w-full rounded-2xl border border-[#d7e5e8] bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#0b2f4a] focus:bg-white"
              >
                <option value="">Todas as Empresas Emitentes</option>
                <option value="1">INGRESSO IDEAL</option>
                <option value="2">BIRÔ IDEAL</option>
                <option value="3">E3 BRINDES</option>
              </select>
            </div>
            <div>
              <select
                value={nfseStatus}
                onChange={(e) => setFilter("nfse-status", e.target.value as (typeof STATUS_NFSE)[number])}
                className="w-full rounded-2xl border border-[#d7e5e8] bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#0b2f4a] focus:bg-white"
              >
                <option value="">Todos os Status</option>
                <option value="PENDENTE">Pendente</option>
                <option value="PRONTA_PARA_ENVIO">Pronta para envio</option>
                <option value="PROCESSANDO">Processando</option>
                <option value="AUTORIZADA">Autorizada</option>
                <option value="ERRO_ENVIO">Erro de Envio</option>
                <option value="REJEITADA">Rejeitada</option>
                <option value="CANCELADA">Cancelada</option>
              </select>
            </div>
          </div>

          <ResponsiveList<NfseReadModel>
            items={filteredNfseList}
            getKey={(item) => `nfse-${item.id}`}
            isLoading={isLoading}
            emptyTitle="Nenhuma NFS-e encontrada"
            emptyDescription="Nenhuma nota fiscal de serviço registrada."
            columns={[
              {
                header: "Nº NFS-e",
                cell: (item) => <span className="font-semibold text-slate-900">{item.numero_nfse ?? "****"}</span>,
                align: "center"
              },
              {
                header: "Referência",
                cell: (item) => <strong className="text-slate-950">{item.ref}</strong>
              },
              {
                header: "Status",
                cell: (item) => <StatusBadge status={item.status} tone={getStatusTone(item.status)} />,
                align: "center"
              },
              {
                header: "Cliente / Tomador",
                cell: (item) => (
                  <div className="flex flex-col">
                    <span className="font-medium text-slate-950">{item.nome || item.fantasia || "Sem nome cadastrado"}</span>
                    <span className="text-xs text-slate-500">ID: {item.id_cliente}</span>
                  </div>
                )
              },
              {
                header: "Empresa Emitente",
                cell: (item) => (
                  <div className="flex flex-col">
                    <span className="font-medium text-slate-900">{getEmpresaName(item.id_empresa)}</span>
                    <span className="text-xs text-slate-400">ID: {item.id_empresa}</span>
                  </div>
                )
              },
              {
                header: "Valor Serviço",
                cell: (item) => formatCurrency(item.valor_servicos),
                align: "right"
              },
              {
                header: "Data / Hora",
                cell: (item) => (
                  <div className="flex flex-col items-center">
                    <span>{formatDate(item.created_at)}</span>
                    <span className="text-xs text-slate-400">{formatTime(item.created_at)}</span>
                  </div>
                ),
                align: "center"
              },
              {
                header: "Ações",
                cell: (item) => <ActionsMenu items={getNfseActions(item)} />,
                align: "right"
              }
            ]}
            renderCard={(item) => (
              <article key={`nfse-card-${item.id}`} className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold px-2 py-0.5 bg-slate-100 rounded-lg text-slate-700">
                        Nº {item.numero_nfse ?? "****"}
                      </span>
                      <span className="text-xs text-slate-500 font-medium">{item.ref}</span>
                    </div>
                    <h3 className="mt-2 font-semibold text-slate-950">{item.nome || item.fantasia || "Sem nome cadastrado"}</h3>
                    <p className="text-xs text-slate-500">Cliente ID: {item.id_cliente}</p>
                  </div>
                  <StatusBadge status={item.status} tone={getStatusTone(item.status)} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm text-slate-600">
                  <p>Empresa: <strong>{getEmpresaName(item.id_empresa)}</strong></p>
                  <p className="text-right">Valor: <strong>{formatCurrency(item.valor_servicos)}</strong></p>
                  <p>Data: {formatDate(item.created_at)} {formatTime(item.created_at)}</p>
                </div>
                <div className="flex justify-end pt-2">
                  <ActionsMenu items={getNfseActions(item)} label="Ações" />
                </div>
              </article>
            )}
          />
        </div>
      ) : null}

      {!isLoading ? (
        <section className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500 flex justify-between items-center">
          <span>Notas fiscais atualizadas.</span>
        </section>
      ) : null}

      {conferenciaPendente && (
        <ConferenciaFaturamentoModal
          pedido={conferenciaPendente.pedido}
          resultado={conferenciaPendente.resultado}
          reconferindo={reconferindo}
          onFechar={() => setConferenciaPendente(null)}
          onIrPara={(rota) => {
            setConferenciaPendente(null);
            router.push(rota);
          }}
          onReconferir={async () => {
            setReconferindo(true);
            try {
              const resultado = await conferirFaturamento(conferenciaPendente.idInt);
              if (resultado.ok) {
                setConferenciaPendente(null);
                showToast({ type: "success", title: "Pendências resolvidas. Pode faturar." });
                return;
              }
              setConferenciaPendente({ ...conferenciaPendente, resultado });
            } finally {
              setReconferindo(false);
            }
          }}
        />
      )}

      {focusConfirmNote && (
        <EmissaoNfeModal
          key={focusConfirmNote.id}
          nota={focusConfirmNote}
          passoInicial={passoDoModal}
          onFechar={() => setFocusConfirmNote(null)}
          recarregar={async () => {
            const atualizado = await nfeData.refresh();
            return atualizado?.nfeList?.find((n) => n.ref === focusConfirmNote.ref) ?? null;
          }}
          onAbrirNota={(idNota) => {
            setFocusConfirmNote(null);
            router.push(`/notas-fiscais/${idNota}`);
          }}
        />
      )}

      {launchModalOpen && selectedNfeForLaunch && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-lg w-full overflow-hidden flex flex-col transform transition-all scale-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 pt-6 pb-4 flex items-center gap-3 border-b border-slate-100">
              <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl shrink-0">
                <FileText className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 leading-tight">
                  Lançar no Contas a Receber
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">Ref: {selectedNfeForLaunch.ref}</p>
              </div>
            </div>

            <div className="px-6 py-6 overflow-y-auto max-h-[60vh] space-y-4">
              {isLoadingVencimentos ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-500">
                  <Loader2 className="h-8 w-8 animate-spin text-[#0b2f4a]" />
                  <span className="text-sm font-medium">Carregando vencimentos fiscais...</span>
                </div>
              ) : vencimentosForLaunch.length === 0 ? (
                <div className="bg-rose-50 border border-rose-100 rounded-2xl p-5 text-rose-800 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-rose-900">
                    <AlertTriangle className="h-5 w-5 text-rose-700" />
                    Aviso de Bloqueio
                  </div>
                  <p className="text-sm leading-relaxed">
                    Esta NF-e não possui vencimentos fiscais para lançar no Contas a Receber.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Detalhes do Cliente e Nota */}
                  <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-2.5 text-xs text-slate-600">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-slate-400 block uppercase tracking-wider text-[9px] font-bold">Cliente</span>
                        <strong className="text-slate-800 text-sm block truncate font-medium">
                          {selectedClientForLaunch?.nome || selectedNfeForLaunch.nome || selectedNfeForLaunch.fantasia || "Sem nome cadastrado"}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-400 block uppercase tracking-wider text-[9px] font-bold">CPF/CNPJ Documento</span>
                        <strong className="text-slate-800 text-sm block truncate font-mono">
                          {selectedClientForLaunch?.documento || "Não disponível"}
                        </strong>
                      </div>
                    </div>
                    <hr className="border-slate-100" />
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <span className="text-slate-400 block uppercase tracking-wider text-[9px] font-bold">Nº Nota</span>
                        <strong className="text-slate-800 text-sm block font-mono font-medium">{selectedNfeForLaunch.numero_nf ?? "****"}</strong>
                      </div>
                      <div>
                        <span className="text-slate-400 block uppercase tracking-wider text-[9px] font-bold">Valor Total</span>
                        <strong className="text-slate-800 text-sm block font-medium">{formatCurrency(selectedNfeForLaunch.valor_total_nf)}</strong>
                      </div>
                      <div>
                        <span className="text-slate-400 block uppercase tracking-wider text-[9px] font-bold">Empresa</span>
                        <strong className="text-slate-800 text-sm block truncate font-medium">{getEmpresaName(selectedNfeForLaunch.id_empresa)}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Lista de Parcelas */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Parcelas do Vencimento Fiscal</h4>
                    <div className="border border-slate-100 rounded-2xl overflow-hidden divide-y divide-slate-100">
                      {vencimentosForLaunch.map((pg) => {
                        const alreadyLaunched = boletosMap[selectedNfeForLaunch.ref]?.some(b => Number(b.parcela) === pg.numero_parcela) || false;
                        return (
                          <div key={pg.id} className="p-3.5 flex items-center justify-between gap-3 bg-white text-xs hover:bg-slate-50/50 transition">
                            <div className="space-y-1">
                              <p className="font-semibold text-slate-800">
                                Parcela {pg.numero_parcela}/{pg.total_parcelas}
                                {pg.forma_pagamento === "17" && (
                                  <span className="ml-1.5 px-1.5 py-0.5 bg-blue-50 text-blue-700 font-bold rounded text-[9px]">PIX</span>
                                )}
                              </p>
                              <p className="text-slate-400">
                                Vencimento: <strong className="text-slate-600 font-mono font-medium">{formatDate(pg.data_vencimento)}</strong>
                              </p>
                              <p className="text-[10px] text-slate-400">
                                Forma: {getFormaPagamentoLabel(pg.forma_pagamento)}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-bold text-slate-900 font-mono">{formatCurrency(pg.valor)}</span>
                              {alreadyLaunched ? (
                                <span className="px-2 py-1 bg-slate-100 text-slate-500 font-bold rounded-lg text-[10px] border border-slate-200">
                                  Já lançado
                                </span>
                              ) : (
                                <span className="px-2 py-1 bg-blue-50 text-blue-700 font-bold rounded-lg text-[10px] border border-blue-200">
                                  A lançar
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Resumo do Lançamento */}
                  {(() => {
                    const toLaunch = vencimentosForLaunch.filter(pg => !boletosMap[selectedNfeForLaunch.ref]?.some(b => Number(b.parcela) === pg.numero_parcela));
                    if (toLaunch.length === 0) {
                      return (
                        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-xs text-amber-800 space-y-1">
                          <span className="font-bold text-amber-900 block font-medium">Todas as parcelas já lançadas</span>
                          <span>Não há novas parcelas a serem lançadas no Contas a Receber para esta NF-e.</span>
                        </div>
                      );
                    }
                    const totalValorToLaunch = toLaunch.reduce((acc, pg) => acc + pg.valor, 0);
                    return (
                      <div className="bg-[#0b2f4a]/5 border border-[#0b2f4a]/10 rounded-2xl p-4 space-y-2 text-xs">
                        <div className="flex justify-between items-center text-slate-600">
                          <span>Novos boletos a gerar:</span>
                          <strong className="text-slate-900 font-medium">{toLaunch.length} de {vencimentosForLaunch.length}</strong>
                        </div>
                        <div className="flex justify-between items-center text-slate-600">
                          <span>Valor total a lançar:</span>
                          <strong className="text-slate-900 font-mono text-sm font-bold">{formatCurrency(totalValorToLaunch)}</strong>
                        </div>
                        <hr className="border-[#0b2f4a]/10" />
                        <p className="text-[10px] text-slate-500 italic leading-normal">
                          Os boletos serão criados com status <strong className="text-slate-700 font-semibold">&apos;A_VENCER&apos;</strong> no Contas a Receber. Nenhuma entrada será enviada para pagamentos_v2.
                        </p>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end items-center gap-3">
              <button
                type="button"
                onClick={() => setLaunchModalOpen(false)}
                disabled={isLaunchingBoleto}
                className="px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 disabled:opacity-50 transition rounded-xl"
              >
                Cancelar
              </button>
              {vencimentosForLaunch.length > 0 && (
                <button
                  type="button"
                  onClick={handleLaunchBoletos}
                  disabled={
                    isLaunchingBoleto ||
                    isLoadingVencimentos ||
                    vencimentosForLaunch.filter(pg => !boletosMap[selectedNfeForLaunch.ref]?.some(b => Number(b.parcela) === pg.numero_parcela)).length === 0
                  }
                  className="px-5 py-2.5 text-xs font-bold text-white bg-[#0b2f4a] hover:bg-[#061d2e] disabled:opacity-50 rounded-xl shadow-sm transition flex items-center justify-center gap-1.5 min-w-[150px]"
                >
                  {isLaunchingBoleto ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Lançando...
                    </>
                  ) : (
                    "Confirmar Lançamento"
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmação pós-lançamento */}
      {launchSuccessModalOpen && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden flex flex-col transform transition-all scale-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 pt-6 pb-4 flex items-center gap-3">
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl shrink-0">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900 leading-tight">
                Lançamento Concluído
              </h3>
            </div>
            <div className="px-6 pb-6 text-sm text-slate-600 leading-relaxed">
              Contas a receber criado com sucesso. Deseja revisar e registrar os boletos no banco agora?
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end items-center gap-3">
              <button
                type="button"
                onClick={() => setLaunchSuccessModalOpen(false)}
                className="px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition rounded-xl"
              >
                Agora não
              </button>
              <button
                type="button"
                onClick={() => {
                  setLaunchSuccessModalOpen(false);
                  if (justLaunchedNfe) {
                    void handleOpenReviewModal(justLaunchedNfe);
                  }
                }}
                className="px-5 py-2.5 text-xs font-bold text-white bg-[#0b2f4a] hover:bg-[#061d2e] rounded-xl shadow-sm transition flex items-center justify-center"
              >
                Revisar e registrar boletos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Revisão e Edição de Boletos */}
      <RevisarGeracaoBancariaModal
        isOpen={reviewModalOpen}
        onClose={() => setReviewModalOpen(false)}
        extReference={selectedNfeForReview?.ref || ""}
        nomeCliente={selectedNfeForReview?.nome || selectedNfeForReview?.fantasia || undefined}
        valorTotalNf={selectedNfeForReview?.valor_total_nf}
        idInt={selectedNfeForReview?.id_int || undefined}
        onSaveSuccess={() => {
          if (selectedNfeForReview) {
            void refreshFinanceiroStatusForRef(selectedNfeForReview.ref);
          }
        }}
      />

      {/* Modal de Carta de Correção (CCe) */}
      {cceModalOpen && cceNote && (
        <div className="fixed inset-0 z-[10000] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden flex flex-col transform transition-all scale-100 animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-6 py-5 flex items-center justify-between border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Carta de Correção (CCe)</h3>
              <button
                type="button"
                onClick={() => setCceModalOpen(false)}
                className="p-1.5 hover:bg-slate-100 rounded-xl transition text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {/* Content */}
            <div className="px-6 py-6 space-y-4">
              <p className="text-xs text-slate-500 leading-normal font-sans">
                Digite o texto de correção para a nota <strong className="font-mono text-slate-700">{cceNote.ref}</strong> (mínimo 15 caracteres).
              </p>
              <textarea
                value={cceText}
                onChange={(e) => setCceText(e.target.value)}
                disabled={cceLoading}
                className="w-full h-32 p-3 text-xs rounded-xl border border-slate-200 bg-white focus:border-[#0b2f4a] outline-none resize-none font-sans"
                placeholder="Exemplo: Correção do endereço de entrega para Rua das Flores, 123..."
              />
              {cceText.trim().length < 15 && cceText.trim().length > 0 && (
                <p className="text-[11px] text-amber-600 font-medium font-sans">
                  Faltam {15 - cceText.trim().length} caracteres para atingir o mínimo de 15.
                </p>
              )}
            </div>
            {/* Footer */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end items-center gap-3">
              <button
                type="button"
                onClick={() => setCceModalOpen(false)}
                disabled={cceLoading}
                className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 transition rounded-xl font-sans"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSendCce}
                disabled={cceLoading || cceText.trim().length < 15}
                className="px-5 py-2.5 text-xs font-bold text-white bg-[#0b2f4a] hover:bg-[#061d2e] disabled:opacity-50 rounded-xl shadow-sm transition flex items-center justify-center gap-1.5 min-w-[120px] font-sans"
              >
                {cceLoading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  "Enviar CCe"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Cancelamento */}
      {cancelModalOpen && (cancelNoteNfe || cancelNoteNfse) && (
        <div className="fixed inset-0 z-[10000] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden flex flex-col transform transition-all scale-100 animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-6 py-5 flex items-center justify-between border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                Cancelar {cancelNoteNfe ? "NF-e" : "NFS-e"}
              </h3>
              <button
                type="button"
                onClick={() => setCancelModalOpen(false)}
                className="p-1.5 hover:bg-slate-100 rounded-xl transition text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {/* Content */}
            <div className="px-6 py-6 space-y-4">
              <p className="text-xs text-slate-500 leading-normal font-sans">
                Informe a justificativa de cancelamento para a nota <strong className="font-mono text-slate-700">{(cancelNoteNfe || cancelNoteNfse)?.ref}</strong> (mínimo 15 caracteres).
              </p>
              <textarea
                value={cancelJustificativa}
                onChange={(e) => setCancelJustificativa(e.target.value)}
                disabled={cancelLoading}
                className="w-full h-32 p-3 text-xs rounded-xl border border-slate-200 bg-white focus:border-[#0b2f4a] outline-none resize-none font-sans"
                placeholder="Exemplo: Duplicidade na emissão ou desistência da venda do serviço..."
              />
              {cancelJustificativa.trim().length < 15 && cancelJustificativa.trim().length > 0 && (
                <p className="text-[11px] text-amber-600 font-medium font-sans">
                  Faltam {15 - cancelJustificativa.trim().length} caracteres para atingir o mínimo de 15.
                </p>
              )}
            </div>
            {/* Footer */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end items-center gap-3">
              <button
                type="button"
                onClick={() => setCancelModalOpen(false)}
                disabled={cancelLoading}
                className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 transition rounded-xl font-sans"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSendCancel}
                disabled={cancelLoading || cancelJustificativa.trim().length < 15}
                className="px-5 py-2.5 text-xs font-bold text-white bg-red-650 hover:bg-red-700 disabled:opacity-50 rounded-xl shadow-sm transition flex items-center justify-center gap-1.5 min-w-[120px] font-sans"
              >
                {cancelLoading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Cancelando...
                  </>
                ) : (
                  "Confirmar"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
