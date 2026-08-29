"use client";

import { useEffect, useState, useCallback, useMemo, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  RefreshCw,
  Info,
  Save,
  Check,
  ExternalLink,
  FileCode,
  Building,
  User,
  Truck,
  CreditCard,
  Layers,
  MapPin,
  ClipboardList,
  ArrowLeft,
  FileText,
  Send
} from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useAppToast } from "@/components/common/AppToast";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDateTime } from "@/lib/formatters/date";
import { StatusBadge } from "@/components/common/StatusBadge";
import {
  getNfeById,
  getNfeItems,
  getNfePagamentos,
  getNfeValidationGeral,
  prepararEnvioNfe,
  montarPayloadNfe,
  updateNfeDraft,
  trocarEmpresaNfe,
  gerarPagamentosNfe,
  getTransportadoras,
  insertNfeItem,
  deleteNfeItem,
  recalcularTotaisNfe,
  searchActiveProducts,
  updateNfeItem,
  recreateSinglePayment,
  previewNfeRascunho,
  invalidateNfePayments,
  getAlertasNfe,
  getNfeDisplayStatus,
  resolverDestinoFiscal,
  ufDaEmpresaEmitente,
  cfopDeVenda,
  cfopDaNatureza,
  tributacaoDaNatureza,
  type TributacaoDoItem,
  destinoDaOperacao,
  type DestinoFiscal,
  getNotaEventos,
  getBoletosAtivosDaProposta,
  getNaturezasOperacaoNfe,
  type NaturezaOperacaoNfe,
  type BoletoAtivoDaProposta,
  type SupabaseNotaEventoRow,
  type SimpleProduct
} from "../services/nfe.service";
import type { SupabaseNfeRow, SupabaseNfeItemRow, SupabaseNfePagamentoRow, NfeReadModel } from "../types";
import { OPCOES_TIPO_CONTRIBUINTE } from "@/lib/fiscal/tipo-contribuinte";
import { escolherEnderecoPrincipal } from "@/lib/fiscal/endereco-principal";
import { mapSupabaseNfeRowToReadModel } from "../mappers";
import { EmissaoNfeModal } from "@/features/fiscal/components/EmissaoNfeModal";
import {
  levantarPendencias,
  pendenciasQueImpedem,
  campoDoItem,
  CAMPO_CONSUMIDOR_FINAL,
  CAMPO_TIPO_CONTRIBUINTE,
  CAMPO_MODALIDADE_FRETE,
  type Pendencia,
  type BlocoNfe
} from "../pendencias";
import {
  ConferenciaLateral,
  BlocoConferencia,
  ancoraDoBloco,
  type EstadoBloco
} from "./ConferenciaNfe";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";

interface ClienteData {
  nome?: string | null;
  documento?: string | null;
  inscricao_estadual?: string | null;
  ins_estadual?: string | null;
  email?: string | null;
  cep?: string | null;
  cidade?: string | null;
  uf?: string | null;
  bairro?: string | null;
  logradouro?: string | null;
  numero?: string | null;
}

interface EmpresaData {
  cnpj?: string | null;
  inscricao_estadual?: string | null;
  uf?: string | null;
}

interface EnderecoData {
  id?: string | number | null;
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  tipo_endereco?: string | null;
  data_criacao?: string | null;
  obs?: string | null;
}

interface ValidationData {
  pode_emitir?: boolean;
  pendencias_texto?: string[] | null;
}

interface TransportadoraSimple {
  id_cliente: number;
  nome?: string | null;
  fantasia?: string | null;
  documento?: string | null;
  cidade_uf?: string | null;
}

interface NfeDetailPageProps {
  noteId: string;
}

/**
 * As antigas abas viraram os blocos da conferência única. O nome ficou: é o
 * mesmo rótulo que a lista de pendências usa como bloco de origem.
 */
type TabName = BlocoNfe;

/** Ordem em que a conferência acontece — vale para a lateral e para a pilha. */
const BLOCOS_DA_NOTA: BlocoNfe[] = [
  "Resumo",
  "Emitente",
  "Destinatário",
  "Itens",
  "Transporte/Frete",
  "Pagamentos",
  "Totais",
  "Informações adicionais",
  "Validação",
  "Documentos/Preview"
];

/**
 * Nunca nascem recolhidos, mesmo sem pendência: são os dois blocos que o
 * operador abre em toda nota para conferir linha a linha. Recolhê-los deixava
 * a página curta e a conferência mais lenta.
 */
const BLOCOS_SEMPRE_ABERTOS: BlocoNfe[] = ["Itens", "Pagamentos"];

/**
 * Os três campos do painel de tributação do item.
 *
 * Os `id` são os que `pendencias.ts` já apontava em ITEM_SEM_ICMS_CST,
 * ITEM_SEM_PIS_CST e ITEM_SEM_COFINS_CST — antes deste painel eles não existiam
 * no DOM, e clicar na pendência abria a aba sem levar a lugar nenhum.
 */
const CAMPOS_TRIBUTACAO = [
  { campo: "icms_situacao_tributaria", id: "icms-cst", rotulo: "CSOSN (ICMS)" },
  { campo: "pis_situacao_tributaria", id: "pis-cst", rotulo: "CST PIS" },
  { campo: "cofins_situacao_tributaria", id: "cofins-cst", rotulo: "CST COFINS" }
] as const satisfies readonly { campo: keyof TributacaoDoItem; id: string; rotulo: string }[];

