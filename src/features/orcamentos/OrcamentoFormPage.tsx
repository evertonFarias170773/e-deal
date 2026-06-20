"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Copy, Search, Trash2, X, Edit2, AlertTriangle } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { ContactEditModal } from "@/features/orcamentos/components/ContactEditModal";
import { PedidoModelosTab } from "@/features/orcamentos/components/PedidoModelosTab";
import { ProductSearchSelector } from "@/features/orcamentos/components/ProductSearchSelector";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useAuth } from "@/features/auth/AuthProvider";
import type { Cadastro, CadastroContato, CadastroEndereco } from "@/features/cadastros/types";
import { hasPermissao } from "@/features/auth/usuarios.service";
import type {
  Proposta,
  PropostaFormState,
  PropostaItem,
  TipoDescontoProposta,
  PropostaFrete
} from "@/features/orcamentos/types";
import { buildPropostaInformalText } from "@/features/orcamentos/orcamento-utils";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatWeightFromGrams } from "@/lib/formatters/weight";
import { mockCompanies } from "@/lib/mocks/empresas.mock";
import {
  calculateItemSubtotal,
  calculateItemWeight,
  calculateResumo,
  createFretesMock,
  createItemFromProduto,
  getClienteBonusPercent,
  getClienteVendedorPadrao,
  sortEnderecosPorPrioridade
} from "@/features/orcamentos/orcamento-utils";
import { getCadastrosReadOnlyList, getCadastroCompleto } from "@/features/cadastros/services/cadastros.service";
import { listProdutos } from "@/features/produtos/services/produtos.service";
import { listProdutoVariacaoVinculos } from "@/features/produtos/services/produto-variacoes.service";
import { saveProposta, listVendedoresReais, insertEnderecoProposta, updateEnderecoProposta, updatePropostaFiscalDados, type UsuarioVendedor } from "@/features/orcamentos/services/orcamentos.service";
import { useOrcamentoDetail } from "@/features/orcamentos/hooks/useOrcamentoDetail";
import { solicitarCotacaoSedex, solicitarCotacaoAzulCargo, solicitarCotacaoTransportadoras } from "@/features/orcamentos/services/frete.service";
import type { Produto } from "@/features/produtos/types";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { normalizeDocumentDigits } from "@/features/cadastros/utils/documento";

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

export function OrcamentoFormPage({ mode, idInt, proposta }: OrcamentoFormPageProps) {
  const { getCobrancasByProposta } = useCobrancas();
  const targetIdInt = idInt ?? proposta?.id_int;
  const hasCobrancas = targetIdInt ? getCobrancasByProposta(targetIdInt).length > 0 : false;

  if (mode === "edit" && hasCobrancas) {
    return (
      <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-center max-w-lg mx-auto mt-12 space-y-4 shadow-sm">
        <h2 className="text-lg font-bold text-amber-800">Edição Bloqueada</h2>
        <p className="text-sm text-amber-700 leading-relaxed font-semibold">
          Esta proposta possui cobrança gerada. Para alterar, exclua primeiro a cobrança pendente.
        </p>
        <div className="pt-2">
          <Link
            href={targetIdInt ? `/orcamentos/${targetIdInt}` : "/orcamentos"}
            className="inline-flex items-center gap-2 rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
          >
            Voltar para detalhes
          </Link>
        </div>
      </div>
    );
  }

  if (mode === "edit" && !proposta && idInt) {
    return <OrcamentoFormLoader idInt={idInt} />;
  }

  return <OrcamentoFormInner mode={mode} proposta={proposta} />;
}

function OrcamentoFormLoader({ idInt }: { idInt: number }) {
  const { proposta, loading, error } = useOrcamentoDetail(idInt);

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

  return <OrcamentoFormInner mode="edit" proposta={proposta} />;
}

