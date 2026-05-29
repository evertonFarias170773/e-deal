"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Copy, Package, Plus, Search, Trash2, X } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useAuth } from "@/features/auth/AuthProvider";
import type { Cadastro, CadastroContato, CadastroEndereco } from "@/features/cadastros/types";
import type {
  Proposta,
  PropostaFormState,
  PropostaItem,
  PropostaVariacaoEscolhida,
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
  vendedoresPropostaMock
} from "@/lib/mocks/propostas.mock";
import { getCadastrosReadOnlyList, getCadastroCompleto } from "@/features/cadastros/services/cadastros.service";
import { listProdutos } from "@/features/produtos/services/produtos.service";
import { listProdutoVariacaoVinculos } from "@/features/produtos/services/produto-variacoes.service";
import { saveProposta } from "@/features/orcamentos/services/orcamentos.service";
import { useOrcamentoDetail } from "@/features/orcamentos/hooks/useOrcamentoDetail";
import { solicitarCotacaoSedex, solicitarCotacaoAzulCargo, solicitarCotacaoTransportadoras } from "@/features/orcamentos/services/frete.service";
import type { Produto } from "@/features/produtos/types";

type OrcamentoFormPageProps = {
  mode: "new" | "edit";
  idInt?: number;
  proposta?: Proposta;
};

type ContactDraft = Pick<CadastroContato, "nome" | "cargo" | "whatsapp" | "email">;
type AddressDraft = Omit<CadastroEndereco, "id">;

const inputClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]";

const productTags = [
  { label: "TRIBAND" },
  { label: "BRACELETE" },
  { label: "TEX BAND" },
  { label: "VANGOGH" },
  { label: "UP" },
  { label: "MOBI" },
  { label: "CORDÃO" },
  { label: "PVC" }
];

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getFreightKey(
  cep: string | undefined,
  cidade: string | undefined,
  uf: string | undefined,
  pesoTotalGramas: number,
  volumes: number
): string {
  const cleanCep = cep ? cep.replace(/\D/g, "") : "";
  const cleanCidade = cidade ? normalize(cidade) : "";
  const cleanUf = uf ? uf.toLowerCase().trim() : "";
  const weight = Math.round(pesoTotalGramas);
  return `${cleanCep}_${cleanCidade}_${cleanUf}_${weight}_${volumes}`;
}

