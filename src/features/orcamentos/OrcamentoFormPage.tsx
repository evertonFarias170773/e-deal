"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo, useState, useEffect, useRef, useCallback, useId } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { codecs } from "@/lib/url-state";
import { Copy, Search, Trash2, X, Edit2, AlertTriangle, AlertOctagon, ChevronDown } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { ContactEditModal } from "@/features/orcamentos/components/ContactEditModal";
import { PedidoModelosTab } from "@/features/orcamentos/components/PedidoModelosTab";
import { ArtesTab, type BriefingArtesDraft } from "@/features/orcamentos/components/ArtesTab";
import { ProductSearchSelector } from "@/features/orcamentos/components/ProductSearchSelector";
import { validarStatusProposta } from "@/features/orcamentos/services/status-shadow.service";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useAuth } from "@/features/auth/AuthProvider";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Cadastro, CadastroContato, CadastroEndereco } from "@/features/cadastros/types";
import { hasPermissao } from "@/features/auth/usuarios.service";
import type {
  Proposta,
  PropostaFormState,
  PropostaItem,
  TipoDescontoProposta,
  PropostaFrete,
  PedidoModeloState
} from "@/features/orcamentos/types";
import {
  buildPropostaInformalText,
  propostaDispensaArte
} from "@/features/orcamentos/orcamento-utils";
import { formatCurrency, parseCurrencyBR, formatCurrencyWithoutPrefix } from "@/lib/formatters/currency";
import { formatWeightFromGrams } from "@/lib/formatters/weight";
import { mockCompanies } from "@/lib/mocks/empresas.mock";
import {
  calculateItemSubtotal,
  calculateItemWeight,
  calculateResumo,
  createFretesMock,
  createItemFromProduto,
  formatVariacoesItem,
  getClienteBonusPercent,
  getClienteVendedorPadrao,
  novoItemId,
  sortEnderecosPorPrioridade
} from "@/features/orcamentos/orcamento-utils";
import { getCadastrosReadOnlyList, getCadastroCompleto } from "@/features/cadastros/services/cadastros.service";
import { listProdutos } from "@/features/produtos/services/produtos.service";
import { listProdutoVariacaoVinculos } from "@/features/produtos/services/produto-variacoes.service";
import { saveProposta, listVendedoresReais, insertEnderecoProposta, updateEnderecoProposta, updatePropostaFiscalDados, registrarMensagemSistemaProposta, type UsuarioVendedor } from "@/features/orcamentos/services/orcamentos.service";
import { salvarBriefingArtes } from "@/features/pedidos/services/pedidos-artes.service";
import { useOrcamentoDetail } from "@/features/orcamentos/hooks/useOrcamentoDetail";
import { composeStatusEmArte } from "@/features/orcamentos/mappers";
import { solicitarCotacaoSedex, solicitarCotacaoAzulCargo, solicitarCotacaoTransportadoras, solicitarCotacaoVeppo } from "@/features/orcamentos/services/frete.service";
import type { Produto } from "@/features/produtos/types";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { PropostaCobrancaPanel } from "@/features/cobrancas/PropostaCobrancaPanel";
import { normalizeDocumentDigits } from "@/features/cadastros/utils/documento";
import { DiferencaFinanceiraModal } from "@/features/orcamentos/components/DiferencaFinanceiraModal";
import type { AcaoFinanceiraDiferenca } from "@/features/cobrancas/types";
import {
  calcularValorPagoConfirmado,
  calcularDiferencaFinanceira
} from "@/features/cobrancas/cobrancas-utils";
import {
  getSaldoContaCorrente
} from "@/features/cobrancas/services/movimento-credito.service";

const removeAccents = (str: string): string => {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

const normalizeName = (val: string | undefined | null) => {
  if (!val) return "";
  return val.trim().toLowerCase().replace(/\s+/g, " ");
};

const normalizeFreteKey = (f: { transportadora: string; servico: string }): string => {
  let trans = removeAccents(f.transportadora || "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ");

  // Remover termos genéricos como "TRANSPORTADORA", "TRANS.", "TRANSP."
  trans = trans
    .replace(/\bTRANSPORTADORA\b/g, "")
    .replace(/\bTRANS\.\b/g, "")
    .replace(/\bTRANSP\.\b/g, "")
    .replace(/\bTRANS\b/g, "")
    .replace(/\bTRANSP\b/g, "")
    .trim()
    .replace(/\s+/g, " ");

  let serv = removeAccents(f.servico || "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ");

  // Quando serviço for igual ou contido no nome da transportadora, não usar serviço como diferenciador.
  if (trans.includes(serv) || serv.includes(trans)) {
    serv = "";
  }

  return `${trans}|${serv}`.trim();
};

const areFreightsEqual = (f1: PropostaFrete, f2: PropostaFrete) => {
  return normalizeFreteKey(f1) === normalizeFreteKey(f2);
};

const getStableFreightKey = (f: PropostaFrete): string => {
  return normalizeFreteKey(f);
};

/** SEDEX (Correios) — modalidade padrão de novas cotações. */
const isSedexFrete = (f: PropostaFrete): boolean => {
  const alvo = removeAccents(`${f.transportadora || ""} ${f.servico || ""}`).toUpperCase();
  return alvo.includes("SEDEX");
};

/**
 * Opção pré-selecionada de uma cotação nova: SEDEX quando disponível,
 * senão a primeira da lista (comportamento anterior).
 */
const escolherFretePadrao = (fretes: PropostaFrete[]): PropostaFrete | undefined => {
  return fretes.find(isSedexFrete) ?? fretes[0];
};

type OrcamentoFormPageProps = {
  mode: "new" | "edit";
  idInt?: number;
  proposta?: Proposta;
};

type ContactDraft = Pick<CadastroContato, "nome" | "cargo" | "whatsapp" | "email">;
type AddressDraft = Omit<CadastroEndereco, "id">;

const inputClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]";


function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getDestinationKey(
  clienteNaoCadastrado: boolean,
  cepLivre: string | undefined,
  cidadeLivre: string | undefined,
  ufLivre: string | undefined,
  nomeClienteLivre: string | undefined,
  enderecoId: string | undefined,
  currentAddress: { cep?: string; cidade?: string; uf?: string } | undefined
): string {
  if (clienteNaoCadastrado) {
    const cep = cepLivre ? cepLivre.replace(/\D/g, "") : "";
    const city = cidadeLivre ? normalizeName(cidadeLivre) : "";
    const uf = ufLivre ? ufLivre.toLowerCase().trim() : "";
    const name = nomeClienteLivre ? normalizeName(nomeClienteLivre) : "";
    return `free_${cep}_${city}_${uf}_${name}`;
  } else {
    const cep = currentAddress?.cep ? currentAddress.cep.replace(/\D/g, "") : "";
    const city = currentAddress?.cidade ? normalizeName(currentAddress.cidade) : "";
    const uf = currentAddress?.uf ? currentAddress.uf.toLowerCase().trim() : "";
    const addrId = enderecoId || "";
    return `db_${addrId}_${cep}_${city}_${uf}`;
  }
}

function getShipmentKey(
  pesoTotal: number,
  volumes: number,
  itens: PropostaItem[]
): string {
  const itemsStr = (itens || []).map((it) => {
    const varStr = (it.variacoesEscolhidas || [])
      .map((v) => v.id_variacao)
      .sort((a, b) => a - b)
      .join(",");
    return `${it.id_produto}:${it.quantidade}:${varStr}`;
  }).join("|");
  return `${pesoTotal.toFixed(3)}_${volumes}_${itemsStr}`;
}

/**
 * Abas do editor. O parâmetro conserva o nome legado `tab`, porque links
 * antigos (e o retorno da resolução de pendência) já apontam para ele.
 * "geral" é o padrão e, por isso, não aparece na URL.
 */
const ABAS_EDITOR = [
  "geral",
  "produtos",
  "fretes",
  "pagamentos",
  "artes",
  "pedido",
  "boletim",
  "historico"
] as const;

export function OrcamentoFormPage({ mode, idInt, proposta }: OrcamentoFormPageProps) {
  const { getCobrancasByProposta } = useCobrancas();
  const targetIdInt = idInt ?? proposta?.id_int;

  if (mode === "edit" && !proposta && idInt) {
    return <OrcamentoFormLoader idInt={idInt} />;
  }

  return <OrcamentoFormInner mode={mode} proposta={proposta} />;
}

/**
 * Teto de espera do snapshot do guard de alterações. Passado esse tempo o
 * snapshot é tirado mesmo com carregamento pendente — o guard nunca pode ficar
 * desligado por causa de uma requisição travada.
 */
const TEMPO_MAXIMO_ESPERA_SNAPSHOT_MS = 8000;
const INTERVALO_VERIFICACAO_SNAPSHOT_MS = 150;

function OrcamentoFormLoader({ idInt }: { idInt: number }) {
  const { proposta, loading, error, reload } = useOrcamentoDetail(idInt);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center space-y-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#0b2f4a] border-t-transparent mx-auto"></div>
          <p className="text-slate-500 font-semibold text-sm">Carregando dados do orçamento...</p>
        </div>
      </div>
    );
  }

  if (error || !proposta) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-center max-w-lg mx-auto mt-12 space-y-4">
        <h2 className="text-lg font-bold text-red-800">Falha ao carregar orçamento</h2>
        <p className="text-sm text-red-600">{error || "Não foi possível carregar a proposta para edição."}</p>
        <div className="pt-2">
          <Link
            href="/orcamentos"
            className="inline-flex items-center gap-2 rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
          >
            Voltar para a lista
          </Link>
        </div>
      </div>
    );
  }

  return <OrcamentoFormInner mode="edit" proposta={proposta} onReload={reload} />;
}

