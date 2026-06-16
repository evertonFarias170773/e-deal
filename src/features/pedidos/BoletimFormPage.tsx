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
  ChevronDown
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
  listarDesigners,
  listarGabaritos,
  type PropostaLiberadaBoletim,
  type DesignerUsuario,
  type GabaritoProducao,
  atualizarOrientacoesBoletim,
  parsePedidosObs,
  serializePedidosObs
} from "./services/boletim-propostas.service";
import { obterPedidoOperacionalPorIdOuIdInt } from "./services/pedidos-detalhe.service";

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
  const [instrucoesDesign, setInstrucoesDesign] = useState("");
  const [transporte, setTransporte] = useState("Retirada");
  const [volumes, setVolumes] = useState(1);

  // New design assignment, attachments & structured finishing states
  const [selectedDesigner, setSelectedDesigner] = useState("");
  const [attachments, setAttachments] = useState<{ url: string; name: string; type: string }[]>([]);
  const [atribuidoDesigner, setAtribuidoDesigner] = useState(false);
  const [dataHoraAtribuicao, setDataHoraAtribuicao] = useState("");
  const [isMounted, setIsMounted] = useState(false);
  const [openGabaritoDropdown, setOpenGabaritoDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const [gabaritoSearchQuery, setGabaritoSearchQuery] = useState("");
  const [selectedGabaritoPreview, setSelectedGabaritoPreview] = useState<GabaritoItem | null>(null);

  const [obsImpressao, setObsImpressao] = useState("");
  const [obsAcabamento, setObsAcabamento] = useState("");
  const [designersList, setDesignersList] = useState<DesignerUsuario[]>([]);
  const [gabaritosList, setGabaritosList] = useState<GabaritoProducao[]>([]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    async function loadData() {
      try {
        const [designersData, gabaritosData] = await Promise.all([
          listarDesigners(),
          listarGabaritos()
        ]);
        setDesignersList(designersData);
        
        if (gabaritosData && gabaritosData.length > 0) {
          setGabaritosList(gabaritosData);
        } else {
          setGabaritosList(MOCK_GABARITOS.map(g => ({
            id: g.id,
            id_gabarito: null,
            name: g.nome
          })));
        }
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

          const deadlineDate = pedido.dataPrevistaEntrega ? pedido.dataPrevistaEntrega.split("T")[0] : "";
          setDataPrevistaEntrega(deadlineDate);

          const parsed = parsePedidosObs(pedido.obs);
          setObsCriticas(parsed.obsCriticas || "");
          setInstrucoesDesign(parsed.orientacoesDesign || "");
          setObsImpressao(parsed.obsImpressao || "");
          setObsAcabamento(parsed.obsAcabamento || "");

          if (parsed.designer && parsed.designer.user_id) {
            setSelectedDesigner(parsed.designer.user_id);
            setAtribuidoDesigner(true);
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
              configImpressao: {
                tipoNumeracao: m.configImpressao?.tipoNumeracao || "SEM_NUMERACAO",
                qrCode: m.configImpressao?.qrCode || false,
                codBarras: m.configImpressao?.codBarras || false,
                codBarrasTipo: m.configImpressao?.codBarrasTipo || ""
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
  }, [isEditing, idIntParam, designersList, hasLoadedExisting]);

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

  const filteredGabaritos = gabaritosList.filter(g =>
    g.name.toLowerCase().includes(gabaritoSearchQuery.toLowerCase())
  );

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



  // Helper to compute active count per designer
  const getDesignerActiveCount = (designerId: string) => {
    if (!pedidos) return 0;
    const designerName = designersList.find(d => d.user_id === designerId)?.nome_usuario || designerId;
    let count = 0;
    pedidos.forEach((p) => {
      if (p.statusPedido !== "EXPEDIDO" && p.statusPedido !== "CANCELADO") {
        p.produtos?.forEach((prod) => {
          prod.modelos?.forEach((m) => {
            if ((m.designerResponsavel === designerId || m.designerResponsavel === designerName) && m.statusArte !== "LIBERADA" && m.statusArte !== "IMPRESSA" && m.statusArte !== "NAO_NECESSARIA") {
              count++;
            }
          });
        });
      }
    });
    return count;
  };

  const getGabaritoName = (val?: string) => {
    if (!val) return "Selecione ou pesquise...";
    const found = gabaritosList.find(g => String(g.id_gabarito || g.id) === val || g.name === val);
    if (found) return found.name;
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
    nome: string;
    quantidade: number;
    quantidadeOriginal?: number;
    setor: string;
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
        setSelectedProposta(details);
        setAtribuidoDesigner(false);
        setDataHoraAtribuicao("");
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
            nome: item.nome,
            quantidade: item.quantidade,
            quantidadeOriginal: item.quantidade, // Store fixed original total
            setor: sector,
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
                observacoesTecnicas: item.descricaoModelo || "",
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
    setAtribuidoDesigner(false);
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
    setAtribuidoDesigner(false);
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
  
  const handleAtribuirDesigner = () => {
    if (!selectedDesigner) return;

    setProdutos((prev) =>
      prev.map((p) => ({
        ...p,
        modelos: p.modelos.map((m) => ({
          ...m,
          designerResponsavel: selectedDesigner,
          statusArte: "DESIGN_ATRIBUIDO" as ArteStatus
        }))
      }))
    );

    setAtribuidoDesigner(true);
    const now = new Date();
    const formattedDate = now.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
    setDataHoraAtribuicao(formattedDate);

    const designerName = designersList.find(d => d.user_id === selectedDesigner)?.nome_usuario || selectedDesigner;
    showToast({
      type: "success",
      title: "Designer Atribuído",
      description: `Arte destinada para ${designerName} com sucesso.`
    });
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

    if (!selectedDesigner) {
      showToast({ type: "error", title: "Designer Não Selecionado", description: "Por favor, atribua um designer responsável no Bloco 5." });
      return;
    }

    if (isEditing) {
      setLoadingDetails(true);
      try {
        const designerObj = designersList.find(d => d.user_id === selectedDesigner);
        const designerInput = designerObj ? {
          user_id: designerObj.user_id,
          nome: designerObj.nome_usuario || designerObj.user_id,
          email: designerObj.email || ""
        } : null;

        const serializedObs = serializePedidosObs({
          obsCriticas,
          designer: designerInput,
          orientacoesDesign: instrucoesDesign,
          obsImpressao,
          obsAcabamento
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

        showToast({
          type: "success",
          title: "Boletim Finalizado",
          description: "Orientações e especificações técnicas de design atualizadas com sucesso"
        });

        router.push(`/pedidos/${idIntParam}`);
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

      const formattedObs = `[Observações críticas]\n${obsCriticas.trim() || "-"}\n\n[Impressão]\n${obsImpressao.trim() || "-"}\n\n[Acabamento]\n${obsAcabamento.trim() || "-"}`;

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
          numeracao_inicio: m.numeracaoInicial !== undefined ? Number(m.numeracaoInicial) : null,
          numeracao_fim: m.numeracaoFinal !== undefined ? Number(m.numeracaoFinal) : null,
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

      // 4. Sucesso!
      showToast({
        type: "success",
        title: "Boletim Salvo",
        description: "Boletim salvo e pedido aberto com sucesso"
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
    <form onSubmit={handleSubmit} className="space-y-5 text-xs text-slate-800 dark:text-slate-250 font-sans pb-12">
      {/* Title Header */}
      <div className="flex justify-between items-center border-b border-slate-200/50 dark:border-slate-800/40 pb-3">
        <div className="flex items-center gap-2">
          <Link
            href={isEditing ? `/pedidos/${idIntParam}` : "/pedidos"}
            className="h-8 w-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-850 flex items-center justify-center transition shrink-0"
            title="Voltar"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h2 className="text-base font-black text-[#0b2f4a] dark:text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
              <FileText className="h-4 w-4" />
              <span>{isEditing ? "Edição de OS — Boletim de Entrada" : "Abertura de OS — Boletim de Entrada"}</span>
            </h2>
            <p className="text-[10px] text-slate-550 dark:text-slate-500 font-semibold">
              Ficha operacional técnica inicial de PCP gráfico e comercial.
            </p>
          </div>
        </div>

        {selectedProposta && (
          <button
            type="submit"
            className="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold flex items-center gap-1.5 shadow-sm transition"
          >
            <Save className="h-4 w-4" />
            <span>{isEditing ? "Salvar Alterações" : "Salvar Boletim"}</span>
          </button>
        )}
      </div>

      {isEditing && (
        <div className="bg-blue-50 dark:bg-blue-955/20 border border-blue-200 dark:border-blue-900/50 p-4 rounded-xl flex items-start gap-3 shadow-sm">
          <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse"></div>
            <div>
              <strong className="text-blue-700 dark:text-blue-400 font-black uppercase text-[10px] tracking-wide block">Modo Edição de OS</strong>
              <p className="text-[10px] text-slate-550 dark:text-slate-400 font-semibold mt-0.5">
                Os dados de faturamento, cliente, quantidades e especificações técnicas de lotes estão bloqueados por segurança. Apenas designer, orientações, observações críticas e briefings técnicos de produção estão liberados.
              </p>
            </div>
          </div>
        </div>
      )}

            {isEditing ? (
        <div className="bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 p-4 rounded-xl space-y-2 shadow-sm">
          <h3 className="text-xs font-black uppercase text-slate-800 dark:text-slate-200 tracking-wider">
            1. Proposta/Orçamento Comercial de Origem
          </h3>
          <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
            Você está editando as orientações técnicas do pedido operacional correspondente à proposta <span className="font-mono text-blue-600 dark:text-blue-400 font-black">#{idIntParam}</span>. A proposta de origem e o faturamento estão vinculados de forma definitiva.
          </div>
        </div>
      ) : (
        <div className="bg-slate-50/80 dark:bg-slate-900/40 border border-slate-300 dark:border-slate-800 p-4 rounded-xl space-y-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-black uppercase text-slate-800 dark:text-slate-200 tracking-wider">
              1. Seleção da Proposta/Orçamento Comercial de Origem
            </h3>
            <p className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5 font-medium">
              Busque ou selecione um orçamento para carregar os dados operacionais da OS.
            </p>
          </div>
          {loadingPropostas && (
            <span className="text-[10px] font-bold text-slate-400 animate-pulse">Carregando propostas...</span>
          )}
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1 relative">
            <label className="text-[10px] font-extrabold text-slate-700 dark:text-slate-300 uppercase">Buscar Proposta (Digite o Número ou Cliente)</label>
            <input
              type="text"
              placeholder="Digite o número da proposta (ex: 16821)..."
              value={propostaBusca}
              onChange={handlePropostaChange}
              onKeyDown={handlePropostaKeyDown}
              list="propostas-datalist"
              className="w-full h-8.5 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-bold focus:outline-none text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:border-blue-600 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-600 dark:focus:ring-blue-400"
            />
            <datalist id="propostas-datalist">
              {propostas.map((p) => (
                <option key={p.id_int} value={p.id_int}>
                  {`#${p.id_int} - ${p.clienteNome} (Vendedor: ${p.vendedor})`}
                </option>
              ))}
            </datalist>
            {searchFeedback && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold mt-1">
                {searchFeedback}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-extrabold text-slate-700 dark:text-slate-300 uppercase block">Propostas Recentes</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {recentes.slice(0, 5).map((p) => (
                <button
                  key={p.id_int}
                  type="button"
                  onClick={() => {
                     setPropostaBusca(String(p.id_int));
                     selectProposta(p.id_int);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-mono font-bold transition flex items-center gap-1 ${
                    selectedProposta?.id_int === p.id_int
                      ? "bg-[#0b2f4a] border-[#0b2f4a] text-white font-extrabold"
                      : "bg-white hover:bg-slate-100 border-slate-300 text-slate-700 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
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
        <div className="bg-slate-50/20 dark:bg-slate-955/5 border border-dashed border-slate-200 dark:border-slate-800 p-12 text-center rounded-xl space-y-2">
          <FileText className="h-10 w-10 text-slate-350 dark:text-slate-650 mx-auto" />
          <h4 className="font-extrabold text-sm text-slate-600 dark:text-slate-450 uppercase">Aguardando Seleção de Origem</h4>
          <p className="text-[11px] text-slate-500 max-w-md mx-auto leading-relaxed">
            Selecione uma proposta comercial ativa usando o campo de busca ou clique em uma das propostas recentes para carregar os dados de manufatura e abrir a Ficha Técnica.
          </p>
        </div>
      ) : (
        <>
          {/* HEADER DE STATUS OPERACIONAL */}
          <div className="bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 p-4 rounded-xl grid grid-cols-2 md:grid-cols-4 gap-4 text-xs shadow-sm">
            <div>
              <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase block">Proposta de Origem</span>
              <strong className="text-sm font-mono text-[#0b2f4a] dark:text-slate-100">#{selectedProposta.id_int}</strong>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase block">Cliente</span>
              <strong className="text-sm text-slate-800 dark:text-slate-200 truncate block">{clienteNome}</strong>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase block">Status Comercial / Financeiro</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 font-bold uppercase text-[9px] border border-blue-200 dark:border-blue-900/40">
                  {selectedProposta.status}
                </span>
                <span className={`px-1.5 py-0.5 rounded font-bold uppercase text-[9px] border ${
                  canStartProd 
                    ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/40"
                    : "bg-amber-50 text-amber-800 border-amber-250 dark:bg-amber-955/40 dark:text-amber-300 dark:border-amber-900/40 animate-pulse"
                }`}>
                  {canStartProd ? "Pago (Liberado)" : "Pagamento Pendente"}
                </span>
              </div>
            </div>

            <div>
              <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase block">Status Operacional OS</span>
              <strong className="text-xs text-slate-800 dark:text-slate-350 flex items-center gap-1.5 mt-0.5">
                <span className="h-2 w-2 rounded-full bg-blue-500 animate-ping"></span>
                <span className="font-extrabold">ARTE EM ANDAMENTO</span>
              </strong>
            </div>
          </div>
 
          {/* ALERTA DE BLOQUEIO FINANCEIRO */}
          {!canStartProd && (
            <div className="bg-amber-50/70 dark:bg-amber-955/10 border border-amber-300 dark:border-amber-900 text-amber-900 dark:text-amber-300 p-3.5 rounded-xl text-xs flex items-center gap-2 font-medium">
              <AlertCircle className="h-4.5 w-4.5 text-amber-600 shrink-0" />
              <div>
                <strong className="font-black">Produção bloqueada até confirmação financeira.</strong> O setor de Arte poderá trabalhar no layout das artes e na aprovação digital, mas o início físico (Impressão, Acabamento e Expedição) ficará suspenso no chão de fábrica.
              </div>
            </div>
          )}

          {loadingDetails && (
            <div className="text-center py-4 text-xs font-bold text-slate-600 dark:text-slate-400 animate-pulse">Carregando detalhes operacionais da proposta...</div>
          )}

          <div className="space-y-4">
              
              {/* BLOCO 1 — DADOS PRINCIPAIS */}
              <div className="bg-slate-50/80 dark:bg-slate-900/40 border border-slate-300 dark:border-slate-800 p-4 rounded-xl space-y-3 shadow-sm">
                <h3 className="text-xs font-black uppercase text-[#0b2f4a] dark:text-slate-200 tracking-wider border-b border-slate-300 dark:border-slate-700 pb-1 flex items-center gap-1.5">
                  BLOCO 1 — Identificação Comercial
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold text-slate-700 dark:text-slate-300 uppercase">Cliente</label>
                    <input
                      type="text"
                      readOnly
                      value={clienteNome}
                      className="w-full h-8.5 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 cursor-not-allowed font-bold text-slate-800 dark:text-slate-200"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold text-slate-700 dark:text-slate-300 uppercase">Contato</label>
                    <input
                      type="text"
                      readOnly
                      value={contatoNome}
                      className="w-full h-8.5 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 cursor-not-allowed font-bold text-slate-800 dark:text-slate-200"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold text-slate-700 dark:text-slate-300 uppercase">Empresa Industrial</label>
                    <input
                      type="text"
                      readOnly
                      value={empresa}
                      className="w-full h-8.5 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 cursor-not-allowed font-bold text-slate-800 dark:text-slate-200"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold text-slate-700 dark:text-slate-300 uppercase">Vendedor</label>
                    <input
                      type="text"
                      readOnly
                      value={vendedor}
                      className="w-full h-8.5 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 cursor-not-allowed font-bold text-slate-800 dark:text-slate-200"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold text-slate-700 dark:text-slate-300 uppercase">Data Limite de Entrega *</label>
                    <input
                      type="date"
                      required
                      readOnly={isEditing}
                      disabled={isEditing}
                      value={dataPrevistaEntrega}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDataPrevistaEntrega(e.target.value)}
                      className={`w-full h-8.5 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 focus:outline-none font-mono font-bold focus:border-blue-600 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-600 dark:focus:ring-blue-400 ${isEditing ? "bg-slate-100 dark:bg-slate-900 cursor-not-allowed text-slate-500 dark:text-slate-400" : "bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"}`}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold text-slate-700 dark:text-slate-300 uppercase">Pagamento</label>
                    <input
                      type="text"
                      readOnly
                      value={formaPagamento}
                      className="w-full h-8.5 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 cursor-not-allowed font-bold text-slate-800 dark:text-slate-200"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-5">
                    <input
                      type="checkbox"
                      id="urgente-toggle"
                      disabled={isEditing}
                      checked={urgente}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrgente(e.target.checked)}
                      className={`h-4.5 w-4.5 text-red-600 focus:ring-red-500 border-slate-400 dark:border-slate-700 rounded bg-white dark:bg-slate-950 ${isEditing ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                    />
                    <label htmlFor="urgente-toggle" className="text-[10px] font-black text-red-600 dark:text-red-400 uppercase tracking-wide cursor-pointer select-none">
                      ⚡ PRIORIDADE URGENTE
                    </label>
                  </div>
                </div>
              </div>
            
            {/* Event Details subgroup */}
            <div className="pt-2">
              <label className="text-[10px] font-extrabold text-slate-700 dark:text-slate-300 uppercase block mb-1">Subgrupo: Informações do Evento (Opcional)</label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 bg-white dark:bg-slate-950 p-2.5 rounded-lg border border-slate-300 dark:border-slate-800">
                <div className="space-y-1">
                  <span className="text-[9px] font-extrabold text-slate-600 dark:text-slate-400 uppercase">Nome do Evento</span>
                  <input
                    type="text"
                    placeholder="Ex: Congresso Nacional 2026"
                    readOnly={isEditing}
                    disabled={isEditing}
                    value={dadosEventoNome}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDadosEventoNome(e.target.value)}
                    className={`w-full h-7 px-2 rounded border border-slate-300 dark:border-slate-700 focus:outline-none font-medium ${isEditing ? "bg-slate-100 dark:bg-slate-900 cursor-not-allowed text-slate-500" : "bg-slate-50/30 dark:bg-slate-955 text-slate-900 dark:text-slate-100"}`.replace("dark:bg-slate-955", "dark:bg-slate-950")}
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] font-extrabold text-slate-600 dark:text-slate-400 uppercase">Data Evento</span>
                  <input
                    type="date"
                    readOnly={isEditing}
                    disabled={isEditing}
                    value={dadosEventoData}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDadosEventoData(e.target.value)}
                    className={`w-full h-7 px-2 rounded border border-slate-300 dark:border-slate-700 focus:outline-none font-medium ${isEditing ? "bg-slate-100 dark:bg-slate-900 cursor-not-allowed text-slate-500" : "bg-slate-50/30 dark:bg-slate-955 text-slate-900 dark:text-slate-100"}`}
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] font-extrabold text-slate-600 dark:text-slate-400 uppercase">Local</span>
                  <input
                    type="text"
                    placeholder="Ex: Expocentro, SP"
                    readOnly={isEditing}
                    disabled={isEditing}
                    value={dadosEventoLocal}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDadosEventoLocal(e.target.value)}
                    className={`w-full h-7 px-2 rounded border border-slate-300 dark:border-slate-700 focus:outline-none font-medium ${isEditing ? "bg-slate-100 dark:bg-slate-900 cursor-not-allowed text-slate-500" : "bg-slate-50/30 dark:bg-slate-955 text-slate-900 dark:text-slate-100"}`.replace("dark:bg-slate-955", "dark:bg-slate-950")}
                  />
                </div>
              </div>
            </div>

            {/* BLOCO 2 — BRIEFING COMERCIAL */}
            <div className="bg-slate-50/80 dark:bg-slate-900/40 border border-slate-300 dark:border-slate-800 p-4 rounded-xl space-y-3 shadow-sm">
              <h3 className="text-xs font-black uppercase text-[#0b2f4a] dark:text-slate-200 tracking-wider border-b border-slate-300 dark:border-slate-700 pb-1 flex items-center gap-1.5">
                BLOCO 2 — Briefing Comercial (Vendas)
              </h3>
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-slate-700 dark:text-slate-300 uppercase">Briefing Comercial & Instruções de Venda</label>
                <textarea
                  placeholder="Insira as instruções do cliente, recomendações, observações comerciais e restrições operacionais do pedido..."
                  rows={4}
                  value={briefingOperacional}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBriefingOperacional(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 resize-y focus:outline-none text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-550"
                />
              </div>
            </div>

          {/* BLOCO 3 & 4 — PRODUTOS E MODELOS */}
          <div className="bg-slate-50/80 dark:bg-slate-900/40 border border-slate-300 dark:border-slate-800 p-4 rounded-xl space-y-3 shadow-sm">
            <div className="flex justify-between items-center border-b border-slate-300 dark:border-slate-700 pb-1">
              <h3 className="text-xs font-black uppercase text-[#0b2f4a] dark:text-slate-200 tracking-wider flex items-center gap-1.5">
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
                    className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-3 space-y-3 shadow-xs relative"
                  >
                    {/* Product row details */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-850/40 pb-2">
                      <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-center gap-2">
                          <Boxes className="h-4.5 w-4.5 text-[#0b2f4a] dark:text-blue-450" />
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold uppercase text-[10px] text-slate-400">Produto {pIndex + 1}:</span>
                            <span className="font-extrabold text-sm text-[#0b2f4a] dark:text-slate-100 uppercase">{p.nome}</span>
                            <span className="ml-2 bg-slate-100 dark:bg-slate-800 text-slate-650 dark:text-slate-400 text-[10px] px-2 py-0.5 rounded font-mono font-bold">
                              Qtd Proposta: {maxQty.toLocaleString("pt-BR")} un
                            </span>
                          </div>
                        </div>

                        {/* Setor PCP selection */}
                        <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-850 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800">
                          <span className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tight">Setor PCP:</span>
                          <select
                            disabled={isEditing}
                            value={p.setor || "IMPRESSÃO"}
                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateProductSector(p.id, e.target.value)}
                            className={`h-6 px-1.5 rounded border border-slate-350 dark:border-slate-700 font-bold focus:outline-none text-[10px] text-slate-900 dark:text-slate-100 ${isEditing ? "bg-slate-100 dark:bg-slate-900 cursor-not-allowed" : "bg-white dark:bg-slate-900 cursor-pointer"}`}
                          >
                            <option value="IMPRESSÃO">IMPRESSÃO</option>
                            <option value="TEXTIL">TEXTIL</option>
                            <option value="PVP">PVP</option>
                            <option value="FLEXO">FLEXO</option>
                          </select>
                        </div>
                      </div>

                      {/* Produtos e quantidades totais são fixos por contrato */}
                    </div>

                  {/* Models list nested */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[9px] font-bold text-slate-455 uppercase tracking-tight">Especificação dos Modelos (Subitens)</span>
                      {!isEditing && (
                        <button
                          type="button"
                          onClick={() => addModelRow(p.id)}
                          className="h-5.5 px-2 text-slate-700 hover:bg-slate-50 dark:text-slate-350 dark:hover:bg-slate-850 border border-slate-205 dark:border-slate-800 rounded-md font-bold flex items-center gap-0.5 transition"
                        >
                          <Plus className="h-3 w-3" />
                          <span>Adicionar Lote</span>
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      {p.modelos.map((m) => {
                        const validation = getRowValidationError(p, m);
                        return (
                          <div 
                            key={m.id} 
                            className="border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/30 p-4 space-y-3 relative shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition"
                          >
                            {/* Header do Card (Título do Lote + Botão Deletar) */}
                            <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-800 pb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-black uppercase text-[#0b2f4a] dark:text-slate-350 tracking-wider">
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
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <div className="space-y-1">
                                <label className="text-[8px] font-extrabold text-slate-500 dark:text-slate-450 uppercase block">Nome do Lote *</label>
                                <input
                                  type="text"
                                  placeholder="Ex: Lote VIP"
                                  required
                                  readOnly={isEditing}
                                  disabled={isEditing}
                                  value={m.nomeModelo}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateModelField(p.id, m.id, "nomeModelo", e.target.value)}
                                  className={`w-full h-8 px-2 rounded-lg border border-slate-300 dark:border-slate-700 font-bold focus:outline-none text-[10px] placeholder-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 ${isEditing ? "bg-slate-100 dark:bg-slate-900 cursor-not-allowed text-slate-500" : "bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"}`}
                                />
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

                              <div className="space-y-1">
                                <label className="text-[8px] font-extrabold text-slate-500 dark:text-slate-455 uppercase block">Cor / Material</label>
                                <select
                                  disabled={isEditing}
                                  value={m.corMaterial || "Branco"}
                                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateModelField(p.id, m.id, "corMaterial", e.target.value)}
                                  className={`w-full h-8 px-2 rounded-lg border border-slate-300 dark:border-slate-700 font-bold focus:outline-none text-[10px] text-slate-900 dark:text-slate-100 ${isEditing ? "bg-slate-100 dark:bg-slate-900 cursor-not-allowed" : "bg-white dark:bg-slate-955"}`}
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

                              <div className="space-y-1">
                                <label className="text-[8px] font-extrabold text-slate-500 dark:text-slate-450 uppercase block">Quantidade *</label>
                                <input
                                  type="number"
                                  min={1}
                                  required
                                  readOnly={isEditing}
                                  disabled={isEditing}
                                  value={m.quantidade}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateModelField(p.id, m.id, "quantidade", Number(e.target.value) || 0)}
                                  className={`w-full h-8 px-2 rounded-lg border border-slate-300 dark:border-slate-700 text-right font-mono font-bold focus:outline-none text-[10px] ${isEditing ? "bg-slate-100 dark:bg-slate-900 cursor-not-allowed text-slate-500" : "bg-white dark:bg-slate-955 text-slate-900 dark:text-slate-100"}`.replace("dark:bg-slate-955", "dark:bg-slate-950")}
                                />
                              </div>
                            </div>

                            {/* Linha 2: Checkboxes Frente/Verso, RFID e Numeração */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                              <div className="flex items-center gap-3 bg-white dark:bg-slate-950 p-2 rounded-lg border border-slate-200 dark:border-slate-800">
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="checkbox"
                                    id={`verso-${m.id}`}
                                    disabled={isEditing}
                                    checked={m.verso}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateModelField(p.id, m.id, "verso", e.target.checked)}
                                    className={`h-4 w-4 rounded border-slate-450 dark:border-slate-700 text-purple-600 focus:ring-purple-500 ${isEditing ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                                  />
                                  <label htmlFor={`verso-${m.id}`} className="text-[9px] font-extrabold text-slate-600 dark:text-slate-450 uppercase cursor-pointer select-none">
                                    Frente + Verso (F+V)
                                  </label>
                                </div>
                              </div>

                              <div className="flex items-center gap-3 bg-white dark:bg-slate-955 p-2 rounded-lg border border-slate-200 dark:border-slate-800">
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="checkbox"
                                    id={`rfid-${m.id}`}
                                    disabled={isEditing}
                                    checked={m.observacoesTecnicas?.includes("RFID: Sim")}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                      const isRfid = e.target.checked;
                                      const baseNotes = m.observacoesTecnicas?.replace("RFID: Sim.", "").replace("RFID: Não.", "").trim() || "";
                                      updateModelField(
                                        p.id, 
                                        m.id, 
                                        "observacoesTecnicas", 
                                        isRfid ? (baseNotes ? `${baseNotes} RFID: Sim.` : "RFID: Sim.") : (baseNotes ? `${baseNotes} RFID: Não.` : "RFID: Não.")
                                      );
                                    }}
                                    className={`h-4 w-4 rounded border-slate-400 dark:border-slate-700 text-blue-600 focus:ring-blue-500 ${isEditing ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                                  />
                                  <label htmlFor={`rfid-${m.id}`} className="text-[9px] font-extrabold text-slate-600 dark:text-slate-450 uppercase cursor-pointer select-none">
                                    RFID / NFC Integrado
                                  </label>
                                </div>
                              </div>

                              <div className="space-y-1">
                                <label className="text-[8px] font-extrabold text-slate-500 dark:text-slate-450 uppercase block">Tipo de Numeração</label>
                                <select
                                  disabled={isEditing}
                                  value={m.configImpressao.tipoNumeracao}
                                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateModelConfigField(p.id, m.id, "tipoNumeracao", e.target.value)}
                                  className={`w-full h-8 px-2 rounded-lg border border-slate-300 dark:border-slate-700 focus:outline-none text-[10px] font-bold text-slate-900 dark:text-slate-100 ${isEditing ? "bg-slate-100 dark:bg-slate-900 cursor-not-allowed" : "bg-white dark:bg-slate-955"}`.replace("dark:bg-slate-955", "dark:bg-slate-950")}
                                >
                                  <option value="SEM_NUMERACAO">Sem Numeração</option>
                                  <option value="SEQUENCIAL">Sequencial</option>
                                  <option value="CUSTOMIZADA">Customizada (CSV)</option>
                                </select>
                              </div>
                            </div>

                            {/* Linha 3: Gabarito e Faixas / CSV */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                              {/* Gabarito Combobox */}
                              <div className="space-y-1 relative">
                                <label className="text-[8px] font-extrabold text-slate-550 dark:text-slate-450 uppercase block">Gabarito Operacional</label>
                                <div className="flex items-center gap-1">
                                  <div className="relative flex-1">
                                    <button
                                      type="button"
                                      disabled={isEditing}
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
                                      className={`w-full h-8 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 focus:outline-none text-[10px] font-bold text-slate-900 dark:text-slate-100 flex items-center justify-between gap-1 shadow-sm hover:border-slate-450 dark:hover:border-slate-650 transition ${isEditing ? "bg-slate-100 dark:bg-slate-900 cursor-not-allowed" : "bg-white dark:bg-slate-950"}`}
                                    >
                                      <span className="truncate">
                                        {getGabaritoName(m.gabaritoNumeracao)}
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
                                            {filteredGabaritos.length === 0 ? (
                                              <div className="p-2 text-slate-400 italic text-center">Nenhum encontrado</div>
                                            ) : (
                                              filteredGabaritos.map((g) => {
                                                const val = String(g.id_gabarito !== null && g.id_gabarito !== undefined ? g.id_gabarito : g.id);
                                                return (
                                                  <button
                                                    key={g.id}
                                                    type="button"
                                                    onClick={() => {
                                                      updateModelField(p.id, m.id, "gabaritoNumeracao", val);
                                                      setOpenGabaritoDropdown(null);
                                                    }}
                                                    className={`w-full text-left p-2 hover:bg-slate-100 dark:hover:bg-slate-900 block transition-colors ${
                                                      m.gabaritoNumeracao === val 
                                                        ? "bg-blue-50/50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400" 
                                                        : "text-slate-800 dark:text-slate-200"
                                                    }`}
                                                  >
                                                    <div>{g.name}</div>
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
                                        const foundInDb = gabaritosList.find(g => String(g.id_gabarito || g.id) === m.gabaritoNumeracao || g.name === m.gabaritoNumeracao);
                                        const mockFound = MOCK_GABARITOS.find(g => g.nome === m.gabaritoNumeracao || g.id === m.gabaritoNumeracao || (foundInDb && g.nome === foundInDb.name));
                                        if (mockFound) {
                                          setSelectedGabaritoPreview(mockFound);
                                        } else if (foundInDb) {
                                          setSelectedGabaritoPreview({
                                            id: foundInDb.id,
                                            nome: foundInDb.name,
                                            descricao: "Gabarito carregado dinamicamente do banco de dados.",
                                            previewImageUrl: ""
                                          });
                                        }
                                      }}
                                      className="h-8 w-8 rounded-lg border border-slate-350 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-655 dark:text-slate-400 hover:bg-slate-150 dark:hover:bg-slate-800 flex items-center justify-center shrink-0 transition"
                                      title="Ver gabarito visual"
                                    >
                                      <Eye className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Faixas de Numeração ou CSV */}
                              <div className="space-y-1">
                                {m.configImpressao.tipoNumeracao === "SEQUENCIAL" ? (
                                  <div>
                                    <label className="text-[8px] font-extrabold text-slate-550 dark:text-slate-450 uppercase block">Faixa Numérica (Início / Fim)</label>
                                    <div className="flex gap-2 w-full">
                                      <input
                                        type="number"
                                        placeholder="Início"
                                        required
                                        readOnly={isEditing}
                                        disabled={isEditing}
                                        value={m.numeracaoInicial || ""}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateModelField(p.id, m.id, "numeracaoInicial", Number(e.target.value) || 0)}
                                        className={`w-1/2 h-8 px-2 rounded-lg border border-slate-300 dark:border-slate-700 text-right focus:outline-none font-mono font-bold text-[10px] ${isEditing ? "bg-slate-100 dark:bg-slate-900 cursor-not-allowed text-slate-500" : "bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"}`}
                                      />
                                      <input
                                        type="number"
                                        placeholder="Fim"
                                        readOnly
                                        value={m.numeracaoFinal || ""}
                                        className="w-1/2 h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 cursor-not-allowed text-right font-mono font-bold text-slate-500 dark:text-slate-455 focus:outline-none text-[10px]"
                                      />
                                    </div>
                                  </div>
                                ) : m.configImpressao.tipoNumeracao === "CUSTOMIZADA" ? (
                                  <div>
                                    <label className="text-[8px] font-extrabold text-slate-550 dark:text-slate-455 uppercase block text-left">Planilha de Dados (.CSV)</label>
                                    {m.csvDadosVariaveisUrl ? (
                                      <div className="flex items-center justify-between border border-emerald-300 dark:border-emerald-900 bg-emerald-50/20 dark:bg-emerald-950/10 px-2 py-1 rounded text-[9px] font-bold text-emerald-700 dark:text-emerald-450 h-8">
                                        <span className="truncate max-w-[130px] font-mono text-[9px]">{m.csvDadosVariaveisUrl}</span>
                                        <button
                                          type="button"
                                          onClick={() => updateModelField(p.id, m.id, "csvDadosVariaveisUrl", "")}
                                          className="text-red-500 hover:text-red-700 ml-1 font-bold text-xs"
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
                                        className={`w-full h-8 rounded-lg border font-black text-[9px] transition ${isEditing ? "bg-slate-100 dark:bg-slate-900 text-slate-400 cursor-not-allowed border-slate-300 dark:border-slate-800" : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-750 dark:text-slate-200 border-slate-300 dark:border-slate-750"}`}
                                      >
                                        Importar CSV Variáveis
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <div>
                                    <label className="text-[8px] font-extrabold text-slate-450 dark:text-slate-500 uppercase block">Especificação de Dados</label>
                                    <div className="h-8 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-400 font-bold text-[9px]">
                                      Sem Numeração Variável
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
                  <div className={`flex justify-between items-center p-2 rounded-lg text-[10px] font-bold mt-2 ${
                    isOverLimit 
                      ? "bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400 border border-red-200 dark:border-red-900/40 animate-pulse"
                      : "bg-slate-50 text-slate-650 dark:bg-slate-955 dark:text-slate-400 border border-slate-200/20 dark:border-slate-850/20"
                  }`}>
                    <span className="font-mono">Total Distribuído nos Lotes: {modelsSum.toLocaleString("pt-BR")} / {maxQty.toLocaleString("pt-BR")} un</span>
                    {isOverLimit ? (
                      <span>⚠️ Limite excedido! A soma excede o total da proposta.</span>
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-450 font-extrabold">✓ Distribuição de lotes válida</span>
                    )}
                  </div>
                  </div>
                </div>
              );
            })}
            </div>
          </div>

          {/* BLOCO 5 — LAYOUT (DESIGN) */}
          <div className="bg-slate-50/80 dark:bg-slate-900/40 border border-slate-300 dark:border-slate-800 p-4 rounded-xl space-y-3 shadow-sm">
            <h3 className="text-xs font-black uppercase text-[#0b2f4a] dark:text-slate-200 tracking-wider border-b border-slate-300 dark:border-slate-700 pb-1 flex items-center gap-1.5">
              BLOCO 5 — Layout (Design)
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Briefing da Arte */}
              <div className="md:col-span-2 space-y-1">
                <label className="text-[10px] font-extrabold text-slate-700 dark:text-slate-300 uppercase">Briefing da Arte / Layout</label>
                <textarea
                  placeholder="Orientações de arte (logotipos, fontes, paleta de cores, posicionamentos de numeração)."
                  rows={3}
                  value={instrucoesDesign}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                    setInstrucoesDesign(e.target.value);
                    setAtribuidoDesigner(false);
                  }}
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-955 resize-y focus:outline-none text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                />
              </div>

              {/* Designer Responsável & Equipe */}
              <div className="space-y-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold text-slate-700 dark:text-slate-300 uppercase block">Designer Responsável *</label>
                  <select
                    required
                    value={selectedDesigner}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                      setSelectedDesigner(e.target.value);
                      setAtribuidoDesigner(false);
                    }}
                    className="w-full h-8 px-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none font-bold text-slate-900 dark:text-slate-100 text-[10px]"
                  >
                    <option value="">Selecione o Designer...</option>
                    {designersList.map(d => (
                      <option key={d.user_id} value={d.user_id}>
                        {d.nome_usuario} ({d.email}) - {getDesignerActiveCount(d.user_id)} ativas
                      </option>
                    ))}
                  </select>
                </div>

                {/* Painel Compacto de Carga dos Designers */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-2 space-y-1">
                  <span className="text-[8px] font-black text-slate-450 dark:text-slate-500 uppercase tracking-wider block">Painel de Carga (Equipe)</span>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[8px]">
                    {designersList.map(d => {
                      const activeCount = getDesignerActiveCount(d.user_id);
                      return (
                        <div key={d.user_id} className="flex justify-between items-center border-b border-slate-100 dark:border-slate-850/40 last:border-b-0 pb-0.5">
                          <span className="text-slate-550 dark:text-slate-400 truncate max-w-[95px]" title={`${d.nome_usuario} (${d.email})`}>
                            {d.nome_usuario.split(" ")[0]}
                          </span>
                          <span className={`font-mono font-bold px-1 rounded-sm ${
                            activeCount >= 5 
                              ? "bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400" 
                              : activeCount >= 3 
                              ? "bg-amber-50 text-amber-700 dark:bg-amber-955/20 dark:text-amber-400" 
                              : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-450"
                          }`}>
                            {activeCount}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Ação Operacional de Atribuição no Bloco 5 */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/40 dark:border-slate-800/30 pt-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAtribuirDesigner}
                  disabled={!selectedDesigner || !instrucoesDesign.trim() || produtos.length === 0 || !produtos.some(p => p.modelos.length > 0)}
                  className={`h-8 px-4 rounded-lg font-bold text-[10px] uppercase transition flex items-center gap-1.5 shadow-sm ${
                    (!selectedDesigner || !instrucoesDesign.trim() || produtos.length === 0 || !produtos.some(p => p.modelos.length > 0))
                      ? "bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-650 cursor-not-allowed border border-slate-350/30"
                      : "bg-blue-600 hover:bg-blue-700 text-white border border-blue-700/20 hover:scale-[1.01] active:scale-[0.99]"
                  }`}
                >
                  Atribuir arte ao designer
                </button>
              </div>

              {atribuidoDesigner && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/15 border border-emerald-250 dark:border-emerald-900/45 text-emerald-800 dark:text-emerald-450 text-[10px] font-bold shadow-xs">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                  <span>Arte atribuída para {selectedDesigner}</span>
                  <span className="opacity-75 font-mono text-[9px]">({dataHoraAtribuicao})</span>
                </div>
              )}
            </div>

            {/* Upload Area / Attachments */}
            <div className="border-t border-slate-200/40 dark:border-slate-800/30 pt-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block">Anexos de Referência & Briefing</span>
                <button
                  type="button"
                  onClick={handleAddMockAttachment}
                  className="h-6.5 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-850 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg text-[10px] font-bold flex items-center gap-1 transition border border-slate-205 dark:border-slate-800"
                >
                  <span>📎 Anexar Referência</span>
                </button>
              </div>

              {attachments.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mt-1.5">
                  {attachments.map((att) => (
                    <div key={att.url} className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[10px] shadow-xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-slate-400 select-none">📄</span>
                        <span className="font-bold truncate text-slate-700 dark:text-slate-300 max-w-[120px]" title={att.name}>{att.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(att.url)}
                        className="text-slate-400 hover:text-red-500 font-bold transition ml-1"
                      >
                                        Remover
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-[9px] text-slate-450 italic mt-0.5">
                                  Nenhum arquivo ou referência anexada ao briefing do layout.
                                </p>
                              )}
                            </div>
                          </div>

                          {/* CONFIGURAÇÕES TÉCNICAS POR SETOR PCP (BLOCOS 6 & 7 SIMPLIFICADOS) */}
                          <div className="bg-slate-50/80 dark:bg-slate-900/40 border border-slate-300 dark:border-slate-800 p-4 rounded-xl space-y-4 shadow-sm">
                            <div className="flex items-center justify-between border-b border-slate-300 dark:border-slate-700 pb-1">
                              <h3 className="text-xs font-black uppercase text-[#0b2f4a] dark:text-slate-200 tracking-wider">
                                Configurações Técnicas e Acabamento (PCP)
                              </h3>
                              <span className="text-[9px] font-bold text-[#0b2f4a] dark:text-blue-450">
                                Blocos 6 e 7 Padronizados
                              </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-1">
                                <label className="text-[10px] font-extrabold text-slate-700 dark:text-slate-355 uppercase block">
                                  Observações Técnicas de Impressão (Bloco 6)
                                </label>
                                <textarea
                                  placeholder="Especificações de impressão, perfil de qualidade, tipo de tinta..."
                                  rows={4}
                                  value={obsImpressao}
                                  onChange={(e) => setObsImpressao(e.target.value)}
                                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-955 resize-y focus:outline-none text-[10px] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                                />
                              </div>

                              <div className="space-y-1">
                                <label className="text-[10px] font-extrabold text-slate-700 dark:text-slate-355 uppercase block">
                                  Observações Técnicas de Acabamento (Bloco 7)
                                </label>
                                <textarea
                                  placeholder="Laminação, verniz, furos, corte especial, blocagem, ilhós..."
                                  rows={4}
                                  value={obsAcabamento}
                                  onChange={(e) => setObsAcabamento(e.target.value)}
                                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-955 resize-y focus:outline-none text-[10px] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                                />
                              </div>
                            </div>
                          </div>

                          {/* BLOCO 8 — REVISÃO / LOGÍSTICA */}
                          <div className="bg-slate-50/80 dark:bg-slate-900/40 border border-slate-300 dark:border-slate-800 p-4 rounded-xl space-y-3 shadow-sm">
                            <h3 className="text-xs font-black uppercase text-[#0b2f4a] dark:text-slate-200 tracking-wider border-b border-slate-300 dark:border-slate-700 pb-1">
                              BLOCO 8 — Revisão / Logística
                            </h3>
                            
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div className="space-y-1">
                                <label className="text-[10px] font-extrabold text-slate-700 dark:text-slate-300 uppercase">Modalidade de Envio</label>
                                <select
                                  disabled={isEditing}
                                  value={transporte}
                                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTransporte(e.target.value)}
                                  className={`w-full h-8 px-2 rounded-lg border border-slate-300 dark:border-slate-700 focus:outline-none font-bold text-slate-900 dark:text-slate-100 text-[10px] ${isEditing ? "bg-slate-100 dark:bg-slate-900 cursor-not-allowed" : "bg-white dark:bg-slate-950"}`}
                                >
                                  <option value="Retirada">Retirada em Mãos (Balcão)</option>
                                  <option value="Motoboy">Entrega Via Motoboy</option>
                                  <option value="Sedex">Correios: SEDEX</option>
                                  <option value="Pac">Correios: PAC</option>
                                  <option value="Transportadora">Transportadora Conveniada</option>
                                </select>
                              </div>

                              <div className="space-y-1">
                                <label className="text-[10px] font-extrabold text-slate-700 dark:text-slate-300 uppercase">Volumes Estimados</label>
                                <input
                                  type="number"
                                  min={1}
                                  required
                                  readOnly={isEditing}
                                  disabled={isEditing}
                                  value={volumes}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVolumes(Number(e.target.value) || 1)}
                                  className={`w-full h-8 px-3 rounded-lg border border-slate-300 dark:border-slate-700 focus:outline-none font-mono font-bold ${isEditing ? "bg-slate-100 dark:bg-slate-900 cursor-not-allowed text-slate-500" : "bg-white dark:bg-slate-955 text-slate-900 dark:text-slate-100"}`.replace("dark:bg-slate-955", "dark:bg-slate-950")}
                                />
                              </div>

                              <div className="space-y-1">
                                <label className="text-[10px] font-extrabold text-slate-700 dark:text-slate-300 uppercase">Observações Críticas / Restrições (OS)</label>
                                <input
                                  type="text"
                                  placeholder="Restrição de entrega, horários ou avisos gerais."
                                  value={obsCriticas}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setObsCriticas(e.target.value)}
                                  className="w-full h-8 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-955 focus:outline-none text-slate-900 dark:text-slate-100 placeholder-slate-400"
                                />
                              </div>
                            </div>
                          </div>

                          {/* BLOCO DE RESUMO FINAL E SUBMISSÃO */}
                          <div className="bg-slate-50/80 dark:bg-slate-900/40 border border-slate-300 dark:border-slate-800 p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
                            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] font-mono text-slate-700 dark:text-slate-300">
                              <div>
                                <span className="text-slate-500 font-bold uppercase mr-1.5">Total de Itens:</span>
                                <strong className="text-[#0b2f4a] dark:text-white font-mono text-xs">{totalQuantidade.toLocaleString("pt-BR")} un</strong>
                              </div>
                              <div>
                                <span className="text-slate-500 font-bold uppercase mr-1.5">Peso Teórico Total:</span>
                                <strong className="text-[#0b2f4a] dark:text-white font-mono text-xs">{calculateTotalWeight()} kg</strong>
                              </div>
                              <div>
                                <span className="text-slate-500 font-bold uppercase mr-1.5">Volumes:</span>
                                <strong className="text-[#0b2f4a] dark:text-white font-mono text-xs">{volumes} caixas</strong>
                              </div>
                              <div>
                                <span className="text-slate-500 font-bold uppercase mr-1.5">Urgência:</span>
                                <span className={`px-1.5 py-0.5 rounded font-sans font-bold text-[9px] ${
                                  urgente 
                                    ? "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400 border border-red-200 dark:border-red-900/30" 
                                    : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-400 border border-slate-300 dark:border-slate-700"
                                }`}>
                                  {urgente ? "URGENTE" : "PADRÃO"}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <button
                                type="submit"
                                className="h-9 px-6 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-extrabold flex items-center justify-center gap-1.5 shadow transition text-xs"
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
