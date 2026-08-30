"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { usePedidosMockDb } from "./hooks/usePedidosMockDb";
import { useAppToast } from "@/components/common/AppToast";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  Boxes,
  FileText,
  AlertCircle,
  Eye,
  ChevronDown,
  ExternalLink,
  Printer
} from "lucide-react";
import { ModeloMock, ArteStatus, ProducaoStatus } from "./types";
import { getPropostaDetailById } from "@/features/orcamentos/services/orcamentos.service";
import type { Proposta } from "@/features/orcamentos/types";
import {
  listarPropostasLiberadasParaBoletim,
  buscarPropostasLiberadasParaBoletim,
  obterPropostaLiberadaParaBoletim,
  criarPedidoParaBoletim,
  salvarModelosBoletim,
  type PropostaLiberadaBoletim,
  atualizarOrientacoesBoletim,
  atualizarObsTecnicaProposta,
  parsePedidosObs,
  serializePedidosObs,
  obterGabaritosOperacionais,
  obterFreteEscolhido,
  avancarStatusParaEmProducao
} from "./services/boletim-propostas.service";
import { obterPedidoOperacionalPorIdOuIdInt } from "./services/pedidos-detalhe.service";
import { SETORES_PCP, SETOR_PADRAO, coresDoSetor, normalizarSetor } from "./setores";
import { tituloEventoDoPedido } from "./titulo-evento";
import { atribuirSetorAosModelos } from "./services/pedidos-artes.service";
import {
  listarBoletinsDaProposta,
  salvarBoletimSetor,
  salvarConferenciaDosSetores,
  type BoletimSetor,
  type ConferenciaSetor
} from "./services/boletim-setores.service";
import { abrirPdfOs, baixarPdfOs, type LayoutPdfOs } from "./services/imprimir-os.client";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { getSupabaseClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/common/PageHeader";
import { TituloNumeroCliente } from "@/components/common/TituloNumeroCliente";
import {
  carregarRevisaoGeral,
  confirmarRevisao,
  validarRevisao,
  REVISAO_GERAL_VAZIA,
  type RevisaoGeral
} from "./services/revisao-expedicao.service";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";

export interface GabaritoItem {
  id: string;
  nome: string;
  descricao: string;
  previewImageUrl: string;
}

/** Setores possíveis do Boletim de Produção (campo próprio do boletim). */
/** Mantido por compatibilidade de import; a fonte e SETORES_PCP. */
export const SETORES_BOLETIM: readonly string[] = SETORES_PCP;

/**
 * Cor de cada setor. Serve para separar os blocos de olho, sem ler o rótulo —
 * a mesma cor identifica o setor no cabeçalho do grupo e no chip do lote.
 * As classes são literais porque o Tailwind não resolve nome montado em runtime.
 */
export const MOCK_GABARITOS: GabaritoItem[] = [
  { id: "sem_gabarito", nome: "Sem gabarito", descricao: "Sem formatação ou gabarito específico.", previewImageUrl: "" },
  { id: "001_ate_n", nome: "001 até N", descricao: "Numeração sequencial com 3 dígitos.", previewImageUrl: "/vip_gabarito.png" },
  { id: "0001_ate_n", nome: "0001 até N", descricao: "Numeração sequencial com 4 dígitos.", previewImageUrl: "/vip_gabarito.png" },
  { id: "vip_0001", nome: "VIP-0001", descricao: "Prefixo 'VIP' seguido por 4 dígitos sequenciais.", previewImageUrl: "/vip_gabarito.png" },
  { id: "cam_0001", nome: "CAM-0001", descricao: "Prefixo 'CAM' seguido por 4 dígitos sequenciais.", previewImageUrl: "/vip_gabarito.png" },
  { id: "pista_0001", nome: "PISTA-0001", descricao: "Prefixo 'PISTA' seguido por 4 dígitos sequenciais.", previewImageUrl: "/vip_gabarito.png" },
  { id: "personalizado", nome: "Personalizado", descricao: "Gabarito customizado de acordo com o arquivo do cliente.", previewImageUrl: "/vip_gabarito.png" }
];

function parsePrazoToDate(prazoText: string): string {
  const defaultDate = new Date();
  defaultDate.setDate(defaultDate.getDate() + 7); // Default 7 days
  
  if (!prazoText) {
    return defaultDate.toISOString().split("T")[0];
  }
  
  const match = prazoText.match(/(\d+)/);
  if (match) {
    const days = parseInt(match[1], 10);
    const date = new Date();
    date.setDate(date.getDate() + (days || 7));
    return date.toISOString().split("T")[0];
  }
  
  return defaultDate.toISOString().split("T")[0];
}

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Dias de produção declarados no cadastro do produto (public.produtos.prazo é
 * texto livre: "3 dias úteis", "Produção: 1 dia útil + Frete"). Vale o primeiro
 * número do texto; sem número não há prazo utilizável.
 */
function diasDoPrazoCadastrado(prazoText?: string | null): number | null {
  const match = String(prazoText || "").match(/(\d+)/);
  if (!match) return null;
  const dias = Number(match[1]);
  return Number.isFinite(dias) && dias > 0 ? dias : null;
}

/** Data de hoje + N dias. Em "dias úteis" pula sábado e domingo (feriados não entram). */
function somarDiasDeProducao(dias: number, emDiasUteis: boolean): string {
  const data = new Date();
  let restantes = dias;
  while (restantes > 0) {
    data.setDate(data.getDate() + 1);
    const diaDaSemana = data.getDay();
    if (!emDiasUteis || (diaDaSemana !== 0 && diaDaSemana !== 6)) {
      restantes -= 1;
    }
  }
  // Formatação local: toISOString() joga para UTC e adiantaria um dia à noite.
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${data.getFullYear()}-${mes}-${dia}`;
}

/**
 * Data limite sugerida a partir do prazo de produção cadastrado em cada produto
 * do pedido: vale sempre o maior. Dois produtos, um de 1 dia e outro de 3 dias,
 * dão a data de 3 dias. O resumo da proposta não serve aqui porque leva só o
 * prazo do primeiro item (calculateResumo). Sem prazo em nenhum produto, cai no
 * padrão de 7 dias do formulário.
 */
function dataLimitePorPrazos(prazos: (string | null | undefined)[]): string {
  let maiorData = "";

  for (const textoPrazo of prazos) {
    const texto = textoPrazo || "";
    const dias = diasDoPrazoCadastrado(texto);
    if (dias === null) continue;

    // Compara a data resultante, não o número de dias: "2 dias úteis" pode cair
    // depois de "3 dias" corridos quando o intervalo pega um fim de semana.
    const data = somarDiasDeProducao(dias, /util|uteis/.test(semAcento(texto)));
    if (!maiorData || data > maiorData) maiorData = data;
  }

  return maiorData || parsePrazoToDate("");
}

/**
 * Data limite sugerida a partir do prazo de produção cadastrado em cada produto
 * do pedido: vale sempre o maior. Dois produtos, um de 1 dia e outro de 3 dias,
 * dão a data de 3 dias. O resumo da proposta não serve aqui porque leva só o
 * prazo do primeiro item (calculateResumo). Sem prazo em nenhum produto, cai no
 * padrão de 7 dias do formulário.
 *
 * Regra única do prazo (decisão do dono em 18/08/2026): útil ou corrido sai do
 * TEXTO do cadastro — "1 dia útil" pula fim de semana, "3 dias" não. Feriados
 * ficam de fora: o ERP não tem calendário deles. `prazoLimiteDoPedido`, que
 * contava sempre em dias úteis, não rege mais este cálculo.
 */
function calcularDataLimitePorProdutos(itens: Proposta["itens"]): string {
  return dataLimitePorPrazos(
    itens
      .filter((item) => item.statusItem !== "CANCELADO")
      .map((item) => item.produto?.prazo || item.prazo || "")
  );
}

function canStartProduction(proposal: Proposta): boolean {
  // Abstração operacional de confirmação financeira
  // Futuramente a regra virá de pagamentos_v2 e confirmação financeira real.
  return proposal.cobrancaStatus === "PAGA";
}

/**
 * Rótulo do tipo de numeração para leitura. Na edição do boletim o campo é só
 * exibido — quem escolhe é o orçamento —, e sem o `<select>` não há mais a
 * lista de `<option>` para traduzir o código gravado.
 *
 * Valor desconhecido volta cru de propósito: some ler "ALEATORIO" (legado) do
 * que esconder atrás de um rótulo inventado o que está no banco.
 */
function rotuloTipoNumeracao(tipo: string): string {
  if (tipo === "SEM_NUMERACAO") return "Sem Numeração";
  if (tipo === "SEQUENCIAL") return "Sequencial";
  if (tipo === "CUSTOMIZADA") return "Customizada (CSV)";
  return tipo || "Sem Numeração";
}

function generateUniqueId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
}

export function BoletimFormPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const modoParam = searchParams ? searchParams.get("modo") : null;
  const idIntParam = searchParams ? searchParams.get("id_int") : null;
  const isEditing = modoParam === "edicao" && !!idIntParam;

  const { user } = useAuth();
  const canEditDate = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "pedidos.edit_data");
  const canEditObs = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "pedidos.edit_obs");
  const canPrintOS = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "pedidos.print_os");
  const lockDate = isEditing && !canEditDate;
  const lockObs = isEditing && !canEditObs;

  // Impressão da OS em PDF: exige proposta liberada para produção (is_prd_aprovado).
  // Checagem explícita no componente — o servidor revalida (409) de qualquer forma.
  const [isPrdAprovado, setIsPrdAprovado] = useState(false);
  const [isPrintingOs, setIsPrintingOs] = useState(false);

  /**
   * Aviso na tela de ORIGEM enquanto o PDF é montado do outro lado.
   *
   * `abrirPdfOs` abre a aba de forma síncrona no clique e retorna na hora — o
   * PDF ainda vai levar segundos para existir. Sem isto, o rótulo "Gerando
   * PDF..." pisca por milissegundos aqui e a aba nova fica em branco, sem nada
   * dizendo que há trabalho em curso. Era metade da sensação de "não abriu".
   */
  function avisarGeracaoDoPdf() {
    showToast({
      type: "info",
      title: "Gerando o PDF na nova aba",
      description: "A OS abre assim que ficar pronta. Na primeira impressão do dia costuma demorar mais."
    });
  }

  useEffect(() => {
    if (!isEditing || !idIntParam) {
      setIsPrdAprovado(false);
      return;
    }
    const client = getSupabaseClient();
    if (!client) return;
    let cancelado = false;
    void client
      .from("propostas")
      .select("is_prd_aprovado")
      .eq("id_int", Number(idIntParam))
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelado) setIsPrdAprovado(data?.is_prd_aprovado === true);
      });
    return () => {
      cancelado = true;
    };
  }, [isEditing, idIntParam]);

  const [loadedPedidoId, setLoadedPedidoId] = useState<string | null>(null);
  const [existingObs, setExistingObs] = useState<string | null>(null);
  const [hasLoadedExisting, setHasLoadedExisting] = useState(false);

  const { showToast } = useAppToast();
  const { pedidos } = usePedidosMockDb();

  // Proposal selection and loading states
  const [propostas, setPropostas] = useState<PropostaLiberadaBoletim[]>([]);
  const [recentes, setRecentes] = useState<PropostaLiberadaBoletim[]>([]);
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null);
  const [loadingPropostas, setLoadingPropostas] = useState(false);
  const [propostaBusca, setPropostaBusca] = useState("");
  const [selectedProposta, setSelectedProposta] = useState<Proposta | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  /** Aba "Revisão" aberta: confere o pedido inteiro, não um setor. */
  const [abaExpedicao, setAbaExpedicao] = useState(false);

  /**
   * Bloco geral da revisão: volume e peso bruto são do PEDIDO, não de cada
   * setor. Gravado em `expedicoes`, a mesma linha que a Expedição já lê.
   */
  const [revisaoGeral, setRevisaoGeral] = useState<RevisaoGeral>(REVISAO_GERAL_VAZIA);
  const [confirmandoRevisao, setConfirmandoRevisao] = useState(false);
  /**
   * Trava o botão depois que a liberação deu certo: o pedido já saiu para a
   * Expedição e um segundo clique só voltaria erro da allow-list de
   * `marcarPronto`. Também sinaliza que a navegação está a caminho.
   */
  const [revisaoLiberada, setRevisaoLiberada] = useState(false);

  /**
   * Revisão/conferência de cada setor (peso real, volumes e responsável).
   * Vive em `propostas_os_setores`, uma linha por setor — antes era texto dentro
   * de `propostas_os.obs`.
   */
  const [conferenciaPorSetor, setConferenciaPorSetor] = useState<Record<string, ConferenciaSetor>>({});
  /**
   * Sinaliza que a conferência já veio do banco. A sugestão de peso e de
   * responsável só pode entrar depois disso: `loadBoletins` substitui o mapa
   * inteiro e apagaria qualquer valor semeado antes da leitura.
   */
  const [conferenciaCarregada, setConferenciaCarregada] = useState(false);

  // Block 1 & 2: Main Info & Commercial Briefing State
  const [clienteNome, setClienteNome] = useState("");
  const [contatoNome, setContatoNome] = useState("");
  const [empresa, setEmpresa] = useState("Ideal Grafica");
  const [vendedor, setVendedor] = useState("Everton Farias");
  const [dataPrevistaEntrega, setDataPrevistaEntrega] = useState("");
  // Boletins da proposta — um por setor, todos no mesmo pedido.
  // `boletimId` é a identidade do boletim aberto (propostas_os_setores.id).
  const [boletins, setBoletins] = useState<BoletimSetor[]>([]);
  const [boletimId, setBoletimId] = useState<string | null>(null);
  const [boletimSetor, setBoletimSetor] = useState("");
  const [boletimHora, setBoletimHora] = useState("");
  const [urgente, setUrgente] = useState(false);
  const [formaPagamento, setFormaPagamento] = useState("Pix a vista");
  
  const [dadosEventoNome, setDadosEventoNome] = useState("");
  const [dadosEventoData, setDadosEventoData] = useState("");
  const [dadosEventoLocal, setDadosEventoLocal] = useState("");

  const [briefingOperacional, setBriefingOperacional] = useState("");
  const [obsCriticas, setObsCriticas] = useState("");

  // Block 5 & 6 & 7: Technical Briefing, Design & Logistics & Finishes

  // New attachments & structured finishing states
  const [attachments, setAttachments] = useState<{ url: string; name: string; type: string }[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const [openGabaritoDropdown, setOpenGabaritoDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const [gabaritoSearchQuery, setGabaritoSearchQuery] = useState("");
  const [selectedGabaritoPreview, setSelectedGabaritoPreview] = useState<GabaritoItem | null>(null);

  const [obsImpressao, setObsImpressao] = useState("");
  const [obsAcabamento, setObsAcabamento] = useState("");
  const [supportFiles, setSupportFiles] = useState<{ name: string; url: string; size?: number; created_at?: string }[]>([]);
  const [loadingSupportFiles, setLoadingSupportFiles] = useState(false);
  const [uploadingSupportFile, setUploadingSupportFile] = useState(false);
  const [gabaritosOptions, setGabaritosOptions] = useState<string[]>([]);
  const [cotacaoFrete, setCotacaoFrete] = useState<any | null>(null);
  
  // Logistics Fields
  const [logisticaServico, setLogisticaServico] = useState("");
  const [logisticaTransportador, setLogisticaTransportador] = useState("");
  const [logisticaPesoReal, setLogisticaPesoReal] = useState("");
  const [logisticaQtdVolumes, setLogisticaQtdVolumes] = useState("");
  const [logisticaTipoVolume, setLogisticaTipoVolume] = useState("");
  const [logisticaResponsavel, setLogisticaResponsavel] = useState("");
  const [logisticaObsFrete, setLogisticaObsFrete] = useState("");
  const [statusOperacional, setStatusOperacional] = useState<string>("PENDENTE");

  /**
   * `propostas.status_interno` — o status MACRO da proposta, o mesmo que a lista
   * exibe. Existe como state próprio porque é o único valor que o salvamento do
   * boletim muda (via `avancarStatusParaEmProducao`) e que a tela precisa passar
   * a refletir na hora: antes só aparecia atualizado ao voltar para a lista.
   *
   * Nasce do `statusProducao` do pedido, que o serviço já deriva desta mesma
   * coluna — `propostas_os.status_producao` está morta (ver pedidos-detalhe.service).
   * Os dois campos do cabeçalho divergem quando a proposta não está liberada
   * para produção: ali o operacional mostra BLOQUEADO e este, o status real.
   */
  const [statusProposta, setStatusProposta] = useState<string>("");

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    async function loadData() {
      try {
        const ops = await obterGabaritosOperacionais();
        setGabaritosOptions(ops);
      } catch (err) {
        console.error("Erro ao carregar designers e gabaritos:", err);
      }
    }
    loadData();
  }, []);

  useEffect(() => {
    if (!isEditing || !idIntParam || hasLoadedExisting) return;

    async function loadPedidoExistente() {
      setLoadingDetails(true);
      try {
        const pedido = await obterPedidoOperacionalPorIdOuIdInt(Number(idIntParam));
        if (pedido) {
          setLoadedPedidoId(pedido.id || null);
          setExistingObs(pedido.obs || "");
          setHasLoadedExisting(true);
          
          setSelectedProposta({
            id_int: Number(idIntParam),
            status: pedido.status_pedido || "APROVADO",
            cobrancaStatus: "PAGA"
          } as any);

          setClienteNome(pedido.clienteNome || "");
          setContatoNome(pedido.contatoNome || "Contato Principal");
          setEmpresa(pedido.empresa || "Ideal Grafica");
          setVendedor(pedido.vendedor || "Everton Farias");
          setFormaPagamento(pedido.formaPagamento || "Pix a vista");
          setStatusOperacional(pedido.status_producao || "PENDENTE");
          setStatusProposta(pedido.status_producao || "");

          // Data limite: o maior prazo de producao entre TODOS os produtos do
          // pedido — util ou corrido conforme o texto do cadastro. So sugere
          // quando ainda nao ha data PROMETIDA gravada; edicao manual e prazo ja
          // salvo sempre prevalecem. `dataPrevistaEntrega` agora e nula quando
          // ninguem prometeu nada, e e por isso que a sugestao finalmente roda.
          const deadlineDate = pedido.dataPrevistaEntrega ? pedido.dataPrevistaEntrega.split("T")[0] : "";
          const sugestao = dataLimitePorPrazos((pedido.produtos || []).map((p) => p.prazoProducao));
          setDataPrevistaEntrega(deadlineDate || sugestao || "");

          // Bloco 2 vem da PROPOSTA (`propostas.obs_tecnica`), nao do texto
          // etiquetado da OS. E por isso que reabrir o boletim agora mostra o
          // que foi salvo: nao ha mais um blob para reidratar.
          setBriefingOperacional(pedido.obsTecnica || "");

          const parsed = parsePedidosObs(pedido.obs);
          setObsCriticas(parsed.obsCriticas || "");
          setObsImpressao(parsed.obsImpressao || "");
          setObsAcabamento(parsed.obsAcabamento || "");
          
          setLogisticaServico(parsed.logistica?.servico_transporte || "");
          setLogisticaTransportador(parsed.logistica?.transportador || "");
          setLogisticaPesoReal(parsed.logistica?.peso_real || "");
          setLogisticaQtdVolumes(parsed.logistica?.qtd_volumes || "");
          setLogisticaTipoVolume(parsed.logistica?.tipo_volume || "");
          setLogisticaResponsavel(parsed.logistica?.responsavel_logistica || "");
          setLogisticaObsFrete(parsed.logistica?.observacoes_frete || "");

          if (idIntParam) {
            const frete = await obterFreteEscolhido(Number(idIntParam));
            if (frete) {
              setCotacaoFrete(frete);
              if (!parsed.logistica?.servico_transporte) setLogisticaServico(frete.servico || "");
              if (!parsed.logistica?.peso_real && frete.peso) setLogisticaPesoReal((Number(frete.peso) / 1000).toFixed(2));
            }
          }

          const mapped = pedido.produtos.map((p) => ({
            id: p.id,
            id_produto_proposta_origem: p.db_id,
            nome: p.nome,
            quantidade: p.quantidade,
            quantidadeOriginal: p.quantidade,
            // O setor vem do cadastro do produto (produtos.setor_pcp); o lote
            // pode ter o seu próprio, gravado na abertura do boletim.
            setor: normalizarSetor(p.setor || p.modelos.find((m) => m.setor)?.setor),
            isEstoque: p.isEstoque === true,
            pesoEstimado: Number(p.pesoTotalGramas) || 0,
            modelos: p.modelos.map((m) => ({
              id: m.id,
              nomeModelo: m.nomeModelo,
              quantidade: m.quantidade,
              statusArte: m.statusArte,
              statusProducao: m.statusProducao,
              setor: normalizarSetor(m.setor || p.setor),
              corMaterial: m.corMaterial,
              verso: m.verso,
              bloco: m.bloco || "Bloco A",
              observacoesTecnicas: m.observacoesTecnicas,
              gabaritoNumeracao: m.gabaritoNumeracao,
              configImpressao: {
                tipoNumeracao: m.configImpressao?.tipoNumeracao || "SEM_NUMERACAO",
                qrCode: m.configImpressao?.qrCode || false,
                codBarras: m.configImpressao?.codBarras || false,
                codBarrasTipo: m.configImpressao?.codBarrasTipo || "",
                rfid: m.configImpressao?.rfid || false
              },
              numeracaoInicial: m.numeracaoInicial,
              numeracaoFinal: m.numeracaoFinal,
              tokenAprovacao: m.tokenAprovacao || `token_${Math.floor(Math.random() * 10000000)}`,
              historicoArtes: m.historicoArtes || []
            }))
          }));
          setProdutos(mapped);

          showToast({
            type: "success",
            title: "Boletim Carregado para Edição",
            description: `Dados do pedido operacional #${idIntParam} carregados.`
          });
        } else {
          showToast({
            type: "error",
            title: "Pedido não encontrado",
            description: `Não encontramos um pedido ativo correspondente ao código #${idIntParam}.`
          });
        }
      } catch (err) {
        console.error("Erro ao carregar pedido existente:", err);
        showToast({
          type: "error",
          title: "Erro ao Carregar Pedido",
          description: "Não foi possível carregar os dados do pedido. Tente novamente."
        });
      } finally {
        setLoadingDetails(false);
      }
    }

    loadPedidoExistente();
  }, [isEditing, idIntParam, hasLoadedExisting]);

  // Auto-load proposal for "abertura" mode if idIntParam is provided
  useEffect(() => {
    if (modoParam === "abertura" && idIntParam && !selectedProposta && !loadingDetails && !hasLoadedExisting) {
      setHasLoadedExisting(true);
      selectProposta(Number(idIntParam));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoParam, idIntParam, hasLoadedExisting]);

  useEffect(() => {
    if (!idIntParam) return;
    
    async function loadEvento() {
      const client = getSupabaseClient();
      if (!client) return;
      
      try {
        // A proposta pode ter vários boletins (um por setor) — maybeSingle() daria
        // erro com mais de uma linha. O evento é o mesmo para todos.
        const { data, error } = await client
          .from("pedidos_artes")
          .select("nome_evento, data_evento")
          .eq("id_int", Number(idIntParam))
          .order("created_at", { ascending: true })
          .limit(1);

        // Guarda o valor cru: o rótulo (e a ressalva de prateleira) é resolvido
        // por `tituloEvento`, junto com os produtos já carregados.
        const evento = data && data.length > 0 ? data[0] : null;
        if (!error && evento) {
          setDadosEventoNome(evento.nome_evento || "");
          setDadosEventoData(evento.data_evento || "");
        } else {
          setDadosEventoNome("");
        }
      } catch (err) {
        setDadosEventoNome("");
      }
    }

    async function loadBoletins() {
      const lista = await listarBoletinsDaProposta(Number(idIntParam));
      setBoletins(lista);
      // A conferência vem junto: cada boletim é a linha do seu setor.
      setConferenciaPorSetor(
        Object.fromEntries(
          lista.filter((b) => b.setor).map((b) => [normalizarSetor(b.setor), b.conferencia])
        )
      );
      setConferenciaCarregada(true);
      const vigente = lista[0];
      if (vigente) {
        setBoletimId(vigente.id);
        setBoletimSetor(vigente.setor || "");
        setBoletimHora(vigente.hora || "");
        if (vigente.prazo) setDataPrevistaEntrega(vigente.prazo);
      }
    }

    // Volume e peso bruto vivem em `expedicoes` (linha do pedido), não nos
    // boletins: carga separada da dos setores.
    async function loadRevisaoGeral() {
      setRevisaoGeral(await carregarRevisaoGeral(Number(idIntParam)));
    }

    loadEvento();
    loadBoletins();
    void loadRevisaoGeral();
  }, [idIntParam]);

  useEffect(() => {
    const handleScroll = () => {
      setOpenGabaritoDropdown(null);
    };
    if (openGabaritoDropdown) {
      window.addEventListener("scroll", handleScroll, true);
    }
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [openGabaritoDropdown]);



  // Technical configurations per sector
  interface SectorTechnicalConfig {
    instrucoesImpressao: string;
    metodoImpressao: string;
    perfilQualidade: string;
    verniz: string;
    laminacao: string;
    corte: string;
    furo: string;
    acabamentoEspecial: string;
    observacoesAcabamento: string;
    tipoImpressao?: string;
    capaContraCapa?: string;
    blocagem?: string;
    impressora?: string;
  }

  const initialSectorConfig = (): SectorTechnicalConfig => ({
    instrucoesImpressao: "",
    metodoImpressao: "digital",
    perfilQualidade: "standard",
    verniz: "Nenhum",
    laminacao: "Nenhuma",
    corte: "Corte Reto",
    furo: "Sem Furo",
    acabamentoEspecial: "Nenhum",
    observacoesAcabamento: "",
    tipoImpressao: "Laser",
    capaContraCapa: "Não",
    blocagem: "Sem blocagem",
    impressora: "C280"
  });


  const getGabaritoName = (val?: string) => {
    if (!val) return "Selecione ou pesquise...";
    const found = gabaritosOptions.find(g => g === val);
    if (found) return found;
    return val;
  };

  const handleAddMockAttachment = () => {
    const mockFiles = [
      { name: "Logo_Vetorizado_Cliente.ai", type: "vector" },
      { name: "Manual_Identidade_Visual.pdf", type: "pdf" },
      { name: "Referencia_Cores_Pantone.jpg", type: "image" },
      { name: "Planilha_Nomes_Crachas.xlsx", type: "spreadsheet" }
    ];
    
    const nextIndex = attachments.length % mockFiles.length;
    const file = mockFiles[nextIndex];
    const newFile = {
      url: `/uploads/${file.name}`,
      name: `${file.name.split(".")[0]}_${Date.now().toString().slice(-4)}.${file.name.split(".")[1]}`,
      type: file.type
    };
    
    setAttachments(prev => [...prev, newFile]);
    showToast({
      type: "success",
      title: "Arquivo Anexado",
      description: `O arquivo "${newFile.name}" foi anexado com sucesso.`
    });
  };

  const handleRemoveAttachment = (url: string) => {
    setAttachments(prev => prev.filter(att => att.url !== url));
  };

  interface FormProduto {
    id: string;
    id_produto_proposta_origem?: number;
    codigo_produto?: string;
    nome: string;
    quantidade: number;
    quantidadeOriginal?: number;
    setor?: string;
    /** Produto de prateleira: sem arte, numeração, gabarito ou frente/verso. */
    isEstoque?: boolean;
    /** produtos_proposta.peso_total, em gramas — base do peso estimado do setor. */
    pesoEstimado?: number;
    observacoes_item?: string;
    modelos: ModeloMock[];
  }

  // Block 3 & 4: Products & Models Hierarchical State
  const [produtos, setProdutos] = useState<FormProduto[]>([
    {
      id: "prod_initial_1",
      nome: "Pulseira Tyvek",
      quantidade: 1000,
      setor: SETOR_PADRAO,
      modelos: [
        {
          id: "mod_initial_1",
          nomeModelo: "Lote Principal",
          quantidade: 1000,
          statusArte: "PENDENTE" as ArteStatus,
          statusProducao: "PENDENTE" as ProducaoStatus,
          setor: SETOR_PADRAO,
          corMaterial: "Branco",
          verso: false,
          bloco: "Bloco A",
          observacoesTecnicas: "",
          configImpressao: {
            tipoNumeracao: "SEM_NUMERACAO",
            qrCode: false,
            codBarras: false,
            codBarrasTipo: ""
          },
          tokenAprovacao: "token_default_aprov",
          historicoArtes: []
        }
      ]
    }
  ]);

  /**
   * Título do evento exibido no cabeçalho. Vem de `pedidos_artes.nome_evento`;
   * pedido só de prateleira não tem evento e usa o nome dos produtos.
   */
  const tituloEvento = useMemo(
    () =>
      tituloEventoDoPedido(
        dadosEventoNome,
        produtos.map((p) => ({ nome: p.nome, isPrateleira: p.isEstoque === true }))
      ),
    [dadosEventoNome, produtos]
  );

  /**
   * Produtos agrupados por setor, na ordem PVC → LASER → FLEXO → TEXTIL.
   * Setor sem nenhum produto no pedido não aparece.
   */
  const gruposPorSetor = useMemo(
    () =>
      SETORES_PCP.map((setor) => ({
        setor,
        produtos: produtos.filter((p) => normalizarSetor(p.setor) === setor)
      })).filter((grupo) => grupo.produtos.length > 0),
    [produtos]
  );



  // Recebe o setor: a revisão mostra todos os setores lado a lado, não só o da
  // aba aberta.
  function atualizarConferencia(setor: string, campo: keyof ConferenciaSetor, valor: string) {
    setConferenciaPorSetor((atual) => ({
      ...atual,
      [setor]: { ...(atual[setor] ?? {}), [campo]: valor }
    }));
  }

  /**
   * Peso estimado do setor em gramas: soma do peso dos produtos daquele setor
   * (produtos_proposta.peso_total). Zero quando o pedido não tem peso cadastrado.
   */
  const pesoEstimadoGramasDe = useCallback(
    (setor: string) => {
      const grupo = gruposPorSetor.find((g) => g.setor === setor);
      if (!grupo) return 0;
      return grupo.produtos.reduce((soma, p) => soma + (Number(p.pesoEstimado) || 0), 0);
    },
    [gruposPorSetor]
  );

  /**
   * Peso estimado do setor, formatado para leitura. Derivado — não se digita.
   */
  const pesoEstimadoDe = useCallback(
    (setor: string) => {
      const gramas = pesoEstimadoGramasDe(setor);
      if (gramas <= 0) return "Não calculado";
      return gramas >= 1000 ? `${(gramas / 1000).toFixed(2)} kg` : `${Math.round(gramas)} g`;
    },
    [pesoEstimadoGramasDe]
  );

  /** Setores com produto no pedido que ainda não têm boletim aberto. */
  const setoresSemBoletim = useMemo(
    () =>
      gruposPorSetor
        .map((g) => g.setor)
        .filter((setor) => !boletins.some((b) => normalizarSetor(b.setor) === setor)),
    [gruposPorSetor, boletins]
  );

  /**
   * Uma aba por setor do pedido. A lista sai dos produtos — a OS já nasce
   * sabendo quais setores a compõem —, mais qualquer boletim já gravado num
   * setor sem produto (legado), para nenhum boletim ficar inalcançável.
   */
  /**
   * Grupos exibidos no bloco de produtos: só o da aba aberta. Fora da edição
   * (abertura de boletim) não há abas ainda, então mostra tudo.
   */
  const gruposVisiveis = useMemo(() => {
    if (!isEditing || !boletimSetor) return gruposPorSetor;
    const setorAtivo = normalizarSetor(boletimSetor);
    const doSetor = gruposPorSetor.filter((g) => g.setor === setorAtivo);
    // Boletim de setor sem produto (legado): mostra tudo em vez de uma tela vazia.
    return doSetor.length > 0 ? doSetor : gruposPorSetor;
  }, [isEditing, boletimSetor, gruposPorSetor]);

  const abasDeSetor = useMemo(() => {
    const setores = new Set<string>(gruposPorSetor.map((g) => g.setor));
    boletins.forEach((b) => setores.add(normalizarSetor(b.setor)));
    return SETORES_PCP.filter((setor) => setores.has(setor)).map((setor) => ({
      setor,
      produtos: gruposPorSetor.find((g) => g.setor === setor)?.produtos.length ?? 0,
      boletim: boletins.find((b) => normalizarSetor(b.setor) === setor) ?? null
    }));
  }, [gruposPorSetor, boletins]);

  /**
   * Setor que o boletim está tratando agora.
   *
   * A ordem de precedência é a regra:
   *   1. `boletimSetor` — o setor do boletim já gravado (lido em loadBoletins)
   *      ou a aba que o usuário clicou. Escolha explícita sempre vence.
   *   2. o primeiro setor do pedido, que vem de `produtos.setor_pcp` pelos
   *      grupos — é o que o campo sempre prometeu: "o setor vem dos produtos".
   *
   * Existe porque na Abertura de OS não havia caminho nenhum para preencher o
   * setor: a régua de abas só era renderizada na edição, e `boletimSetor` só
   * recebia valor de um boletim que ainda não existia. O campo pedia para
   * escolher uma aba acima que não estava lá, e o save morria na validação
   * "Informe o setor para abrir o boletim" — em qualquer proposta sem boletim.
   *
   * É derivado, e não estado inicializado por efeito, por dois motivos: não
   * existe janela em que a tela mostre vazio antes de um efeito corrigir, e
   * nada aqui pode sobrescrever o setor lido do banco por uma corrida de
   * carregamento.
   *
   * Pedido sem grupo de setor continua vazio de propósito — inventar setor
   * mandaria a OS para a bancada errada.
   */
  const setorEfetivo = boletimSetor || gruposPorSetor[0]?.setor || "";

  // Numero do cabecalho: vale a proposta ja carregada (abertura por busca na
  // tela) e, na falta dela, o parametro da URL. Sem nenhuma das duas, a OS
  // ainda nao tem numero — mesmo degrau de "Novo pedido" da proposta.
  const idIntDoCabecalho = selectedProposta?.id_int ?? (idIntParam ? Number(idIntParam) : null);
  const numeroDoPedidoNoCabecalho = idIntDoCabecalho ? `N° ${idIntDoCabecalho}` : "Nova OS";

  /**
   * Peso líquido: soma do peso ESTIMADO de cada setor, derivado dos produtos.
   * Já vem preenchido antes de qualquer conferência — é a referência contra a
   * qual o revisor compara o bruto que vai pesar na balança. Bruto inclui
   * embalagem e sai maior; por isso são campos separados.
   */
  const somaPesoDosSetores = useMemo(() => {
    const gramas = abasDeSetor.reduce((soma, aba) => {
      const grupo = gruposPorSetor.find((g) => g.setor === aba.setor);
      if (!grupo) return soma;
      return soma + grupo.produtos.reduce((s, p) => s + (Number(p.pesoEstimado) || 0), 0);
    }, 0);
    if (gramas <= 0) return "Não calculado";
    return gramas >= 1000 ? `${(gramas / 1000).toFixed(2)} kg` : `${Math.round(gramas)} g`;
  }, [abasDeSetor, gruposPorSetor]);

  const quantidadeDeVolumes = useMemo(() => {
    const numero = Number((revisaoGeral.qtdVolumes || "").trim());
    return Number.isFinite(numero) && numero > 0 ? Math.trunc(numero) : 0;
  }, [revisaoGeral.qtdVolumes]);

  const pendenciasRevisao = useMemo(
    () => validarRevisao(abasDeSetor.map((a) => a.setor), conferenciaPorSetor, revisaoGeral),
    [abasDeSetor, conferenciaPorSetor, revisaoGeral]
  );

  /**
   * Setores que já receberam a sugestão inicial da conferência. É `ref` de
   * propósito: a sugestão entra UMA vez por setor, então limpar o campo na mão
   * continua valendo — sem isso, o efeito devolveria o valor a cada render.
   *
   * A marcação acontece FORA do updater do `setConferenciaPorSetor`. React pode
   * chamar o updater mais de uma vez com o mesmo estado (é o que o StrictMode
   * faz em desenvolvimento), e marcar lá dentro fazia a segunda passagem achar o
   * setor já semeado, devolver o estado intocado e engolir a sugestão inteira —
   * era exatamente isso que deixava peso e responsável vazios na tela.
   */
  const conferenciaSugerida = useRef<Set<string>>(new Set());

  /**
   * Peso real nasce com o peso estimado e o responsável com quem está logado —
   * os dois editáveis. É sugestão: quem confere corrige na balança e assina por
   * outro se for o caso; o que já veio gravado do banco nunca é sobrescrito.
   *
   * As guardas são o que mantém isso honesto:
   *   - `hasLoadedExisting && !loadingDetails` → os produtos do pedido já estão
   *     na tela; antes disso `gruposPorSetor` ainda é o mock e semear criaria
   *     conferência de um setor que não é do pedido (o save grava por chave do
   *     mapa e abriria linha errada em propostas_os_setores);
   *   - `conferenciaCarregada` → o que veio do banco já chegou.
   */
  useEffect(() => {
    if (!isEditing || !hasLoadedExisting || loadingDetails || !conferenciaCarregada) return;
    const setores = abasDeSetor.map((a) => a.setor);
    if (setores.length === 0) return;

    const responsavelPadrao = (user?.name || user?.email || "").trim();
    const aSemear = setores.filter((setor) => !conferenciaSugerida.current.has(setor));
    if (aSemear.length === 0) return;
    aSemear.forEach((setor) => conferenciaSugerida.current.add(setor));

    setConferenciaPorSetor((atual) => {
      const proximo = { ...atual };
      let mudou = false;

      for (const setor of aSemear) {
        const conferencia = proximo[setor] ?? {};
        const sugestao: ConferenciaSetor = { ...conferencia };

        if (!(conferencia.peso_real || "").trim()) {
          const kg = pesoEstimadoGramasDe(setor) / 1000;
          // Abaixo de 10 g o campo (step 0.01) arredondaria para 0,00 e a
          // validação aceitaria um peso zero como conferido.
          if (kg >= 0.01) sugestao.peso_real = kg.toFixed(2);
        }

        if (!(conferencia.responsavel_conferencia || "").trim() && responsavelPadrao) {
          sugestao.responsavel_conferencia = responsavelPadrao;
        }

        if (
          sugestao.peso_real !== conferencia.peso_real ||
          sugestao.responsavel_conferencia !== conferencia.responsavel_conferencia
        ) {
          proximo[setor] = sugestao;
          mudou = true;
        }
      }

      return mudou ? proximo : atual;
    });
  }, [
    isEditing,
    hasLoadedExisting,
    loadingDetails,
    conferenciaCarregada,
    abasDeSetor,
    pesoEstimadoGramasDe,
    user
  ]);

  /**
   * As tres acoes de PDF desta tela, cada uma parametrizada pelo layout.
   *
   * Existem como funcao — e nao inline em cada botao — porque o padrao e o
   * reduzido precisam se comportar EXATAMENTE igual em cada ponto: mesmo
   * boletim, mesmo setor, mesmo aviso, mesma trava de `isPrintingOs`. Duas
   * copias do mesmo handler divergiriam no primeiro ajuste.
   */
  async function imprimirOsDoBoletimAberto(layout: LayoutPdfOs) {
    if (isPrintingOs || !idIntParam) return;
    setIsPrintingOs(true);
    // Imprime o boletim aberto: o PDF é do setor, não da proposta.
    const result = await abrirPdfOs(Number(idIntParam), boletimId, setorEfetivo, layout);
    setIsPrintingOs(false);
    if (!result.success) {
      showToast({
        type: "error",
        title: "Erro ao gerar PDF da OS",
        description: result.errorMessage || "Erro desconhecido."
      });
    } else {
      // `abrirPdfOs` volta assim que a aba abre — o PDF ainda está sendo gerado
      // do outro lado. Sem este aviso o rótulo "Gerando PDF..." pisca por
      // milissegundos e a aba nova fica em branco sem explicação nenhuma.
      avisarGeracaoDoPdf();
    }
  }

  async function imprimirOsDeOutroSetor(boletimDoSetor: BoletimSetor, layout: LayoutPdfOs) {
    if (isPrintingOs || !idIntParam) return;
    setIsPrintingOs(true);
    const r = await abrirPdfOs(Number(idIntParam), boletimDoSetor.id, boletimDoSetor.setor, layout);
    setIsPrintingOs(false);
    if (!r.success) {
      showToast({
        type: "error",
        title: "Erro ao gerar PDF da OS",
        description: r.errorMessage || "Erro desconhecido."
      });
    } else {
      avisarGeracaoDoPdf();
    }
  }

  async function baixarTodosOsBoletins(layout: LayoutPdfOs) {
    if (isPrintingOs || !idIntParam) return;
    setIsPrintingOs(true);
    // Um arquivo por setor. Abrir N abas seria bloqueado pelo navegador depois
    // da primeira, então cada uma vira download.
    const falhas: string[] = [];
    for (const b of boletins) {
      const r = await baixarPdfOs(Number(idIntParam), b.id, b.setor, layout);
      if (!r.success) falhas.push(`${b.setor || "sem setor"}: ${r.errorMessage || "erro"}`);
    }
    setIsPrintingOs(false);
    showToast(
      falhas.length === 0
        ? {
            type: "success",
            title: "PDFs gerados",
            description: `${boletins.length} boletins baixados, um por setor${
              layout === "resumido" ? ", em versao reduzida" : ""
            }.`
          }
        : { type: "error", title: "Falha em parte dos PDFs", description: falhas.join(" | ") }
    );
  }

  async function handleConfirmarRevisao() {
    if (confirmandoRevisao || revisaoLiberada || !idIntParam) return;
    setConfirmandoRevisao(true);
    try {
      // Conferência dos setores primeiro: o botão libera o pedido, e liberar
      // sem ter gravado o que foi conferido deixaria a Expedição sem os pesos.
      const conferencia = await salvarConferenciaDosSetores(Number(idIntParam), conferenciaPorSetor);
      if (!conferencia.success) {
        showToast({ type: "error", title: "Não foi possível salvar a conferência", description: conferencia.error });
        return;
      }

      const res = await confirmarRevisao(Number(idIntParam), revisaoGeral, {
        uid: user?.id ?? null,
        nome: user?.name ?? user?.email ?? null
      });

      if (res.success) {
        // O pedido saiu da fila de produção e virou item da bancada da
        // Expedição: a tela do boletim não tem mais o que mostrar dele. Trava o
        // botão e volta para o Painel geral — de onde o boletim foi aberto e
        // onde a lista já recarrega sozinha ao montar, mostrando o pedido no
        // novo estado. O respiro de ~900ms é o mesmo dos outros formulários do
        // sistema (CadastroFormPage, OrcamentoFormPage), para o toast ser lido
        // antes da troca de tela.
        setRevisaoLiberada(true);
        showToast({
          type: "success",
          title: "Revisão confirmada",
          description: `Pedido #${idIntParam} liberado para a Expedição.`
        });
        window.setTimeout(() => router.push("/pedidos"), 900);
      } else {
        showToast({ type: "error", title: "Não foi possível liberar", description: res.error });
      }
    } catch (erro) {
      // Sem catch, uma exceção aqui sumia: o `void` do onClick engole a rejeição
      // e o operador ficaria olhando uma tela que não deu sinal nenhum.
      showToast({
        type: "error",
        title: "Erro ao liberar para a Expedição",
        description: erro instanceof Error ? erro.message : "Erro inesperado. Tente novamente."
      });
    } finally {
      setConfirmandoRevisao(false);
    }
  }

  // Load proposals list on mount
  useEffect(() => {
    async function loadRecentPropostas() {
      setLoadingPropostas(true);
      try {
        const res = await listarPropostasLiberadasParaBoletim();
        setRecentes(res);
        setPropostas(res);
      } catch (err) {
        console.error("Erro ao buscar propostas recentes:", err);
      } finally {
        setLoadingPropostas(false);
      }
    }
    loadRecentPropostas();
  }, []);

  // Search proposals with debounce
  useEffect(() => {
    if (!propostaBusca.trim()) {
      Promise.resolve().then(() => {
        setPropostas(recentes);
        setSearchFeedback(null);
      });
      return;
    }

    const delayDebounceFn = setTimeout(async () => {
      setLoadingPropostas(true);
      setSearchFeedback(null);
      try {
        const results = await buscarPropostasLiberadasParaBoletim(propostaBusca);
        setPropostas(results);
        if (results.length === 0) {
          setSearchFeedback("Nenhuma proposta elegível encontrada para esta busca.");
        }
      } catch (err) {
        console.error("Erro ao buscar propostas:", err);
        setSearchFeedback("Erro ao realizar a busca.");
      } finally {
        setLoadingPropostas(false);
      }
    }, 400);

    return () => clearTimeout(delayDebounceFn);
  }, [propostaBusca, recentes]);

  const selectProposta = async (idInt: number) => {
    setLoadingDetails(true);
    try {
      // Validar elegibilidade da proposta antes de carregar
      const check = await obterPropostaLiberadaParaBoletim(idInt);
      if (!check.success) {
        showToast({
          type: "error",
          title: "Proposta Bloqueada",
          description: check.error || "Esta proposta não está elegível para abertura de boletim."
        });
        setLoadingDetails(false);
        return;
      }

      const details = await getPropostaDetailById(idInt);
      if (details) {
        const frete = await obterFreteEscolhido(idInt);
        if (frete) {
          setCotacaoFrete(frete);
          setLogisticaServico(frete.servico || "");
          setLogisticaPesoReal(frete.peso ? (Number(frete.peso) / 1000).toFixed(2) : "");
        }

        setSelectedProposta(details);
        setClienteNome(details.cliente?.nome || "");
        setContatoNome(details.contato?.nome || details.cliente?.contatos?.[0]?.nome || "Contato Principal");
        setEmpresa(details.empresa || "Ideal Grafica");
        setVendedor(details.vendedor || "Everton Farias");
        setFormaPagamento(details.formaPagamento || "Pix a vista");
        
        // Orientacao tecnica da proposta. NAO e mais semeada de
        // `obs_proposta` (observacao comercial): os dois textos existem para
        // publicos diferentes, e misturar era o que fazia a instrucao de
        // fabrica se perder.
        setBriefingOperacional(details.obsTecnica || "");
        
        // Prazo / Data prevista de entrega — maior prazo de produção entre os
        // produtos do pedido (cadastro em produtos.prazo).
        setDataPrevistaEntrega(calcularDataLimitePorProdutos(details.itens));
        
        setObsImpressao("");
        setObsAcabamento("");

        // Mapear produtos
        const mapped = details.itens.map((item, index) => {
          // Setor PCP é cadastro do produto. A adivinhação por nome/categoria
          // continua só como rede quando o produto não tem setor definido.
          const setorCadastrado = (item.produto?.setor_pcp || "").trim().toUpperCase();
          let sector = setorCadastrado || "LASER";
          if (!setorCadastrado) {
            const nameUpper = item.nome.toUpperCase();
            const catUpper = (item.produto?.categoria || "").toUpperCase();

            if (nameUpper.includes("TEX") || catUpper.includes("TEX") || nameUpper.includes("CORDÃO") || nameUpper.includes("FITA") || nameUpper.includes("TECIDO")) {
              sector = "TEXTIL";
            } else if (nameUpper.includes("FLEXO") || catUpper.includes("FLEXO") || nameUpper.includes("RÓTULO") || nameUpper.includes("ETIQUETA")) {
              sector = "FLEXO";
            } else if (nameUpper.includes("PVC") || catUpper.includes("PVC") || nameUpper.includes("PVP") || catUpper.includes("PVP")) {
              sector = "PVC";
            }
          }

          const dbIdMatch = item.id.match(/^item_(\d+)$/);
          const dbIdFallback = dbIdMatch ? Number(dbIdMatch[1]) : undefined;
          const dbId = item.id_produto_proposta_origem || dbIdFallback;

          return {
            id: generateUniqueId(`prod_${item.id_produto || index}`),
            id_produto_proposta_origem: dbId,
            codigo_produto: item.id_produto ? String(item.id_produto) : "",
            nome: item.nome,
            quantidade: item.quantidade,
            quantidadeOriginal: item.quantidade, // Store fixed original total
            setor: sector,
            isEstoque: item.isEstoque === true,
            observacoes_item: (item as any).descricaoOriginal || "",
            modelos: [
              {
                id: generateUniqueId(`mod_${item.id_produto || index}_0`),
                nomeModelo: "Lote Principal",
                quantidade: item.quantidade,
                statusArte: "PENDENTE" as ArteStatus,
                statusProducao: "PENDENTE" as ProducaoStatus,
                setor: sector,
                corMaterial: "Branco",
                verso: item.variacoesEscolhidas?.some(v => v.tipo.variacao.toLowerCase().includes("verso") || v.tipo.variacao.toLowerCase().includes("frente e verso")) || false,
                bloco: "Bloco A",
                observacoesTecnicas: (item as any).descricaoModelo || "",
                configImpressao: {
                  tipoNumeracao: "SEM_NUMERACAO",
                  qrCode: item.variacoesEscolhidas?.some(v => v.tipo.variacao.toLowerCase().includes("qr")) || false,
                  codBarras: item.variacoesEscolhidas?.some(v => v.tipo.variacao.toLowerCase().includes("barras") || v.tipo.variacao.toLowerCase().includes("código")) || false,
                  codBarrasTipo: ""
                },
                tokenAprovacao: `token_${Math.floor(Math.random() * 10000000)}`,
                historicoArtes: []
              }
            ]
          };
        });
        setProdutos(mapped);
        
        showToast({
          type: "success",
          title: "Proposta Carregada",
          description: `Orçamento #${idInt} importado com sucesso.`
        });
      } else {
        showToast({
          type: "error",
          title: "Erro",
          description: "Não foi possível carregar os detalhes da proposta."
        });
      }
    } catch (err) {
      console.error(err);
      showToast({
        type: "error",
        title: "Erro",
        description: "Falha na leitura dos dados da proposta."
      });
    } finally {
      setLoadingDetails(false);
    }
  };

  const handlePropostaChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setPropostaBusca(val);

    const numericId = parseInt(val, 10);
    if (!isNaN(numericId)) {
      const found = propostas.find((p) => p.id_int === numericId);
      if (found) {
        await selectProposta(found.id_int);
      }
    }
  };

  const handlePropostaKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const numericId = parseInt(propostaBusca, 10);
      if (!isNaN(numericId)) {
        await selectProposta(numericId);
      }
    }
  };

  // Dynamic calculations
  const totalQuantidade = produtos.reduce(
    (acc, p) => acc + p.modelos.reduce((sum, m) => sum + (Number(m.quantidade) || 0), 0),
    0
  );
  
  // Estimate weight based on product name/category rather than model sector
  const calculateTotalWeight = () => {
    let weight = 0;
    produtos.forEach((p) => {
      const nameUpper = p.nome.toUpperCase();
      p.modelos.forEach((m) => {
        const qty = Number(m.quantidade) || 0;
        if (nameUpper.includes("CARTÃO") || nameUpper.includes("PVC")) {
          weight += qty * 0.005; // 5g per PVC card
        } else if (nameUpper.includes("CRACHÁ") || nameUpper.includes("CREDENCIAL")) {
          weight += qty * 0.008; // 8g per badge
        } else {
          weight += qty * 0.001; // 1g per Tyvek band / other
        }
      });
    });
    return parseFloat(weight.toFixed(2));
  };

  const handleMockImportCSV = (prodId: string, modelId: string, modelName: string) => {
    const sanitizeName = modelName.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const randomNum = Math.floor(Math.random() * 9000 + 1000);
    const mockFilename = `lote_${sanitizeName}_variaveis_${randomNum}.csv`;
    
    updateModelField(prodId, modelId, "csvDadosVariaveisUrl", mockFilename);
    showToast({
      type: "success",
      title: "Planilha Importada",
      description: `Arquivo "${mockFilename}" carregado localmente com sucesso (simulação).`
    });
  };

  const updateProductSector = (prodId: string, sector: string) => {
    setProdutos((prev) =>
      prev.map((p) => {
        if (p.id === prodId) {
          return {
            ...p,
            setor: sector,
            modelos: p.modelos.map((m) => ({ ...m, setor: sector }))
          };
        }
        return p;
      })
    );
  };

  const addModelRow = (prodId: string) => {

    const modId = generateUniqueId("mod");
    setProdutos((prev) =>
      prev.map((p) => {
        if (p.id === prodId) {
          return {
            ...p,
            modelos: [
              ...p.modelos,
              {
                id: modId,
                nomeModelo: `Lote ${p.modelos.length + 1}`,
                quantidade: 500,
                statusArte: "PENDENTE" as ArteStatus,
                statusProducao: "PENDENTE" as ProducaoStatus,
                setor: normalizarSetor(p.setor), // herda o setor do produto
                corMaterial: "Branco",
                verso: false,
                bloco: `Bloco ${String.fromCharCode(65 + p.modelos.length)}`,
                observacoesTecnicas: "",
                configImpressao: {
                  tipoNumeracao: "SEM_NUMERACAO",
                  qrCode: false,
                  codBarras: false,
                  codBarrasTipo: ""
                },
                gabaritoNumeracao: "Sem gabarito",
                tokenAprovacao: `token_${Math.floor(Math.random() * 10000000)}`,
                historicoArtes: []
              }
            ]
          };
        }
        return p;
      })
    );
  };

  const getRowValidationError = (p: FormProduto, m: ModeloMock) => {
    if (m.configImpressao.tipoNumeracao === "SEQUENCIAL") {
      const start = m.numeracaoInicial || 0;
      if (start <= 0) {
        return { type: "error", message: "Número inicial é obrigatório para numeração sequencial." };
      }
      const end = m.numeracaoFinal || 0;
      if (end <= 0 || end < start) {
        return { type: "error", message: "Cálculo de numeração final inválido." };
      }
    }

    if (m.configImpressao.tipoNumeracao === "CUSTOMIZADA" && !m.csvDadosVariaveisUrl?.trim()) {
      return { type: "error", message: "Planilha de variáveis (.CSV) é obrigatória para numeração customizada." };
    }

    return null;
  };

  const removeModelRow = (prodId: string, modelId: string) => {

    setProdutos((prev) =>
      prev.map((p) => {
        if (p.id === prodId) {
          if (p.modelos.length === 1) {
            showToast({
              type: "warning",
              title: "Ação Bloqueada",
              description: "O produto precisa ter pelo menos 1 modelo/lote especificado."
            });
            return p;
          }
          return {
            ...p,
            modelos: p.modelos.filter((m) => m.id !== modelId)
          };
        }
        return p;
      })
    );
  };

  const updateModelField = (prodId: string, modelId: string, field: string, value: string | number | boolean) => {
    setProdutos((prev) =>
      prev.map((p) => {
        if (p.id === prodId) {
          return {
            ...p,
            modelos: p.modelos.map((m) => {
              if (m.id === modelId) {
                const updated = { ...m, [field]: value };
                if (updated.configImpressao.tipoNumeracao === "SEQUENCIAL") {
                  const start = Number(updated.numeracaoInicial) || 0;
                  const qty = Number(updated.quantidade) || 0;
                  updated.numeracaoFinal = start > 0 && qty > 0 ? (start + qty - 1) : undefined;
                }
                return updated;
              }
              return m;
            })
          };
        }
        return p;
      })
    );
  };

  const updateModelConfigField = (prodId: string, modelId: string, field: string, value: string | boolean) => {
    setProdutos((prev) =>
      prev.map((p) => {
        if (p.id === prodId) {
          return {
            ...p,
            modelos: p.modelos.map((m) => {
              if (m.id === modelId) {
                const updated = {
                  ...m,
                  configImpressao: {
                    ...m.configImpressao,
                    [field]: value
                  }
                };
                if (field === "tipoNumeracao" && value === "SEQUENCIAL") {
                  const start = Number(updated.numeracaoInicial) || 0;
                  const qty = Number(updated.quantidade) || 0;
                  updated.numeracaoFinal = start > 0 && qty > 0 ? (start + qty - 1) : undefined;
                }
                return updated;
              }
              return m;
            })
          };
        }
        return p;
      })
    );
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedProposta) {
      showToast({ type: "error", title: "Proposta Não Selecionada", description: "Selecione uma proposta de origem no topo antes de salvar." });
      return;
    }

    if (!clienteNome.trim()) {
      showToast({ type: "error", title: "Formulário Incompleto", description: "O nome do cliente é obrigatório." });
      return;
    }

    if (!dataPrevistaEntrega) {
      showToast({ type: "error", title: "Formulário Incompleto", description: "A data de entrega prevista é obrigatória." });
      return;
    }

    if (isEditing) {
      setLoadingDetails(true);
      try {
        // Sem `orientacoesDesign` no input: o serializador entao repete o que
        // ja existe em `existingObs`, e o bloco [Orientacoes para design] das
        // OS antigas fica intacto. O Bloco 2 grava em `propostas.obs_tecnica`,
        // logo abaixo.
        const serializedObs = serializePedidosObs({
          obsCriticas,
          obsImpressao,
          obsAcabamento,
          logistica: {
            servico_transporte: logisticaServico,
            transportador: logisticaTransportador,
            peso_real: logisticaPesoReal,
            qtd_volumes: logisticaQtdVolumes,
            tipo_volume: logisticaTipoVolume,
            responsavel_logistica: logisticaResponsavel,
            observacoes_frete: logisticaObsFrete
          }
        }, existingObs);

        const result = await atualizarOrientacoesBoletim(Number(idIntParam), serializedObs, dataPrevistaEntrega || undefined);

        if (!result.success) {
          showToast({
            type: "error",
            title: "Erro ao Atualizar Boletim",
            description: result.error || "Não foi possível atualizar as orientações. Tente novamente."
          });
          setLoadingDetails(false);
          return;
        }

        // 1a'. Bloco 2 — orientação técnica, na proposta. Bloqueia em caso de
        // erro: é a instrução que a bancada lê, e salvar o resto sem ela deixaria
        // a tela dizendo "salvo" com o texto perdido.
        const tecnica = await atualizarObsTecnicaProposta(Number(idIntParam), briefingOperacional);
        if (!tecnica.success) {
          showToast({
            type: "error",
            title: "Erro ao Salvar a Orientação Técnica",
            description: tecnica.error || "Não foi possível gravar o Bloco 2."
          });
          setLoadingDetails(false);
          return;
        }

        // 1b. Boletim do setor (setor/prazo/hora) — bloqueia em caso de erro,
        // porque a unicidade (proposta, setor) é garantida pelo banco.
        const dadosBoletim = await salvarBoletimSetor({
          id: boletimId,
          idInt: Number(idIntParam),
          setor: setorEfetivo || null,
          prazo: dataPrevistaEntrega || null,
          hora: boletimHora || null
        });
        if (!dadosBoletim.success) {
          showToast({
            type: "error",
            title: "Erro ao Salvar Boletim do Setor",
            description: dadosBoletim.error
          });
          setLoadingDetails(false);
          return;
        }
        setBoletimId(dadosBoletim.boletim.id);

        // 1b'. Conferência de cada setor — cada uma na linha do seu setor.
        const conferencia = await salvarConferenciaDosSetores(Number(idIntParam), conferenciaPorSetor);
        if (!conferencia.success) {
          showToast({
            type: "error",
            title: "Erro ao Salvar a Conferência",
            description: conferencia.error || "Não foi possível gravar a revisão dos setores."
          });
          setLoadingDetails(false);
          return;
        }

        // 1c. O setor do lote é o do PRODUTO dele (produtos.setor_pcp), não o do
        // boletim aberto. Antes todos os lotes da proposta levavam o setor do
        // boletim que estava sendo salvo — era assim que um lote TEXTIL ia parar
        // na OS do PVC.
        const setoresDosModelos = produtos.flatMap((p) =>
          p.modelos.map((m) => ({ id: Number(m.id), setor: normalizarSetor(p.setor) }))
        ).filter((m) => !isNaN(m.id) && m.id > 0);
        if (setoresDosModelos.length > 0) {
          const atribuicao = await atribuirSetorAosModelos(setoresDosModelos);
          if (!atribuicao.success) {
            showToast({
              type: "error",
              title: "Erro ao Vincular Setor aos Lotes",
              description: atribuicao.error || "Não foi possível gravar o setor dos lotes."
            });
            setLoadingDetails(false);
            return;
          }
        }

        // 2. Numeração e gabarito NÃO são regravados aqui.
        //
        // Este ponto mandava tipo_numeracao, gabarito_operacional e
        // numeracao_inicio de volta para `pedidos_modelos` a cada save. Os três
        // pertencem ao orçamento (aba Modelos), que grava na MESMA linha — o
        // boletim só os exibe. Desde que a tela deixou de oferecer os controles,
        // o valor enviado era sempre igual ao lido, mas a porta de escrita
        // continuava aberta para qualquer chamada fora da tela; fechá-la é o
        // ponto. `numeracao_fim` nunca foi enviado daqui.
        //
        // O setor do lote continua sendo gravado logo acima: aquele é do PCP,
        // não do orçamento. A abertura de OS (`salvarModelosBoletim`) segue
        // enviando os quatro campos — lá o lote nasce.

        // Update macro status if currently REVISAO PRODUCAO. O resultante volta
        // da própria chamada e vai direto para a tela — era exatamente isto que
        // faltava: o status mudava no banco e o cabeçalho só descobria quando o
        // usuário voltava para a lista.
        const avanco = await avancarStatusParaEmProducao(Number(idIntParam));
        if (avanco.statusInterno) setStatusProposta(avanco.statusInterno);

        // VOLTA PARA A LISTA DE PRODUÇÃO (30/08/2026).
        //
        // Salvar era um beco: gravava e deixava o operador na mesma tela, sem
        // sinal de que a OS já estava em ordem. O destino é `/pedidos` — a lista
        // de OS da Produção, a mesma do link "Voltar" do cabeçalho e a mesma
        // para onde a confirmação de revisão já leva.
        //
        // NÃO REDIRECIONA NA ABA REVISÃO. Ali o "Salvar Alterações" do cabeçalho
        // continua visível, mas ele NÃO grava volume, tipo de volume nem peso
        // bruto — esses campos só são persistidos por "Confirmar revisão e
        // liberar para Expedição" (`salvarRevisaoGeral`). Sair da tela no save
        // levaria embora o que foi digitado ali, sem chance de confirmar.
        // Enquanto a aba existir, ela fica de fora do redirecionamento.
        //
        // O erro continua sem redirecionar: o `catch` abaixo mostra a mensagem e
        // mantém o operador na tela com o que ele digitou.
        const deveVoltarParaLista = !abaExpedicao;

        showToast({
          type: "success",
          title: "Boletim salvo",
          description: deveVoltarParaLista
            ? "Orientações e especificações técnicas gravadas. Voltando para a lista de Produção."
            : "Orientações e especificações técnicas gravadas. Você continua nesta OS."
        });

        // Recarrega os boletins para a aba recém-criada deixar de ser "a abrir".
        if (idIntParam) {
          const atualizados = await listarBoletinsDaProposta(Number(idIntParam));
          setBoletins(atualizados);
          const desteSetor = atualizados.find((b) => normalizarSetor(b.setor) === normalizarSetor(setorEfetivo));
          if (desteSetor) setBoletimId(desteSetor.id);
        }

        // Mesmo compasso da confirmação de revisão: o toast aparece antes de a
        // navegação trocar a tela.
        if (deveVoltarParaLista) {
          window.setTimeout(() => router.push("/pedidos"), 900);
        }
      } catch (error) {
        console.error("Erro ao processar atualização do boletim:", error);
        showToast({
          type: "error",
          title: "Erro Inesperado",
          description: "Ocorreu um erro inesperado ao salvar as alterações."
        });
      } finally {
        setLoadingDetails(false);
      }
      return;
    }

    // Validate quantities and technical specifications
    for (const p of produtos) {
      for (const m of p.modelos) {
        if ((Number(m.quantidade) || 0) <= 0) {
          showToast({
            type: "error",
            title: "Quantidade Inválida",
            description: `A quantidade para o lote "${m.nomeModelo}" no produto "${p.nome}" deve ser maior que zero.`
          });
          return;
        }

        const validationError = getRowValidationError(p, m);
        if (validationError && validationError.type === "error") {
          showToast({
            type: "error",
            title: "Especificação Técnica Inválida",
            description: `No lote "${m.nomeModelo}" (${p.nome}): ${validationError.message}`
          });
          return;
        }
      }

      const modelsSum = p.modelos.reduce((sum, m) => sum + (Number(m.quantidade) || 0), 0);
      const maxQty = p.quantidadeOriginal || p.quantidade;
      if (modelsSum !== maxQty) {
        showToast({
          type: "error",
          title: "Divergência de Quantidade",
          description: `A soma das quantidades dos lotes para "${p.nome}" (${modelsSum}) deve ser exatamente igual à quantidade total contratada na proposta (${maxQty}).`
        });
        return;
      }
    }

    setLoadingDetails(true);
    try {
      const idInt = selectedProposta.id_int;

      // 1. Validar elegibilidade da proposta novamente e verificar se já existe no banco
      const check = await obterPropostaLiberadaParaBoletim(idInt);
      if (!check.success) {
        if (check.error === "Pedido já aberto para esta proposta") {
          showToast({
            type: "error",
            title: "Pedido Já Aberto",
            description: "Pedido já aberto para esta proposta"
          });
        } else {
          showToast({
            type: "error",
            title: "Proposta Bloqueada",
            description: check.error || "Esta proposta não cumpre as regras de elegibilidade."
          });
        }
        setLoadingDetails(false);
        return;
      }

      const formattedObs = serializePedidosObs({
        obsCriticas,
        obsImpressao,
        obsAcabamento,
        logistica: {
          servico_transporte: logisticaServico,
          transportador: logisticaTransportador,
          peso_real: logisticaPesoReal,
          qtd_volumes: logisticaQtdVolumes,
          tipo_volume: logisticaTipoVolume,
          responsavel_logistica: logisticaResponsavel,
          observacoes_frete: logisticaObsFrete
        }
      }, existingObs);

      // 2. Criar pedido no Supabase
      const result = await criarPedidoParaBoletim({
        id_int: idInt,
        descricao: `${clienteNome} - Boletim de entrada`,
        obs: formattedObs,
        data_termino: dataPrevistaEntrega || undefined
      });

      if (!result.success || !result.id) {
        showToast({
          type: "error",
          title: "Erro ao Salvar Boletim",
          description: result.error || "Não foi possível abrir o pedido. Tente novamente."
        });
        setLoadingDetails(false);
        return;
      }

      // 2a. Bloco 2 — orientação técnica, na proposta (mesmo registro da aba
      // Produção). Bloqueia em caso de erro, como no caminho de edição.
      const tecnicaNova = await atualizarObsTecnicaProposta(idInt, briefingOperacional);
      if (!tecnicaNova.success) {
        showToast({
          type: "error",
          title: "Erro ao Salvar a Orientação Técnica",
          description: tecnicaNova.error || "Não foi possível gravar o Bloco 2."
        });
        setLoadingDetails(false);
        return;
      }

      // 2b. Boletim do setor. A unicidade (proposta, setor) é do banco: se já
      // existe boletim para este setor, a abertura para e o usuário é avisado.
      const dadosBoletim = await salvarBoletimSetor({
        id: boletimId,
        idInt,
        setor: setorEfetivo || null,
        prazo: dataPrevistaEntrega || null,
        hora: boletimHora || null
      });
      if (!dadosBoletim.success) {
        showToast({
          type: "error",
          title: "Erro ao Salvar Boletim do Setor",
          description: dadosBoletim.error
        });
        setLoadingDetails(false);
        return;
      }
      setBoletimId(dadosBoletim.boletim.id);

      // 2b'. Conferência de cada setor, na linha do próprio setor.
      const conferencia = await salvarConferenciaDosSetores(idInt, conferenciaPorSetor);
      if (!conferencia.success) {
        showToast({
          type: "error",
          title: "Erro ao Salvar a Conferência",
          description: conferencia.error || "Não foi possível gravar a revisão dos setores."
        });
        setLoadingDetails(false);
        return;
      }

      // 3. Mapear e Salvar Modelos/Lotes no Supabase
      const modelosPayload = produtos.flatMap(p =>
        p.modelos.map(m => ({
          id_produto_proposta_origem: p.id_produto_proposta_origem || null,
          nome_modelo: m.nomeModelo || p.nome,
          descricao: m.observacoesTecnicas || null,
          quantidade: Number(m.quantidade),
          tipo_numeracao: m.configImpressao.tipoNumeracao || null,
          gabarito_operacional: m.gabaritoNumeracao && m.gabaritoNumeracao !== "Sem gabarito" ? m.gabaritoNumeracao : null,
          numeracao_inicio: m.numeracaoInicial !== undefined && m.numeracaoInicial !== null ? Number(m.numeracaoInicial) : null,
          numeracao_fim: m.numeracaoFinal !== undefined && m.numeracaoFinal !== null ? Number(m.numeracaoFinal) : null,
          obs_impressao: m.comentarioInterno || null,
          bloco: m.bloco || null,
          // Cada lote nasce no setor do seu produto, nao no do boletim aberto.
          setor: normalizarSetor(p.setor)
        }))
      );

      // `setorEfetivo` fica so como padrao de quem nao tiver setor proprio.
      const modelsResult = await salvarModelosBoletim(idInt, result.id, modelosPayload, setorEfetivo || null);

      if (!modelsResult.success) {
        showToast({
          type: "error",
          title: "Erro ao Salvar Modelos",
          description: modelsResult.error || "A OS foi criada, mas não foi possível salvar os lotes. Tente novamente."
        });
        setLoadingDetails(false);
        return;
      }

      // Update macro status if currently REVISAO PRODUCAO — mesmo retorno, mesma
      // razão do caminho de edição acima.
      const avanco = await avancarStatusParaEmProducao(idInt);
      if (avanco.statusInterno) setStatusProposta(avanco.statusInterno);

      // 4. Sucesso!
      showToast({
        type: "success",
        title: "Boletim salvo",
        description: "Novo boletim de entrada gerado. Você continua nesta OS."
      });

    } catch (error) {
      console.error("Erro ao processar salvamento do boletim:", error);
      showToast({
        type: "error",
        title: "Erro Inesperado",
        description: "Ocorreu um erro inesperado ao salvar o boletim de entrada."
      });
    } finally {
      setLoadingDetails(false);
    }
  };

  const canStartProd = selectedProposta ? canStartProduction(selectedProposta) : false;

  return (
    <form onSubmit={handleSubmit} className="space-y-7 text-xs text-slate-800 dark:text-slate-250 font-sans pb-12">
      {/* Salvar flutuante: a página é longa e o botão do rodapé exigia rolar até
          o fim só para gravar. Fica no canto, acima de tudo, e some enquanto
          está salvando para não render clique duplo.

          Some também na aba Revisão: ali a ação principal é "Confirmar revisão e
          liberar para Expedição", ancorada no mesmo canto inferior direito, e o
          flutuante (z-50) ficava por cima dela atrapalhando o clique. O botão de
          salvar do rodapé continua disponível na aba. */}
      {selectedProposta && !abaExpedicao && (
        <button
          type="submit"
          disabled={loadingDetails}
          title={isEditing ? "Salvar alterações desta OS" : "Salvar boletim"}
          /* MAIOR PARA O CHÃO DE FÁBRICA (30/08/2026): px-5 py-3.5 text-sm →
             px-8 py-5 text-base. A caixa cresce ~60% em área — a altura sai de
             ~48px para ~64px e a largura ganha os 24px do padding —, sem trocar
             cor, ícone, estados ou a posição flutuante. */
          className="fixed bottom-24 right-6 z-50 flex items-center gap-2 rounded-2xl bg-emerald-600 px-8 py-5 text-base font-bold text-white shadow-xl shadow-emerald-700/25 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {loadingDetails ? "Salvando..." : isEditing ? "Salvar Alterações" : "Salvar Boletim"}
        </button>
      )}

      {/* Mesmo cabecalho da edicao de proposta: numero do pedido em destaque e
          cliente ao lado, pelo `TituloNumeroCliente`. O que era o titulo
          ("Edicao / Abertura de OS") foi para o badge — o numero precisa do
          espaco nobre. O subtitle saiu porque repetia o badge, pelo mesmo
          motivo que a proposta ja o omite. */}
      <PageHeader
        title={
          <TituloNumeroCliente
            numero={numeroDoPedidoNoCabecalho}
            cliente={clienteNome}
          />
        }
        context={isEditing ? "Produção / OS · Edição" : "Produção / OS · Abertura"}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/pedidos"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 shadow-sm"
            >
              Voltar
            </Link>
            {isEditing && canPrintOS && isPrdAprovado && (
              <button
                type="button"
                onClick={() => void imprimirOsDoBoletimAberto("completo")}
                disabled={isPrintingOs}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 shadow-sm flex items-center gap-1.5 disabled:opacity-60"
              >
                <Printer className="h-4 w-4" />
                <span>
                  {isPrintingOs
                    ? "Gerando PDF..."
                    : setorEfetivo
                      ? `Imprimir OS · ${setorEfetivo}`
                      : "Imprimir OS"}
                </span>
              </button>
            )}
            {isEditing && boletins.length > 1 && (
              <button
                type="button"
                onClick={() => void baixarTodosOsBoletins("completo")}
                disabled={isPrintingOs}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 shadow-sm flex items-center gap-1.5 disabled:opacity-60"
              >
                <Printer className="h-4 w-4" />
                <span>Baixar todos ({boletins.length})</span>
              </button>
            )}
            {/* Versoes REDUZIDAS das mesmas acoes, num menu.
                Quatro botoes de PDF lado a lado poluiriam o cabecalho; o menu
                mantem o caminho comum a um clique e o reduzido a dois, sem
                mudar nada do que ja existia. */}
            {isEditing && canPrintOS && isPrdAprovado && (
              <ActionsMenu
                label="PDF reduzido"
                items={[
                  {
                    label: isPrintingOs
                      ? "Gerando PDF..."
                      : setorEfetivo
                        ? `PDF reduzido da OS · ${setorEfetivo}`
                        : "PDF reduzido da OS",
                    disabled: isPrintingOs,
                    onClick: () => void imprimirOsDoBoletimAberto("resumido")
                  },
                  ...(boletins.length > 1
                    ? [
                        {
                          label: `Baixar todos reduzidos (${boletins.length})`,
                          disabled: isPrintingOs,
                          onClick: () => void baixarTodosOsBoletins("resumido")
                        }
                      ]
                    : [])
                ]}
              />
            )}
            {selectedProposta && (
              <button
                type="submit"
                className="rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 text-sm font-semibold shadow-sm transition flex items-center gap-1.5"
              >
                <Save className="h-4 w-4" />
                <span>{isEditing ? "Salvar Alterações" : "Salvar Boletim"}</span>
              </button>
            )}
          </div>
        }
      />

      {isEditing && (
        <div className="rounded-3xl border border-sky-100 bg-sky-50/50 p-6 text-sky-900 shadow-xs">
          <div className="flex gap-3">
            <AlertCircle className="h-5 w-5 text-sky-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-sm">Modo Edição de OS</h4>
              <p className="text-xs text-sky-850 mt-1 leading-relaxed">
                Os dados de faturamento, cliente, quantidades e especificações técnicas de lotes estão bloqueados por segurança. Apenas designer, orientações, observações críticas e briefings técnicos de produção estão liberados.
              </p>
            </div>
          </div>
        </div>
      )}

      {isEditing ? (
        <div className="rounded-3xl border border-[#d7e5e8] bg-white p-7 space-y-3 shadow-sm">
          <h3 className="text-sm font-bold uppercase text-[#0b2f4a] dark:text-slate-200 tracking-wider">
            1. Proposta/Orçamento Comercial de Origem
          </h3>
          <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Você está editando as orientações técnicas do pedido operacional correspondente à proposta <span className="font-mono text-blue-600 dark:text-blue-400 font-black">#{idIntParam}</span>. A proposta de origem e o faturamento estão vinculados de forma definitiva.
          </div>
        </div>
      ) : idIntParam ? (
        <div className="rounded-3xl border border-[#d7e5e8] bg-white p-7 space-y-3 shadow-sm">
          <h3 className="text-sm font-bold uppercase text-[#0b2f4a] dark:text-slate-200 tracking-wider">
            1. Proposta/Orçamento Comercial de Origem
          </h3>
          <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Você está abrindo uma OS para a proposta <span className="font-mono text-blue-600 dark:text-blue-400 font-black">#{idIntParam}</span>. A proposta de origem e o faturamento estão vinculados de forma definitiva.
          </div>
        </div>
      ) : (
        <div className="rounded-3xl border border-[#d7e5e8] bg-white p-7 space-y-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold uppercase text-[#0b2f4a] dark:text-slate-200 tracking-wider">
                1. Seleção da Proposta/Orçamento Comercial de Origem
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 font-medium">
                Busque ou selecione um orçamento para carregar os dados operacionais da OS.
              </p>
            </div>
            {loadingPropostas && (
              <span className="text-xs font-bold text-slate-400 animate-pulse">Carregando propostas...</span>
            )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5 relative">
              <label className="text-xs font-semibold text-slate-500 uppercase">Buscar Proposta (Digite o Número ou Cliente)</label>
              <input
                type="text"
                placeholder="Digite o número da proposta (ex: 16821)..."
                value={propostaBusca}
                onChange={handlePropostaChange}
                onKeyDown={handlePropostaKeyDown}
                list="propostas-datalist"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 placeholder-slate-400 outline-none transition focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
              />
              <datalist id="propostas-datalist">
                {propostas.map((p) => (
                  <option key={p.id_int} value={p.id_int}>
                    {`#${p.id_int} - ${p.clienteNome} (Vendedor: ${p.vendedor})`}
                  </option>
                ))}
              </datalist>
              {searchFeedback && (
                <p className="text-xs text-amber-600 font-semibold mt-1">
                  {searchFeedback}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-slate-500 uppercase block">Propostas Recentes</span>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {recentes.slice(0, 5).map((p) => (
                  <button
                    key={p.id_int}
                    type="button"
                    onClick={() => {
                       setPropostaBusca(String(p.id_int));
                       selectProposta(p.id_int);
                    }}
                    className={`px-3.5 py-2 rounded-xl border text-xs font-mono font-semibold transition flex items-center gap-1.5 ${
                      selectedProposta?.id_int === p.id_int
                        ? "bg-[#0b2f4a] border-[#0b2f4a] text-white font-bold"
                        : "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700"
                    }`}
                  >
                    <span>#{p.id_int}</span>
                    <span className="opacity-70 font-sans font-normal">({(p.clienteNome || "").split(" ")[0]})</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {!selectedProposta ? (
        <div className="bg-slate-50/30 border border-dashed border-[#d7e5e8] p-12 text-center rounded-3xl space-y-3">
          {loadingDetails || idIntParam ? (
            <>
              <div className="h-10 w-10 mx-auto rounded-full border-4 border-slate-200 border-t-[#0b2f4a] animate-spin"></div>
              <h4 className="font-extrabold text-sm text-[#0b2f4a] uppercase mt-4">Carregando dados da proposta...</h4>
              <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                Por favor, aguarde enquanto recuperamos os dados comerciais e itens para a produção.
              </p>
            </>
          ) : (
            <>
              <FileText className="h-10 w-10 text-slate-355 mx-auto" />
              <h4 className="font-extrabold text-sm text-[#0b2f4a] uppercase">Aguardando Seleção de Origem</h4>
              <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                Selecione uma proposta comercial ativa usando o campo de busca ou clique em uma das propostas recentes para carregar os dados de manufatura e abrir a Ficha Técnica.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          {/* HEADER DE STATUS OPERACIONAL */}
          <div className="rounded-3xl border border-[#d7e5e8] bg-white p-7 grid grid-cols-2 md:grid-cols-3 gap-5 text-xs shadow-sm">
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase block">Proposta de Origem</span>
              <strong className="text-base font-mono text-[#0b2f4a] dark:text-slate-100">#{selectedProposta.id_int}</strong>
            </div>
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase block">Cliente</span>
              <strong className="text-base text-slate-800 dark:text-slate-200 truncate block">{clienteNome}</strong>
            </div>
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase block">Status Operacional OS</span>
              <strong className="text-sm text-slate-800 flex items-center gap-1.5 mt-1.5">
                <span className={`h-2 w-2 rounded-full ${statusOperacional === 'BLOQUEADO' ? 'bg-amber-500 animate-pulse' : 'bg-blue-500 animate-ping'}`}></span>
                <span className="font-bold text-[#0b2f4a]">{statusOperacional}</span>
              </strong>
            </div>
            {/* Status macro da proposta: o único que o salvamento do boletim
                muda, e que agora acompanha a mudança sem sair da tela. */}
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase block">Status da proposta</span>
              <strong className="text-sm text-slate-800 flex items-center gap-1.5 mt-1.5">
                <span className="font-bold text-[#0b2f4a]">{statusProposta || "—"}</span>
              </strong>
            </div>
          </div>
 
          {loadingDetails && (
            <div className="text-center py-4 text-xs font-bold text-slate-600 dark:text-slate-400 animate-pulse">Carregando detalhes operacionais da proposta...</div>
          )}

          <div className="space-y-4">
              
              {/* BLOCO 1 — DADOS PRINCIPAIS */}
              <div className="rounded-3xl border border-[#d7e5e8] bg-white p-7 space-y-6 shadow-sm">
                <h3 className="text-sm font-bold uppercase text-[#0b2f4a] dark:text-slate-200 tracking-wider border-b border-slate-100 pb-3 flex items-center gap-1.5">
                  BLOCO 1 — Identificação Comercial
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500 uppercase">Cliente</label>
                    <div className="relative w-full h-12 rounded-2xl border border-slate-200 bg-slate-100 overflow-hidden cursor-not-allowed">
                      <div className="absolute inset-0 flex items-center px-4">
                        <span className="text-base font-bold text-slate-800 truncate">{clienteNome || "-"}</span>
                      </div>
                      <input type="text" readOnly value={clienteNome} className="opacity-0 absolute inset-0 w-full h-full cursor-not-allowed" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500 uppercase">Contato</label>
                    <div className="relative w-full h-12 rounded-2xl border border-slate-200 bg-slate-100 overflow-hidden cursor-not-allowed">
                      <div className="absolute inset-0 flex items-center px-4">
                        <span className="text-base font-bold text-slate-800 truncate">{contatoNome || "-"}</span>
                      </div>
                      <input type="text" readOnly value={contatoNome} className="opacity-0 absolute inset-0 w-full h-full cursor-not-allowed" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500 uppercase">Vendedor</label>
                    <div className="relative w-full h-12 rounded-2xl border border-slate-200 bg-slate-100 overflow-hidden cursor-not-allowed">
                      <div className="absolute inset-0 flex items-center px-4">
                        <span className="text-base font-bold text-slate-800 truncate">{vendedor || "-"}</span>
                      </div>
                      <input type="text" readOnly value={vendedor} className="opacity-0 absolute inset-0 w-full h-full cursor-not-allowed" />
                    </div>
                  </div>


                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500 uppercase">Título do Evento</label>
                    <div className="relative w-full h-12 rounded-2xl border border-slate-200 bg-slate-100 overflow-hidden cursor-not-allowed">
                      <div className="absolute inset-0 flex items-center px-4">
                        <span className="text-base font-bold text-slate-800 truncate">{tituloEvento}</span>
                      </div>
                      <input type="text" readOnly value={tituloEvento} className="opacity-0 absolute inset-0 w-full h-full cursor-not-allowed" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500 uppercase">Data do Evento</label>
                    <div className="relative w-full h-12 rounded-2xl border border-slate-200 bg-slate-100 overflow-hidden cursor-not-allowed">
                      <div className="absolute inset-0 flex items-center px-4">
                        <span className="text-base font-bold text-slate-800 truncate">{dadosEventoData ? new Date(dadosEventoData).toLocaleDateString("pt-BR") : "Não informada"}</span>
                      </div>
                      <input type="text" readOnly value={dadosEventoData ? new Date(dadosEventoData).toLocaleDateString("pt-BR") : "Não informada"} className="opacity-0 absolute inset-0 w-full h-full cursor-not-allowed" />
                    </div>
                  </div>
                </div>

                {/* Abas de setor. A OS já nasce sabendo os seus setores — eles vêm
                    dos produtos do pedido —, então não há "adicionar setor": cada
                    aba é um setor, e clicar nela abre o boletim daquele setor
                    (criando-o no primeiro save, se ainda não existir). */}
                {abasDeSetor.length > 0 && (
                  <div className="mt-4">
                    <div className="flex flex-wrap items-end gap-1.5 border-b-[3px] border-slate-300">
                      {abasDeSetor.map((aba) => {
                        const cores = coresDoSetor(aba.setor);
                        const ativa = !abaExpedicao && normalizarSetor(setorEfetivo) === aba.setor && Boolean(setorEfetivo);
                        return (
                          <button
                            key={aba.setor}
                            type="button"
                            onClick={() => {
                              setAbaExpedicao(false);
                              setBoletimSetor(aba.setor);
                              setBoletimId(aba.boletim?.id ?? null);
                              setBoletimHora(aba.boletim?.hora || "");
                              if (aba.boletim?.prazo) setDataPrevistaEntrega(aba.boletim.prazo);
                            }}
                            className={`-mb-[3px] flex items-center gap-2 rounded-t-2xl border-2 border-b-0 px-5 py-3 text-sm font-black uppercase tracking-wide transition ${
                              ativa
                                ? `${cores.chip} ${cores.borda} shadow-md`
                                : `${cores.borda} ${cores.fundo} ${cores.texto} hover:brightness-95`
                            }`}
                          >
                            {aba.setor}
                            <span className={`text-[11px] font-bold normal-case ${ativa ? "opacity-80" : "opacity-60"}`}>
                              {aba.produtos} prod.
                            </span>
                            {aba.boletim ? (
                              aba.boletim.hora && (
                                <span className={`font-mono text-[11px] ${ativa ? "opacity-80" : "opacity-60"}`}>
                                  {aba.boletim.hora}
                                </span>
                              )
                            ) : (
                              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                                ativa ? "bg-white/25 text-white" : "bg-orange-100 text-orange-800"
                              }`}>
                                a abrir
                              </span>
                            )}
                          </button>
                        );
                      })}
                      {/* Revisão não é setor: confere o pedido inteiro e o libera para a Expedição. */}
                      {/* ...mas ela segue só na edição: libera o pedido para a Expedição,
                          e isso não é ação de quem está abrindo a OS. */}
                      {isEditing && (
                      <button
                        type="button"
                        onClick={() => setAbaExpedicao(true)}
                        className={`-mb-[3px] ml-2 flex items-center gap-2 rounded-t-2xl border-2 border-b-0 border-[#0b2f4a] px-5 py-3 text-sm font-black uppercase tracking-wide transition ${
                          abaExpedicao
                            ? "bg-[#0b2f4a] text-white shadow-md"
                            : "bg-[#0b2f4a]/5 text-[#0b2f4a] hover:brightness-95"
                        }`}
                      >
                        Revisão
                        <span className={`text-[11px] font-bold normal-case ${abaExpedicao ? "opacity-80" : "opacity-60"}`}>
                          pedido inteiro
                        </span>
                      </button>
                      )}
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                      O pedido #{idIntParam} é um só; cada setor produz a sua parte e tem o seu
                      boletim e o seu PDF. A aba mostra apenas os produtos daquele setor.
                      {setoresSemBoletim.length > 0 && (
                        <>
                          {" "}As abas marcadas como <strong className="text-orange-700">a abrir</strong> ainda
                          não têm boletim: preencha o prazo e salve para criá-lo.
                        </>
                      )}
                    </p>
                  </div>
                )}

                {!abaExpedicao && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mt-4 p-5 rounded-3xl bg-blue-50/80 border-2 border-blue-100">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-blue-900 uppercase tracking-wider">Setor do Boletim</label>
                    {/* Quem define o setor é a aba aberta — não há escolha a fazer
                        aqui, o setor vem dos produtos do pedido. */}
                    <div className="flex h-11 w-full items-center gap-2 rounded-2xl border-2 border-blue-200 bg-white px-4">
                      {setorEfetivo ? (
                        <>
                          <span className={`h-2.5 w-2.5 rounded-full ${coresDoSetor(normalizarSetor(setorEfetivo)).chip}`} />
                          <span className="text-base font-bold text-blue-950">{normalizarSetor(setorEfetivo)}</span>
                          <span className="ml-auto text-[11px] font-semibold text-slate-400">definido pela aba</span>
                        </>
                      ) : (
                        <span className="text-sm font-semibold text-slate-400">Escolha uma aba de setor acima</span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-bold text-blue-900 uppercase tracking-wider">Data Limite de Entrega *</label>
                    <div className={`relative flex items-center w-full rounded-2xl border-2 h-11 transition focus-within:ring-4 ${lockDate ? "border-blue-200 bg-slate-100/80 cursor-not-allowed" : "border-blue-300 bg-white focus-within:border-blue-600 focus-within:ring-blue-100"}`}>
                      <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                        <span className={`text-xl font-bold font-mono ${lockDate ? "text-slate-800" : "text-blue-950"}`}>
                          {dataPrevistaEntrega ? dataPrevistaEntrega.split('-').reverse().join('/') : "DD/MM/AAAA"}
                        </span>
                      </div>
                      <input
                        type="date"
                        required
                        readOnly={lockDate}
                        disabled={lockDate}
                        value={dataPrevistaEntrega}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDataPrevistaEntrega(e.target.value)}
                        className={`w-full h-full bg-transparent border-none outline-none pl-4 pr-3 text-transparent [&::-webkit-datetime-edit]:text-transparent [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70 [&::-webkit-calendar-picker-indicator]:hover:opacity-100 ${lockDate ? "cursor-not-allowed" : "cursor-pointer"}`}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-bold text-blue-900 uppercase tracking-wider">Hora do Prazo</label>
                    <input
                      type="time"
                      value={boletimHora}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBoletimHora(e.target.value)}
                      // O texto do input de hora é desenhado pelo próprio navegador e não
                      // herda o tamanho da classe: sem estilizar o ::-webkit-datetime-edit
                      // ele sai miúdo ao lado da Data Limite de Entrega.
                      className="w-full h-11 rounded-2xl border-2 border-blue-300 bg-white px-4 text-xl font-bold font-mono text-blue-950 outline-none transition focus:border-blue-600 focus:ring-4 focus:ring-blue-100 [&::-webkit-datetime-edit]:text-xl [&::-webkit-datetime-edit]:font-bold [&::-webkit-datetime-edit]:font-mono [&::-webkit-datetime-edit]:text-blue-950 [&::-webkit-datetime-edit-fields-wrapper]:text-xl [&::-webkit-datetime-edit-hour-field]:text-blue-950 [&::-webkit-datetime-edit-minute-field]:text-blue-950 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70 [&::-webkit-calendar-picker-indicator]:hover:opacity-100"
                    />
                  </div>

                  <div className="flex items-center gap-3 pt-8">
                    <input
                      type="checkbox"
                      id="urgente-toggle"
                      disabled={isEditing}
                      checked={urgente}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrgente(e.target.checked)}
                      className={`h-7 w-7 text-red-600 focus:ring-red-500 border-red-300 rounded bg-white ${isEditing ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                    />
                    <label htmlFor="urgente-toggle" className="text-base font-black text-red-600 uppercase tracking-widest cursor-pointer select-none">
                      ⚡ PRIORIDADE URGENTE
                    </label>
                  </div>
                </div>
                )}
              </div>
            
            {/* BLOCO 2 — ORIENTAÇÃO TÉCNICA DE PRODUÇÃO (não aparece na Revisão:
                já está em cada setor). O campo é `propostas.obs_tecnica`, o mesmo que
                o vendedor edita na aba Produção da proposta, e sai na OS impressa —
                por isso o rótulo pede o que a bancada precisa para fabricar, e não
                mais observação comercial. */}
            {!abaExpedicao && (
            <div className="rounded-3xl border border-[#d7e5e8] bg-white p-7 space-y-5 shadow-sm">
              <h3 className="text-sm font-bold uppercase text-[#0b2f4a] dark:text-slate-200 tracking-wider border-b border-slate-100 pb-3 flex items-center gap-1.5">
                BLOCO 2 — Orientação Técnica de Produção
              </h3>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-500 uppercase">Instruções de fabricação · sai na OS impressa</label>
                <textarea
                  placeholder="O que a bancada precisa saber para fabricar. Ex: pulseira de pino sem o pino; entregar em bobina de 100; conferir a cor contra a amostra aprovada..."
                  rows={4}
                  value={briefingOperacional}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBriefingOperacional(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm text-slate-700 placeholder-slate-400 outline-none resize-y transition focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
                />
              </div>
            </div>
            )}

          {/* BLOCO 3 & 4 — PRODUTOS E MODELOS (do setor da aba) */}
          {!abaExpedicao && (
          <div className="rounded-3xl border border-[#d7e5e8] bg-white p-7 space-y-6 shadow-sm">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold uppercase text-[#0b2f4a] dark:text-slate-200 tracking-wider flex items-center gap-1.5">
                BLOCO 3 & 4 — Produtos & Lotes Técnicos (PCP)
                {isEditing && boletimSetor && (
                  <span className={`ml-2 rounded-lg px-2.5 py-1 text-xs font-black tracking-wider ${coresDoSetor(normalizarSetor(boletimSetor)).chip}`}>
                    {normalizarSetor(boletimSetor)}
                  </span>
                )}
              </h3>
              {/* Produtos são herdados da proposta de origem */}
            </div>

            {/* Só o setor da aba aberta. Os outros setores do pedido têm as suas
                próprias abas — misturá-los aqui era justamente o que confundia. */}
            <div className="space-y-6">
              {gruposVisiveis.map((grupo) => {
                const cores = coresDoSetor(grupo.setor);
                const ehDesteBoletim = normalizarSetor(setorEfetivo) === grupo.setor && Boolean(setorEfetivo);
                const boletimDoSetor = boletins.find((b) => normalizarSetor(b.setor) === grupo.setor);
                const totalDoSetor = grupo.produtos.reduce(
                  (soma, prod) => soma + (Number(prod.quantidadeOriginal || prod.quantidade) || 0),
                  0
                );

                return (
                  <section
                    key={grupo.setor}
                    className={`rounded-3xl border-2 p-5 space-y-4 transition ${
                      ehDesteBoletim ? `${cores.borda} bg-white shadow-sm` : "border-slate-200 bg-slate-50/60"
                    }`}
                  >
                    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className={`rounded-xl px-3 py-1.5 text-sm font-black tracking-wider ${cores.chip}`}>
                          {grupo.setor}
                        </span>
                        <span className="text-xs font-semibold text-slate-500">
                          {grupo.produtos.length} produto{grupo.produtos.length > 1 ? "s" : ""} · {totalDoSetor.toLocaleString("pt-BR")} un
                        </span>
                        {ehDesteBoletim ? (
                          <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase ${cores.borda} ${cores.fundo} ${cores.texto}`}>
                            Este boletim
                          </span>
                        ) : boletimDoSetor ? (
                          <span className="rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                            Boletim próprio
                          </span>
                        ) : (
                          <span className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-[10px] font-bold uppercase text-orange-800">
                            Sem boletim
                          </span>
                        )}
                      </div>
                      {isEditing && boletimDoSetor && !ehDesteBoletim && idIntParam && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void imprimirOsDeOutroSetor(boletimDoSetor, "completo")}
                            disabled={isPrintingOs}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                          >
                            Abrir PDF do {grupo.setor}
                          </button>
                          {/* Mesma acao, layout reduzido: mesmo boletim, mesmo setor. */}
                          <button
                            type="button"
                            onClick={() => void imprimirOsDeOutroSetor(boletimDoSetor, "resumido")}
                            disabled={isPrintingOs}
                            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 disabled:opacity-60"
                            title={`PDF reduzido do ${grupo.setor}`}
                          >
                            reduzido
                          </button>
                        </div>
                      )}
                    </header>

                    <div className={`space-y-4 ${ehDesteBoletim ? "" : "opacity-60"}`}>
                      {grupo.produtos.map((p) => {
                        const pIndex = produtos.findIndex((item) => item.id === p.id);
                        const modelsSum = p.modelos.reduce((sum, m) => sum + (Number(m.quantidade) || 0), 0);
                        const maxQty = p.quantidadeOriginal || p.quantidade;
                        const isOverLimit = modelsSum > maxQty;

                        return (
                  <div
                    key={p.id}
                    className="rounded-3xl border border-[#d7e5e8] bg-slate-50/50 p-6 space-y-5 shadow-sm relative"
                  >
                    {/* Product row details */}
                    <div className="flex flex-wrap items-center justify-between gap-3.5 border-b border-slate-150 pb-3">
                      <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-center gap-2">
                          <Boxes className="h-5 w-5 text-[#0b2f4a] shrink-0" />
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold uppercase text-xs text-slate-500">Produto {pIndex + 1}:</span>
                              <span className="font-black text-base text-[#0b2f4a] uppercase">{p.nome}</span>
                              <span className="ml-2 bg-blue-100 text-blue-900 text-sm px-3 py-1 rounded-full font-mono font-bold shadow-sm border border-blue-200">
                                Qtd Proposta: {maxQty.toLocaleString("pt-BR")} un
                              </span>
                            </div>
                            {(p.codigo_produto || p.observacoes_item) && (
                              <div className="text-sm text-slate-700 mt-1">
                                {p.codigo_produto && <span className="mr-3 font-mono font-bold bg-slate-200 px-2 py-0.5 rounded text-slate-800">Cód: {p.codigo_produto}</span>}
                                {p.observacoes_item && <span className="italic font-medium">Obs: {p.observacoes_item}</span>}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Setor PCP selection */}
                        <div className="flex items-center gap-2.5">
                          <span className="text-xs font-semibold text-slate-500 uppercase">Setor PCP:</span>
                          <div className="relative w-full">
                            {isEditing && (
                              <div className="absolute inset-0 flex items-center px-3.5 rounded-xl border border-slate-200 bg-slate-100 cursor-not-allowed pointer-events-none z-10">
                                <span className="text-sm font-bold text-slate-800 truncate">{p.setor || "LASER"}</span>
                              </div>
                            )}
                            <select
                              disabled={isEditing}
                              value={p.setor || "LASER"}
                              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateProductSector(p.id, e.target.value)}
                              className={`w-full rounded-xl border border-slate-200 text-xs px-3.5 py-1.5 font-bold outline-none transition focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6] ${isEditing ? "opacity-0 cursor-not-allowed" : "bg-white text-slate-700 cursor-pointer"}`}
                            >
                              <option value="LASER">LASER</option>
                              <option value="TEXTIL">TEXTIL</option>
                              <option value="PVC">PVC</option>
                              <option value="FLEXO">FLEXO</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Produtos e quantidades totais são fixos por contrato */}
                    </div>

                  {/* Models list nested */}
                  <div className="space-y-3.5">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-tight">Especificação dos Modelos (Subitens)</span>
                      {!isEditing && (
                        <button
                          type="button"
                          onClick={() => addModelRow(p.id)}
                          className="h-8 px-3.5 text-slate-700 hover:bg-slate-50 border border-slate-200 rounded-xl font-bold flex items-center gap-1 transition"
                        >
                          <Plus className="h-3 w-3" />
                          <span>Adicionar Lote</span>
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                      {p.modelos.map((m) => {
                        const validation = getRowValidationError(p, m);
                        return (
                          <div 
                            key={m.id} 
                            className="rounded-3xl border border-slate-200 bg-white p-6 space-y-5 relative shadow-xs hover:border-slate-300 transition"
                          >
                            {/* Header do Card (Título do Lote + Botão Deletar) */}
                            <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-800 pb-3">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold uppercase text-[#0b2f4a] dark:text-slate-350 tracking-wider">
                                  Lote / Modelo
                                </span>
                                <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                                  {normalizarSetor(p.setor)}
                                </span>
                              </div>
                              {!isEditing && (
                                <button
                                  type="button"
                                  onClick={() => removeModelRow(p.id, m.id)}
                                  className="text-slate-400 hover:text-red-500 transition"
                                  title="Remover Lote"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </div>

                            {/* Linha 1: Nome, Cor/Material e Qtd */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-500 uppercase block">Nome do Lote *</label>
                                <div className="relative w-full">
                                  <div className="absolute inset-0 flex items-center px-3 rounded-xl border border-slate-200 bg-slate-100 cursor-not-allowed pointer-events-none z-10">
                                    <span className="text-sm font-bold text-slate-800 truncate">{m.nomeModelo || "-"}</span>
                                  </div>
                                  <input
                                    type="text"
                                    placeholder="Ex: Lote VIP"
                                    required
                                    readOnly={true}
                                    disabled={true}
                                    value={m.nomeModelo}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateModelField(p.id, m.id, "nomeModelo", e.target.value)}
                                    className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold outline-none transition opacity-0 cursor-not-allowed"
                                  />
                                </div>
                                {validation && (
                                  <div className={`text-[8px] font-bold px-1 py-0.5 rounded leading-tight mt-1 ${
                                    validation.type === 'error' 
                                      ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400 border border-red-200/40' 
                                      : 'bg-amber-50 text-amber-700 dark:bg-amber-955/30 dark:text-amber-450 border border-amber-200/40'
                                  }`}>
                                    {validation.message}
                                  </div>
                                )}
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-500 uppercase block">Cor / Material</label>
                                <div className="relative w-full">
                                  {isEditing && (
                                    <div className="absolute inset-0 flex items-center px-3 rounded-xl border border-slate-200 bg-slate-100 cursor-not-allowed pointer-events-none z-10">
                                      <span className="text-sm font-bold text-slate-800 truncate">{m.corMaterial || "Branco"}</span>
                                    </div>
                                  )}
                                  <select
                                    disabled={isEditing}
                                    value={m.corMaterial || "Branco"}
                                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateModelField(p.id, m.id, "corMaterial", e.target.value)}
                                    className={`w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold outline-none transition ${isEditing ? "opacity-0 cursor-not-allowed" : "bg-white text-slate-700 focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"}`}
                                  >
                                  <option value="Branco">Branco</option>
                                  <option value="Azul">Azul</option>
                                  <option value="Vermelho">Vermelho</option>
                                  <option value="Verde">Verde</option>
                                  <option value="Amarelo">Amarelo</option>
                                  <option value="Preto">Preto</option>
                                  <option value="Dourado">Dourado</option>
                                  <option value="Prata">Prata</option>
                                  <option value="Transparente">Transparente</option>
                                  <option value="Personalizado">Personalizado</option>
                                </select>
                                </div>
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-500 uppercase block">Quantidade *</label>
                                <div className="relative w-full">
                                  <div className="absolute inset-0 flex items-center justify-end px-3 rounded-xl border border-slate-200 bg-slate-100 cursor-not-allowed pointer-events-none z-10">
                                    <span className="text-sm font-bold font-mono text-slate-800 truncate">{m.quantidade}</span>
                                  </div>
                                  <input
                                    type="number"
                                    min={1}
                                    required
                                    readOnly={true}
                                    disabled={true}
                                    value={m.quantidade}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateModelField(p.id, m.id, "quantidade", Number(e.target.value) || 0)}
                                    className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-right font-mono text-xs font-semibold outline-none transition opacity-0 cursor-not-allowed"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Linha 2: Checkboxes Frente/Verso, RFID e Numeração.
                                Produto de prateleira é vendido pronto: não tem
                                arte, numeração, gabarito nem frente/verso, então
                                esta linha e a seguinte saem do card. */}
                            {!p.isEstoque && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                              <div className="flex items-center gap-3.5 bg-slate-50 p-3 rounded-2xl border border-slate-200">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    id={`verso-${m.id}`}
                                    disabled={isEditing}
                                    checked={m.verso}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateModelField(p.id, m.id, "verso", e.target.checked)}
                                    className={`h-5 w-5 rounded border-slate-300 text-purple-600 focus:ring-purple-500 ${isEditing ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                                  />
                                  <label htmlFor={`verso-${m.id}`} className="text-xs font-semibold text-slate-655 uppercase cursor-pointer select-none">
                                    Frente + Verso (F+V)
                                  </label>
                                </div>
                              </div>

                              <div className="flex items-center gap-3.5 bg-slate-50 p-3 rounded-2xl border border-slate-200">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    id={`rfid-${m.id}`}
                                    disabled={isEditing}
                                    checked={m.configImpressao.rfid || false}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateModelConfigField(p.id, m.id, "rfid", e.target.checked)}
                                    className={`h-4.5 w-4.5 rounded-lg border-slate-300 text-[#0f9f9a] focus:ring-[#0f9f9a] transition ${isEditing ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                                  />
                                  <label htmlFor={`rfid-${m.id}`} className="text-xs font-semibold text-slate-650 uppercase cursor-pointer select-none">
                                    RFID / NFC Integrado
                                  </label>
                                </div>
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-500 uppercase block">Tipo de Numeração</label>
                                {/* Definido no orçamento: na edição do boletim só se lê. */}
                                {isEditing ? (
                                  <div className="w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 opacity-80 select-none cursor-not-allowed">
                                    {rotuloTipoNumeracao(m.configImpressao.tipoNumeracao)}
                                  </div>
                                ) : (
                                  <div className="relative w-full">
                                    <select
                                      value={m.configImpressao.tipoNumeracao}
                                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateModelConfigField(p.id, m.id, "tipoNumeracao", e.target.value)}
                                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold outline-none transition bg-white text-slate-700 focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
                                    >
                                      <option value="SEM_NUMERACAO">Sem Numeração</option>
                                      <option value="SEQUENCIAL">Sequencial</option>
                                      <option value="CUSTOMIZADA">Customizada (CSV)</option>
                                    </select>
                                  </div>
                                )}
                              </div>
                            </div>
                            )}

                            {/* Linha 3: Gabarito e Faixas / CSV */}
                            {!p.isEstoque && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                              {/* Gabarito Operacional: escolha do orçamento (pedidos_modelos.gabarito_operacional,
                                  campo "Numerador" da aba Modelos). Na edição do boletim o card não o oferece —
                                  a OS já saiu com ele definido e trocar aqui faria a produção divergir do vendido.
                                  Na ABERTURA continua editável: é onde o lote nasce. */}
                              {!isEditing && (
                              <div className="space-y-1.5 relative">
                                <label className="text-xs font-semibold text-slate-500 uppercase block">Gabarito Operacional</label>
                                <div className="flex items-center gap-1">
                                  <div className="relative flex-1">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        if (openGabaritoDropdown === m.id) {
                                          setOpenGabaritoDropdown(null);
                                        } else {
                                          const rect = e.currentTarget.getBoundingClientRect();
                                          setDropdownPosition({
                                            top: rect.bottom,
                                            left: rect.left,
                                            width: Math.max(rect.width, 220)
                                          });
                                          setOpenGabaritoDropdown(m.id);
                                          setGabaritoSearchQuery("");
                                        }
                                      }}
                                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold outline-none flex items-center justify-between gap-1 shadow-sm hover:border-slate-300 transition bg-white text-slate-700 focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
                                    >
                                      <span className="truncate">
                                        {m.gabaritoNumeracao && m.gabaritoNumeracao !== "Sem gabarito" ? m.gabaritoNumeracao : "Sem gabarito"}
                                      </span>
                                      <ChevronDown className="h-3.5 w-3.5 text-slate-550 dark:text-slate-400 shrink-0" />
                                    </button>

                                    {openGabaritoDropdown === m.id && isMounted && createPortal(
                                      <>
                                        <div 
                                          className="fixed inset-0 z-40" 
                                          onClick={() => setOpenGabaritoDropdown(null)}
                                        />
                                        <div 
                                          style={{
                                            position: "fixed",
                                            top: `${(dropdownPosition?.top ?? 0) + 4}px`,
                                            left: `${dropdownPosition?.left ?? 0}px`,
                                            width: `${dropdownPosition?.width ?? 220}px`,
                                          }}
                                          className="bg-white dark:bg-slate-955 border border-slate-300 dark:border-slate-700 rounded-lg shadow-lg z-50 text-[10px] font-bold overflow-hidden flex flex-col"
                                        >
                                          {/* Campo de Busca Interno */}
                                          <div className="p-1.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                                            <input
                                              type="text"
                                              autoFocus
                                              placeholder="Digitar para filtrar..."
                                              value={gabaritoSearchQuery}
                                              onChange={(e) => setGabaritoSearchQuery(e.target.value)}
                                              className="w-full h-6 px-2 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 focus:outline-none focus:ring-1 focus:ring-blue-500 text-[10px] text-slate-900 dark:text-slate-100 font-medium"
                                            />
                                          </div>
                                          
                                          {/* Lista de Opções */}
                                          <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                                            {gabaritosOptions.filter(g => g.toLowerCase().includes(gabaritoSearchQuery.toLowerCase())).length === 0 ? (
                                              <div className="p-2 text-slate-400 italic text-center">Nenhum encontrado</div>
                                            ) : (
                                              gabaritosOptions.filter(g => g.toLowerCase().includes(gabaritoSearchQuery.toLowerCase())).map((g, idx) => {
                                                return (
                                                  <button
                                                    key={idx}
                                                    type="button"
                                                    onClick={() => {
                                                      updateModelField(p.id, m.id, "gabaritoNumeracao", g);
                                                      setOpenGabaritoDropdown(null);
                                                    }}
                                                    className={`w-full text-left p-2 hover:bg-slate-100 dark:hover:bg-slate-900 block transition-colors ${
                                                      m.gabaritoNumeracao === g 
                                                        ? "bg-blue-50/50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400" 
                                                        : "text-slate-800 dark:text-slate-200"
                                                    }`}
                                                  >
                                                    <div>{g}</div>
                                                  </button>
                                                );
                                              })
                                            )}
                                          </div>
                                        </div>
                                      </>,
                                      document.body
                                    )}
                                  </div>

                                  {/* Botão Ver Gabarito (Olho) */}
                                  {m.gabaritoNumeracao && m.gabaritoNumeracao !== "Sem gabarito" && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const foundInDb = gabaritosOptions.find(g => g === m.gabaritoNumeracao);
                                        const mockFound = MOCK_GABARITOS.find(g => g.nome === m.gabaritoNumeracao || g.id === m.gabaritoNumeracao);
                                        if (mockFound) {
                                          setSelectedGabaritoPreview(mockFound);
                                        } else if (foundInDb) {
                                          setSelectedGabaritoPreview({
                                            id: foundInDb,
                                            nome: foundInDb,
                                            descricao: "Gabarito do cadastro.",
                                            previewImageUrl: ""
                                          });
                                        }
                                      }}
                                      className="h-10 w-10 rounded-xl border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 flex items-center justify-center shrink-0 transition"
                                      title="Ver gabarito visual"
                                    >
                                      <Eye className="h-4.5 w-4.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                              )}

                              {/* Faixas de Numeração ou CSV */}
                              <div className="space-y-1.5">
                                {m.configImpressao.tipoNumeracao === "SEQUENCIAL" ? (
                                  <div>
                                    <label className="text-xs font-semibold text-slate-500 uppercase block mb-1">Faixa Numérica (Início / Fim)</label>
                                    <div className="flex gap-2 w-full">
                                      {/* Início é do orçamento: na edição só se lê, como o Fim sempre foi. */}
                                      {isEditing ? (
                                        <div className="w-1/2 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-right font-mono text-xs font-semibold text-slate-800 opacity-80 select-none cursor-not-allowed">
                                          {m.numeracaoInicial || ""}
                                        </div>
                                      ) : (
                                        <div className="relative w-1/2">
                                          <input
                                            type="number"
                                            placeholder="Início"
                                            required
                                            value={m.numeracaoInicial || ""}
                                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateModelField(p.id, m.id, "numeracaoInicial", Number(e.target.value) || 0)}
                                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-right font-mono text-xs font-semibold outline-none transition bg-white text-slate-700 focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
                                          />
                                        </div>
                                      )}
                                      {isEditing ? (
                                        <div className="w-1/2 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-right font-mono text-xs font-semibold text-slate-800 opacity-80 select-none cursor-not-allowed">
                                          {m.numeracaoFinal || ""}
                                        </div>
                                      ) : (
                                        <div className="relative w-1/2">
                                          <div className="absolute inset-0 flex items-center justify-end px-3 rounded-xl border border-slate-200 bg-slate-100 cursor-not-allowed pointer-events-none z-10">
                                            <span className="text-sm font-bold font-mono text-slate-800 truncate">{m.numeracaoFinal || ""}</span>
                                          </div>
                                          <input
                                            type="number"
                                            placeholder="Fim"
                                            readOnly
                                            value={m.numeracaoFinal || ""}
                                            className="w-full h-full opacity-0 cursor-not-allowed"
                                          />
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ) : m.configImpressao.tipoNumeracao === "CUSTOMIZADA" ? (
                                  <div>
                                    <label className="text-xs font-semibold text-slate-500 uppercase block text-left mb-1">Planilha de Dados (.CSV)</label>
                                    {m.csvDadosVariaveisUrl ? (
                                      <div className="flex items-center justify-between border border-emerald-200 bg-emerald-50 px-3 py-2 rounded-2xl text-xs font-semibold text-emerald-700 h-10">
                                        <span className="truncate max-w-[130px] font-mono">{m.csvDadosVariaveisUrl}</span>
                                        <button
                                          type="button"
                                          onClick={() => updateModelField(p.id, m.id, "csvDadosVariaveisUrl", "")}
                                          className="text-red-500 hover:text-red-700 ml-1 font-bold text-sm"
                                          title="Remover planilha"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled={isEditing}
                                        onClick={() => handleMockImportCSV(p.id, m.id, m.nomeModelo)}
                                        className={`w-full h-10 rounded-2xl border text-xs font-semibold transition ${isEditing ? "bg-slate-100 text-slate-400 cursor-not-allowed border-slate-200" : "bg-slate-150 hover:bg-slate-205 text-slate-700 border-slate-300"}`}
                                      >
                                        Importar CSV Variáveis
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <div>
                                    <label className="text-xs font-semibold text-slate-500 uppercase block mb-1">Faixa Numérica (Início / Fim)</label>
                                    <div className="h-10 bg-slate-100 rounded-2xl border border-slate-200 flex items-center justify-center text-slate-450 font-semibold text-xs">
                                      Sem faixa numérica
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                  {/* Totalizer and Limit Warning */}
                  <div className={`flex justify-between items-center p-3 rounded-xl text-xs font-semibold mt-2 border ${
                    isOverLimit 
                      ? "bg-red-50 text-red-700 border-red-200 animate-pulse"
                      : "bg-slate-50 text-slate-600 border-slate-200"
                  }`}>
                    <span className="font-mono">Total Distribuído nos Lotes: {modelsSum.toLocaleString("pt-BR")} / {maxQty.toLocaleString("pt-BR")} un</span>
                    {isOverLimit ? (
                      <span>⚠️ Limite excedido! A soma excede o total da proposta.</span>
                    ) : (
                      <span className="text-emerald-650 font-bold">✓ Distribuição de lotes válida</span>
                    )}
                  </div>
                  </div>
                </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
          )}

          {/* CONFIGURAÇÕES TÉCNICAS POR SETOR PCP (BLOCOS 6 & 7 SIMPLIFICADOS)
              Não aparece na Revisão: é conteúdo de cada setor. */}
          {!abaExpedicao && (
          <div className="rounded-3xl border border-[#d7e5e8] bg-white p-7 space-y-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold uppercase text-[#0b2f4a] dark:text-slate-200 tracking-wider">
                Configurações Técnicas e Acabamento (PCP)
              </h3>
              <span className="text-[9px] font-bold text-[#0b2f4a]">
                Blocos 6 e 7 Padronizados
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase block">
                  Observações Técnicas de Impressão (Bloco 6)
                </label>
                <textarea
                  placeholder="Especificações de impressão, perfil de qualidade, tipo de tinta..."
                  rows={4}
                  value={obsImpressao}
                  onChange={(e) => setObsImpressao(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 placeholder-slate-400 outline-none resize-y transition focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase block">
                  Observações Técnicas de Acabamento (Bloco 7)
                </label>
                <textarea
                  placeholder="Laminação, verniz, furos, corte especial, blocagem, ilhós..."
                  rows={4}
                  value={obsAcabamento}
                  onChange={(e) => setObsAcabamento(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 placeholder-slate-400 outline-none resize-y transition focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
                />
              </div>
            </div>
          </div>
          )}

          {/* Conferência saiu das abas de setor: agora é feita de uma vez na aba Revisão. */}

                          {/* ABA REVISÃO — conferência de cada setor + fechamento do pedido */}
                          {abaExpedicao && (
                          <div className="space-y-5">
                            {/* Um bloco por setor: o que cada um entregou e quem conferiu. */}
                            {abasDeSetor.map((aba) => {
                              const conferencia = conferenciaPorSetor[aba.setor] ?? {};
                              const cores = coresDoSetor(aba.setor);
                              return (
                                <div key={aba.setor} className="rounded-3xl border border-[#d7e5e8] bg-white p-7 space-y-5 shadow-sm">
                                  <h3 className="text-sm font-bold uppercase text-[#0b2f4a] dark:text-slate-200 tracking-wider border-b border-slate-100 pb-3 flex items-center gap-2">
                                    Conferência
                                    <span className={`rounded-lg px-2.5 py-1 text-xs font-black tracking-wider ${cores.chip}`}>
                                      {aba.setor}
                                    </span>
                                  </h3>

                                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                                    <div className="space-y-1.5">
                                      <label className="text-xs font-semibold text-slate-500 uppercase">Peso Estimado</label>
                                      <div className="w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600 opacity-80 select-none cursor-not-allowed">
                                        {pesoEstimadoDe(aba.setor)}
                                      </div>
                                    </div>

                                    <div className="space-y-1.5">
                                      <label className="text-xs font-semibold text-slate-500 uppercase">Peso Real (kg)</label>
                                      <input
                                        type="number"
                                        step="0.01"
                                        placeholder="Ex: 12.5"
                                        value={conferencia.peso_real || ""}
                                        onChange={(e) => atualizarConferencia(aba.setor, "peso_real", e.target.value)}
                                        className="w-full rounded-2xl border border-slate-300 bg-transparent px-4 py-3 text-sm outline-none transition-shadow focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
                                      />
                                    </div>

                                    <div className="space-y-1.5">
                                      <label className="text-xs font-semibold text-slate-500 uppercase">Responsável pela conferência</label>
                                      <input
                                        type="text"
                                        placeholder="Quem revisou e conferiu"
                                        value={conferencia.responsavel_conferencia || ""}
                                        onChange={(e) => atualizarConferencia(aba.setor, "responsavel_conferencia", e.target.value)}
                                        className="w-full rounded-2xl border border-slate-300 bg-transparent px-4 py-3 text-sm outline-none transition-shadow focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
                                      />
                                    </div>
                                  </div>
                                </div>
                              );
                            })}

                            {/* Volume e peso são do PEDIDO, não de cada setor: um bloco só. */}
                            <div className="rounded-3xl border border-[#d7e5e8] bg-white p-7 space-y-5 shadow-sm">
                              <h3 className="text-sm font-bold uppercase text-[#0b2f4a] dark:text-slate-200 tracking-wider border-b border-slate-100 pb-3">
                                Volume e peso do pedido #{idIntParam}
                              </h3>

                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5">
                                <div className="space-y-1.5">
                                  <label className="text-xs font-semibold text-slate-500 uppercase">Qtd de Volumes</label>
                                  <input
                                    type="number"
                                    min={1}
                                    placeholder="Ex: 2"
                                    value={revisaoGeral.qtdVolumes}
                                    onChange={(e) => setRevisaoGeral((r) => ({ ...r, qtdVolumes: e.target.value }))}
                                    className="w-full rounded-2xl border border-slate-300 bg-transparent px-4 py-3 text-sm outline-none transition-shadow focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
                                  />
                                </div>

                                <div className="space-y-1.5">
                                  <label className="text-xs font-semibold text-slate-500 uppercase">Tipo de Volume</label>
                                  <select
                                    value={revisaoGeral.tipoVolume}
                                    onChange={(e) => setRevisaoGeral((r) => ({ ...r, tipoVolume: e.target.value }))}
                                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-shadow focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
                                  >
                                    <option value="">Selecione...</option>
                                    <option value="Caixa">Caixa</option>
                                    <option value="Pacote">Pacote</option>
                                    <option value="Envelope">Envelope</option>
                                    <option value="Palete">Palete</option>
                                  </select>
                                </div>

                                <div className="space-y-1.5">
                                  <label className="text-xs font-semibold text-slate-500 uppercase">Peso líquido (soma dos setores)</label>
                                  <div className="w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600 opacity-80 select-none cursor-not-allowed">
                                    {somaPesoDosSetores}
                                  </div>
                                  <p className="text-[11px] text-slate-500">Somado do peso estimado de cada setor.</p>
                                </div>

                                <div className="space-y-1.5">
                                  <label className="text-xs font-semibold text-slate-500 uppercase">Peso bruto total (kg)</label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    placeholder="Com embalagem"
                                    value={revisaoGeral.pesoBruto}
                                    onChange={(e) => setRevisaoGeral((r) => ({ ...r, pesoBruto: e.target.value }))}
                                    className="w-full rounded-2xl border border-slate-300 bg-transparent px-4 py-3 text-sm outline-none transition-shadow focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
                                  />
                                  <p className="text-[11px] text-slate-500">É o peso que vai para a NF-e.</p>
                                </div>
                              </div>

                              {/* Peso por volume só faz sentido a partir do segundo. */}
                              {quantidadeDeVolumes > 1 && (
                                <div className="space-y-3 rounded-2xl bg-slate-50 p-5">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Peso bruto de cada volume (kg)
                                  </p>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                                    {Array.from({ length: quantidadeDeVolumes }, (_, i) => (
                                      <div key={i} className="space-y-1.5">
                                        <label className="text-xs font-semibold text-slate-500">Volume {i + 1}</label>
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={revisaoGeral.pesosVolumes[i] || ""}
                                          onChange={(e) =>
                                            setRevisaoGeral((r) => {
                                              const pesos = [...r.pesosVolumes];
                                              pesos[i] = e.target.value;
                                              return { ...r, pesosVolumes: pesos };
                                            })
                                          }
                                          className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-shadow focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
                                        />
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Fechamento: libera o pedido para a Expedição. */}
                            <div className="rounded-3xl border border-[#d7e5e8] bg-white p-7 space-y-4 shadow-sm">
                              {pendenciasRevisao.length > 0 ? (
                                <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
                                  <p className="font-semibold">Falta conferir antes de liberar:</p>
                                  <ul className="mt-2 space-y-1">
                                    {pendenciasRevisao.map((p) => (
                                      <li key={p.setor} className="text-xs">
                                        <span className="font-bold">{p.setor}</span> — {p.falta}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : (
                                <p className="text-sm text-slate-600">
                                  Tudo conferido. Confirmar a revisão manda o pedido para a Expedição.
                                </p>
                              )}

                              <div className="flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => void handleConfirmarRevisao()}
                                  disabled={pendenciasRevisao.length > 0 || confirmandoRevisao || revisaoLiberada}
                                  className="rounded-2xl bg-[#0b2f4a] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#123f61] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {revisaoLiberada
                                    ? "Liberado — abrindo a Expedição..."
                                    : confirmandoRevisao
                                      ? "Liberando..."
                                      : "Confirmar revisão e liberar para Expedição"}
                                </button>
                              </div>
                            </div>
                          </div>
                          )}
                          
                          {/* Sem bloco de submissão no fim: salvar já existe no
                              cabeçalho e no botão flutuante, ambos type="submit".
                              Um terceiro no rodapé só se sobrepunha ao flutuante. */}
                          <div className="mb-12" />
          </div>
      {selectedGabaritoPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl relative animate-in fade-in-50 zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex justify-between items-start">
              <div>
                <h4 className="text-sm font-black text-[#0b2f4a] dark:text-slate-100 uppercase tracking-wider">
                  Gabarito: {selectedGabaritoPreview.nome}
                </h4>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 font-semibold">
                  {selectedGabaritoPreview.descricao}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedGabaritoPreview(null)}
                className="h-6 w-6 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-450 flex items-center justify-center transition font-bold"
              >
                ×
              </button>
            </div>

            {/* Image Preview Container */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-slate-950 flex items-center justify-center p-2 min-h-48 relative">
              {selectedGabaritoPreview.previewImageUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={selectedGabaritoPreview.previewImageUrl}
                  alt={selectedGabaritoPreview.nome}
                  className="max-h-64 object-contain rounded-lg"
                />
              ) : (
                <div className="text-center text-slate-400 dark:text-slate-655 p-6 flex flex-col items-center">
                  <AlertCircle className="h-8 w-8 mb-2 opacity-60" />
                  <p className="text-xs font-bold text-slate-500">Sem Imagem de Preview</p>
                  <p className="text-[9px] mt-0.5">Nenhum preview visual associado a este gabarito.</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setSelectedGabaritoPreview(null)}
                className="h-8 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-[10px] font-black transition border border-slate-250 dark:border-slate-750"
              >
                Fechar Visualização
              </button>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </form>
  );
}