function OrcamentoFormInner({ mode, proposta, onReload }: { mode: "new" | "edit"; proposta?: Proposta; onReload?: (silent?: boolean) => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useAppToast();
  const { user } = useAuth();
  const { getCobrancasByProposta } = useCobrancas();

  const canAlterarVendedor = Boolean(
    user?.isSuperAdmin ||
    user?.isAdmin ||
    user?.isGerente ||
    hasPermissao(user, "propostas.alterar_vendedor") || // Legado V1
    hasPermissao(user, "propostas.edit_vendedor")       // V2.1
  );

  const canEditarDescontoGeral = Boolean(
    user?.isSuperAdmin ||
    user?.isAdmin ||
    user?.isGerente ||
    hasPermissao(user, "propostas.desconto_geral")
  );

  // Edição manual de "Valor Unitário (R$)" e "Fixo (R$)" do item.
  // Regra de negócio: apenas ADM/Admin e SuperAdmin (não inclui Gerente/vendedor).
  // Além de habilitar os inputs, controla o repricing automático em recalculateItem:
  // usuários sem permissão continuam tendo o preço reaplicado (produto/tabela do cliente).
  const canEditarValoresItem = Boolean(
    user?.isSuperAdmin ||
    user?.isAdmin
  );

  // — Permissões do fluxo de edição de proposta paga —
  const canEditarPropostaPaga = Boolean(
    user?.isSuperAdmin ||
    hasPermissao(user, "propostas.editar_paga")
  );
  const canBonificar = Boolean(
    user?.isSuperAdmin ||
    hasPermissao(user, "financeiro.bonificar")
  );
  const canDevolver = Boolean(
    user?.isSuperAdmin ||
    hasPermissao(user, "financeiro.devolver")
  );
  const canDebitoFuturo = Boolean(
    user?.isSuperAdmin ||
    hasPermissao(user, "financeiro.debito_futuro")
  );
  const canUsarCredito = Boolean(
    user?.isSuperAdmin ||
    hasPermissao(user, "credito.usar")
  );
  void canUsarCredito;     // reservado para fluxo de nova proposta

  useEffect(() => {
    if (user) {
      console.log("[Auditoria Homologação Fase 4.1] Formulário de Proposta:", {
        usuario: user.email || user.name || `ID: ${user.id}`,
        permissoesAvaliadas: {
          "propostas.alterar_vendedor": canAlterarVendedor,
          "propostas.desconto_geral": canEditarDescontoGeral
        }
      });
    }
  }, [user, canAlterarVendedor, canEditarDescontoGeral]);

  // Catalog state from Supabase
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loadingProdutos, setLoadingProdutos] = useState(true);
  const [deleteProductConfirmOpen, setDeleteProductConfirmOpen] = useState(false);
  const [consolidarConfirmOpen, setConsolidarConfirmOpen] = useState(false);
  const [isConsolidating, setIsConsolidating] = useState(false);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
  const [isDeletingProduct, setIsDeletingProduct] = useState(false);
  type EditTabType = (typeof ABAS_EDITOR)[number];

  // A aba vive na URL, nos dois sentidos: o link define qual abre, e trocar de
  // aba atualiza o endereço. Aba desconhecida cai em "geral".
  const abaSchema = useMemo(
    () => ({ tab: { codec: codecs.enumOf(ABAS_EDITOR), default: "geral" as const } }),
    []
  );
  const { filters: filtrosAba, setFilter: setFiltroAba } = useUrlFilters(abaSchema);
  const activeFormTab: EditTabType = filtrosAba.tab;
  const setActiveFormTab = useCallback(
    (aba: EditTabType) => {
      setFiltroAba("tab", aba);
    },
    [setFiltroAba]
  );

  const [saveSuccessModal, setSaveSuccessModal] = useState<{ isOpen: boolean; finalIdInt: number | string }>({ isOpen: false, finalIdInt: "" });

  const [form, setForm] = useState<PropostaFormState>(() => createInitialState(proposta));

  /**
   * Carregamentos de inicialização que ainda vão escrever no `form` depois da
   * montagem: modelos do pedido, engine de status e variações dos itens.
   * Enquanto houver algum pendente o snapshot do guard de alterações não é
   * tirado — antes ele era congelado num timer fixo de 600ms e qualquer um
   * desses retornos chegando depois deixava o formulário "sujo" sem o usuário
   * ter tocado em nada, o que fazia a aba Pagamentos exigir salvar a cada
   * tentativa de gerar cobrança.
   */
  const inicializacoesPendentes = useRef(0);

  // Espelho do form para o efeito de captura do snapshot, que roda uma vez só:
  // sem isso ele enxergaria o form da primeira renderização.
  const formRef = useRef(form);
  formRef.current = form;

  const loadModelos = useCallback(async () => {
    if (proposta?.id_int && form.id_int !== "NOVO") {
      const client = getSupabaseClient();
      if (!client) return;
      inicializacoesPendentes.current += 1;
      try {
      const { data } = await client
          .from("pedidos_modelos")
          .select("*")
          .eq("id_int", proposta.id_int)
          .order("ordem", { ascending: true })
          .order("created_at", { ascending: true });
        
        if (data) {
          const modelos: PedidoModeloState[] = data.map((m: any) => ({
            id: Number(m.id),
            isPersisted: true,
            id_produto_proposta_origem: m.id_produto_proposta_origem !== null ? Number(m.id_produto_proposta_origem) : null,
            nome_modelo: String(m.nome_modelo || ""),
            padrao: m.padrao as string | null,
            quantidade: Number(m.quantidade || 0),
            tipo_numeracao: m.tipo_numeracao as string | null,
            numeracao_inicio: m.numeracao_inicio !== null ? Number(m.numeracao_inicio) : null,
            numeracao_fim: m.numeracao_fim !== null ? Number(m.numeracao_fim) : null,
            verso_tipo: m.verso_tipo as string | null,
            status_arte: String(m.status_arte || "PENDENTE"),
            status_producao: String(m.status_producao || "PENDENTE"),
            amostra_arte_base64: m.amostra_arte_base64 ? String(m.amostra_arte_base64) : null,
            verso_amostra_arte_base64: m.verso_amostra_arte_base64 ? String(m.verso_amostra_arte_base64) : null,
            variacoes_texto: m.variacoes_texto !== null && m.variacoes_texto !== undefined ? String(m.variacoes_texto) : null,
            ordem: Number(m.ordem || 0),
            gabarito_operacional: m.gabarito_operacional as string | null,
            bloco: m.bloco as string | null,
            Q_CAM: m.Q_CAM !== null && m.Q_CAM !== undefined ? Number(m.Q_CAM) : null,
            L_CAM: m.L_CAM !== null && m.L_CAM !== undefined ? Number(m.L_CAM) : null,
            C_INI: m.C_INI !== null && m.C_INI !== undefined ? Number(m.C_INI) : null,
          }));
          setForm((prev) => ({ ...prev, pedidosModelos: modelos }));
        }
      } finally {
        inicializacoesPendentes.current -= 1;
      }
    }
  }, [proposta?.id_int, form.id_int]);

  useEffect(() => {
    loadModelos();
  }, [loadModelos]);

  // Sincronização automática do status via Engine Oficial
  useEffect(() => {
    let mounted = true;

    async function checkAndSyncStatus() {
      if (!proposta?.id_int || form.id_int === "NOVO") return;
      inicializacoesPendentes.current += 1;
      try {

      // Executa a engine com o status_interno atual do form
      const diagnostic = await validarStatusProposta(proposta.id_int, !!form.isAvulso, form.status);
      
      // Update emArte state even if status didn't change
      if (mounted && diagnostic) {
        setForm(prev => ({ ...prev, emArte: diagnostic.emArte }));
      }

      if (mounted && diagnostic && diagnostic.mudariaStatus) {
        try {
          const client = getSupabaseClient();
          if (!client) return;
          const { data: { session } } = await client.auth.getSession();
          
          const response = await fetch('/api/orcamentos/sync-status', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token || ''}`
            },
            body: JSON.stringify({ idInt: Number(proposta.id_int) })
          });

          const result = await response.json();
          
          if (result.success && mounted) {
            setForm(prev => ({ ...prev, status: diagnostic.statusRecomendado as any, emArte: diagnostic.emArte }));
            showToast({ 
              type: "success", 
              title: "Status Atualizado", 
              description: `O status foi atualizado automaticamente pela Engine para ${diagnostic.statusRecomendado}.` 
            });
          } else if (!result.success) {
            console.warn("Auto-sync de status falhou:", result.errorMessage);
          }
        } catch (err) {
          console.error("Erro ao sincronizar status automaticamente:", err);
        }
        }
      } finally {
        inicializacoesPendentes.current -= 1;
      }
    }

    checkAndSyncStatus();

    return () => {
      mounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposta?.id_int]); // Executa apenas no carregamento da proposta


  const [proposalContacts, setProposalContacts] = useState<CadastroContato[]>(() => proposta?.cliente.contatos ?? []);
  const [proposalAddresses, setProposalAddresses] = useState<CadastroEndereco[]>(() => {
    if (proposta?.cliente?.enderecos && proposta.cliente.enderecos.length > 0) return proposta.cliente.enderecos;
    return [];
  });
  const [cliente, setCliente] = useState<Cadastro | null>(() => proposta?.cliente ?? null);
  const shouldShowRest = mode !== "new" || cliente !== null || form.clienteNaoCadastrado;

  // — Estado do modal de diferença financeira (obrigatório) —
  type DiferencaModalState = {
    isOpen: boolean;
    idInt: number;
    idCliente: number;
    idPendencia: number | null; // criado pela API editar-paga
    nomeCliente: string;
    valorPagoConfirmado: number;
    novoTotal: number;
    diferenca: number;
    /** Callback de conclusão após resolver a diferença */
    onResolve: (tipoAcao?: string) => void;
  };
  const [diferencaModal, setDiferencaModal] = useState<DiferencaModalState | null>(null);

  // Abre automaticamente o modal de criação de cobrança ao entrar na aba Pagamentos
  // logo após registrar um débito complementar ("Registrar débito e gerar a cobrança").
  const [autoAbrirCobranca, setAutoAbrirCobranca] = useState(false);
  useEffect(() => {
    if (autoAbrirCobranca && activeFormTab === "pagamentos") {
      // O painel já leu defaultModalOpen no mount; zeramos o flag para não reabrir
      // em visitas futuras à aba.
      const t = setTimeout(() => setAutoAbrirCobranca(false), 0);
      return () => clearTimeout(t);
    }
  }, [autoAbrirCobranca, activeFormTab]);

  // — Pendência de revisão financeira aberta (detectada ao carregar a proposta) —
  const [pendenciaRevisaoAberta, setPendenciaRevisaoAberta] = useState<{
    id: number;
    descricao: string;
  } | null>(null);

  useEffect(() => {
    if (mode !== "edit" || !proposta?.id_int || !hasActiveCobranca || !canEditarPropostaPaga) return;
    // Verificar pendência ABERTA/PARCIALMENTE_RESOLVIDA de Conta Corrente
    // (public.conta_corrente_pendencias — fora do domínio de propostas_pendencias)
    import("@/features/cobrancas/services/conta-corrente.service")
      .then(({ listPendenciasByProposta }) => listPendenciasByProposta(proposta.id_int))
      .then((pendenciasCC) => {
        const aberta = pendenciasCC.find(p => p.status === "ABERTA" || p.status === "PARCIALMENTE_RESOLVIDA");
        if (aberta) {
          const valorPendente = Math.round((aberta.valor_saldo + aberta.valor_reservado) * 100) / 100;
          setPendenciaRevisaoAberta({
            id: aberta.id,
            descricao: `Diferença pendente: R$ ${valorPendente.toFixed(2).replace(".", ",")} (${aberta.direcao === "FAVOR_CLIENTE" ? "a favor do cliente" : "a favor da empresa"}). Motivo: ${aberta.motivo}.`,
          });
        } else {
          setPendenciaRevisaoAberta(null);
        }
      })
      .catch(() => setPendenciaRevisaoAberta(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposta?.id_int, mode]);

  // Reabertura automática do modal de resolução via query string (retomada da listagem)
  useEffect(() => {
    if (
      searchParams?.get("resolver-pendencia") === "true" &&
      pendenciaRevisaoAberta &&
      proposta?.id_int &&
      proposta.resumo
    ) {
      const cobrs = getCobrancasByProposta(proposta.id_int) || [];
      if (cobrs.length > 0) {
        const valorPago = calcularValorPagoConfirmado(cobrs);
        const novoTotal = proposta.resumo.valorTotal;
        const diff = calcularDiferencaFinanceira(novoTotal, valorPago);

        setDiferencaModal({
          isOpen: true,
          idInt: proposta.id_int,
          idCliente: proposta.cliente?.idCliente ?? 0,
          idPendencia: pendenciaRevisaoAberta.id,
          nomeCliente: proposta.cliente?.nome ?? "Cliente",
          valorPagoConfirmado: valorPago,
          novoTotal,
          diferenca: diff,
          onResolve: (tipoAcao?: string) => {
            setPendenciaRevisaoAberta(null);
            if (tipoAcao === "DEBITO_PENDENTE_COBRANCA") {
              setActiveFormTab("pagamentos");
              setAutoAbrirCobranca(true);
            }
          },
        });

        // Limpar a query string de forma segura e silenciosa
        const url = new URL(window.location.href);
        url.searchParams.delete("resolver-pendencia");
        window.history.replaceState({}, "", url.toString());
      }
    }
    // `setActiveFormTab` acompanha a query, a mesma origem de `searchParams`:
    // entra nas dependências sem criar disparo novo deste efeito.
  }, [searchParams, pendenciaRevisaoAberta, proposta, getCobrancasByProposta, setActiveFormTab]);

  // — Histórico de movimentos financeiros da proposta —
  const [historicoMovimentos, setHistoricoMovimentos] = useState<any[]>([]);
  const [loadingHistorico, setLoadingHistorico] = useState(false);

  useEffect(() => {
    if (activeFormTab === "historico" && proposta?.id_int && form.id_int !== "NOVO") {
      setLoadingHistorico(true);
      const client = getSupabaseClient();
      if (client) {
        (async () => {
          try {
            const { data, error } = await client
              .from("movimento_credito")
              .select("*")
              .eq("id_int", proposta.id_int)
              .order("created_at", { ascending: true }); // Ordenação cronológica linear ascendente
            if (!error && data) {
              setHistoricoMovimentos(data);
            }
          } catch (e) {
            console.error("Erro ao obter historico de movimentos:", e);
          } finally {
            setLoadingHistorico(false);
          }
        })();
      } else {
        setLoadingHistorico(false);
      }
    }
  }, [activeFormTab, proposta?.id_int, form.id_int]);

  // — Saldo de conta corrente do cliente selecionado (com sinal) —
  // saldoCredito (>=0): crédito disponível para aplicar em pagamento (banner existente).
  // saldoDevedor (>=0): valor em aberto quando o cliente está devedor (novo lembrete).
  const [saldoCredito, setSaldoCredito] = useState<number>(0);
  const [saldoDevedor, setSaldoDevedor] = useState<number>(0);

  // Lembrete de débito é informativo — visível a quem edita a proposta, sem gate
  // de permissão de crédito (o objetivo é lembrar o vendedor, não liberar consumo).
  const fetchSaldoCredito = useCallback(async () => {
    if (!cliente?.idCliente) {
      setSaldoCredito(0);
      setSaldoDevedor(0);
      return;
    }
    try {
      const saldoReal = await getSaldoContaCorrente(cliente.idCliente);
      setSaldoCredito(canUsarCredito ? Math.max(0, saldoReal) : 0);
      setSaldoDevedor(saldoReal < 0 ? Math.round(Math.abs(saldoReal) * 100) / 100 : 0);
    } catch (e) {
      setSaldoCredito(0);
      setSaldoDevedor(0);
    }
  }, [cliente?.idCliente, canUsarCredito]);

  useEffect(() => {
    fetchSaldoCredito();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente?.idCliente, form.clienteId]);

  const [openItemIds, setOpenItemIds] = useState<Record<string, boolean>>({});
  const [duplicateProductPrompt, setDuplicateProductPrompt] = useState<{
    productId: string;
    nomeProduto: string;
    idProduto: number;
    existingItemId: string;
    totalLinhas: number;
  } | null>(null);
  const [clientSearch, setClientSearch] = useState(() => proposta?.cliente ? `${proposta.cliente.idCliente} - ${proposta.cliente.nome}` : (mode === "new" ? "#" : ""));
  const [showClientResults, setShowClientResults] = useState(false);
  const [clientResults, setClientResults] = useState<Cadastro[]>([]);
  const [isSearchingClients, setIsSearchingClients] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showArtesBlockModal, setShowArtesBlockModal] = useState<{ nome: string; faltam: string[] }[] | null>(null);
  const [cepLivreLoading, setCepLivreLoading] = useState(false);
  const [errorFields, setErrorFields] = useState<string[]>([]);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [addressModalMode, setAddressModalMode] = useState<"create" | "edit">("create");
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [pendingEnderecoSelection, setPendingEnderecoSelection] = useState<string | null>(null);
  const [contactDraft, setContactDraft] = useState<ContactDraft>({ nome: "", cargo: "", whatsapp: "", email: "" });
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editContactDraft, setEditContactDraft] = useState<ContactDraft>({ nome: "", cargo: "", whatsapp: "", email: "" });
  const [addressDraft, setAddressDraft] = useState<AddressDraft>({
    tipo: "entrega",
    cep: "",
    endereco: "",
    numero: "",
    bairro: "",
    cidade: "",
    uf: "",
    complemento: "",
    recebedor: "",
    cpfRecebedor: ""
  });
  const [isSavingAddress, setIsSavingAddress] = useState(false);

  const [isQuotingSedex, setIsQuotingSedex] = useState(false);
  const [isQuotingAzul, setIsQuotingAzul] = useState(false);
  const [isQuotingTransp, setIsQuotingTransp] = useState(false);
  const [isQuotingVeppo, setIsQuotingVeppo] = useState(false);
  const [compradorAddresses, setCompradorAddresses] = useState<CadastroEndereco[]>([]);
  const [loadingCompradorAddresses, setLoadingCompradorAddresses] = useState(false);
  const [lastDestinationKey, setLastDestinationKey] = useState<string>(() => {
    if (!proposta) return "";
    const isNaoCadastrado = proposta.clienteNaoCadastrado ?? (proposta.cliente ? (proposta.cliente.idCliente === null || proposta.cliente.idCliente === undefined || Number(proposta.cliente.idCliente) === 0) : false);
    const cepLivre = isNaoCadastrado ? (proposta.enderecoEntrega?.cep ?? "") : "";
    const cidadeLivre = isNaoCadastrado ? (proposta.enderecoEntrega?.cidade ?? "") : "";
    const ufLivre = isNaoCadastrado ? (proposta.enderecoEntrega?.uf ?? "") : "";
    const nomeClienteLivre = isNaoCadastrado ? (proposta.cliente?.nome ?? "") : "";
    const enderecoId = isNaoCadastrado ? "" : (proposta.enderecoEntrega?.id ?? "");
    return getDestinationKey(
      isNaoCadastrado,
      cepLivre,
      cidadeLivre,
      ufLivre,
      nomeClienteLivre,
      enderecoId,
      proposta.enderecoEntrega
    );
  });

  const [lastShipmentKey, setLastShipmentKey] = useState<string>(() => {
    if (!proposta) return "";
    const w = proposta.resumo.pesoTotal;
    const v = Math.max(1, Math.ceil(w / 14500));
    return getShipmentKey(w, v, proposta.itens);
  });
  const [isManualFreteModalOpen, setIsManualFreteModalOpen] = useState(false);
  const [manualFreteDraft, setManualFreteDraft] = useState({
    servico: "",
    prazo: "",
    valor: "",
    escolhido: true
  });

  const [dbVendedores, setDbVendedores] = useState<UsuarioVendedor[]>([]);
  const [loadingVendedores, setLoadingVendedores] = useState(true);

  // ── Unsaved changes guard ─────────────────────────────────────────────────
  const initialFormSnapshot = useRef<string>("");
  const snapshotCaptured    = useRef(false);
  const isDirtyRef          = useRef(false);
  const handleNavigateRef   = useRef<(href: string) => void>(() => {});
  const searchInputRef      = useRef<HTMLInputElement>(null);

  // ── Vinculação de cliente cadastrado a proposta manual (orçamento rápido) ──
  // Snapshot completo do estado pré-vinculação: selectCliente recalcula itens
  // (bônus/preço fixo) e zera fretes — restaurar campo a campo seria frágil.
  const [isVinculandoCliente, setIsVinculandoCliente] = useState(false);
  const vinculacaoBackupRef = useRef<{
    form: PropostaFormState;
    cliente: Cadastro | null;
    clientSearch: string;
    proposalContacts: CadastroContato[];
    proposalAddresses: CadastroEndereco[];
    lastDestinationKey: string;
    lastShipmentKey: string;
    nomeClienteManual: string;
  } | null>(null);
  // Época da cotação automática: incrementada ao iniciar/cancelar a
  // vinculação. Respostas TARDIAS de cotação (fetches já em voo quando o
  // estado foi trocado/restaurado) são descartadas comparando a época
  // capturada no início da cotação com a atual — sem isso, uma cotação do
  // destino antigo sobrescreveria os fretes do estado restaurado.
  const cotacaoEpochRef = useRef(0);

  useEffect(() => {
    if (mode === "new" && !cliente && searchInputRef.current) {
      searchInputRef.current.focus();
      const length = searchInputRef.current.value.length;
      searchInputRef.current.setSelectionRange(length, length);
    }
  }, [mode, cliente]);
  const [isUnsavedModalOpen, setIsUnsavedModalOpen] = useState(false);
  const [unsavedModalMode, setUnsavedModalMode] = useState<"default" | "pagamentos">("default");
  const [carteiraWarning, setCarteiraWarning] = useState<string | null>(null);
  const [pendingNavigation,  setPendingNavigation]  = useState<string | null>(null);
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    let active = true;
    async function loadSellers() {
      try {
        const result = await listVendedoresReais();
        if (active) {
          setDbVendedores(result);
        }
      } catch (err) {
        console.error("Erro ao buscar vendedores reais:", err);
      } finally {
        if (active) {
          setLoadingVendedores(false);
        }
      }
    }
    void loadSellers();
    return () => {
      active = false;
    };
  }, []);

  const vendedorOptions = useMemo(() => {
    const list: { label: string; value: string }[] = [];
    if (!loadingVendedores && dbVendedores.length > 0) {
      dbVendedores.forEach((v) => {
        list.push({
          label: v.nome_usuario,
          value: v.nome_usuario
        });
      });
    }

    // Preservar vendedor salvo ao editar proposta existente
    const savedVendedor = proposta?.vendedor;
    if (savedVendedor && savedVendedor.trim() !== "") {
      const exists = list.some(
        (opt) => opt.value.toLowerCase() === savedVendedor.toLowerCase()
      );
      if (!exists) {
        list.unshift({
          label: savedVendedor,
          value: savedVendedor
        });
      }
    }

    return list;
  }, [dbVendedores, loadingVendedores, proposta?.vendedor]);

  const vendedorExibido = canAlterarVendedor
    ? form.vendedor
    : (cliente && getClienteVendedorPadrao(cliente) && getClienteVendedorPadrao(cliente) !== "Não informado")
      ? getClienteVendedorPadrao(cliente)
      : form.vendedor;

  const freteEscolhido = form.fretes.find((frete) => frete.id === form.freteEscolhidoId);
  const bonusPercent = cliente ? getClienteBonusPercent(cliente) : 0;
  
  const resumo = useMemo(() => {
    if (form.isAvulso) {
      const subtotalProdutos = parseCurrencyBR(form.valorProdutosManual) ?? 0;
      const frete = parseCurrencyBR(form.valorFreteManual) ?? 0;
      return {
        subtotalProdutos,
        subtotalBrutoProdutos: subtotalProdutos,
        acrescimoBonus: 0,
        descontoGeralTipo: "VALOR" as TipoDescontoProposta,
        descontoGeralValor: 0,
        descontoGeral: 0,
        frete,
        valorTotal: subtotalProdutos + frete,
        pesoTotal: 0,
        prazoProducao: "A combinar",
        prazoEntrega: "A combinar"
      };
    }
    return calculateResumo(form.itens, form.fretes, Number(form.descontoGeralValor) || 0, form.descontoGeralTipo);
  }, [form.isAvulso, form.valorProdutosManual, form.valorFreteManual, form.itens, form.fretes, form.descontoGeralValor, form.descontoGeralTipo]);

  const volumes = Math.max(1, Math.ceil(resumo.pesoTotal / 14500));

  const combinedAddresses = useMemo(() => {
    const seenIds = new Set<string>();
    const list: (CadastroEndereco & { _isSocioAddr?: boolean })[] = [];
    const isSocioSelected = Boolean(
      form.compradorId && 
      form.compradorId !== form.clienteId && 
      form.compradorId !== `cli_${form.clienteId}`
    );

    // Inject the saved proposal address ONLY if it is currently selected, to prevent premature overwrites while loading
    if (proposta?.enderecoEntrega && proposta.enderecoEntrega.id === form.enderecoId && !seenIds.has(proposta.enderecoEntrega.id)) {
      seenIds.add(proposta.enderecoEntrega.id);
      list.push({
        ...proposta.enderecoEntrega,
        _isSocioAddr: isSocioSelected
      });
    }

    if (!isSocioSelected) {
      proposalAddresses.forEach((addr) => {
        if (!seenIds.has(addr.id)) {
          seenIds.add(addr.id);
          list.push({
            ...addr,
            _isSocioAddr: false
          });
        }
      });
    } else {
      const sortedComprador = sortEnderecosPorPrioridade(compradorAddresses);
      sortedComprador.forEach((addr) => {
        if (!seenIds.has(addr.id)) {
          seenIds.add(addr.id);
          list.push({
            ...addr,
            _isSocioAddr: true
          });
        }
      });
      // Também exibir endereços do cliente principal quando sócio está selecionado
      proposalAddresses.forEach((addr) => {
        if (!seenIds.has(addr.id)) {
          seenIds.add(addr.id);
          list.push({
            ...addr,
            _isSocioAddr: false
          });
        }
      });
    }

    return list;
  }, [proposalAddresses, compradorAddresses, proposta?.enderecoEntrega, form.compradorId, form.clienteId, form.enderecoId]);

  // isDirty: compares current form (excluding system-generated fretes) with saved snapshot
  const isDirty = useMemo(() => {
    if (!snapshotCaptured.current || !initialFormSnapshot.current) return false;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { fretes: _f, ...curr } = form;
    return JSON.stringify(curr) !== initialFormSnapshot.current;
  }, [form]);

  // Keep ref in sync so event handlers always see the latest value
  handleNavigateRef.current = (href: string) => {
    if (isDirty) {
      setPendingNavigation(href);
      setIsUnsavedModalOpen(true);
    } else {
      router.push(href);
    }
  };
  isDirtyRef.current = isDirty;

  const currentAddress = useMemo(() => {
    return combinedAddresses.find((a) => a.id === form.enderecoId);
  }, [combinedAddresses, form.enderecoId]);

  const isFreightOutdated = useMemo(() => {
    const currentDestKey = getDestinationKey(
      form.clienteNaoCadastrado ?? false,
      form.cepLivre,
      form.cidadeLivre,
      form.ufLivre,
      form.nomeClienteLivre,
      form.enderecoId,
      currentAddress
    );
    const currentShipKey = getShipmentKey(resumo.pesoTotal, volumes, form.itens);
    return lastDestinationKey !== currentDestKey || lastShipmentKey !== currentShipKey;
  }, [
    form.clienteNaoCadastrado,
    form.nomeClienteLivre,
    form.cepLivre,
    form.cidadeLivre,
    form.ufLivre,
    form.enderecoId,
    currentAddress,
    resumo.pesoTotal,
    volumes,
    form.itens,
    lastDestinationKey,
    lastShipmentKey
  ]);

  const hasValidCepForFreight = useMemo(() => {
    const cep = form.clienteNaoCadastrado ? form.cepLivre : currentAddress?.cep;
    return Boolean(cep && String(cep).replace(/\D/g, "").length === 8);
  }, [form.clienteNaoCadastrado, form.cepLivre, currentAddress?.cep]);

  const hasProductsAndWeight = useMemo(() => {
    return form.itens.length > 0 && resumo.pesoTotal > 0;
  }, [form.itens.length, resumo.pesoTotal]);


  const selectedContact = proposalContacts.find((c) => c.id === form.contatoId);
  const contatoNome = form.clienteNaoCadastrado ? "Contato Rápido" : (selectedContact ? selectedContact.nome : "");

  const informalText = buildPropostaInformalText({
    id_int: form.id_int || "NOVO",
    clienteNome: form.clienteNaoCadastrado ? (form.nomeClienteLivre || "Cliente não cadastrado") : (cliente?.nome ?? "Cliente não definido"),
    itens: form.itens,
    frete: form.isAvulso ? {
      id: "frete_manual",
      id_int: Number(form.id_int) || 0,
      transportadora: form.observacoesFreteManual || "Frete Manual",
      servico: "",
      valor: resumo.frete,
      prazo: "A combinar",
      observacao: "",
      escolhido: true,
      pesoUsado: 0
    } : freteEscolhido,
    resumo,
    formaPagamento: form.formaPagamento,
    isAvulso: form.isAvulso,
    contatoNome,
    cidade: form.clienteNaoCadastrado ? form.cidadeLivre : currentAddress?.cidade,
    uf: form.clienteNaoCadastrado ? form.ufLivre : currentAddress?.uf,
    bonusPercent: bonusPercent
  });

  // Fetch products catalog
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await listProdutos({ pageSize: 1000, ativo: true });
        if (active) {
          setProdutos(list);
        }
      } catch (err) {
        console.error("Erro ao carregar catálogo de produtos:", err);
      } finally {
        if (active) setLoadingProdutos(false);
      }
    })();
    return () => { active = false; };
  }, []);

  // Load variations for initial items in edit mode
  useEffect(() => {
    if (mode !== "edit" || !proposta || proposta.itens.length === 0) {
      return;
    }

    let active = true;
    inicializacoesPendentes.current += 1;
    void (async () => {
      try {
        const enrichedItens = await Promise.all(
          proposta.itens.map(async (item) => {
            try {
              const vinculos = await listProdutoVariacaoVinculos(item.id_produto);
              return {
                ...item,
                produto: {
                  ...item.produto,
                  variacoes: vinculos
                }
              };
            } catch (err) {
              console.error(`Erro ao carregar variações do produto #${item.id_produto} na inicialização:`, err);
              return item;
            }
          })
        );

        if (active) {
          setForm((current) => ({
            ...current,
            itens: enrichedItens
          }));
        }
      } catch (err) {
        console.error("Erro na inicialização de variações da proposta:", err);
      } finally {
        inicializacoesPendentes.current -= 1;
      }
    })();

    return () => {
      active = false;
    };
  }, [mode, proposta]);

  // Debounced client search
  useEffect(() => {
    const search = clientSearch.trim();
    if (!search || search.length < 2) {
      const t = setTimeout(() => {
        setClientResults([]);
        setSearchError(null);
      }, 0);
      return () => clearTimeout(t);
    }

    const isSelectionString = /^\d+\s*-\s*/.test(search);
    if (isSelectionString) {
      return;
    }

    let active = true;
    const timeout = setTimeout(async () => {
      setIsSearchingClients(true);
      setSearchError(null);
      try {
        const res = await getCadastrosReadOnlyList({
          search,
          categoria: "CLIENTE",
          pageSize: 10,
          pageIndex: 0
        });
        if (active) {
          if (res && res.cadastros) {
            setClientResults(res.cadastros);
          } else {
            setClientResults([]);
          }
        }
      } catch (err) {
        console.error("Erro ao buscar clientes:", err);
        if (active) {
          setSearchError("Erro ao carregar clientes do servidor.");
          setClientResults([]);
        }
      } finally {
        if (active) setIsSearchingClients(false);
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [clientSearch]);

  // Automatic city/state lookup for quick budgets
  useEffect(() => {
    if (!form.clienteNaoCadastrado) return;
    const cleanCep = (form.cepLivre || "").replace(/\D/g, "");
    if (cleanCep.length === 8) {
      let active = true;
      void (async () => {
        setCepLivreLoading(true);
        try {
          const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
          if (response.ok && active) {
            const data = await response.json();
            if (!data.erro) {
              updateField("cidadeLivre", data.localidade || "");
              updateField("ufLivre", data.uf || "");
              showToast({
                type: "success",
                title: "Localização encontrada",
                description: `${data.localidade}/${data.uf}`
              });
            } else {
              showToast({
                type: "warning",
                title: "CEP não encontrado",
                description: "Verifique o número digitado ou preencha cidade/UF manualmente."
              });
            }
          }
        } catch (err) {
          console.error("Erro ao buscar CEP via ViaCEP:", err);
        } finally {
          if (active) setCepLivreLoading(false);
        }
      })();
      return () => {
        active = false;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.cepLivre, form.clienteNaoCadastrado]);

  // Load comprador's addresses when compradorId changes
  useEffect(() => {
    if (!form.compradorId || !cliente) {
      setTimeout(() => setCompradorAddresses([]), 0);
      return;
    }
    const vinculo = cliente.vinculosComerciais?.find((v) => v.id === form.compradorId);
    if (!vinculo) {
      setTimeout(() => setCompradorAddresses([]), 0);
      return;
    }

    let active = true;
    setLoadingCompradorAddresses(true);
    void (async () => {
      try {
        const { cadastro } = await getCadastroCompleto(vinculo.idClienteRelacionado);
        if (active && cadastro) {
          const addrs = cadastro.enderecos || [];
          setTimeout(() => {
            setCompradorAddresses(addrs);
          }, 0);
        }
      } catch (err) {
        console.error("Erro ao carregar endereços do comprador/autorizado:", err);
        if (active) setTimeout(() => setCompradorAddresses([]), 0);
      } finally {
        if (active) setLoadingCompradorAddresses(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [form.compradorId, cliente]);

  // Fallback: recarregar endereços do cliente principal se proposalAddresses estiver vazio
  useEffect(() => {
    if (!cliente || form.clienteNaoCadastrado || proposalAddresses.length > 0) return;
    let active = true;
    void (async () => {
      try {
        const { cadastro } = await getCadastroCompleto(cliente.idCliente);
        if (active && cadastro && (cadastro.enderecos || []).length > 0) {
          setProposalAddresses(cadastro.enderecos);
        }
      } catch (err) {
        console.error("[OrcamentoForm] Erro ao recarregar endereços do cliente principal:", err);
      }
    })();
    return () => { active = false; };
  }, [cliente?.idCliente]); // eslint-disable-line react-hooks/exhaustive-deps

  // Capture initial snapshot once (after mount effects settle)
  //
  // A janela fixa de 600ms não bastava: modelos, engine de status e variações
  // dos itens escrevem no form quando a rede responde, e o que chegasse depois
  // marcava o formulário como alterado sem o usuário ter mexido em nada. Agora
  // a captura espera esses carregamentos (`inicializacoesPendentes`), com um
  // teto de tempo para que uma requisição travada nunca deixe o guard de
  // alterações desligado.
  useEffect(() => {
    const limite = Date.now() + TEMPO_MAXIMO_ESPERA_SNAPSHOT_MS;

    const capturar = () => {
      if (snapshotCaptured.current) return;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { fretes: _f, ...snap } = formRef.current;
      initialFormSnapshot.current = JSON.stringify(snap);
      snapshotCaptured.current = true;
    };

    const intervalo = setInterval(() => {
      const esgotou = Date.now() >= limite;
      if (!esgotou && inicializacoesPendentes.current > 0) return;
      capturar();
      clearInterval(intervalo);
    }, INTERVALO_VERIFICACAO_SNAPSHOT_MS);

    return () => clearInterval(intervalo);
  }, []);

  // beforeunload — warn on tab close / refresh when dirty
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Intercept internal link clicks (sidebar, breadcrumbs, etc.) when dirty
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!isDirtyRef.current) return;
      const anchor = (e.target as Element).closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto')) return;
      e.preventDefault();
      handleNavigateRef.current(href);
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, []);

  // Intercept browser back button when dirty
  useEffect(() => {
    if (!isDirty) return;
    window.history.pushState(null, '', window.location.href);
    const handler = () => {
      window.history.pushState(null, '', window.location.href);
      setPendingNavigation('/orcamentos');
      setIsUnsavedModalOpen(true);
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [isDirty]);

  // Adjust selected address if no longer in combinedAddresses
  useEffect(() => {
    if (loadingCompradorAddresses) return;

    if (combinedAddresses.length > 0) {
      const exists = combinedAddresses.some((addr) => addr.id === form.enderecoId);
      if (!exists) {
        const defaultAddr = 
          combinedAddresses.find((e) => (e.tipo || "").trim().toLowerCase() === "principal") || 
          combinedAddresses.find((e) => (e.tipo || "").trim().toLowerCase() === "entrega") || 
          combinedAddresses[0];
        updateField("enderecoId", defaultAddr ? defaultAddr.id : "");
      }
    } else {
      updateField("enderecoId", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedAddresses, form.enderecoId, loadingCompradorAddresses]);

  // Debounced auto-quote when address, weight, or volumes change
  useEffect(() => {
    if (form.isAvulso) {
      return;
    }
    const cep = form.clienteNaoCadastrado ? form.cepLivre : currentAddress?.cep;
    const cidade = form.clienteNaoCadastrado ? form.cidadeLivre : currentAddress?.cidade;
    const uf = form.clienteNaoCadastrado ? form.ufLivre : currentAddress?.uf;
    if (!cep || resumo.pesoTotal <= 0 || volumes <= 0) {
      return;
    }

    const currentDestKey = getDestinationKey(
      form.clienteNaoCadastrado ?? false,
      form.cepLivre,
      form.cidadeLivre,
      form.ufLivre,
      form.nomeClienteLivre,
      form.enderecoId,
      currentAddress
    );
    const currentShipKey = getShipmentKey(resumo.pesoTotal, volumes, form.itens);

    if (currentDestKey === lastDestinationKey && currentShipKey === lastShipmentKey) {
      return;
    }

    const isDestChanged = currentDestKey !== lastDestinationKey;

    const timer = setTimeout(async () => {
      // Época capturada no início desta cotação: se a vinculação de cliente
      // for iniciada/cancelada enquanto os fetches estão em voo, a época muda
      // e o resultado desta cotação é descartado (ver cotacaoEpochRef).
      const epochAtStart = cotacaoEpochRef.current;
      setIsQuotingSedex(true);
      setIsQuotingAzul(true);
      setIsQuotingVeppo(true);

      let transportadorasPromise = Promise.resolve([] as PropostaFrete[]);
      if (cidade && uf) {
        setIsQuotingTransp(true);
        transportadorasPromise = solicitarCotacaoTransportadoras({
          peso: resumo.pesoTotal,
          cidade,
          uf
        }).catch((err) => {
          console.error("Erro na cotação automática de Transportadoras:", err);
          return [];
        }).finally(() => {
          setIsQuotingTransp(false);
        });
      }

      let sedexResults: PropostaFrete[] = [];
      let azulResults: PropostaFrete[] = [];
      let transpResults: PropostaFrete[] = [];
      let veppoResults: PropostaFrete[] = [];

      await Promise.all([
        (async () => {
          try {
            sedexResults = await solicitarCotacaoSedex({
              peso: resumo.pesoTotal,
              vol: volumes,
              cep
            });
          } catch (err) {
            console.error("Erro na cotação automática SEDEX:", err);
          } finally {
            setIsQuotingSedex(false);
          }
        })(),
        (async () => {
          if (uf?.toUpperCase() === "RS") {
            setIsQuotingAzul(false);
            return;
          }
          try {
            azulResults = await solicitarCotacaoAzulCargo({
              peso: resumo.pesoTotal,
              cep,
              valorTotal: resumo.subtotalProdutos
            });
          } catch (err) {
            console.error("Erro na cotação automática Azul Cargo:", err);
          } finally {
            setIsQuotingAzul(false);
          }
        })(),
        (async () => {
          transpResults = await transportadorasPromise;
        })(),
        (async () => {
          if (!cidade || !uf) {
            setIsQuotingVeppo(false);
            return;
          }
          try {
            veppoResults = await solicitarCotacaoVeppo({
              peso: resumo.pesoTotal,
              valor: resumo.subtotalProdutos,
              cidade,
              uf
            });
          } catch (err) {
            console.error("Erro na cotação automática VEPPO:", err);
          } finally {
            setIsQuotingVeppo(false);
          }
        })()
      ]);

      // Resposta tardia: o estado do formulário foi trocado/restaurado pela
      // vinculação de cliente depois que esta cotação começou — descarta tudo
      // (não grava fretes nem avança as chaves de destino/embarque).
      if (cotacaoEpochRef.current !== epochAtStart) {
        return;
      }

      const allResults = [...sedexResults, ...azulResults, ...transpResults, ...veppoResults];
      if (uf?.toUpperCase() === "RS") {
        allResults.push({
          id: "frete_retira_balcao",
          id_int: proposta?.id_int ?? 0,
          transportadora: "Retirada Local",
          servico: "Sem custo",
          valor: 0.00,
          prazo: "Imediato",
          observacao: "Retirar pessoalmente no balcão da empresa",
          escolhido: false,
          pesoUsado: resumo.pesoTotal
        });
      }

      setForm((prev) => {
        // Preservação de frete só vale para mudanças de peso/produto no mesmo destino. Mudança de endereço invalida a cotação anterior.
        let nextEscolhidoId = "";
        let foundMatch = false;

        const manualFretes = prev.fretes
          .filter((f) => f.id.startsWith("manual_") || f.observacao === "Cadastro manual")
          .map((f) => ({ ...f, escolhido: false }));

        let currentChosen = prev.fretes.find((f) => f.id === prev.freteEscolhidoId || f.escolhido);
        let isManual = currentChosen && (currentChosen.id.startsWith("manual_") || currentChosen.observacao === "Cadastro manual");

        if (isDestChanged) {
          currentChosen = undefined;
          isManual = false;
        }

        const updatedResults = allResults.map((newFrete) => {
          if (currentChosen && !isManual && areFreightsEqual(newFrete, currentChosen)) {
            nextEscolhidoId = newFrete.id;
            foundMatch = true;
            return { ...newFrete, escolhido: true };
          }
          return { ...newFrete, escolhido: false };
        });

        if (currentChosen && isManual) {
          nextEscolhidoId = currentChosen.id;
          foundMatch = true;
          manualFretes.forEach((f) => {
            if (f.id === currentChosen.id) {
              f.escolhido = true;
            }
          });
        }

        const preservedFretes: PropostaFrete[] = [];
        if (currentChosen && !foundMatch) {
          nextEscolhidoId = currentChosen.id;
          foundMatch = true;
          if (!isManual) {
            let obs = currentChosen.observacao;
            if (obs && obs.includes("(Preservado)")) {
              // Keep it
            } else {
              obs = obs ? `${obs} (Preservado)` : "Frete preservado";
            }

            const isRetirada = 
              normalizeName(currentChosen.transportadora).includes("retirada") || 
              normalizeName(currentChosen.transportadora).includes("retira") ||
              normalizeName(currentChosen.servico).includes("retirada") ||
              normalizeName(currentChosen.servico).includes("retira");

            preservedFretes.push({
              ...currentChosen,
              escolhido: true,
              observacao: obs,
              pesoUsado: isRetirada ? resumo.pesoTotal : currentChosen.pesoUsado,
              valor: isRetirada ? 0.00 : currentChosen.valor
            });
          } else {
            manualFretes.forEach((f) => {
              if (f.id === currentChosen.id) {
                f.escolhido = true;
              }
            });
          }
        }

        // Cotação nova (sem escolha anterior e mesmo destino): pré-seleciona o
        // SEDEX quando disponível; sem SEDEX, mantém a primeira opção.
        if (!currentChosen && !isDestChanged && updatedResults.length > 0) {
          const padrao = escolherFretePadrao(updatedResults);
          if (padrao) {
            padrao.escolhido = true;
            nextEscolhidoId = padrao.id;
          }
        }

        const merged = [...updatedResults, ...manualFretes, ...preservedFretes];

        // De-duplicate by stable key (transportadora + servico)
        const uniqueMerged: PropostaFrete[] = [];
        const seenKeys = new Set<string>();

        // Add chosen freight first to guarantee it is kept if duplicate
        const chosenFreight = merged.find(f => f.escolhido || f.id === nextEscolhidoId);
        if (chosenFreight) {
          uniqueMerged.push(chosenFreight);
          seenKeys.add(getStableFreightKey(chosenFreight));
        }

        merged.forEach((f) => {
          const key = getStableFreightKey(f);
          if (!seenKeys.has(key)) {
            uniqueMerged.push(f);
            seenKeys.add(key);
          }
        });

        return {
          ...prev,
          fretes: uniqueMerged,
          freteEscolhidoId: nextEscolhidoId
        };
      });

      setLastDestinationKey(currentDestKey);
      setLastShipmentKey(currentShipKey);
    }, 600);

    return () => clearTimeout(timer);
  }, [
    form.clienteNaoCadastrado,
    form.nomeClienteLivre,
    form.cepLivre,
    form.cidadeLivre,
    form.ufLivre,
    form.enderecoId,
    currentAddress,
    resumo.pesoTotal,
    volumes,
    lastDestinationKey,
    lastShipmentKey,
    resumo.subtotalProdutos,
    form.isAvulso,
    showToast
  ]);



  const handleBriefingChange = useCallback((draft: BriefingArtesDraft) => {
    setForm((current) => {
      if (JSON.stringify(current.briefingArtesDraft) === JSON.stringify(draft)) {
        return current;
      }
      return { ...current, briefingArtesDraft: draft };
    });
  }, []);

  function updateField<K extends keyof PropostaFormState>(field: K, value: PropostaFormState[K]) {
    if (field === "vendedor" && !canAlterarVendedor && !form.clienteNaoCadastrado) {
      return;
    }

    setForm((current) => ({ ...current, [field]: value }));
    setErrorFields((current) => current.filter((item) => item !== field));
  }

  function handleSelectEndereco(newEnderecoId: string) {
    const isSocio = form.compradorId && form.compradorId !== form.clienteId;
    if (!isSocio) {
      updateField("enderecoId", newEnderecoId);
      return;
    }

    const principalAddr = compradorAddresses.find(a => (a as any).tipo_endereco === "Principal" || a.tipo === "principal") || compradorAddresses[0];
    if (principalAddr && newEnderecoId !== principalAddr.id) {
      setPendingEnderecoSelection(newEnderecoId);
    } else {
      updateField("enderecoId", newEnderecoId);
    }
  }

  function confirmEnderecoSocio() {
    if (!pendingEnderecoSelection) return;
    const chosenAddr = combinedAddresses.find(a => a.id === pendingEnderecoSelection);
    if (!chosenAddr?.cpfRecebedor) {
      showToast({ type: "error", title: "Ação bloqueada", description: "Não posso selecionar este endereço. Precisa incluir CPF do RECEBEDOR." });
      setPendingEnderecoSelection(null);
      return;
    }
    updateField("enderecoId", pendingEnderecoSelection);
    setPendingEnderecoSelection(null);
  }

  function cancelEnderecoSocio() {
    setPendingEnderecoSelection(null);
  }

  async function handleSelectComprador(id: string) {
    const nextId = form.compradorId === id ? "" : id;
    updateField("compradorId", nextId);

    if (form.id_int === "NOVO" || !cliente) return;
    
    const idIntNum = Number(form.id_int);
    let targetClienteIdRelacionado = cliente.idCliente;
    let newEnderecoId: string | null = null;
    
    if (nextId && nextId !== cliente.id.toString()) {
       const vinculo = cliente.vinculosComerciais?.find((v) => v.id === nextId);
       if (vinculo) {
         targetClienteIdRelacionado = vinculo.idClienteRelacionado;
         
         try {
           const { cadastro } = await getCadastroCompleto(vinculo.idClienteRelacionado);
           if (cadastro) {
              setCompradorAddresses(cadastro.enderecos || []);
              const addrs = sortEnderecosPorPrioridade(cadastro.enderecos || []);
              const principalAddr = addrs[0];
              
              if (principalAddr) {
                 newEnderecoId = principalAddr.id;
                 updateField("enderecoId", newEnderecoId);
              } else {
                 showToast({ type: "warning", title: "Pagador sem endereço", description: "Pagador alterado, mas ele não possui endereço cadastrado." });
              }
           }
         } catch(e) {
           console.error("Erro fetch enderecos do pagador:", e);
         }
       }
    } else {
       const addrs = sortEnderecosPorPrioridade(cliente.enderecos || []);
       const principalAddr = addrs[0];
       if (principalAddr) {
          newEnderecoId = principalAddr.id;
          updateField("enderecoId", newEnderecoId);
       }
    }
    
    const { success, errorMessage } = await updatePropostaFiscalDados(idIntNum, targetClienteIdRelacionado, newEnderecoId ?? null);
    if (!success) {
      showToast({ type: "error", title: "Falha ao salvar pagador", description: errorMessage || "Não foi possível atualizar os dados fiscais na proposta." });
    }
  }

  function recalculateItem(item: PropostaItem, nextBonusPercent = bonusPercent, nextClienteParam = cliente, preservePrice = false) {
    let nextValorUnitario = item.valorUnitario;
    let nextValorFixo = item.valorFixo;

    // preservePrice: mantém o valor unitário/fixo já presente no item (edição manual
    // autorizada). Quando false, reaplica o preço automático do produto ou da tabela
    // especial do cliente — comportamento padrão para quem não tem permissão e para
    // o repricing ao (re)selecionar o cliente.
    if (!preservePrice) {
      if (nextClienteParam?.usaPrecoFixo && nextClienteParam.precosFixos) {
        const pFixo = nextClienteParam.precosFixos.find(p => p.id_produto === item.id_produto);
        if (pFixo) {
          nextValorUnitario = pFixo.preco_fixo;
          nextValorFixo = 0;
        } else {
          nextValorUnitario = item.produto.valorUnt;
          nextValorFixo = item.produto.valorFixo;
        }
      } else {
        nextValorUnitario = item.produto.valorUnt;
        nextValorFixo = item.produto.valorFixo;
      }
    }

    const updatedItem = { ...item, valorUnitario: nextValorUnitario, valorFixo: nextValorFixo };
    const totals = calculateItemSubtotal(updatedItem, nextBonusPercent);

    return {
      ...updatedItem,
      ...totals,
      pesoTotal: calculateItemWeight(updatedItem)
    };
  }
  const handleClearCliente = useCallback((searchReset: string = "") => {
    setCliente(null);
    setClientSearch(searchReset);
    setProposalContacts([]);
    setProposalAddresses([]);
    updateField("clienteId", "");
    updateField("contatoId", "");
    updateField("enderecoId", "");
    updateField("compradorId", "");
    updateField("vendedor", "");
    updateField("empresa", "");
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [updateField]);

  // ── Vincular cliente cadastrado a proposta manual (modo edição) ───────────
  function iniciarVinculacaoCliente() {
    // Regra financeira completa: qualquer cobrança ativa OU pagamento
    // confirmado bloqueia a troca de cliente — inclusive para admin/superadmin.
    // (O save de proposta paga iria para /api/orcamentos/editar-paga, que
    // rejeita id_cliente divergente do banco; e trocar o cliente sob cobrança
    // emitida geraria inconsistência financeira.)
    if (hasActiveCobranca || isPropostaPagaAtual) {
      showToast({
        type: "error",
        title: "Vinculação bloqueada",
        description: "Esta proposta possui cobrança ativa ou pagamento confirmado. Cancele as cobranças antes de vincular um cliente cadastrado."
      });
      return;
    }

    vinculacaoBackupRef.current = {
      form,
      cliente,
      clientSearch,
      proposalContacts,
      proposalAddresses,
      lastDestinationKey,
      lastShipmentKey,
      nomeClienteManual: form.nomeClienteLivre || proposta?.cliente?.nome || "Cliente não cadastrado",
    };
    cotacaoEpochRef.current += 1; // descarta cotações em voo do destino manual
    setIsVinculandoCliente(true);
    setForm((prev) => ({
      ...prev,
      clienteNaoCadastrado: false,
      clienteId: "",
      contatoId: "",
      enderecoId: "",
      compradorId: "",
      nomeClienteLivre: "",
      cepLivre: "",
      cidadeLivre: "",
      ufLivre: ""
    }));
    setCliente(null);
    setClientSearch("");
    setClientResults([]);
    setShowClientResults(false);
    setProposalContacts([]);
    setProposalAddresses([]);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
    showToast({
      type: "info",
      title: "Vinculação de cliente",
      description: "Busque o cliente cadastrado. Preços e frete serão recalculados pelo cadastro selecionado."
    });
  }

  function cancelarVinculacaoCliente() {
    const backup = vinculacaoBackupRef.current;
    if (!backup) {
      setIsVinculandoCliente(false);
      return;
    }
    cotacaoEpochRef.current += 1; // descarta cotações tardias disparadas durante a vinculação
    setForm(backup.form);
    setCliente(backup.cliente);
    setClientSearch(backup.clientSearch);
    setProposalContacts(backup.proposalContacts);
    setProposalAddresses(backup.proposalAddresses);
    setLastDestinationKey(backup.lastDestinationKey);
    setLastShipmentKey(backup.lastShipmentKey);
    setClientResults([]);
    setShowClientResults(false);
    vinculacaoBackupRef.current = null;
    setIsVinculandoCliente(false);
  }

  // Conclui a vinculação após save bem-sucedido: registra a troca no
  // Histórico e limpa o backup ANTES de qualquer onReload — a prop `proposta`
  // recarregada já nasce com o cliente oficial e o backup não pode "vazar"
  // para um cancelamento posterior.
  function concluirVinculacaoAposSave(finalIdInt: number | string, formSalvo: PropostaFormState) {
    const backup = vinculacaoBackupRef.current;
    if (!backup) return;
    vinculacaoBackupRef.current = null;
    setIsVinculandoCliente(false);
    void registrarMensagemSistemaProposta({
      idInt: Number(finalIdInt) || 0,
      idCliente: Number(formSalvo.clienteId) || null,
      mensagem: `Cliente manual "${backup.nomeClienteManual}" vinculado ao cadastro #${formSalvo.clienteId}${cliente?.nome ? ` — ${cliente.nome}` : ""}.`,
      setor: "Sistema"
    }).catch((err) => {
      console.warn("[OrcamentoFormPage] Falha ao registrar histórico da vinculação de cliente:", err);
    });
  }

  async function selectCliente(basicCliente: Cadastro) {
    setShowClientResults(false);
    setClientSearch(`${basicCliente.idCliente} - ${basicCliente.nome}`);
    setErrorFields((current) => current.filter((item) => item !== "clienteId"));
    
    try {
      const res = await getCadastroCompleto(basicCliente.idCliente);
      const nextCliente = res.cadastro || basicCliente;
      const enderLista = nextCliente.enderecos || [];
      const nextEndereco = enderLista.find(e => e.tipo === "entrega") 
        || enderLista.find(e => e.tipo === "principal") 
        || enderLista[0];
      const nextContacts = nextCliente.contatos || [];
      const nextBonus = getClienteBonusPercent(nextCliente);
      const recalculatedItems = form.itens.map((item) => recalculateItem(item, nextBonus, nextCliente));

      setCliente(nextCliente);
      setProposalContacts(nextContacts);
      setProposalAddresses(nextCliente.enderecos || []);
      
      const defaultVendedor = getClienteVendedorPadrao(nextCliente);
      const hasSeller = defaultVendedor && defaultVendedor !== "Não informado";
      if (!hasSeller) {
        showToast({
          type: "warning",
          title: "Vendedor não vinculado",
          description: "Este cliente não possui um vendedor padrão cadastrado. Selecione o vendedor manualmente."
        });
      }
      const fallbackEmpresa = nextCliente.empresaPadrao && nextCliente.empresaPadrao !== "Não informado"
        ? nextCliente.empresaPadrao
        : "Ideal Grafica";

      setForm((current) => ({
        ...current,
        clienteId: nextCliente.idCliente.toString(),
        contatoId: nextContacts[0]?.id ?? "",
        enderecoId: nextEndereco?.id ?? "",
        compradorId: nextCliente.id ? nextCliente.id.toString() : nextCliente.idCliente.toString(),
        vendedor: hasSeller ? defaultVendedor : "",
        empresa: fallbackEmpresa && fallbackEmpresa !== "Não informado" ? fallbackEmpresa : current.empresa,
        itens: recalculatedItems,
        fretes: [],
        freteEscolhidoId: ""
      }));

      const isApenasVendedor = user?.isSeller === true && !user?.isGerente && !user?.isAdmin && !user?.isSuperAdmin;
      if (isApenasVendedor && hasSeller && user?.name) {
        if (normalizeName(defaultVendedor) !== normalizeName(user.name)) {
          setCarteiraWarning(defaultVendedor);
        }
      }
    } catch (err) {
      console.error("Erro ao carregar detalhes do cliente selecionado:", err);
      showToast({
        type: "error",
        title: "Erro ao selecionar cliente",
        description: "Não foi possível carregar os endereços e contatos do cliente."
      });
      
      const nextBonus = getClienteBonusPercent(basicCliente);
      const recalculatedItems = form.itens.map((item) => recalculateItem(item, nextBonus));
      setCliente(basicCliente);
      setProposalContacts([]);
      setProposalAddresses([]);
      const defaultVendedor = getClienteVendedorPadrao(basicCliente);
      const hasSeller = defaultVendedor && defaultVendedor !== "Não informado";
      if (!hasSeller) {
        showToast({
          type: "warning",
          title: "Vendedor não vinculado",
          description: "Este cliente não possui um vendedor padrão cadastrado. Selecione o vendedor manualmente."
        });
      }

      const isApenasVendedor = user?.isSeller === true && !user?.isGerente && !user?.isAdmin && !user?.isSuperAdmin;
      if (isApenasVendedor && hasSeller && user?.name) {
        if (normalizeName(defaultVendedor) !== normalizeName(user.name)) {
          setCarteiraWarning(defaultVendedor);
        }
      }

      setCliente(basicCliente);
      setProposalContacts([]);
      setProposalAddresses([]);
      setForm((current) => ({
        ...current,
        clienteId: basicCliente.idCliente.toString(),
        contatoId: "",
        enderecoId: "",
        compradorId: basicCliente.id ? basicCliente.id.toString() : basicCliente.idCliente.toString(),
        vendedor: hasSeller ? defaultVendedor : "",
        empresa: basicCliente.empresaPadrao && basicCliente.empresaPadrao !== "Não informado" ? basicCliente.empresaPadrao : current.empresa,
        itens: recalculatedItems,
        fretes: [],
        freteEscolhidoId: ""
      }));
    }
  }

  function addContact() {
    if (!contactDraft.nome || !contactDraft.whatsapp) {
      showToast({ type: "warning", title: "Contato incompleto", description: "Informe nome e WhatsApp para adicionar o contato." });
      return;
    }

    const contact: CadastroContato = { id: `cont_prop_${Date.now()}`, ...contactDraft };
    setProposalContacts((current) => [...current, contact]);
    updateField("contatoId", contact.id);
    setContactDraft({ nome: "", cargo: "", whatsapp: "", email: "" });
    setIsContactModalOpen(false);
    showToast({ type: "success", title: "Contato adicionado à proposta." });
  }

  function openEditContact(contato: CadastroContato) {
    setEditingContactId(contato.id);
    setEditContactDraft({
      nome: contato.nome,
      cargo: contato.cargo ?? "",
      whatsapp: contato.whatsapp,
      email: contato.email ?? ""
    });
  }

  function saveEditedContact() {
    if (!editContactDraft.nome || !editContactDraft.whatsapp) {
      showToast({ type: "warning", title: "Contato incompleto", description: "Informe nome e WhatsApp para salvar o contato." });
      return;
    }

    setProposalContacts((current) =>
      current.map((c) => (c.id === editingContactId ? { ...c, ...editContactDraft } : c))
    );

    setEditingContactId(null);
    showToast({ type: "success", title: "Contato atualizado com sucesso (Modo Local)" });
  }

  async function addAddress() {
    if (!form.clienteId) {
      showToast({ type: "warning", title: "Cliente obrigatório", description: "Selecione o cliente da proposta antes de adicionar um novo endereço." });
      return;
    }

    if (!addressDraft.cep || !addressDraft.endereco || !addressDraft.numero || !addressDraft.cidade || !addressDraft.uf) {
      showToast({ type: "warning", title: "Endereço incompleto", description: "Preencha CEP, logradouro, número, cidade e UF." });
      return;
    }

    if (addressModalMode === "edit" && editingAddressId) {
      setIsSavingAddress(true);
      try {
        const { success, data, errorMessage } = await updateEnderecoProposta(editingAddressId, {
          ...addressDraft,
        });

        if (!success || !data) {
          showToast({ type: "error", title: "Erro ao atualizar endereço", description: errorMessage || "Não foi possível atualizar o endereço no banco." });
          return;
        }

        setProposalAddresses((current) =>
          current.map((addr) => (addr.id === editingAddressId ? data : addr))
        );
        setAddressDraft({ tipo: "entrega", cep: "", endereco: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", recebedor: "", cpfRecebedor: "" });
        setEditingAddressId(null);
        setAddressModalMode("create");
        setIsAddressModalOpen(false);
        showToast({ type: "success", title: "Endereço salvo com sucesso." });
      } catch (err) {
        showToast({ type: "error", title: "Erro na requisição", description: "Não foi possível salvar o endereço." });
      } finally {
        setIsSavingAddress(false);
      }
      return;
    }

    setIsSavingAddress(true);
    try {
      const { success, data, errorMessage } = await insertEnderecoProposta({
        ...addressDraft,
        id_cliente: Number(form.clienteId)
      });

      if (!success || !data) {
        showToast({ type: "error", title: "Erro ao salvar endereço", description: errorMessage || "Não foi possível salvar o endereço no banco." });
        return;
      }

      setProposalAddresses((current) => [...current, data]);
      updateField("enderecoId", data.id);
      setAddressDraft({ tipo: "entrega", cep: "", endereco: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", recebedor: "", cpfRecebedor: "" });
      setIsAddressModalOpen(false);
      showToast({ type: "success", title: "Endereço adicionado à proposta e salvo no banco de dados." });
    } catch (err) {
      showToast({ type: "error", title: "Erro na requisição", description: "Ocorreu um problema ao tentar persistir o endereço." });
    } finally {
      setIsSavingAddress(false);
    }
  }

  /**
   * Produto repetido é permitido (mesmo produto com variações/configurações
   * diferentes na mesma proposta). Quando o id_produto já existe, o usuário
   * decide no modal: ajustar o item existente ou criar uma nova linha.
   */
  async function addProduct(productId: string) {
    const produto = produtos.find((item) => item.id_produto.toString() === productId.toString());

    if (!produto) {
      return;
    }

    const itensDoProduto = form.itens.filter(
      (item) => item.id_produto === produto.id_produto && item.statusItem !== "REMOVIDO"
    );

    if (itensDoProduto.length > 0) {
      // Alvo de "Atualizar quantidade": a última linha do produto na proposta.
      setDuplicateProductPrompt({
        productId: produto.id_produto.toString(),
        nomeProduto: produto.nomeReal,
        idProduto: produto.id_produto,
        existingItemId: itensDoProduto[itensDoProduto.length - 1].id,
        totalLinhas: itensDoProduto.length
      });
      return;
    }

    await addProductLine(productId);
  }

  /** Insere de fato uma nova linha do produto no orçamento. */
  async function addProductLine(productId: string) {
    const produto = produtos.find((item) => item.id_produto.toString() === productId.toString());

    if (!produto) {
      return;
    }

    const initialQty = produto.quantidade_minima_venda ?? 1000;

    let precoFixoBase: number | undefined = undefined;
    if (cliente?.usaPrecoFixo && cliente.precosFixos) {
      const precoFixoData = cliente.precosFixos.find(p => p.id_produto === produto.id_produto);
      if (precoFixoData) {
        precoFixoBase = precoFixoData.preco_fixo;
      }
    }

    try {
      const vinculos = await listProdutoVariacaoVinculos(produto.id_produto);
      const enrichedProduto = {
        ...produto,
        variacoes: vinculos
      };
      const item = createItemFromProduto(enrichedProduto, initialQty, bonusPercent, false, precoFixoBase);
      updateField("itens", [...form.itens, item]);
      setOpenItemIds((current) => ({ ...current, [item.id]: true }));
      showToast({ type: "success", title: "Produto adicionado", description: `${produto.nomeReal} incluído no orçamento.` });
    } catch (err) {
      console.error("Erro ao carregar variações do produto:", err);
      const item = createItemFromProduto(produto, initialQty, bonusPercent, false, precoFixoBase);
      updateField("itens", [...form.itens, item]);
      setOpenItemIds((current) => ({ ...current, [item.id]: true }));
      showToast({ type: "success", title: "Produto adicionado", description: `${produto.nomeReal} incluído no orçamento.` });
    }
  }


  const handleRemoveProductClick = (itemId: string) => {
    const item = form.itens.find((i) => i.id === itemId);
    if (!item) return;

    // 🔒 Verificar cobrança ativa ANTES de permitir remoção visual
    const targetIdInt = form.id_int && form.id_int !== "NOVO" ? Number(form.id_int) : null;
    if (targetIdInt) {
      const cobrancasDaProposta = getCobrancasByProposta(targetIdInt);
      const cobrancaAtiva = cobrancasDaProposta.some(
        (c) => c.status !== "CANCELADO"
      );
      if (cobrancaAtiva) {
        // Sem permissão de editar proposta paga → bloqueio total (comportamento anterior).
        if (!canEditarPropostaPaga) {
          showToast({
            type: "error",
            title: "Remoção bloqueada",
            description: "Não é possível remover produtos pois existe uma cobrança ativa. Cancele ou exclua a cobrança pendente antes."
          });
          return; // Produto NÃO some da tela
        }
        // Com permissão: permitir inativação lógica reversível, EXCETO se o item já tem
        // vínculo de pedido/arte/produção — nesse caso a produção/NF precisa ser tratada antes.
        const temVinculoProducao = form.pedidosModelos.some(
          (m) =>
            (((m.id_produto_proposta_origem && item.id_produto_proposta_origem && m.id_produto_proposta_origem === item.id_produto_proposta_origem) ||
              (m.item_temp_id && m.item_temp_id === item.id))) &&
            (m.isPersisted || (!!m.status_producao && m.status_producao.trim() !== "") || (!!m.status_arte && m.status_arte.trim() !== ""))
        );
        if (temVinculoProducao) {
          showToast({
            type: "error",
            title: "Inativação bloqueada",
            description: "Este produto já possui pedido/arte/produção vinculada. Cancele ou conclua a produção (e a NF, se houver) antes de inativá-lo."
          });
          return; // Produto NÃO some da tela
        }
        // Autorizado e sem vínculo → segue para o confirm (inativação lógica reversível).
      }
    }

    if (process.env.NODE_ENV === "development") {
      console.log("[DEV] handleRemoveProductClick:", {
        itemId,
        nome: item.nome,
        id_produto_proposta_origem: item.id_produto_proposta_origem ?? null,
      });
    }

    setDeletingProductId(itemId);
    setDeleteProductConfirmOpen(true);
  };

  const confirmRemoveProduct = async () => {
    if (!deletingProductId) return;
    const item = form.itens.find((i) => i.id === deletingProductId);
    if (!item) {
      setDeleteProductConfirmOpen(false);
      setDeletingProductId(null);
      return;
    }

    const dbId = item.id_produto_proposta_origem ?? null;
    const isRealDbItem = dbId !== null && dbId > 0;

    if (process.env.NODE_ENV === "development") {
      console.log("[DEV] confirmRemoveProduct — DELETE IMEDIATO:", {
        item_id_local: deletingProductId,
        id_produto_proposta_origem: dbId,
        isRealDbItem,
      });
    }

    const isPaidProposal = canEditarPropostaPaga && hasActiveCobranca;

    if (isPaidProposal) {
      // Inativação lógica para proposta paga (não adiciona em deletedProdutoPropostaIds)
      setForm(prev => ({
        ...prev,
        itens: prev.itens.map(it => it.id === deletingProductId ? { ...it, statusItem: "CANCELADO" } : it),
      }));
      setDeleteProductConfirmOpen(false);
      setDeletingProductId(null);
      showToast({ type: "success", title: "Produto inativado", description: "O produto foi marcado como cancelado/inativo localmente. Salve para persistir." });
      return;
    }

    // Se item existe no banco: DELETE imediatamente (cascade remove pedidos_modelos)
    if (isRealDbItem) {
      setIsDeletingProduct(true);
      try {
        const client = getSupabaseClient();
        if (!client) throw new Error("Cliente Supabase indisponível.");

        const { data: deletedRows, error: deleteError } = await client
          .from("produtos_proposta")
          .delete()
          .eq("id", dbId)
          .select("id");

        if (process.env.NODE_ENV === "development") {
          console.log("[DEV] Retorno do DELETE imediato:", { deletedRows, deleteError });
        }

        if (deleteError) {
          showToast({
            type: "error",
            title: "Erro ao excluir produto",
            description: "Não foi possível remover o produto do banco de dados. Tente novamente."
          });
          return; // Produto NÃO some da tela
        }

        if (!deletedRows || deletedRows.length === 0) {
          showToast({
            type: "error",
            title: "Erro ao excluir produto",
            description: "O produto não foi encontrado no banco ou a exclusão foi bloqueada. Recarregue a página."
          });
          return; // Produto NÃO some da tela
        }

        // DELETE confirmado — agora remove do estado local
        if (process.env.NODE_ENV === "development") {
          console.log("[DEV] DELETE confirmado. Removendo produto do estado local.");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro desconhecido ao excluir produto.";
        showToast({ type: "error", title: "Erro ao excluir produto", description: msg });
        return;
      } finally {
        setIsDeletingProduct(false);
      }
    }

    // Remove produto e modelos vinculados do estado visual
    const newItens = form.itens.filter((current) => current.id !== deletingProductId);
    let newModelos = form.pedidosModelos;
    newModelos = form.pedidosModelos.filter(
      (m) =>
        !((m.id_produto_proposta_origem && item.id_produto_proposta_origem && m.id_produto_proposta_origem === item.id_produto_proposta_origem) ||
          (m.item_temp_id && m.item_temp_id === item.id))
    );

    setForm(prev => ({
      ...prev,
      itens: newItens,
      pedidosModelos: newModelos,
      // Garante que o ID não fique pendente na lista de exclusão (já foi deletado)
      deletedProdutoPropostaIds: prev.deletedProdutoPropostaIds.filter(id => id !== dbId),
    }));

    showToast({
      type: "success",
      title: "Produto excluído",
      description: isRealDbItem
        ? "Produto e seus modelos foram removidos permanentemente."
        : "Produto removido do orçamento."
    });

    setDeleteProductConfirmOpen(false);
    setDeletingProductId(null);
  };

  function updateItem(itemId: string, updater: (item: PropostaItem) => PropostaItem) {
    updateField(
      "itens",
      form.itens.map((item) => (item.id === itemId ? recalculateItem(updater(item), bonusPercent, cliente, canEditarValoresItem) : item))
    );
  }

  /**
   * Único ponto de escrita de form.pedidosModelos vindo da aba Pedido.
   *
   * Recebe um atualizador e o aplica sobre o estado corrente. A aba não entrega
   * mais o array pronto: montado a partir do array capturado no render, ele
   * desfazia alterações concorrentes (vários modelos abertos ao mesmo tempo,
   * respostas de gravação chegando depois).
   */
  const aplicarPatchModelos = useCallback(
    (atualizar: (prev: PedidoModeloState[]) => PedidoModeloState[]) => {
      setForm((prev) => ({ ...prev, pedidosModelos: atualizar(prev.pedidosModelos) }));
      setErrorFields((current) => current.filter((item) => item !== "pedidosModelos"));
    },
    []
  );

  /**
   * Propaga o texto consolidado de variações do item para os modelos ligados a
   * ele (aba Pedidos). O vínculo é o do próprio fluxo — id_produto_proposta_origem
   * para item já persistido, item_temp_id para item novo — nunca id_produto,
   * porque o mesmo produto pode ter várias linhas com variações diferentes.
   * A gravação em si acontece no saveProposta; aqui é só o estado da tela.
   */
  function syncVariacoesTextoDosModelos(item: PropostaItem) {
    const texto = formatVariacoesItem(item);
    setForm((prev) => ({
      ...prev,
      pedidosModelos: prev.pedidosModelos.map((m) => {
        const pertenceAoItem =
          (m.id_produto_proposta_origem && item.id_produto_proposta_origem
            && m.id_produto_proposta_origem === item.id_produto_proposta_origem) ||
          (m.item_temp_id && m.item_temp_id === item.id);
        return pertenceAoItem ? { ...m, variacoes_texto: texto } : m;
      })
    }));
  }

  function updateItemVariation(itemId: string, id_variacao: number, tipoId: string) {
    let itemAtualizado: PropostaItem | null = null;

    updateItem(itemId, (item) => {
      const vinculo = item.produto.variacoes.find((variacao) => variacao.id_variacao === id_variacao);
      const tipo = vinculo?.tipos.find((tipoVariacao) => tipoVariacao.id === tipoId);

      let nextVariacoes = item.variacoesEscolhidas;

      if (!vinculo || !tipo) {
        // If deselected or not found, remove the choice
        nextVariacoes = item.variacoesEscolhidas.filter((c) => c.id_variacao !== id_variacao);
      } else {
        const newChoice = {
          id: `pv_sel_${item.id_produto}_${id_variacao}_${Date.now()}`,
          id_variacao,
          variacao: vinculo.variacao,
          tipo
        };
        nextVariacoes = [...item.variacoesEscolhidas.filter((c) => c.id_variacao !== id_variacao), newChoice];
      }

      itemAtualizado = {
        ...item,
        variacoesEscolhidas: nextVariacoes
      };
      return itemAtualizado;
    });

    // Mantém o card da aba Pedidos coerente com a variação recém-escolhida.
    if (itemAtualizado) {
      syncVariacoesTextoDosModelos(itemAtualizado);
    }
  }

  function handleSaveItem(itemId: string) {
    const item = form.itens.find((it) => it.id === itemId);
    if (!item) return;

    if (item.quantidade <= 0) {
      showToast({
        type: "error",
        title: "Quantidade inválida",
        description: "A quantidade do item deve ser maior que zero."
      });
      return;
    }

    if (
      item.produto.quantidade_minima_venda !== null &&
      item.produto.quantidade_minima_venda !== undefined &&
      item.quantidade < item.produto.quantidade_minima_venda
    ) {
      showToast({
        type: "error",
        title: "Quantidade mínima exigida",
        description: `Quantidade mínima para este produto: ${item.produto.quantidade_minima_venda} unidades.`
      });
      return;
    }

    if (item.produto.variacoes && item.produto.variacoes.length > 0) {
      const missingVariations = item.produto.variacoes.filter(
        (v) => v.is_obrigatorio && !item.variacoesEscolhidas.some((choice) => choice.id_variacao === v.id_variacao)
      );
      if (missingVariations.length > 0) {
        showToast({
          type: "error",
          title: "Variação obrigatória",
          description: `Selecione a opção obrigatória para: ${missingVariations.map((v) => v.variacao.nome).join(", ")}.`
        });
        setErrorFields((prev) => [...prev, `variacoes_${itemId}`]);
        return;
      }
    }

    setErrorFields((prev) => prev.filter((field) => field !== `variacoes_${itemId}`));

    const updatedItem = recalculateItem(item, bonusPercent, cliente, canEditarValoresItem);
    updateField(
      "itens",
      form.itens.map((it) => (it.id === itemId ? updatedItem : it))
    );

    setOpenItemIds((prev) => ({ ...prev, [itemId]: false }));
  }

  function handleEditItem(itemId: string) {
    setOpenItemIds((prev) => ({ ...prev, [itemId]: true }));
  }

  /**
   * Duplica um item mantendo quantidade, preços, descontos, observações e
   * variações; a cópia entra logo abaixo do original.
   *
   * A cópia NÃO herda id_produto_proposta_origem/id_int (vínculo com a linha
   * já persistida no banco) nem os modelos do pedido do original — é uma
   * linha nova, que o usuário ajusta em seguida.
   */
  function handleDuplicateItem(itemId: string) {
    const index = form.itens.findIndex((it) => it.id === itemId);
    if (index === -1) return;

    const original = form.itens[index];
    const {
      id: _id,
      id_produto_proposta_origem: _origem,
      id_int: _idInt,
      ...rest
    } = original;

    const copia: PropostaItem = {
      ...rest,
      id: novoItemId(original.id_produto),
      statusItem: "PENDENTE",
      variacoesEscolhidas: original.variacoesEscolhidas.map((escolha) => ({ ...escolha }))
    };

    const proximosItens = [...form.itens];
    proximosItens.splice(index + 1, 0, copia);
    updateField("itens", proximosItens);
    setOpenItemIds((prev) => ({ ...prev, [copia.id]: true }));

    showToast({
      type: "success",
      title: "Produto duplicado",
      description: `Nova linha de "${original.nome}" criada. Ajuste o que precisar.`
    });
  }

  async function handleCotarFretes() {
    const cep = form.clienteNaoCadastrado ? form.cepLivre : combinedAddresses.find((e) => e.id === form.enderecoId)?.cep;
    const cidade = form.clienteNaoCadastrado ? form.cidadeLivre : combinedAddresses.find((e) => e.id === form.enderecoId)?.cidade;
    const uf = form.clienteNaoCadastrado ? form.ufLivre : combinedAddresses.find((e) => e.id === form.enderecoId)?.uf;

    if (!cep) {
      showToast({
        type: "error",
        title: "CEP não encontrado",
        description: form.clienteNaoCadastrado
          ? "Informe o CEP para entrega / cálculo de frete."
          : "Selecione um endereço de entrega válido com CEP para cotar."
      });
      return;
    }

    if (resumo.pesoTotal <= 0) {
      showToast({
        type: "error",
        title: "Peso inválido",
        description: "Adicione pelo menos um produto com peso maior que zero para cotar."
      });
      return;
    }

    if (volumes <= 0 || !Number.isInteger(volumes)) {
      showToast({
        type: "error",
        title: "Volumes inválido",
        description: "Informe uma quantidade de volumes válida (maior que zero)."
      });
      return;
    }

    const currentDestKey = getDestinationKey(
      form.clienteNaoCadastrado ?? false,
      form.cepLivre,
      form.cidadeLivre,
      form.ufLivre,
      form.nomeClienteLivre,
      form.enderecoId,
      currentAddress
    );
    const currentShipKey = getShipmentKey(resumo.pesoTotal, volumes, form.itens);

    const isDestChanged = currentDestKey !== lastDestinationKey;

    setIsQuotingSedex(true);
    setIsQuotingAzul(true);

    let sedexResults: PropostaFrete[] = [];
    let azulResults: PropostaFrete[] = [];
    let transpResults: PropostaFrete[] = [];
    let veppoResults: PropostaFrete[] = [];

    let sedexError = "";
    let azulError = "";
    let transpError = "";
    let veppoError = "";

    let transportadorasPromise = Promise.resolve([] as PropostaFrete[]);
    if (!cidade || !uf) {
      transpError = "Cidade ou UF não preenchida no endereço de entrega.";
    } else {
      setIsQuotingTransp(true);
      transportadorasPromise = solicitarCotacaoTransportadoras({
        peso: resumo.pesoTotal,
        cidade,
        uf
      }).catch((err) => {
        console.error("Erro ao cotar Transportadoras manualmente:", err);
        transpError = err instanceof Error ? err.message : "Erro desconhecido";
        return [];
      }).finally(() => {
        setIsQuotingTransp(false);
      });
    }

    await Promise.all([
      (async () => {
        try {
          sedexResults = await solicitarCotacaoSedex({
            peso: resumo.pesoTotal,
            vol: volumes,
            cep
          });
        } catch (err) {
          console.error("Erro ao cotar SEDEX manualmente:", err);
          sedexError = err instanceof Error ? err.message : "Erro desconhecido";
        } finally {
          setIsQuotingSedex(false);
        }
      })(),
      (async () => {
        if (uf?.toUpperCase() === "RS") {
          setIsQuotingAzul(false);
          return;
        }
        try {
          azulResults = await solicitarCotacaoAzulCargo({
            peso: resumo.pesoTotal,
            cep,
            valorTotal: resumo.subtotalProdutos
          });
        } catch (err) {
          console.error("Erro ao cotar Azul Cargo manualmente:", err);
          azulError = err instanceof Error ? err.message : "Erro desconhecido";
        } finally {
          setIsQuotingAzul(false);
        }
      })(),
      (async () => {
        transpResults = await transportadorasPromise;
      })(),
      (async () => {
        setIsQuotingVeppo(true);
        try {
          veppoResults = await solicitarCotacaoVeppo({
            peso: resumo.pesoTotal,
            valor: resumo.subtotalProdutos,
            cidade: cidade!,
            uf: uf!
          });
        } catch (err) {
          console.error("Erro ao cotar VEPPO manualmente:", err);
          veppoError = err instanceof Error ? err.message : "Erro desconhecido";
        } finally {
          setIsQuotingVeppo(false);
        }
      })()
    ]);

    // Find currently selected frete
    let currentChosen = form.fretes.find((f) => f.id === form.freteEscolhidoId || f.escolhido);
    let isManual = currentChosen && (currentChosen.id.startsWith("manual_") || currentChosen.observacao === "Cadastro manual");

    // Keep manual fretes
    const manualFretes = form.fretes
      .filter((f) => f.id.startsWith("manual_") || f.observacao === "Cadastro manual")
      .map((f) => ({ ...f, escolhido: false }));

    if (isDestChanged) {
      // Preservação de frete só vale para mudanças de peso/produto no mesmo destino. Mudança de endereço invalida a cotação anterior.
      currentChosen = undefined;
      isManual = false;
    }

    let nextEscolhidoId = "";
    let foundMatch = false;

    const allResults = [...sedexResults, ...azulResults, ...transpResults, ...veppoResults];
    if (uf?.toUpperCase() === "RS") {
      allResults.push({
        id: "frete_retira_balcao",
        id_int: form.id_int ? Number(form.id_int) : 0,
        transportadora: "Retirada Local",
        servico: "Sem custo",
        valor: 0.00,
        prazo: "Imediato",
        observacao: "Retirar pessoalmente no balcão da empresa",
        escolhido: false,
        pesoUsado: resumo.pesoTotal
      });
    }

    const updatedResults = allResults.map((newFrete) => {
      if (currentChosen && !isManual && areFreightsEqual(newFrete, currentChosen)) {
        nextEscolhidoId = newFrete.id;
        foundMatch = true;
        return { ...newFrete, escolhido: true };
      }
      return { ...newFrete, escolhido: false };
    });

    if (currentChosen && isManual) {
      nextEscolhidoId = currentChosen.id;
      foundMatch = true;
      manualFretes.forEach((f) => {
        if (f.id === currentChosen.id) {
          f.escolhido = true;
        }
      });
    }

    const preservedFretes: PropostaFrete[] = [];
    if (currentChosen && !foundMatch) {
      nextEscolhidoId = currentChosen.id;
      foundMatch = true;
      if (!isManual) {
        let obs = currentChosen.observacao;
        if (obs && obs.includes("(Preservado)")) {
          // Keep it
        } else {
          obs = obs ? `${obs} (Preservado)` : "Frete preservado";
        }

        const isRetirada = 
          normalizeName(currentChosen.transportadora).includes("retirada") || 
          normalizeName(currentChosen.transportadora).includes("retira") ||
          normalizeName(currentChosen.servico).includes("retirada") ||
          normalizeName(currentChosen.servico).includes("retira");

        preservedFretes.push({
          ...currentChosen,
          escolhido: true,
          observacao: obs,
          pesoUsado: isRetirada ? resumo.pesoTotal : currentChosen.pesoUsado,
          valor: isRetirada ? 0.00 : currentChosen.valor
        });
      } else {
        manualFretes.forEach((f) => {
          if (f.id === currentChosen.id) {
            f.escolhido = true;
          }
        });
      }
    }

    // Cotação nova (sem escolha anterior e mesmo destino): pré-seleciona o
    // SEDEX quando disponível; sem SEDEX, mantém a primeira opção.
    if (!currentChosen && !isDestChanged && updatedResults.length > 0) {
      const padrao = escolherFretePadrao(updatedResults);
      if (padrao) {
        padrao.escolhido = true;
        nextEscolhidoId = padrao.id;
      }
    }

    const merged = [...updatedResults, ...manualFretes, ...preservedFretes];

    // De-duplicate by stable key (transportadora + servico)
    const uniqueMerged: PropostaFrete[] = [];
    const seenKeys = new Set<string>();

    // Add chosen freight first to guarantee it is kept if duplicate
    const chosenFreight = merged.find(f => f.escolhido || f.id === nextEscolhidoId);
    if (chosenFreight) {
      uniqueMerged.push(chosenFreight);
      seenKeys.add(getStableFreightKey(chosenFreight));
    }

    merged.forEach((f) => {
      const key = getStableFreightKey(f);
      if (!seenKeys.has(key)) {
        uniqueMerged.push(f);
        seenKeys.add(key);
      }
    });

    setForm((prev) => ({
      ...prev,
      fretes: uniqueMerged,
      freteEscolhidoId: nextEscolhidoId
    }));

    setLastDestinationKey(currentDestKey);
    setLastShipmentKey(currentShipKey);

    // Toast warnings/success consolidation
    const errorsList = [];
    if (sedexError) errorsList.push(`SEDEX: ${sedexError}`);
    if (azulError) errorsList.push(`Azul Cargo: ${azulError}`);
    if (transpError) errorsList.push(`Transportadoras: ${transpError}`);

    if (errorsList.length === 3) {
      showToast({
        type: "error",
        title: "Falha na cotação de todos os fretes",
        description: errorsList.join(" | ")
      });
    } else if (errorsList.length > 0) {
      showToast({
        type: "warning",
        title: "Cotação parcial realizada",
        description: `Alguns serviços falharam: ${errorsList.join(" | ")}`
      });
    } else {
      showToast({
        type: "success",
        title: "Cotação realizada",
        description: "Opções de frete atualizadas com sucesso."
      });
    }
  }

  async function handleSaveManualFrete() {
    if (!manualFreteDraft.servico || !manualFreteDraft.prazo || !manualFreteDraft.valor) {
      showToast({
        type: "warning",
        title: "Campos incompletos",
        description: "Preencha o transportador/serviço, prazo e valor do frete."
      });
      return;
    }

    const newManualFrete: PropostaFrete = {
      id: `manual_${Date.now()}`,
      id_int: Number(form.id_int) || 0,
      transportadora: manualFreteDraft.servico,
      servico: manualFreteDraft.servico,
      valor: Number(manualFreteDraft.valor),
      prazo: manualFreteDraft.prazo,
      observacao: "Cadastro manual",
      escolhido: manualFreteDraft.escolhido,
      pesoUsado: resumo.pesoTotal
    };

    const updatedFretes = form.fretes.map((f) => ({
      ...f,
      escolhido: manualFreteDraft.escolhido ? false : f.escolhido
    }));

    if (manualFreteDraft.escolhido) {
      updatedFretes.push(newManualFrete);
      setForm((current) => ({
        ...current,
        fretes: updatedFretes,
        freteEscolhidoId: newManualFrete.id
      }));
    } else {
      updatedFretes.push(newManualFrete);
      setForm((current) => ({
        ...current,
        fretes: updatedFretes
      }));
    }

    showToast({
      type: "success",
      title: "Frete manual adicionado",
      description: "Cotação manual gravada temporariamente em memória."
    });

    setIsManualFreteModalOpen(false);
    setManualFreteDraft({ servico: "", prazo: "", valor: "", escolhido: true });
  }

  async function selectFrete(freteId: string) {
    const updatedFretes = form.fretes.map((frete) => ({ ...frete, escolhido: frete.id === freteId }));
    setForm((current) => ({
      ...current,
      fretes: updatedFretes,
      freteEscolhidoId: freteId
    }));
  }

  async function copyInformal() {
    await navigator.clipboard?.writeText(informalText);
    showToast({ type: "success", title: "Resumo copiado", description: "Proposta informal copiada para WhatsApp." });
  }

  function validateBeforeSave(vendedorAtual = form.vendedor) {
    const isNonEmpty = (value: unknown): boolean => {
      return value !== null && value !== undefined && String(value).trim() !== "";
    };

    const itemWithMinQtyError = !form.isAvulso && form.itens.find((item) =>
      item.produto.quantidade_minima_venda !== null &&
      item.produto.quantidade_minima_venda !== undefined &&
      item.quantidade < item.produto.quantidade_minima_venda
    );

    if (itemWithMinQtyError) {
      showToast({
        type: "error",
        title: "Quantidade mínima não atendida",
        description: `O produto "${itemWithMinQtyError.produto.nomeReal}" exige a quantidade mínima de ${itemWithMinQtyError.produto.quantidade_minima_venda} unidades.`
      });
      setErrorFields([`quantidade_${itemWithMinQtyError.id}`]);
      return false;
    }

    const missingRequiredVariation = !form.isAvulso && form.itens.some((item) =>
      item.produto.variacoes.some(
        (variacao) => variacao.is_obrigatorio && !item.variacoesEscolhidas.some((choice) => choice.id_variacao === variacao.id_variacao)
      )
    );
    const hasInvalidQuantity = !form.isAvulso && form.itens.some((item) => item.quantidade <= 0);
    const hasInvalidSubtotal = !form.isAvulso && form.itens.some((item) => item.subtotal <= 0);
    const isSubtotalZero = resumo.subtotalProdutos <= 0;
    const isTotalZero = resumo.valorTotal <= 0;
    const isTextEmpty = !isNonEmpty(informalText);
    const isSellerEmpty = !isNonEmpty(vendedorAtual);
    const isCompanyEmpty = !isNonEmpty(form.empresa);

    const hasUnauthorizedGeneralDiscount = !canEditarDescontoGeral && Number(form.descontoGeralValor) > 0;
    const sellerChangedWithoutPermission = Boolean(cliente && vendedorAtual !== getClienteVendedorPadrao(cliente) && !canAlterarVendedor);

    const fields = [
      !form.clienteNaoCadastrado && !isNonEmpty(form.clienteId) ? "clienteId" : null,
      form.clienteNaoCadastrado && !isNonEmpty(form.nomeClienteLivre) ? "nomeClienteLivre" : null,
      form.clienteNaoCadastrado && !isNonEmpty(form.cepLivre) ? "cepLivre" : null,
      !form.clienteNaoCadastrado && !isNonEmpty(form.enderecoId) ? "enderecoId" : null,
      !form.clienteNaoCadastrado && !isNonEmpty(form.contatoId) ? "contatoId" : null,
      !form.isAvulso && form.itens.length === 0 ? "itens" : null,
      !form.isAvulso && hasInvalidQuantity ? "quantidade" : null,
      !form.isAvulso && hasInvalidSubtotal ? "subtotal_itens" : null,
      isSubtotalZero ? "subtotal" : null,
      isTotalZero ? "total" : null,
      isTextEmpty ? "texto" : null,
      isSellerEmpty ? "vendedor" : null,
      isCompanyEmpty ? "empresa" : null,
      !form.isAvulso && missingRequiredVariation ? "variacoes" : null
    ].filter(Boolean) as string[];

    if (fields.length) {
      setErrorFields(fields);
      let title = "Não foi possível salvar";
      let desc = "Revise cliente, contato, endereço, produtos, quantidades e variações obrigatórias.";
      
      if (!form.clienteNaoCadastrado && !isNonEmpty(form.clienteId)) {
        title = "Cliente obrigatório";
        desc = "Selecione um cliente para a proposta.";
      } else if (form.clienteNaoCadastrado && !isNonEmpty(form.nomeClienteLivre)) {
        title = "Nome do cliente obrigatório";
        desc = "Informe o nome do cliente ou empresa.";
      } else if (form.clienteNaoCadastrado && !isNonEmpty(form.cepLivre)) {
        title = "CEP obrigatório";
        desc = "Informe o CEP para entrega / cálculo de frete.";
      } else if (!form.clienteNaoCadastrado && !isNonEmpty(form.contatoId)) {
        title = "Contato obrigatório";
        desc = "Selecione um contato antes de salvar o orçamento.";
      } else if (!form.clienteNaoCadastrado && !isNonEmpty(form.enderecoId)) {
        title = "Endereço obrigatório";
        desc = "Selecione um endereço de entrega antes de salvar o orçamento.";
      } else if (isSellerEmpty) {
        title = "Vendedor obrigatório";
        desc = "Selecione um vendedor antes de salvar o orçamento.";
      } else if (isCompanyEmpty) {
        title = "Empresa obrigatória";
        desc = "A empresa é obrigatória.";
      } else if (!form.isAvulso && form.itens.length === 0) {
        title = "Produtos obrigatórios";
        desc = "Adicione pelo menos um produto ao orçamento.";
      } else if (isSubtotalZero || isTotalZero) {
        title = "Valor inválido";
        desc = form.isAvulso
          ? "Informe o valor dos produtos antes de salvar a proposta avulsa."
          : "O valor total e o subtotal dos produtos devem ser maiores que R$ 0,00.";
      } else if (isTextEmpty) {
        title = "Resumo inválido";
        desc = "O resumo informal da proposta não pode ser vazio.";
      } else if (!form.isAvulso && missingRequiredVariation) {
        title = "Variação obrigatória";
        desc = "Selecione as variações obrigatórias antes de salvar.";
      } else if (!form.isAvulso && hasInvalidSubtotal) {
        title = "Subtotal inválido";
        desc = "O subtotal de cada produto deve ser maior que R$ 0,00.";
      }
      
      showToast({
        type: "error",
        title,
        description: desc
      });
      return false;
    }

    if (form.isAvulso) {
      const valProdStr = form.valorProdutosManual || "";
      const valProd = parseCurrencyBR(valProdStr);
      if (valProd === null || valProd <= 0 || !isNonEmpty(valProdStr)) {
        showToast({
          type: "error",
          title: "Valor dos produtos inválido",
          description: "Informe o valor dos produtos antes de salvar a proposta avulsa."
        });
        return false;
      }

      const valManual = parseCurrencyBR(form.valorFreteManual);
      if (valManual === null || valManual < 0 || !isNonEmpty(form.valorFreteManual)) {
        showToast({
          type: "error",
          title: "Frete obrigatório",
          description: "Selecione ou informe o frete antes de salvar o orçamento."
        });
        return false;
      }
      if (!isNonEmpty(form.observacoesFreteManual)) {
        showToast({
          type: "error",
          title: "Transportadora obrigatória",
          description: "Selecione ou informe o frete antes de salvar o orçamento."
        });
        return false;
      }
      return true;
    }

    // Validação de quantidades dos modelos vs produtos (Ressalva 4)
    for (const item of form.itens) {
      const modelosDoItem = form.pedidosModelos.filter(
        (m) => 
          (m.id_produto_proposta_origem && item.id_produto_proposta_origem && m.id_produto_proposta_origem === item.id_produto_proposta_origem) ||
          (m.item_temp_id && m.item_temp_id === item.id)
      );
      
      if (modelosDoItem.length > 0) {
        const somaModelos = modelosDoItem.reduce((acc, curr) => acc + curr.quantidade, 0);
        if (somaModelos !== item.quantidade) {
          showToast({
            type: "error",
            title: "Quantidades divergentes",
            description: `As quantidades dos modelos (${somaModelos}) não correspondem à quantidade do produto "${item.nome}" (${item.quantidade}). Revise os itens antes de salvar.`
          });
          return false;
        }
      }
    }

    // Normal proposal freight validation
    if (!isNonEmpty(form.freteEscolhidoId)) {
      showToast({
        type: "error",
        title: "Frete não selecionado",
        description: "Selecione ou informe o frete antes de salvar o orçamento."
      });
      return false;
    }

    if (hasUnauthorizedGeneralDiscount) {
      showToast({ type: "error", title: "Desconto geral não autorizado", description: "Apenas admin ou gerente pode aplicar desconto geral." });
      return false;
    }

    if (sellerChangedWithoutPermission) {
      showToast({ type: "error", title: "Vendedor não autorizado", description: "Usuário comum não pode alterar o vendedor herdado do cliente." });
      return false;
    }

    return true;
  }

  // ------------------------------------------------------------------
  // handleSave — fluxo completo
  // - Proposta normal: chama saveProposta() client-side
  // - Proposta paga (canEditarPropostaPaga + hasActiveCobranca):
  //   chama /api/orcamentos/editar-paga com JWT, que valida permissão
  //   server-side e cria pendência financeira se houver diferença
  // ------------------------------------------------------------------
  async function handleSave() {
    // Bloqueio absoluto (vale para admin/superadmin): avulsa ou sem produtos
    // ativos + paga = somente visualização/Histórico/Pagamentos. O backend
    // (editar-paga) aplica a mesma regra — este guard evita o round-trip.
    if (bloqueioAvulsaPaga) {
      showToast({
        type: "error",
        title: "Edição bloqueada",
        description: "Proposta avulsa já paga não pode ser alterada.",
      });
      return;
    }

    const vendedorParaSalvar = cliente && !canAlterarVendedor ? getClienteVendedorPadrao(cliente) : form.vendedor;

    if (!validateBeforeSave(vendedorParaSalvar)) {
      return;
    }

    const formToSave = vendedorParaSalvar !== form.vendedor
      ? { ...form, vendedor: vendedorParaSalvar }
      : form;

    if (process.env.NODE_ENV === "development") {
      console.log("[DEV] handleSave — deletedProdutoPropostaIds enviados:", formToSave.deletedProdutoPropostaIds);
    }

    setIsSaving(true);
    try {
      // — Capturar valor pago ANTES de salvar (para cálculo de diferença) —
      const valorPagoAntes = calcularValorPagoConfirmado(cobrancasVinculadas);
      const novoTotalCalculado = resumo.valorTotal;
      const idClienteNum = proposta?.cliente?.idCliente ?? (cliente?.idCliente ?? 0);

      // — Fluxo para proposta paga (usa API route server-side) —
      if (canEditarPropostaPaga && hasActiveCobranca) {
        // Obter JWT da sessão atual
        const { getSupabaseClient } = await import("@/lib/supabase/client");
        const supabase = getSupabaseClient();
        const { data: { session } } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
        const token = session?.access_token ?? "";

        if (!token) {
          showToast({ type: "error", title: "Sessão expirada", description: "Faça login novamente para editar propostas pagas." });
          setIsSaving(false);
          return;
        }

        const apiResponse = await fetch("/api/orcamentos/editar-paga", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({
            formState: formToSave,
            idInt: Number(formToSave.id_int) || 0,
            idCliente: idClienteNum,
            valorPagoConfirmado: valorPagoAntes,
            novoTotal: novoTotalCalculado,
            userEmail: user?.email,
            userName: user?.name,
          }),
        });

        const apiResult = await apiResponse.json();

        if (!apiResponse.ok || !apiResult.success) {
          showToast({
            type: apiResponse.status === 403 ? "error" : (apiResponse.status === 409 ? "warning" : "error"),
            title: apiResponse.status === 403 ? "Sem permissão" : (apiResponse.status === 409 ? "Atenção" : "Falha ao salvar"),
            description: apiResult.error ?? "Erro ao salvar proposta paga.",
          });
          if (apiResponse.status === 409 && apiResult.pendenciaAtiva) {
            setPendenciaRevisaoAberta(apiResult.pendenciaAtiva);
          }
          setIsSaving(false);
          return;
        }

        // — Pendência retornada? (diferença ≠ 0 → modal obrigatório) —
        const { diferenca, pendenciaAtiva } = apiResult;
        const idPendencia = pendenciaAtiva?.id;
        const finalIdInt = Number(formToSave.id_int);

        // Atualizar snapshot e URL (adiado se houver diferença)
        const updateSnapshotAndUrl = () => {
          const { fretes: _f, ...savedSnap } = { ...formToSave, deletedProdutoPropostaIds: [] };
          initialFormSnapshot.current = JSON.stringify(savedSnap);
          setForm(prev => ({ ...prev, deletedProdutoPropostaIds: [] }));
        };

        if (Math.abs(diferenca ?? 0) >= 0.01) {
          if (!idPendencia || !finalIdInt || !idClienteNum) {
            showToast({
              type: "error",
              title: "Erro de sistema",
              description: "A pendência de revisão não foi criada corretamente. Por favor, verifique a aba de Pendências.",
            });
            // We do NOT open the modal with partial data. We just fetch the pendência
            // de Conta Corrente (public.conta_corrente_pendencias) to show the banner if it exists.
            try {
              const { listPendenciasByProposta } = await import("@/features/cobrancas/services/conta-corrente.service");
              const pendenciasCC = await listPendenciasByProposta(finalIdInt);
              const aberta = pendenciasCC.find(p => p.status === "ABERTA" || p.status === "PARCIALMENTE_RESOLVIDA");
              if (aberta) {
                const valorPendente = Math.round((aberta.valor_saldo + aberta.valor_reservado) * 100) / 100;
                setPendenciaRevisaoAberta({
                  id: aberta.id,
                  descricao: `Diferença pendente: R$ ${valorPendente.toFixed(2).replace(".", ",")} (${aberta.direcao === "FAVOR_CLIENTE" ? "a favor do cliente" : "a favor da empresa"}). Motivo: ${aberta.motivo}.`,
                });
              }
            } catch (e) {
               // silent
            }
            updateSnapshotAndUrl();
            setIsSaving(false);
            return;
          }
          // Diferença financeira — abrir modal obrigatório
          setDiferencaModal({
            isOpen: true,
            idInt: finalIdInt,
            idCliente: idClienteNum,
            idPendencia: idPendencia, // guaranteed now
            nomeCliente: cliente?.nome ?? formToSave.nomeClienteLivre ?? "Cliente",
            valorPagoConfirmado: apiResult.valorPagoConfirmado ?? valorPagoAntes,
            novoTotal: apiResult.novoTotal ?? novoTotalCalculado,
            diferenca: diferenca,
            onResolve: (tipoAcao?: string) => {
              updateSnapshotAndUrl();
              if (onReload) onReload(true);
              fetchSaldoCredito();
              setPendenciaRevisaoAberta(null);
              if (formToSave.briefingArtesDraft) {
                salvarBriefingArtes(finalIdInt, { ...formToSave.briefingArtesDraft, status: "AGUARDANDO" })
                  .catch(err => console.error("[handleSave] Falha ao salvar artes:", err));
              }
              
              if (tipoAcao === "DEBITO_PENDENTE_COBRANCA") {
                setActiveFormTab("pagamentos");
                setAutoAbrirCobranca(true);
                setPendingNavigation(null);
                showToast({ type: "success", title: "Diferença resolvida", description: "O débito foi registrado. Abrindo a criação da cobrança complementar." });
              } else if (pendingNavigation === "?tab=pagamentos") {
                if (diferenca < 0) {
                  setActiveFormTab("produtos");
                  setPendingNavigation(null);
                  showToast({ type: "success", title: "Diferença resolvida", description: "Crédito registrado com sucesso." });
                } else {
                  setActiveFormTab("pagamentos");
                  setPendingNavigation(null);
                }
              } else if (pendingNavigation && pendingNavigation.startsWith("/")) {
                router.push(pendingNavigation);
                setPendingNavigation(null);
              } else {
                setSaveSuccessModal({ isOpen: true, finalIdInt });
              }
            },
          });
          return; // Não conclui até modal ser resolvido
        }

        // Sem diferença — concluir normalmente
        updateSnapshotAndUrl();
        if (onReload) onReload(true);

        if (formToSave.briefingArtesDraft) {
          try {
            await salvarBriefingArtes(finalIdInt, { ...formToSave.briefingArtesDraft, status: "AGUARDANDO" });
          } catch (arteErr) {
            console.error("[handleSave] Falha ao salvar artes:", arteErr);
          }
        }

        if (pendingNavigation === "?tab=pagamentos") {
          setActiveFormTab("pagamentos");
          setPendingNavigation(null);
          showToast({ type: "success", title: "Proposta atualizada", description: "Redirecionado para Pagamentos." });
        } else if (pendingNavigation && pendingNavigation.startsWith("/")) {
          router.push(pendingNavigation);
          setPendingNavigation(null);
        } else {
          showToast({ type: "success", title: "Proposta atualizada com sucesso." });
          setSaveSuccessModal({ isOpen: true, finalIdInt });
        }
        return;
      }

      // — Fluxo normal (proposta não paga) — client-side
      const res = await saveProposta(formToSave);

      if (res.success) {
        // Itens recém-inseridos: recebem o id real de produtos_proposta. Sem
        // isto o save seguinte não reconhece o item, insere outra linha e o
        // diff do serviço apaga a original — que leva junto, por cascade, os
        // modelos e as variações. O id local (item.id) é preservado: é a chave
        // de render e o vínculo item_temp_id dos modelos.
        const itensSync = res.itensSincronizados || [];
        const aplicarSyncItens = (lista: PropostaItem[]): PropostaItem[] =>
          itensSync.length === 0
            ? lista
            : lista.map((it) => {
                if (it.id_produto_proposta_origem) return it;
                const sync = itensSync.find((s) => s.itemId === it.id);
                return sync ? { ...it, id_produto_proposta_origem: sync.id } : it;
              });

        // Modelos recém-inseridos: passam a valer como persistidos, com o id do
        // banco. Sem isto eles continuariam marcados como novos e um segundo
        // save inseriria as mesmas linhas de novo em pedidos_modelos.
        const sincronizados = res.modelosSincronizados || [];
        const aplicarSync = (lista: PedidoModeloState[]): PedidoModeloState[] =>
          sincronizados.length === 0
            ? lista
            : lista.map((m) => {
                const sync = m.tempId ? sincronizados.find((s) => s.tempId === m.tempId) : undefined;
                if (!sync) return m;
                // item_temp_id é mantido de propósito: enquanto o item novo não
                // recebe o próprio id_produto_proposta_origem no estado, é por
                // ele que a aba Pedido continua ligando o modelo ao item.
                return {
                  ...m,
                  id: sync.id,
                  isPersisted: true,
                  id_produto_proposta_origem: sync.idProdutoPropostaOrigem,
                };
              });

        // O snapshot precisa refletir o estado já sincronizado, senão a tela
        // ficaria marcada como "alterações não salvas" logo após salvar.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { fretes: _f, ...savedSnap } = {
          ...formToSave,
          itens: aplicarSyncItens(formToSave.itens),
          pedidosModelos: aplicarSync(formToSave.pedidosModelos),
          deletedProdutoPropostaIds: [],
        };
        initialFormSnapshot.current = JSON.stringify(savedSnap);

        if (process.env.NODE_ENV === "development") {
          console.log("[DEV] handleSave — sucesso. deletedProdutoPropostaIds limpo.");
        }

        const finalIdInt = res.id_int || formToSave.id_int;
        if (formToSave.id_int === "NOVO") {
          window.history.replaceState(null, "", `/orcamentos/${finalIdInt}/editar`);
          setForm(prev => ({ ...prev, id_int: String(finalIdInt), deletedProdutoPropostaIds: [], itens: aplicarSyncItens(prev.itens), pedidosModelos: aplicarSync(prev.pedidosModelos) }));
        } else {
          setForm(prev => ({ ...prev, deletedProdutoPropostaIds: [], itens: aplicarSyncItens(prev.itens), pedidosModelos: aplicarSync(prev.pedidosModelos) }));
        }

        // Vinculação de cliente manual → cadastrado: histórico + limpeza do
        // backup ANTES do reload da proposta (a prop recarregada já traz o
        // novo id_cliente para Pagamentos/cobrança sem F5).
        if (vinculacaoBackupRef.current) {
          concluirVinculacaoAposSave(finalIdInt, formToSave);
          if (onReload) onReload(true);
        }

        showToast({
          type: res.errorMessage ? "info" : "success",
          title: res.errorMessage ? "Salvamento Parcial" : (mode === "edit" ? "Orçamento atualizado com sucesso." : "Orçamento criado com sucesso."),
          description: res.errorMessage || undefined
        });

        if (formToSave.briefingArtesDraft) {
          try {
            await salvarBriefingArtes(Number(finalIdInt), {
              ...formToSave.briefingArtesDraft,
              status: "AGUARDANDO"
            });
          } catch (arteErr) {
            console.error("[handleSave] Falha ao salvar rascunho de artes:", arteErr);
            showToast({
              type: "warning",
              title: "Artes não salvas",
              description: "A proposta foi salva, mas ocorreu um erro ao salvar o rascunho da aba Artes."
            });
          }
        }

        setSaveSuccessModal({ isOpen: true, finalIdInt });
      } else {
        showToast({
          type: "error",
          title: "Falha ao salvar orçamento",
          description: res.errorMessage || "Erro interno ao persistir orçamento no banco."
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ocorreu uma exceção ao tentar salvar.";
      showToast({
        type: "error",
        title: "Erro ao salvar",
        description: msg
      });
    } finally {
      setIsSaving(false);
    }
  }

  // ------------------------------------------------------------------
  // handleDiferencaConfirm — delega para /api/orcamentos/resolver-diferenca
  // - Valida permissão server-side por ação
  // - Idempotência de dois níveis (pendência + janela 5min)
  // - Mensagem na timeline via registrarMensagemSistemaProposta
  // ------------------------------------------------------------------
  async function handleDiferencaConfirm(acao: AcaoFinanceiraDiferenca) {
    if (!diferencaModal) return;

    const { idInt, idCliente, idPendencia, valorPagoConfirmado, novoTotal, diferenca, onResolve } = diferencaModal;
    const absDiff = Math.abs(diferenca);

    // Obter JWT
    const { getSupabaseClient } = await import("@/lib/supabase/client");
    const supabase = getSupabaseClient();
    const { data: { session } } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
    const token = session?.access_token ?? "";

    if (!token) {
      throw new Error("Sessão expirada. Faça login novamente.");
    }

    // Montar payload (com campos de abatimento se necessário)
    const payload: Record<string, unknown> = {
      idPendencia,
      idInt,
      idCliente,
      acao: acao.tipo,
      valor: absDiff,
      observacao: acao.obs,
    };

    if (acao.tipo === "ABATER_DEBITO") {
      payload.idDebitoAlvo = acao.idDebitoAlvo;
      payload.valorAbatimento = acao.valorAbatimento;
    }

    const apiResponse = await fetch("/api/orcamentos/resolver-diferenca", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const apiResult = await apiResponse.json();

    if (!apiResponse.ok || !apiResult.success) {
      throw new Error(apiResult.error ?? "Erro ao registrar resolução financeira.");
    }

    setDiferencaModal(null);
    onResolve(acao.tipo);
  }

  async function handleSaveForCobranca(): Promise<boolean> {
    // Avulsa/sem-produtos paga: o formulário é somente leitura — não há nada
    // legítimo a salvar. Prossegue direto para a cobrança (aba Pagamentos
    // permanece funcional), sem persistir nenhuma alteração.
    if (bloqueioAvulsaPaga) {
      return true;
    }

    if (form.id_int !== "NOVO" && form.id_int && Number(form.id_int) > 0 && !isDirty) {
      // Já está salvo e sem alterações locais
      return true;
    }

    const vendedorParaSalvar = cliente && !canAlterarVendedor ? getClienteVendedorPadrao(cliente) : form.vendedor;

    if (!validateBeforeSave(vendedorParaSalvar)) {
      return false;
    }

    const formToSave = vendedorParaSalvar !== form.vendedor
      ? { ...form, vendedor: vendedorParaSalvar }
      : form;

    try {
      const res = await saveProposta(formToSave);
      if (res.success) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { fretes: _f, ...savedSnap } = formToSave;
        initialFormSnapshot.current = JSON.stringify(savedSnap);

        const finalIdInt = res.id_int || formToSave.id_int;
        if (form.id_int === "NOVO") {
          showToast({ type: "success", title: "Orçamento salvo antes de gerar cobrança." });
          router.replace(`/orcamentos/${finalIdInt}/editar?tab=pagamentos`);
          return true;
        }
        showToast({ type: "success", title: "Orçamento atualizado antes de gerar cobrança." });
        // Vinculação de cliente manual → cadastrado: concluir (histórico +
        // limpeza do backup) ANTES do onReload.
        if (vinculacaoBackupRef.current) {
          concluirVinculacaoAposSave(finalIdInt, formToSave);
        }
        if (onReload) {
          // Silencioso: onReload() sem argumento liga o `loading` do
          // OrcamentoFormLoader, que troca o formulário inteiro pelo spinner.
          // Como quem chama isto é o próprio painel de cobrança
          // (onSavePropostaRequest), o painel e o modal aberto eram desmontados
          // no meio do fluxo — o modal "fechava sozinho" e a tela voltava ao
          // estado inicial. Todos os outros pontos de recarga já usam (true).
          await onReload(true);
        }
        return true;
      } else {
        showToast({
          type: "error",
          title: "Falha ao salvar orçamento",
          description: res.errorMessage || "Erro interno ao persistir orçamento no banco."
        });
        return false;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ocorreu uma exceção ao tentar salvar.";
      showToast({ type: "error", title: "Erro ao salvar", description: msg });
      return false;
    }
  }

  const hasPreservedFreight = form.fretes.some(
    (f) => f.id === form.freteEscolhidoId && f.observacao && (f.observacao.includes("(Preservado)") || f.observacao.includes("Frete preservado"))
  );
  const cobrancasVinculadas = proposta?.id_int ? getCobrancasByProposta(proposta.id_int) : [];
  const hasActiveCobranca = cobrancasVinculadas.some(c => c.status !== "CANCELADO");
  // Sinal oficial de "proposta paga" (mesmo critério usado em editar-paga no servidor):
  // cobrança cancelada/pendente não conta — só valor efetivamente pago/confirmado.
  const valorPagoConfirmadoAtual = calcularValorPagoConfirmado(cobrancasVinculadas);
  const isPropostaPagaAtual = valorPagoConfirmadoAtual > 0;

  // Proposta avulsa (ou sem nenhum produto ativo) JÁ PAGA não pode ser
  // alterada por NINGUÉM — inclusive admin/superadmin (caso #19486). A edição
  // autorizada de proposta paga existe para tratar alterações de produtos,
  // frete ou serviços; avulsa não tem produtos a alterar. Visualização,
  // Histórico e Pagamentos permanecem acessíveis. Backend espelha o bloqueio
  // em /api/orcamentos/editar-paga (não depende deste botão).
  const temProdutosAtivos = form.itens.some((i) => (i.statusItem || "PENDENTE") !== "CANCELADO");
  const bloqueioAvulsaPaga =
    mode === "edit" && isPropostaPagaAtual && (Boolean(form.isAvulso) || !temProdutosAtivos);

  // Desbloqueado quando usuário tem permissão E há cobrança ativa E não há pendência aberta
  const isFormBloqueadoPorCobranca =
    (hasActiveCobranca && !canEditarPropostaPaga) || pendenciaRevisaoAberta !== null || bloqueioAvulsaPaga;

  return (
    <div className="space-y-6">
      <PageHeader
        title={mode === "new" ? "Nova proposta" : `Editar proposta #${proposta?.id_int}`}
        subtitle="Integração real Supabase (clientes, catálogo de produtos, variações dinâmicas e snapshots históricos)."
        context="Orçamentos / Propostas"
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleNavigateRef.current(mode === "edit" && proposta ? `/orcamentos/${proposta.id_int}` : "/orcamentos")}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              {mode === "edit" ? "Voltar ao detalhe" : "Voltar para lista"}
            </button>
            <button type="button" onClick={handleSave} disabled={isSaving || isQuotingSedex || isQuotingAzul || isQuotingTransp || isQuotingVeppo} className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61] disabled:opacity-60">
              {isSaving ? "Salvando..." : mode === "edit" ? "Salvar alterações" : "Salvar proposta"}
            </button>
          </div>
        }
      />

      {/* Só considera cobrança CANCELADA como "sem cobrança" — nada aparece p/ proposta nova
          ou cuja única cobrança foi cancelada (ex.: teste/PIX cancelado). */}
      {hasActiveCobranca && (
        <div className={`rounded-3xl border p-4 shadow-sm flex items-start gap-3 ${
          canEditarPropostaPaga
            ? "border-amber-300 bg-amber-50 dark:border-amber-600/50 dark:bg-amber-900/30"
            : "border-amber-200 bg-amber-50"
        }`}>
          <AlertTriangle className={`h-5 w-5 shrink-0 mt-0.5 ${
            canEditarPropostaPaga ? "text-amber-600 dark:text-amber-400" : "text-amber-600"
          }`} />
          <div>
            {bloqueioAvulsaPaga ? (
              <>
                <p className="text-sm font-bold text-amber-900 dark:text-amber-200">Proposta avulsa já paga não pode ser alterada</p>
                <p className="text-sm text-amber-700 dark:text-amber-300/80 mt-1">
                  Esta proposta {form.isAvulso ? "é avulsa" : "não possui produtos cadastrados"} e já possui pagamento confirmado.
                  A edição está bloqueada para todos os perfis (inclusive administrador). Visualização, Histórico e Pagamentos permanecem disponíveis.
                </p>
              </>
            ) : canEditarPropostaPaga && isPropostaPagaAtual ? (
              <>
                <p className="text-sm font-bold text-amber-900 dark:text-amber-200">Modo Edição Autorizada — Proposta com Pagamento Confirmado</p>
                <p className="text-sm text-amber-700 dark:text-amber-300/80 mt-1">
                  Você tem permissão para editar esta proposta mesmo com cobrança ativa.
                  Se houver diferença financeira, você precisará escolher uma ação antes de concluir a alteração.
                </p>
              </>
            ) : canEditarPropostaPaga && !isPropostaPagaAtual ? (
              <>
                <p className="text-sm font-bold text-amber-900 dark:text-amber-200">Cobrança Ativa — Pagamento Ainda Não Confirmado</p>
                <p className="text-sm text-amber-700 dark:text-amber-300/80 mt-1">
                  Esta proposta possui uma cobrança em aberto que ainda não foi paga/confirmada. Revise antes de alterar valores para não gerar inconsistência com a cobrança emitida.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-bold text-amber-800">Atenção: Cobranças Geradas</p>
                <p className="text-sm text-amber-700 mt-1">
                  Esta proposta possui cobranças geradas. Revise os pagamentos antes de reenviar ou alterar valores finais.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Banner de Saldo na Conta Corrente */}
      {saldoCredito > 0 && canUsarCredito && (
        <div className="rounded-3xl border border-emerald-200 dark:border-emerald-300/40 bg-emerald-50 dark:bg-emerald-950/20 p-4 shadow-sm flex items-start gap-3">
          <span className="text-emerald-500 dark:text-emerald-400 text-lg shrink-0">💰</span>
          <div>
            <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">Saldo na Conta Corrente</p>
            <p className="text-sm text-emerald-700/80 dark:text-emerald-200/70 mt-1">
              {cliente?.nome ?? "O cliente"} possui <strong className="text-emerald-800 dark:text-emerald-300">{formatCurrency(saldoCredito)}</strong> em crédito disponível.
              Você poderá aplicar como forma de pagamento ao gerar a cobrança.
            </p>
          </div>
        </div>
      )}

      {/* Lembrete de saldo devedor na Conta Corrente (informativo — não bloqueia salvar/cobrar) */}
      {saldoDevedor > 0 && (
        <div className="rounded-3xl border border-amber-200 dark:border-amber-300/40 bg-amber-50 dark:bg-amber-950/20 p-4 shadow-sm flex items-start gap-3">
          <span className="text-amber-500 dark:text-amber-400 text-lg shrink-0">💳</span>
          <div>
            <p className="text-sm font-bold text-amber-800 dark:text-amber-300">Cliente com débito em aberto</p>
            <p className="text-sm text-amber-700/80 dark:text-amber-200/70 mt-1">
              {cliente?.nome ?? "Este cliente"} possui <strong className="text-amber-800 dark:text-amber-300">{formatCurrency(saldoDevedor)}</strong> em débito na conta corrente.
              Não é obrigatório cobrar o valor integral nesta proposta, mas considere incluir uma cobrança complementar ou negociar parte deste débito ao gerar a cobrança.
            </p>
          </div>
        </div>
      )}

      {/* Banner de revisão financeira pendente (proposta paga com diferença não resolvida) */}
      {pendenciaRevisaoAberta && (
        <div className="rounded-3xl border border-red-200 bg-red-50 p-4 shadow-sm flex items-start gap-3">
          <span className="text-red-600 text-lg shrink-0">⚠️</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-red-900">Revisão financeira pendente</p>
            <p className="text-xs text-red-700 mt-1">
              Esta proposta foi alterada após pagamento e possui uma diferença financeira não resolvida.
              Resolva antes de fazer novas alterações.
            </p>
            {pendenciaRevisaoAberta.descricao && (
              <p className="text-xs text-red-500 mt-1 line-clamp-2">{pendenciaRevisaoAberta.descricao}</p>
            )}
          </div>
            {proposta?.dbValorTotal == null ? (
              <button
                type="button"
                id="btn-consolidar-total-financeiro"
                onClick={() => setConsolidarConfirmOpen(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600/80 hover:bg-amber-500 text-white transition-colors flex-shrink-0"
              >
                Consolidar Total Oficial
              </button>
            ) : (
              <button
                type="button"
                id="btn-resolver-pendencia-financeira"
                onClick={async () => {
                  if (!proposta?.id_int || !proposta.resumo) return;
                  
                  try {
                    // Tenta usar a pendência do state (ID retornado pela API), senão busca a pendência oficial ABERTA da proposta
                    const id_pendencia = pendenciaRevisaoAberta.id;
                    let aberta = null;
                    
                    const { listPropostasPendencias } = await import("@/features/orcamentos/services/propostas-pendencias.service");
                    const { data } = await listPropostasPendencias(proposta.id_int);
                    
                    if (id_pendencia) {
                      aberta = data.find(p => p.id === id_pendencia);
                    }
                    
                    if (!aberta) {
                      aberta = data.find(p => p.status === "ABERTA" && (p.origem === "REVISAO_PROPOSTA_PAGA" || (p.origem === "SISTEMA" && String(p.titulo).startsWith("Revisão financeira pendente"))));
                    }
                    
                    if (!aberta) {
                      showToast({ type: "error", title: "Erro", description: "Pendência não encontrada no banco de dados. Recarregue a página." });
                      setPendenciaRevisaoAberta(null);
                      return;
                    }

                    const valorPago = calcularValorPagoConfirmado(cobrancasVinculadas);
                    const novoTotal = proposta.resumo.valorTotal;
                    const diff = calcularDiferencaFinanceira(novoTotal, valorPago);
                    
                    setDiferencaModal({
                      isOpen: true,
                      idInt: proposta.id_int,
                      idCliente: proposta.cliente?.idCliente ?? 0,
                      idPendencia: aberta.id, // using the real ID from DB
                      nomeCliente: proposta.cliente?.nome ?? "Cliente",
                      valorPagoConfirmado: valorPago,
                      novoTotal,
                      diferenca: diff,
                      onResolve: (tipoAcao?: string) => {
                        setPendenciaRevisaoAberta(null);
                        if (tipoAcao === "DEBITO_PENDENTE_COBRANCA") {
                          setActiveFormTab("pagamentos");
                          setAutoAbrirCobranca(true);
                        }
                      },
                    });
                  } catch (err) {
                    console.error(err);
                    showToast({ type: "error", title: "Erro", description: "Falha ao consultar pendência no servidor." });
                  }
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600/80 hover:bg-red-500 text-white transition-colors flex-shrink-0"
              >
                Resolver agora
              </button>
            )}
          </div>
      )}

      <div className="sticky top-4 z-[45] mb-6 flex w-full justify-start gap-3 overflow-x-auto rounded-3xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur hide-scrollbar">
          {[
            { id: "geral", label: "Geral" },
            { id: "produtos", label: "Orçamento" },
            { id: "fretes", label: "Fretes" },
            { id: "pedido", label: "Pedido" },
            { id: "artes", label: "Artes" },
            { id: "pagamentos", label: "Pagamentos" },
            { id: "historico", label: "Histórico" }
          ].filter(tab => {
            // Avulsa nao tem pedido nem arte.
            if (form.isAvulso) return tab.id !== "pedido" && tab.id !== "artes";
            // Proposta 100% de prateleira nao passa por arte: a aba some para
            // nao sugerir uma etapa que nao existe. A dispensa de verdade esta
            // na engine de status e em check_and_promote_proposta (banco) —
            // esconder a aba e so apresentacao.
            if (tab.id === "artes" && propostaDispensaArte(form.itens)) return false;
            return true;
          }).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                if (tab.id === "artes") {
                  const errosPorModelo: Record<string, Set<string>> = {};
                  const isMissing = (val: any) => val === null || val === undefined || val === "";
                  for (const m of form.pedidosModelos) {
                    // Ignora modelos órfãos (cujo item foi removido)
                    const hasItem = form.itens.some(
                      (item) =>
                        (m.id_produto_proposta_origem && item.id_produto_proposta_origem === m.id_produto_proposta_origem) ||
                        (m.item_temp_id && m.item_temp_id === item.id)
                    );
                    if (!hasItem) continue;

                    const faltam: string[] = [];
                    if (!m.nome_modelo) faltam.push("Modelo");
                    if (!m.quantidade || m.quantidade <= 0) faltam.push("Qtd");
                    if (isMissing(m.padrao)) faltam.push("Cor Papel");
                    if (isMissing(m.gabarito_operacional)) faltam.push("Numerador");
                    if (isMissing(m.numeracao_inicio)) faltam.push("Nº Inicial");
                    if (isMissing(m.numeracao_fim)) faltam.push("Nº Final");
                    if (!isMissing(m.numeracao_inicio) && !isMissing(m.numeracao_fim) && Number(m.numeracao_fim) < Number(m.numeracao_inicio)) faltam.push("Nº Final < Inicial");
                    if (isMissing(m.verso_tipo)) faltam.push("Verso");

                    if (faltam.length > 0) {
                      const nome = m.nome_modelo || "Sem nome";
                      if (!errosPorModelo[nome]) {
                        errosPorModelo[nome] = new Set();
                      }
                      faltam.forEach((f) => errosPorModelo[nome].add(f));
                    }
                  }

                  const errorList = Object.entries(errosPorModelo).map(([nome, faltamSet]) => ({
                    nome,
                    faltam: Array.from(faltamSet),
                  }));

                  if (errorList.length > 0) {
                    setShowArtesBlockModal(errorList);
                    return;
                  }
                }
                if (tab.id === "pagamentos") {
                  if (diferencaModal?.isOpen || pendenciaRevisaoAberta) {
                    showToast({ type: "warning", title: "Atenção", description: "Resolva a diferença financeira pendente antes de acessar Pagamentos." });
                    return;
                  }
                  if (isDirty) {
                    setPendingNavigation("?tab=pagamentos");
                    setUnsavedModalMode("pagamentos");
                    setIsUnsavedModalOpen(true);
                    return;
                  }
                }

                setActiveFormTab(tab.id as EditTabType);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className={`flex-none rounded-xl px-4 py-2 text-sm font-semibold transition whitespace-nowrap ${
                activeFormTab === tab.id
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

      <section className={shouldShowRest ? "grid gap-6 xl:grid-cols-[1fr_380px]" : "max-w-3xl mx-auto"}>
        <div className="space-y-6">
          {activeFormTab === "pedido" && shouldShowRest && (
            <PedidoModelosTab
              idInt={Number(form.id_int)}
              idCliente={Number(form.clienteId) || undefined}
              itens={form.itens}
              modelos={form.pedidosModelos}
              autoSaveHabilitado={!hasActiveCobranca && !isFormBloqueadoPorCobranca}
              onModelosChange={aplicarPatchModelos}
            />
          )}
          {activeFormTab === "artes" && shouldShowRest && (
            <ArtesTab form={form} onBriefingChange={handleBriefingChange} />
          )}
          {activeFormTab === "boletim" && shouldShowRest && (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
              <p className="text-sm font-semibold text-slate-600">Boletim</p>
              <p className="mt-1 text-sm text-slate-500">Aguarde orientações.</p>
            </div>
          )}
          {activeFormTab === "historico" && shouldShowRest && (
            form.id_int === "NOVO" ? (
              <div className="rounded-3xl border border-dashed border-amber-300 bg-amber-50 p-10 text-center">
                <p className="text-sm font-semibold text-amber-700">Salve a proposta para visualizar o histórico.</p>
              </div>
            ) : loadingHistorico ? (
              <div className="flex flex-col items-center justify-center p-20 gap-3 rounded-3xl border bg-slate-50 border-slate-200">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
                <span className="text-sm font-semibold text-slate-400">Carregando histórico financeiro da proposta...</span>
              </div>
            ) : historicoMovimentos.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-16 text-center">
                <p className="text-sm font-semibold text-slate-600">Nenhum movimento financeiro registrado</p>
                <p className="mt-1 text-xs text-slate-400">Esta proposta não possui registros de créditos gerados ou consumidos até o momento.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-900 mb-4">Auditoria e Movimentos de Crédito</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b text-xs font-bold uppercase tracking-wider text-slate-500 border-slate-100 bg-slate-50/50">
                          <th className="px-4 py-3">Data</th>
                          <th className="px-4 py-3">Tipo do Fluxo</th>
                          <th className="px-4 py-3">Valor</th>
                          <th className="px-4 py-3">Origem</th>
                          <th className="px-4 py-3">Observação / Justificativa</th>
                          <th className="px-4 py-3">Status / Auditoria</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {historicoMovimentos.map((mov) => {
                          // tipo_evento (Fase 1 — Conta Corrente) é a fonte estruturada real.
                          // Registros legados (anteriores à Fase 1) não o possuem — nesse caso,
                          // cai no rótulo genérico por `tipo` (CREDITO/DEBITO), a única
                          // informação disponível para eles.
                          const evento = mov.tipo_evento ?? null;
                          const isCancelado = mov.cancelado === true;

                          let badgeColor = "bg-slate-100 text-slate-800";
                          let badgeText: string = mov.tipo === "CREDITO" ? "Crédito" : "Débito";
                          let descRelacao = "Movimento financeiro geral (registro anterior à Conta Corrente v1).";

                          if (evento === "ABERTURA") {
                            badgeColor = "bg-teal-50 text-teal-700 border border-teal-200";
                            badgeText = "Pendência Aberta";
                            descRelacao = "Diferença financeira gerada por esta proposta após pagamento.";
                          } else if (evento === "USO_PEDIDO") {
                            badgeColor = "bg-sky-50 text-sky-700 border border-sky-200";
                            badgeText = mov.tipo === "CREDITO" ? "Débito Recebido" : "Crédito Utilizado";
                            descRelacao = mov.tipo === "CREDITO"
                              ? "Débito de outra proposta recebido/confirmado nesta cobrança."
                              : "Crédito do cliente consumido (uso imediato ou reserva confirmada).";
                          } else if (evento === "DEVOLUCAO") {
                            badgeColor = "bg-amber-50 text-amber-700 border border-amber-200";
                            badgeText = "Devolução";
                            descRelacao = "Devolução ao cliente (ou abatimento equivalente) do valor pago a maior.";
                          } else if (evento === "BONIFICACAO") {
                            badgeColor = "bg-purple-50 text-purple-700 border border-purple-200";
                            badgeText = "Bonificação";
                            descRelacao = "Diferença financeira abonada comercialmente.";
                          } else if (evento === "BAIXA") {
                            badgeColor = "bg-purple-50 text-purple-700 border border-purple-200";
                            badgeText = "Baixa de Débito";
                            descRelacao = "Débito quitado por outra via, sem gerar nova cobrança.";
                          } else if (evento === "CANCELAMENTO") {
                            badgeColor = "bg-slate-100 text-slate-600 border border-slate-200";
                            badgeText = "Pendência Cancelada";
                            descRelacao = "Pendência anulada (diferença zerada ou inversão de direção).";
                          } else if (evento === "ESTORNO") {
                            badgeColor = "bg-red-50 text-red-700 border border-red-200";
                            badgeText = "Estorno";
                            descRelacao = "Lançamento compensatório revertendo um evento anterior.";
                          } else if (mov.tipo === "CREDITO") {
                            badgeColor = "bg-teal-50 text-teal-700 border border-teal-200";
                            badgeText = "Crédito Gerado";
                            descRelacao = "Diferença comercial a favor do cliente gerada por esta proposta.";
                          } else {
                            badgeColor = "bg-sky-50 text-sky-700 border border-sky-200";
                            badgeText = "Crédito Utilizado";
                          }

                          return (
                            <tr
                              key={mov.id}
                              className={`hover:bg-slate-50/50 transition duration-150 ${isCancelado ? "opacity-50 line-through text-slate-400 bg-red-50/10" : "text-slate-700"}`}
                            >
                              {/* Data */}
                              <td className="px-4 py-3 text-xs font-semibold whitespace-nowrap">
                                {new Date(mov.created_at).toLocaleString()}
                              </td>

                              {/* Tipo do Fluxo */}
                              <td className="px-4 py-3 whitespace-nowrap">
                                <span className={`inline-flex rounded-lg px-2 py-1 text-xs font-bold ${badgeColor}`}>
                                  {badgeText}
                                </span>
                                <p className="text-[10px] text-slate-400 mt-1 max-w-[200px] leading-tight">
                                  {descRelacao}
                                </p>
                              </td>

                              {/* Valor */}
                              <td className="px-4 py-3 font-bold whitespace-nowrap">
                                <span className={mov.tipo === "CREDITO" ? "text-teal-600" : "text-sky-600"}>
                                  {mov.tipo === "CREDITO" ? "+" : "-"} {formatCurrency(mov.valor)}
                                </span>
                              </td>

                              {/* Origem */}
                              <td className="px-4 py-3 text-xs font-semibold uppercase whitespace-nowrap">
                                <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">
                                  {mov.origem}
                                </span>
                              </td>

                              {/* Observação */}
                              <td className="px-4 py-3 text-xs max-w-[300px] break-words">
                                {mov.observacao}
                              </td>

                              {/* Status / Auditoria */}
                              <td className="px-4 py-3 whitespace-nowrap">
                                {isCancelado ? (
                                  <div>
                                    <span className="inline-flex rounded-lg bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-[10px] font-bold">
                                      CANCELADO
                                    </span>
                                    <p className="text-[9px] text-red-400 mt-1">
                                      Por: {mov.cancelado_por || "Sistema"}
                                    </p>
                                    {mov.cancelado_em && (
                                      <p className="text-[9px] text-red-400">
                                        Em: {new Date(mov.cancelado_em).toLocaleDateString()}
                                      </p>
                                    )}
                                  </div>
                                ) : (
                                  <span className="inline-flex rounded-lg bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 text-[10px] font-bold">
                                    ATIVO
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )
          )}

          {activeFormTab === "geral" && (
            <div className="space-y-6">
              <FormSection title="1. Cliente" description={form.clienteNaoCadastrado ? "Informe o nome livre do cliente e o CEP para entrega / cálculo de frete." : "Busque por ID, nome, apelido/fantasia ou documento do cliente (busca direta no banco de dados)."}>
            {/* Toggle Cliente Cadastrado vs. Sem Cadastro */}
            {mode === "new" ? (
              <div className="mb-4 flex gap-6 border-b border-slate-100 pb-3">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800 text-sm">
                  <input
                    type="radio"
                    name="client_type"
                    checked={!form.clienteNaoCadastrado}
                    onChange={() => {
                      updateField("clienteNaoCadastrado", false);
                      updateField("clienteId", "");
                      setCliente(null);
                      setClientSearch("");
                    }}
                    className="accent-[#0f9f9a] h-4 w-4"
                  />
                  Cliente cadastrado
                </label>
                <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800 text-sm">
                  <input
                    type="radio"
                    name="client_type"
                    checked={!!form.clienteNaoCadastrado}
                    onChange={() => {
                      updateField("clienteNaoCadastrado", true);
                      updateField("clienteId", "");
                      setCliente(null);
                      setClientSearch("");
                    }}
                    className="accent-[#0f9f9a] h-4 w-4"
                  />
                  Cliente não cadastrado / orçamento rápido
                </label>
              </div>
            ) : (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Tipo de orçamento: {isVinculandoCliente ? "Vinculando cliente cadastrado…" : form.clienteNaoCadastrado ? "Cliente não cadastrado / Orçamento rápido" : "Cliente cadastrado"}
                </span>
                {mode === "edit" && form.clienteNaoCadastrado && !isVinculandoCliente && !isFormBloqueadoPorCobranca && (
                  <button
                    type="button"
                    onClick={iniciarVinculacaoCliente}
                    title="Substitui o cliente manual pelo cadastro oficial. Preços e frete serão recalculados; a troca fica registrada no Histórico ao salvar."
                    className="rounded-xl border border-[#0f9f9a] bg-white px-3 py-1.5 text-xs font-semibold text-[#0b6e6a] transition hover:bg-teal-50"
                  >
                    Vincular cliente cadastrado
                  </button>
                )}
                {isVinculandoCliente && (
                  <button
                    type="button"
                    onClick={cancelarVinculacaoCliente}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                  >
                    Cancelar vinculação
                  </button>
                )}
              </div>
            )}

            {form.clienteNaoCadastrado ? (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Nome livre do cliente / empresa">
                    <input
                      value={form.nomeClienteLivre || ""}
                      onChange={(e) => updateField("nomeClienteLivre", e.target.value)}
                      className={`${inputClass} ${errorFields.includes("nomeClienteLivre") ? "border-red-300" : ""}`}
                      placeholder="Digite o nome completo do cliente ou empresa..."
                    />
                  </Field>
                  <Field label="CEP de entrega">
                    <div className="relative">
                      <input
                        value={form.cepLivre || ""}
                        onChange={(e) => updateField("cepLivre", e.target.value)}
                        className={`${inputClass} ${errorFields.includes("cepLivre") ? "border-red-300" : ""}`}
                        placeholder="Ex: 01001-000"
                      />
                      {cepLivreLoading && (
                        <div className="absolute right-3 top-3.5 h-4 w-4 animate-spin rounded-full border-2 border-[#0f9f9a] border-t-transparent"></div>
                      )}
                    </div>
                  </Field>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Cidade">
                    <input
                      value={form.cidadeLivre || ""}
                      onChange={(e) => updateField("cidadeLivre", e.target.value)}
                      className={inputClass}
                      placeholder="Cidade (preenchida automaticamente via CEP)"
                    />
                  </Field>
                  <Field label="Estado (UF)">
                    <input
                      value={form.ufLivre || ""}
                      onChange={(e) => updateField("ufLivre", e.target.value)}
                      className={inputClass}
                      placeholder="UF (preenchida automaticamente via CEP)"
                    />
                  </Field>
                </div>
              </div>
            ) : (
              <div className="relative">
                <label className={`flex items-center gap-3 rounded-2xl border bg-slate-50 px-4 py-3 ${errorFields.includes("clienteId") ? "border-red-300" : "border-slate-200"}`}>
                  <Search className="h-4 w-4 text-[#0f9f9a]" />
                  <input
                    ref={searchInputRef}
                    value={clientSearch}
                    onChange={(event) => { setClientSearch(event.target.value); setShowClientResults(true); }}
                    onFocus={() => setShowClientResults(true)}
                    className="w-full bg-transparent text-sm text-slate-900 outline-none"
                    placeholder="Buscar por ID, nome, apelido ou documento do cliente..."
                  />
                  {isSearchingClients && (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#0f9f9a] border-t-transparent"></div>
                  )}
                  {cliente && (
                    <button
                      type="button"
                      onClick={() => handleClearCliente("")}
                      className="rounded-xl p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </label>
                {showClientResults && (clientResults.length > 0 || isSearchingClients || searchError || (clientSearch.trim().length >= 2 && !/^\d+\s*-\s*/.test(clientSearch.trim()))) && (
                  <div className="absolute left-0 right-0 top-full z-40 mt-2 rounded-3xl border border-[#d7e5e8] bg-white p-2 shadow-xl max-h-72 overflow-y-auto">
                    {isSearchingClients && clientResults.length === 0 && (
                      <div className="px-4 py-3 text-sm text-slate-500 flex items-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#0f9f9a] border-t-transparent"></div>
                        Buscando clientes...
                      </div>
                    )}
                    {searchError && (
                      <div className="px-4 py-3 text-sm text-red-600 font-medium">
                        {searchError}
                      </div>
                    )}
                    {!isSearchingClients && !searchError && clientResults.length === 0 && (
                      <div className="px-4 py-3 text-sm text-slate-500">
                        Nenhum cliente encontrado.
                      </div>
                    )}
                    {clientResults.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onClick={() => void selectCliente(result)}
                        className="w-full rounded-2xl px-3 py-3 text-left hover:bg-slate-50 transition"
                      >
                        <p className="font-semibold text-slate-950">#{result.idCliente} - {result.nome}</p>
                        <p className="text-sm text-slate-500">
                          {result.documento ? `${result.documento} | ` : ""}
                          {result.fantasia ? `Apelido: ${result.fantasia} | ` : ""}
                          {result.cidadeUf} | Vendedor {getClienteVendedorPadrao(result)}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!form.clienteNaoCadastrado && cliente ? (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <InfoBox label="Cliente" value={`${cliente.nome} (#${cliente.idCliente})`} />
                <InfoBox label="Limite Faturado / Risco" value={`${formatCurrency(cliente.creditoDisponivel)} - risco ${cliente.riscoCredito}`} />
                <InfoBox label="Tabela especial" value={bonusPercent > 0 ? `+${bonusPercent}% applied nos produtos` : "Sem acréscimo especial"} />
              </div>
            ) : null}
          </FormSection>
            </div>
          )}

          {shouldShowRest && (
            <>
              {activeFormTab === "geral" && (
                <div className="space-y-6">
                  <FormSection title="2. Dados da proposta" description="Vendedor responsável e status é definido pelo sistema.">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="id_int">
                    <input value={form.id_int === "NOVO" ? "" : form.id_int} placeholder="Gerado automaticamente" readOnly className={`${inputClass} cursor-not-allowed bg-slate-100 text-slate-500`} />
                  </Field>
                  <Field label="Empresa">
                    <select value={form.empresa} onChange={(event) => updateField("empresa", event.target.value)} className={inputClass}>
                      {mockCompanies.filter((company) => !company.isConsolidated).map((company) => <option key={company.id} value={company.name}>{company.shortName}</option>)}
                    </select>
                  </Field>
                  <Field label="Vendedor">
                    {canAlterarVendedor || form.clienteNaoCadastrado ? (
                      <select value={form.vendedor} onChange={(event) => updateField("vendedor", event.target.value)} className={inputClass}>
                        <option value="">Selecione o vendedor</option>
                        {vendedorOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    ) : (
                      <input value={vendedorExibido} readOnly className={`${inputClass} cursor-not-allowed bg-slate-100 text-slate-500`} />
                    )}
                    <p className={`text-xs ${canAlterarVendedor || form.clienteNaoCadastrado ? "text-amber-700" : "text-slate-500"}`}>
                      {canAlterarVendedor || form.clienteNaoCadastrado
                        ? "Selecione o vendedor responsável."
                        : "Vendedor definido pelo cadastro do cliente (Somente leitura)."}
                    </p>
                    {!loadingVendedores && dbVendedores.length === 0 && (
                      <p className="text-xs text-rose-600 mt-1 font-semibold">
                        ⚠️ Aviso: Nenhum vendedor retornado pelo banco de dados.
                      </p>
                    )}
                  </Field>
                  <Field label="Status">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <StatusBadge status={composeStatusEmArte(form.status, form.emArte)} tone={form.status === "NOVO" ? "info" : form.status === "APROVADO" ? "success" : form.status === "AGUARDANDO" ? "warning" : "neutral"} />
                    </div>
                  </Field>
                </div>
              </FormSection>

              {!form.clienteNaoCadastrado && (
                  <FormSection title="3. Contato responsável" description="Contato usado para envio da proposta informal e retorno comercial.">
                    {proposalContacts.length > 0 ? (
                      <SelectorGrid
                        items={proposalContacts}
                        selectedId={form.contatoId}
                        onSelect={(id) => updateField("contatoId", id)}
                        render={(contato) => ({
                          title: contato.nome,
                          subtitle: `${contato.cargo || "Sem cargo"} - ${contato.whatsapp}`,
                          detail: contato.email || "Sem e-mail"
                        })}
                        extraClassNameForItem={(contato) => {
                          return form.contatoId === contato.id ? "!bg-[#3d9790] !border-[#3d9790] !text-white" : "";
                        }}
                        onEdit={(contato) => openEditContact(contato)}
                        searchPlaceholder="Pesquisar contato por nome, cargo, WhatsApp ou e-mail..."
                      />
                    ) : (
                      <p className="text-sm text-slate-500 bg-slate-50 rounded-2xl p-4">Nenhum contato cadastrado para este cliente.</p>
                    )}
                    <button type="button" onClick={() => setIsContactModalOpen(true)} className="mt-4 rounded-2xl border border-[#d7e5e8] bg-white px-4 py-3 text-sm font-semibold text-[#0b2f4a]">+ Adicionar novo contato</button>
                  </FormSection>
                )}

                  {!form.clienteNaoCadastrado && (
                    <FormSection title="4. Dados para nota fiscal" description="Selecione o sócio ou vínculo comercial responsável pelo faturamento.">
                    {!cliente ? (
                      <p className="text-sm text-slate-500 bg-slate-50 rounded-2xl p-4">Selecione um cliente para visualizar as opções.</p>
                    ) : (
                      <>
                        <SelectorGrid
                          items={[
                            {
                              id: cliente.id.toString(),
                              nome: cliente.nome,
                              tipoRelacao: "Cadastro principal",
                              documento: cliente.documento
                            },
                            ...(cliente.vinculosComerciais || [])
                          ]}
                          selectedId={form.compradorId || cliente.id.toString()}
                          onSelect={handleSelectComprador}
                          render={(vinculo) => ({
                            title: vinculo.nome,
                            subtitle: vinculo.tipoRelacao,
                            detail: vinculo.documento
                          })}
                          extraClassNameForItem={(vinculo) => {
                            return (form.compradorId || cliente.id.toString()) === vinculo.id ? "!bg-[#4b78b7] !border-[#4b78b7] !text-white" : "";
                          }}
                          searchPlaceholder="Pesquisar por nome, relação comercial ou documento..."
                        />
                        <button 
                          type="button" 
                          onClick={() => {
                            if (cliente?.id) {
                              window.open(`/cadastros/${cliente.id}/editar`, "_blank");
                            }
                          }} 
                          className="mt-4 rounded-2xl border border-[#d7e5e8] bg-white px-4 py-3 text-sm font-semibold text-[#0b2f4a] transition hover:bg-slate-50"
                        >
                          + Adicionar novo sócio
                        </button>
                      </>
                    )}
                  </FormSection>
                  )}

                  {!form.clienteNaoCadastrado && (
                    <FormSection title="5. Endereço de entrega" description="Endereço usado para frete, PDF e expedição futura.">
                    {combinedAddresses.length > 0 ? (
                      <SelectorGrid
                        items={combinedAddresses}
                        selectedId={form.enderecoId}
                        onSelect={handleSelectEndereco}
                        onEdit={(item, e) => {
                          e.stopPropagation();
                          setAddressModalMode("edit");
                          setEditingAddressId(item.id);
                          setAddressDraft({
                            tipo: (item.tipo as any) || "entrega",
                            cep: item.cep || "",
                            endereco: item.endereco || "",
                            numero: item.numero || "",
                            complemento: item.complemento || "",
                            bairro: item.bairro || "",
                            cidade: item.cidade || "",
                            uf: item.uf || "",
                            recebedor: item.recebedor || "",
                            cpfRecebedor: item.cpfRecebedor || ""
                          });
                          setIsAddressModalOpen(true);
                        }}
                        onCopy={async (item, e) => {
                          e.stopPropagation();
                          const texts = [];
                          if (item.recebedor) texts.push(`Responsável: ${item.recebedor}`);
                          else texts.push(`Responsável: não informado`);
                          
                          if (item.cpfRecebedor) {
                            const maskCpf = (v: string) => {
                              let c = v.replace(/\D/g, "");
                              if (c.length > 11) c = c.slice(0, 11);
                              return c.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
                            };
                            texts.push(`CPF do responsável: ${maskCpf(item.cpfRecebedor)}`);
                          }
                          
                          if (item.endereco && item.numero) texts.push(`Endereço: ${item.endereco}, ${item.numero}`);
                          else if (item.endereco) texts.push(`Endereço: ${item.endereco}`);
                          
                          if (item.complemento) texts.push(`Complemento: ${item.complemento}`);
                          if (item.bairro) texts.push(`Bairro: ${item.bairro}`);
                          if (item.cidade && item.uf) texts.push(`Cidade/UF: ${item.cidade}/${item.uf}`);
                          
                          if (item.cep) {
                            const maskCep = (v: string) => {
                              const c = v.replace(/\D/g, "");
                              return c.replace(/^(\d{5})(\d)/, "$1-$2").slice(0, 9);
                            };
                            texts.push(`CEP: ${maskCep(item.cep)}`);
                          }
                          
                          if ((item as any).obs) texts.push(`Referência: ${(item as any).obs}`);
                          if (item.tipo) texts.push(`Tipo: ${item.tipo}`);
                          
                          const textToCopy = texts.join("\n");
                          
                          try {
                            if (navigator.clipboard && window.isSecureContext) {
                              await navigator.clipboard.writeText(textToCopy);
                            } else {
                              const textArea = document.createElement("textarea");
                              textArea.value = textToCopy;
                              textArea.style.position = "absolute";
                              textArea.style.left = "-999999px";
                              document.body.prepend(textArea);
                              textArea.select();
                              document.execCommand("copy");
                              textArea.remove();
                            }
                            showToast({ type: "success", title: "Copiado", description: "Endereço copiado para a área de transferência." });
                          } catch (err) {
                            showToast({ type: "error", title: "Erro", description: "Não foi possível copiar o endereço." });
                          }
                        }}
                        render={(endereco) => {
                          const isSocioAddr = (endereco as any)._isSocioAddr === true;
                          const recebedor = endereco.recebedor ? endereco.recebedor : "";
                          const cpfStr = endereco.cpfRecebedor ? ` - CPF: ${endereco.cpfRecebedor}` : "";
                          
                          let primeiraLinha = "";
                          if (recebedor) {
                            primeiraLinha = `${recebedor}${cpfStr}`;
                          } else {
                            primeiraLinha = `${endereco.endereco}, ${endereco.numero}`;
                          }

                          const segundaLinha = recebedor ? `${endereco.endereco}, ${endereco.numero}` : `${endereco.cidade}/${endereco.uf} - CEP ${endereco.cep}`;
                          
                          const tipoExibido = endereco.tipo ? endereco.tipo : "Tipo não informado";
                          const donoText = isSocioAddr ? "Endereço do pagador selecionado" : "Endereço do comprador";
                          return {
                            title: primeiraLinha,
                            subtitle: segundaLinha,
                            detail: (
                              <div className="flex flex-col gap-0.5 mt-0.5">
                                <span>{tipoExibido} ({donoText})</span>
                                {recebedor && <span>{endereco.cidade}/{endereco.uf} - CEP {endereco.cep}</span>}
                              </div>
                            )
                          };
                        }}
                        extraClassNameForItem={(endereco) => {
                          const isCompradorAddress = (endereco as any)._isSocioAddr === true;
                          const isSelected = form.enderecoId === endereco.id;
                          if (isSelected) {
                            if (isCompradorAddress) {
                              return "!bg-[#4b78b7] !border-[#4b78b7] !text-white";
                            }
                            return "!bg-[#3d9790] !border-[#3d9790] !text-white";
                          }
                          return "border-blue-100 bg-blue-50/40 text-slate-700 hover:bg-blue-50/70";
                        }}
                        badgeForItem={(endereco) => {
                          const isCompradorAddress = (endereco as any)._isSocioAddr === true;
                          const isSelected = form.enderecoId === endereco.id;
                          const isSocio = form.compradorId && form.compradorId !== form.clienteId;
                          
                          let badgeText = null;
                          if (isCompradorAddress) {
                            const vinculo = cliente?.vinculosComerciais?.find((v) => v.id === form.compradorId);
                            const isPartner = vinculo?.tipoRelacao.toLowerCase().includes("sócio") || vinculo?.tipoRelacao.toLowerCase().includes("socio");
                            badgeText = isPartner ? "Endereço de sócio" : "Endereço de vínculo comercial";
                          }

                          let requerNota = false;
                          if (isSelected && isSocio) {
                            const principalAddr = compradorAddresses.find(a => (a.tipo || "").trim().toLowerCase() === "principal") || compradorAddresses[0];
                            if (principalAddr && endereco.id !== principalAddr.id) {
                              const cidadeSelecionada = (endereco.cidade || "").trim().toLowerCase();
                              const cidadePrincipal = (principalAddr.cidade || "").trim().toLowerCase();
                              if (cidadeSelecionada !== cidadePrincipal) {
                                requerNota = true;
                              }
                            }
                          }

                          return (
                            <div className="flex gap-1 items-center">
                              {badgeText && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800 border border-blue-200">
                                  {badgeText}
                                </span>
                              )}
                              {requerNota && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                                  REQUER NOTA DE TRANSPORTE
                                </span>
                              )}
                            </div>
                          );
                        }}
                        searchPlaceholder="Pesquisar endereço por responsável, rua, bairro, cidade ou CEP..."
                        searchTextForItem={(endereco) => [
                          endereco.recebedor,
                          endereco.endereco,
                          endereco.numero,
                          endereco.complemento,
                          endereco.bairro,
                          endereco.cidade,
                          endereco.uf,
                          endereco.cep,
                          endereco.tipo
                        ].filter(Boolean).join(" ")}
                      />
                    ) : (
                      <p className="text-sm text-slate-500 bg-slate-50 rounded-2xl p-4">Nenhum endereço disponível para entrega.</p>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (mode === "edit" && form.enderecoId) {
                          // Proposta edit mode: open the linked address for UPDATE
                          const linkedAddr = combinedAddresses.find((a) => a.id === form.enderecoId);
                          if (linkedAddr) {
                            setAddressModalMode("edit");
                            setEditingAddressId(linkedAddr.id);
                            setAddressDraft({
                              tipo: (linkedAddr.tipo as AddressDraft["tipo"]) || "entrega",
                              cep: linkedAddr.cep || "",
                              endereco: linkedAddr.endereco || "",
                              numero: linkedAddr.numero || "",
                              complemento: linkedAddr.complemento || "",
                              bairro: linkedAddr.bairro || "",
                              cidade: linkedAddr.cidade || "",
                              uf: linkedAddr.uf || "",
                              recebedor: linkedAddr.recebedor || "",
                              cpfRecebedor: linkedAddr.cpfRecebedor || "",
                            });
                            setIsAddressModalOpen(true);
                            return;
                          }
                        }
                        // Default: open empty create form
                        setAddressModalMode("create");
                        setEditingAddressId(null);
                        setAddressDraft({ tipo: "entrega", cep: "", endereco: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", recebedor: "", cpfRecebedor: "" });
                        setIsAddressModalOpen(true);
                      }}
                      className="mt-4 rounded-2xl border border-[#d7e5e8] bg-white px-4 py-3 text-sm font-semibold text-[#0b2f4a]"
                    >
                      {mode === "edit" && form.enderecoId ? "Salvar endereço" : "+ Adicionar novo endereço"}
                    </button>
                  </FormSection>
                  )}
                </div>
              )}

              {activeFormTab === "produtos" && (
                <fieldset disabled={isFormBloqueadoPorCobranca} className="group space-y-6">
                  <FormSection
                    title="6. Produtos"
            description={form.isAvulso ? "Configure o valor total dos produtos no modo avulso." : "Escolha do catálogo e configure quantidades, descontos e variações."}
          >
            {/* Toggle Proposta Avulsa */}
            <div className="mb-6 flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/50 p-4 dark:bg-slate-800/40 dark:border-slate-700">
              <input
                type="checkbox"
                id="isAvulso"
                checked={form.isAvulso || false}
                onChange={(e) => {
                    const checked = e.target.checked;
                    updateField("isAvulso", checked);
                    if (checked) {
                      const originalResumo = calculateResumo(form.itens, form.fretes, Number(form.descontoGeralValor) || 0, form.descontoGeralTipo);
                      updateField("valorProdutosManual", formatCurrencyWithoutPrefix(originalResumo.valorTotal));
                      updateField("valorFreteManual", "0,00");
                      updateField("observacoesFreteManual", "Frete Incluso");
                      updateField("freteEscolhidoId", "frete_manual_unico");
                      updateField("fretes", [{
                        id: "frete_manual_unico",
                        id_int: Number(form.id_int) || 0,
                        transportadora: "Frete Incluso",
                        servico: "",
                        valor: 0,
                        prazo: "A combinar",
                        observacao: "Cadastro manual representativo",
                        escolhido: true,
                        pesoUsado: 0
                      }]);
                    } else {
                      updateField("valorProdutosManual", "");
                      updateField("valorFreteManual", "");
                      updateField("observacoesFreteManual", "");
                      
                      const fretesOriginais = proposta?.fretes ?? [];
                      const isAvulsoOriginal = proposta?.is_avulso ?? false;
                      
                      if (fretesOriginais.length > 0 && !isAvulsoOriginal) {
                        updateField("fretes", fretesOriginais);
                        const freteAntigoEscolhido = proposta?.freteEscolhidoId ?? (fretesOriginais.find((f: any) => f.escolhido)?.id ?? "");
                        updateField("freteEscolhidoId", freteAntigoEscolhido);
                      } else {
                        updateField("fretes", []);
                        updateField("freteEscolhidoId", "");
                      }
                    }
                  }}
                className="h-4 w-4 rounded border-slate-300 text-[#0f9f9a] focus:ring-[#0f9f9a]"
              />
              <label htmlFor="isAvulso" className="text-sm font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                Proposta avulsa (orçamento sem produtos cadastrados)
              </label>
            </div>

            {form.isAvulso ? (
              <div className="space-y-4 rounded-2xl bg-slate-50 p-4 border border-slate-200 dark:bg-slate-800/40 dark:border-slate-700">
                <Field label="Valor total dos produtos (R$) *">
                  <input
                    type="text"
                    value={form.valorProdutosManual || ""}
                    onChange={(e) => updateField("valorProdutosManual", e.target.value)}
                    onBlur={(e) => {
                      const val = parseCurrencyBR(e.target.value);
                      if (val !== null) {
                        updateField("valorProdutosManual", formatCurrencyWithoutPrefix(val));
                      }
                    }}
                    className={inputClass}
                  />
                </Field>
              </div>
            ) : (
              <>
                <ProductSearchSelector
                  produtos={produtos}
                  loadingProdutos={loadingProdutos}
                  onAddProduct={addProduct}
                  itensAtuais={form.itens}
                />


                {/* Lista de itens da proposta */}
                <div className="space-y-4">
                  {form.itens.map((item) => {
                    const isCancelled = item.statusItem === "CANCELADO";
                    
                    if (isCancelled) {
                      return (
                        <div key={item.id} className="rounded-3xl border border-red-200/50 bg-red-50/20 p-5 shadow-sm opacity-60 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-baseline gap-x-2 text-lg text-slate-500 line-through">
                              <span>#{item.id_produto}</span>
                              <h4 className="font-extrabold">{item.nome}</h4>
                              <span>- Qtd:</span>
                              <span className="font-extrabold">{item.quantidade.toLocaleString("pt-BR")}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-semibold text-red-500">
                              <span>Removido (Inativo)</span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-6 sm:justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                setForm(prev => ({
                                  ...prev,
                                  itens: prev.itens.map(it => it.id === item.id ? { ...it, statusItem: "PENDENTE" } : it)
                                }));
                                showToast({ type: "success", title: "Produto restaurado", description: "O produto foi reativado." });
                              }}
                              className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition-all"
                            >
                              Restaurar
                            </button>
                          </div>
                        </div>
                      );
                    }

                    const isOpen = openItemIds[item.id] ?? false;
                    
                    const modelosDoItem = form.pedidosModelos.filter(
                      (m) => 
                        (m.id_produto_proposta_origem && item.id_produto_proposta_origem && m.id_produto_proposta_origem === item.id_produto_proposta_origem) ||
                        (m.item_temp_id && m.item_temp_id === item.id)
                    );
                    const somaModelos = modelosDoItem.length > 0 
                      ? modelosDoItem.reduce((acc, curr) => acc + curr.quantidade, 0) 
                      : undefined;

                    // Autorizado a editar proposta paga também pode inativar (reversível)
                    // itens em propostas APROVADO/AGUARDANDO.
                    const isRemoveAllowed = (form.status !== "APROVADO" && form.status !== "AGUARDANDO") || canEditarPropostaPaga;
                    const isPrecoFixoAplicado = !!(
                      cliente?.usaPrecoFixo &&
                      cliente.precosFixos?.some(p => p.id_produto === item.id_produto)
                    );

                    if (isOpen) {
                      return (
                        <ProductItemEditor
                          key={item.id}
                          item={item}
                          bonusPercent={bonusPercent}
                          hasVariationError={errorFields.includes(`variacoes_${item.id}`)}
                          onUpdate={(updater) => updateItem(item.id, updater)}
                          onVariationChange={(idVariacao, tipoId) => updateItemVariation(item.id, idVariacao, tipoId)}
                          onRemove={() => handleRemoveProductClick(item.id)}
                          onSave={() => handleSaveItem(item.id)}
                          minQuantity={somaModelos}
                          // Variação é característica do produto, não valor: segue a mesma
                          // condição de edição do formulário (proposta paga/pendência bloqueiam).
                          podeEditarVariacoes={!isFormBloqueadoPorCobranca}
                          canEditarValoresItem={canEditarValoresItem}
                          isRemoveAllowed={isRemoveAllowed}
                          isPrecoFixoAplicado={isPrecoFixoAplicado}
                        />
                      );
                    } else {
                      return (
                        <ProductItemSummary
                          key={item.id}
                          item={item}
                          isRemoveAllowed={isRemoveAllowed}
                          onEdit={() => handleEditItem(item.id)}
                          onDuplicate={
                            isFormBloqueadoPorCobranca ? undefined : () => handleDuplicateItem(item.id)
                          }
                          onRemove={() => handleRemoveProductClick(item.id)}
                        />
                      );
                    }
                  })}
                  {!form.itens.length ? (
                    <div
                      className={`rounded-3xl border border-dashed p-5 text-sm ${
                        errorFields.includes("itens") ? "border-red-300 bg-red-50 text-red-700" : "border-slate-300 bg-slate-50 text-slate-500"
                      }`}
                    >
                      Nenhum produto adicionado.
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </FormSection>
        </fieldset>
      )}

      {activeFormTab === "fretes" && (
        <fieldset disabled={isFormBloqueadoPorCobranca} className="group space-y-6">
          <FormSection 
            title="7. Fretes e Entrega" 
            description={form.isAvulso ? "Configure o frete manual para a proposta avulsa." : "Integração em tempo real com cotações de SEDEX e cadastro de frete manual."}
          >
            {form.isAvulso ? (
              <div className="space-y-4 rounded-2xl bg-slate-50 p-4 border border-slate-200 dark:bg-slate-800/40 dark:border-slate-700">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Serviço / Transportadora *">
                    <input
                      type="text"
                      value={form.observacoesFreteManual || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateField("observacoesFreteManual", val);
                        updateField("fretes", form.fretes.map(f => f.id === "frete_manual_unico" ? { ...f, transportadora: val } : f));
                      }}
                      placeholder="Ex: Transportadora Própria / PAC"
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Valor do frete (R$) *">
                    <input
                      type="text"
                      value={form.valorFreteManual || ""}
                      onChange={(e) => {
                        const valStr = e.target.value;
                        updateField("valorFreteManual", valStr);
                        const valNum = parseCurrencyBR(valStr) ?? 0;
                        updateField("fretes", form.fretes.map(f => f.id === "frete_manual_unico" ? { ...f, valor: valNum } : f));
                      }}
                      onBlur={(e) => {
                        const val = parseCurrencyBR(e.target.value);
                        if (val !== null) {
                          updateField("valorFreteManual", formatCurrencyWithoutPrefix(val));
                        }
                      }}
                      placeholder="Ex: 150,00"
                      className={inputClass}
                    />
                  </Field>
                </div>
              </div>
            ) : (
              <>
                {isFreightOutdated &&
                  hasValidCepForFreight &&
                  (form.isAvulso ? true : hasProductsAndWeight) &&
                  (form.clienteNaoCadastrado || Boolean(form.enderecoId)) && (
                  <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    <p className="font-semibold">⚠️ Cotação desatualizada</p>
                    <p className="mt-1">O CEP, peso total ou volumes foram alterados. Clique em &apos;Atualizar frete&apos; para obter os valores corretos.</p>
                  </div>
                )}

                <div className="mb-6 rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex-1 flex gap-2">
                      <button
                        type="button"
                        onClick={handleCotarFretes}
                        disabled={
                          isQuotingSedex ||
                          isQuotingAzul ||
                          isQuotingTransp ||
                          isQuotingVeppo ||
                          (form.isAvulso
                            ? true
                            : (
                                !hasValidCepForFreight ||
                                !hasProductsAndWeight ||
                                (!form.clienteNaoCadastrado && !form.enderecoId)
                              )
                          )
                        }
                        className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#0b2f4a] px-5 text-sm font-semibold text-white shadow-md hover:bg-[#123f61] transition disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {isQuotingSedex || isQuotingAzul || isQuotingTransp || isQuotingVeppo ? (
                          <>
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                            Atualizando...
                          </>
                        ) : (
                          "Atualizar fretes"
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsManualFreteModalOpen(true)}
                        className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#d7e5e8] bg-white px-5 text-sm font-semibold text-[#0b2f4a] shadow-sm hover:bg-slate-50 transition"
                      >
                        + Frete manual
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 font-medium">
                    * A cotação utiliza o CEP do endereço selecionado e o peso total da proposta em gramas ({formatWeightFromGrams(resumo.pesoTotal)}).
                  </p>
                </div>

                {hasPreservedFreight && (
                  <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-3xl flex items-start gap-3 text-amber-800 animate-in fade-in slide-in-from-top-1 duration-200">
                    <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-amber-600" />
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-amber-950">
                        Cotação Defasada
                      </h4>
                      <p className="text-xs mt-1 font-medium leading-normal text-amber-900">
                        Frete escolhido anteriormente não retornou na nova cotação. Revise antes de salvar.
                      </p>
                    </div>
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                  {form.fretes.map((frete) => (
                    <div 
                      key={frete.id} 
                      className={`rounded-3xl border p-4 flex flex-col justify-between transition-all duration-200 ${
                        frete.id === form.freteEscolhidoId 
                          ? "border-teal-300 bg-teal-50/60 ring-2 ring-teal-200/50 shadow-sm" 
                          : "border-slate-200 bg-slate-50 hover:bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                            {frete.transportadora === "Azul Cargo"
                              ? `AZUL CARGO ${frete.servico}`
                              : frete.servico === "SEDEX"
                              ? "SEDEX EXPRESS"
                              : frete.servico === "PAC"
                              ? "PAC ECONÔMICO"
                              : frete.servico === "SÃO MIGUEL"
                              ? "TRANSP. SÃO MIGUEL"
                              : frete.servico === "UNESUL"
                              ? "TRANSP. UNESUL"
                              : frete.servico === "MOTOBOY"
                              ? "ENTREGA MOTOBOY"
                              : "MANUAL / TRANSP."}
                          </span>
                          <h4 className="font-bold text-slate-900 text-base mt-0.5">{frete.transportadora}</h4>
                          <p className="text-sm text-slate-500 font-medium">Prazo: {frete.prazo}</p>
                        </div>
                        {frete.id === form.freteEscolhidoId ? (
                          <span className="rounded-full bg-teal-600 px-3 py-1 text-xs font-bold text-white shadow-sm">
                            Escolhido
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => selectFrete(frete.id)}
                            className="rounded-2xl border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-all shadow-sm"
                          >
                            Escolher
                          </button>
                        )}
                      </div>
                      <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between">
                        <div>
                          <p className="text-xs text-slate-400 font-semibold uppercase">Valor</p>
                          <p className="text-base font-extrabold text-slate-950">
                            {formatCurrency(frete.valor)}
                          </p>
                          {frete.transportadora === "Azul Cargo" && frete.valorOriginal !== undefined && (
                            <p className="text-xs font-medium text-slate-500 mt-0.5">
                              Original: {formatCurrency(frete.valorOriginal)} (+15%)
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-400 font-semibold uppercase">Peso / Volumes</p>
                          {frete.transportadora === "Azul Cargo" && frete.pesoKg !== undefined ? (
                            <>
                              <p className="text-xs font-semibold text-slate-700">
                                {frete.pesoKg.toFixed(2)} KG
                              </p>
                              {frete.volumes !== undefined && (
                                <p className="text-xs font-medium text-slate-500 mt-0.5">
                                  {frete.volumes} {frete.volumes === 1 ? "volume" : "volumes"}
                                </p>
                              )}
                            </>
                          ) : (
                            <p className="text-xs font-semibold text-slate-700">
                              {formatWeightFromGrams(frete.pesoUsado)}
                            </p>
                          )}
                        </div>
                      </div>
                      {frete.observacao ? (
                        <p className="mt-2 text-xs italic text-slate-500 bg-slate-100/50 p-2 rounded-xl border border-slate-200/40">
                          {frete.observacao}
                        </p>
                      ) : null}
                    </div>
                  ))}

                  {!form.fretes.length ? (
                    <p className="col-span-2 text-sm text-slate-500 bg-slate-50 rounded-2xl p-4 text-center">
                      Nenhum frete cotado para esta proposta.
                    </p>
                  ) : null}
                </div>
              </>
            )}
          </FormSection>
                </fieldset>
              )}

              {activeFormTab === "pagamentos" && (
                <div className="space-y-6">
                  {form.id_int === "NOVO" || !proposta ? (
                    <div className="rounded-3xl border border-dashed border-amber-300 bg-amber-50 p-10 text-center">
                      <p className="text-sm font-semibold text-amber-700">Para gerar ou gerenciar cobranças, precisamos sincronizar os dados da proposta.</p>
                      <button
                        type="button"
                        onClick={handleSaveForCobranca}
                        className="mt-4 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700"
                      >
                        Salvar proposta agora
                      </button>
                    </div>
                  ) : (
                    <PropostaCobrancaPanel
                      proposta={proposta}
                      defaultModalOpen={autoAbrirCobranca}
                      onSavePropostaRequest={handleSaveForCobranca}
                      onRefreshProposta={() => {
                        if (onReload) onReload(true);
                        fetchSaldoCredito();
                      }}
                      onPagamentoIntegralConcluido={() => {
                        setSaveSuccessModal({ isOpen: true, finalIdInt: form.id_int });
                      }}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {shouldShowRest && (
          <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">
            <FormSection title="8. Resumo da proposta" description="Resumo consolidado incluindo pesos e valores extras das variações.">
              <ResumoValores resumo={resumo} bonusPercent={bonusPercent} />
              <fieldset disabled={isFormBloqueadoPorCobranca} className="group mt-4">
                <div className="grid gap-3 grid-cols-[75px_1fr] items-start">
                  <Field label="Tipo">
                    <select
                      value={form.descontoGeralTipo}
                      onChange={(event) => updateField("descontoGeralTipo", event.target.value as TipoDescontoProposta)}
                      disabled={!canEditarDescontoGeral}
                      className={`${inputClass} ${!canEditarDescontoGeral ? "bg-slate-100 cursor-not-allowed text-slate-500 opacity-80" : ""}`}
                    >
                      <option value="PERCENTUAL">%</option>
                      <option value="VALOR">R$</option>
                    </select>
                  </Field>
                  <Field label="Desconto geral">
                    {/* Nota técnica: O desconto geral é temporário (cálculo em memória) e não é persistido no banco de dados. */}
                    <input
                      value={form.descontoGeralValor}
                      onChange={(event) => updateField("descontoGeralValor", event.target.value)}
                      disabled={!canEditarDescontoGeral}
                      className={`${inputClass} ${!canEditarDescontoGeral ? "bg-slate-100 cursor-not-allowed text-slate-500 opacity-80" : ""}`}
                      placeholder="0,00"
                    />
                  </Field>
                </div>
                {!canEditarDescontoGeral && (
                  <p className="mt-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-center gap-1.5 shadow-sm">
                    🔒 Edição restrita a administradores e gerentes.
                  </p>
                )}
              </fieldset>
            </FormSection>

            <FormSection title="9. Envio da proposta" description="Texto informal para envio via WhatsApp.">
              <textarea readOnly value={informalText} className="min-h-72 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 outline-none" />
              <button 
                type="button" 
                onClick={copyInformal} 
                disabled={!form.freteEscolhidoId}
                className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white transition ${!form.freteEscolhidoId ? "bg-slate-300 cursor-not-allowed" : "bg-[#0b2f4a] hover:bg-[#082236]"}`}
                title={!form.freteEscolhidoId ? "Escolha um frete primeiro" : ""}
              >
                <Copy className="h-4 w-4" />
                Copiar resumo para WhatsApp
              </button>
            </FormSection>

            <FormSection title="10. Observações e Condições" description="Notas internas ou termos da proposta comercial.">
              <textarea value={form.observacoes} onChange={(event) => updateField("observacoes", event.target.value)} className={`${inputClass} min-h-36 resize-y`} placeholder="Ex: Prazo de entrega estendido por conta de logística do frete..." />
            </FormSection>
          </div>
        )}
      </section>

      {shouldShowRest && (
        <div className="sticky bottom-4 z-20 rounded-3xl border border-[#d7e5e8] bg-white/95 p-4 shadow-xl shadow-slate-900/10 backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-slate-700">Proposta #{form.id_int || "NOVA"} | Total {formatCurrency(resumo.valorTotal)}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={() => handleNavigateRef.current(mode === "edit" && proposta ? `/orcamentos/${proposta.id_int}` : "/orcamentos")} className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Cancelar</button>
              <button type="button" onClick={handleSave} disabled={isSaving || isQuotingSedex || isQuotingAzul || isQuotingTransp || isQuotingVeppo} className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">{isSaving ? "Salvando..." : mode === "edit" ? "Salvar alterações" : "Salvar proposta"}</button>
            </div>
          </div>
        </div>
      )}

      {isContactModalOpen ? <ContactModal draft={contactDraft} onChange={setContactDraft} onClose={() => setIsContactModalOpen(false)} onSave={addContact} /> : null}
      {editingContactId ? (
        <ContactEditModal
          draft={editContactDraft}
          onChange={setEditContactDraft}
          onClose={() => setEditingContactId(null)}
          onSave={saveEditedContact}
        />
      ) : null}
      {isAddressModalOpen ? <AddressModal draft={addressDraft} onChange={setAddressDraft} onClose={() => setIsAddressModalOpen(false)} onSave={addAddress} isSaving={isSavingAddress} /> : null}
      {pendingEnderecoSelection ? (
        <Modal
          title="Atenção"
          onClose={cancelEnderecoSocio}
          onSave={confirmEnderecoSocio}
          saveLabel="Confirmar"
        >
          <div className="p-2">
            <p className="text-sm font-medium text-slate-800">
              Endereço de ENTREGA não corresponde ao endereço constante na Nota Fiscal
            </p>
          </div>
        </Modal>
      ) : null}
      {isManualFreteModalOpen ? (
        <ManualFreteModal
          draft={manualFreteDraft}
          onChange={setManualFreteDraft}
          onClose={() => setIsManualFreteModalOpen(false)}
          onSave={handleSaveManualFrete}
        />
      ) : null}
        {showArtesBlockModal && (
          <ArtesBlockModal
            erros={showArtesBlockModal}
            onClose={() => setShowArtesBlockModal(null)}
          />
        )}

        {isUnsavedModalOpen && (
          <UnsavedChangesModal
          isSaving={isSaving}
          hideExitWithoutSaving={unsavedModalMode === "pagamentos"}
          title={unsavedModalMode === "pagamentos" ? "Salvar alterações" : "Existem alterações não salvas"}
          description={unsavedModalMode === "pagamentos" ? "Você deve salvar as alterações antes de acessar a aba Pagamentos." : "Você fez alterações nesta proposta. Deseja salvar antes de sair?"}
          saveLabel={unsavedModalMode === "pagamentos" ? "Salvar e continuar" : "Salvar e sair"}
          onContinueEditing={() => {
            setIsUnsavedModalOpen(false);
            setUnsavedModalMode("default");
            setPendingNavigation(null);
          }}
          onExitWithoutSaving={() => {
            const dest = pendingNavigation || "/orcamentos";
            // Reset snapshot so guard doesn't re-trigger
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { fretes: _f, ...curr } = form;
            initialFormSnapshot.current = JSON.stringify(curr);
            setIsUnsavedModalOpen(false);
            setUnsavedModalMode("default");
            setPendingNavigation(null);
            router.push(dest);
          }}
          onSaveAndExit={() => {
            const mode = unsavedModalMode;
            setIsUnsavedModalOpen(false);
            setUnsavedModalMode("default");
            // No gate da aba Pagamentos com proposta ainda nova, usar o fluxo
            // que redireciona para /editar?tab=pagamentos (handleSaveForCobranca).
            // handleSave genérico salva mas não leva à aba Pagamentos.
            if (mode === "pagamentos" && form.id_int === "NOVO") {
              void handleSaveForCobranca();
            } else {
              void handleSave();
            }
          }}
        />
      )}
      
      {/* MODAL DE SUCESSO DE SALVAMENTO */}
      {carteiraWarning && (
        <Modal
          title="Atenção à Carteira"
          onClose={() => {
            setCarteiraWarning(null);
            handleClearCliente("#");
          }}
          onSave={() => setCarteiraWarning(null)}
          saveLabel="Ciente, continuar"
        >
          <div className="flex items-start gap-3 mt-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            <p className="text-sm text-slate-600 pt-2">
              Este cliente pertence à carteira do vendedor <strong>{carteiraWarning}</strong>. Você pode continuar a proposta normalmente, mas fique ciente desta vinculação.
            </p>
          </div>
        </Modal>
      )}
      {duplicateProductPrompt && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md scale-100 rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-4 text-amber-600">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold text-slate-900">Este produto já foi adicionado nesta proposta.</h3>
            </div>
            <p className="mb-6 text-sm text-slate-600">
              <strong>{duplicateProductPrompt.nomeProduto}</strong> (#{duplicateProductPrompt.idProduto}) já está no
              orçamento
              {duplicateProductPrompt.totalLinhas > 1 ? ` em ${duplicateProductPrompt.totalLinhas} linhas` : ""}. Você
              pode ajustar a quantidade do item existente ou incluir uma nova linha com outra configuração/variação.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => {
                  handleEditItem(duplicateProductPrompt.existingItemId);
                  setDuplicateProductPrompt(null);
                }}
                className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Atualizar quantidade
              </button>
              <button
                type="button"
                onClick={() => {
                  const alvo = duplicateProductPrompt.productId;
                  setDuplicateProductPrompt(null);
                  void addProductLine(alvo);
                }}
                className="btn-primary flex-1 rounded-2xl px-4 py-3 font-semibold"
              >
                Adicionar novo item
              </button>
            </div>
            <button
              type="button"
              onClick={() => setDuplicateProductPrompt(null)}
              className="mt-3 w-full rounded-2xl px-4 py-2 text-sm font-semibold text-slate-500 transition hover:text-slate-700"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      {deleteProductConfirmOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md scale-100 rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-4 text-red-600">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100">
                <AlertOctagon className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold">{canEditarPropostaPaga && hasActiveCobranca ? "Inativar produto?" : "Excluir produto?"}</h3>
            </div>
            <p className="mb-6 text-sm text-slate-600">
              {(() => {
                const item = form.itens.find(i => i.id === deletingProductId);
                if (canEditarPropostaPaga && hasActiveCobranca) {
                  return "Este produto será inativado (marcado como Removido/Inativo) e o total da proposta será recalculado. A ação é reversível — você pode restaurá-lo antes de salvar. Se gerar diferença de valor, você a resolverá em seguida.";
                }
                if (!item) return "Tem certeza que deseja excluir este produto do orçamento?";
                const hasModels = form.pedidosModelos.some(
                  (m) =>
                    (m.id_produto_proposta_origem && item.id_produto_proposta_origem && m.id_produto_proposta_origem === item.id_produto_proposta_origem) ||
                    (m.item_temp_id && m.item_temp_id === item.id)
                );
                return hasModels
                  ? "Este produto possui modelos/lotes vinculados. Ao excluir o produto, os modelos deste produto também serão removidos. Deseja continuar?"
                  : "Tem certeza que deseja excluir este produto do orçamento?";
              })()}
            </p>
            <div className="flex gap-3">
              <button 
                type="button"
                onClick={() => { setDeleteProductConfirmOpen(false); setDeletingProductId(null); }}
                disabled={isDeletingProduct}
                className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button 
                type="button"
                onClick={() => void confirmRemoveProduct()}
                disabled={isDeletingProduct}
                className="flex-1 rounded-2xl bg-red-600 px-4 py-3 font-semibold text-white transition hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {isDeletingProduct ? (
                  <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />{canEditarPropostaPaga && hasActiveCobranca ? "Inativando..." : "Excluindo..."}</>
                ) : (canEditarPropostaPaga && hasActiveCobranca ? "Sim, inativar" : "Sim, excluir")}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* MODAL DE SUCESSO DE SALVAMENTO */}
      {consolidarConfirmOpen && (
        <Modal
          title="Consolidar Total Oficial"
          onClose={() => !isConsolidating && setConsolidarConfirmOpen(false)}
          onSave={async () => {
            if (!proposta?.id_int) return;
            setIsConsolidating(true);
            try {
              const supabase = (await import("@/lib/supabase/client")).getSupabaseClient();
              const sessionRes = supabase ? await supabase.auth.getSession() : { data: { session: null } };
              const token = sessionRes.data.session?.access_token ?? "";

              const response = await fetch("/api/orcamentos/consolidar-total-paga", {
                method: "POST",
                headers: { 
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({ idInt: proposta.id_int })
              });
              
              const data = await response.json();
              if (!response.ok) {
                throw new Error(data.error || "Falha ao consolidar total financeiro.");
              }
              
              showToast({ type: "success", title: "Sucesso", description: data.message || "Total financeiro consolidado." });
              window.location.reload();
            } catch (err: any) {
              console.error(err);
              showToast({ type: "error", title: "Erro", description: err.message || "Falha ao consolidar." });
            } finally {
              setIsConsolidating(false);
              setConsolidarConfirmOpen(false);
            }
          }}
          saveLabel={isConsolidating ? "Consolidando..." : "Confirmar Consolidação"}
        >
          <div className="flex items-start gap-3 mt-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            <p className="text-sm text-slate-600 pt-2">
              Esta proposta possui itens inconsistentes no financeiro. Deseja consolidar o total usando os itens ativos atuais?
            </p>
          </div>
        </Modal>
      )}

      {saveSuccessModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-[#0b2f4a]">Proposta Salva!</h2>
              <button
                type="button"
                onClick={() => setSaveSuccessModal({ isOpen: false, finalIdInt: "" })}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <p className="mb-6 text-sm text-slate-600">
              A proposta foi salva com sucesso. O que você deseja fazer agora?
            </p>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => {
                  setSaveSuccessModal({ isOpen: false, finalIdInt: "" });
                  window.location.reload();
                }}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 hover:text-[#0b2f4a] hover:border-slate-300"
              >
                1. Salvar e ficar
              </button>
              <button
                type="button"
                onClick={() => router.push("/orcamentos")}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 hover:text-[#0b2f4a] hover:border-slate-300"
              >
                2. Salvar e voltar pra lista
              </button>
              <button
                type="button"
                onClick={() => router.push(`/orcamentos/${saveSuccessModal.finalIdInt}`)}
                className="w-full rounded-2xl bg-[#0b2f4a] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
              >
                3. Salvar e ver detalhes
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Modal obrigatório de diferença financeira — não pode ser fechado sem escolher ação */}
      {diferencaModal && (
        <DiferencaFinanceiraModal
          isOpen={diferencaModal.isOpen}
          onConfirm={handleDiferencaConfirm}
          onClose={async () => {
            setDiferencaModal(null);
            // Re-fetch pendencias to ensure the UI shows the real pendency from DB
            try {
              const { listPropostasPendencias } = await import("@/features/orcamentos/services/propostas-pendencias.service");
              const { data } = await listPropostasPendencias(Number(form.id_int));
              const aberta = data.find(p => p.status === "ABERTA" && (p.origem === "REVISAO_PROPOSTA_PAGA" || (p.origem === "SISTEMA" && String(p.titulo).startsWith("Revisão financeira pendente"))));
              if (aberta) {
                setPendenciaRevisaoAberta({ id: aberta.id, descricao: aberta.descricao });
              } else {
                setPendenciaRevisaoAberta(null);
              }
            } catch (err) {
              console.error("Falha ao recarregar pendências:", err);
            }
          }}
          idInt={diferencaModal.idInt}
          idCliente={diferencaModal.idCliente}
          idPendencia={diferencaModal.idPendencia}
          nomeCliente={diferencaModal.nomeCliente}
          valorPagoConfirmado={diferencaModal.valorPagoConfirmado}
          novoTotal={diferencaModal.novoTotal}
          diferenca={diferencaModal.diferenca}
          canBonificar={canBonificar}
          canDevolver={canDevolver}
          canDebitoFuturo={canDebitoFuturo}
        />
      )}


    </div>
  );
}

function ProductItemSummary({
  item,
  isRemoveAllowed,
  onEdit,
  onDuplicate,
  onRemove
}: {
  item: PropostaItem;
  isRemoveAllowed?: boolean;
  onEdit: () => void;
  onDuplicate?: () => void;
  onRemove: () => void;
}) {
  const selectedVariationsText = item.variacoesEscolhidas.length > 0
    ? item.variacoesEscolhidas.map(v => `${v.variacao.nome}: ${v.tipo.variacao}`).join(", ")
    : "Padrão (Sem variação)";

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-200">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2 text-lg text-[#0b2f4a]">
            <span>#{item.id_produto}</span>
            <h4 className="font-extrabold">{item.nome}</h4>
            <span>- Qtd:</span>
            <span className="font-extrabold">{item.quantidade.toLocaleString("pt-BR")}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-1 text-sm font-medium text-slate-600">
            <span>Peso: <strong className="text-slate-900">{formatWeightFromGrams(item.pesoTotal)}</strong></span>
            <span>Variações: <strong className="text-slate-900">{selectedVariationsText}</strong></span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-6 border-t border-slate-100 pt-3 sm:border-t-0 sm:pt-0 sm:justify-end">
          <div className="text-right">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide">Subtotal</p>
            <p className="text-lg font-extrabold text-[#0b2f4a]">{formatCurrency(item.subtotal)}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-[#0b2f4a] hover:bg-slate-50 hover:border-[#d7e5e8] transition-all"
            >
              Editar
            </button>
            {onDuplicate ? (
              <button
                type="button"
                onClick={onDuplicate}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-[#0b2f4a] hover:bg-slate-50 hover:border-[#d7e5e8] transition-all"
                title="Duplicar item (mesma configuração em uma nova linha)"
              >
                Duplicar
              </button>
            ) : null}
            <button
              type="button"
              onClick={onRemove}
              disabled={!isRemoveAllowed}
              className={`rounded-2xl border border-red-100 bg-white p-2 text-red-600 hover:bg-red-50 hover:border-red-200 transition-all ${!isRemoveAllowed ? 'opacity-50 cursor-not-allowed' : ''}`}
              title={!isRemoveAllowed ? "Item não pode ser removido neste status" : "Remover item"}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductItemEditor({
  item,
  bonusPercent,
  hasVariationError,
  onUpdate,
  onVariationChange,
  onRemove,
  onSave,
  minQuantity,
  podeEditarVariacoes,
  canEditarValoresItem,
  isRemoveAllowed,
  isPrecoFixoAplicado
}: {
  item: PropostaItem;
  bonusPercent: number;
  hasVariationError: boolean;
  onUpdate: (updater: (item: PropostaItem) => PropostaItem) => void;
  onVariationChange: (idVariacao: number, tipoId: string) => void;
  onRemove: () => void;
  onSave: () => void;
  minQuantity?: number;
  podeEditarVariacoes?: boolean;
  canEditarValoresItem?: boolean;
  isRemoveAllowed?: boolean;
  isPrecoFixoAplicado?: boolean;
}) {
  const { showToast } = useAppToast();
  return (
    <div 
      className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-inner space-y-4"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const target = e.target as HTMLElement;
          if (target.tagName.toLowerCase() === 'select' || target.tagName.toLowerCase() === 'textarea') return;
          e.preventDefault();
          e.stopPropagation();
          onSave();
        }
      }}
    >
      {/* Title bar / Header */}
      <div className="flex items-center justify-between border-b border-slate-200/60 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-400">#{item.id_produto}</span>
          <h4 className="text-base font-bold text-[#0b2f4a]">{item.nome}</h4>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-500">Peso parcial: <strong>{formatWeightFromGrams(item.pesoTotal)}</strong></span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-1 items-start">
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-4 items-start">
          <Field label="Quantidade">
            <input
              type="number"
              value={item.quantidade || ""}
              onChange={(event) => onUpdate((current) => ({ ...current, quantidade: Math.max(0, Number(event.target.value)) }))}
              onBlur={(e) => {
                const val = Math.max(0, Number(e.target.value));
                if (minQuantity !== undefined && val < minQuantity) {
                  showToast({ type: "error", title: "Quantidade inválida", description: `A quantidade não pode ser menor que a soma dos modelos (${minQuantity}).` });
                  onUpdate((current) => ({ ...current, quantidade: minQuantity }));
                }
              }}
              className={inputClass}
              placeholder="Qtd"
            />
          </Field>
          <Field label="Valor Unitário (R$)">
            <input
              type="number"
              step="0.0001"
              value={item.valorUnitario || ""}
              onChange={(event) => onUpdate((current) => ({ ...current, valorUnitario: Math.max(0, Number(event.target.value)) }))}
              className={inputClass}
              placeholder="0,00"
              disabled={!canEditarValoresItem}
            />
          </Field>
          <Field label="Fixo (R$)">
            <input
              type="number"
              step="0.01"
              value={isPrecoFixoAplicado ? "0" : (item.valorFixo || "")}
              onChange={(event) => onUpdate((current) => ({ ...current, valorFixo: Math.max(0, Number(event.target.value)) }))}
              className={inputClass}
              placeholder="0,00"
              disabled={isPrecoFixoAplicado || !canEditarValoresItem}
            />
          </Field>
          <InfoBox label="Subtotal final" value={formatCurrency(item.subtotal)} />
        </div>
      </div>

      <div className="pt-1">
        <Field label="Descrição do produto">
          <textarea
            value={item.descricaoModelo || ""}
            onChange={(event) => onUpdate((current) => ({ ...current, descricaoModelo: event.target.value }))}
            className={`${inputClass} resize-y min-h-16`}
            placeholder="Informe detalhes, modelo, acabamento ou condições específicas deste item"
            rows={2}
          />
        </Field>
      </div>

      {bonusPercent > 0 ? (
        <div className="rounded-2xl bg-teal-50/60 border border-teal-100 p-3 text-xs font-semibold text-teal-800 flex items-center justify-between">
          <span>Tabela especial do cliente aplicada</span>
          <span className="bg-teal-600 text-white rounded-full px-2.5 py-0.5 text-xs">-{bonusPercent}%</span>
        </div>
      ) : null}

      {item.produto.variacoes && item.produto.variacoes.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <h5 className="text-xs font-bold uppercase tracking-wider text-slate-400">Configuração de Variações</h5>
          <div className="grid gap-4 md:grid-cols-2">
            {item.produto.variacoes.map((variacao) => {
              const selected = item.variacoesEscolhidas.find((choice) => choice.id_variacao === variacao.id_variacao);
              const isMissing = hasVariationError && variacao.is_obrigatorio && !selected;
              return (
                <Field key={variacao.id} label={`${variacao.variacao.nome}${variacao.is_obrigatorio ? " *" : ""}`}>
                  <select
                    value={selected?.tipo.id ?? ""}
                    onChange={(event) => onVariationChange(variacao.id_variacao, event.target.value)}
                    className={`${inputClass} ${isMissing ? "border-red-300 bg-red-50 focus:ring-red-100" : ""}`}
                    disabled={!podeEditarVariacoes}
                  >
                    <option value="">Selecione</option>
                    {variacao.tipos.map((tipo) => (
                      <option key={tipo.id} value={tipo.id}>
                        {tipo.variacao} (+{formatCurrency(tipo.v_extra)} / {formatWeightFromGrams(tipo.peso, { mode: "g" })})
                      </option>
                    ))}
                  </select>
                </Field>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Rodapé de Ações */}
      <div className="flex items-center justify-between border-t border-slate-200/60 pt-4 mt-2">
        <button
          type="button"
          onClick={onRemove}
          disabled={!isRemoveAllowed}
          className={`rounded-2xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 hover:border-red-300 transition-all flex items-center gap-2 ${!isRemoveAllowed ? 'opacity-50 cursor-not-allowed' : ''}`}
          title={!isRemoveAllowed ? "Item não pode ser removido neste status" : "Remover item"}
        >
          <Trash2 className="h-4 w-4" />
          Remover item
        </button>
        <button
          type="button"
          onClick={onSave}
          className="rounded-2xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 shadow-md shadow-teal-700/10 transition-all"
        >
          Salvar item
        </button>
      </div>
    </div>
  );
}

/**
 * Acima deste número de opções a lista deixa de ser exibida inteira e vira um
 * combobox com busca. Até aqui (inclusive) nada muda: os cards continuam todos
 * à vista, como sempre foram.
 */
const MAX_OPCOES_VISIVEIS = 4;

type SelectorConteudo = { title: string; subtitle: string; detail: React.ReactNode };

type SelectorGridProps<T> = {
  items: T[];
  selectedId: string;
  onSelect: (id: string) => void;
  render: (item: T) => SelectorConteudo;
  onEdit?: (item: T, event: React.MouseEvent) => void;
  onCopy?: (item: T, event: React.MouseEvent) => void;
  extraClassNameForItem?: (item: T) => string;
  badgeForItem?: (item: T) => React.ReactNode;
  /** Texto do campo de pesquisa quando a lista vira combobox. */
  searchPlaceholder?: string;
  /**
   * Texto extra considerado na busca. `title` e `subtitle` já entram sempre;
   * use isto quando houver campo pesquisável que não cabe no rótulo do card
   * (ex.: cidade do endereço, que só aparece quando não há recebedor).
   */
  searchTextForItem?: (item: T) => string;
};

/** Card de uma opção — o mesmo visual na grade e dentro do combobox. */
function SelectorCard({
  content,
  badge,
  isSelected,
  extraClass,
  onClick,
  onEdit,
  onCopy,
  destacado,
  innerRef,
  ...rest
}: {
  content: SelectorConteudo;
  badge?: React.ReactNode;
  isSelected: boolean;
  extraClass?: string;
  onClick?: () => void;
  onEdit?: (event: React.MouseEvent) => void;
  onCopy?: (event: React.MouseEvent) => void;
  /** Opção sob o cursor do teclado dentro do combobox. */
  destacado?: boolean;
  innerRef?: React.Ref<HTMLDivElement>;
  // `content` e `onCopy` existem em HTMLAttributes (microdata e clipboard) com
  // outro significado; ficam de fora para não colidir com os nossos.
} & Omit<React.HTMLAttributes<HTMLDivElement>, "content" | "onCopy" | "onClick">) {
  return (
    <div
      {...rest}
      ref={innerRef}
      data-ativo={destacado ? "1" : undefined}
      onClick={onClick}
      className={`relative rounded-3xl border p-4 text-left transition flex justify-between items-start cursor-pointer ${
        isSelected
          ? "border-[#24665d] bg-[#24665d] text-[#86e2d5]"
          : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white"
      } ${extraClass || ""} ${destacado ? "ring-2 ring-[#0f9f9a] ring-offset-1" : ""} ${rest.className || ""}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <p className="font-semibold truncate">{content.title}</p>
          {badge}
        </div>
        <p className="text-sm opacity-80 truncate">{content.subtitle}</p>
        <div className="mt-1 text-xs opacity-70 truncate">{content.detail}</div>
      </div>
      <div className="flex shrink-0 ml-2">
        {onCopy && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCopy(e);
            }}
            className="p-1.5 rounded-full hover:bg-slate-200/50 text-slate-400 hover:text-slate-600 transition"
            title="Copiar endereço"
            aria-label="Copiar endereço"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(e);
            }}
            className="ml-1 p-1.5 rounded-full hover:bg-slate-200/50 text-slate-400 hover:text-slate-600 transition"
            title="Editar"
            aria-label="Editar endereço"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Mesma seleção do SelectorGrid, porém condensada: mostra só a opção escolhida
 * e abre a lista completa com campo de busca. Usado automaticamente quando há
 * mais de MAX_OPCOES_VISIVEIS opções, para o card não crescer sem limite.
 */
function SelectorCombobox<T extends { id: string }>({
  items,
  selectedId,
  onSelect,
  render,
  onEdit,
  onCopy,
  extraClassNameForItem,
  badgeForItem,
  searchPlaceholder,
  searchTextForItem
}: SelectorGridProps<T>) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [indiceAtivo, setIndiceAtivo] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const gatilhoRef = useRef<HTMLDivElement>(null);
  const buscaRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const listaId = useId();

  const selecionado = items.find((item) => item.id === selectedId) || null;

  const termo = busca.trim().toLowerCase();
  const filtrados = termo
    ? items.filter((item) => {
        const content = render(item);
        const extra = searchTextForItem ? searchTextForItem(item) : "";
        const alvo = [
          content.title,
          content.subtitle,
          typeof content.detail === "string" ? content.detail : "",
          extra
        ]
          .join(" ")
          .toLowerCase();
        return termo.split(/\s+/).every((parte) => alvo.includes(parte));
      })
    : items;

  const fechar = useCallback((devolverFoco = false) => {
    setAberto(false);
    setBusca("");
    if (devolverFoco) gatilhoRef.current?.focus();
  }, []);

  const abrir = useCallback(() => {
    const atual = items.findIndex((item) => item.id === selectedId);
    setIndiceAtivo(atual >= 0 ? atual : 0);
    setBusca("");
    setAberto(true);
  }, [items, selectedId]);

  const escolher = useCallback(
    (id: string) => {
      onSelect(id);
      fechar(true);
    },
    [onSelect, fechar]
  );

  // Clique fora fecha, como no seletor de clientes desta mesma tela.
  useEffect(() => {
    if (!aberto) return;
    const handler = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) fechar();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [aberto, fechar]);

  useEffect(() => {
    if (aberto) buscaRef.current?.focus();
  }, [aberto]);

  // Mantém a opção sob o cursor do teclado visível na área rolável.
  useEffect(() => {
    if (!aberto) return;
    listaRef.current?.querySelector('[data-ativo="1"]')?.scrollIntoView({ block: "nearest" });
  }, [aberto, indiceAtivo, busca]);

  const navegar = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndiceAtivo((i) => (filtrados.length ? (i + 1) % filtrados.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndiceAtivo((i) => (filtrados.length ? (i - 1 + filtrados.length) % filtrados.length : 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setIndiceAtivo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setIndiceAtivo(Math.max(0, filtrados.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const alvo = filtrados[indiceAtivo];
      if (alvo) escolher(alvo.id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      fechar(true);
    } else if (event.key === "Tab") {
      fechar();
    }
  };

  const conteudoSelecionado: SelectorConteudo = selecionado
    ? render(selecionado)
    : {
        title: "Selecione uma opção",
        subtitle: `${items.length} opções disponíveis`,
        detail: "Clique para pesquisar e escolher"
      };

  return (
    <div ref={containerRef} className="relative">
      <SelectorCard
        innerRef={gatilhoRef}
        role="combobox"
        tabIndex={0}
        aria-expanded={aberto}
        aria-haspopup="listbox"
        aria-controls={listaId}
        content={conteudoSelecionado}
        badge={
          <>
            {selecionado && badgeForItem ? badgeForItem(selecionado) : null}
            <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold opacity-70">
              {aberto ? "Fechar" : "Trocar"}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${aberto ? "rotate-180" : ""}`} />
            </span>
          </>
        }
        isSelected={Boolean(selecionado)}
        extraClass={selecionado && extraClassNameForItem ? extraClassNameForItem(selecionado) : ""}
        className={selecionado ? "" : "!border-dashed !border-slate-300 !bg-white !text-slate-500"}
        onClick={() => (aberto ? fechar() : abrir())}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
            event.preventDefault();
            if (!aberto) abrir();
          }
        }}
        onCopy={selecionado && onCopy ? (event) => onCopy(selecionado, event) : undefined}
        onEdit={selecionado && onEdit ? (event) => onEdit(selecionado, event) : undefined}
      />

      {aberto && (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 rounded-3xl border border-[#d7e5e8] bg-white p-3 shadow-xl">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5">
            <Search className="h-4 w-4 shrink-0 text-[#0f9f9a]" />
            <input
              ref={buscaRef}
              value={busca}
              onChange={(event) => {
                setBusca(event.target.value);
                setIndiceAtivo(0);
              }}
              onKeyDown={navegar}
              className="w-full bg-transparent text-sm text-slate-900 outline-none"
              placeholder={searchPlaceholder || "Pesquisar..."}
              aria-label={searchPlaceholder || "Pesquisar"}
            />
            {busca && (
              <button
                type="button"
                onClick={() => {
                  setBusca("");
                  setIndiceAtivo(0);
                  buscaRef.current?.focus();
                }}
                className="rounded-xl p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600"
                aria-label="Limpar pesquisa"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>

          <div
            ref={listaRef}
            id={listaId}
            role="listbox"
            className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1"
          >
            {filtrados.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
                Nenhuma opção encontrada para “{busca.trim()}”.
              </p>
            ) : (
              filtrados.map((item, indice) => (
                <SelectorCard
                  key={item.id}
                  role="option"
                  aria-selected={selectedId === item.id}
                  content={render(item)}
                  badge={badgeForItem ? badgeForItem(item) : null}
                  isSelected={selectedId === item.id}
                  extraClass={extraClassNameForItem ? extraClassNameForItem(item) : ""}
                  destacado={indice === indiceAtivo}
                  onClick={() => escolher(item.id)}
                  onMouseEnter={() => setIndiceAtivo(indice)}
                  onCopy={onCopy ? (event) => { fechar(); onCopy(item, event); } : undefined}
                  onEdit={onEdit ? (event) => { fechar(); onEdit(item, event); } : undefined}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SelectorGrid<T extends { id: string }>(props: SelectorGridProps<T>) {
  const { items, selectedId, onSelect, render, onEdit, onCopy, extraClassNameForItem, badgeForItem } = props;

  if (items.length > MAX_OPCOES_VISIVEIS) {
    return <SelectorCombobox {...props} />;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((item) => (
        <SelectorCard
          key={item.id}
          content={render(item)}
          badge={badgeForItem ? badgeForItem(item) : null}
          isSelected={selectedId === item.id}
          extraClass={extraClassNameForItem ? extraClassNameForItem(item) : ""}
          onClick={() => onSelect(item.id)}
          onCopy={onCopy ? (event) => onCopy(item, event) : undefined}
          onEdit={onEdit ? (event) => onEdit(item, event) : undefined}
        />
      ))}
    </div>
  );
}

function ResumoValores({ resumo, bonusPercent }: { resumo: ReturnType<typeof calculateResumo>; bonusPercent: number }) {
  const rows = [
    ["Subtotal bruto", formatCurrency(resumo.subtotalBrutoProdutos)],
    [`Tabela especial do cliente aplicada${bonusPercent > 0 ? ` (-${bonusPercent}%)` : ""}`, `-${formatCurrency(resumo.acrescimoBonus)}`],
    ["Subtotal produtos", formatCurrency(resumo.subtotalProdutos)],
    ["Desconto geral", `-${formatCurrency(resumo.descontoGeral)}`],
    ["Frete escolhido", formatCurrency(resumo.frete)],
    ["Peso total", formatWeightFromGrams(resumo.pesoTotal)]
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
          <strong className="text-xl text-[#0b2f4a] font-extrabold">{formatCurrency(resumo.valorTotal)}</strong>
        </div>
      </div>
    </div>
  );
}

export function FormSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm"><div className="mb-5"><h2 className="text-lg font-semibold text-slate-950">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div>{children}</section>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-2"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>{children}</label>;
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-900">{value}</p></div>;
}

function ManualFreteModal({
  draft,
  onChange,
  onClose,
  onSave
}: {
  draft: { servico: string; prazo: string; valor: string; escolhido: boolean };
  onChange: (d: { servico: string; prazo: string; valor: string; escolhido: boolean }) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Modal title="Adicionar Frete Manual" onClose={onClose} onSave={onSave}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Transportador / Serviço">
          <input
            value={draft.servico}
            onChange={(event) => onChange({ ...draft, servico: event.target.value })}
            className={inputClass}
            placeholder="Ex: Correios SEDEX, Jamef, Azul..."
          />
        </Field>
        <Field label="Prazo (Ex: 4 dias úteis)">
          <input
            value={draft.prazo}
            onChange={(event) => onChange({ ...draft, prazo: event.target.value })}
            className={inputClass}
            placeholder="Ex: 5 dias úteis"
          />
        </Field>
        <Field label="Valor (R$)">
          <input
            type="number"
            value={draft.valor}
            onChange={(event) => onChange({ ...draft, valor: event.target.value })}
            className={inputClass}
            placeholder="0.00"
            step="0.01"
          />
        </Field>
        <label className="flex items-center gap-3 pt-6 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.escolhido}
            onChange={(event) => onChange({ ...draft, escolhido: event.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          <span className="text-sm font-semibold text-slate-700">Usar como frete escolhido</span>
        </label>
      </div>
    </Modal>
  );
}

function ContactModal({ draft, onChange, onClose, onSave }: { draft: ContactDraft; onChange: (draft: ContactDraft) => void; onClose: () => void; onSave: () => void }) {
  return (
    <Modal title="Adicionar novo contato" onClose={onClose} onSave={onSave}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Nome"><input value={draft.nome} onChange={(event) => onChange({ ...draft, nome: event.target.value })} className={inputClass} /></Field>
        <Field label="Cargo"><input value={draft.cargo} onChange={(event) => onChange({ ...draft, cargo: event.target.value })} className={inputClass} /></Field>
        <Field label="WhatsApp"><input value={draft.whatsapp} onChange={(event) => onChange({ ...draft, whatsapp: event.target.value })} className={inputClass} /></Field>
        <Field label="E-mail"><input value={draft.email} onChange={(event) => onChange({ ...draft, email: event.target.value })} className={inputClass} /></Field>
      </div>
    </Modal>
  );
}

function AddressModal({ draft, onChange, onClose, onSave, isSaving, mode = "create" }: { draft: AddressDraft; onChange: (draft: AddressDraft) => void; onClose: () => void; onSave: () => void; isSaving?: boolean; mode?: "create" | "edit" }) {
  const { showToast } = useAppToast();
  const [isCepLoading, setIsCepLoading] = useState(false);
  const cleanCep = (draft.cep || "").replace(/\D/g, "");

  useEffect(() => {
    if (cleanCep.length === 8 && !isCepLoading) {
      setIsCepLoading(true);
      fetch(`https://viacep.com.br/ws/${cleanCep}/json/`)
        .then((res) => res.json())
        .then((data) => {
          if (!data.erro) {
            onChange({
              ...draft,
              endereco: data.logradouro || draft.endereco,
              bairro: data.bairro || draft.bairro,
              cidade: data.localidade || draft.cidade,
              uf: data.uf || draft.uf
            });
          } else {
            showToast({ type: "warning", title: "CEP não encontrado", description: "O CEP informado não retornou dados no ViaCEP." });
          }
        })
        .catch(() => {
          showToast({ type: "error", title: "Falha na busca", description: "Ocorreu um erro ao consultar o CEP." });
        })
        .finally(() => setIsCepLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanCep]);


  const cepMask = (value: string) => {
    const v = value.replace(/\D/g, "");
    return v.replace(/^(\d{5})(\d)/, "$1-$2").slice(0, 9);
  };

  const cpfMask = (value: string) => {
    let v = value.replace(/\D/g, "");
    if (v.length > 11) v = v.slice(0, 11);
    return v.replace(/(\d{3})(\d)/, "$1.$2")
            .replace(/(\d{3})(\d)/, "$1.$2")
            .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  };

  return (
    <Modal title={mode === "create" ? "Adicionar novo endereço" : "Editar endereço"} onClose={onClose} onSave={onSave} saveLabel={isSaving ? "Salvando..." : (mode === "edit" ? "Salvar" : "Adicionar")}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={isCepLoading ? "CEP (Buscando...)" : "CEP"}>
          <input value={cepMask(draft.cep || "")} onChange={(event) => onChange({ ...draft, cep: event.target.value })} className={inputClass} placeholder="00000-000" disabled={isCepLoading} />
        </Field>
        <Field label="Tipo">
          <select value={draft.tipo} onChange={(event) => onChange({ ...draft, tipo: event.target.value as CadastroEndereco["tipo"] })} className={inputClass}>
            <option value="principal">Principal</option>
            <option value="entrega">Entrega</option>
            <option value="cobranca">Cobrança</option>
            <option value="fiscal">Fiscal</option>
          </select>
        </Field>
        <Field label="Logradouro"><input value={draft.endereco} onChange={(event) => onChange({ ...draft, endereco: event.target.value })} className={inputClass} disabled={isCepLoading} /></Field>
        <Field label="Número"><input value={draft.numero} onChange={(event) => onChange({ ...draft, numero: event.target.value })} className={inputClass} /></Field>
        <Field label="Complemento"><input value={draft.complemento ?? ""} onChange={(event) => onChange({ ...draft, complemento: event.target.value })} className={inputClass} /></Field>
        <Field label="Bairro"><input value={draft.bairro} onChange={(event) => onChange({ ...draft, bairro: event.target.value })} className={inputClass} disabled={isCepLoading} /></Field>
        <Field label="Cidade"><input value={draft.cidade} onChange={(event) => onChange({ ...draft, cidade: event.target.value })} className={inputClass} disabled={isCepLoading} /></Field>
        <Field label="UF"><input value={draft.uf} onChange={(event) => onChange({ ...draft, uf: event.target.value.toUpperCase() })} className={inputClass} maxLength={2} disabled={isCepLoading} /></Field>
        <div className="md:col-span-2 border-t border-slate-100 pt-3 mt-1 grid gap-3 md:grid-cols-2">
          <Field label={isCepLoading ? "CPF do Recebedor (Consultando...)" : "CPF do Recebedor"}>
            <input value={cpfMask(draft.cpfRecebedor || "")} onChange={(event) => onChange({ ...draft, cpfRecebedor: event.target.value })} className={inputClass} placeholder="000.000.000-00" />
          </Field>
          <Field label="Nome do Recebedor">
            <input value={draft.recebedor || ""} onChange={(event) => onChange({ ...draft, recebedor: event.target.value })} className={inputClass} placeholder="Nome completo" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose, onSave, saveLabel = "Adicionar" }: { title: string; children: ReactNode; onClose: () => void; onSave: () => void; saveLabel?: string }) {
  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="mx-auto mt-8 max-w-3xl rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 p-5"><h2 className="text-lg font-semibold text-slate-950">{title}</h2><button type="button" onClick={onClose} className="rounded-2xl bg-slate-100 p-2 text-slate-700"><X className="h-5 w-5" /></button></div>
        <div className="p-5">{children}</div>
        <div className="flex flex-col gap-2 border-t border-slate-100 p-5 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Cancelar</button><button type="button" onClick={onSave} className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white">{saveLabel}</button></div>
      </div>
    </div>
  );
}

function ArtesBlockModal({
  erros,
  onClose
}: {
  erros: { nome: string; faltam: string[] }[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/50 p-4 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <h2 className="text-lg font-semibold text-slate-950">Modelos incompletos</h2>
          <button type="button" onClick={onClose} className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">
          <p className="text-sm text-slate-700 mb-4">Antes de acessar Artes, complete os modelos do Pedido.</p>
          <ul className="space-y-2">
            {erros.map((err, i) => (
              <li key={i} className="text-sm">
                <span className="font-semibold text-slate-900">• {err.nome}:</span> <span className="text-slate-600">{err.faltam.join(", ")}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-end border-t border-slate-100 p-5">
          <button type="button" onClick={onClose} className="rounded-2xl bg-[#0b2f4a] px-6 py-3 text-sm font-semibold text-white hover:bg-[#0b2f4a]/90">
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
}

function UnsavedChangesModal({
  onSaveAndExit,
  onExitWithoutSaving,
  onContinueEditing,
  isSaving,
  hideExitWithoutSaving,
  title = "Existem alterações não salvas",
  description = "Você fez alterações nesta proposta. Deseja salvar antes de sair?",
  saveLabel = "Salvar e sair"
}: {
  onSaveAndExit: () => void;
  onExitWithoutSaving: () => void;
  onContinueEditing: () => void;
  isSaving: boolean;
  hideExitWithoutSaving?: boolean;
  title?: string;
  description?: string;
  saveLabel?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-modal-title"
    >
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
        <div className="p-6">
          <h2 id="unsaved-modal-title" className="text-lg font-semibold text-slate-950">
            {title}
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            {description}
          </p>
        </div>
        <div className="flex flex-col gap-2 border-t border-slate-100 p-5 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onContinueEditing}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Continuar editando
          </button>
          {!hideExitWithoutSaving && (
            <button
              type="button"
              onClick={onExitWithoutSaving}
              className="rounded-2xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50"
            >
              Sair sem salvar
            </button>
          )}
          <button
            type="button"
            onClick={onSaveAndExit}
            disabled={isSaving}
            className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#123f61] disabled:opacity-60"
          >
            {isSaving ? "Salvando..." : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function createInitialState(proposta?: Proposta): PropostaFormState {

  const cliente = proposta?.cliente;
  const endereco = proposta?.enderecoEntrega;
  const isAvulso = proposta?.is_avulso ?? false;
  const clienteNaoCadastrado = proposta?.clienteNaoCadastrado ?? (cliente ? (cliente.idCliente === null || cliente.idCliente === undefined || Number(cliente.idCliente) === 0) : false);

  let fretes = proposta?.fretes ?? (endereco ? createFretesMock(endereco, proposta?.id_int ?? 0, proposta?.resumo.pesoTotal ?? 0) : []);
  const enderecoUf = endereco?.uf ?? (clienteNaoCadastrado ? (proposta?.enderecoEntrega?.uf ?? "") : "");
  if (enderecoUf?.toUpperCase() === "RS") {
    const hasRetira = fretes.some((f) => f.id === "frete_retira_balcao");
    if (!hasRetira) {
      fretes = [...fretes, {
        id: "frete_retira_balcao",
        id_int: proposta?.id_int ?? 0,
        transportadora: "Retirada Local",
        servico: "Sem custo",
        valor: 0.00,
        prazo: "Imediato",
        observacao: "Retirar pessoalmente no balcão da empresa",
        escolhido: false,
        pesoUsado: proposta?.resumo.pesoTotal ?? 0
      }];
    }
  }
  let chosenFrete = fretes.find((f) => f.escolhido) || fretes[0];

  if (isAvulso) {
    const singleManual = chosenFrete ? {
      ...chosenFrete,
      id: "frete_manual_unico",
      escolhido: true
    } : {
      id: "frete_manual_unico",
      id_int: proposta?.id_int ?? 0,
      transportadora: "Frete Manual",
      servico: "",
      valor: proposta?.resumo.frete ?? 0,
      prazo: "A combinar",
      observacao: "Cadastro manual",
      escolhido: true,
      pesoUsado: 0
    };
    fretes = [singleManual];
    chosenFrete = singleManual;
  }

  return {
    id_int: proposta?.id_int ? proposta.id_int.toString() : "NOVO",
    empresa: proposta?.empresa ?? "Ideal Grafica",
    vendedor: proposta?.vendedor ?? (cliente ? getClienteVendedorPadrao(cliente) : ""),
    status: proposta?.status ?? "NOVO",
    clienteId: clienteNaoCadastrado ? "" : (cliente ? cliente.idCliente.toString() : ""),
    contatoId: clienteNaoCadastrado ? "" : (proposta?.contato.id ?? cliente?.contatos[0]?.id ?? ""),
    enderecoId: clienteNaoCadastrado ? "" : (endereco?.id ?? (
      cliente?.enderecos?.find(e => e.tipo === "entrega")?.id || 
      cliente?.enderecos?.find(e => e.tipo === "principal")?.id || 
      cliente?.enderecos?.[0]?.id || ""
    )),
    compradorId: (() => {
      if (clienteNaoCadastrado) return "";
      // Default: the client itself is the faturado (use cliente.id UUID)
      const clienteSelfId = cliente?.id ? cliente.id.toString() : "";
      if (!proposta?.id_faturado) return clienteSelfId;
      // If id_faturado matches the client's own idCliente → client is faturado
      if (proposta.id_faturado === Number(cliente?.idCliente)) return clienteSelfId;
      // Otherwise find the vinculo where idClienteRelacionado === id_faturado
      const vinculo = cliente?.vinculosComerciais?.find(
        (v) => v.idClienteRelacionado === proposta.id_faturado
      );
      return vinculo?.id ?? clienteSelfId;
    })(),
    // Recalcular b\u00f4nus do cliente em cada item ao inicializar o formul\u00e1rio de edi\u00e7\u00e3o.
    // Garante que acrescimoBonus e subtotal est\u00e3o corretos
    // mesmo que o banco tenha gravado o valor_sub_total bruto (sem b\u00f4nus) em propostas antigas.
    // O recalculo \u00e9 idempotente: se o service j\u00e1 recalculou na carga, o resultado \u00e9 id\u00eantico.
    itens: (() => {
      const rawItens = proposta?.itens ?? [];
      if (!cliente || rawItens.length === 0) return rawItens;
      const bp = getClienteBonusPercent(cliente);
      if (bp <= 0) return rawItens;
      return rawItens.map((item) => {
        const totals = calculateItemSubtotal(item, bp);
        return { ...item, ...totals };
      });
    })(),
    deletedProdutoPropostaIds: [],
    pedidosModelos: [],
    fretes,
    freteEscolhidoId: isAvulso ? "frete_manual_unico" : (proposta?.freteEscolhidoId ?? fretes.find((frete) => frete.escolhido)?.id ?? fretes[0]?.id ?? ""),
    descontoGeralTipo: proposta?.descontoGeralTipo ?? "VALOR",
    descontoGeralValor: proposta?.descontoGeralValor ? proposta.descontoGeralValor.toString() : "0",
    formaPagamento: proposta?.formaPagamento ?? "Pix a vista 3 dias",
    observacoes: proposta?.observacoes ?? "",
    isAvulso,
    valorProdutosManual: isAvulso ? formatCurrencyWithoutPrefix(proposta?.resumo.subtotalProdutos ?? 0) : "",
    valorFreteManual: isAvulso ? formatCurrencyWithoutPrefix(proposta?.resumo.frete ?? 0) : "",
    observacoesFreteManual: isAvulso ? (chosenFrete?.transportadora ?? "Frete Manual") : "",
    clienteNaoCadastrado,
    nomeClienteLivre: clienteNaoCadastrado ? (cliente?.nome ?? "") : "",
    cepLivre: clienteNaoCadastrado ? (endereco?.cep ?? "") : "",
    cidadeLivre: clienteNaoCadastrado ? (endereco?.cidade ?? "") : "",
    ufLivre: clienteNaoCadastrado ? (endereco?.uf ?? "") : ""
  };
}