function OrcamentoFormInner({ mode, proposta }: { mode: "new" | "edit"; proposta?: Proposta }) {
  const router = useRouter();
  const { showToast } = useAppToast();
  const { user } = useAuth();

  const canAlterarVendedor = Boolean(
    user?.isSuperAdmin ||
    user?.isAdmin ||
    user?.isGerente ||
    hasPermissao(user, "propostas.alterar_vendedor")
  );

  const canEditarDescontoGeral = Boolean(
    user?.isSuperAdmin ||
    user?.isAdmin ||
    user?.isGerente ||
    hasPermissao(user, "propostas.desconto_geral")
  );

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
  type EditTabType = "geral" | "produtos" | "pedido" | "artes" | "financeiro" | "historico";
  const [activeFormTab, setActiveFormTab] = useState<EditTabType>("geral");

  const [form, setForm] = useState<PropostaFormState>(() => createInitialState(proposta));
  const [proposalContacts, setProposalContacts] = useState<CadastroContato[]>(() => proposta?.cliente.contatos ?? []);
  const [proposalAddresses, setProposalAddresses] = useState<CadastroEndereco[]>(() => {
    if (proposta?.cliente?.enderecos && proposta.cliente.enderecos.length > 0) return proposta.cliente.enderecos;
    return [];
  });
  const [cliente, setCliente] = useState<Cadastro | null>(() => proposta?.cliente ?? null);
  const shouldShowRest = mode !== "new" || cliente !== null || form.clienteNaoCadastrado;

  const [openItemIds, setOpenItemIds] = useState<Record<string, boolean>>({});
  const [clientSearch, setClientSearch] = useState(() => proposta?.cliente ? `${proposta.cliente.idCliente} - ${proposta.cliente.nome}` : "");
  const [showClientResults, setShowClientResults] = useState(false);
  const [clientResults, setClientResults] = useState<Cadastro[]>([]);
  const [isSearchingClients, setIsSearchingClients] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
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
  const [isUnsavedModalOpen, setIsUnsavedModalOpen] = useState(false);
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
      const subtotalProdutos = Number(String(form.valorProdutosManual || "0").replace(",", ".")) || 0;
      const frete = Number(String(form.valorFreteManual || "0").replace(",", ".")) || 0;
      return {
        subtotalProdutos,
        subtotalBrutoProdutos: subtotalProdutos,
        descontosIndividuais: 0,
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
    contatoNome
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
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!snapshotCaptured.current) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { fretes: _f, ...snap } = form;
        initialFormSnapshot.current = JSON.stringify(snap);
        snapshotCaptured.current = true;
      }
    }, 600);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      setIsQuotingSedex(true);
      setIsQuotingAzul(true);

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
        })()
      ]);

      const allResults = [...sedexResults, ...azulResults, ...transpResults];
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

        // Auto-select first option only if there was no previous choice and destination did not change
        if (!currentChosen && !isDestChanged && updatedResults.length > 0) {
          updatedResults[0].escolhido = true;
          nextEscolhidoId = updatedResults[0].id;
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

  function recalculateItem(item: PropostaItem, nextBonusPercent = bonusPercent) {
    const totals = calculateItemSubtotal(item, nextBonusPercent);

    return {
      ...item,
      ...totals,
      pesoTotal: calculateItemWeight(item)
    };
  }

  async function selectCliente(basicCliente: Cadastro) {
    setShowClientResults(false);
    setClientSearch(`${basicCliente.idCliente} - ${basicCliente.nome}`);
    setErrorFields((current) => current.filter((item) => item !== "clienteId"));
    
    try {
      const res = await getCadastroCompleto(basicCliente.idCliente);
      const nextCliente = res.cadastro || basicCliente;
      const nextEndereco = nextCliente.enderecos?.[0];
      const nextContacts = nextCliente.contatos || [];
      const nextBonus = getClienteBonusPercent(nextCliente);
      const recalculatedItems = form.itens.map((item) => recalculateItem(item, nextBonus));

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

  async function addProduct(productId: string) {
    const produto = produtos.find((item) => item.id_produto.toString() === productId.toString());

    if (!produto) {
      return;
    }

    // Validação de duplicidade
    const isDuplicate = form.itens.some((item) => item.id_produto === produto.id_produto);
    if (isDuplicate) {
      showToast({
        type: "warning",
        title: "Produto já adicionado",
        description: `O produto "${produto.nomeReal}" (#${produto.id_produto}) já está no orçamento. Ajuste a quantidade diretamente no item.`
      });
      return;
    }

    const initialQty = produto.quantidade_minima_venda ?? 1000;

    try {
      const vinculos = await listProdutoVariacaoVinculos(produto.id_produto);
      const enrichedProduto = {
        ...produto,
        variacoes: vinculos
      };
      const item = createItemFromProduto(enrichedProduto, initialQty, bonusPercent, false);
      updateField("itens", [...form.itens, item]);
      setOpenItemIds((current) => ({ ...current, [item.id]: true }));
      showToast({ type: "success", title: "Produto adicionado", description: `${produto.nomeReal} incluído no orçamento.` });
    } catch (err) {
      console.error("Erro ao carregar variações do produto:", err);
      const item = createItemFromProduto(produto, initialQty, bonusPercent, false);
      updateField("itens", [...form.itens, item]);
      setOpenItemIds((current) => ({ ...current, [item.id]: true }));
      showToast({ type: "success", title: "Produto adicionado", description: `${produto.nomeReal} incluído no orçamento.` });
    }
  }


  function updateItem(itemId: string, updater: (item: PropostaItem) => PropostaItem) {
    updateField(
      "itens",
      form.itens.map((item) => (item.id === itemId ? recalculateItem(updater(item)) : item))
    );
  }

  function updateItemVariation(itemId: string, id_variacao: number, tipoId: string) {
    updateItem(itemId, (item) => {
      const vinculo = item.produto.variacoes.find((variacao) => variacao.id_variacao === id_variacao);
      const tipo = vinculo?.tipos.find((tipoVariacao) => tipoVariacao.id === tipoId);

      const oldChoice = item.variacoesEscolhidas.find((c) => c.id_variacao === id_variacao);
      const oldExtra = oldChoice?.tipo.v_extra || 0;

      let nextVariacoes = item.variacoesEscolhidas;
      let newExtra = 0;

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
        newExtra = tipo.v_extra;
      }

      const priceDiff = newExtra - oldExtra;
      const nextValorUnitario = Math.max(0, item.valorUnitario + priceDiff);

      return {
        ...item,
        variacoesEscolhidas: nextVariacoes,
        valorUnitario: nextValorUnitario
      };
    });
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

    const updatedItem = recalculateItem(item);
    updateField(
      "itens",
      form.itens.map((it) => (it.id === itemId ? updatedItem : it))
    );

    setOpenItemIds((prev) => ({ ...prev, [itemId]: false }));
  }

  function handleEditItem(itemId: string) {
    setOpenItemIds((prev) => ({ ...prev, [itemId]: true }));
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

    let sedexError = "";
    let azulError = "";
    let transpError = "";

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

    const allResults = [...sedexResults, ...azulResults, ...transpResults];
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

    // Auto-select first option only if there was no previous choice and destination did not change
    if (!currentChosen && !isDestChanged && updatedResults.length > 0) {
      updatedResults[0].escolhido = true;
      nextEscolhidoId = updatedResults[0].id;
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
      const valProd = Number(valProdStr.replace(",", "."));
      if (isNaN(valProd) || valProd <= 0 || !isNonEmpty(valProdStr)) {
        showToast({
          type: "error",
          title: "Valor dos produtos inválido",
          description: "Informe o valor dos produtos antes de salvar a proposta avulsa."
        });
        return false;
      }

      const valManual = Number(String(form.valorFreteManual || "").replace(",", "."));
      if (isNaN(valManual) || valManual < 0 || !isNonEmpty(form.valorFreteManual)) {
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

  async function handleSave() {
    const vendedorParaSalvar = cliente && !canAlterarVendedor ? getClienteVendedorPadrao(cliente) : form.vendedor;

    if (!validateBeforeSave(vendedorParaSalvar)) {
      return;
    }

    const formToSave = vendedorParaSalvar !== form.vendedor
      ? { ...form, vendedor: vendedorParaSalvar }
      : form;

    setIsSaving(true);
    try {
      const res = await saveProposta(formToSave);
      if (res.success) {
        // Reset snapshot so isDirty becomes false after save
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { fretes: _f, ...savedSnap } = formToSave;
        initialFormSnapshot.current = JSON.stringify(savedSnap);

        showToast({
          type: "success",
          title: mode === "edit" ? "Orçamento atualizado com sucesso." : "Orçamento criado com sucesso.",
          description: mode === "edit" ? "Redirecionando para o detalhe..." : "Redirecionando para a lista de orçamentos..."
        });

        const finalIdInt = res.id_int || formToSave.id_int;
        window.setTimeout(() => {
          router.push(`/orcamentos/${finalIdInt}`);
        }, 1200);
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

  const hasPreservedFreight = form.fretes.some(
    (f) => f.id === form.freteEscolhidoId && f.observacao && (f.observacao.includes("(Preservado)") || f.observacao.includes("Frete preservado"))
  );

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
            <button type="button" onClick={handleSave} disabled={isSaving || isQuotingSedex || isQuotingAzul || isQuotingTransp} className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61] disabled:opacity-60">
              {isSaving ? "Salvando..." : mode === "edit" ? "Salvar alterações" : "Salvar proposta"}
            </button>
          </div>
        }
      />

      {mode === "edit" && form.id_int !== "NOVO" && (
        <div className="flex rounded-2xl bg-slate-100 p-1 border border-slate-200 overflow-x-auto justify-start mb-6 w-full gap-2 lg:gap-4 hide-scrollbar">
          {[
            { id: "geral", label: "Geral" },
            { id: "produtos", label: "Produtos" },
            { id: "financeiro", label: "Financeiro" },
            { id: "artes", label: "Artes" },
            { id: "pedido", label: "Pedido" },
            { id: "historico", label: "Histórico" }
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveFormTab(tab.id as EditTabType)}
              className={`flex-none rounded-xl px-4 py-2 text-sm font-semibold transition whitespace-nowrap ${
                activeFormTab === tab.id
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <section className={shouldShowRest ? "grid gap-6 xl:grid-cols-[1fr_380px]" : "max-w-3xl mx-auto"}>
        <div className="space-y-6">
          {activeFormTab === "pedido" && shouldShowRest && (
            <PedidoModelosTab idInt={Number(form.id_int)} />
          )}
          {activeFormTab === "artes" && shouldShowRest && (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
              <p className="text-sm font-semibold text-slate-600">Artes</p>
              <p className="mt-1 text-xs text-slate-400">Em desenvolvimento</p>
            </div>
          )}
          {activeFormTab === "historico" && shouldShowRest && (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
              <p className="text-sm font-semibold text-slate-600">Histórico operacional</p>
              <p className="mt-1 text-xs text-slate-400">Em desenvolvimento</p>
            </div>
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
              <div className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Tipo de orçamento: {form.clienteNaoCadastrado ? "Cliente não cadastrado / Orçamento rápido" : "Cliente cadastrado"}
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
                      onClick={() => {
                        setCliente(null);
                        setClientSearch("");
                        setProposalContacts([]);
                        setProposalAddresses([]);
                        updateField("clienteId", "");
                        updateField("contatoId", "");
                        updateField("enderecoId", "");
                        updateField("compradorId", "");
                      }}
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
                <InfoBox label="Crédito / risco" value={`${formatCurrency(cliente.creditoDisponivel)} - risco ${cliente.riscoCredito}`} />
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
                      <StatusBadge status={form.status} tone={form.status === "NOVO" ? "info" : form.status === "APROVADO" ? "success" : form.status === "AGUARDANDO" ? "warning" : "neutral"} />
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
                        onEdit={(contato) => openEditContact(contato)}
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
                          const recebedor = endereco.recebedor ? `Responsável: ${endereco.recebedor}` : "Responsável: não informado";
                          const tipoExibido = endereco.tipo ? endereco.tipo : "Tipo não informado";
                          const donoText = isSocioAddr ? "Endereço do pagador selecionado" : "Endereço do comprador";
                          return {
                            title: `${endereco.endereco}, ${endereco.numero}`,
                            subtitle: `${endereco.cidade}/${endereco.uf} - CEP ${endereco.cep}`,
                            detail: (
                              <div className="flex flex-col gap-0.5 mt-0.5">
                                <span>{tipoExibido} ({donoText})</span>
                                <span className="font-medium text-slate-600">{recebedor}</span>
                              </div>
                            )
                          };
                        }}
                        extraClassNameForItem={(endereco) => {
                          const isCompradorAddress = (endereco as any)._isSocioAddr === true;
                          const isSelected = form.enderecoId === endereco.id;
                          if (isSelected) {
                            if (isCompradorAddress) {
                              return "!bg-[#284267] !border-[#284267] !text-[#a8c8f6]";
                            }
                            return ""; // uses default green configured in SelectorGrid
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
                <div className="space-y-6">
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
                    if (!form.valorProdutosManual) updateField("valorProdutosManual", "0");
                    if (!form.valorFreteManual) updateField("valorFreteManual", "0");
                    updateField("freteEscolhidoId", "frete_manual_unico");
                    updateField("fretes", [{
                      id: "frete_manual_unico",
                      id_int: Number(form.id_int) || 0,
                      transportadora: form.observacoesFreteManual || "Frete Manual",
                      servico: "",
                      valor: Number(String(form.valorFreteManual || "0").replace(",", ".")) || 0,
                      prazo: "A combinar",
                      observacao: "Cadastro manual",
                      escolhido: true,
                      pesoUsado: 0
                    }]);
                  } else {
                    updateField("freteEscolhidoId", "");
                    updateField("fretes", []);
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
                  showToast={showToast}
                  itensAtuais={form.itens}
                />


                {/* Lista de itens da proposta */}
                <div className="space-y-4">
                  {form.itens.map((item) => {
                    const isOpen = openItemIds[item.id] ?? false;
                    if (isOpen) {
                      return (
                        <ProductItemEditor
                          key={item.id}
                          item={item}
                          bonusPercent={bonusPercent}
                          hasVariationError={errorFields.includes(`variacoes_${item.id}`)}
                          onUpdate={(updater) => updateItem(item.id, updater)}
                          onVariationChange={(idVariacao, tipoId) => updateItemVariation(item.id, idVariacao, tipoId)}
                          onRemove={() => updateField("itens", form.itens.filter((current) => current.id !== item.id))}
                          onSave={() => handleSaveItem(item.id)}
                        />
                      );
                    } else {
                      return (
                        <ProductItemSummary
                          key={item.id}
                          item={item}
                          onEdit={() => handleEditItem(item.id)}
                          onRemove={() => updateField("itens", form.itens.filter((current) => current.id !== item.id))}
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
                        const valNum = Number(valStr.replace(",", ".")) || 0;
                        updateField("fretes", form.fretes.map(f => f.id === "frete_manual_unico" ? { ...f, valor: valNum } : f));
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
                        {isQuotingSedex || isQuotingAzul || isQuotingTransp ? (
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
                </div>
              )}

              {activeFormTab === "financeiro" && (
                <div className="space-y-6">
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
                    <p className="text-sm font-semibold text-slate-600">Condições comerciais futuras</p>
                    <p className="mt-1 text-xs text-slate-400">Em desenvolvimento</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {shouldShowRest && (
          <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">
            <FormSection title="8. Resumo da proposta" description="Resumo consolidado incluindo pesos e valores extras das variações.">
              <ResumoValores resumo={resumo} bonusPercent={bonusPercent} />
              <div className="mt-4">
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
              </div>
            </FormSection>

            <FormSection title="9. Envio da proposta" description="Texto informal para envio via WhatsApp.">
              <textarea readOnly value={informalText} className="min-h-72 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 outline-none" />
              <button type="button" onClick={copyInformal} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0b2f4a] px-4 py-3 text-sm font-semibold text-white">
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
              <button type="button" onClick={handleSave} disabled={isSaving || isQuotingSedex || isQuotingAzul || isQuotingTransp} className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">{isSaving ? "Salvando..." : mode === "edit" ? "Salvar alterações" : "Salvar proposta"}</button>
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
      {isUnsavedModalOpen && (
        <UnsavedChangesModal
          isSaving={isSaving}
          onContinueEditing={() => {
            setIsUnsavedModalOpen(false);
            setPendingNavigation(null);
          }}
          onExitWithoutSaving={() => {
            const dest = pendingNavigation || "/orcamentos";
            // Reset snapshot so guard doesn't re-trigger
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { fretes: _f, ...curr } = form;
            initialFormSnapshot.current = JSON.stringify(curr);
            setIsUnsavedModalOpen(false);
            setPendingNavigation(null);
            router.push(dest);
          }}
          onSaveAndExit={() => {
            setIsUnsavedModalOpen(false);
            void handleSave();
          }}
        />
      )}
    </div>
  );
}

function ProductItemSummary({
  item,
  onEdit,
  onRemove
}: {
  item: PropostaItem;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const selectedVariationsText = item.variacoesEscolhidas.length > 0
    ? item.variacoesEscolhidas.map(v => `${v.variacao.nome}: ${v.tipo.variacao}`).join(", ")
    : "Padrão (Sem variação)";

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-200">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-400">#{item.id_produto}</span>
            <h4 className="text-base font-bold text-slate-900">{item.nome}</h4>
          </div>
          {item.descricaoModelo && (
            <p className="text-sm text-slate-500 line-clamp-1 italic">{item.descricaoModelo}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>Qtd: <strong className="text-slate-700">{item.quantidade.toLocaleString("pt-BR")}</strong></span>
            <span>Peso: <strong className="text-slate-700">{formatWeightFromGrams(item.pesoTotal)}</strong></span>
            <span>Variações: <strong className="text-slate-700">{selectedVariationsText}</strong></span>
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
            <button
              type="button"
              onClick={onRemove}
              className="rounded-2xl border border-red-100 bg-white p-2 text-red-600 hover:bg-red-50 hover:border-red-200 transition-all"
              title="Remover item"
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
  onSave
}: {
  item: PropostaItem;
  bonusPercent: number;
  hasVariationError: boolean;
  onUpdate: (updater: (item: PropostaItem) => PropostaItem) => void;
  onVariationChange: (idVariacao: number, tipoId: string) => void;
  onRemove: () => void;
  onSave: () => void;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-inner space-y-4">
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

      <div className="grid gap-4 lg:grid-cols-[minmax(240px,_360px)_1fr] items-start">
        <Field label="Descrição/modelo do item">
          <textarea
            value={item.descricaoModelo}
            onChange={(event) => onUpdate((current) => ({ ...current, descricaoModelo: event.target.value }))}
            className={`${inputClass} min-h-[44px] py-2.5 resize-y`}
            placeholder="Descreva detalhes adicionais sobre o produto se necessário..."
          />
        </Field>
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-4 items-start">
          <Field label="Quantidade">
            <input
              type="number"
              value={item.quantidade || ""}
              onChange={(event) => onUpdate((current) => ({ ...current, quantidade: Math.max(0, Number(event.target.value)) }))}
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
            />
          </Field>
          <Field label="Fixo (R$)">
            <input
              type="number"
              step="0.01"
              value={item.valorFixo || ""}
              onChange={(event) => onUpdate((current) => ({ ...current, valorFixo: Math.max(0, Number(event.target.value)) }))}
              className={inputClass}
              placeholder="0,00"
            />
          </Field>
          <InfoBox label="Subtotal final" value={formatCurrency(item.subtotal)} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4 pt-1">
        <InfoBox label="Antes desconto" value={formatCurrency(item.subtotalBruto)} />
        <Field label="Tipo desconto">
          <select
            value={item.descontoTipo}
            onChange={(event) => onUpdate((current) => ({ ...current, descontoTipo: event.target.value as TipoDescontoProposta }))}
            className={inputClass}
          >
            <option value="PERCENTUAL">%</option>
            <option value="VALOR">R$</option>
          </select>
        </Field>
        <Field label="Desconto item">
          <input
            type="number"
            value={item.descontoValor || ""}
            onChange={(event) => onUpdate((current) => ({ ...current, descontoValor: Number(event.target.value) || 0 }))}
            className={inputClass}
            placeholder="0"
          />
        </Field>
        <InfoBox label="Desconto aplicado" value={`-${formatCurrency(item.descontoValorCalculado)}`} />
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
          className="rounded-2xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 hover:border-red-300 transition-all flex items-center gap-2"
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

function SelectorGrid<T extends { id: string }>({
  items,
  selectedId,
  onSelect,
  render,
  onEdit,
  onCopy,
  extraClassNameForItem,
  badgeForItem
}: {
  items: T[];
  selectedId: string;
  onSelect: (id: string) => void;
  render: (item: T) => { title: string; subtitle: string; detail: React.ReactNode };
  onEdit?: (item: T, event: React.MouseEvent) => void;
  onCopy?: (item: T, event: React.MouseEvent) => void;
  extraClassNameForItem?: (item: T) => string;
  badgeForItem?: (item: T) => React.ReactNode;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((item) => {
        const content = render(item);
        const isSelected = selectedId === item.id;
        const extraClass = extraClassNameForItem ? extraClassNameForItem(item) : "";
        const badge = badgeForItem ? badgeForItem(item) : null;
        return (
          <div
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={`relative rounded-3xl border p-4 text-left transition flex justify-between items-start cursor-pointer ${
              isSelected
                ? "border-[#24665d] bg-[#24665d] text-[#86e2d5]"
                : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white"
            } ${extraClass}`}
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
                    onCopy(item, e);
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
                    onEdit(item, e);
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
      })}
    </div>
  );
}

function ResumoValores({ resumo, bonusPercent }: { resumo: ReturnType<typeof calculateResumo>; bonusPercent: number }) {
  const rows = [
    ["Subtotal bruto", formatCurrency(resumo.subtotalBrutoProdutos)],
    ["Descontos individuais", `-${formatCurrency(resumo.descontosIndividuais)}`],
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

function FormSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
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

function UnsavedChangesModal({
  onSaveAndExit,
  onExitWithoutSaving,
  onContinueEditing,
  isSaving
}: {
  onSaveAndExit: () => void;
  onExitWithoutSaving: () => void;
  onContinueEditing: () => void;
  isSaving: boolean;
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
            Existem alterações não salvas
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Você fez alterações nesta proposta. Deseja salvar antes de sair?
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
          <button
            type="button"
            onClick={onExitWithoutSaving}
            className="rounded-2xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50"
          >
            Sair sem salvar
          </button>
          <button
            type="button"
            onClick={onSaveAndExit}
            disabled={isSaving}
            className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#123f61] disabled:opacity-60"
          >
            {isSaving ? "Salvando..." : "Salvar e sair"}
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
    enderecoId: clienteNaoCadastrado ? "" : (endereco?.id ?? ""),
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
    itens: proposta?.itens ?? [],
    fretes,
    freteEscolhidoId: isAvulso ? "frete_manual_unico" : (proposta?.freteEscolhidoId ?? fretes.find((frete) => frete.escolhido)?.id ?? fretes[0]?.id ?? ""),
    descontoGeralTipo: proposta?.descontoGeralTipo ?? "VALOR",
    descontoGeralValor: proposta?.descontoGeralValor ? proposta.descontoGeralValor.toString() : "0",
    formaPagamento: proposta?.formaPagamento ?? "Pix a vista 3 dias",
    observacoes: proposta?.observacoes ?? "",
    isAvulso,
    valorProdutosManual: isAvulso ? (proposta?.resumo.subtotalProdutos ?? 0).toString() : "",
    valorFreteManual: isAvulso ? (proposta?.resumo.frete ?? 0).toString() : "",
    observacoesFreteManual: isAvulso ? (chosenFrete?.transportadora ?? "Frete Manual") : "",
    clienteNaoCadastrado,
    nomeClienteLivre: clienteNaoCadastrado ? (cliente?.nome ?? "") : "",
    cepLivre: clienteNaoCadastrado ? (endereco?.cep ?? "") : "",
    cidadeLivre: clienteNaoCadastrado ? (endereco?.cidade ?? "") : "",
    ufLivre: clienteNaoCadastrado ? (endereco?.uf ?? "") : ""
  };
}