export function OrcamentoFormPage({ mode, idInt, proposta }: OrcamentoFormPageProps) {
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
  const canManageCommercialRules = Boolean(user?.isAdmin || user?.isGerente || user?.isSuperAdmin);

  // Catalog state from Supabase
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loadingProdutos, setLoadingProdutos] = useState(true);

  const [form, setForm] = useState<PropostaFormState>(() => createInitialState(proposta));
  const [proposalContacts, setProposalContacts] = useState<CadastroContato[]>(() => proposta?.cliente.contatos ?? []);
  const [proposalAddresses, setProposalAddresses] = useState<CadastroEndereco[]>(() => proposta?.cliente.enderecos ?? []);
  const [cliente, setCliente] = useState<Cadastro | null>(() => proposta?.cliente ?? null);

  const [selectedProductId, setSelectedProductId] = useState("");
  const [openItemIds, setOpenItemIds] = useState<Record<string, boolean>>({});

  const selectedProduct = useMemo(() => {
    return produtos.find((p) => p.id_produto.toString() === selectedProductId);
  }, [produtos, selectedProductId]);
  const [clientSearch, setClientSearch] = useState(() => proposta?.cliente ? `${proposta.cliente.idCliente} - ${proposta.cliente.nome}` : "");
  const [showClientResults, setShowClientResults] = useState(false);
  const [clientResults, setClientResults] = useState<Cadastro[]>([]);
  const [isSearchingClients, setIsSearchingClients] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorFields, setErrorFields] = useState<string[]>([]);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [contactDraft, setContactDraft] = useState<ContactDraft>({ nome: "", cargo: "", whatsapp: "", email: "" });
  const [addressDraft, setAddressDraft] = useState<AddressDraft>({
    tipo: "entrega",
    cep: "",
    endereco: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: ""
  });

  const [isQuotingSedex, setIsQuotingSedex] = useState(false);
  const [isQuotingAzul, setIsQuotingAzul] = useState(false);
  const [isQuotingTransp, setIsQuotingTransp] = useState(false);
  const [volumes, setVolumes] = useState(1);
  const [compradorAddresses, setCompradorAddresses] = useState<CadastroEndereco[]>([]);
  const [lastQuotedKey, setLastQuotedKey] = useState<string>(() => proposta ? getFreightKey(proposta.enderecoEntrega?.cep, proposta.enderecoEntrega?.cidade, proposta.enderecoEntrega?.uf, proposta.resumo.pesoTotal, 1) : "");
  const [isManualFreteModalOpen, setIsManualFreteModalOpen] = useState(false);
  const [manualFreteDraft, setManualFreteDraft] = useState({
    servico: "",
    prazo: "",
    valor: "",
    escolhido: true
  });

  const vendedorExibido = canManageCommercialRules
    ? form.vendedor
    : cliente
      ? getClienteVendedorPadrao(cliente)
      : form.vendedor;

  const freteEscolhido = form.fretes.find((frete) => frete.id === form.freteEscolhidoId);
  const bonusPercent = cliente ? getClienteBonusPercent(cliente) : 0;
  const resumo = calculateResumo(form.itens, form.fretes, Number(form.descontoGeralValor) || 0, form.descontoGeralTipo);
  const combinedAddresses = useMemo(() => {
    const seenIds = new Set<string>();
    const list: CadastroEndereco[] = [];

    proposalAddresses.forEach((addr) => {
      if (!seenIds.has(addr.id)) {
        seenIds.add(addr.id);
        list.push(addr);
      }
    });

    compradorAddresses.forEach((addr) => {
      if (!seenIds.has(addr.id)) {
        seenIds.add(addr.id);
        list.push({
          ...addr,
          tipo: "comprador" as unknown as CadastroEndereco["tipo"]
        });
      }
    });

    return list;
  }, [proposalAddresses, compradorAddresses]);

  const currentAddress = useMemo(() => {
    return combinedAddresses.find((a) => a.id === form.enderecoId);
  }, [combinedAddresses, form.enderecoId]);

  const isFreightOutdated = useMemo(() => {
    const key = getFreightKey(currentAddress?.cep, currentAddress?.cidade, currentAddress?.uf, resumo.pesoTotal, volumes);
    return lastQuotedKey !== key;
  }, [currentAddress, resumo.pesoTotal, volumes, lastQuotedKey]);

  const informalText = buildPropostaInformalText({
    id_int: form.id_int || "NOVO",
    clienteNome: cliente?.nome ?? "Cliente não definido",
    itens: form.itens,
    frete: freteEscolhido,
    resumo,
    formaPagamento: form.formaPagamento
  });

  // Fetch products catalog
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await listProdutos({ pageSize: 1000, ativo: true });
        if (active) {
          setProdutos(list);
          if (list.length > 0 && !selectedProductId) {
            setSelectedProductId(list[0].id_produto.toString());
          }
        }
      } catch (err) {
        console.error("Erro ao carregar catálogo de produtos:", err);
      } finally {
        if (active) setLoadingProdutos(false);
      }
    })();
    return () => { active = false; };
  }, [selectedProductId]);

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
    void (async () => {
      try {
        const { cadastro } = await getCadastroCompleto(vinculo.idClienteRelacionado);
        if (active && cadastro) {
          setTimeout(() => setCompradorAddresses(cadastro.enderecos || []), 0);
        }
      } catch (err) {
        console.error("Erro ao carregar endereços do comprador/autorizado:", err);
        if (active) setTimeout(() => setCompradorAddresses([]), 0);
      }
    })();
    return () => {
      active = false;
    };
  }, [form.compradorId, cliente]);

  // Adjust selected address if no longer in combinedAddresses
  useEffect(() => {
    if (combinedAddresses.length > 0) {
      const exists = combinedAddresses.some((addr) => addr.id === form.enderecoId);
      if (!exists) {
        const defaultAddr = combinedAddresses.find((e) => e.tipo === "entrega" || e.tipo === "principal") || combinedAddresses[0];
        updateField("enderecoId", defaultAddr ? defaultAddr.id : "");
      }
    } else {
      updateField("enderecoId", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedAddresses, form.enderecoId]);

  // Debounced auto-quote when address, weight, or volumes change
  useEffect(() => {
    const cep = currentAddress?.cep;
    const cidade = currentAddress?.cidade;
    const uf = currentAddress?.uf;
    if (!cep || resumo.pesoTotal <= 0 || volumes <= 0) {
      return;
    }

    const currentKey = getFreightKey(cep, cidade, uf, resumo.pesoTotal, volumes);
    if (currentKey === lastQuotedKey) {
      return;
    }

    // se CEP, peso ou volumes mudarem, limpar frete escolhido atual imediatamente
    let wasChanged = false;
    if (lastQuotedKey) {
      wasChanged = true;
      setTimeout(() => {
        setForm((prev) => ({
          ...prev,
          freteEscolhidoId: "",
          fretes: prev.fretes.map((f) => ({ ...f, escolhido: false }))
        }));
      }, 0);
    }

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

      setForm((prev) => {
        // Keep manual fretes
        const manualFretes = prev.fretes.filter(
          (f) => f.id.startsWith("manual_") || f.observacao === "Cadastro manual"
        );

        const currentChosen = prev.fretes.find((f) => f.id === prev.freteEscolhidoId);
        let nextEscolhidoId = prev.freteEscolhidoId;

        const updatedResults = allResults.map((newFrete) => {
          if (
            !wasChanged &&
            currentChosen &&
            !currentChosen.id.startsWith("manual_") &&
            currentChosen.transportadora === newFrete.transportadora &&
            currentChosen.servico === newFrete.servico
          ) {
            nextEscolhidoId = newFrete.id;
            return { ...newFrete, escolhido: true };
          }
          return newFrete;
        });

        if (!wasChanged && currentChosen && currentChosen.id.startsWith("manual_")) {
          nextEscolhidoId = currentChosen.id;
        }

        // If changed, we do NOT auto-select anything.
        // If not changed and nothing was chosen, we auto-select the first one.
        if (!wasChanged && !nextEscolhidoId && updatedResults.length > 0) {
          updatedResults[0].escolhido = true;
          nextEscolhidoId = updatedResults[0].id;
        }

        const merged = [...updatedResults, ...manualFretes];
        return {
          ...prev,
          fretes: merged,
          freteEscolhidoId: nextEscolhidoId
        };
      });

      setLastQuotedKey(currentKey);
    }, 600);

    return () => clearTimeout(timer);
  }, [currentAddress, resumo.pesoTotal, volumes, lastQuotedKey, resumo.subtotalProdutos]);



  function updateField<K extends keyof PropostaFormState>(field: K, value: PropostaFormState[K]) {
    if (field === "vendedor" && !canManageCommercialRules) {
      return;
    }

    setForm((current) => ({ ...current, [field]: value }));
    setErrorFields((current) => current.filter((item) => item !== field));
  }

  function handleSelectComprador(id: string) {
    const nextId = form.compradorId === id ? "" : id;
    updateField("compradorId", nextId);
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
      const fallbackEmpresa = nextCliente.empresaPadrao && nextCliente.empresaPadrao !== "Não informado"
        ? nextCliente.empresaPadrao
        : "Ideal Grafica";

      setForm((current) => ({
        ...current,
        clienteId: nextCliente.idCliente.toString(),
        contatoId: nextContacts[0]?.id ?? "",
        enderecoId: nextEndereco?.id ?? "",
        compradorId: "",
        vendedor: defaultVendedor && defaultVendedor !== "Não informado" ? defaultVendedor : current.vendedor,
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
      setForm((current) => ({
        ...current,
        clienteId: basicCliente.idCliente.toString(),
        contatoId: "",
        enderecoId: "",
        compradorId: "",
        vendedor: getClienteVendedorPadrao(basicCliente) || current.vendedor,
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

  function addAddress() {
    if (!addressDraft.cep || !addressDraft.endereco || !addressDraft.numero || !addressDraft.cidade || !addressDraft.uf) {
      showToast({ type: "warning", title: "Endereço incompleto", description: "Preencha CEP, logradouro, número, cidade e UF." });
      return;
    }

    const address: CadastroEndereco = { id: `end_prop_${Date.now()}`, ...addressDraft };
    setProposalAddresses((current) => [...current, address]);
    updateField("enderecoId", address.id);
    setAddressDraft({ tipo: "entrega", cep: "", endereco: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "" });
    setIsAddressModalOpen(false);
    showToast({ type: "success", title: "Endereço adicionado à proposta." });
  }

  async function addProduct(productId = selectedProductId) {
    const produto = produtos.find((item) => item.id_produto.toString() === productId.toString());

    if (!produto) {
      return;
    }

    try {
      const vinculos = await listProdutoVariacaoVinculos(produto.id_produto);
      const enrichedProduto = {
        ...produto,
        variacoes: vinculos
      };
      const item = createItemFromProduto(enrichedProduto, 1000, bonusPercent, false);
      updateField("itens", [...form.itens, item]);
      setOpenItemIds((current) => ({ ...current, [item.id]: true }));
      showToast({ type: "success", title: "Produto adicionado", description: `${produto.nomeReal} incluído no orçamento.` });
    } catch (err) {
      console.error("Erro ao carregar variações do produto:", err);
      const item = createItemFromProduto(produto, 1000, bonusPercent, false);
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

      if (!vinculo || !tipo) {
        return {
          ...item,
          variacoesEscolhidas: item.variacoesEscolhidas.filter((choice) => choice.id_variacao !== id_variacao)
        };
      }

      const nextChoice: PropostaVariacaoEscolhida = {
        id: `choice_${item.id}_${id_variacao}`,
        id_variacao,
        variacao: vinculo.variacao,
        tipo
      };
      const variacoesEscolhidas = [
        ...item.variacoesEscolhidas.filter((choice) => choice.id_variacao !== id_variacao),
        nextChoice
      ];

      return { ...item, variacoesEscolhidas };
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
    const selectedAddress = combinedAddresses.find((e) => e.id === form.enderecoId);
    const cep = selectedAddress?.cep;
    const cidade = selectedAddress?.cidade;
    const uf = selectedAddress?.uf;

    if (!cep) {
      showToast({
        type: "error",
        title: "CEP não encontrado",
        description: "Selecione um endereço de entrega válido com CEP para cotar."
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

    // Keep manual fretes
    const manualFretes = form.fretes.filter(
      (f) => f.id.startsWith("manual_") || f.observacao === "Cadastro manual"
    );

    // Find currently selected frete
    const currentChosen = isFreightOutdated ? undefined : form.fretes.find((f) => f.id === form.freteEscolhidoId);
    let nextEscolhidoId = "";

    const allResults = [...sedexResults, ...azulResults, ...transpResults];

    const updatedResults = allResults.map((newFrete) => {
      if (
        currentChosen &&
        !currentChosen.id.startsWith("manual_") &&
        currentChosen.transportadora === newFrete.transportadora &&
        currentChosen.servico === newFrete.servico
      ) {
        nextEscolhidoId = newFrete.id;
        return { ...newFrete, escolhido: true };
      }
      return newFrete;
    });

    if (currentChosen && currentChosen.id.startsWith("manual_")) {
      nextEscolhidoId = currentChosen.id;
    }

    if (!isFreightOutdated && !nextEscolhidoId && updatedResults.length > 0) {
      updatedResults[0].escolhido = true;
      nextEscolhidoId = updatedResults[0].id;
    }

    const merged = [...updatedResults, ...manualFretes];
    setForm((prev) => ({
      ...prev,
      fretes: merged,
      freteEscolhidoId: nextEscolhidoId || prev.freteEscolhidoId
    }));

    const currentKey = getFreightKey(cep, cidade, uf, resumo.pesoTotal, volumes);
    setLastQuotedKey(currentKey);

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
    const missingRequiredVariation = form.itens.some((item) =>
      item.produto.variacoes.some(
        (variacao) => variacao.is_obrigatorio && !item.variacoesEscolhidas.some((choice) => choice.id_variacao === variacao.id_variacao)
      )
    );
    const hasInvalidQuantity = form.itens.some((item) => item.quantidade <= 0);
    const hasInvalidSubtotal = form.itens.some((item) => item.subtotal <= 0);
    const isSubtotalZero = resumo.subtotalProdutos <= 0;
    const isTotalZero = resumo.valorTotal <= 0;
    const isTextEmpty = !informalText || informalText.trim() === "";
    const isSellerEmpty = !vendedorAtual || vendedorAtual.trim() === "";
    const isCompanyEmpty = !form.empresa || form.empresa.trim() === "";

    const hasUnauthorizedGeneralDiscount = !canManageCommercialRules && Number(form.descontoGeralValor) > 0;
    const sellerChangedWithoutPermission = Boolean(cliente && vendedorAtual !== getClienteVendedorPadrao(cliente) && !canManageCommercialRules);

    const fields = [
      !form.clienteId ? "clienteId" : null,
      !form.enderecoId ? "enderecoId" : null,
      form.itens.length === 0 ? "itens" : null,
      hasInvalidQuantity ? "quantidade" : null,
      hasInvalidSubtotal ? "subtotal_itens" : null,
      isSubtotalZero ? "subtotal" : null,
      isTotalZero ? "total" : null,
      isTextEmpty ? "texto" : null,
      isSellerEmpty ? "vendedor" : null,
      isCompanyEmpty ? "empresa" : null,
      missingRequiredVariation ? "variacoes" : null
    ].filter(Boolean) as string[];

    if (fields.length) {
      setErrorFields(fields);
      let desc = "Revise cliente, endereço, produtos, quantidades e variações obrigatórias.";
      if (isSubtotalZero || isTotalZero) {
        desc = "O valor total e o subtotal dos produtos devem ser maiores que R$ 0,00.";
      } else if (isTextEmpty) {
        desc = "O resumo da proposta não pode ser vazio.";
      } else if (isSellerEmpty) {
        desc = "O vendedor é obrigatório.";
      } else if (isCompanyEmpty) {
        desc = "A empresa é obrigatória.";
      } else if (hasInvalidSubtotal) {
        desc = "O subtotal de cada produto deve ser maior que R$ 0,00.";
      }
      showToast({
        type: "error",
        title: missingRequiredVariation ? "Selecione as variações obrigatórias antes de salvar a proposta." : "Não foi possível salvar",
        description: desc
      });
      return false;
    }

    const hasWeightAndCep = resumo.pesoTotal > 0 && currentAddress?.cep;
    if (hasWeightAndCep) {
      if (isFreightOutdated) {
        showToast({
          type: "error",
          title: "Frete desatualizado",
          description: "Os dados de entrega, peso ou volumes mudaram. Atualize o frete antes de salvar as alterações."
        });
        return false;
      }
      if (!form.freteEscolhidoId) {
        showToast({
          type: "error",
          title: "Frete não selecionado",
          description: "Selecione uma das opções de frete disponíveis antes de salvar."
        });
        return false;
      }
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
    const vendedorParaSalvar = cliente && !canManageCommercialRules ? getClienteVendedorPadrao(cliente) : form.vendedor;

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

  return (
    <div className="space-y-6">
      <PageHeader
        title={mode === "new" ? "Nova proposta" : `Editar proposta #${proposta?.id_int}`}
        subtitle="Integração real Supabase (clientes, catálogo de produtos, variações dinâmicas e snapshots históricos)."
        context="Orçamentos / Propostas"
        action={
          <div className="flex flex-wrap gap-2">
            <Link href={mode === "edit" && proposta ? `/orcamentos/${proposta.id_int}` : "/orcamentos"} className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
              {mode === "edit" ? "Voltar ao detalhe" : "Voltar para lista"}
            </Link>
            <button type="button" onClick={handleSave} disabled={isSaving} className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61] disabled:opacity-60">
              {isSaving ? "Salvando..." : mode === "edit" ? "Salvar alterações" : "Salvar proposta"}
            </button>
          </div>
        }
      />

      <section className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <FormSection title="1. Cliente" description="Busque por ID, nome, apelido/fantasia ou documento do cliente (busca direta no banco de dados).">
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
            {cliente ? (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <InfoBox label="Cliente" value={`${cliente.nome} (#${cliente.idCliente})`} />
                <InfoBox label="Crédito / risco" value={`${formatCurrency(cliente.creditoDisponivel)} - risco ${cliente.riscoCredito}`} />
                <InfoBox label="Tabela especial" value={bonusPercent > 0 ? `+${bonusPercent}% aplicado nos produtos` : "Sem acréscimo especial"} />
              </div>
            ) : null}
          </FormSection>

          <FormSection title="2. Dados da proposta" description="Vendedor vem do cliente e status é definido pelo sistema.">
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
                {canManageCommercialRules ? (
                  <select value={form.vendedor} onChange={(event) => updateField("vendedor", event.target.value)} className={inputClass}>
                    {vendedoresPropostaMock.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : (
                  <input value={vendedorExibido} readOnly className={`${inputClass} cursor-not-allowed bg-slate-100 text-slate-500`} />
                )}
                <p className={`text-xs ${canManageCommercialRules ? "text-amber-700" : "text-slate-500"}`}>
                  {canManageCommercialRules
                    ? "Alteração permitida apenas para gerente/admin."
                    : "Vendedor definido pelo cadastro do cliente."}
                </p>
              </Field>
              <Field label="Status">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <StatusBadge status={form.status} tone={form.status === "NOVO" ? "info" : form.status === "APROVADO" ? "success" : form.status === "AGUARDANDO" ? "warning" : "neutral"} />
                </div>
              </Field>
            </div>
          </FormSection>

          <FormSection title="3. Contato responsável" description="Contato usado para envio da proposta informal e retorno comercial.">
            {proposalContacts.length > 0 ? (
              <SelectorGrid items={proposalContacts} selectedId={form.contatoId} onSelect={(id) => updateField("contatoId", id)} render={(contato) => ({ title: contato.nome, subtitle: `${contato.cargo} - ${contato.whatsapp}`, detail: contato.email })} />
            ) : (
              <p className="text-sm text-slate-500 bg-slate-50 rounded-2xl p-4">Nenhum contato cadastrado para este cliente.</p>
            )}
            <button type="button" onClick={() => setIsContactModalOpen(true)} className="mt-4 rounded-2xl border border-[#d7e5e8] bg-white px-4 py-3 text-sm font-semibold text-[#0b2f4a]">+ Adicionar novo contato</button>
          </FormSection>

          <FormSection title="4. Comprador / autorizado" description="Cadastro relacionado comercialmente ao cliente principal.">
            {!cliente ? (
              <p className="text-sm text-slate-500 bg-slate-50 rounded-2xl p-4">Selecione um cliente para visualizar os compradores autorizados.</p>
            ) : cliente.vinculosComerciais && cliente.vinculosComerciais.length > 0 ? (
              <SelectorGrid
                items={cliente.vinculosComerciais}
                selectedId={form.compradorId}
                onSelect={handleSelectComprador}
                render={(vinculo) => ({
                  title: vinculo.nome,
                  subtitle: vinculo.tipoRelacao,
                  detail: vinculo.documento
                })}
              />
            ) : (
              <p className="text-sm text-slate-500 bg-slate-50 rounded-2xl p-4">Nenhum comprador ou autorizado vinculado a este cliente.</p>
            )}
          </FormSection>

          <FormSection title="5. Endereço de entrega" description="Endereço usado para frete, PDF e expedição futura.">
            {combinedAddresses.length > 0 ? (
              <SelectorGrid
                items={combinedAddresses}
                selectedId={form.enderecoId}
                onSelect={(id) => updateField("enderecoId", id)}
                render={(endereco) => {
                  const isCompradorAddress = (endereco.tipo as string) === "comprador";
                  return {
                    title: `${endereco.endereco}, ${endereco.numero}`,
                    subtitle: `${endereco.cidade}/${endereco.uf} - CEP ${endereco.cep}`,
                    detail: isCompradorAddress ? "Endereço do Comprador" : endereco.tipo
                  };
                }}
              />
            ) : (
              <p className="text-sm text-slate-500 bg-slate-50 rounded-2xl p-4">Nenhum endereço disponível para entrega.</p>
            )}
            <button type="button" onClick={() => setIsAddressModalOpen(true)} className="mt-4 rounded-2xl border border-[#d7e5e8] bg-white px-4 py-3 text-sm font-semibold text-[#0b2f4a]">+ Adicionar novo endereço</button>
          </FormSection>

          <FormSection
            title="6. Produtos"
            description="Escolha do catálogo e configure quantidades, descontos e variações."
          >
            {/* Chips / Tags com borda suave, hover e destaque */}
            <div className="mb-4 flex flex-wrap gap-2">
              {productTags.map((tag) => {
                const search = normalize(tag.label);
                const matchingProduct = produtos.find(
                  (item) =>
                    normalize(item.nomeReal).includes(search) ||
                    item.apelidos.some((apelido) => normalize(apelido).includes(search))
                );
                const isSelected = selectedProduct && matchingProduct && selectedProduct.id_produto === matchingProduct.id_produto;

                return (
                  <button
                    key={tag.label}
                    type="button"
                    onClick={() => {
                      if (matchingProduct) {
                        setSelectedProductId(matchingProduct.id_produto.toString());
                      } else {
                        showToast({
                          type: "warning",
                          title: "Produto não localizado",
                          description: `Não encontramos produto ativo com a tag "${tag.label}" no catálogo.`
                        });
                      }
                    }}
                    className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-bold transition-all duration-200 ${
                      isSelected
                        ? "border-teal-300 bg-teal-50 text-teal-800 shadow-sm ring-2 ring-teal-200/50"
                        : "border-[#d7e5e8] bg-white text-[#0b2f4a] hover:bg-[#f3f7f8] hover:border-slate-300"
                    }`}
                  >
                    {tag.label}
                  </button>
                );
              })}
            </div>

            {/* Dropdown de selecão e botão de adicionar */}
            <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto]">
              <select
                value={selectedProductId}
                onChange={(event) => setSelectedProductId(event.target.value)}
                className={inputClass}
                disabled={loadingProdutos}
              >
                <option value="">Selecione um produto do catálogo...</option>
                {produtos.map((produto) => (
                  <option key={produto.id} value={produto.id_produto}>
                    #{produto.id_produto} - {produto.nomeReal}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => addProduct()}
                disabled={!selectedProductId}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white shadow-md shadow-[#0b2f4a]/10 hover:bg-[#123f61] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="h-4 w-4" />
                Adicionar produto
              </button>
            </div>

            {/* Preview do produto selecionado */}
            {selectedProduct && (
              <div className="mb-5 rounded-3xl border border-slate-100 bg-slate-50/50 p-4 transition-all duration-200">
                <div className="flex flex-col gap-4 sm:flex-row">
                  {selectedProduct.fotos?.[0]?.imagensURL ? (
                    <img
                      src={selectedProduct.fotos[0].imagensURL}
                      alt={selectedProduct.nomeReal}
                      className="h-20 w-20 shrink-0 rounded-2xl object-cover border border-slate-200 bg-white shadow-sm"
                    />
                  ) : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-slate-200/50 text-slate-400 border border-slate-200 border-dashed">
                      <Package className="h-8 w-8" />
                    </div>
                  )}
                  <div className="flex-1 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-bold text-slate-400">#{selectedProduct.id_produto}</span>
                        <h3 className="text-base font-bold text-[#0b2f4a]">{selectedProduct.nomeReal}</h3>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Valor Base</span>
                        <p className="text-base font-extrabold text-[#0b2f4a]">{formatCurrency(selectedProduct.valorUnt)}</p>
                      </div>
                    </div>
                    {selectedProduct.descricao && (
                      <p className="text-xs text-slate-500 leading-normal line-clamp-2">{selectedProduct.descricao}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 pt-1 border-t border-slate-200/40">
                      <span>Formato: <strong>{selectedProduct.formato || "Não informado"}</strong></span>
                      <span>Peso base: <strong>{formatWeightFromGrams(selectedProduct.peso)}</strong></span>
                      <span>Prazo base: <strong>{selectedProduct.prazo || "Sob consulta"}</strong></span>
                    </div>
                  </div>
                </div>
              </div>
            )}

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
          </FormSection>

          <FormSection 
            title="7. Fretes e Entrega" 
            description="Integração em tempo real com cotações de SEDEX e cadastro de frete manual."
          >
            {isFreightOutdated && form.enderecoId && resumo.pesoTotal > 0 && (
              <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <p className="font-semibold">⚠️ Cotação desatualizada</p>
                <p className="mt-1">O CEP, peso total ou volumes foram alterados. Clique em &apos;Atualizar frete&apos; para obter os valores corretos.</p>
              </div>
            )}

            <div className="mb-6 rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-4">
              <div className="flex flex-wrap items-end gap-4">
                <div className="w-24">
                  <Field label="Volumes">
                    <input
                      type="number"
                      min="1"
                      value={volumes}
                      onChange={(e) => setVolumes(Math.max(1, Number(e.target.value) || 1))}
                      className={inputClass}
                    />
                  </Field>
                </div>
                <div className="flex-1 flex gap-2">
                  <button
                    type="button"
                    onClick={handleCotarFretes}
                    disabled={isQuotingSedex || isQuotingAzul || isQuotingTransp || !form.enderecoId || resumo.pesoTotal <= 0}
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
          </FormSection>
        </div>

        <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">
          <FormSection title="8. Resumo da proposta" description="Resumo consolidado incluindo pesos e valores extras das variações.">
            <ResumoValores resumo={resumo} bonusPercent={bonusPercent} />
            {canManageCommercialRules ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-[130px_1fr]">
                <Field label="Tipo desconto geral">
                  <select value={form.descontoGeralTipo} onChange={(event) => updateField("descontoGeralTipo", event.target.value as TipoDescontoProposta)} className={inputClass}>
                    <option value="PERCENTUAL">%</option>
                    <option value="VALOR">R$</option>
                  </select>
                </Field>
                <Field label="Desconto geral">
                  <input value={form.descontoGeralValor} onChange={(event) => updateField("descontoGeralValor", event.target.value)} className={inputClass} />
                </Field>
              </div>
            ) : (
              <p className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">Desconto geral disponível apenas para admin/gerente.</p>
            )}
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
      </section>

      <div className="sticky bottom-4 z-20 rounded-3xl border border-[#d7e5e8] bg-white/95 p-4 shadow-xl shadow-slate-900/10 backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-slate-700">Proposta #{form.id_int || "NOVA"} | Total {formatCurrency(resumo.valorTotal)}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => router.push(mode === "edit" && proposta ? `/orcamentos/${proposta.id_int}` : "/orcamentos")} className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Cancelar</button>
            <button type="button" onClick={handleSave} disabled={isSaving} className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">{isSaving ? "Salvando..." : mode === "edit" ? "Salvar alterações" : "Salvar proposta"}</button>
          </div>
        </div>
      </div>

      {isContactModalOpen ? <ContactModal draft={contactDraft} onChange={setContactDraft} onClose={() => setIsContactModalOpen(false)} onSave={addContact} /> : null}
      {isAddressModalOpen ? <AddressModal draft={addressDraft} onChange={setAddressDraft} onClose={() => setIsAddressModalOpen(false)} onSave={addAddress} /> : null}
      {isManualFreteModalOpen ? (
        <ManualFreteModal
          draft={manualFreteDraft}
          onChange={setManualFreteDraft}
          onClose={() => setIsManualFreteModalOpen(false)}
          onSave={handleSaveManualFrete}
        />
      ) : null}
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

      <div className="grid gap-4 lg:grid-cols-[1fr_140px_160px]">
        <Field label="Descrição/modelo do item">
          <textarea
            value={item.descricaoModelo}
            onChange={(event) => onUpdate((current) => ({ ...current, descricaoModelo: event.target.value }))}
            className={`${inputClass} min-h-24 resize-y`}
            placeholder="Descreva detalhes adicionais sobre o produto se necessário..."
          />
        </Field>
        <Field label="Quantidade">
          <input
            type="number"
            value={item.quantidade || ""}
            onChange={(event) => onUpdate((current) => ({ ...current, quantidade: Math.max(0, Number(event.target.value)) }))}
            className={inputClass}
            placeholder="Qtd"
          />
        </Field>
        <InfoBox label="Subtotal final" value={formatCurrency(item.subtotal)} />
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

function SelectorGrid<T extends { id: string }>({ items, selectedId, onSelect, render }: { items: T[]; selectedId: string; onSelect: (id: string) => void; render: (item: T) => { title: string; subtitle: string; detail: string } }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((item) => {
        const content = render(item);
        const isSelected = selectedId === item.id;
        return (
          <button key={item.id} type="button" onClick={() => onSelect(item.id)} className={`rounded-3xl border p-4 text-left transition ${isSelected ? "border-teal-200 bg-teal-50 text-teal-800" : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white"}`}>
            <p className="font-semibold">{content.title}</p>
            <p className="mt-1 text-sm opacity-80">{content.subtitle}</p>
            <p className="mt-1 text-xs opacity-70">{content.detail}</p>
          </button>
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

function AddressModal({ draft, onChange, onClose, onSave }: { draft: AddressDraft; onChange: (draft: AddressDraft) => void; onClose: () => void; onSave: () => void }) {
  return (
    <Modal title="Adicionar novo endereço" onClose={onClose} onSave={onSave}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="CEP"><input value={draft.cep} onChange={(event) => onChange({ ...draft, cep: event.target.value })} className={inputClass} /></Field>
        <Field label="Logradouro"><input value={draft.endereco} onChange={(event) => onChange({ ...draft, endereco: event.target.value })} className={inputClass} /></Field>
        <Field label="Número"><input value={draft.numero} onChange={(event) => onChange({ ...draft, numero: event.target.value })} className={inputClass} /></Field>
        <Field label="Complemento"><input value={draft.complemento ?? ""} onChange={(event) => onChange({ ...draft, complemento: event.target.value })} className={inputClass} /></Field>
        <Field label="Bairro"><input value={draft.bairro} onChange={(event) => onChange({ ...draft, bairro: event.target.value })} className={inputClass} /></Field>
        <Field label="Cidade"><input value={draft.cidade} onChange={(event) => onChange({ ...draft, cidade: event.target.value })} className={inputClass} /></Field>
        <Field label="UF"><input value={draft.uf} onChange={(event) => onChange({ ...draft, uf: event.target.value.toUpperCase() })} className={inputClass} maxLength={2} /></Field>
        <Field label="Tipo"><select value={draft.tipo} onChange={(event) => onChange({ ...draft, tipo: event.target.value as CadastroEndereco["tipo"] })} className={inputClass}><option value="principal">Principal</option><option value="entrega">Entrega</option><option value="cobranca">Cobrança</option><option value="fiscal">Fiscal</option></select></Field>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose, onSave }: { title: string; children: ReactNode; onClose: () => void; onSave: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="mx-auto mt-8 max-w-3xl rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 p-5"><h2 className="text-lg font-semibold text-slate-950">{title}</h2><button type="button" onClick={onClose} className="rounded-2xl bg-slate-100 p-2 text-slate-700"><X className="h-5 w-5" /></button></div>
        <div className="p-5">{children}</div>
        <div className="flex flex-col gap-2 border-t border-slate-100 p-5 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Cancelar</button><button type="button" onClick={onSave} className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white">Adicionar</button></div>
      </div>
    </div>
  );
}

function createInitialState(proposta?: Proposta): PropostaFormState {
  const cliente = proposta?.cliente;
  const endereco = proposta?.enderecoEntrega;
  const fretes = proposta?.fretes ?? (endereco ? createFretesMock(endereco, proposta?.id_int ?? 0, proposta?.resumo.pesoTotal ?? 0) : []);
  return {
    id_int: proposta?.id_int ? proposta.id_int.toString() : "NOVO",
    empresa: proposta?.empresa ?? "Ideal Grafica",
    vendedor: proposta?.vendedor ?? (cliente ? getClienteVendedorPadrao(cliente) : ""),
    status: proposta?.status ?? "NOVO",
    clienteId: cliente ? cliente.idCliente.toString() : "",
    contatoId: proposta?.contato.id ?? cliente?.contatos[0]?.id ?? "",
    enderecoId: endereco?.id ?? "",
    compradorId: proposta?.compradorAutorizado?.id ?? "",
    itens: proposta?.itens ?? [],
    fretes,
    freteEscolhidoId: proposta?.freteEscolhidoId ?? fretes.find((frete) => frete.escolhido)?.id ?? fretes[0]?.id ?? "",
    descontoGeralTipo: proposta?.descontoGeralTipo ?? "VALOR",
    descontoGeralValor: proposta?.descontoGeralValor ? proposta.descontoGeralValor.toString() : "0",
    formaPagamento: proposta?.formaPagamento ?? "Pix a vista 3 dias",
    observacoes: proposta?.observacoes ?? ""
  };
}