export function NfeDetailPage({ noteId }: NfeDetailPageProps) {
  const router = useRouter();
  const { showToast } = useAppToast();

  // Active Tab
  const [activeTab, setActiveTab] = useState<TabName>("Resumo");
  /** Recolher/abrir escolhido na mão. Só o que o operador tocou aparece aqui. */
  const [blocosAbertos, setBlocosAbertos] = useState<Partial<Record<BlocoNfe, boolean>>>({});

  // DB Data
  const [note, setNote] = useState<SupabaseNfeRow | null>(null);
  // Emissão a partir daqui: o operador não volta mais à lista para emitir.
  const [notaParaEmitir, setNotaParaEmitir] = useState<NfeReadModel | null>(null);
  // Destino e UF do emitente resolvidos pela MESMA fonte do rascunho: o endereco
  // apontado no pedido. Antes esta tela decidia o CFOP pelo uf do cadastro do
  // cliente, que e outra coisa.
  const [destinoFiscal, setDestinoFiscal] = useState<DestinoFiscal | null>(null);
  const [ufEmitente, setUfEmitente] = useState<string>("");
  const { user } = useAuth();
  const podeEmitirNfe = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "fiscal.emit_nfe");
  const isReadOnly = note ? ["AUTORIZADA", "CANCELADA", "DENEGADA", "PROCESSANDO", "PROCESSANDO_AUTORIZACAO"].includes((note.status || "").toUpperCase()) : false;
  const [items, setItems] = useState<SupabaseNfeItemRow[]>([]);
  const [pagamentos, setPagamentos] = useState<SupabaseNfePagamentoRow[]>([]);
  const [events, setEvents] = useState<SupabaseNotaEventoRow[]>([]);
  const [cliente, setCliente] = useState<ClienteData | null>(null);
  const [empresa, setEmpresa] = useState<EmpresaData | null>(null);

  // States de Validação e Payload
  const [validationData, setValidationData] = useState<ValidationData | null>(null);
  const [focusPayload, setFocusPayload] = useState<Record<string, unknown> | null>(null);

  // Loaders
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isPayloadLoading, setIsPayloadLoading] = useState(false);

  // Editable header fields state
  const [naturezaOperacao, setNaturezaOperacao] = useState("");
  // Rotulo com o CFOP na frente, como o catalogo guarda. O app grava os DOIS
  // campos: `fn_sync_natureza_operacao_nfe` so age quando natureza_operacao esta
  // vazia, e depender dela aqui deixaria o resultado da tela na mao de uma
  // trigger implicita. Ela segue valendo para quem nao passa pelo app.
  const [dropNaturezaOp, setDropNaturezaOp] = useState("");
  const [naturezasCatalogo, setNaturezasCatalogo] = useState<NaturezaOperacaoNfe[]>([]);

  // `INTERNA` ou `INTERESTADUAL` para ESTA nota. `null` enquanto as UFs não
  // carregaram, ou quando o pedido não resolve um destino.
  const destinoOperacaoNota = useMemo(
    () => destinoDaOperacao(destinoFiscal?.uf ?? "", ufEmitente),
    [destinoFiscal, ufEmitente]
  );

  // O SELECT SÓ OFERECE O QUE A UF PERMITE.
  //
  // Numa nota interna, escolher 6101 era escolha impossível: a derivação
  // corrigia para 5101 e a tela passava a mostrar "6101" no select com
  // "CFOP dos itens: 5101" logo abaixo — duas informações brigando no mesmo
  // canto. A opção some em vez de ser corrigida pelas costas.
  //
  // SEM UF NÃO SE FILTRA. Enquanto `destinoFiscal` e `ufEmitente` não chegam —
  // são assíncronos — não há como saber se a operação cruza fronteira, e
  // esconder metade da lista por isso seria esconder por ignorância. O mesmo
  // vale se o filtro não sobrar nada: melhor a lista inteira que um select
  // vazio.
  const naturezasDisponiveis = useMemo(() => {
    if (!destinoOperacaoNota) return naturezasCatalogo;
    const compativeis = naturezasCatalogo.filter(
      (n) => n.destinoOperacao === destinoOperacaoNota
    );
    return compativeis.length > 0 ? compativeis : naturezasCatalogo;
  }, [naturezasCatalogo, destinoOperacaoNota]);

  // A natureza JÁ GRAVADA continua na lista mesmo quando não casa com a UF de
  // hoje — nota antiga, ou endereço que mudou de estado depois. Sumir com ela
  // trocaria a escolha do usuário sem ele pedir.
  const naturezaGravadaForaDaLista =
    dropNaturezaOp !== "" && !naturezasDisponiveis.some((n) => n.descricao === dropNaturezaOp);

  // O CFOP DOS ITENS DERIVA DA NATUREZA DA NOTA — não é mais digitado, e não é
  // mais calculado só por UF. A UF continua decidindo entre o par interno e o
  // interestadual; quem escolhe o par é a natureza.
  //
  // `null` quando a natureza não casa com o catálogo (as notas antigas) ou
  // quando falta UF: aí não há o que derivar e os itens ficam com o que têm.
  const cfopDerivado = useMemo(
    () =>
      cfopDaNatureza(
        dropNaturezaOp,
        destinoFiscal?.uf ?? "",
        ufEmitente,
        naturezasCatalogo
      ),
    [dropNaturezaOp, destinoFiscal, ufEmitente, naturezasCatalogo]
  );

  // A TRIBUTAÇÃO DOS ITENS TAMBÉM VEM DA NATUREZA — mesma linha do catálogo que
  // deu o CFOP. Não depende de UF: imposto não muda por cruzar fronteira.
  //
  // `null` = natureza fora do catálogo, nada a derivar. Campos `null` DENTRO do
  // retorno = o catálogo achou a linha e ela diz que não decide (5202/6202).
  const tributacaoDerivada = useMemo(
    () => tributacaoDaNatureza(dropNaturezaOp, naturezasCatalogo),
    [dropNaturezaOp, naturezasCatalogo]
  );

  // A natureza escolhida é uma em que o catálogo NÃO decide a tributação. Aí os
  // campos nascem vazios de propósito, não há divergência a marcar (não há
  // padrão do qual divergir) e a emissão fica barrada até alguém informar.
  const naturezaSemTributacaoPadrao = Boolean(
    tributacaoDerivada &&
      tributacaoDerivada.icms_situacao_tributaria === null &&
      tributacaoDerivada.pis_situacao_tributaria === null &&
      tributacaoDerivada.cofins_situacao_tributaria === null
  );

  /** Qual item está com o painel de tributação aberto. Fechado por padrão. */
  const [itemTribAberto, setItemTribAberto] = useState<string | null>(null);

  /**
   * O valor difere do padrão da natureza?
   *
   * SEM PADRÃO, NÃO HÁ DIVERGÊNCIA. Vale para 5202/6202, onde o catálogo diz
   * que não decide, e para natureza fora do catálogo. Marcar ali seria marcar
   * sempre — o que esvazia a marcação em vez de informar.
   */
  const divergeDoPadrao = useCallback(
    (campo: keyof TributacaoDoItem, valor: string | null | undefined): boolean => {
      const padrao = tributacaoDerivada?.[campo] ?? null;
      if (padrao === null) return false;
      return String(valor ?? "").trim() !== padrao;
    },
    [tributacaoDerivada]
  );
  const [finalidadeEmissao, setFinalidadeEmissao] = useState(1);
  const [consumidorFinal, setConsumidorFinal] = useState(1);
  const [presencaComprador, setPresencaComprador] = useState(2);
  const [tipoContribuinte, setTipoContribuinte] = useState(9);
  const [modalidadeFrete, setModalidadeFrete] = useState(9);
  const [transportadora, setTransportadora] = useState("");
  const [valorFrete, setValorFrete] = useState(0);
  const [quantidadeVolumes, setQuantidadeVolumes] = useState(1);
  const [especieVolumes, setEspecieVolumes] = useState("");
  const [pesoLiquido, setPesoLiquido] = useState(0);
  const [pesoBruto, setPesoBruto] = useState(0);
  const [infoComplementares, setInfoComplementares] = useState("");
  const [obsInternas, setObsInternas] = useState("");

  // Editable items state
  const [editedItems, setEditedItems] = useState<Partial<SupabaseNfeItemRow>[]>([]);

  /** Algum dos três campos do item saiu do padrão — alimenta o ponto no botão. */
  const itemTemDivergencia = useCallback(
    (item: SupabaseNfeItemRow): boolean => {
      const editado = editedItems.find((it) => it.id === item.id);
      return CAMPOS_TRIBUTACAO.some(({ campo }) =>
        divergeDoPadrao(campo, editado?.[campo] ?? item[campo])
      );
    },
    [editedItems, divergeDoPadrao]
  );
  // Editable payments state
  const [editedPagamentos, setEditedPagamentos] = useState<Partial<SupabaseNfePagamentoRow>[]>([]);

  // Delivery address states
  const [deliveryCep, setDeliveryCep] = useState("");
  const [deliveryLogradouro, setDeliveryLogradouro] = useState("");
  const [deliveryNumero, setDeliveryNumero] = useState("");
  const [deliveryComplemento, setDeliveryComplemento] = useState("");
  const [deliveryBairro, setDeliveryBairro] = useState("");
  const [deliveryCidade, setDeliveryCidade] = useState("");
  const [deliveryUf, setDeliveryUf] = useState("");

  // Transportadoras state
  const [transportadoras, setTransportadoras] = useState<TransportadoraSimple[]>([]);
  const [idTransportadoraCliente, setIdTransportadoraCliente] = useState<number | null>(null);

  // Installment generation states
  const [pgtoValorEntrada, setPgtoValorEntrada] = useState(0);
  const [pgtoQtdParcelas, setPgtoQtdParcelas] = useState(1);
  const [pgtoDiasPraInicio, setPgtoDiasPraInicio] = useState(30);
  const [pgtoIntervalo, setPgtoIntervalo] = useState(30);
  const [pgtoFormaPagamento, setPgtoFormaPagamento] = useState("15");
  const [isGeneratingPgto, setIsGeneratingPgto] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Formato do modal Preparar Cobrança, espelhado aqui: parcela única com
  // vencimento escolhido e arredondamento de valores. Quem calcula continua
  // sendo a RPC — estes campos só viajam como parâmetro.
  const [pgtoParcelaUnica, setPgtoParcelaUnica] = useState(false);
  const [pgtoVencimentoUnico, setPgtoVencimentoUnico] = useState("");
  const [pgtoArredondar, setPgtoArredondar] = useState(false);

  /**
   * Títulos já lançados em contas a receber para esta proposta.
   *
   * Servem de SUGESTÃO de vencimento: quando a proposta já tem título, o cliente
   * já recebeu aquelas datas, e redigitá-las na mão é como as duas coisas
   * divergem. Nada aqui trava a gravação — quem confere no fim é o financeiro.
   */
  const [boletosAtivos, setBoletosAtivos] = useState<BoletoAtivoDaProposta[]>([]);
  const [sugestaoAplicada, setSugestaoAplicada] = useState(false);

  // New item states
  const [newItemDesc, setNewItemDesc] = useState("");
  const [newItemNcm, setNewItemNcm] = useState("49119900");
  const [newItemUn, setNewItemUn] = useState("UN");
  const [newItemQty, setNewItemQty] = useState(1);
  const [newItemPrice, setNewItemPrice] = useState(0);
  const [newItemPeso, setNewItemPeso] = useState(0);
  const [newItemObs, setNewItemObs] = useState("");
  const [isAddingItem, setIsAddingItem] = useState(false);

  // Additional states for enderecos & products search
  const [useDeliveryAddress, setUseDeliveryAddress] = useState(false);
  const [allEnderecos, setAllEnderecos] = useState<EnderecoData[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [customAddressActive, setCustomAddressActive] = useState(false);
  const [isAddNewItemOpen, setIsAddNewItemOpen] = useState(false);

  const [principalEndereco, setPrincipalEndereco] = useState<EnderecoData | null>(null);
  const [dbProducts, setDbProducts] = useState<SimpleProduct[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [newItemCodigo, setNewItemCodigo] = useState("MANUAL");
  const [productSearchText, setProductSearchText] = useState("");

  // Collapsable technical block state
  const [isPayloadOpen, setIsPayloadOpen] = useState(false);

  // States for payment invalidation and confirm modal
  const [paymentsInvalidated, setPaymentsInvalidated] = useState(false);
  const isFirstLoad = useRef(true);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
    onCancel?: () => void;
    confirmText?: string;
    cancelText?: string;
    showCancel?: boolean;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {}
  });

  const confirmActionWithPaymentCheck = (
    hasSignificantChanges: boolean
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      // Se for forma de pagamento à vista, não precisa de confirmação nem de invalidação manual
      if (pgtoFormaPagamento !== "15") {
        resolve(true);
        return;
      }

      if (hasSignificantChanges && pagamentos.length > 0) {
        setConfirmModal({
          isOpen: true,
          title: "Invalidação de Pagamentos",
          message: "Alterar os itens da nota fiscal invalida os pagamentos atuais. Os pagamentos fiscais serão recriados para manter consistência com o total da nota.",
          confirmText: "Continuar e Invalidar",
          cancelText: "Cancelar",
          showCancel: true,
          onConfirm: async () => {
            if (note) {
              await invalidateNfePayments(note.id);
            }
            setPaymentsInvalidated(true);
            setPagamentos([]);
            setEditedPagamentos([]);
            resolve(true);
          },
          onCancel: () => {
            resolve(false);
          }
        });
      } else {
        resolve(true);
      }
    });
  };

  const hasUnsavedChanges = (item: SupabaseNfeItemRow) => {
    const edited = editedItems.find(it => it.id === item.id);
    if (!edited) return false;
    
    return (
      (edited.descricao !== undefined && edited.descricao !== item.descricao) ||
      (edited.unidade_comercial !== undefined && edited.unidade_comercial !== item.unidade_comercial) ||
      (edited.quantidade !== undefined && Number(edited.quantidade) !== item.quantidade) ||
      (edited.valor_unitario !== undefined && Number(edited.valor_unitario) !== item.valor_unitario) ||
      (edited.valor_bruto !== undefined && Number(edited.valor_bruto) !== item.valor_bruto) ||
      (edited.ncm !== undefined && edited.ncm !== item.ncm) ||
      (edited.cfop !== undefined && edited.cfop !== item.cfop) ||
      (edited.peso_total_gramas !== undefined && Number(edited.peso_total_gramas) !== item.peso_total_gramas) ||
      (edited.observacao !== undefined && edited.observacao !== item.observacao)
    );
  };

  // Load Note and related data
  const loadData = useCallback(async (forceInitPaymentsInvalidated = false) => {
    setIsLoading(true);
    try {
      const dbNote = await getNfeById(noteId);
      if (!dbNote) {
        showToast({ type: "error", title: "Nota Fiscal não encontrada." });
        router.push("/notas-fiscais");
        return;
      }
      setNote(dbNote);
      setNaturezaOperacao(dbNote.natureza_operacao || "");
      setDropNaturezaOp(dbNote.drop_natureza_op || "");
      setFinalidadeEmissao(dbNote.finalidade_emissao);
      setConsumidorFinal(dbNote.consumidor_final);
      setPresencaComprador(dbNote.presenca_comprador);
      setTipoContribuinte(dbNote.tipo_contribuinte);
      setModalidadeFrete(dbNote.modalidade_frete);
      setTransportadora(dbNote.transportadora || "");
      setValorFrete(dbNote.valor_frete || 0);
      setQuantidadeVolumes(dbNote.quantidade_volumes || 1);
      setEspecieVolumes(dbNote.especie_volumes || "");
      setPesoLiquido(dbNote.peso_liquido || 0);
      setPesoBruto(dbNote.peso_bruto || 0);
      setInfoComplementares(dbNote.informacoes_complementares || "");
      setObsInternas(dbNote.observacoes_internas || "");
      setIdTransportadoraCliente(dbNote.id_transportadora_cliente);
      // 1. Load client details, principal address and products first
      const client = getSupabaseClient();
      let fetchedEnderecos: EnderecoData[] = [];
      if (client) {
        const { data: cliData } = await client
          .from("clientes")
          .select("*")
          .eq("id_cliente", dbNote.id_cliente)
          .maybeSingle();
        if (cliData) {
          setCliente(cliData);
        }

        // UMA consulta para os enderecos do cliente, e o principal sai dela.
        //
        // Antes eram duas, e a do endereco principal filtrava
        // `.eq("tipo_endereco", "Principal")` — grafia que NAO EXISTE no banco:
        // sao 66.224 linhas `PRINCIPAL` e 3 `principal`, zero `Principal`. O
        // filtro nunca casava, `principalEndereco` era sempre null e a aba
        // Destinatario dizia "Nenhum endereco principal cadastrado" para todo
        // mundo. O endereco so aparecia no DANFE Preview, porque a RPC do
        // payload compara `lower(trim(...))` e acha.
        //
        // A escolha usa `escolherEnderecoPrincipal`, o MESMO criterio do
        // servico e da RPC (caixa alta vence, depois o mais recente, depois o
        // id) — a tela nao pode mostrar um endereco e a nota sair com outro.
        const { data: allAddrData } = await client
          .from("enderecos")
          .select("id, cep, endereco, numero, complemento, bairro, cidade, uf, tipo_endereco, data_criacao, obs")
          .eq("id_cliente", dbNote.id_cliente);
        if (allAddrData) {
          fetchedEnderecos = allAddrData;
          setAllEnderecos(allAddrData);
        } else {
          setAllEnderecos([]);
        }
        setPrincipalEndereco(escolherEnderecoPrincipal(fetchedEnderecos));

        const { data: empData } = await client
          .from("empresas")
          .select("*")
          .eq("id", dbNote.id_empresa)
          .maybeSingle();
        if (empData) {
          setEmpresa(empData);
        }

        const productsData = await searchActiveProducts();
        setDbProducts(productsData);
      }

      // 2. Endereco de entrega gravado na nota. A IE nao entra mais aqui:
      //    ela vem do cadastro do cliente e so de la pode ser corrigida.
      let parsedAddr: Record<string, string> | null = null;
      if (dbNote.endereco_entrega_observacao) {
        try {
          parsedAddr = JSON.parse(dbNote.endereco_entrega_observacao) as Record<string, string>;
        } catch {
          // ignore
        }
      }
      setDeliveryCep(parsedAddr?.cep || "");
      setDeliveryLogradouro(parsedAddr?.logradouro || parsedAddr?.endereco || "");
      setDeliveryNumero(parsedAddr?.numero || "");
      setDeliveryComplemento(parsedAddr?.complemento || "");
      setDeliveryBairro(parsedAddr?.bairro || "");
      setDeliveryCidade(parsedAddr?.cidade || "");
      setDeliveryUf(parsedAddr?.uf || "");

      // Match custom delivery address against fetched addresses
      let foundMatchId: string | null = null;
      if (parsedAddr && fetchedEnderecos.length > 0) {
        const match = fetchedEnderecos.find(a => 
          (a.cep || "").replace(/\D/g, "") === (parsedAddr?.cep || "").replace(/\D/g, "") &&
          (a.endereco || "").toLowerCase().trim() === (parsedAddr?.logradouro || parsedAddr?.endereco || "").toLowerCase().trim() &&
          (a.numero || "").toLowerCase().trim() === (parsedAddr?.numero || "").toLowerCase().trim() &&
          (a.complemento || "").toLowerCase().trim() === (parsedAddr?.complemento || "").toLowerCase().trim() &&
          (a.bairro || "").toLowerCase().trim() === (parsedAddr?.bairro || "").toLowerCase().trim() &&
          (a.cidade || "").toLowerCase().trim() === (parsedAddr?.cidade || "").toLowerCase().trim() &&
          (a.uf || "").toUpperCase().trim() === (parsedAddr?.uf || "").toUpperCase().trim()
        );
        if (match) {
          foundMatchId = match.id ? String(match.id) : null;
        }
      }

      if (dbNote.end_entrega) {
        setUseDeliveryAddress(true);
        if (foundMatchId) {
          setSelectedAddressId(foundMatchId);
          setCustomAddressActive(false);
        } else {
          setSelectedAddressId("manual");
          setCustomAddressActive(true);
        }
      } else {
        setUseDeliveryAddress(false);
        setSelectedAddressId(null);
        setCustomAddressActive(false);
      }
      
      // 3. Load Items
      const dbItems = await getNfeItems(noteId);
      setItems(dbItems);
      setEditedItems(dbItems.map(it => ({
        id: it.id,
        descricao: it.descricao,
        ncm: it.ncm,
        cfop: it.cfop,
        // Sem estes três aqui, editar a tributação não teria onde morar — e o
        // salvamento em lote não teria o que mandar.
        icms_situacao_tributaria: it.icms_situacao_tributaria,
        pis_situacao_tributaria: it.pis_situacao_tributaria,
        cofins_situacao_tributaria: it.cofins_situacao_tributaria,
        unidade_comercial: it.unidade_comercial,
        quantidade: it.quantidade,
        valor_unitario: it.valor_unitario,
        valor_bruto: it.valor_bruto,
        peso_unitario_gramas: it.peso_unitario_gramas,
        peso_total_gramas: it.peso_total_gramas,
        observacao: it.observacao
      })));

      // 4. Load Payments
      const dbPayments = await getNfePagamentos(noteId);
      setPagamentos(dbPayments);
      setEditedPagamentos(dbPayments.map(pg => ({ id: pg.id, forma_pagamento: pg.forma_pagamento, valor: pg.valor, data_vencimento: pg.data_vencimento })));
      if (isFirstLoad.current || forceInitPaymentsInvalidated) {
        setPaymentsInvalidated(dbPayments.length === 0 && dbNote.pgto_is_configurado && (dbNote.valor_total_nf > 0));
        isFirstLoad.current = false;
      }
      
      if (dbPayments.length > 0 && dbPayments[0].forma_pagamento) {
        setPgtoFormaPagamento(dbPayments[0].forma_pagamento);
      } else if (dbNote.forma_pgto) {
        setPgtoFormaPagamento(dbNote.forma_pgto);
      }

      // Initialize installment generation state from database payments
      if (dbPayments.length > 0) {
        const entrance = dbPayments.find(p => p.tipo_registro === "ENTRADA");
        const parcelas = dbPayments.filter(p => p.tipo_registro === "PARCELA");
        if (entrance) {
          setPgtoValorEntrada(Number(entrance.valor) || 0);
          setPgtoQtdParcelas(parcelas.length || 1);
          if (parcelas.length > 0) {
            setPgtoDiasPraInicio(parcelas[0].dias_pra_inicio || 0);
            setPgtoIntervalo(parcelas[0].intervalo_dias || 30);
          }
        } else {
          setPgtoValorEntrada(0);
          setPgtoQtdParcelas(dbPayments.length);
          setPgtoDiasPraInicio(dbPayments[0].dias_pra_inicio || 0);
          setPgtoIntervalo(dbPayments[0].intervalo_dias || 30);
        }
      }

      // 4b. Títulos já lançados desta proposta — sugestão de vencimento. Uma
      // consulta por `id_int`, nunca por linha. Falha aqui não derruba a tela:
      // sem sugestão, a aba continua funcionando como antes.
      try {
        const titulos = await getBoletosAtivosDaProposta(Number(dbNote.id_int));
        setBoletosAtivos(titulos);
      } catch (err) {
        console.warn("[NfeDetail] Falha ao carregar títulos da proposta para sugestão:", err);
        setBoletosAtivos([]);
      }
      setSugestaoAplicada(false);

      // 5. Load transportadoras list
      const transportadorasData = await getTransportadoras();
      setTransportadoras(transportadorasData);

      // 5b. Catalogo de naturezas de operacao (NF-e, ativas). Falha aqui nao
      // derruba a tela: sem catalogo o select fica vazio e a nota mantem a
      // natureza que ja tem.
      try {
        setNaturezasCatalogo(await getNaturezasOperacaoNfe());
      } catch (err) {
        console.warn("[NfeDetail] Falha ao carregar naturezas de operacao:", err);
        setNaturezasCatalogo([]);
      }

      // Initial validation from view
      const validation = await getNfeValidationGeral(dbNote.ref);
      setValidationData(validation as ValidationData | null);

      // Load events
      const dbEvents = await getNotaEventos("NFE", dbNote.ref);
      setEvents(dbEvents || []);
    } catch (err) {
      console.error("[NfeDetail] Error loading note data:", err);
      showToast({ type: "error", title: "Erro ao carregar dados do rascunho." });
    } finally {
      setIsLoading(false);
    }
  }, [noteId, router, showToast]);

  // Destino fiscal em efeito proprio: fica fora do loadData memoizado e depende
  // so do pedido e da empresa da nota.
  useEffect(() => {
    const idInt = note?.id_int;
    const idEmpresa = note?.id_empresa;
    if (!idInt || !idEmpresa) return;

    let vivo = true;
    void (async () => {
      const [destino, ufEmp] = await Promise.all([
        resolverDestinoFiscal(idInt),
        ufDaEmpresaEmitente(idEmpresa)
      ]);
      if (!vivo) return;
      setDestinoFiscal(destino);
      setUfEmitente(ufEmp);
    })();

    return () => {
      vivo = false;
    };
  }, [note]);

  useEffect(() => {
    let isMounted = true;
    const fetchDraft = async () => {
      if (isMounted) {
        await loadData();
      }
    };
    void fetchDraft();
    return () => {
      isMounted = false;
    };
  }, [loadData]);

  // Recalculate totals client-side for immediate feedback
  const computedValorProdutos = editedItems.reduce((acc, curr) => {
    const qty = curr.quantidade || 0;
    const price = curr.valor_unitario || 0;
    return acc + (qty * price);
  }, 0);

  const computedValorTotalNf = computedValorProdutos + (valorFrete || 0) - (note?.valor_desconto || 0);
  const sumOfPayments = editedPagamentos.reduce((acc, curr) => acc + (Number(curr.valor) || 0), 0);
  const isPaymentMismatch = Math.abs(computedValorTotalNf - sumOfPayments) > 0.01;

  // --- Sugestão a partir dos títulos já lançados -------------------------
  const totalTitulosAtivos =
    Math.round(boletosAtivos.reduce((acc, item) => acc + (Number(item.valor) || 0), 0) * 100) / 100;
  const temTitulosAtivos = boletosAtivos.length > 0;
  /** Diferença entre o que a nota vai declarar e o que já foi cobrado. Aviso, não trava. */
  const divergenciaTitulos =
    temTitulosAtivos && Math.abs(sumOfPayments - totalTitulosAtivos) > 0.01
      ? Math.round((sumOfPayments - totalTitulosAtivos) * 100) / 100
      : null;

  /** YYYY-MM-DD → DD/MM/AAAA, sem passar por Date (que desloca por fuso). */
  const vencimentoBr = (iso: string) => {
    const [ano, mes, dia] = String(iso ?? "").split("-");
    return ano && mes && dia ? `${dia}/${mes}/${ano}` : String(iso ?? "");
  };

  /** Parcela fiscal ↔ título, por número de parcela. */
  const tituloDaParcela = (numeroParcela: number | null | undefined) =>
    boletosAtivos.find((item) => item.parcela === Number(numeroParcela)) ?? null;

  /**
   * Copia data e valor dos títulos para as parcelas fiscais de mesmo número.
   * Só preenche a tela: nada é gravado até o operador salvar, e cada campo
   * continua editável depois.
   */
  function aplicarSugestaoDosTitulos() {
    setEditedPagamentos((prev) =>
      prev.map((editado) => {
        const original = pagamentos.find((pg) => pg.id === editado.id);
        const titulo = tituloDaParcela(original?.numero_parcela);
        if (!titulo) return editado;
        return { ...editado, data_vencimento: titulo.vencimento, valor: titulo.valor };
      })
    );
    setSugestaoAplicada(true);
  }

  /** Volta as parcelas ao que está gravado no banco. */
  function descartarSugestaoDosTitulos() {
    setEditedPagamentos(
      pagamentos.map((pg) => ({
        id: pg.id,
        forma_pagamento: pg.forma_pagamento,
        valor: pg.valor,
        data_vencimento: pg.data_vencimento
      }))
    );
    setSugestaoAplicada(false);
  }

  /** Quantas parcelas fiscais têm título correspondente para sugerir. */
  const parcelasComTitulo = pagamentos.filter((pg) => tituloDaParcela(pg.numero_parcela)).length;

  /**
   * Controles que espelham o modal Preparar Cobrança: parcela única com
   * vencimento escolhido e arredondamento. Os dois blocos do gerador na aba
   * renderizam o mesmo conjunto — daí a função, para não divergirem.
   */
  function renderControlesFormatoModal() {
    return (
      <div className="space-y-3">
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="pgto-parcela-unica"
              checked={pgtoParcelaUnica}
              onChange={(e) => setPgtoParcelaUnica(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="pgto-parcela-unica" className="text-xs font-semibold text-slate-700 cursor-pointer select-none">
              Parcela única com vencimento específico
              <span className="block text-[10px] font-normal text-slate-400">
                Gera 1 parcela com o valor total da nota no vencimento escolhido.
              </span>
            </label>
          </div>
          {pgtoParcelaUnica && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Vencimento da parcela única</label>
              <input
                type="date"
                value={pgtoVencimentoUnico}
                onChange={(e) => setPgtoVencimentoUnico(e.target.value)}
                className="w-full md:w-48 rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a] font-mono"
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="pgto-arredondar"
            checked={pgtoArredondar}
            disabled={pgtoParcelaUnica}
            onChange={(e) => setPgtoArredondar(e.target.checked)}
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-40"
          />
          <label htmlFor="pgto-arredondar" className="text-xs font-semibold text-slate-700 cursor-pointer select-none">
            Arredondar valores das parcelas
            <span className="block text-[10px] font-normal text-slate-400">
              Diferença ajustada na última parcela; o total da nota é preservado.
            </span>
          </label>
        </div>
        <p className="text-[10px] text-slate-400">
          A contagem de dias parte de hoje.
        </p>
      </div>
    );
  }

  /**
   * Painel de sugestão a partir dos títulos já lançados, mais o aviso de
   * divergência de totais. Renderizado nos dois ramos da aba.
   */
  function renderSugestaoTitulos() {
    if (!temTitulosAtivos) return null;

    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-3 min-w-0">
              <FileText className="h-5 w-5 shrink-0 text-sky-600 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-sky-900">
                  Esta proposta já tem {boletosAtivos.length} {boletosAtivos.length === 1 ? "título lançado" : "títulos lançados"} no contas a receber
                </p>
                <p className="text-xs text-sky-800 mt-1 leading-relaxed">
                  Total de {formatCurrency(totalTitulosAtivos)}
                  {boletosAtivos.length > 0 && (
                    <>
                      {" — "}
                      {boletosAtivos
                        .map((titulo) => `parcela ${titulo.parcela}: ${formatCurrency(titulo.valor)} em ${vencimentoBr(titulo.vencimento)}`)
                        .join(" · ")}
                    </>
                  )}
                  . O cliente já recebeu essas datas.
                </p>
                {sugestaoAplicada && (
                  <p className="text-xs font-semibold text-sky-900 mt-2">
                    Aplicado: as parcelas abaixo estão com os valores e vencimentos dos títulos. Ainda dá para editar antes de salvar.
                  </p>
                )}
              </div>
            </div>
            {!isReadOnly && (
              <div className="flex shrink-0 gap-2">
                {sugestaoAplicada ? (
                  <button
                    type="button"
                    onClick={descartarSugestaoDosTitulos}
                    className="rounded-xl border border-sky-300 bg-white px-4 py-2 text-xs font-semibold text-sky-800 hover:bg-sky-100 transition"
                  >
                    Descartar sugestão
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={aplicarSugestaoDosTitulos}
                    disabled={parcelasComTitulo === 0}
                    title={
                      parcelasComTitulo === 0
                        ? "Nenhuma parcela fiscal tem título correspondente. Gere as parcelas primeiro."
                        : undefined
                    }
                    className="rounded-xl bg-sky-700 hover:bg-sky-800 px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Usar datas e valores dos títulos
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {divergenciaTitulos !== null && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-amber-900">
                  As parcelas da nota não batem com os títulos já lançados
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs mt-2">
                  <div>
                    <span className="block text-amber-600 uppercase tracking-wider text-[10px] font-bold">Parcelas desta NF-e</span>
                    <strong className="block font-mono text-amber-900 text-sm">{formatCurrency(sumOfPayments)}</strong>
                  </div>
                  <div>
                    <span className="block text-amber-600 uppercase tracking-wider text-[10px] font-bold">Títulos já lançados</span>
                    <strong className="block font-mono text-amber-900 text-sm">{formatCurrency(totalTitulosAtivos)}</strong>
                  </div>
                  <div>
                    <span className="block text-amber-600 uppercase tracking-wider text-[10px] font-bold">Diferença</span>
                    <strong className="block font-mono text-amber-900 text-sm">{formatCurrency(Math.abs(divergenciaTitulos))}</strong>
                  </div>
                </div>
                <p className="text-xs text-amber-800 mt-2 leading-relaxed">
                  É só um aviso — dá para salvar assim mesmo. Confira se a diferença é esperada
                  antes de transmitir a nota.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /*
    Conferência antecipada: a MESMA lista que `fn_alertas_nfe` e as views de
    validação aplicam ao preparar o envio, calculada aqui para o operador ver
    antes de clicar. O servidor continua bloqueando do mesmo jeito — isto não
    substitui trava nenhuma.

    Os totais de cabeçalho (valor_produtos, valor_total_nf) entram como estão
    GRAVADOS, e não recalculados na tela: é o que o banco vai conferir. Enquanto
    houver edição não salva, a divergência aparece — e o texto da pendência pede
    para salvar.
  */
  const pendencias: Pendencia[] = note
    ? levantarPendencias({
        nota: {
          ref: note.ref,
          id_int: note.id_int,
          id_cliente: note.id_cliente,
          status: note.status,
          natureza_operacao: naturezaOperacao,
          tipo_documento: note.tipo_documento,
          finalidade_emissao: finalidadeEmissao,
          consumidor_final: consumidorFinal,
          presenca_comprador: presencaComprador,
          tipo_contribuinte: tipoContribuinte,
          modalidade_frete: modalidadeFrete,
          valor_produtos: note.valor_produtos,
          valor_frete: valorFrete,
          valor_total_nf: note.valor_total_nf,
          peso_liquido: pesoLiquido,
          informacoes_complementares: infoComplementares,
          created_at: note.created_at,
          naturezaSemTributacaoPadrao
        },
        /*
          A conferência precisa do item INTEIRO. `editedItems` só carrega o que
          a aba Itens deixa editar — sem unidade tributável, origem do ICMS e os
          CSTs de ICMS/PIS/COFINS. Alimentar o módulo só com ele fazia cada item
          nascer com cinco pendências falsas e travava o Emitir em toda nota.
          Por isso a linha do banco entra por baixo e a edição por cima.
        */
        itens: items.map((original) => ({
          ...original,
          ...(editedItems.find((editado) => editado.id === original.id) ?? {})
        })),
        pagamentos: pagamentos.map((original) => ({
          ...original,
          ...(editedPagamentos.find((editado) => editado.id === original.id) ?? {})
        })),
        cliente: cliente ? { ...cliente, id_cliente: note.id_cliente } : null,
        enderecoPrincipal: principalEndereco
      })
    : [];
  const pendenciasImpeditivas = pendenciasQueImpedem(pendencias);
  const emissaoBloqueada = pendenciasImpeditivas.length > 0;

  /* ---------------- Estado dos blocos da conferência ---------------- */

  function estadoDoBloco(bloco: BlocoNfe): EstadoBloco {
    const doBloco = pendencias.filter((pendencia) => pendencia.bloco === bloco);
    if (doBloco.some((pendencia) => pendencia.severidade === "impede")) return "impede";
    if (doBloco.length > 0) return "aviso";
    return "ok";
  }

  /** Informação curta na lateral: o que o operador confere de relance. */
  function detalheDoBloco(bloco: BlocoNfe): string | undefined {
    const impeditivas = pendencias.filter(
      (pendencia) => pendencia.bloco === bloco && pendencia.severidade === "impede"
    ).length;
    if (impeditivas > 0) return impeditivas === 1 ? "1 pendência" : `${impeditivas} pendências`;

    switch (bloco) {
      case "Emitente":
        return note ? getEmpresaName(note.id_empresa) : undefined;
      case "Itens":
        return `${items.length} ${items.length === 1 ? "item" : "itens"}`;
      case "Transporte/Frete":
        return formatCurrency(valorFrete || 0);
      case "Pagamentos":
        return pagamentos.length > 0 ? `${pagamentos.length}x` : "sem parcelas";
      case "Totais":
        return formatCurrency(computedValorTotalNf);
      default:
        return undefined;
    }
  }

  /** Resumo do cabeçalho, visível enquanto o bloco está recolhido. */
  function resumoDoBloco(bloco: BlocoNfe): string | undefined {
    switch (bloco) {
      case "Resumo":
        return note ? `${getEmpresaName(note.id_empresa)} • modelo ${note.modelo}` : undefined;
      case "Emitente":
        return note ? getEmpresaName(note.id_empresa) : undefined;
      case "Destinatário":
        return cliente?.nome || undefined;
      case "Itens":
        return `${items.length} ${items.length === 1 ? "item" : "itens"} • ${formatCurrency(computedValorProdutos)}`;
      case "Transporte/Frete":
        return `frete ${formatCurrency(valorFrete || 0)}`;
      case "Pagamentos":
        return `${pagamentos.length} ${pagamentos.length === 1 ? "parcela" : "parcelas"} • ${formatCurrency(sumOfPayments)}`;
      case "Totais":
        return formatCurrency(computedValorTotalNf);
      case "Informações adicionais":
        return infoComplementares ? "preenchido" : "nada informado";
      case "Validação":
        return emissaoBloqueada ? "com pendências" : "sem erros bloqueantes";
      default:
        return undefined;
    }
  }

  /**
   * Recolhido por padrão só o que está OK e não é de uso diário. Bloco com
   * pendência (mesmo que só aviso) nasce aberto, e a escolha manual do operador
   * vence as duas regras enquanto ele estiver na tela.
   */
  function blocoAberto(bloco: BlocoNfe): boolean {
    const escolhaDoOperador = blocosAbertos[bloco];
    if (escolhaDoOperador !== undefined) return escolhaDoOperador;
    if (BLOCOS_SEMPRE_ABERTOS.includes(bloco)) return true;
    if (bloco === activeTab) return true;
    return estadoDoBloco(bloco) !== "ok";
  }

  function alternarBloco(bloco: BlocoNfe) {
    const abertoAgora = blocoAberto(bloco);
    setBlocosAbertos((anterior) => ({ ...anterior, [bloco]: !abertoAgora }));
    if (!abertoAgora) setActiveTab(bloco);
  }

  /** Clique na lateral: abre o bloco e rola até ele. */
  function irParaBloco(bloco: BlocoNfe) {
    setActiveTab(bloco);
    setBlocosAbertos((anterior) => ({ ...anterior, [bloco]: true }));
    window.setTimeout(() => {
      document.getElementById(ancoraDoBloco(bloco))?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }, 60);
  }

  const filteredProducts = dbProducts.filter((p) => {
    if (!productSearchText.trim()) return true;
    const query = productSearchText.toLowerCase();
    const idStr = String(p.id_produto).toLowerCase();
    const nameStr = (p.nomeReal || "").toLowerCase();
    const ncmStr = (p.ncm || "").toLowerCase();
    const unStr = (p.unidade_comercial || p.und_medida || "").toLowerCase();
    return (
      idStr.includes(query) ||
      nameStr.includes(query) ||
      ncmStr.includes(query) ||
      unStr.includes(query)
    );
  });

  // Save changes
  async function handleSave(): Promise<boolean> {
    if (!note) return false;
    if (isReadOnly) {
      showToast({ type: "warning", title: "Não é possível salvar alterações em notas somente leitura." });
      return false;
    }

    // Vencimento vazio é recusado AQUI, e não pelo banco.
    //
    // O input de vencimento é um `type="date"`: limpá-lo grava string vazia no
    // estado, que segue para `updateNfeDraft` e chega ao Postgres. Lá a coluna
    // `notas_fiscais_pagamentos.data_vencimento` é `date NOT NULL`, então a
    // escrita é recusada e o `throw` sobe cru — o usuário via a mensagem técnica
    // do banco ("invalid input syntax for type date") em vez de saber que faltou
    // preencher uma data.
    //
    // A checagem mora em `handleSave` porque ele é o único ponto por onde as
    // parcelas editadas passam: o botão Salvar chama daqui, e Concluir chama
    // `handleSave` antes de validar. Uma trava só cobre os dois caminhos.
    //
    // A regra do banco continua valendo e NÃO foi afrouxada: isto apenas troca
    // quem dá a notícia, e em que língua.
    const semVencimento = editedPagamentos.filter(
      (pg) => !String(pg.data_vencimento ?? "").trim()
    ).length;

    if (semVencimento > 0) {
      showToast({
        type: "error",
        title:
          semVencimento === 1
            ? "Informe o vencimento do pagamento antes de salvar."
            : `Informe o vencimento das ${semVencimento} parcelas sem data antes de salvar.`
      });
      return false;
    }

    let hasSignificantChanges = false;
    for (const orig of items) {
      const edited = editedItems.find(it => it.id === orig.id);
      if (edited) {
        const qty = edited.quantidade !== undefined ? Number(edited.quantidade) : orig.quantidade;
        const price = edited.valor_unitario !== undefined ? Number(edited.valor_unitario) : orig.valor_unitario;
        const valBruto = edited.valor_bruto !== undefined ? Number(edited.valor_bruto) : (qty * price);
        if (qty !== orig.quantidade || price !== orig.valor_unitario || valBruto !== orig.valor_bruto) {
          hasSignificantChanges = true;
          break;
        }
      }
    }

    if (note && Number(valorFrete) !== (note.valor_frete || 0)) {
      hasSignificantChanges = true;
    }

    const confirmed = await confirmActionWithPaymentCheck(hasSignificantChanges);
    if (!confirmed) return false;

    setIsSaving(true);
    try {
      const addressObj = {
        cep: deliveryCep,
        logradouro: deliveryLogradouro,
        numero: deliveryNumero,
        complemento: deliveryComplemento,
        bairro: deliveryBairro,
        cidade: deliveryCidade,
        uf: deliveryUf,
      };

      const hasDeliveryAddress = useDeliveryAddress && Boolean(deliveryCep && deliveryLogradouro);

      const headerUpdates: Partial<SupabaseNfeRow> = {
        ref: note.ref, // necessary to trigger recalculate
        natureza_operacao: naturezaOperacao,
        drop_natureza_op: dropNaturezaOp,
        finalidade_emissao: finalidadeEmissao,
        consumidor_final: consumidorFinal,
        presenca_comprador: presencaComprador,
        tipo_contribuinte: tipoContribuinte,
        modalidade_frete: modalidadeFrete,
        transportadora,
        id_transportadora_cliente: idTransportadoraCliente,
        valor_frete: Number(valorFrete),
        quantidade_volumes: Number(quantidadeVolumes),
        especie_volumes: especieVolumes,
        peso_liquido: Number(pesoLiquido),
        peso_bruto: Number(pesoBruto),
        informacoes_complementares: infoComplementares,
        observacoes_internas: obsInternas,
        end_entrega: hasDeliveryAddress,
        endereco_entrega_observacao: hasDeliveryAddress ? JSON.stringify(addressObj) : null
      };

      const itemsPayload = editedItems.map(it => {
        const orig = items.find(origIt => origIt.id === it.id);
        const qty = it.quantidade !== undefined ? Number(it.quantidade) : (orig?.quantidade || 0);
        const price = it.valor_unitario !== undefined ? Number(it.valor_unitario) : (orig?.valor_unitario || 0);
        const pesoUnit = it.peso_unitario_gramas !== undefined ? Number(it.peso_unitario_gramas) : (orig?.peso_unitario_gramas || 0);
        // `cfop` sai do payload do item: quem grava e o passo 2b de
        // `updateNfeDraft`, uma vez so para a nota inteira.
        const { cfop: _cfopIgnorado, ...semCfop } = it;
        void _cfopIgnorado;
        return {
          ...semCfop,
          valor_bruto: qty * price,
          quantidade_tributavel: qty,
          valor_unitario_tributavel: price,
          peso_unitario_gramas: pesoUnit,
          peso_total_gramas: qty * pesoUnit
        };
      });

      const res = await updateNfeDraft(
        note.id,
        headerUpdates,
        itemsPayload,
        editedPagamentos,
        cfopDerivado
      );
      if (res.success) {
        showToast({ type: "success", title: "Rascunho salvo com sucesso!" });

        // Se for à vista, lê o total da nota atualizado e recria o pagamento
        if (pgtoFormaPagamento !== "15") {
          const dbNote = await getNfeById(note.id);
          if (dbNote) {
            await recreateSinglePayment(note.id, note.ref, note.id_int, dbNote.valor_total_nf, pgtoFormaPagamento);
          }
        }

        // Reload updated values and run validation check
        await loadData(true);
        return true;
      } else {
        showToast({ type: "error", title: res.error || "Erro ao salvar alterações." });
        return false;
      }
    } catch (err) {
      console.error("[NfeDetail] Save error:", err);
      showToast({ type: "error", title: "Erro ao salvar alterações." });
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTrocarEmpresa(idEmpresa: number) {
    if (!note) return;
    if (isReadOnly) {
      showToast({ type: "warning", title: "Não é possível alterar a empresa em notas somente leitura." });
      return;
    }
    setIsSaving(true);
    try {
      showToast({ type: "info", title: "Alterando empresa emitente..." });
      const user = note.criado_por_nome || "Operador Fiscal";
      const res = await trocarEmpresaNfe(note.ref, idEmpresa, user);
      if (res && res.ok) {
        showToast({ type: "success", title: "Empresa emitente alterada com sucesso!" });
        await loadData();
      } else {
        showToast({ type: "error", title: res?.mensagem || "Falha ao trocar empresa emitente." });
      }
    } catch (err) {
      console.error("[NfeDetail] Trocar empresa error:", err);
      const msg = err instanceof Error ? err.message : "Não foi possível trocar a empresa da nota.";
      showToast({ type: "error", title: msg });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAddItem() {
    if (!note) return;
    if (isReadOnly) {
      showToast({ type: "warning", title: "Não é possível adicionar itens em notas somente leitura." });
      return;
    }
    if (!newItemDesc.trim()) {
      showToast({ type: "warning", title: "Descrição do item é obrigatória." });
      return;
    }

    const proceed = async () => {
      setIsAddingItem(true);
      try {
        // CFOP DA NOTA, nao do item. Nao ha mais campo para digitar: o item
        // novo entra com o mesmo CFOP dos demais, por construcao.
        //
        // Ordem: a natureza manda; sem natureza reconhecida, acompanha os itens
        // que ja estao na nota -- que sao uniformes -- para nao ser o unico
        // fora do lugar; so entao cai no calculo por UF.
        const cfopDefault =
          cfopDerivado ||
          items[0]?.cfop ||
          (destinoFiscal && ufEmitente ? cfopDeVenda(destinoFiscal.uf, ufEmitente) : "");
        const nextItemNum = items.length + 1;
        const qty = Number(newItemQty) || 1;
        const price = Number(newItemPrice) || 0;
        const peso = Number(newItemPeso) || 0;
        const valorBruto = qty * price;

        const itemPayload = {
          id_nota_fiscal: note.id,
          ref: note.ref,
          id_int: note.id_int,
          id_produtos_proposta: null,
          id_produto: selectedProductId || 0,
          numero_item: nextItemNum,
          codigo_produto: newItemCodigo || "MANUAL",
          descricao: newItemDesc,
          ncm: newItemNcm,
          cfop: cfopDefault,
          unidade_comercial: newItemUn,
          unidade_tributavel: newItemUn,
          quantidade: qty,
          valor_unitario: price,
          valor_bruto: valorBruto,
          quantidade_tributavel: qty,
          valor_unitario_tributavel: price,
          // Tributacao da natureza da nota, nao mais literal. Sem natureza
          // reconhecida, acompanha os itens que ja estao la -- mesma ordem de
          // precedencia do CFOP, e pelo mesmo motivo: o item novo nao pode ser
          // o unico fora do lugar. `icms_origem` segue fixo no codigo.
          icms_origem: 0,
          icms_situacao_tributaria:
            tributacaoDerivada?.icms_situacao_tributaria ??
            items[0]?.icms_situacao_tributaria ??
            null,
          pis_situacao_tributaria:
            tributacaoDerivada?.pis_situacao_tributaria ??
            items[0]?.pis_situacao_tributaria ??
            null,
          cofins_situacao_tributaria:
            tributacaoDerivada?.cofins_situacao_tributaria ??
            items[0]?.cofins_situacao_tributaria ??
            null,
          ativo: true,
          peso_unitario_gramas: peso,
          peso_total_gramas: qty * peso,
          observacao: newItemObs,
          origem_item: null
        };

        const res = await insertNfeItem(itemPayload);
        if (res) {
          showToast({ type: "success", title: "Item fiscal adicionado com sucesso!" });
          await recalcularTotaisNfe(note.ref);

          // Se for à vista, lê o total da nota atualizado e recria o pagamento
          if (pgtoFormaPagamento !== "15") {
            const dbNote = await getNfeById(note.id);
            if (dbNote) {
              await recreateSinglePayment(note.id, note.ref, note.id_int, dbNote.valor_total_nf, pgtoFormaPagamento);
            }
          }

          // Reset inputs
          setNewItemDesc("");
          setNewItemPrice(0);
          setNewItemQty(1);
          setNewItemPeso(0);
          setNewItemObs("");
          setSelectedProductId(null);
          setNewItemCodigo("MANUAL");
          await loadData(true);
        } else {
          showToast({ type: "error", title: "Falha ao inserir item fiscal." });
        }
      } catch (err) {
        console.error("[NfeDetail] Add item error:", err);
        showToast({ type: "error", title: "Erro ao adicionar item fiscal." });
      } finally {
        setIsAddingItem(false);
      }
    };

    const confirmed = await confirmActionWithPaymentCheck(true);
    if (confirmed) {
      await proceed();
    }
  }

  async function handleDeleteItem(itemId: string) {
    if (!note) return;
    if (isReadOnly) {
      showToast({ type: "warning", title: "Não é possível excluir itens em notas somente leitura." });
      return;
    }

    const proceedDelete = async () => {
      try {
        showToast({ type: "info", title: "Removendo item fiscal..." });
        const ok = await deleteNfeItem(itemId);
        if (ok) {
          showToast({ type: "success", title: "Item fiscal removido com sucesso!" });
          await recalcularTotaisNfe(note.ref);

          // Se for à vista, lê o total da nota atualizado no banco e recria o pagamento
          if (pgtoFormaPagamento !== "15") {
            const dbNote = await getNfeById(note.id);
            if (dbNote) {
              await recreateSinglePayment(note.id, note.ref, note.id_int, dbNote.valor_total_nf, pgtoFormaPagamento);
            }
          }

          await loadData(true);
        } else {
          showToast({ type: "error", title: "Falha ao remover item fiscal do banco." });
        }
      } catch (err) {
        console.error("[NfeDetail] Delete item error:", err);
        showToast({ type: "error", title: "Erro ao remover item fiscal." });
      }
    };

    if (pagamentos.length > 0 && pgtoFormaPagamento === "15") {
      setConfirmModal({
        isOpen: true,
        title: "Remover Item e Invalidar Pagamentos",
        message: "Tem certeza que deseja remover este item fiscal? Alterar os itens da nota fiscal invalida os pagamentos atuais. Os pagamentos fiscais serão recriados para manter consistência com o total da nota.",
        onConfirm: async () => {
          await invalidateNfePayments(note.id);
          setPaymentsInvalidated(true);
          setPagamentos([]);
          setEditedPagamentos([]);
          await proceedDelete();
        }
      });
    } else {
      setConfirmModal({
        isOpen: true,
        title: "Confirmar Remoção",
        message: "Tem certeza que deseja remover este item fiscal do rascunho?",
        onConfirm: async () => {
          await proceedDelete();
        }
      });
    }
  }

  async function handleSaveItem(itemId: string) {
    if (!note) return;
    if (isReadOnly) {
      showToast({ type: "warning", title: "Não é possível alterar itens em notas somente leitura." });
      return;
    }
    const edited = editedItems.find(it => it.id === itemId);
    if (!edited) return;

    const orig = items.find(origIt => origIt.id === itemId);
    if (!orig) return;

    const qty = edited.quantidade !== undefined ? Number(edited.quantidade) : orig.quantidade;
    const price = edited.valor_unitario !== undefined ? Number(edited.valor_unitario) : orig.valor_unitario;
    const valBruto = edited.valor_bruto !== undefined ? Number(edited.valor_bruto) : (qty * price);

    const hasSignificantChanges = qty !== orig.quantidade || price !== orig.valor_unitario || valBruto !== orig.valor_bruto;

    const proceedSave = async () => {
      setIsSaving(true);
      try {
        showToast({ type: "info", title: "Salvando item..." });
        const pesoTotal = edited.peso_total_gramas !== undefined ? Number(edited.peso_total_gramas) : (qty * (orig.peso_unitario_gramas || 0));
        const pesoUnit = qty > 0 ? (pesoTotal / qty) : 0;

        const itemUpdates = {
          descricao: edited.descricao || "",
          unidade_comercial: edited.unidade_comercial || "UN",
          unidade_tributavel: edited.unidade_comercial || "UN",
          quantidade: qty,
          valor_unitario: price,
          valor_bruto: valBruto,
          quantidade_tributavel: qty,
          valor_unitario_tributavel: price,
          ncm: edited.ncm || "49119900",
          // CFOP nao entra aqui: e da nota, escrito de uma vez em
          // `updateNfeDraft`. Salvar um item nao pode mover o CFOP dele
          // sozinho -- era por aqui que dois itens da mesma nota divergiam.
          //
          // A TRIBUTACAO ENTRA, e a assimetria e proposital: o CFOP e unico por
          // nota, a tributacao e por item e editavel. Sao regras diferentes
          // para campos diferentes.
          //
          // `?? ""` e nao `|| padrao`: vazio aqui e um estado legitimo -- e o
          // que a devolucao de saida guarda ate o usuario decidir -- e a
          // pendencia e quem barra a emissao.
          icms_situacao_tributaria: edited.icms_situacao_tributaria ?? orig.icms_situacao_tributaria ?? "",
          pis_situacao_tributaria: edited.pis_situacao_tributaria ?? orig.pis_situacao_tributaria ?? "",
          cofins_situacao_tributaria:
            edited.cofins_situacao_tributaria ?? orig.cofins_situacao_tributaria ?? "",
          peso_unitario_gramas: pesoUnit,
          peso_total_gramas: pesoTotal
        };

        const res = await updateNfeItem(itemId, note.ref, itemUpdates);
        if (res.success) {
          showToast({ type: "success", title: "Item salvo com sucesso!" });

          // Se for à vista, lê o total da nota atualizado e recria o pagamento
          if (pgtoFormaPagamento !== "15") {
            const dbNote = await getNfeById(note.id);
            if (dbNote) {
              await recreateSinglePayment(note.id, note.ref, note.id_int, dbNote.valor_total_nf, pgtoFormaPagamento);
            }
          }

          await loadData(true);
        } else {
          showToast({ type: "error", title: res.error || "Falha ao salvar item fiscal." });
        }
      } catch (err) {
        console.error("[NfeDetail] Save item error:", err);
        showToast({ type: "error", title: "Erro ao salvar item fiscal." });
      } finally {
        setIsSaving(false);
      }
    };

    const confirmed = await confirmActionWithPaymentCheck(hasSignificantChanges);
    if (confirmed) {
      await proceedSave();
    }
  }

  async function handleFormaPagamentoChange(newForma: string) {
    if (!note) return;
    if (isReadOnly) {
      showToast({ type: "warning", title: "Não é possível alterar a forma de pagamento em notas somente leitura." });
      return;
    }
    
    const changePaymentMethod = async () => {
      setIsGeneratingPgto(true);
      try {
        showToast({ type: "info", title: "Atualizando forma de pagamento..." });
        const res = await recreateSinglePayment(
          note.id,
          note.ref,
          note.id_int,
          computedValorTotalNf,
          newForma
        );
        if (res.success) {
          await updateNfeDraft(note.id, { ref: note.ref, forma_pgto: newForma, pgto_is_configurado: true }, [], []);
          showToast({ type: "success", title: "Forma de pagamento atualizada com sucesso!" });
          setPaymentsInvalidated(false);
          await loadData(true);
        } else {
          showToast({ type: "error", title: res.error || "Erro ao recriar parcelas." });
        }
      } catch (err) {
        console.error("[NfeDetail] recreateSinglePayment error:", err);
        showToast({ type: "error", title: "Erro ao atualizar pagamentos." });
      } finally {
        setIsGeneratingPgto(false);
      }
    };

    if (newForma !== "15") {
      if (pagamentos.length > 0) {
        const temVariosVencimentos = pagamentos.length > 1 || pagamentos[0]?.forma_pagamento !== newForma;
        if (temVariosVencimentos) {
          setConfirmModal({
            isOpen: true,
            title: "Alterar Forma de Pagamento",
            message: "As parcelas antigas geradas para esta Nota Fiscal serão substituídas por um pagamento único à vista. Deseja continuar?",
            onConfirm: async () => {
              await changePaymentMethod();
            }
          });
          return;
        } else {
          try {
            await updateNfeDraft(note.id, { ref: note.ref, forma_pgto: newForma, pgto_is_configurado: true }, [], []);
            await loadData(true);
          } catch (err) {
            console.error(err);
          }
        }
      } else {
        // Nova NF ou sem pagamentos: gera o pagamento único à vista automaticamente sem confirmação
        await changePaymentMethod();
      }
    } else {
      try {
        await updateNfeDraft(note.id, { ref: note.ref, forma_pgto: newForma }, [], []);
        await loadData(true);
      } catch (err) {
        console.error(err);
      }
    }
    
    setPgtoFormaPagamento(newForma);
  }

  async function handleGerarPagamentos() {
    if (!note) return;
    if (isReadOnly) {
      showToast({ type: "warning", title: "Não é possível gerar pagamentos em notas somente leitura." });
      return;
    }
    if (computedValorTotalNf <= 0) {
      showToast({ type: "warning", title: "Valor total da NF-e está zerado. Adicione itens primeiro." });
      return;
    }
    if (pgtoParcelaUnica && !pgtoVencimentoUnico) {
      showToast({ type: "warning", title: "Selecione a data de vencimento da parcela única." });
      return;
    }
    setIsGeneratingPgto(true);
    try {
      showToast({ type: "info", title: "Gerando parcelas fiscais..." });
      // Gerar substitui as parcelas: qualquer sugestão aplicada e ainda não
      // gravada deixa de valer a partir daqui.
      setSugestaoAplicada(false);
      const res = await gerarPagamentosNfe(
        note.ref,
        Number(pgtoValorEntrada),
        Number(pgtoQtdParcelas),
        Number(pgtoDiasPraInicio),
        Number(pgtoIntervalo),
        pgtoFormaPagamento,
        {
          vencimentoUnico: pgtoParcelaUnica ? pgtoVencimentoUnico : null,
          arredondar: pgtoArredondar
        }
      );
      if (res && res.ok) {
        showToast({ type: "success", title: "Parcelas fiscais geradas com sucesso!" });
        setPaymentsInvalidated(false);
        try {
          await updateNfeDraft(note.id, { ref: note.ref, pgto_is_configurado: true }, [], []);
        } catch (err) {
          console.warn("Failed to update pgto_is_configurado:", err);
        }
        await loadData(true);
        
        try {
          const dbPayments = await getNfePagamentos(noteId);
          const sum = dbPayments.reduce((acc, curr) => acc + (Number(curr.valor) || 0), 0);
          if (Math.abs(sum - computedValorTotalNf) > 0.01) {
            showToast({
              type: "warning",
              title: `Aviso: A soma das parcelas (R$ ${sum.toFixed(2)}) difere do total da nota (R$ ${computedValorTotalNf.toFixed(2)}).`
            });
          }
        } catch (err) {
          console.error("Error verifying payment totals:", err);
        }
      } else {
        showToast({ type: "error", title: res.mensagem || "Erro ao gerar parcelas fiscais." });
      }
    } catch (err) {
      console.error("[NfeDetail] Gerar pagamentos error:", err);
      const msg = err instanceof Error ? err.message : "Erro ao gerar parcelas fiscais.";
      showToast({ type: "error", title: msg });
    } finally {
      setIsGeneratingPgto(false);
    }
  }

  // Execute DB validation RPC without saving automatically
  // Save, run final checks, confirm and mark as ready to send
  /**
   * Grava o payload de envio e deixa a nota em PRONTA_PARA_ENVIO.
   *
   * É reversível — "Editar última hora" traz a nota de volta a rascunho —, então
   * não pede confirmação por si. Devolve a nota relida do banco em caso de
   * sucesso, ou null quando algo falhou (aí a mensagem real já foi ao operador).
   */
  async function prepararParaEnvio(): Promise<SupabaseNfeRow | null> {
    if (!note) return null;
    setIsSaving(true);
    try {
      const resEmit = await prepararEnvioNfe(note.ref);
      if (!resEmit || !resEmit.ok) {
        showToast({ type: "error", title: resEmit?.mensagem || "Falha ao preparar envio da nota." });
        return null;
      }

      const resUpdate = await updateNfeDraft(note.id, { status: "PRONTA_PARA_ENVIO" }, [], []);
      if (!resUpdate.success) {
        showToast({ type: "error", title: resUpdate.error || "Falha ao salvar status final da nota." });
        return null;
      }

      await loadData(true);
      return await getNfeById(note.id);
    } catch (err) {
      console.error("[NfeDetail] Falha ao preparar envio:", err);
      showToast({ type: "error", title: "Erro ao concluir rascunho." });
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * @param emitirDepois quando true, encadeia preparo e emissão: o modal de
   *   conclusão (que confirmava um ato reversível) some e a única confirmação
   *   passa a ser a da emissão, dentro do EmissaoNfeModal. A revisão do
   *   rascunho e a validação continuam obrigatórias nos dois caminhos.
   */
  async function handleConcludeDraft(emitirDepois = false) {
    if (!note) return;
    if (isReadOnly) {
      showToast({ type: "warning", title: "Não é possível concluir notas somente leitura." });
      return;
    }

    const emissionDateOnly = note.created_at ? note.created_at.split("T")[0] : new Date().toISOString().split("T")[0];
    const hasInvalidVencimento = editedPagamentos.some(pg => {
      if (!pg.data_vencimento) return false;
      const vencDateOnly = pg.data_vencimento.split("T")[0];
      return vencDateOnly < emissionDateOnly;
    });

    if (hasInvalidVencimento) {
      showToast({
        type: "error",
        title: "Existe parcela com vencimento anterior à data de emissão. Corrija os pagamentos antes de enviar."
      });
      return;
    }
    
    // 1. Salvar alterações da NF antes de validar
    showToast({ type: "info", title: "Salvando alterações antes de concluir..." });
    const saved = await handleSave();
    if (!saved) {
      showToast({ type: "warning", title: "Não foi possível concluir. Corrija os erros ao salvar." });
      return;
    }

    setIsValidating(true);
    try {
      showToast({ type: "info", title: "Executando validação final de consistência..." });
      
      // Validação de leitura sem alterar status no banco
      const resVal = await getAlertasNfe(note.ref);
      
      const alerts = resVal?.alertas || [];
      const messages = Array.isArray(alerts)
        ? alerts.map((a: { mensagem?: string; message?: string } | string) => typeof a === "string" ? a : (a.mensagem || a.message || JSON.stringify(a)))
        : [];
      
      const hasBlockingErrors = resVal?.tem_erros === true || resVal?.pode_emitir_tecnico === false;
      
      setValidationData(prev => ({
        ...prev,
        pode_emitir: !hasBlockingErrors,
        pendencias_texto: messages
      }));

      if (hasBlockingErrors) {
        setConfirmModal({
          isOpen: true,
          title: "Inconsistências Fiscais Identificadas",
          message: "O rascunho possui pendências que impedem sua conclusão. Por favor, revise as regras fiscais na aba 'Validação'.",
          confirmText: "Visualizar Pendências",
          showCancel: false,
          onConfirm: () => {
            irParaBloco("Validação");
          }
        });
      } else if (emitirDepois) {
        // Sem modal de conclusão aqui: quem confirma é a emissão, logo abaixo.
        const preparada = await prepararParaEnvio();
        if (preparada) setNotaParaEmitir(mapSupabaseNfeRowToReadModel(preparada));
      } else {
        setConfirmModal({
          isOpen: true,
          title: "Concluir Rascunho Fiscal",
          message: `Deseja marcar esta nota fiscal como 'Pronta para Envio'? Isso concluirá a etapa de rascunho e a disponibilizará para faturamento e emissão definitiva.`,
          confirmText: "Confirmar Conclusão",
          cancelText: "Cancelar",
          showCancel: true,
          onConfirm: async () => {
            const preparada = await prepararParaEnvio();
            if (!preparada) return;
            showToast({ type: "success", title: "Rascunho concluído. NF-e pronta para envio." });
            setTimeout(() => {
              router.push("/notas-fiscais");
            }, 1500);
          }
        });
      }
    } catch (err) {
      console.error("[NfeDetail] Conclude failed:", err);
      showToast({ type: "error", title: "Erro na validação final." });
    } finally {
      setIsValidating(false);
    }
  }

  // Load technical payload from RPC
  async function handleLoadPayload() {
    if (!note) return;
    setIsPayloadLoading(true);
    try {
      const payload = await montarPayloadNfe(note.ref);
      setFocusPayload(payload);
      setIsPayloadOpen(true);
    } catch (err) {
      console.error("[NfeDetail] Payload generation failed:", err);
      const msg = err instanceof Error ? err.message : "Não foi possível gerar o arquivo técnico da nota.";
      showToast({ type: "error", title: msg });
    } finally {
      setIsPayloadLoading(false);
    }
  }

  // DANFE Preview (Edge Function)
  async function handleDanfePreview() {
    if (!note) return;

    setIsPreviewLoading(true);
    try {
      showToast({ type: "info", title: "Invocando Edge Function de visualização comercial..." });
      const res = await previewNfeRascunho(note.ref);

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
      console.error("[NfeDetail] Edge Function preview failed:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      showToast({ 
        type: "error", 
        title: "Não foi possível gerar o preview da DANFE.",
        description: errMsg
      });
    } finally {
      setIsPreviewLoading(false);
    }
  }

  /**
   * Recarrega cliente, endereço e nota do banco.
   *
   * POR QUE EXISTE
   *   IE e endereço do destinatário NÃO são copiados para `notas_fiscais` — o
   *   payload lê do cadastro na hora. A tela, não: `loadData` busca uma vez, na
   *   montagem, e não há listener de foco. Quem corrigia no cadastro e voltava
   *   ficava com a pendência velha na frente e o Emitir travado por ela.
   *
   *   `loadData` reescreve os campos editáveis com o que está no banco, então
   *   edição não salva se perde. Quando houver alguma, pergunta antes.
   */
  function handleReconferir() {
    if (!existeEdicaoNaoSalva()) {
      void loadData();
      return;
    }
    setConfirmModal({
      isOpen: true,
      title: "Reconferir descarta o que não foi salvo",
      message:
        "Esta tela tem alterações que ainda não foram salvas. Reconferir recarrega os dados do banco e do cadastro do cliente, e essas alterações se perdem.",
      confirmText: "Reconferir mesmo assim",
      cancelText: "Voltar e salvar antes",
      showCancel: true,
      onConfirm: () => {
        void loadData();
      }
    });
  }

  /** Compara o que está na tela com o que veio do banco na última carga. */
  function existeEdicaoNaoSalva(): boolean {
    if (!note) return false;

    const cabecalhoMudou =
      naturezaOperacao !== (note.natureza_operacao || "") ||
      dropNaturezaOp !== (note.drop_natureza_op || "") ||
      finalidadeEmissao !== note.finalidade_emissao ||
      consumidorFinal !== note.consumidor_final ||
      presencaComprador !== note.presenca_comprador ||
      tipoContribuinte !== note.tipo_contribuinte ||
      modalidadeFrete !== note.modalidade_frete ||
      transportadora !== (note.transportadora || "") ||
      Number(valorFrete) !== (note.valor_frete || 0) ||
      Number(quantidadeVolumes) !== (note.quantidade_volumes || 1) ||
      especieVolumes !== (note.especie_volumes || "") ||
      Number(pesoLiquido) !== (note.peso_liquido || 0) ||
      Number(pesoBruto) !== (note.peso_bruto || 0) ||
      infoComplementares !== (note.informacoes_complementares || "") ||
      obsInternas !== (note.observacoes_internas || "");
    if (cabecalhoMudou) return true;

    const itemMudou = editedItems.some((editado) => {
      const original = items.find((it) => it.id === editado.id);
      if (!original) return true;
      return (
        editado.descricao !== original.descricao ||
        editado.ncm !== original.ncm ||
        editado.cfop !== original.cfop ||
        editado.unidade_comercial !== original.unidade_comercial ||
        Number(editado.quantidade) !== original.quantidade ||
        Number(editado.valor_unitario) !== original.valor_unitario ||
        Number(editado.valor_bruto) !== original.valor_bruto ||
        (editado.observacao || "") !== (original.observacao || "")
      );
    });
    if (itemMudou) return true;

    return editedPagamentos.some((editado) => {
      const original = pagamentos.find((pg) => pg.id === editado.id);
      if (!original) return true;
      return (
        editado.forma_pagamento !== original.forma_pagamento ||
        Number(editado.valor) !== original.valor ||
        editado.data_vencimento !== original.data_vencimento
      );
    });
  }

  /**
   * Leva o operador ao lugar onde a pendência se conserta.
   *
   * Endereço e IE do destinatário não se corrigem nesta tela — abrem o cadastro
   * do cliente em outra aba. Natureza, finalidade, presença do comprador e
   * status não têm campo em lugar nenhum da tela: entram na lista sem link.
   */
  function irParaPendencia(pendencia: Pendencia) {
    if (pendencia.destino.tipo === "cadastro-cliente") {
      const idCliente = pendencia.destino.idCliente;
      if (idCliente) window.open(`/cadastros/${idCliente}/editar`, "_blank", "noopener");
      return;
    }
    if (pendencia.destino.tipo !== "aba") return;

    // Abre o bloco e leva até ele; o campo, quando existe, recebe o foco.
    irParaBloco(pendencia.destino.bloco);

    // Os três campos de tributação vivem num painel FECHADO por padrão — sem
    // isto, o elemento não existe no DOM e o foco abaixo não acha nada. Era o
    // que acontecia com ITEM_SEM_ICMS_CST e as duas irmãs antes deste painel:
    // a aba abria e a navegação morria ali.
    const campoAlvo = pendencia.destino.campo ?? "";
    if (
      pendencia.destino.idItem &&
      CAMPOS_TRIBUTACAO.some(({ id }) => campoAlvo.endsWith(id))
    ) {
      setItemTribAberto(pendencia.destino.idItem);
    }

    const campo = pendencia.destino.campo;
    if (!campo) return;
    // O conteúdo do bloco só existe no DOM depois do render seguinte.
    window.setTimeout(() => {
      const alvo = document.getElementById(campo);
      if (!alvo) return;
      alvo.scrollIntoView({ behavior: "smooth", block: "center" });
      if (
        alvo instanceof HTMLInputElement ||
        alvo instanceof HTMLSelectElement ||
        alvo instanceof HTMLTextAreaElement
      ) {
        alvo.focus();
      }
    }, 80);
  }

  // Helpers
  function getEmpresaName(id: number) {
    if (id === 1) return "INGRESSO IDEAL";
    if (id === 2) return "BIRÔ IDEAL";
    if (id === 3) return "E3 BRINDES";
    return `EMPRESA #${id}`;
  }

  if (isLoading) {
    return (
      <div className="flex h-96 w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#0b2f4a]" />
        <span className="ml-3 text-slate-600 font-semibold">Carregando rascunho fiscal...</span>
      </div>
    );
  }

  if (!note) return null;

  return (
    <main className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header da Nota */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border border-[#d7e5e8] bg-white p-6 rounded-3xl shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{note.ref}</h1>
            <StatusBadge status={getNfeDisplayStatus(note)} />
          </div>
          <p className="text-sm text-slate-500">
            Origem: Proposta/Pedido <strong>#{note.id_int}</strong> • Vendedor: {note.criado_por_nome || "-"}
            {" • "}
            <button
              type="button"
              onClick={handleDanfePreview}
              disabled={isPreviewLoading}
              className="inline-flex items-center gap-1 text-slate-500 underline underline-offset-2 hover:text-slate-800 transition disabled:opacity-50"
            >
              {isPreviewLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
              DANFE Preview
            </button>
          </p>
        </div>

        {/*
          Três botões. "Rodar Validação" saiu da aba: a mesma checagem já roda no
          Faturar e de novo no Emitir. O preview desceu para o cabeçalho, porque
          é conferência visual e não etapa do caminho.
        */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => router.push("/notas-fiscais")}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </button>
          {!isReadOnly && (
            <>
              {podeEmitirNfe && (
                <button
                  type="button"
                  onClick={() => void handleConcludeDraft(true)}
                  disabled={isValidating || isSaving || emissaoBloqueada}
                  title={
                    emissaoBloqueada
                      ? `${pendenciasImpeditivas.length} ${pendenciasImpeditivas.length === 1 ? "pendência impede" : "pendências impedem"} a emissão`
                      : undefined
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 text-xs font-semibold transition disabled:opacity-50 shadow-sm"
                >
                  {isValidating || isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Emitir NF-e
                </button>
              )}
              {podeEmitirNfe && emissaoBloqueada && (
                <p className="w-full text-right text-xs font-semibold text-amber-700">
                  {pendenciasImpeditivas.length === 1
                    ? "1 pendência impede a emissão — veja a lista abaixo."
                    : `${pendenciasImpeditivas.length} pendências impedem a emissão — veja a lista abaixo.`}
                </p>
              )}
              <button
                type="button"
                onClick={() => void handleConcludeDraft(false)}
                disabled={isValidating || isSaving}
                title="Prepara a nota e deixa pronta para envio, sem emitir agora"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition disabled:opacity-50"
              >
                {isValidating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Só concluir rascunho
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="inline-flex items-center gap-2 rounded-xl bg-[#0b2f4a] hover:bg-[#061d2e] px-4 py-2.5 text-xs font-semibold text-white transition disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Salvar e sair
              </button>
            </>
          )}
        </div>
      </section>

      {isReadOnly && (
        <div className="flex items-center gap-2 p-4 bg-slate-50 border border-slate-200 text-slate-700 rounded-2xl text-sm font-semibold shadow-sm">
          <Info className="h-5 w-5 text-slate-500 shrink-0" />
          <span>Esta Nota Fiscal está no status <strong>{note.status}</strong> e não pode ser editada diretamente.</span>
        </div>
      )}

      {/*
        Painel de pendências — a mesma conferência que roda ao preparar o envio,
        mostrada antes do clique. Cada linha leva ao lugar do conserto; as que
        não têm campo na tela (finalidade, presença, status) aparecem sem link,
        porque a lista precisa ser a verdade completa do que trava. A natureza
        saiu dessa lista em 28/08/2026: agora tem select no bloco Resumo.
      */}
      {!isReadOnly && pendencias.length > 0 && (
        <section className="overflow-hidden rounded-3xl border border-[#d7e5e8] bg-white shadow-sm">
          <div
            className={`flex items-center gap-2.5 border-b px-6 py-4 ${
              emissaoBloqueada ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"
            }`}
          >
            {emissaoBloqueada ? (
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
            ) : (
              <Info className="h-5 w-5 shrink-0 text-slate-500" />
            )}
            <h2 className={`flex-1 text-base font-bold ${emissaoBloqueada ? "text-amber-900" : "text-slate-800"}`}>
              {emissaoBloqueada
                ? pendenciasImpeditivas.length === 1
                  ? "Falta resolver 1 coisa antes de emitir"
                  : `Falta resolver ${pendenciasImpeditivas.length} coisas antes de emitir`
                : "Nada impede a emissão. Confira os avisos abaixo."}
            </h2>
            <span className="text-xs text-slate-500">Conferido de novo ao emitir</span>
            <button
              type="button"
              onClick={handleReconferir}
              disabled={isLoading}
              title="Recarrega os dados do cadastro do cliente e reconfere a nota"
              className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-[#0b2f4a] hover:bg-slate-50 transition disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Reconferir
            </button>
          </div>

          <ul className="divide-y divide-slate-100">
            {pendencias.map((pendencia, indice) => {
              const temLink = pendencia.destino.tipo !== "sem-destino";
              const impeditiva = pendencia.severidade === "impede";
              return (
                <li key={`${pendencia.codigo}-${indice}`} className="flex items-center gap-4 px-6 py-3.5">
                  {impeditiva ? (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  ) : (
                    <Info className="h-4 w-4 shrink-0 text-slate-400" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${impeditiva ? "font-semibold text-slate-900" : "text-slate-600"}`}>
                      {pendencia.texto}
                    </p>
                    <p className="text-xs text-slate-500">
                      {pendencia.bloco}
                      {impeditiva ? " • impede a emissão" : " • apenas aviso"}
                    </p>
                  </div>
                  {temLink && (
                    <button
                      type="button"
                      onClick={() => irParaPendencia(pendencia)}
                      className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-[#0b2f4a] hover:bg-slate-50 transition"
                    >
                      {pendencia.destino.tipo === "cadastro-cliente" ? "Abrir cadastro" : `Abrir em ${pendencia.bloco}`}
                      {pendencia.destino.tipo === "cadastro-cliente" ? (
                        <ExternalLink className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/*
        Conferência única: a lateral diz o estado de cada bloco e mantém o total
        à vista; os blocos ficam empilhados, recolhidos quando não pedem nada.
        As dez abas viraram estes dez blocos — os mesmos nomes, o mesmo conteúdo.
      */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <ConferenciaLateral
          blocos={BLOCOS_DA_NOTA.map((bloco) => ({
            id: bloco,
            estado: estadoDoBloco(bloco),
            detalhe: detalheDoBloco(bloco)
          }))}
          emFoco={activeTab}
          totais={{
            produtos: computedValorProdutos,
            frete: valorFrete || 0,
            desconto: note.valor_desconto || 0,
            total: computedValorTotalNf
          }}
          formatarValor={formatCurrency}
          onSelecionar={irParaBloco}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-4">
        {/* Aba 1: Resumo */}
        <BlocoConferencia id="Resumo" estado={estadoDoBloco("Resumo")} resumo={resumoDoBloco("Resumo")} aberto={blocoAberto("Resumo")} onAlternar={() => alternarBloco("Resumo")}>
        {blocoAberto("Resumo") && (
          <div className="space-y-6">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-[#0b2f4a]" /> Resumo do Rascunho
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="border border-slate-100 p-5 rounded-2xl bg-slate-50/50 space-y-3">
                <h3 className="font-bold text-slate-800 text-sm">Informações Gerais</h3>
                <p className="text-sm text-slate-600">Empresa: <strong>{getEmpresaName(note.id_empresa)}</strong></p>
                <p className="text-sm text-slate-600">Ambiente: <span className="font-mono text-xs uppercase px-1.5 py-0.5 bg-blue-50 text-blue-800 rounded">{note.ambiente}</span></p>
                <p className="text-sm text-slate-600">Modelo Nfe: <strong>{note.modelo}</strong></p>

                {/* Natureza da operacao. Ate 28/08/2026 nao havia campo: a
                    trigger de defaults gravava um de dois textos de venda e
                    ninguem escolhia. Remessa, amostra, devolucao e venda de
                    imobilizado saiam declaradas como venda de producao propria. */}
                <div className="pt-2 border-t border-slate-200 space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Natureza da operação
                  </label>
                  {isReadOnly ? (
                    <p className="text-sm font-medium text-slate-800">{naturezaOperacao || "—"}</p>
                  ) : (
                    <>
                      <select
                        value={dropNaturezaOp}
                        onChange={(e) => {
                          const escolhida = naturezasCatalogo.find((n) => n.descricao === e.target.value);
                          setDropNaturezaOp(e.target.value);
                          // Os dois campos saem do catalogo, nunca de literal.
                          setNaturezaOperacao(escolhida ? escolhida.natureza : "");

                          // O CFOP e a TRIBUTACAO de TODOS os itens acompanham,
                          // na hora. Um valor so, aplicado a lista inteira: nao
                          // ha como sair daqui com itens discordando entre si.
                          //
                          // A tributacao precisa acompanhar, e nao so o CFOP:
                          // trocar venda por devolucao e deixar 102 nos itens
                          // manteria o campo preenchido, e o bloqueio de emissao
                          // -- que so olha campo vazio -- nunca dispararia.
                          const novoCfop = cfopDaNatureza(
                            e.target.value,
                            destinoFiscal?.uf ?? "",
                            ufEmitente,
                            naturezasCatalogo
                          );
                          const novaTributacao = tributacaoDaNatureza(
                            e.target.value,
                            naturezasCatalogo
                          );
                          if (novoCfop || novaTributacao) {
                            setEditedItems((prev) =>
                              prev.map((it) => ({
                                ...it,
                                ...(novoCfop ? { cfop: novoCfop } : {}),
                                ...(novaTributacao
                                  ? {
                                      // `null` do catalogo vira "" na tela: e o
                                      // campo em branco que o operador precisa
                                      // preencher, e o que a pendencia enxerga.
                                      icms_situacao_tributaria:
                                        novaTributacao.icms_situacao_tributaria ?? "",
                                      pis_situacao_tributaria:
                                        novaTributacao.pis_situacao_tributaria ?? "",
                                      cofins_situacao_tributaria:
                                        novaTributacao.cofins_situacao_tributaria ?? ""
                                    }
                                  : {})
                              }))
                            );
                          }
                        }}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                      >
                        {dropNaturezaOp === "" && <option value="">Selecionar natureza...</option>}
                        {/* A gravada fica, marcada como atual, ainda que a UF
                            de hoje nao a ofereceria. */}
                        {naturezaGravadaForaDaLista && (
                          <option value={dropNaturezaOp}>{dropNaturezaOp} — atual</option>
                        )}
                        {naturezasDisponiveis.map((n) => (
                          <option key={n.id} value={n.descricao}>
                            {n.descricao}
                          </option>
                        ))}
                      </select>
                      <p className="text-[10px] text-slate-400 leading-relaxed">
                        Vai no campo <span className="font-mono">natOp</span> da NF-e como
                        <strong className="text-slate-500"> {naturezaOperacao || "—"}</strong>.
                      </p>
                      {/* O CFOP deixou de ser digitado: deriva daqui, e a UF
                          decide entre o par interno e o interestadual. */}
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        CFOP dos itens:{" "}
                        {cfopDerivado ? (
                          <>
                            <strong className="font-mono text-slate-700">{cfopDerivado}</strong>{" "}
                            <span className="text-slate-400">
                              ({destinoFiscal?.uf || "?"} → {ufEmitente || "?"},{" "}
                              {destinoOperacaoNota === "INTERNA" ? "interna" : "interestadual"})
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-400">
                            sem natureza reconhecida no catálogo — os itens mantêm o CFOP atual
                          </span>
                        )}
                      </p>
                      {naturezaGravadaForaDaLista && destinoOperacaoNota && (
                        <p className="text-[10px] text-slate-500 leading-relaxed">
                          A natureza gravada não é das oferecidas para operação{" "}
                          {destinoOperacaoNota === "INTERNA" ? "interna" : "interestadual"} — ela
                          continua aí até você trocar.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="border border-slate-100 p-5 rounded-2xl bg-slate-50/50 space-y-3">
                <h3 className="font-bold text-slate-800 text-sm">Valores Financeiros</h3>
                <p className="text-sm text-slate-600 flex justify-between">Produtos: <span>{formatCurrency(computedValorProdutos)}</span></p>
                <p className="text-sm text-slate-600 flex justify-between">Frete: <span>{formatCurrency(valorFrete)}</span></p>
                <p className="text-sm text-slate-600 flex justify-between">Desconto: <span>-{formatCurrency(note.valor_desconto)}</span></p>
                <p className="text-sm font-bold text-slate-900 flex justify-between border-t pt-2 border-slate-200">
                  Total NF: <span>{formatCurrency(computedValorTotalNf)}</span>
                </p>
              </div>

              <div className="border border-slate-100 p-5 rounded-2xl bg-slate-50/50 space-y-3">
                <h3 className="font-bold text-slate-800 text-sm">Destinatário Comercial</h3>
                <p className="text-sm font-bold text-slate-900">{cliente?.nome || "Carregando..."}</p>
                <p className="text-xs text-slate-500">Documento: {cliente?.documento || "-"}</p>
                <p className="text-xs text-slate-500">Inscrição Estadual: {cliente?.inscricao_estadual || "ISENTO"}</p>
              </div>
            </div>

            {/* Checklist de consistência rápida */}
            <div className="border border-slate-100 p-5 rounded-2xl bg-slate-50/50 space-y-3">
              <h3 className="font-bold text-slate-800 text-sm">Status e Validações</h3>
              {validationData?.pode_emitir ? (
                <div className="flex items-center gap-2.5 text-emerald-800 bg-emerald-50 border border-emerald-200 p-3 rounded-xl text-sm font-medium">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                  Rascunho validado sem erros bloqueantes. Pronto para testes de payload.
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2.5 text-amber-800 bg-amber-50 border border-amber-200 p-3 rounded-xl text-sm font-medium">
                    <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                    Existem pendências fiscais que impedem a emissão. Consulte a aba &quot;Validação&quot;.
                  </div>
                  {validationData?.pendencias_texto && validationData.pendencias_texto.length > 0 && (
                    <ul className="text-xs text-slate-600 list-disc pl-5 space-y-1">
                      {validationData.pendencias_texto.map((err: string, i: number) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Eventos Fiscais */}
            <div className="border border-slate-100 p-5 rounded-2xl bg-slate-50/50 space-y-4">
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <Layers className="h-4 w-4 text-[#0b2f4a]" /> Eventos fiscais
              </h3>
              
              {events.length === 0 ? (
                <p className="text-xs text-slate-500 italic">Nenhum evento fiscal registrado para esta nota.</p>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-[#d7e5e8] bg-white">
                  <table className="w-full text-left text-sm text-slate-700">
                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-[#d7e5e8]">
                      <tr>
                        <th className="px-4 py-3">Tipo do Evento</th>
                        <th className="px-4 py-3 w-24">Sequência</th>
                        <th className="px-4 py-3">Status Evento</th>
                        <th className="px-4 py-3">Status SEFAZ</th>
                        <th className="px-4 py-3 w-72">Mensagem SEFAZ</th>
                        <th className="px-4 py-3 w-40">Data</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {events.map((evt) => (
                        <tr key={evt.id} className="hover:bg-slate-50/50 text-xs">
                          <td className="px-4 py-3 font-semibold text-slate-700">{evt.tipo_evento}</td>
                          <td className="px-4 py-3 font-mono">{evt.sequencia_evento ?? "-"}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                              {evt.status_evento || "-"}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono">{evt.status_sefaz || "-"}</td>
                          <td className="px-4 py-3 text-slate-600 truncate max-w-[280px]" title={evt.mensagem_sefaz || undefined}>
                            {evt.mensagem_sefaz || "-"}
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {evt.created_at ? formatDateTime(evt.created_at) : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
        </BlocoConferencia>

        {/* Aba 2: Emitente */}
        <BlocoConferencia id="Emitente" estado={estadoDoBloco("Emitente")} resumo={resumoDoBloco("Emitente")} aberto={blocoAberto("Emitente")} onAlternar={() => alternarBloco("Emitente")}>
        {blocoAberto("Emitente") && (
          <div className="space-y-6">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Building className="h-5 w-5 text-[#0b2f4a]" /> Dados do Emitente
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Empresa Emitente</label>
                <select
                  value={note.id_empresa}
                  onChange={(e) => handleTrocarEmpresa(Number(e.target.value))}
                  disabled={isSaving}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a] font-medium"
                >
                  <option value={1}>INGRESSO IDEAL (id: 1)</option>
                  <option value={2}>BIRÔ IDEAL (id: 2)</option>
                  <option value={3}>E3 BRINDES (id: 3)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">CNPJ</label>
                <input
                  type="text"
                  disabled
                  value={empresa?.cnpj || "CNPJ Emitente"}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50 outline-none text-slate-600 font-medium"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Inscrição Estadual (IE)</label>
                <input
                  type="text"
                  disabled
                  value={empresa?.inscricao_estadual || "IE Emitente"}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50 outline-none text-slate-600 font-medium"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">UF Emitente</label>
                <input
                  type="text"
                  disabled
                  value={empresa?.uf || "RS"}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50 outline-none text-slate-600 font-medium"
                />
              </div>
            </div>
            <p className="text-xs text-slate-500 italic">
              * Nota: Os dados cadastrais da empresa emitente são de preenchimento global. Use o seletor acima para trocar qual empresa emite a nota fiscal.
            </p>
          </div>
        )}
        </BlocoConferencia>

        {/* Aba 3: Destinatário */}
        <BlocoConferencia id="Destinatário" estado={estadoDoBloco("Destinatário")} resumo={resumoDoBloco("Destinatário")} aberto={blocoAberto("Destinatário")} onAlternar={() => alternarBloco("Destinatário")}>
        {blocoAberto("Destinatário") && (() => {
          return (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <User className="h-5 w-5 text-[#0b2f4a]" /> Dados do Destinatário
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Nome / Razão Social</label>
                  <input
                    type="text"
                    disabled
                    value={cliente?.nome || ""}
                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50 outline-none text-slate-600 font-medium"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">CPF / CNPJ</label>
                  <input
                    type="text"
                    disabled
                    value={cliente?.documento || ""}
                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50 outline-none text-slate-600 font-medium"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Inscrição Estadual (IE) Cadastro</label>
                  <input
                    type="text"
                    disabled
                    value={cliente?.ins_estadual || cliente?.inscricao_estadual || "ISENTO"}
                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50 outline-none text-slate-600 font-medium"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">E-mail</label>
                  <input
                    type="text"
                    disabled
                    value={cliente?.email || ""}
                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50 outline-none text-slate-600 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Consumidor Final</label>
                  <select
                    id={CAMPO_CONSUMIDOR_FINAL}
                    value={consumidorFinal}
                    onChange={(e) => setConsumidorFinal(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a] font-medium"
                  >
                    <option value={0}>0 - Não</option>
                    <option value={1}>1 - Sim</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Tipo de Contribuinte</label>
                  <select
                    id={CAMPO_TIPO_CONTRIBUINTE}
                    value={tipoContribuinte}
                    onChange={(e) => setTipoContribuinte(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a] font-medium"
                  >
                    {OPCOES_TIPO_CONTRIBUINTE.map((opcao) => (
                      <option key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</option>
                    ))}
                  </select>
                </div>

                {/*
                  O override de IE saiu daqui. Ele não corrigia a IE do
                  destinatário: o payload monta essa IE a partir do cadastro do
                  cliente, e o que era digitado aqui virava texto nas Informações
                  Complementares. Parecia resolver e não resolvia.
                  IE vazia agora é pendência bloqueante na conferência do
                  Faturar, corrigida no cadastro do cliente pelo Comercial.
                */}
                <div className="md:col-span-2">
                  <span className="block text-xs font-semibold text-slate-500">
                    Inscrição Estadual do destinatário
                  </span>
                  <p className="mt-1 text-sm font-mono text-slate-700">
                    {cliente?.ins_estadual || cliente?.inscricao_estadual || "ISENTO"}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Vem do cadastro do cliente. Para alterar, corrija no cadastro — o Comercial é quem edita.
                  </p>
                </div>
              </div>

              {/* Endereço Principal / Faturamento */}
              <div className="border-t border-slate-100 pt-6 space-y-4">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-[#0b2f4a]" /> Endereço Principal / Faturamento (Apenas Leitura)
                </h3>
                {principalEndereco ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100 text-sm">
                    <div>
                      <span className="block text-xs font-semibold text-slate-400 uppercase">CEP</span>
                      <span className="font-mono text-slate-700">{principalEndereco.cep || "-"}</span>
                    </div>
                    <div>
                      <span className="block text-xs font-semibold text-slate-400 uppercase">Cidade / UF</span>
                      <span className="text-slate-700">{principalEndereco.cidade || "-"} / {principalEndereco.uf || "-"}</span>
                    </div>
                    <div>
                      <span className="block text-xs font-semibold text-slate-400 uppercase">Bairro</span>
                      <span className="text-slate-700">{principalEndereco.bairro || "-"}</span>
                    </div>
                    <div className="md:col-span-2">
                      <span className="block text-xs font-semibold text-slate-400 uppercase">Logradouro / Endereço</span>
                      <span className="text-slate-700">{principalEndereco.endereco || "-"}</span>
                    </div>
                    <div>
                      <span className="block text-xs font-semibold text-slate-400 uppercase">Número / Complemento</span>
                      <span className="text-slate-700 font-medium">
                        {principalEndereco.numero || "S/N"} {principalEndereco.complemento ? `(${principalEndereco.complemento})` : ""}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic bg-slate-50 p-3 rounded-xl border border-dashed">
                    Nenhum endereço principal cadastrado para este cliente.
                  </p>
                )}
                <p className="text-xs text-slate-400 italic">
                  * Nota: O endereço de faturamento acima vem da tabela `enderecos` (tipo Principal) e não pode ser editado nesta tela.
                </p>
              </div>

              {/* Endereço de Entrega */}
              <div className="border-t border-slate-100 pt-6 space-y-4">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-3">
                    <input
                      id="useDeliveryAddress"
                      type="checkbox"
                      checked={useDeliveryAddress}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setUseDeliveryAddress(checked);
                        if (checked) {
                          if (allEnderecos.length > 0) {
                            const entregaAddr = allEnderecos.find(a => (a.tipo_endereco || "").toLowerCase() === "entrega");
                            const defaultAddr = entregaAddr || allEnderecos[0];
                            setSelectedAddressId(defaultAddr.id ? String(defaultAddr.id) : "manual");
                            if (defaultAddr.id) {
                              setCustomAddressActive(false);
                              setDeliveryCep(defaultAddr.cep || "");
                              setDeliveryLogradouro(defaultAddr.endereco || "");
                              setDeliveryNumero(defaultAddr.numero || "");
                              setDeliveryComplemento(defaultAddr.complemento || "");
                              setDeliveryBairro(defaultAddr.bairro || "");
                              setDeliveryCidade(defaultAddr.cidade || "");
                              setDeliveryUf(defaultAddr.uf || "");
                            } else {
                              setCustomAddressActive(true);
                            }
                          } else {
                            setSelectedAddressId("manual");
                            setCustomAddressActive(true);
                          }
                        } else {
                          setSelectedAddressId(null);
                          setCustomAddressActive(false);
                          setDeliveryCep("");
                          setDeliveryLogradouro("");
                          setDeliveryNumero("");
                          setDeliveryComplemento("");
                          setDeliveryBairro("");
                          setDeliveryCidade("");
                          setDeliveryUf("");
                        }
                      }}
                      className="h-4.5 w-4.5 rounded border-slate-350 text-[#0b2f4a] focus:ring-[#0b2f4a]"
                    />
                    <label htmlFor="useDeliveryAddress" className="text-sm font-bold text-slate-800 cursor-pointer">
                      Usar endereço de entrega diferente
                    </label>
                  </div>
                  <p className="text-xs text-slate-500 font-medium ml-7">
                    Use apenas quando a entrega ocorrer em endereço diferente do cadastro principal.
                  </p>
                </div>

                {useDeliveryAddress && (
                  <div className="p-5 border border-slate-200 bg-slate-50/50 rounded-2xl space-y-4 animate-in fade-in slide-in-from-top-2 duration-250 ml-7">
                    <p className="text-xs text-slate-550 font-semibold">
                      Selecione um endereço cadastrado do cliente ou informe um novo:
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {allEnderecos.map((addr) => {
                        const addrIdStr = addr.id ? String(addr.id) : "";
                        const isSelected = selectedAddressId === addrIdStr;
                        return (
                          <div
                            key={addrIdStr || Math.random()}
                            onClick={() => {
                              setSelectedAddressId(addrIdStr || null);
                              setCustomAddressActive(false);
                              setDeliveryCep(addr.cep || "");
                              setDeliveryLogradouro(addr.endereco || "");
                              setDeliveryNumero(addr.numero || "");
                              setDeliveryComplemento(addr.complemento || "");
                              setDeliveryBairro(addr.bairro || "");
                              setDeliveryCidade(addr.cidade || "");
                              setDeliveryUf(addr.uf || "");
                            }}
                            className={`cursor-pointer border p-4 rounded-xl transition flex flex-col justify-between hover:border-[#0b2f4a] hover:bg-white ${
                              isSelected
                                ? "border-[#0b2f4a] bg-white ring-2 ring-[#0b2f4a]/10"
                                : "border-slate-200 bg-white"
                            }`}
                          >
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-[#0b2f4a] uppercase px-1.5 py-0.5 bg-slate-100 rounded">
                                  {addr.tipo_endereco || "Endereço"}
                                </span>
                                {isSelected && (
                                  <Check className="h-4 w-4 text-[#0b2f4a]" />
                                )}
                              </div>
                              <p className="text-xs font-semibold text-slate-700 mt-2">
                                {addr.endereco}, {addr.numero}
                              </p>
                              {addr.complemento && (
                                <p className="text-[11px] text-slate-500">
                                  {addr.complemento}
                                </p>
                              )}
                              <p className="text-[11px] text-slate-550">
                                {addr.bairro} - {addr.cidade}/{addr.uf}
                              </p>
                              <p className="text-[10px] font-mono text-slate-400 mt-1">
                                CEP: {addr.cep}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                      
                      {/* Opção Informar Novo Endereço */}
                      <div
                        onClick={() => {
                          setSelectedAddressId("manual");
                          setCustomAddressActive(true);
                          if (selectedAddressId !== "manual") {
                            setDeliveryCep("");
                            setDeliveryLogradouro("");
                            setDeliveryNumero("");
                            setDeliveryComplemento("");
                            setDeliveryBairro("");
                            setDeliveryCidade("");
                            setDeliveryUf("");
                          }
                        }}
                        className={`cursor-pointer border border-dashed p-4 rounded-xl transition flex flex-col justify-center items-center text-center hover:border-[#0b2f4a] hover:bg-white min-h-[120px] ${
                          selectedAddressId === "manual"
                            ? "border-[#0b2f4a] bg-white ring-2 ring-[#0b2f4a]/10 text-[#0b2f4a]"
                            : "border-slate-300 bg-white text-slate-500"
                        }`}
                      >
                        <MapPin className="h-5 w-5 mb-1 text-current" />
                        <span className="text-xs font-bold">Informar novo endereço</span>
                      </div>
                    </div>

                    {customAddressActive && (
                      <div className="border-t border-slate-200/60 pt-4 space-y-4 animate-in fade-in duration-200">
                        <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                          <Info className="h-3.5 w-3.5 text-slate-500" />
                          Novo Endereço de Entrega (Preenchimento Manual)
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">CEP</label>
                            <input
                              type="text"
                              value={deliveryCep}
                              onChange={(e) => setDeliveryCep(e.target.value)}
                              placeholder="00000-000"
                              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">Cidade</label>
                            <input
                              type="text"
                              value={deliveryCidade}
                              onChange={(e) => setDeliveryCidade(e.target.value)}
                              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">UF</label>
                            <input
                              type="text"
                              maxLength={2}
                              value={deliveryUf}
                              onChange={(e) => setDeliveryUf(e.target.value.toUpperCase())}
                              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">Bairro</label>
                            <input
                              type="text"
                              value={deliveryBairro}
                              onChange={(e) => setDeliveryBairro(e.target.value)}
                              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-xs font-semibold text-slate-500 mb-1">Logradouro</label>
                            <input
                              type="text"
                              value={deliveryLogradouro}
                              onChange={(e) => setDeliveryLogradouro(e.target.value)}
                              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">Número</label>
                            <input
                              type="text"
                              value={deliveryNumero}
                              onChange={(e) => setDeliveryNumero(e.target.value)}
                              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-xs font-semibold text-slate-500 mb-1">Complemento</label>
                            <input
                              type="text"
                              value={deliveryComplemento}
                              onChange={(e) => setDeliveryComplemento(e.target.value)}
                              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
        </BlocoConferencia>

        {/* Aba 4: Itens */}
        <BlocoConferencia id="Itens" estado={estadoDoBloco("Itens")} resumo={resumoDoBloco("Itens")} aberto={blocoAberto("Itens")} onAlternar={() => alternarBloco("Itens")}>
        {blocoAberto("Itens") && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Layers className="h-5 w-5 text-[#0b2f4a]" /> Itens Fiscais da Nota
              </h2>
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={() => setIsAddNewItemOpen(!isAddNewItemOpen)}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#0b2f4a] hover:bg-[#061d2e] px-4 py-2.5 text-xs font-semibold text-white transition shadow-sm"
                >
                  {isAddNewItemOpen ? "Fechar Formulário" : "Adicionar Item Fiscal"}
                </button>
              )}
            </div>

            <div className="overflow-x-auto rounded-2xl border border-[#d7e5e8] bg-white">
              <table className="w-full text-left text-sm text-slate-700 min-w-[1100px] table-fixed">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-[#d7e5e8]">
                  <tr>
                    <th className="px-3 py-3 w-12 whitespace-nowrap align-middle text-center">#</th>
                    <th className="px-3 py-3 w-72 whitespace-nowrap align-middle">Descrição</th>
                    <th className="px-3 py-3 w-16 whitespace-nowrap align-middle text-center">UN</th>
                    <th className="px-3 py-3 w-28 whitespace-nowrap align-middle text-right">Qtd</th>
                    <th className="px-3 py-3 w-32 whitespace-nowrap align-middle text-right">V. Unitário</th>
                    <th className="px-3 py-3 w-32 whitespace-nowrap align-middle text-right">V. Total</th>
                    <th className="px-3 py-3 w-28 whitespace-nowrap align-middle text-center">NCM</th>
                    <th className="px-3 py-3 w-24 whitespace-nowrap align-middle text-center">CFOP</th>
                    <th className="px-3 py-3 w-32 whitespace-nowrap align-middle text-right">Peso total (g)</th>
                    <th className="px-3 py-3 w-52 whitespace-nowrap align-middle text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item) => {
                    const edited = editedItems.find(it => it.id === item.id);
                    const qty = edited?.quantidade !== undefined ? Number(edited.quantidade) : item.quantidade;
                    const price = edited?.valor_unitario !== undefined ? Number(edited.valor_unitario) : item.valor_unitario;
                    const valTotal = edited?.valor_bruto !== undefined ? Number(edited.valor_bruto) : (qty * price);
                    const pesoTotal = edited?.peso_total_gramas !== undefined ? Number(edited.peso_total_gramas) : (qty * (item.peso_unitario_gramas || 0));
                    const isDirty = hasUnsavedChanges(item);

                    const tribAberta = itemTribAberto === item.id;
                    const tribDiverge = itemTemDivergencia(item);

                    return (
                      <Fragment key={item.id}>
                      <tr className={isDirty ? "bg-amber-55/40 hover:bg-amber-55/60 transition duration-150" : "hover:bg-slate-50/50 transition duration-150"}>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-500 align-middle text-center">{item.numero_item}</td>
                        <td className="px-3 py-2.5 align-middle">
                          <input
                            type="text"
                            value={edited?.descricao || ""}
                            disabled={isReadOnly}
                            onChange={(e) => {
                              setEditedItems(prev =>
                                prev.map(it => (it.id === item.id ? { ...it, descricao: e.target.value } : it))
                              );
                            }}
                            className="w-full border border-slate-100 hover:border-slate-300 focus:border-[#0b2f4a] bg-slate-50/20 focus:bg-white rounded px-2 py-1.5 text-xs outline-none transition font-medium"
                          />
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <input
                            type="text"
                            value={edited?.unidade_comercial || ""}
                            disabled={isReadOnly}
                            onChange={(e) => {
                              setEditedItems(prev =>
                                prev.map(it => (it.id === item.id ? { ...it, unidade_comercial: e.target.value } : it))
                              );
                            }}
                            className="w-full border border-slate-100 hover:border-slate-300 focus:border-[#0b2f4a] bg-slate-50/20 focus:bg-white rounded px-2 py-1.5 text-xs outline-none transition font-medium text-center"
                          />
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <input
                            type="number"
                            id={campoDoItem(item.id, "quantidade")}
                            value={edited?.quantidade !== undefined ? edited.quantidade : ""}
                            disabled={isReadOnly}
                            onChange={(e) => {
                              const value = Number(e.target.value);
                              setEditedItems(prev =>
                                prev.map(it => {
                                  if (it.id === item.id) {
                                    const pr = it.valor_unitario || 0;
                                    const pu = item.peso_unitario_gramas || 0;
                                    return {
                                      ...it,
                                      quantidade: value,
                                      valor_bruto: Number((value * pr).toFixed(2)),
                                      peso_total_gramas: Number((value * pu).toFixed(2))
                                    };
                                  }
                                  return it;
                                })
                              );
                            }}
                            className="w-full border border-slate-100 hover:border-slate-300 focus:border-[#0b2f4a] bg-slate-50/20 focus:bg-white rounded px-2 py-1.5 text-xs outline-none transition text-right font-mono font-medium"
                          />
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <input
                            type="number"
                            step="0.0001"
                            id={campoDoItem(item.id, "valor-unitario")}
                            value={edited?.valor_unitario !== undefined ? edited.valor_unitario : ""}
                            disabled={isReadOnly}
                            onChange={(e) => {
                              const value = Number(e.target.value);
                              setEditedItems(prev =>
                                prev.map(it => {
                                  if (it.id === item.id) {
                                    const q = it.quantidade || 0;
                                    return {
                                      ...it,
                                      valor_unitario: value,
                                      valor_bruto: Number((q * value).toFixed(2))
                                    };
                                  }
                                  return it;
                                })
                              );
                            }}
                            className="w-full border border-slate-100 hover:border-slate-300 focus:border-[#0b2f4a] bg-slate-50/20 focus:bg-white rounded px-2 py-1.5 text-xs outline-none transition text-right font-mono font-medium"
                          />
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <input
                            type="number"
                            step="0.01"
                            id={campoDoItem(item.id, "valor-bruto")}
                            value={edited?.valor_bruto !== undefined ? edited.valor_bruto : valTotal}
                            disabled={isReadOnly}
                            onChange={(e) => {
                              const value = Number(e.target.value);
                              setEditedItems(prev =>
                                prev.map(it => {
                                  if (it.id === item.id) {
                                    const q = it.quantidade || 0;
                                    return {
                                      ...it,
                                      valor_bruto: value,
                                      valor_unitario: q > 0 ? Number((value / q).toFixed(4)) : 0
                                    };
                                  }
                                  return it;
                                })
                              );
                            }}
                            className="w-full border border-slate-100 hover:border-slate-300 focus:border-[#0b2f4a] bg-slate-50/20 focus:bg-white rounded px-2 py-1.5 text-xs outline-none transition text-right font-mono font-semibold"
                          />
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <input
                            type="text"
                            maxLength={8}
                            id={campoDoItem(item.id, "ncm")}
                            value={edited?.ncm || ""}
                            disabled={isReadOnly}
                            onChange={(e) => {
                              const value = e.target.value.replace(/\D/g, "");
                              setEditedItems(prev =>
                                prev.map(it => (it.id === item.id ? { ...it, ncm: value } : it))
                              );
                            }}
                            className="w-full border border-slate-100 hover:border-slate-300 focus:border-[#0b2f4a] bg-slate-50/20 focus:bg-white rounded px-2 py-1.5 text-xs font-mono text-center outline-none transition font-medium"
                          />
                        </td>
                        {/* CFOP NAO E DIGITAVEL. E da nota, deriva da natureza
                            da operacao e e o mesmo em todos os itens. O `id`
                            fica: `pendencias.ts` aponta para ele em
                            ITEM_SEM_CFOP e o foco precisa achar o alvo. */}
                        <td className="px-3 py-2.5 align-middle">
                          <div
                            id={campoDoItem(item.id, "cfop")}
                            title="Definido pela natureza da operação, no Resumo. Igual em todos os itens da nota."
                            className="w-full rounded px-2 py-1.5 text-xs font-mono text-center font-medium text-slate-600 bg-slate-100/60 border border-transparent"
                          >
                            {edited?.cfop || "—"}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <input
                            type="number"
                            value={edited?.peso_total_gramas !== undefined ? edited.peso_total_gramas : pesoTotal}
                            disabled={isReadOnly}
                            onChange={(e) => {
                              const value = Number(e.target.value);
                              setEditedItems(prev =>
                                prev.map(it => {
                                  if (it.id === item.id) {
                                    const q = it.quantidade || 0;
                                    return {
                                      ...it,
                                      peso_total_gramas: value,
                                      peso_unitario_gramas: q > 0 ? Number((value / q).toFixed(2)) : 0
                                    };
                                  }
                                  return it;
                                })
                              );
                            }}
                            className="w-full border border-slate-100 hover:border-slate-300 focus:border-[#0b2f4a] bg-slate-50/20 focus:bg-white rounded px-2 py-1.5 text-xs outline-none transition text-right font-mono font-medium"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-center align-middle whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            {/* Tributacao fica FORA da tabela: ela ja rola na
                                horizontal, e o caso comum -- venda no padrao --
                                nao precisa ver nada. Painel fechado, e o ponto
                                ambar so aparece quando algo saiu do padrao. */}
                            <button
                              type="button"
                              onClick={() => setItemTribAberto(tribAberta ? null : item.id)}
                              title="Situação tributária do item"
                              className={`relative inline-flex items-center rounded-lg border text-[11px] font-bold px-2.5 py-1.5 transition ${
                                tribAberta
                                  ? "border-[#0b2f4a] bg-[#0b2f4a] text-white"
                                  : "border-slate-200 hover:bg-slate-50 text-slate-600"
                              }`}
                            >
                              CST
                              {tribDiverge && (
                                <span
                                  aria-label="tributação alterada"
                                  className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white"
                                />
                              )}
                            </button>
                            {!isReadOnly && (
                              <>
                              <button
                                type="button"
                                onClick={() => handleSaveItem(item.id)}
                                disabled={isSaving || !isDirty}
                                className={`inline-flex items-center gap-1 rounded-lg text-[11px] font-bold px-2.5 py-1.5 transition shadow-sm ${
                                  isDirty
                                    ? "bg-amber-500 hover:bg-amber-600 text-white"
                                    : "bg-slate-100 text-slate-400 cursor-not-allowed"
                                }`}
                              >
                                {isDirty ? "Salvar *" : "Salvo"}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteItem(item.id)}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-200 hover:bg-red-50 text-red-600 text-[11px] font-bold px-2.5 py-1.5 transition"
                              >
                                Excluir
                              </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>

                      {tribAberta && (
                        <tr className="bg-slate-50/70">
                          <td colSpan={10} className="px-4 py-4 border-b border-slate-100">
                            <div className="flex flex-wrap items-start gap-6">
                              <div className="min-w-[10rem]">
                                <p className="text-xs font-bold text-slate-700">Situação tributária</p>
                                <p className="text-[10px] text-slate-400 leading-relaxed mt-0.5">
                                  Item {item.numero_item}. Vem da natureza da operação; pode ser
                                  ajustada aqui.
                                </p>
                              </div>

                              {CAMPOS_TRIBUTACAO.map(({ campo, id, rotulo }) => {
                                const editado = editedItems.find((it) => it.id === item.id);
                                const valor = String(editado?.[campo] ?? item[campo] ?? "");
                                const alterado = divergeDoPadrao(campo, valor);
                                const padrao = tributacaoDerivada?.[campo] ?? null;

                                return (
                                  <div key={id} className="space-y-1">
                                    <label
                                      htmlFor={campoDoItem(item.id, id)}
                                      className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider"
                                    >
                                      {rotulo}
                                      {alterado && (
                                        <span className="ml-1.5 normal-case tracking-normal text-amber-700 font-bold">
                                          alterado
                                        </span>
                                      )}
                                    </label>
                                    {isReadOnly ? (
                                      <p className="w-24 px-2 py-1.5 text-xs font-mono text-slate-700">
                                        {valor || "—"}
                                      </p>
                                    ) : (
                                      <input
                                        type="text"
                                        maxLength={4}
                                        id={campoDoItem(item.id, id)}
                                        value={valor}
                                        onChange={(e) => {
                                          const novo = e.target.value.replace(/\D/g, "");
                                          setEditedItems((prev) =>
                                            prev.map((it) =>
                                              it.id === item.id ? { ...it, [campo]: novo } : it
                                            )
                                          );
                                        }}
                                        className={`w-24 rounded-lg px-2 py-1.5 text-xs font-mono text-center outline-none transition border ${
                                          alterado
                                            ? "border-amber-400 bg-amber-50 focus:border-amber-500"
                                            : "border-slate-200 bg-white focus:border-[#0b2f4a]"
                                        }`}
                                      />
                                    )}
                                    <p className="text-[10px] text-slate-400 h-3">
                                      {padrao !== null ? "padrão " + padrao : ""}
                                    </p>
                                  </div>
                                );
                              })}

                              {naturezaSemTributacaoPadrao && (
                                <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 leading-relaxed max-w-xs">
                                  Devolução espelha a nota de origem: o catálogo não define a
                                  tributação, e a emissão fica bloqueada até você informar.
                                </p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Form de Novo Item (Recolhido por padrão) */}
            {isAddNewItemOpen && (
              <div className="border-t border-slate-100 pt-6 space-y-4 animate-in fade-in slide-in-from-top-2 duration-205">
                <h3 className="text-sm font-bold text-slate-800">Adicionar Novo Item Fiscal</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-slate-50/50 p-5 rounded-2xl border border-[#d7e5e8]">
                  
                  {/* Produto cadastrado dropdown */}
                  <div className="md:col-span-2 space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-500">Selecionar Produto Cadastrado (Preenche Campos)</label>
                    <input
                      type="text"
                      placeholder="🔍 Pesquisar por código, SKU, nome..."
                      value={productSearchText}
                      onChange={(e) => setProductSearchText(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white outline-none focus:border-[#0b2f4a] mb-2"
                    />
                    <select
                      value={selectedProductId || ""}
                      onChange={(e) => {
                        const id = e.target.value ? Number(e.target.value) : null;
                        setSelectedProductId(id);
                        if (id) {
                          const prod = dbProducts.find(p => p.id_produto === id);
                          if (prod) {
                            setNewItemDesc(prod.nomeReal || "");
                            setNewItemNcm(prod.ncm || "49119900");
                            setNewItemUn(prod.unidade_comercial || prod.und_medida || "UN");
                            setNewItemPrice(prod.valorUnt || 0);
                            setNewItemPeso(prod.peso || 0);
                            setNewItemCodigo(String(prod.id_produto));
                          }
                        } else {
                          // Reset
                          setNewItemDesc("");
                          setNewItemNcm("49119900");
                          setNewItemUn("UN");
                          setNewItemPrice(0);
                          setNewItemPeso(0);
                          setNewItemCodigo("MANUAL");
                        }
                      }}
                      className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a] font-medium"
                    >
                      <option value="">-- Preenchimento Manual / Sem Vínculo --</option>
                      {filteredProducts.map(p => (
                        <option key={p.id_produto} value={p.id_produto}>
                          [{p.id_produto}] {p.nomeReal} {p.valorUnt ? `(R$ ${p.valorUnt})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Código do produto */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-500">Código do Produto (SKU)</label>
                    <input
                      type="text"
                      value={newItemCodigo}
                      onChange={(e) => setNewItemCodigo(e.target.value)}
                      placeholder="Ex: 1045, MANUAL, SKU-90"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a] font-mono"
                    />
                  </div>

                  {/* Unidade comercial */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-500">Unidade Comercial</label>
                    <input
                      type="text"
                      value={newItemUn}
                      onChange={(e) => setNewItemUn(e.target.value)}
                      placeholder="Ex: UN, KG, PCT"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                    />
                  </div>

                  {/* Descrição manual */}
                  <div className="md:col-span-2 space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-500">Descrição do Item</label>
                    <input
                      type="text"
                      value={newItemDesc}
                      onChange={(e) => setNewItemDesc(e.target.value)}
                      placeholder="Descrição do item na nota fiscal"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                    />
                  </div>

                  {/* Quantidade */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-500">Quantidade</label>
                    <input
                      type="number"
                      value={newItemQty}
                      onChange={(e) => setNewItemQty(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                    />
                  </div>

                  {/* Valor unitário */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-500">Valor Unitário (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={newItemPrice}
                      onChange={(e) => setNewItemPrice(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a] font-mono"
                    />
                  </div>

                  {/* NCM */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-500">NCM (8 dígitos)</label>
                    <input
                      type="text"
                      maxLength={8}
                      value={newItemNcm}
                      onChange={(e) => setNewItemNcm(e.target.value.replace(/\D/g, ""))}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a] font-mono"
                    />
                  </div>

                  {/* CFOP — nao se digita mais. Nascia com "5101" fixo, e o
                      campo preenchido vencia o calculo por UF: item manual em
                      nota interestadual entrava 5101 ao lado de itens 6101. */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-500">CFOP</label>
                    <div className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-slate-50 font-mono text-slate-600">
                      {cfopDerivado || items[0]?.cfop || "—"}
                    </div>
                    <p className="text-[10px] text-slate-400">Vem da natureza da operação.</p>
                  </div>

                  {/* Peso Unitário */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-500">Peso Unitário (Gramas)</label>
                    <input
                      type="number"
                      value={newItemPeso}
                      onChange={(e) => setNewItemPeso(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a] font-mono"
                    />
                  </div>

                  {/* Observação */}
                  <div className="md:col-span-2 space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-500">Observação do Item</label>
                    <input
                      type="text"
                      value={newItemObs}
                      onChange={(e) => setNewItemObs(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                    />
                  </div>

                  {/* Ação */}
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={handleAddItem}
                      disabled={isAddingItem}
                      className="w-full rounded-xl bg-[#0b2f4a] hover:bg-[#061d2e] py-2.5 text-sm font-semibold text-white transition disabled:opacity-50 h-[46px]"
                    >
                      {isAddingItem ? "Adicionando..." : "Adicionar Item"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        </BlocoConferencia>

        {/* Aba 5: Transporte/Frete */}
        <BlocoConferencia id="Transporte/Frete" estado={estadoDoBloco("Transporte/Frete")} resumo={resumoDoBloco("Transporte/Frete")} aberto={blocoAberto("Transporte/Frete")} onAlternar={() => alternarBloco("Transporte/Frete")}>
        {blocoAberto("Transporte/Frete") && (
          <div className="space-y-6">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Truck className="h-5 w-5 text-[#0b2f4a]" /> Parâmetros de Transporte
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Modalidade do Frete</label>
                <select
                  id={CAMPO_MODALIDADE_FRETE}
                  value={modalidadeFrete}
                  disabled={isReadOnly}
                  onChange={(e) => setModalidadeFrete(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a] font-medium"
                >
                  <option value={0}>0 - CIF (Por conta do Remetente)</option>
                  <option value={1}>1 - FOB (Por conta do Destinatário)</option>
                  <option value={2}>2 - Próprio por conta do Remetente</option>
                  <option value={3}>3 - Próprio por conta do Destinatário</option>
                  <option value={4}>4 - Por conta de Terceiros</option>
                  <option value={9}>9 - Sem Frete</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Selecionar Transportadora Cadastrada</label>
                <select
                  value={idTransportadoraCliente || ""}
                  disabled={isReadOnly}
                  onChange={(e) => {
                    const val = e.target.value ? Number(e.target.value) : null;
                    setIdTransportadoraCliente(val);
                    if (val) {
                      const selected = transportadoras.find(t => t.id_cliente === val);
                      if (selected) {
                        setTransportadora(selected.nome || selected.fantasia || "");
                      }
                    } else {
                      setTransportadora("");
                    }
                  }}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a] font-medium"
                >
                  <option value="">-- Preenchimento Manual / Sem Transportadora --</option>
                  {transportadoras.map((t) => (
                    <option key={t.id_cliente} value={t.id_cliente}>
                      {t.nome || t.fantasia} {t.documento ? `(${t.documento})` : ""} {t.cidade_uf ? `- ${t.cidade_uf}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Nome da Transportadora (Manual/Confirmado)</label>
                <input
                  type="text"
                  value={transportadora}
                  disabled={isReadOnly}
                  onChange={(e) => setTransportadora(e.target.value)}
                  placeholder="Nome da Transportadora"
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Valor do Frete (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  value={valorFrete}
                  disabled={isReadOnly}
                  onChange={(e) => setValorFrete(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a] font-mono"
                />
              </div>

              <div className="md:col-span-3 border-t border-slate-100 pt-6">
                <h3 className="text-sm font-bold text-slate-800 mb-4">Dados de Volumes e Carga</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Qtd de Volumes</label>
                    <input
                      type="number"
                      value={quantidadeVolumes}
                      disabled={isReadOnly}
                      onChange={(e) => setQuantidadeVolumes(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Espécie</label>
                    <input
                      type="text"
                      value={especieVolumes}
                      disabled={isReadOnly}
                      onChange={(e) => setEspecieVolumes(e.target.value)}
                      placeholder="Ex: CAIXA / PACOTE"
                      className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Peso Líquido (kg)</label>
                    <input
                      type="number"
                      step="0.001"
                      value={pesoLiquido}
                      disabled={isReadOnly}
                      onChange={(e) => setPesoLiquido(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a] font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Peso Bruto (kg)</label>
                    <input
                      type="number"
                      step="0.001"
                      value={pesoBruto}
                      disabled={isReadOnly}
                      onChange={(e) => setPesoBruto(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a] font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        </BlocoConferencia>

        {/* Aba 6: Pagamentos */}
        <BlocoConferencia id="Pagamentos" estado={estadoDoBloco("Pagamentos")} resumo={resumoDoBloco("Pagamentos")} aberto={blocoAberto("Pagamentos")} onAlternar={() => alternarBloco("Pagamentos")}>
        {blocoAberto("Pagamentos") && (
          <div className="space-y-6">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-[#0b2f4a]" /> Pagamentos Fiscais (Fatura)
            </h2>

            {/* Banner de pagamentos invalidados */}
            {paymentsInvalidated && (
              <div className="flex flex-col gap-2 p-4 bg-rose-50 border border-rose-200 text-rose-900 rounded-2xl text-sm font-semibold shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0" />
                  <span>Os pagamentos precisam ser regenerados!</span>
                </div>
                <p className="text-xs text-slate-600 font-medium">
                  Houve alterações financeiras nos itens ou na nota que invalidaram as parcelas atuais.
                  Por favor, utilize o gerador abaixo para recriar as parcelas e conciliar o financeiro fiscal.
                </p>
              </div>
            )}

            {/* Banner de divergência financeira */}
            {isPaymentMismatch && pagamentos.length > 0 && (
              <div className="flex flex-col gap-2 p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl text-sm font-semibold shadow-sm">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                  <span>Atenção: Os vencimentos estão divergentes do valor total da NF-e!</span>
                </div>
                <p className="text-xs text-slate-600 font-medium">
                  O valor total da nota fiscal é <strong>{formatCurrency(computedValorTotalNf)}</strong>, mas a soma das parcelas atuais é <strong>{formatCurrency(sumOfPayments)}</strong> (diferença de {formatCurrency(Math.abs(computedValorTotalNf - sumOfPayments))}).
                  {pgtoFormaPagamento === "15" ? (
                    <span> Recomendamos regerar as parcelas abaixo para conciliar o financeiro fiscal.</span>
                  ) : (
                    <span> Por favor, salve o rascunho ou ajuste os valores das parcelas para conciliar o financeiro fiscal.</span>
                  )}
                </p>
              </div>
            )}

            {pagamentos.length === 0 ? (
              <div className="space-y-4">
                {renderSugestaoTitulos()}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 space-y-4">
                <div className="text-sm font-medium text-slate-600">
                  Selecione a forma de pagamento para configurar o faturamento fiscal da NF-e.
                </div>
                <div className="max-w-xs">
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Forma de Pagamento</label>
                  <select
                    value={pgtoFormaPagamento}
                    disabled={isReadOnly}
                    onChange={(e) => handleFormaPagamentoChange(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a] font-medium"
                  >
                    <option value="01">01 - Dinheiro</option>
                    <option value="02">02 - Cheque</option>
                    <option value="03">03 - Cartão de Crédito</option>
                    <option value="04">04 - Cartão de Débito</option>
                    <option value="15">15 - Boleto Bancário</option>
                    <option value="17">17 - PIX</option>
                    <option value="90">90 - Sem Pagamento</option>
                    <option value="99">99 - Outros</option>
                  </select>
                </div>
                {!isReadOnly && pgtoFormaPagamento === "15" && (
                  <div className="border-t border-slate-200 pt-4 space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
                    <h3 className="text-sm font-bold text-slate-800">Gerar Parcelas Automaticamente</h3>
                    {renderControlesFormatoModal()}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Valor de entrada</label>
                        <input
                          type="number"
                          step="0.01"
                          value={pgtoValorEntrada}
                          onChange={(e) => setPgtoValorEntrada(Number(e.target.value))}
                          disabled={pgtoParcelaUnica}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Qtd de parcelas futuras</label>
                        <input
                          type="number"
                          min={1}
                          value={pgtoQtdParcelas}
                          onChange={(e) => setPgtoQtdParcelas(Number(e.target.value))}
                          disabled={pgtoParcelaUnica}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Dias para primeira parcela futura</label>
                        <input
                          type="number"
                          min={0}
                          value={pgtoDiasPraInicio}
                          onChange={(e) => setPgtoDiasPraInicio(Number(e.target.value))}
                          disabled={pgtoParcelaUnica}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Intervalo entre parcelas futuras (Dias)</label>
                        <input
                          type="number"
                          min={1}
                          value={pgtoIntervalo}
                          onChange={(e) => setPgtoIntervalo(Number(e.target.value))}
                          disabled={pgtoParcelaUnica}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                        />
                      </div>
                      <div className="md:col-span-4 flex justify-end">
                        <button
                          type="button"
                          onClick={handleGerarPagamentos}
                          disabled={isGeneratingPgto}
                          className="rounded-xl bg-[#0b2f4a] hover:bg-[#061d2e] px-6 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50"
                        >
                          {isGeneratingPgto ? "Gerando..." : "Gerar Parcelas Fiscais"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              </div>
            ) : (
              <>
                {renderSugestaoTitulos()}

                <div className="overflow-x-auto rounded-2xl border border-[#d7e5e8] bg-white">
                  <table className="w-full text-left text-sm text-slate-700">
                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-[#d7e5e8]">
                      <tr>
                        <th className="px-4 py-3">Parcela</th>
                        <th className="px-4 py-3">Forma de Pagamento</th>
                        <th className="px-4 py-3 w-44">Vencimento</th>
                        <th className="px-4 py-3 w-40 text-right">Valor Parcela (R$)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pagamentos.map((pag) => {
                        const edited = editedPagamentos.find(pg => pg.id === pag.id);
                        const canEditForma = pag.numero_parcela === 1 && (pagamentos.length === 1 || pgtoValorEntrada > 0);
                        return (
                          <tr key={pag.id} className="hover:bg-slate-50/50">
                            <td className="px-4 py-3.5 font-mono text-xs">Parcela {pag.numero_parcela} / {pag.total_parcelas}</td>
                            <td className="px-4 py-3.5">
                              <select
                                value={edited?.forma_pagamento || "15"}
                                disabled={!canEditForma || isReadOnly}
                                onChange={async (e) => {
                                  const value = e.target.value;
                                  const isEntradaEdicao = pag.numero_parcela === 1 && pagamentos.length > 1;
                                  
                                  if (!isEntradaEdicao && value !== "15" && pagamentos.length > 0) {
                                    const temVariosVencimentos = pagamentos.length > 1 || pagamentos[0]?.forma_pagamento !== value;
                                    if (temVariosVencimentos) {
                                      setConfirmModal({
                                        isOpen: true,
                                        title: "Alterar Forma de Pagamento",
                                        message: "As parcelas antigas geradas para esta Nota Fiscal serão substituídas por um pagamento único à vista. Deseja continuar?",
                                        onConfirm: async () => {
                                          await recreateSinglePayment(note.id, note.ref, note.id_int, computedValorTotalNf, value);
                                          await updateNfeDraft(note.id, { ref: note.ref, forma_pgto: value, pgto_is_configurado: true }, [], []);
                                          await loadData(true);
                                        }
                                      });
                                      return;
                                    }
                                  }

                                  setEditedPagamentos(prev =>
                                    prev.map(pg => (pg.id === pag.id ? { ...pg, forma_pagamento: value } : pg))
                                  );
                                  if (pagamentos.length === 1) {
                                    setPgtoFormaPagamento(value);
                                    await updateNfeDraft(note.id, { ref: note.ref, forma_pgto: value, pgto_is_configurado: true }, [], []);
                                  }
                                }}
                                className={`w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs bg-white outline-none focus:border-[#0b2f4a] font-medium ${(!canEditForma || isReadOnly) ? "bg-slate-50 text-slate-400 cursor-not-allowed border-slate-100" : ""}`}
                              >
                                <option value="01">01 - Dinheiro</option>
                                <option value="02">02 - Cheque</option>
                                <option value="03">03 - Cartão de Crédito</option>
                                <option value="04">04 - Cartão de Débito</option>
                                <option value="15">15 - Boleto Bancário</option>
                                <option value="17">17 - PIX</option>
                                <option value="90">90 - Sem Pagamento</option>
                                <option value="99">99 - Outros</option>
                              </select>
                            </td>
                            <td className="px-4 py-3.5">
                              <input
                                type="date"
                                value={edited?.data_vencimento ? edited.data_vencimento.split("T")[0] : ""}
                                disabled={isReadOnly}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setEditedPagamentos(prev =>
                                    prev.map(pg => (pg.id === pag.id ? { ...pg, data_vencimento: value } : pg))
                                  );
                                }}
                                className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-[#0b2f4a] font-mono text-center"
                              />
                            </td>
                            <td className="px-4 py-3.5">
                              <input
                                type="number"
                                step="0.01"
                                value={edited?.valor || 0}
                                disabled={isReadOnly}
                                onChange={(e) => {
                                  const value = Number(e.target.value);
                                  setEditedPagamentos(prev =>
                                    prev.map(pg => (pg.id === pag.id ? { ...pg, valor: value } : pg))
                                  );
                                }}
                                className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-[#0b2f4a] font-mono text-right font-semibold"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Form de Gerar Parcelas */}
                {!isReadOnly && (
                  <div className="border-t border-slate-100 pt-6 space-y-4">
                    <h3 className="text-sm font-bold text-slate-800">Gerar Parcelas Automaticamente</h3>
                    {renderControlesFormatoModal()}
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Forma de Pagamento</label>
                        <select
                          value={pgtoFormaPagamento}
                          onChange={(e) => handleFormaPagamentoChange(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a] font-medium"
                        >
                          <option value="01">01 - Dinheiro</option>
                          <option value="02">02 - Cheque</option>
                          <option value="03">03 - Cartão de Crédito</option>
                          <option value="04">04 - Cartão de Débito</option>
                          <option value="15">15 - Boleto Bancário</option>
                          <option value="17">17 - PIX</option>
                          <option value="90">90 - Sem Pagamento</option>
                          <option value="99">99 - Outros</option>
                        </select>
                      </div>

                      {pgtoFormaPagamento === "15" ? (
                        <>
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">Valor de entrada</label>
                            <input
                              type="number"
                              step="0.01"
                              value={pgtoValorEntrada}
                              onChange={(e) => setPgtoValorEntrada(Number(e.target.value))}
                          disabled={pgtoParcelaUnica}
                              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">Qtd de parcelas futuras</label>
                            <input
                              type="number"
                              min={1}
                              value={pgtoQtdParcelas}
                              onChange={(e) => setPgtoQtdParcelas(Number(e.target.value))}
                          disabled={pgtoParcelaUnica}
                              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">Dias para primeira parcela futura</label>
                            <input
                              type="number"
                              min={0}
                              value={pgtoDiasPraInicio}
                              onChange={(e) => setPgtoDiasPraInicio(Number(e.target.value))}
                          disabled={pgtoParcelaUnica}
                              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">Intervalo entre parcelas futuras (Dias)</label>
                            <input
                              type="number"
                              min={1}
                              value={pgtoIntervalo}
                              onChange={(e) => setPgtoIntervalo(Number(e.target.value))}
                          disabled={pgtoParcelaUnica}
                              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a]"
                            />
                          </div>
                          <div className="md:col-span-5 flex justify-end">
                            <button
                              type="button"
                              onClick={handleGerarPagamentos}
                              disabled={isGeneratingPgto}
                              className="rounded-xl bg-[#0b2f4a] hover:bg-[#061d2e] px-6 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50"
                            >
                              {isGeneratingPgto ? "Gerando..." : "Gerar Parcelas Fiscais"}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="md:col-span-4 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-500 flex items-center h-[46px] mt-5">
                          ℹ️ Geração de parcelas permitida apenas para <strong>15 - Boleto Bancário</strong>. Outras formas de pagamento são tratadas como à vista.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        </BlocoConferencia>

        {/* Aba 7: Totais */}
        <BlocoConferencia id="Totais" estado={estadoDoBloco("Totais")} resumo={resumoDoBloco("Totais")} aberto={blocoAberto("Totais")} onAlternar={() => alternarBloco("Totais")}>
        {blocoAberto("Totais") && (
          <div className="space-y-6">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Layers className="h-5 w-5 text-[#0b2f4a]" /> Totais Fiscais Recalculados
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="border border-slate-100 p-6 rounded-2xl bg-slate-50/50 space-y-4">
                <h3 className="font-bold text-slate-800 text-sm border-b pb-2 border-slate-200">Detalhamento dos Valores</h3>
                <div className="space-y-3 text-sm text-slate-600">
                  <p className="flex justify-between">Valor Produtos: <strong>{formatCurrency(computedValorProdutos)}</strong></p>
                  <p className="flex justify-between">Valor Frete: <strong>{formatCurrency(valorFrete)}</strong></p>
                  <p className="flex justify-between border-b pb-2 border-slate-200">Valor Desconto: <strong>-{formatCurrency(note.valor_desconto)}</strong></p>
                  <p className="flex justify-between font-bold text-slate-900 text-base">Valor Líquido NF: <span>{formatCurrency(computedValorTotalNf)}</span></p>
                </div>
              </div>

              <div className="border border-slate-100 p-6 rounded-2xl bg-slate-50/50 space-y-4">
                <h3 className="font-bold text-slate-800 text-sm border-b pb-2 border-slate-200">Conciliação do Pagamento</h3>
                <div className="space-y-3 text-sm text-slate-600">
                  <p className="flex justify-between">Total da Fatura (Nota): <strong>{formatCurrency(computedValorTotalNf)}</strong></p>
                  <p className="flex justify-between border-b pb-2 border-slate-200">Soma das Parcelas: <strong>{formatCurrency(sumOfPayments)}</strong></p>
                  
                  {isPaymentMismatch ? (
                    <div className="flex flex-col gap-2 p-3 bg-red-50 border border-red-200 text-red-900 rounded-xl text-xs font-semibold">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                        Divergência Encontrada:
                      </div>
                      A soma das parcelas de fatura difere do total líquido da nota por {formatCurrency(Math.abs(computedValorTotalNf - sumOfPayments))}. Ajuste as parcelas de pagamento!
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 p-3 bg-emerald-50 border border-emerald-200 text-emerald-950 rounded-xl text-xs font-semibold">
                      <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                      Pagamento conciliado com sucesso! Os valores batem.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        </BlocoConferencia>

        {/* Aba 8: Informações adicionais */}
        <BlocoConferencia id="Informações adicionais" estado={estadoDoBloco("Informações adicionais")} resumo={resumoDoBloco("Informações adicionais")} aberto={blocoAberto("Informações adicionais")} onAlternar={() => alternarBloco("Informações adicionais")}>
        {blocoAberto("Informações adicionais") && (
          <div className="space-y-6">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-[#0b2f4a]" /> Informações Adicionais / Fisco
            </h2>
            <div className="grid grid-cols-1 gap-6">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Informações Complementares (Impresso na DANFE)</label>
                <textarea
                  rows={4}
                  value={infoComplementares}
                  disabled={isReadOnly}
                  onChange={(e) => setInfoComplementares(e.target.value)}
                  placeholder="Textos obrigatórios exigidos pela SEFAZ ou mensagens comerciais do pedido."
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a] font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Observações Internas (Somente ERP - Não constam no XML)</label>
                <textarea
                  rows={3}
                  value={obsInternas}
                  disabled={isReadOnly}
                  onChange={(e) => setObsInternas(e.target.value)}
                  placeholder="Anotações internas do time de faturamento."
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a] font-medium"
                />
              </div>
            </div>
          </div>
        )}
        </BlocoConferencia>

        {/* Aba 9: Validação */}
        <BlocoConferencia id="Validação" estado={estadoDoBloco("Validação")} resumo={resumoDoBloco("Validação")} aberto={blocoAberto("Validação")} onAlternar={() => alternarBloco("Validação")}>
        {blocoAberto("Validação") && (
          <div className="space-y-6">
            {/*
              "Rodar Validação" saiu: a mesma checagem já roda no Faturar, antes
              de a nota abrir, e de novo ao emitir. Um botão a menos para o
              operador decidir se aperta.
            */}
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-[#0b2f4a]" /> Checklist e Consistência Fiscal
              </h2>
              <span className="text-xs text-slate-400">
                Verificado ao faturar e ao emitir
              </span>
            </div>

            {/* Checklist de Validação */}
            <div className="border border-slate-200 rounded-3xl p-5 space-y-4">
              <ul className="space-y-3">
                <li className="flex items-center gap-3 text-sm">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                  <span className="text-slate-700">Dados da empresa emitente presentes</span>
                </li>
                <li className="flex items-center gap-3 text-sm">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                  <span className="text-slate-700">Documentação do cliente CPF/CNPJ cadastrado</span>
                </li>
                <li className="flex items-center gap-3 text-sm">
                  {editedItems.every(i => i.ncm && i.ncm.length === 8) ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
                  )}
                  <span className={editedItems.every(i => i.ncm && i.ncm.length === 8) ? "text-slate-700" : "text-amber-800 font-semibold"}>
                    Todos os itens contêm NCM com 8 dígitos numéricos
                  </span>
                </li>
                <li className="flex items-center gap-3 text-sm">
                  {editedItems.every(i => i.cfop && i.cfop.length === 4) ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
                  )}
                  <span className={editedItems.every(i => i.cfop && i.cfop.length === 4) ? "text-slate-700" : "text-amber-800 font-semibold"}>
                    Todos os itens contêm CFOP preenchido com 4 dígitos
                  </span>
                </li>
                <li className="flex items-center gap-3 text-sm">
                  {!isPaymentMismatch ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
                  )}
                  <span className={!isPaymentMismatch ? "text-slate-700" : "text-amber-800 font-semibold"}>
                    Total do pagamento coincide com o total da nota fiscal
                  </span>
                </li>
              </ul>

              {validationData?.pode_emitir ? (
                <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-950 rounded-2xl text-xs font-semibold">
                  Aprovado! O rascunho está estruturado de forma consistente e apto para faturamento no banco.
                </div>
              ) : (
                <div className="p-4 bg-amber-50 border border-amber-200 text-amber-950 rounded-2xl text-xs font-semibold space-y-2">
                  <div className="flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                    Erros/Bloqueios Fiscais Detectados:
                  </div>
                  {validationData?.pendencias_texto && validationData.pendencias_texto.length > 0 ? (
                    <ul className="list-disc pl-5 font-medium space-y-1">
                      {validationData.pendencias_texto.map((err: string, idx: number) => (
                        <li key={idx}>{err}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="font-medium">Nenhum erro bloqueante, execute o botão acima para conferir pendências reais.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        </BlocoConferencia>

        {/* Aba 10: Documentos/Preview */}
        <BlocoConferencia id="Documentos/Preview" estado={estadoDoBloco("Documentos/Preview")} resumo={resumoDoBloco("Documentos/Preview")} aberto={blocoAberto("Documentos/Preview")} onAlternar={() => alternarBloco("Documentos/Preview")}>
        {blocoAberto("Documentos/Preview") && (
          <div className="space-y-6">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <FileCode className="h-5 w-5 text-[#0b2f4a]" /> Preview Técnico e Retorno
            </h2>

            <div className="p-4 bg-amber-50 border border-amber-200 rounded-3xl flex gap-3 text-sm text-amber-900 font-medium">
              <Info className="h-5 w-5 text-amber-600 shrink-0" />
              <div>
                <h4 className="font-bold flex items-center gap-2">
                  Prévia sem validade fiscal
                  <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 bg-amber-200 text-amber-900 rounded">
                    PENDENTE
                  </span>
                </h4>
                <p className="text-xs text-slate-600 mt-1">
                  Este documento representa um rascunho de nota fiscal em ambiente de testes. Não houve transmissão real para o Focus API ou SEFAZ.
                </p>
              </div>
            </div>

            <div className="border border-slate-200 rounded-3xl overflow-hidden bg-slate-900 text-slate-300">
              <button
                type="button"
                onClick={() => {
                  if (!isPayloadOpen) {
                    handleLoadPayload();
                  } else {
                    setIsPayloadOpen(false);
                  }
                }}
                disabled={isPayloadLoading}
                className="flex w-full items-center justify-between px-6 py-4 text-xs font-semibold uppercase tracking-wider text-slate-400 hover:bg-slate-800 transition outline-none disabled:opacity-50"
              >
                <span className="flex items-center gap-2">
                  {isPayloadLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCode className="h-4 w-4" />}
                  Visualizar arquivo técnico da nota (JSON)
                </span>
                {isPayloadOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {isPayloadOpen && (
                <div className="border-t border-slate-800 p-5 bg-slate-950 text-xs font-mono text-emerald-400 overflow-x-auto max-h-[400px]">
                  {focusPayload ? (
                    <pre className="leading-relaxed">{JSON.stringify(focusPayload, null, 2)}</pre>
                  ) : (
                    <span className="text-slate-500 italic">Carregando payload estruturado do banco...</span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        </BlocoConferencia>
        </div>
      </div>

      {notaParaEmitir && (
        <EmissaoNfeModal
          key={notaParaEmitir.id}
          nota={notaParaEmitir}
          passoInicial="IDLE"
          onFechar={(desfecho) => {
            setNotaParaEmitir(null);
            // Nota autorizada é trabalho concluído: esta tela não serve mais
            // para nada e o próximo passo do operador está na Fila. Recarregar
            // a nota antes de sair seria buscar dados para uma tela que já
            // está saindo, então o retorno acontece direto.
            if (desfecho === "AUTHORIZED") {
              router.push("/notas-fiscais");
              return;
            }
            // Rejeitada, ainda processando, erro ou cancelado antes de emitir:
            // o operador continua aqui, que é onde ele corrige. Agora sim, com
            // a tela livre: reflete o novo estado da nota.
            void loadData(true);
          }}
          recarregar={async () => {
            // NAO chama loadData aqui: ele liga o spinner de tela cheia, que
            // fica antes do modal no render. Com o modal aberto, isso o
            // desmontava e o remontava no passo inicial - a confirmacao. Era por
            // isso que a tela "nao saia do modal" mesmo com desfecho resolvido.
            const row = await getNfeById(notaParaEmitir.id);
            return row ? mapSupabaseNfeRowToReadModel(row) : null;
          }}
        />
      )}

      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden flex flex-col transform transition-all scale-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 pt-6 pb-4 flex items-center gap-3">
              <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900 leading-tight">
                {confirmModal.title}
              </h3>
            </div>
            <div className="px-6 pb-6 text-sm text-slate-600 leading-relaxed">
              {confirmModal.message}
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end items-center gap-3">
              {confirmModal.showCancel !== false && (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmModal(prev => ({ ...prev, isOpen: false }));
                    if (confirmModal.onCancel) confirmModal.onCancel();
                  }}
                  className="px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition rounded-xl"
                >
                  {confirmModal.cancelText || "Cancelar"}
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  setConfirmModal(prev => ({ ...prev, isOpen: false }));
                  await confirmModal.onConfirm();
                }}
                className={`px-5 py-2.5 text-xs font-bold text-white rounded-xl shadow-sm transition flex items-center justify-center ${
                  confirmModal.title.toLowerCase().includes("remover") ||
                  confirmModal.title.toLowerCase().includes("invalidação") ||
                  confirmModal.title.toLowerCase().includes("excluir")
                    ? "bg-rose-600 hover:bg-rose-700"
                    : "bg-[#0b2f4a] hover:bg-[#061d2e]"
                }`}
              >
                {confirmModal.confirmText || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
