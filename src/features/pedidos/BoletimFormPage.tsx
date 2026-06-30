"use client";

import React, { useState, useEffect } from "react";
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
  ExternalLink
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
  parsePedidosObs,
  serializePedidosObs,
  obterGabaritosOperacionais,
  obterFreteEscolhido,
  atualizarModelosBoletim,
  avancarStatusParaEmProducao
} from "./services/boletim-propostas.service";
import { obterPedidoOperacionalPorIdOuIdInt } from "./services/pedidos-detalhe.service";
import { getSupabaseClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/common/PageHeader";

export interface GabaritoItem {
  id: string;
  nome: string;
  descricao: string;
  previewImageUrl: string;
}

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

function canStartProduction(proposal: Proposta): boolean {
  // Abstração operacional de confirmação financeira
  // Futuramente a regra virá de pagamentos_v2 e confirmação financeira real.
  return proposal.cobrancaStatus === "PAGA";
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

  // Block 1 & 2: Main Info & Commercial Briefing State
  const [clienteNome, setClienteNome] = useState("");
  const [contatoNome, setContatoNome] = useState("");
  const [empresa, setEmpresa] = useState("Ideal Grafica");
  const [vendedor, setVendedor] = useState("Everton Farias");
  const [dataPrevistaEntrega, setDataPrevistaEntrega] = useState("");
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

          const deadlineDate = pedido.dataPrevistaEntrega ? pedido.dataPrevistaEntrega.split("T")[0] : "";
          setDataPrevistaEntrega(deadlineDate);

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
            setor: p.setor || "IMPRESSÃO",
            modelos: p.modelos.map((m) => ({
              id: m.id,
              nomeModelo: m.nomeModelo,
              quantidade: m.quantidade,
              statusArte: m.statusArte,
              statusProducao: m.statusProducao,
              setor: m.setor || p.setor || "IMPRESSÃO",
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
          description: "Falha na leitura dos dados do pedido no Supabase."
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
        const { data, error } = await client
          .from("pedidos_artes")
          .select("nome_evento, data_evento")
          .eq("id_int", Number(idIntParam))
          .maybeSingle();
          
        if (!error && data) {
          setDadosEventoNome(data.nome_evento || "Evento não informado");
          setDadosEventoData(data.data_evento || "");
        } else {
          setDadosEventoNome("Evento não informado");
        }
      } catch (err) {
        setDadosEventoNome("Evento não informado");
      }
    }
    
    loadEvento();
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
    observacoes_item?: string;
    modelos: ModeloMock[];
  }

  // Block 3 & 4: Products & Models Hierarchical State
  const [produtos, setProdutos] = useState<FormProduto[]>([
    {
      id: "prod_initial_1",
      nome: "Pulseira Tyvek",
      quantidade: 1000,
      setor: "IMPRESSÃO",
      modelos: [
        {
          id: "mod_initial_1",
          nomeModelo: "Lote Principal",
          quantidade: 1000,
          statusArte: "PENDENTE" as ArteStatus,
          statusProducao: "PENDENTE" as ProducaoStatus,
          setor: "IMPRESSÃO",
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
        
        // Briefing comercial relevante
        setBriefingOperacional(details.observacoes || "");
        
        // Prazo / Data prevista de entrega
        const deadlineDate = parsePrazoToDate(details.resumo?.prazoProducao || "");
        setDataPrevistaEntrega(deadlineDate);
        
        setObsImpressao("");
        setObsAcabamento("");

        // Mapear produtos
        const mapped = details.itens.map((item, index) => {
          let sector = "IMPRESSÃO";
          const nameUpper = item.nome.toUpperCase();
          const catUpper = (item.produto?.categoria || "").toUpperCase();
          
          if (nameUpper.includes("TEX") || catUpper.includes("TEX") || nameUpper.includes("CORDÃO") || nameUpper.includes("FITA") || nameUpper.includes("TECIDO")) {
            sector = "TEXTIL";
          } else if (nameUpper.includes("FLEXO") || catUpper.includes("FLEXO") || nameUpper.includes("RÓTULO") || nameUpper.includes("ETIQUETA")) {
            sector = "FLEXO";
          } else if (nameUpper.includes("PVP") || catUpper.includes("PVP")) {
            sector = "PVP";
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
                setor: p.setor || "IMPRESSÃO", // Inherit product sector
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
        const serializedObs = serializePedidosObs({
          obsCriticas,
          orientacoesDesign: briefingOperacional,
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

        const result = await atualizarOrientacoesBoletim(Number(idIntParam), serializedObs);

        if (!result.success) {
          showToast({
            type: "error",
            title: "Erro ao Atualizar Boletim",
            description: result.error || "Não foi possível atualizar as orientações no Supabase."
          });
          setLoadingDetails(false);
          return;
        }

        // 2. Update Modelos (Lotes Técnicos)
        const modelosUpdates = produtos.flatMap(p => p.modelos.map(m => ({
          id: Number(m.id),
          tipo_numeracao: m.configImpressao.tipoNumeracao || null,
          gabarito_operacional: m.gabaritoNumeracao && m.gabaritoNumeracao !== "Sem gabarito" ? m.gabaritoNumeracao : null,
          numeracao_inicio: m.numeracaoInicial !== undefined && m.numeracaoInicial !== null ? Number(m.numeracaoInicial) : null
        }))).filter(m => !isNaN(m.id) && m.id > 0);

        if (modelosUpdates.length > 0) {
          const modelsResult = await atualizarModelosBoletim(modelosUpdates);
          if (!modelsResult.success) {
             showToast({
              type: "error",
              title: "Erro ao Atualizar Lotes",
              description: modelsResult.error || "Não foi possível atualizar as informações dos lotes operacionais."
            });
            setLoadingDetails(false);
            return;
          }
        }

        // Update macro status if currently REVISAO PRODUCAO
        await avancarStatusParaEmProducao(Number(idIntParam));

        showToast({
          type: "success",
          title: "Boletim Finalizado",
          description: "Orientações e especificações técnicas de design atualizadas com sucesso"
        });

        router.push("/pedidos");
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
        orientacoesDesign: briefingOperacional,
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
        obs: formattedObs
      });

      if (!result.success || !result.id) {
        showToast({
          type: "error",
          title: "Erro ao Salvar Boletim",
          description: result.error || "Não foi possível abrir o pedido no Supabase."
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
          obs_impressao: m.comentarioInterno || null
        }))
      );

      const modelsResult = await salvarModelosBoletim(idInt, result.id, modelosPayload);

      if (!modelsResult.success) {
        showToast({
          type: "error",
          title: "Erro ao Salvar Modelos",
          description: modelsResult.error || "O pedido pai foi criado, mas não foi possível salvar os lotes no Supabase."
        });
        setLoadingDetails(false);
        return;
      }

      // Update macro status if currently REVISAO PRODUCAO
      await avancarStatusParaEmProducao(idInt);

      // 4. Sucesso!
      showToast({
        type: "success",
        title: "Boletim Salvo",
        description: "Novo boletim de entrada gerado com sucesso."
      });

      router.push("/pedidos");

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
      {/* Title Header com PageHeader global */}
      <PageHeader
        title={isEditing ? "Edição de OS — Boletim de Entrada" : "Abertura de OS — Boletim de Entrada"}
        subtitle="Ficha operacional técnica inicial de PCP gráfico e comercial."
        context="Produção / OS"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/pedidos"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 shadow-sm"
            >
              Voltar
            </Link>
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
                        <span className="text-base font-bold text-slate-800 truncate">{dadosEventoNome || "-"}</span>
                      </div>
                      <input type="text" readOnly value={dadosEventoNome} className="opacity-0 absolute inset-0 w-full h-full cursor-not-allowed" />
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-4 p-5 rounded-3xl bg-blue-50/80 border-2 border-blue-100">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-blue-900 uppercase tracking-wider">Data Limite de Entrega *</label>
                    <div className={`relative flex items-center w-full rounded-2xl border-2 h-11 transition focus-within:ring-4 ${isEditing ? "border-blue-200 bg-slate-100/80 cursor-not-allowed" : "border-blue-300 bg-white focus-within:border-blue-600 focus-within:ring-blue-100"}`}>
                      <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                        <span className={`text-xl font-bold font-mono ${isEditing ? "text-slate-800" : "text-blue-950"}`}>
                          {dataPrevistaEntrega ? dataPrevistaEntrega.split('-').reverse().join('/') : "DD/MM/AAAA"}
                        </span>
                      </div>
                      <input
                        type="date"
                        required
                        readOnly={isEditing}
                        disabled={isEditing}
                        value={dataPrevistaEntrega}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDataPrevistaEntrega(e.target.value)}
                        className={`w-full h-full bg-transparent border-none outline-none pl-4 pr-3 text-transparent [&::-webkit-datetime-edit]:text-transparent [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70 [&::-webkit-calendar-picker-indicator]:hover:opacity-100 ${isEditing ? "cursor-not-allowed" : "cursor-pointer"}`}
                      />
                    </div>
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
              </div>
            
            {/* BLOCO 2 — BRIEFING COMERCIAL */}
            <div className="rounded-3xl border border-[#d7e5e8] bg-white p-7 space-y-5 shadow-sm">
              <h3 className="text-sm font-bold uppercase text-[#0b2f4a] dark:text-slate-200 tracking-wider border-b border-slate-100 pb-3 flex items-center gap-1.5">
                BLOCO 2 — Briefing Comercial (Vendas)
              </h3>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-500 uppercase">Briefing Comercial & Instruções de Venda</label>
                <textarea
                  placeholder="Insira as instruções do cliente, recomendações, observações comerciais e restrições operacionais do pedido..."
                  rows={4}
                  value={briefingOperacional}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBriefingOperacional(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm text-slate-700 placeholder-slate-400 outline-none resize-y transition focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
                />
              </div>
            </div>

          {/* BLOCO 3 & 4 — PRODUTOS E MODELOS */}
          <div className="rounded-3xl border border-[#d7e5e8] bg-white p-7 space-y-6 shadow-sm">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold uppercase text-[#0b2f4a] dark:text-slate-200 tracking-wider flex items-center gap-1.5">
                BLOCO 3 & 4 — Produtos & Lotes Técnicos (PCP)
              </h3>
              {/* Produtos são herdados da proposta de origem */}
            </div>

            <div className="space-y-4">
              {produtos.map((p, pIndex) => {
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
                                <span className="text-sm font-bold text-slate-800 truncate">{p.setor || "IMPRESSÃO"}</span>
                              </div>
                            )}
                            <select
                              disabled={isEditing}
                              value={p.setor || "IMPRESSÃO"}
                              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateProductSector(p.id, e.target.value)}
                              className={`w-full rounded-xl border border-slate-200 text-xs px-3.5 py-1.5 font-bold outline-none transition focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6] ${isEditing ? "opacity-0 cursor-not-allowed" : "bg-white text-slate-700 cursor-pointer"}`}
                            >
                              <option value="IMPRESSÃO">IMPRESSÃO</option>
                              <option value="TEXTIL">TEXTIL</option>
                              <option value="PVP">PVP</option>
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
                                  {p.setor || "IMPRESSÃO"}
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

                            {/* Linha 2: Checkboxes Frente/Verso, RFID e Numeração */}
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
                              </div>
                            </div>
                            
                            {/* Linha 3: Gabarito e Faixas / CSV */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                              {/* Gabarito Combobox */}
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
                                            descricao: "Gabarito carregado dinamicamente do banco de dados.",
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

                              {/* Faixas de Numeração ou CSV */}
                              <div className="space-y-1.5">
                                {m.configImpressao.tipoNumeracao === "SEQUENCIAL" ? (
                                  <div>
                                    <label className="text-xs font-semibold text-slate-500 uppercase block mb-1">Faixa Numérica (Início / Fim)</label>
                                    <div className="flex gap-2 w-full">
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
          </div>

          {/* CONFIGURAÇÕES TÉCNICAS POR SETOR PCP (BLOCOS 6 & 7 SIMPLIFICADOS) */}
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

          {/* BLOCO 8 — REVISÃO / LOGÍSTICA */}
                          <div className="rounded-3xl border border-[#d7e5e8] bg-white p-7 space-y-5 shadow-sm">
                            <h3 className="text-sm font-bold uppercase text-[#0b2f4a] dark:text-slate-200 tracking-wider border-b border-slate-100 pb-3">
                              BLOCO 8 — Revisão / Logística
                            </h3>
                            
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5">
                              {/* Linha 1 */}
                              <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Serviço / Transporte</label>
                                <input
                                  type="text"
                                  placeholder="Ex: Sedex, Azul..."
                                  value={logisticaServico}
                                  onChange={(e) => setLogisticaServico(e.target.value)}
                                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
                                />
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Transportador</label>
                                <input
                                  type="text"
                                  placeholder="Nome da transportadora"
                                  value={logisticaTransportador}
                                  onChange={(e) => setLogisticaTransportador(e.target.value)}
                                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 placeholder-slate-400 outline-none transition focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
                                />
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Prazo (Dias)</label>
                                <div className="w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600 opacity-80 select-none cursor-not-allowed">
                                  {cotacaoFrete?.prazo ? `${cotacaoFrete.prazo} dias` : "Não confirmado"}
                                </div>
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-500 uppercase">CEP Destino</label>
                                <div className="w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600 opacity-80 select-none cursor-not-allowed">
                                  {cotacaoFrete?.cep || "Não confirmado"}
                                </div>
                              </div>

                              {/* Linha 2 */}
                              <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Peso Estimado</label>
                                <div className="w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600 opacity-80 select-none cursor-not-allowed">
                                  {cotacaoFrete?.peso ? `${(Number(cotacaoFrete.peso) / 1000).toFixed(2)} kg` : "Não confirmado"}
                                </div>
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Peso Real (kg)</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  placeholder="Ex: 12.5"
                                  value={logisticaPesoReal}
                                  onChange={(e) => setLogisticaPesoReal(e.target.value)}
                                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
                                />
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Qtd de Volumes</label>
                                <input
                                  type="number"
                                  placeholder="Ex: 2"
                                  value={logisticaQtdVolumes}
                                  onChange={(e) => setLogisticaQtdVolumes(e.target.value)}
                                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
                                />
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Tipo de volume</label>
                                <select
                                  value={logisticaTipoVolume}
                                  onChange={(e) => setLogisticaTipoVolume(e.target.value)}
                                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
                                >
                                  <option value="">Selecione...</option>
                                  <option value="Pacote">Pacote</option>
                                  <option value="Caixa">Caixa</option>
                                  <option value="Envelope">Envelope</option>
                                  <option value="Outro">Outro</option>
                                </select>
                              </div>

                              {/* Linha 3 */}
                              <div className="space-y-1.5 md:col-span-2">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Responsável</label>
                                <input
                                  type="text"
                                  placeholder="Nome do responsável pelo pacote"
                                  value={logisticaResponsavel}
                                  onChange={(e) => setLogisticaResponsavel(e.target.value)}
                                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
                                />
                              </div>

                              <div className="space-y-1.5 md:col-span-2">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Observações do frete</label>
                                <textarea
                                  placeholder="Observações logísticas, restrições, horários..."
                                  rows={1}
                                  value={logisticaObsFrete}
                                  onChange={(e) => setLogisticaObsFrete(e.target.value)}
                                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 placeholder-slate-400 outline-none transition focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6] resize-y"
                                />
                              </div>

                              <div className="space-y-1.5 md:col-span-4 border-t border-slate-100 pt-5 mt-2">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Observações Gerais (OS)</label>
                                <textarea
                                  placeholder="Observações gerais operacionais, avisos importantes e restrições..."
                                  rows={3}
                                  value={obsCriticas}
                                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setObsCriticas(e.target.value)}
                                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 placeholder-slate-400 outline-none transition focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6] resize-y"
                                />
                              </div>
                            </div>
                          </div>
                          
                          {/* BLOCO DE RESUMO FINAL E SUBMISSÃO */}
                          <div className="rounded-3xl border border-[#d7e5e8] bg-white p-7 flex flex-col sm:flex-row sm:items-center justify-end gap-4 shadow-sm mb-12">

                            <div className="flex items-center gap-3">
                              <button
                                type="submit"
                                className="rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3.5 text-sm font-bold tracking-wider shadow transition flex items-center justify-center gap-1.5"
                              >
                                <Save className="h-4 w-4" />
                                <span>{isEditing ? "Salvar Alterações" : "Salvar e Iniciar OS"}</span>
                              </button>
                            </div>
                          </div>
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
