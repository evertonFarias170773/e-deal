"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CreditCard, Landmark, QrCode, ReceiptText, X, Copy, SlidersHorizontal, Check, Wallet } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import { getSaldoCredito, getSaldoContaCorrente } from "@/features/cobrancas/services/movimento-credito.service";
import { listPendenciasUtilizaveis, type ContaCorrentePendencia } from "@/features/cobrancas/services/conta-corrente.service";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { Field, PanelCard, inputClass, InfoBox } from "@/features/cobrancas/form-ui";
import type { Cobranca, CobrancaTipo, CriarCobrancaFormValues, CreditAnalysisResult, ModeloCobranca } from "@/features/cobrancas/types";
import type { Proposta } from "@/features/orcamentos/types";
import { CobrancaDetail } from "@/features/cobrancas/CobrancaDetail";
import { CancelCobrancaModal } from "./CancelCobrancaModal";
import { CorrigirTelefonePagadorModal } from "./CorrigirTelefonePagadorModal";
import { getSupabaseClient } from "@/lib/supabase/client";
import { resolverTelefonePagador } from "@/lib/telefone/telefone-br";
import {
  getLiberacaoPedidoLabel,
  getLiberacaoPedidoStatus,
  getLiberacaoPedidoTone,
  getSituacaoFinanceiraPropostaLabel,
  isCreditoPendente,
  isPropostaLiberadaParaPedido,
  EMPRESAS_RECEBEDORAS_FIXAS,
  roundMoney
} from "@/features/cobrancas/cobrancas-utils";
import { formatCurrency } from "@/lib/formatters/currency";
import {
  criarCobrancaInitialValues,
  getCobrancaTipoLabel,
  getEmpresaRecebedoraByProposta,
  getMensagemTipoIndisponivel,
  isTipoDisponivelParaEmpresa
} from "@/lib/mocks/pagamentos.mock";

type PropostaCobrancaPanelProps = {
  proposta: Proposta;
  isModalOpen?: boolean;
  onOpenModal?: () => void;
  onCloseModal?: () => void;
  defaultModalOpen?: boolean;
  onlyModal?: boolean;
  onSavePropostaRequest?: () => Promise<boolean>;
  onRefreshProposta?: () => void;
  onPagamentoIntegralConcluido?: () => void;
};

function getInitialEmpresaFromProposta(proposta: Proposta): { id_empresa: number; empresa: string } {
  const empresaPadrao = proposta.cliente?.empresaPadrao?.trim();
  
  if (empresaPadrao && empresaPadrao !== "Não informado" && empresaPadrao !== "Não Informado") {
    const normalized = empresaPadrao.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (normalized.includes("eireli") || normalized.includes("grafica expressa") || normalized.includes("grafica")) {
      if (normalized.includes("biro")) {
        return { id_empresa: 2, empresa: "IDEAL BIRÔ SERV. GRAFICOS" };
      }
      return { id_empresa: 1, empresa: "IDEAL GRÁFICA EXPRESSA EIRELI" };
    }
    if (normalized.includes("biro")) {
      return { id_empresa: 2, empresa: "IDEAL BIRÔ SERV. GRAFICOS" };
    }
    if (normalized.includes("e3") || normalized.includes("brindes")) {
      return { id_empresa: 3, empresa: "E3 BRINDES LTDA" };
    }
  }

  const propEmpresa = proposta.empresa?.trim() || "";
  const normalizedProp = propEmpresa.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (normalizedProp.includes("eireli") || normalizedProp.includes("grafica expressa") || normalizedProp.includes("grafica")) {
    if (normalizedProp.includes("biro")) {
      return { id_empresa: 2, empresa: "IDEAL BIRÔ SERV. GRAFICOS" };
    }
    return { id_empresa: 1, empresa: "IDEAL GRÁFICA EXPRESSA EIRELI" };
  }
  if (normalizedProp.includes("biro")) {
    return { id_empresa: 2, empresa: "IDEAL BIRÔ SERV. GRAFICOS" };
  }
  if (normalizedProp.includes("e3") || normalizedProp.includes("brindes")) {
    return { id_empresa: 3, empresa: "E3 BRINDES LTDA" };
  }

  return { id_empresa: 1, empresa: "IDEAL GRÁFICA EXPRESSA EIRELI" };
}

/**
 * Rótulo da modalidade. Cartão padrão e Cartão Asas compartilham o mesmo
 * tipo_cobranca (CARD_PARCELADO), então o fluxo é o que os distingue na tela.
 * O rótulo entra na descrição gravada e é o marcador usado para reaproveitar a
 * cobrança em nova tentativa.
 */
function getRotuloModalidade(tipo: CobrancaTipo, fluxoCartao?: "PADRAO" | "ASAS"): string {
  if (tipo === "CARD_PARCELADO" && fluxoCartao === "ASAS") {
    return "Cartão Asas";
  }
  return getCobrancaTipoLabel(tipo);
}

/**
 * Empresa recebedora habilitada para o Cartão Asaas: IDEAL GRÁFICA EXPRESSA
 * EIRELI. Comparação sempre por ID — nunca por nome da empresa.
 */
const EMPRESA_CARTAO_ASAAS = 1;

/**
 * Rótulo exibido na tela. Difere de `getRotuloModalidade` de propósito: aquele
 * é o marcador gravado na descrição (`MARCADOR_CARTAO_ASAS`) e casa cobranças
 * já existentes — mudar o texto dele quebraria esse pareamento.
 */
function getRotuloModalidadeExibicao(tipo: CobrancaTipo, fluxoCartao?: "PADRAO" | "ASAS"): string {
  if (tipo === "CARD_PARCELADO" && fluxoCartao === "ASAS") {
    return "Cartão Asaas";
  }
  return getRotuloModalidade(tipo, fluxoCartao);
}

/**
 * Modalidades que mandam o telefone do pagador para o provedor: cartão (C6 e
 * Asaas, ambos `CARD_PARCELADO`) e boleto. PIX e faturado não entram.
 *
 * No checkout do C6 os dados do pagador ficam BLOQUEADOS na tela — telefone
 * errado deixa o cliente sem conseguir pagar, e o vendedor só descobre quando
 * ele reclama. Por isso o gate é aqui, antes de a cobrança existir.
 */
function exigeTelefoneValido(tipo: CobrancaTipo): boolean {
  return tipo === "CARD_PARCELADO" || tipo === "BOLETO";
}

/**
 * Cartão exige CELULAR, não só telefone válido: o campo do checkout do provedor
 * é "Celular" e recusa fixo na tela, mesmo o fixo passando no regex da API.
 * Boleto segue aceitando fixo — lá o telefone não passa por tela de validação.
 */
function exigeCelular(tipo: CobrancaTipo): boolean {
  return tipo === "CARD_PARCELADO";
}

/** Empresas recebedoras conhecidas, para as quais vale a regra por ID. */
const EMPRESAS_COM_REGRA_POR_ID = new Set([1, 2, 3]);

/**
 * Formas de pagamento habilitadas por empresa recebedora.
 *
 * Depende SOMENTE do id da empresa — nunca do estado de carregamento da lista
 * de cobranças. Antes esta decisão era feita por `source === "supabase"`, que é
 * estado de carga, não regra de negócio: enquanto as ~6 páginas de
 * `pagamentos_v2` não terminavam de carregar, `source` valia "mock" e a
 * disponibilidade caía na tabela de mock — indexada por nomes fictícios
 * ("Ideal Grafica") que nunca casam com o texto real gravado em
 * `propostas.empresa` ("IDEAL GRÁFICA EXPRESSA EIRELI"), bloqueando TODAS as
 * formas de pagamento.
 *
 * O fallback por nome fica só para empresa fora da lista conhecida.
 */
function isFormaPagamentoDisponivel(
  opcaoId: CobrancaTipo | "CARD_ASAS",
  idEmpresa: number,
  empresaNomeFallback: string
): boolean {
  if (!EMPRESAS_COM_REGRA_POR_ID.has(idEmpresa)) {
    return isTipoDisponivelParaEmpresa(
      empresaNomeFallback,
      opcaoId === "CARD_ASAS" ? "CARD_PARCELADO" : opcaoId
    );
  }

  if (opcaoId === "PIX") return idEmpresa === 1 || idEmpresa === 2 || idEmpresa === 3;
  if (opcaoId === "BOLETO") return idEmpresa === 1 || idEmpresa === 2 || idEmpresa === 3;
  if (opcaoId === "CARD_ASAS") return idEmpresa === EMPRESA_CARTAO_ASAAS;
  if (opcaoId === "CARD_PARCELADO") return idEmpresa === 1 || idEmpresa === 3;
  return true;
}

export function PropostaCobrancaPanel({
  proposta,
  isModalOpen,
  onOpenModal,
  onCloseModal,
  defaultModalOpen = false,
  onlyModal = false,
  onSavePropostaRequest,
  onRefreshProposta,
  onPagamentoIntegralConcluido
}: PropostaCobrancaPanelProps) {
  const { showToast } = useAppToast();
  const { createCobranca, getCobrancasByProposta, source, cobrancas, refreshCobrancas } = useCobrancas();
  const { user } = useAuth();
  
  const [saldoCredito, setSaldoCredito] = useState<number>(0);
  const [isLoadingSaldo, setIsLoadingSaldo] = useState(false);
  const [refreshingSaldo, setRefreshingSaldo] = useState(false);

  // Permissão
  const canUsarCredito = Boolean(
    user?.isSuperAdmin ||
    user?.isAdmin ||
    (user?.id_perfil != null && user.permissoes?.includes("*")) ||
    (user?.id_perfil != null && user.permissoes?.includes("credito.usar"))
  );

  // saldoDevedor: valor em aberto do cliente na conta corrente (independente de saldoCredito,
  // que é sempre >=0). Usado para o lembrete de abatimento de débito ao gerar cobrança.
  // É apenas informativo — nunca bloqueia a criação de cobrança/pedido.
  const [saldoDevedor, setSaldoDevedor] = useState<number>(0);
  // pendenciaDebitoAlvo: pendência de débito (FAVOR_EMPRESA) mais antiga em aberto
  // (FIFO) — v1 reserva contra UMA única pendência por cobrança (sem abranger
  // múltiplas pendências numa mesma reserva). O teto de "incluir débito" é o
  // saldo desta pendência específica, não o saldoDevedor total (que pode somar
  // várias pendências).
  const [pendenciaDebitoAlvo, setPendenciaDebitoAlvo] = useState<ContaCorrentePendencia | null>(null);

  const idClienteAtual = proposta.cliente?.idCliente;

  const fetchSaldo = useCallback(async () => {
    if (!idClienteAtual) return;
    setIsLoadingSaldo(true);
    try {
      const [s, saldoReal, pendenciasDebito] = await Promise.all([
        getSaldoCredito(idClienteAtual),
        getSaldoContaCorrente(idClienteAtual),
        listPendenciasUtilizaveis(idClienteAtual, "FAVOR_EMPRESA"),
      ]);
      setSaldoCredito(s);
      setSaldoDevedor(saldoReal < 0 ? Math.round(Math.abs(saldoReal) * 100) / 100 : 0);
      setPendenciaDebitoAlvo(pendenciasDebito[0] ?? null);
    } catch (err) {
      console.error("[PropostaCobrancaPanel] Erro ao carregar saldo de crédito:", err);
    } finally {
      setIsLoadingSaldo(false);
    }
  }, [idClienteAtual]);

  useEffect(() => {
    fetchSaldo();
  }, [fetchSaldo]);

  const [internalModalOpen, setInternalModalOpen] = useState(defaultModalOpen);
  const [selectedCobrancaId, setSelectedCobrancaId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Chave de idempotência por tentativa de aplicação de crédito (E-CREDITO /
  // pagamento combinado). Persiste entre retries do MESMO clique (mesma
  // operação lógica) e só é renovada após um desfecho terminal (sucesso,
  // combinado parcial ou reabertura do modal) — nunca por janela de tempo.
  const chaveIdempotenciaECreditoRef = useRef<string | null>(null);
  const [isUserEditingValor, setIsUserEditingValor] = useState(false);
  const [tipoSecundario, setTipoSecundario] = useState<CobrancaTipo>("PIX");
  const [condicaoSecundaria, setCondicaoSecundaria] = useState<string>("");
  const cobrancasDaProposta = getCobrancasByProposta(proposta.id_int);
  const cobrancasAtivas = cobrancasDaProposta.filter((item) => item.status !== "CANCELADO");
  const totalPropostaRounded = roundMoney(proposta.resumo.valorTotal);
  const totalCobradoReal = cobrancasAtivas.reduce((total, item) => total + getValorCobranca(item), 0);
  const totalCobradoRealRounded = roundMoney(totalCobradoReal);
  const saldoRestante = Math.max(totalPropostaRounded - totalCobradoRealRounded, 0);
  const hasCobrancaExcedente = totalCobradoRealRounded > totalPropostaRounded;
  const totalGerado = Math.min(totalCobradoRealRounded, totalPropostaRounded);
  const isControlled = typeof isModalOpen === "boolean";
  const modalOpen = (isControlled ? Boolean(isModalOpen) : internalModalOpen) && (saldoRestante > 0);
  const situacaoFinanceira = getSituacaoFinanceiraPropostaLabel(cobrancasDaProposta);
  const liberacaoStatus = getLiberacaoPedidoStatus(cobrancasDaProposta);
  const propostaLiberada = isPropostaLiberadaParaPedido(cobrancasDaProposta);

  // Abonar diferença (exclusivo de administrador): disponível enquanto a
  // proposta paga tiver saldo devedor não coberto por cobrança ativa. O valor
  // é recalculado no servidor — o botão só decide visibilidade.
  const isAdminUser = Boolean(user?.isSuperAdmin || user?.isAdmin);
  const valorPagoConfirmadoPanel = roundMoney(
    cobrancasAtivas
      .filter((c) => c.status === "PAID" || (c.status === "A_VENCER" && c.confirmado))
      .reduce((sum, c) => sum + (Number(c.valor) || 0), 0)
  );
  const podeAbonarDiferenca = isAdminUser && saldoRestante > 0 && valorPagoConfirmadoPanel > 0;
  const [isAbonando, setIsAbonando] = useState(false);

  async function handleAbonarDiferenca() {
    if (isAbonando) return;
    const confirmado = window.confirm(
      `Abonar a diferença de ${formatCurrency(saldoRestante)} da proposta #${proposta.id_int}?\n\n` +
      `Será registrado um desconto nesse valor exato, o total da proposta será recalculado e a ação ficará registrada no Histórico.`
    );
    if (!confirmado) return;

    setIsAbonando(true);
    try {
      const client = getSupabaseClient();
      const session = (await client?.auth.getSession())?.data.session;
      const token = session?.access_token;
      if (!token) throw new Error("Sessão expirada. Autentique-se novamente.");

      const res = await fetch("/api/orcamentos/abonar-diferenca", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ idInt: proposta.id_int }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `Falha ao abonar diferença (HTTP ${res.status}).`);
      }

      showToast({
        type: "success",
        title: "Diferença abonada",
        description: `${formatCurrency(json.valorAbonado)} abonados como desconto. Novo total: ${formatCurrency(json.novoTotal)}.`,
      });
      if (onRefreshProposta) onRefreshProposta();
      await fetchSaldo();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast({ type: "error", title: "Falha ao abonar diferença", description: msg });
    } finally {
      setIsAbonando(false);
    }
  }

  /** Retorna data futura no formato YYYY-MM-DD (padrão: 30 dias à frente). */
  function getDefaultVencimento(daysAhead = 3): string {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /**
   * Nova tentativa automática de gerar o PIX de uma cobrança pendente já
   * criada (ex.: pagamento combinado em que o E-Crédito foi aplicado mas a
   * emissão do PIX falhou). Chama /api/cobrancas/gerar-pix — idempotente:
   * se o PIX já tiver sido gerado por outra tentativa, retorna os dados
   * existentes sem rechamar o Banco Inter. Nunca cria pagamento novo nem
   * mexe em crédito — só (re)tenta a integração para a MESMA cobrança.
   */
  async function tentarGerarPixNovamente(
    cobrancaId: string,
    idPagamentoCobranca: string | null | undefined,
    idEmpresaCobranca: number,
    valorNominal: number,
    token: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const seuNumero = idEmpresaCobranca === 2 ? (idPagamentoCobranca || String(proposta.id_int)) : String(proposta.id_int);
      const res = await fetch("/api/cobrancas/gerar-pix", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          cobrancaId,
          idEmpresa: idEmpresaCobranca,
          seuNumero,
          valorNominal,
          dataVencimento: getDefaultVencimento(0),
          telefone: proposta.contato?.whatsapp || proposta.cliente?.whatsapp || "",
          cpfCnpj: proposta.cliente?.documento || "",
          nome: pagador?.nome || proposta.cliente?.nome || "Cliente",
          endereco: `${proposta.enderecoEntrega?.endereco || ""}, ${proposta.enderecoEntrega?.numero || ""} ${proposta.enderecoEntrega?.complemento || ""}`.trim(),
          cidade: proposta.enderecoEntrega?.cidade || "",
          uf: proposta.enderecoEntrega?.uf || "",
          cep: proposta.enderecoEntrega?.cep || ""
        })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        return { success: false, error: json?.message || `Falha ao gerar PIX (HTTP ${res.status}).` };
      }
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  function buildInitialFormState(): CriarCobrancaFormValues {
    // Só reaproveita OS numérica: `Cobranca.os_ideal` cai para `id_pagamento`
    // ("20130-A") quando a coluna está nula, e esse texto contornava a máscara
    // do input e quebrava o insert (`os_ideal` é integer no banco).
    const cobrancaComOs = cobrancasDaProposta.find((item) => /^\d+$/.test((item.os_ideal || "").trim()));
    const defaultOsIdeal = cobrancaComOs ? cobrancaComOs.os_ideal.trim() : "";
    const initialEmp = getInitialEmpresaFromProposta(proposta);

    return {
      ...criarCobrancaInitialValues,
      propostaIdInt: proposta.id_int,
      valor: roundMoney(saldoRestante),
      descricao: saldoRestante < totalPropostaRounded
        ? `Cobrança complementar da proposta #${proposta.id_int}`
        : `Cobrança da proposta #${proposta.id_int}`,
      observacao: proposta.observacoes,
      condicaoPagamento: proposta.formaPagamento,
      vencimento: getDefaultVencimento(30),
      osIdeal: defaultOsIdeal,
      modeloFatu: "BOLETO",
      id_empresa: initialEmp.id_empresa,
      empresa: initialEmp.empresa
    };
  }

  const [form, setForm] = useState<CriarCobrancaFormValues>(buildInitialFormState);

  useEffect(() => {
    setIsUserEditingValor(false);
    setForm(buildInitialFormState());
    setTipoSecundario("PIX");
    setCondicaoSecundaria("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposta.id_int]);

  useEffect(() => {
    if (!isUserEditingValor) {
      setForm((current) => ({ ...current, valor: roundMoney(saldoRestante) }));
    }
  }, [saldoRestante, isUserEditingValor]);

  const isFaturado = ["E-FATURADO", "E-RETRABALHO", "E-PERMUTA", "E-AMOSTRA"].includes(form.tipoCobranca);
  const idEmpresaReal = form.id_empresa ?? (source === "supabase" ? getEmpresaIdByNome(proposta.empresa) : 1);
  const empresa = EMPRESAS_RECEBEDORAS_FIXAS.find((e) => e.id === idEmpresaReal) || EMPRESAS_RECEBEDORAS_FIXAS[0];
  const [realCreditAnalysis, setRealCreditAnalysis] = useState<CreditAnalysisResult | null>(null);
  const [isLoadingCredit, setIsLoadingCredit] = useState(false);
  const [nowTime, setNowTime] = useState<number>(0);
  const [showPendingAlert, setShowPendingAlert] = useState(false);
  // Lembrete de débito ao gerar cobrança — não bloqueia, apenas pergunta antes de prosseguir.
  const [showDebitoModal, setShowDebitoModal] = useState(false);
  const [debitoResolvido, setDebitoResolvido] = useState(false);
  const [debitoIncluido, setDebitoIncluido] = useState<number>(0);
  const [debitoInputValor, setDebitoInputValor] = useState<string>("");
  const [modelosCobranca, setModelosCobranca] = useState<ModeloCobranca[]>([]);
  const [modeloSelecionadoId, setModeloSelecionadoId] = useState<string>("");
  /** Pagador efetivo: resolvido via proposta.id_faturado; fallback = cliente principal */
  const [pagador, setPagador] = useState<{
    idCliente: number;
    nome: string;
    documento: string;
    padraoPagamento?: string;
    idModeloCobranca?: string;
  } | null>(null);

  /**
   * Telefones do PAGADOR, lidos do cadastro. É o mesmo cadastro que o n8n
   * consulta na hora de abrir o checkout (`pagamentos_v2.id_cliente` → clientes),
   * então a checagem aqui e a de lá enxergam exatamente o mesmo dado.
   */
  const [fonesPagador, setFonesPagador] = useState<{
    /** Dono dos telefones. Trocando o pagador, o lote anterior deixa de valer. */
    idCliente: number;
    whatsapp1: string | null;
    whatsapp2: string | null;
    telefoneFixo: string | null;
  } | null>(null);
  const [telefoneModalOpen, setTelefoneModalOpen] = useState(false);
  const [modalidadeBloqueada, setModalidadeBloqueada] = useState("");
  /** Cartão só aceita celular; boleto aceita fixo. Define o rigor do modal. */
  const [somenteCelularNoModal, setSomenteCelularNoModal] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setNowTime(Date.now());
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    const fetchModelos = async () => {
      const client = getSupabaseClient();
      if (!client) return;
      const { data, error } = await client
        .from("modelos_cobranca")
        .select("*")
        .order("modelo", { ascending: true })
        .order("inicio", { ascending: true })
        .order("qtd_parcela", { ascending: true })
        .order("intervalo", { ascending: true });
      if (!error && data) {
        setModelosCobranca(data as ModeloCobranca[]);
      }
    };
    void fetchModelos();
  }, [modalOpen]);

  // Carrega dados do pagador efetivo (id_faturado) ao abrir o modal
  useEffect(() => {
    if (!modalOpen) return;

    const idFaturado = proposta.id_faturado;
    const idClientePrincipal = Number(proposta.cliente.idCliente);

    // Sem id_faturado ou igual ao cliente principal → usa cliente da proposta (fallback seguro)
    if (!idFaturado || idFaturado === idClientePrincipal) {
      setPagador({
        idCliente: idClientePrincipal,
        nome: proposta.cliente.nome,
        documento: proposta.cliente.documento,
        padraoPagamento: proposta.cliente.padraoPagamento,
        idModeloCobranca: proposta.cliente.modeloCobrancaId ?? undefined
      });
      return;
    }

    // id_faturado preenchido e diferente do cliente principal → busca no banco
    const supabase = getSupabaseClient();
    if (!supabase) {
      setPagador({ idCliente: idClientePrincipal, nome: proposta.cliente.nome, documento: proposta.cliente.documento });
      return;
    }

    void (async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("id_cliente, nome, documento, padrao_pagamento, id_modelo_cobranca")
        .eq("id_cliente", idFaturado)
        .maybeSingle();

      if (!error && data) {
        setPagador({
          idCliente: Number(data.id_cliente),
          nome: String(data.nome || proposta.cliente.nome),
          documento: String(data.documento || proposta.cliente.documento),
          padraoPagamento: data.padrao_pagamento ? String(data.padrao_pagamento) : undefined,
          idModeloCobranca: data.id_modelo_cobranca ? String(data.id_modelo_cobranca) : undefined
        });
      } else {
        // Fallback seguro para propostas antigas ou erro de leitura
        setPagador({ idCliente: idClientePrincipal, nome: proposta.cliente.nome, documento: proposta.cliente.documento });
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, proposta.id_faturado, proposta.cliente.idCliente]);

  // Telefones do pagador. Busca sempre no banco (e não em proposta.cliente):
  // a proposta carrega um telefone só, e a regra do provedor percorre
  // whatsapp_1 → whatsapp_2 → telefone_fixo. Ler campo diferente do que o n8n lê
  // faria a tela aprovar o que o checkout depois recusa.
  useEffect(() => {
    const idCliente = pagador?.idCliente;
    if (!modalOpen || !idCliente) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    let cancelado = false;
    void (async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("whatsapp_1, whatsapp_2, telefone_fixo")
        .eq("id_cliente", idCliente)
        .maybeSingle();

      if (cancelado) return;

      if (error || !data) {
        // Sem leitura confiável não se afirma que o telefone está errado: o
        // gate só bloqueia com dado em mãos (ver bloqueiaPorTelefone).
        console.error("[PropostaCobrancaPanel] Falha ao ler telefones do pagador:", error?.message);
        return;
      }

      setFonesPagador({
        idCliente,
        whatsapp1: data.whatsapp_1 ?? null,
        whatsapp2: data.whatsapp_2 ?? null,
        telefoneFixo: data.telefone_fixo ?? null
      });
    })();

    return () => {
      cancelado = true;
    };
  }, [modalOpen, pagador?.idCliente]);

  // Pré-seleciona tipoCobranca baseado no padrao_pagamento do pagador
  useEffect(() => {
    if (!pagador?.padraoPagamento) return;
    const pp = pagador.padraoPagamento.toUpperCase().trim();
    let tipo: CobrancaTipo | null = null;
    if (pp === "PIX") tipo = "PIX";
    else if (pp === "BOLETO") tipo = "BOLETO";
    else if (pp === "CARTAO" || pp === "CARTÃO") tipo = "CARD_PARCELADO";
    else if (pp === "FATURADO") tipo = "E-FATURADO";
    if (tipo) setForm((current) => ({ ...current, tipoCobranca: tipo as CobrancaTipo }));
   
  }, [pagador?.padraoPagamento]);

  // Pré-seleciona Modelo de Cobrança baseado em clientes.id_modelo_cobranca do pagador
  // (resultado vem de modelos_cobranca.resultado; o id é a chave de match)
  useEffect(() => {
    if (!pagador?.idModeloCobranca || modelosCobranca.length === 0) return;
    const exists = modelosCobranca.some(m => String(m.id) === String(pagador.idModeloCobranca));
    if (exists) setModeloSelecionadoId(pagador.idModeloCobranca);
  }, [pagador?.idModeloCobranca, modelosCobranca]);

  // Reset credit analysis state during render when criteria changes
  if ((!isFaturado || source !== "supabase" || !proposta.cliente.idCliente) && realCreditAnalysis !== null) {
    setRealCreditAnalysis(null);
  }

  useEffect(() => {
    if (!isFaturado || source !== "supabase" || !proposta.cliente.idCliente) {
      return;
    }

    let active = true;
    async function fetchCredit() {
      setIsLoadingCredit(true);
      try {
        const client = getSupabaseClient();
        if (!client) return;

        const { data, error } = await client.rpc("fn_analise_credito_cliente", {
          p_id_cliente: proposta.cliente.idCliente
        });

        if (active && !error && data && data.length > 0) {
          setRealCreditAnalysis(data[0] as CreditAnalysisResult);
        }
      } catch (err) {
        console.error("Erro ao buscar análise de crédito real:", err);
      } finally {
        if (active) {
          setIsLoadingCredit(false);
        }
      }
    }

    void fetchCredit();
    return () => {
      active = false;
    };
  }, [isFaturado, proposta.cliente.idCliente, source]);

  // Mesma correção do bloco de opções: a disponibilidade segue o id da empresa,
  // nunca o estado de carregamento (`source`). Ver isFormaPagamentoDisponivel.
  const tipoDisponivel = EMPRESAS_COM_REGRA_POR_ID.has(idEmpresaReal)
    ? (form.tipoCobranca === "E-CREDITO"
        ? true
        : form.tipoCobranca === "PIX"
        ? (idEmpresaReal === 1 || idEmpresaReal === 2 || idEmpresaReal === 3)
        : form.tipoCobranca === "BOLETO"
          ? (idEmpresaReal === 1 || idEmpresaReal === 2 || idEmpresaReal === 3)
          : form.tipoCobranca === "CARD_PARCELADO"
            ? (idEmpresaReal === 1 || idEmpresaReal === 3)
            : isFaturado
              ? true
              : false)
    : isTipoDisponivelParaEmpresa(proposta.empresa, form.tipoCobranca);

  const indisponibilidadeMensagem = EMPRESAS_COM_REGRA_POR_ID.has(idEmpresaReal)
    ? (form.tipoCobranca === "PIX"
        ? (idEmpresaReal === 1 || idEmpresaReal === 2 || idEmpresaReal === 3 ? "" : "PIX real disponível apenas para as empresas Ideal Gráfica, Ideal Birô e E3 Brindes.")
        : form.tipoCobranca === "BOLETO"
          ? (idEmpresaReal === 1 || idEmpresaReal === 2 || idEmpresaReal === 3 ? "" : "Boleto real não disponível para esta empresa.")
          : form.tipoCobranca === "CARD_PARCELADO"
            ? (idEmpresaReal === 1 || idEmpresaReal === 3 ? "" : "Cartão de crédito real disponível apenas para as empresas Ideal Gráfica e E3 Brindes.")
            : isFaturado
              ? ""
              : "Esta forma de pagamento está em preparação para o ambiente real.")
    : getMensagemTipoIndisponivel(proposta.empresa, form.tipoCobranca);

  const cobrancasAtivasTudo = useMemo(() => {
    return (cobrancas || []).filter((item) => item.status !== "CANCELADO");
  }, [cobrancas]);

  const analiseCredito = useMemo(() => {
    if (source === "supabase" && realCreditAnalysis) {
      const limite = realCreditAnalysis.limite_credito;
      const disponivel = realCreditAnalysis.limite_disponivel;
      const utilizado = realCreditAnalysis.utilizado;
      const qtdAtrasados = realCreditAnalysis.qtd_pagamentos_atrasados;
      
      const aprovado = disponivel >= form.valor && qtdAtrasados === 0;

      return {
        limite,
        utilizado,
        disponivel,
        valorSolicitado: form.valor,
        risco: realCreditAnalysis.risco_credito,
        qtdAtrasados,
        statusAnalise: aprovado ? "APROVADO" as const : "AGUARDANDO_FINANCEIRO" as const,
        mensagem: aprovado 
          ? "Crédito disponível e sem cobranças vencidas." 
          : (qtdAtrasados > 0 
              ? "Cliente com cobrança vencida em aberto. Solicitação enviada para avaliação do financeiro."
              : "Limite de crédito insuficiente. Solicitação enviada para avaliação do financeiro.")
      };
    }

    const mockOverdue = cobrancasAtivasTudo.some((cob) => {
      if (cob.id_cliente !== proposta.cliente.idCliente || cob.status === "PAID" || cob.status === "CANCELADO" || !cob.vencimento) {
        return false;
      }
      const vencDate = new Date(cob.vencimento + "T23:59:59");
      return vencDate.getTime() < nowTime;
    });

    const disponivel = proposta.cliente.creditoDisponivel;
    const limite = proposta.cliente.limiteCredito;
    const utilizado = Math.max(0, limite - disponivel);
    const aprovado = disponivel >= form.valor && !mockOverdue;

    return {
      limite,
      utilizado,
      disponivel,
      valorSolicitado: form.valor,
      risco: proposta.cliente.riscoCredito,
      qtdAtrasados: mockOverdue ? 1 : 0,
      statusAnalise: aprovado ? "APROVADO" as const : "AGUARDANDO_FINANCEIRO" as const,
      mensagem: aprovado 
        ? "Crédito disponível. Faturamento liberado." 
        : "Crédito insuficiente ou com cobrança vencida."
    };
  }, [form.valor, proposta, source, realCreditAnalysis, cobrancasAtivasTudo]);

  const openModal = useCallback(() => {
    if (proposta.clienteNaoCadastrado || proposta.cliente.idCliente === null || proposta.cliente.idCliente === undefined || Number(proposta.cliente.idCliente) === 0) {
      showToast({
        type: "error",
        title: "Ação bloqueada",
        description: "Cadastre ou vincule um cliente antes de gerar cobrança."
      });
      return;
    }

    if (saldoRestante <= 0) {
      showToast({
        type: "warning",
        title: "Ação bloqueada",
        description: "Esta proposta já foi totalmente cobrada (saldo restante é R$ 0,00)."
      });
      return;
    }

    // Mantém o estado atual para preservar o rascunho.

    if (!isControlled) {
      setInternalModalOpen(true);
    }

    onOpenModal?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isControlled, onOpenModal, saldoRestante]);

  const closeModal = useCallback(() => {
    if (!isControlled) {
      setInternalModalOpen(false);
    }
    // Reseta a decisão de abatimento de débito para a próxima vez que o modal abrir.
    setDebitoResolvido(false);
    setDebitoIncluido(0);
    setDebitoInputValor("");

    onCloseModal?.();
  }, [isControlled, onCloseModal, setDebitoResolvido, setDebitoIncluido, setDebitoInputValor]);

  useEffect(() => {
    if (!modalOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeModal();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeModal, modalOpen]);

  function patchForm(patch: Partial<CriarCobrancaFormValues>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  /**
   * Troca da empresa recebedora. Se o Cartão Asaas estava selecionado e a nova
   * empresa não é a habilitada, a seleção é limpa (volta ao estado sem forma
   * escolhida) em vez de herdar silenciosamente outra modalidade de cartão.
   */
  function handleEmpresaChange(selectedId: number) {
    const matched = EMPRESAS_RECEBEDORAS_FIXAS.find((e) => e.id === selectedId);
    if (!matched) return;

    const perdeuCartaoAsaas =
      form.tipoCobranca === "CARD_PARCELADO" &&
      form.cartaoFluxo === "ASAS" &&
      matched.id !== EMPRESA_CARTAO_ASAAS;

    patchForm({
      id_empresa: matched.id,
      empresa: matched.nome,
      // "" = nenhuma forma selecionada; handleSubmit já barra esse estado.
      ...(perdeuCartaoAsaas
        ? { tipoCobranca: "" as CobrancaTipo, cartaoFluxo: undefined, parcelaSelecionada: undefined }
        : {})
    });

    if (perdeuCartaoAsaas) {
      showToast({
        type: "warning",
        title: "Cartão Asaas indisponível para esta empresa",
        description: "A seleção foi limpa. Escolha outra forma de pagamento."
      });
    }
  }

  /**
   * Telefone do pagador pela MESMA cadeia e regra do n8n. Enquanto a leitura do
   * cadastro não terminou (`fonesPagador === null`), não se afirma nada: sem
   * dado em mãos o gate não bloqueia, e o n8n segue como rede de segurança.
   */
  const fonesDoPagadorAtual =
    fonesPagador && fonesPagador.idCliente === pagador?.idCliente ? fonesPagador : null;

  /**
   * Abre o modal de correção e devolve `true` quando a modalidade escolhida não
   * pode seguir. Usado nos dois pontos: na escolha da forma (avisa cedo) e no
   * submit (o estado pode ter mudado depois da escolha).
   */
  function bloqueiaPorTelefone(tipo: CobrancaTipo, fluxoCartao?: "PADRAO" | "ASAS"): boolean {
    if (!exigeTelefoneValido(tipo)) return false;
    if (!fonesDoPagadorAtual) return false;

    const somenteCelular = exigeCelular(tipo);
    if (resolverTelefonePagador(fonesDoPagadorAtual, { somenteCelular }).valido) return false;

    setSomenteCelularNoModal(somenteCelular);
    setModalidadeBloqueada(getRotuloModalidadeExibicao(tipo, fluxoCartao));
    setTelefoneModalOpen(true);
    return true;
  }

  function handleTipoChange(tipo: CobrancaTipo, fluxoCartao?: "PADRAO" | "ASAS") {
    // Avisa no momento da escolha, com o vendedor ainda no contexto e sem nada
    // criado. A seleção é mantida: corrigido o telefone, ele segue de onde parou.
    bloqueiaPorTelefone(tipo, fluxoCartao);

    patchForm({
      tipoCobranca: tipo,
      // Só cartão carrega fluxo. Outra modalidade limpa o campo para que uma
      // seleção anterior de Asas não vaze para PIX/boleto/faturado.
      cartaoFluxo: tipo === "CARD_PARCELADO" ? (fluxoCartao ?? "PADRAO") : undefined,
      parcelaSelecionada: undefined,
      condicaoPagamento: tipo === "CARD_PARCELADO" ? "Cartão de crédito" : (tipo === "E-FATURADO" ? "Faturado" : proposta.formaPagamento),
      vencimento: tipo === "BOLETO" || tipo === "E-FATURADO" ? form.vencimento || getDefaultVencimento(30) : form.vencimento
    });
  }

  /**
   * Gate acionado pelo clique nos botões "Gerar cobrança". Antes de qualquer
   * requisição real, se o cliente tem débito em aberto e a decisão ainda não foi
   * tomada nesta tentativa, pausa e pergunta se quer incluir parte/total do débito
   * na cobrança. Não bloqueia — é só uma pergunta opcional, respondida uma vez por
   * tentativa de envio (resetada quando o modal de cobrança fecha).
   */
  function handleSubmitClick() {
    if (isSaving) return;
    // A reserva de débito (v1) atua sobre UMA única pendência (a mais antiga em
    // aberto) — o teto oferecido é o saldo dessa pendência, não o saldoDevedor
    // total (que pode somar várias pendências).
    if (pendenciaDebitoAlvo && pendenciaDebitoAlvo.valor_saldo > 0 && form.tipoCobranca !== "E-CREDITO" && !debitoResolvido) {
      setDebitoInputValor(pendenciaDebitoAlvo.valor_saldo.toFixed(2).replace(".", ","));
      setShowDebitoModal(true);
      return;
    }
    void handleSubmit();
  }

  async function handleSubmit(bypassPendingCheck?: boolean | React.MouseEvent, debitoIncluidoOverride?: number) {
    const shouldBypass = bypassPendingCheck === true;
    if (isSaving) {
      return;
    }

    // As opções de pagamento já não esperam o carregamento da lista de cobranças
    // (ver isFormaPagamentoDisponivel), mas `createCobranca` ainda decide
    // real x mock por `source`. Com o Supabase configurado e `source` ainda em
    // "mock", a lista não terminou de carregar: submeter agora gravaria uma
    // cobrança mockada. Bloqueia e pede para repetir em seguida.
    if (getSupabaseClient() && source !== "supabase") {
      showToast({
        type: "warning",
        title: "Carregando cobranças da proposta",
        description: "Aguarde alguns instantes e clique em gerar novamente."
      });
      return;
    }

    if (!form.osIdeal.trim()) {
      showToast({ type: "error", title: "Informe a OS Ideal temporária para gerar a cobrança." });
      return;
    }

    if (!form.tipoCobranca) {
      showToast({ type: "error", title: "Selecione uma forma de pagamento." });
      return;
    }

    // Trava do Cartão Asaas por empresa recebedora. Repetida aqui de propósito:
    // o botão desabilitado é só apresentação e pode ser contornado (estado
    // antigo, empresa trocada em outra aba). Nenhuma requisição sai daqui.
    if (
      form.tipoCobranca === "CARD_PARCELADO" &&
      form.cartaoFluxo === "ASAS" &&
      idEmpresaReal !== EMPRESA_CARTAO_ASAAS
    ) {
      showToast({
        type: "error",
        title: "Cartão Asaas indisponível para esta empresa",
        description: "Essa modalidade é exclusiva da IDEAL GRÁFICA EXPRESSA EIRELI. Selecione outra forma de pagamento."
      });
      return;
    }

    // Telefone do pagador. Repetido aqui de propósito, como a trava do Asaas: o
    // aviso na escolha da forma é só apresentação e o cadastro pode ter mudado
    // no meio do caminho. Nenhuma cobrança é criada com telefone que o provedor
    // vai recusar — o modal de correção abre no lugar.
    if (bloqueiaPorTelefone(form.tipoCobranca, form.cartaoFluxo)) {
      return;
    }

    const roundedValor = roundMoney(form.valor);
    const roundedSaldoRestante = roundMoney(saldoRestante);

    if (roundedSaldoRestante <= 0) {
      showToast({ type: "warning", title: "Esta proposta não possui saldo restante para nova cobrança." });
      return;
    }

    if (roundedValor <= 0) {
      showToast({ type: "error", title: "Informe um valor de cobrança maior que zero." });
      return;
    }

    if (roundedValor > roundedSaldoRestante) {
      showToast({
        type: "error",
        title: `O valor da cobrança (${formatCurrency(roundedValor)}) não pode ser maior que o saldo restante (${formatCurrency(roundedSaldoRestante)}).`
      });
      return;
    }

    if (source === "supabase" && form.tipoCobranca !== "PIX" && form.tipoCobranca !== "BOLETO" && form.tipoCobranca !== "CARD_PARCELADO" && form.tipoCobranca !== "E-FATURADO" && form.tipoCobranca !== "E-CREDITO") {
      showToast({ type: "warning", title: "Forma de pagamento em preparação. Selecione PIX, Boleto, Cartão ou E-Crédito para testes reais." });
      return;
    }

    if (form.tipoCobranca === "E-CREDITO") {
      setIsSaving(true);
      setRefreshingSaldo(true);
      // Chave de idempotência: gerada uma vez por operação lógica e reutilizada
      // em retries de uma mesma tentativa ambígua (ex.: falha de rede antes de
      // qualquer resposta do servidor). Assim que uma resposta definitiva do
      // servidor é recebida (sucesso OU falha), a chave é finalizada e uma
      // nova tentativa (novo clique) usa uma chave nova — nunca reaproveita
      // uma chave já resolvida, o que travaria retries legítimos após falha.
      if (!chaveIdempotenciaECreditoRef.current) {
        chaveIdempotenciaECreditoRef.current = crypto.randomUUID();
      }
      const chaveIdempotencia = chaveIdempotenciaECreditoRef.current;
      let respostaDefinitivaRecebida = false;
      try {
        const client = getSupabaseClient();
        const session = (await client?.auth.getSession())?.data.session;
        const token = session?.access_token;

        if (!token) throw new Error("Sessão expirada. Autentique-se novamente.");

        const isCombined = roundedValor < roundedSaldoRestante;

        let endpoint = "/api/cobrancas/usar-credito";
        let payload: any = {
            idInt: proposta.id_int,
            idCliente: proposta.cliente?.idCliente,
            valor: roundedValor,
            observacao: form.observacao || `Uso de crédito aplicado na proposta #${proposta.id_int}`,
            clienteNome: pagador?.nome || proposta.cliente?.nome || "Cliente",
            empresa: proposta.empresa || "Ideal Grafica",
            idEmpresa: form.id_empresa || 1,
            vencimento: getDefaultVencimento(0),
            chaveIdempotencia
        };

        if (isCombined) {
            endpoint = "/api/cobrancas/pagamento-combinado";
            const valorSecundario = Math.round((roundedSaldoRestante - roundedValor) * 100) / 100;
            payload = {
                idInt: proposta.id_int,
                idCliente: proposta.cliente?.idCliente,
                valorCredito: roundedValor,
                valorSecundario: valorSecundario,
                tipoSecundario: tipoSecundario,
                observacao: form.observacao || `Pagamento combinado aplicado na proposta #${proposta.id_int}`,
                clienteNome: pagador?.nome || proposta.cliente?.nome || "Cliente",
                empresa: proposta.empresa || "Ideal Grafica",
                idEmpresa: form.id_empresa || 1,
                vencimento: getDefaultVencimento(0),
                forma_pgto: tipoSecundario === "E-FATURADO" ? null : condicaoSecundaria,
                forma_fatu: tipoSecundario === "E-FATURADO" ? condicaoSecundaria : null,
                chaveIdempotencia
            };
        }

        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });
        // Resposta HTTP recebida = tentativa finalizada do lado do servidor
        // (sucesso ou falha definitiva) — a partir daqui a chave já usada não
        // deve ser reaproveitada por um novo clique.
        respostaDefinitivaRecebida = true;

        const json = await res.json();
        // Se a requisição não foi bem-sucedida, mas É um resultado parcial, NÃO lançamos erro para cair no catch genérico.
        // O backend retornará status: 200 e success: false com isCombinadoParcial = true.
        if (!res.ok) {
          throw new Error(json.error || "Erro na comunicação com a API.");
        }

        if (!json.success && !json.isCombinadoParcial) {
          throw new Error(json.error || "Erro desconhecido ao aplicar crédito.");
        }

        if (json.isCombinadoParcial) {
            // Crédito já foi aplicado e a cobrança secundária já existe (pendente).
            // Se for PIX, tenta gerar automaticamente mais uma vez antes de avisar
            // o usuário — sem criar pagamento novo nem consumir crédito de novo,
            // só reprocessando a integração para a MESMA cobrança já criada.
            const isPixPendente = (json.tipoCobrancaPendente === "PIX" || json.tipoCobrancaPendente === "E-PIX") && Boolean(json.cobrancaPendenteId);
            let retry: { success: boolean; error?: string } | null = null;
            if (isPixPendente) {
              retry = await tentarGerarPixNovamente(
                json.cobrancaPendenteId,
                json.cobrancaPendenteIdPagamento,
                form.id_empresa || 1,
                payload.valorSecundario,
                token
              );
            }

            if (retry?.success) {
              showToast({
                type: "success",
                title: "Pagamento Combinado Gerado",
                description: "Crédito aplicado e PIX gerado com sucesso na nova tentativa automática."
              });
            } else {
              showToast({
                  type: "warning",
                  title: "Cobrança Parcial",
                  description: retry
                    ? `${json.error} Nova tentativa automática também falhou (${retry.error}) — a cobrança segue pendente para nova tentativa.`
                    : json.error // Mensagem descrevendo que o E-Credito foi, mas a segunda falhou
              });
            }
            // Importante: NÃO disparamos onPagamentoIntegralConcluido
        } else {
            showToast({
                type: "success",
                title: isCombined ? "Pagamento Combinado Gerado" : "Crédito Aplicado com Sucesso!",
                description: isCombined ? "Cobranças criadas com sucesso." : `O valor de ${formatCurrency(roundedValor)} foi debitado do saldo e registrado.`
            });
            if (json.quitada && onPagamentoIntegralConcluido) {
                onPagamentoIntegralConcluido();
            }
        }

        // Recarrega as cobranças ANTES de fechar o modal — vale tanto para o
        // sucesso total quanto para o parcial (o E-Crédito já foi gravado mesmo
        // quando a segunda parte falha). Sem isso, `cobrancasStats` continuava
        // sem as cobranças recém-criadas: a lista não aparecia, o saldo seguia
        // cheio e o botão "Gerar cobrança" permanecia como se nada tivesse
        // acontecido até um F5.
        const recarga = await refreshCobrancas();
        if (recarga?.errorMessage) {
          // Estado anterior foi preservado (o provider não substitui por mock).
          // A cobrança FOI gravada — o que falhou foi só a releitura.
          showToast({
            type: "warning",
            title: "Cobrança criada, mas a lista não recarregou",
            description: "Atualize a página para ver as cobranças mais recentes."
          });
        }
        if (onRefreshProposta) onRefreshProposta();
        await fetchSaldo();

        // Garante a LISTA visível (e não um detalhe aberto) com os dados novos.
        setSelectedCobrancaId(null);
        setForm(buildInitialFormState());
        closeModal();
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        showToast({ type: "error", title: "Falha ao aplicar crédito", description: errorMessage });
        await fetchSaldo();
      } finally {
        if (respostaDefinitivaRecebida) {
          chaveIdempotenciaECreditoRef.current = null;
        }
        setIsSaving(false);
        setRefreshingSaldo(false);
      }
      return;
    }

    if (source === "supabase" && idEmpresaReal !== 1 && idEmpresaReal !== 2 && idEmpresaReal !== 3) {
      showToast({ type: "error", title: "Criação de cobrança real disponível apenas para as empresas Ideal Gráfica, Ideal Birô e E3 Brindes nesta etapa." });
      return;
    }

    if (source === "supabase" && form.tipoCobranca === "CARD_PARCELADO" && idEmpresaReal === 2) {
      showToast({ type: "error", title: "Geração de cartão de crédito real não disponível para a empresa Ideal Birô." });
      return;
    }

    if (source === "supabase" && form.tipoCobranca === "BOLETO") {
      const emailCliente = proposta.contato?.email?.trim() || proposta.cliente?.email?.trim() || "";
      if (!emailCliente) {
        showToast({ type: "error", title: "Cliente sem e-mail cadastrado para geração do boleto." });
        return;
      }
    }

    if (source === "supabase") {
      if (!proposta.cliente || !proposta.cliente.nome?.trim()) {
        showToast({ type: "error", title: "Nome do cliente é obrigatório para gerar cobrança real." });
        return;
      }
      if (!proposta.cliente.documento?.trim()) {
        showToast({ type: "error", title: "Documento (CPF/CNPJ) do cliente é obrigatório para gerar cobrança real." });
        return;
      }
      if (!proposta.enderecoEntrega || !proposta.enderecoEntrega.endereco?.trim()) {
        showToast({ type: "error", title: "Logradouro do endereço de entrega é obrigatório para gerar cobrança real." });
        return;
      }
      if (!proposta.enderecoEntrega.cidade?.trim()) {
        showToast({ type: "error", title: "Cidade do endereço de entrega é obrigatória para gerar cobrança real." });
        return;
      }
      if (!proposta.enderecoEntrega.uf?.trim()) {
        showToast({ type: "error", title: "UF do endereço de entrega é obrigatória para gerar cobrança real." });
        return;
      }
      if (!proposta.enderecoEntrega.cep?.trim()) {
        showToast({ type: "error", title: "CEP do endereço de entrega é obrigatório para gerar cobrança real." });
        return;
      }
    }

    if (!tipoDisponivel) {
      showToast({ type: "warning", title: indisponibilidadeMensagem || "Tipo indisponível para a empresa da proposta." });
      return;
    }

    if (isFaturado && !modeloSelecionadoId) {
      showToast({ type: "error", title: "Selecione uma condição de pagamento." });
      return;
    }

    if (!shouldBypass && isFaturado && analiseCredito.qtdAtrasados > 0) {
      setShowPendingAlert(true);
      return;
    }

    let payloadVencimento = getDefaultVencimento(3);
    let extraPayload: Partial<CriarCobrancaFormValues> = {};

    if (isFaturado) {
      const selectedModel = modelosCobranca.find(m => String(m.id) === String(modeloSelecionadoId));
      
      if (!selectedModel || !selectedModel.resultado || selectedModel.qtd_parcela == null || selectedModel.inicio == null || selectedModel.intervalo == null) {
        showToast({ type: "error", title: "Selecione uma condição de pagamento válida." });
        return;
      }

      const today = new Date();
      today.setDate(today.getDate() + selectedModel.inicio);
      
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      payloadVencimento = `${yyyy}-${mm}-${dd}`;

      extraPayload = {
        forma_fatu: selectedModel.resultado,
        id_modelo_cobranca: selectedModel.id,
        p_qtd_parcelas: selectedModel.qtd_parcela,
        p_dias_pra_inicio: selectedModel.inicio,
        p_intervalo: selectedModel.intervalo,
        p_valor_entrada: selectedModel.entrada_porcento > 0 ? (roundedValor * (selectedModel.entrada_porcento / 100)) : 0
      };
    }

    // Abatimento de débito opcional: soma ao valor real cobrado (PIX/Boleto/Cartão sai
    // pelo valor combinado) e deixa um marcador parseável em obs_v2 (campo interno, não
    // exposto ao cliente) para o crédito na conta corrente ser registrado somente quando
    // este pagamento for de fato confirmado — nunca no momento da criação da cobrança.
    const debitoIncluidoArredondado = Math.round((debitoIncluidoOverride ?? debitoIncluido) * 100) / 100;
    const valorComDebito = roundMoney(roundedValor + debitoIncluidoArredondado);
    const observacaoComMarcador = debitoIncluidoArredondado > 0
      ? [
          form.observacao?.trim() || null,
          `[ABATIMENTO_DEBITO:${debitoIncluidoArredondado.toFixed(2)}] Cobrança inclui R$ ${debitoIncluidoArredondado.toFixed(2).replace(".", ",")} para abatimento do débito em aberto do cliente na conta corrente. Será registrado como crédito assim que este pagamento for confirmado.`,
        ].filter(Boolean).join(" | ")
      : form.observacao;

    const payload: CriarCobrancaFormValues = {
      ...form,
      ...extraPayload,
      vencimento: payloadVencimento,
      valor: valorComDebito,
      observacao: observacaoComMarcador,
      descricao: `Cobrança ${getRotuloModalidade(form.tipoCobranca, form.cartaoFluxo)} da proposta #${proposta.id_int}`,
      parcelaSelecionada: undefined,
      // Pagador efetivo: id_faturado validado; fallback automático via ?? no createCobranca
      pagadorIdCliente: pagador?.idCliente,
      pagadorNome: pagador?.nome,
      pagadorDocumento: pagador?.documento
    };

    setIsSaving(true);
    try {
      if (source !== "supabase") {
        await new Promise((resolve) => window.setTimeout(resolve, 850));
      }
      
      console.log("[DEBUG CRIAR COBRANÇA] isFaturado: ", isFaturado);
      console.log("[DEBUG CRIAR COBRANÇA] modeloSelecionadoId: ", modeloSelecionadoId);
      console.log("[DEBUG CRIAR COBRANÇA] payload completo: ", payload);

      const created = await createCobranca(payload, proposta);

      const isFaturadoPayload = ["E-FATURADO", "E-RETRABALHO", "E-PERMUTA", "E-AMOSTRA"].includes(payload.tipoCobranca);
      if (isFaturadoPayload && !created?.paid_at) {
        // `confirmado_por` no domínio já é o fallback de `aprovado_por` (ver
        // mappers.ts). Preenchido = liberado, seja pelo financeiro ou pela
        // regra automática de limite operacional.
        const liberado = Boolean(created?.confirmado_por);
        showToast(
          liberado
            ? {
                type: "success",
                title: "Faturamento liberado",
                description: "Crédito disponível e sem faturamentos vencidos. Enviado para a Conferência."
              }
            : {
                type: "warning",
                title: "Faturamento em análise",
                description: "Solicitação enviada para avaliação do financeiro."
              }
        );
      } else if (payload.tipoCobranca === "BOLETO") {
        showToast({
          type: "success",
          title: "Boleto gerado com sucesso."
        });
      } else {
        showToast({
          type: "success",
          title: source === "supabase" ? "Cobrança real criada com sucesso!" : "Cobrança criada com sucesso."
        });
      }

      if (debitoIncluidoArredondado > 0 && pendenciaDebitoAlvo && created?.id) {
        // Reserva a pendência de débito contra esta cobrança (RESERVA_DEBITO).
        // Emissão não é pagamento: o crédito na conta corrente só é registrado
        // quando a cobrança for de fato confirmada (ver /api/cobrancas/confirmar).
        try {
          const client = getSupabaseClient();
          const session = (await client?.auth.getSession())?.data.session;
          const token = session?.access_token;
          if (!token) throw new Error("Sessão expirada.");

          const resReserva = await fetch("/api/conta-corrente/usar", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({
              idPendencia: pendenciaDebitoAlvo.id,
              valor: debitoIncluidoArredondado,
              modo: "RESERVA_DEBITO",
              idPagamento: created.id,
              chaveReserva: crypto.randomUUID(),
            }),
          });
          const jsonReserva = await resReserva.json();
          if (!resReserva.ok || !jsonReserva.success) {
            throw new Error(jsonReserva.error || "Falha ao reservar débito.");
          }
          showToast({
            type: "info",
            title: "Débito reservado nesta cobrança",
            description: `R$ ${debitoIncluidoArredondado.toFixed(2).replace(".", ",")} do débito do cliente foram reservados nesta cobrança. Será confirmado na conta corrente somente quando o pagamento for recebido.`
          });
        } catch (reservaErr: unknown) {
          const msg = reservaErr instanceof Error ? reservaErr.message : String(reservaErr);
          console.error("[PropostaCobrancaPanel] Falha ao reservar débito na cobrança:", msg);
          showToast({
            type: "warning",
            title: "Cobrança criada, mas a reserva de débito falhou",
            description: `${msg} A cobrança foi gerada normalmente; o débito continua disponível na Conta Corrente.`
          });
        }
        await fetchSaldo();
      }

      setForm(buildInitialFormState());
      closeModal();
    } catch (error: unknown) {
      console.error("[PropostaCobrancaPanel] Erro ao criar cobrança:", error);
      const errorMessage = error instanceof Error ? error.message : "Verifique sua conexão ou tente novamente.";
      showToast({
        type: "error",
        title: "Erro ao criar cobrança",
        description: errorMessage
      });
    } finally {
      setIsSaving(false);
    }
  }

  // "CARD_ASAS" existe apenas na interface: ao submeter vira
  // tipoCobranca CARD_PARCELADO + cartaoFluxo ASAS. O valor sintético nunca
  // chega ao banco nem ao tipo CobrancaTipo.
  const opcoesPagamento: Array<{
    id: CobrancaTipo | "CARD_ASAS";
    label: string;
    icon: typeof QrCode;
    blockedText?: string;
    /** Legenda curta sob o rótulo, para diferenciar as duas vias de cartão. */
    hint?: string;
  }> = [
    { id: "PIX", label: "PIX", icon: QrCode },
    { id: "BOLETO", label: "Boleto", icon: ReceiptText },
    { id: "CARD_PARCELADO", label: "Cartão de crédito", icon: CreditCard },
    { id: "CARD_ASAS", label: "Cartão Asaas", icon: CreditCard, hint: "Segunda opção de cartão" },
    { id: "E-FATURADO", label: "Faturado", icon: Landmark }
  ];
  if (saldoCredito > 0 && canUsarCredito && saldoRestante > 0) {
    opcoesPagamento.push({ id: "E-CREDITO", label: "E-Crédito", icon: Wallet as any });
  }

  const hasCobrancas = cobrancasAtivas.length > 0;

  /**
   * `getCobrancasByProposta` filtra `cobrancasStats`, que nasce com o mock e só
   * vira dado real quando o provider conclui a leitura (`source === "supabase"`).
   * Enquanto isso, a lista desta proposta vem vazia — e vazio NÃO é o mesmo que
   * "não existe cobrança".
   *
   * Tratar os dois como iguais fazia a aba Pagamentos anunciar "Nenhuma cobrança
   * criada" e oferecer "Gerar cobrança" para propostas que já tinham cobrança
   * emitida, convidando à duplicidade — e a lista "aparecia sozinha" quando a
   * carga terminava, dando a impressão de bug intermitente.
   */
  const cobrancasIndefinidas = Boolean(getSupabaseClient()) && source !== "supabase";

  if (onlyModal) {
    return (
      <>
        {modalOpen ? (
          <div className="fixed inset-0 z-[70] bg-slate-950/60 p-2 sm:p-6" role="dialog" aria-modal="true" onClick={(event) => {
        if (event.target === event.currentTarget) {
          closeModal();
        }
      }}>
        <div className="mx-auto flex h-[calc(100vh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl sm:h-auto sm:max-h-[94vh] sm:rounded-[28px]">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-4 sm:p-5 md:p-6">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">Criar cobrança</h2>
              <p className="mt-1 text-sm text-slate-600">
                {proposta.cliente.nome} • {empresa?.nome ?? proposta.empresa} • Total {formatCurrency(totalPropostaRounded)} • Já cobrado {formatCurrency(totalGerado)} • Saldo {formatCurrency(saldoRestante)}
              </p>
              <p className="mt-1 text-xs text-slate-500">Proposta #{proposta.id_int} • Situação {situacaoFinanceira}</p>
              {hasCobrancaExcedente ? (
                <p className="mt-1 text-xs font-semibold text-orange-700">
                  {source === "supabase"
                    ? "Atenção: o total das cobranças excede o valor total da proposta."
                    : "Cobranças excedem o valor da proposta no mock."}
                </p>
              ) : null}
            </div>
            <button type="button" onClick={closeModal} className="rounded-2xl bg-slate-100 p-2 text-slate-700">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5 md:p-6">
            <PanelCard
              title="Dados da cobrança"
              description={source === "supabase"
                ? "Preencha os dados essenciais para gerar a cobrança real."
                : "Preencha os dados essenciais para gerar a cobrança mockada."}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Empresa recebedora">
                  <select
                    value={form.id_empresa ?? 1}
                    onChange={(event) => handleEmpresaChange(Number(event.target.value))}
                    className={inputClass}
                  >
                    {EMPRESAS_RECEBEDORAS_FIXAS.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nome}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Forma de pagamento selecionada">
                  <input readOnly value={getRotuloModalidadeExibicao(form.tipoCobranca, form.cartaoFluxo)} className={`${inputClass} cursor-not-allowed bg-slate-100 text-slate-500`} />
                </Field>
                <Field label="OS Ideal *">
                  <input
                    value={form.osIdeal}
                    onChange={(event) => {
                      const onlyNumbers = event.target.value.replace(/\D/g, "");
                      patchForm({ osIdeal: onlyNumbers });
                    }}
                    className={inputClass}
                    placeholder="Ex.: 2101"
                  />
                </Field>
                <Field label="Valor da cobrança *">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.valor}
                    onChange={(event) => {
                      setIsUserEditingValor(true);
                      patchForm({ valor: Number(event.target.value) || 0 });
                    }}
                    className={inputClass}
                  />
                  {saldoRestante < totalPropostaRounded && (
                    <p className="mt-1.5 text-xs text-amber-700 font-semibold bg-amber-50/70 border border-amber-100 rounded-xl p-2.5">
                      ⚠️ Cobrança complementar. Saldo restante: {formatCurrency(saldoRestante)}.
                    </p>
                  )}
                </Field>
                

            {isFaturado ? (
                  <Field label="Condição de pagamento *">
                    <select
                      value={modeloSelecionadoId}
                      onChange={(event) => setModeloSelecionadoId(event.target.value)}
                      className={inputClass}
                    >
                      <option value="">Selecione...</option>
                      {modelosCobranca.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.resultado}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
                <div className="md:col-span-2">
                  <Field label={isFaturado ? "Observações (Condição comercial solicitada)" : "Observações"}>
                    <textarea
                      value={form.observacao}
                      onChange={(event) => patchForm({ observacao: event.target.value })}
                      className={`${inputClass} min-h-24 resize-y`}
                      placeholder={isFaturado ? "Observação opcional, ex.: 14/28 dias" : "Observação opcional"}
                    />
                  </Field>
                </div>
              </div>
            </PanelCard>

            <PanelCard
              title="Forma de pagamento"
              description="Escolha uma opção operacional. Detalhes técnicos de geração ficam para backend e detalhe da cobrança."
            >
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                {opcoesPagamento.map((opcao) => {
                  const Icon = opcao.icon;
                  const selected = opcao.id === "E-FATURADO"
                    ? ["E-FATURADO", "E-RETRABALHO", "E-PERMUTA", "E-AMOSTRA"].includes(form.tipoCobranca)
                    : opcao.id === "CARD_ASAS"
                      ? (form.tipoCobranca === "CARD_PARCELADO" && form.cartaoFluxo === "ASAS")
                      : opcao.id === "CARD_PARCELADO"
                        ? (form.tipoCobranca === "CARD_PARCELADO" && form.cartaoFluxo !== "ASAS")
                        : form.tipoCobranca === opcao.id;
                  const available = isFormaPagamentoDisponivel(opcao.id, idEmpresaReal, proposta.empresa);
                  const isActuallyDisabled = !available;
                  const disabledText = available
                    ? ""
                    : "Indisponível para esta empresa.";

                  return (
                    <button
                      key={opcao.id}
                      type="button"
                      disabled={isActuallyDisabled}
                      onClick={() => {
                        if (opcao.id === "CARD_ASAS") {
                          handleTipoChange("CARD_PARCELADO", "ASAS");
                        } else {
                          handleTipoChange(opcao.id);
                        }
                        if (!isUserEditingValor) {
                          patchForm({ valor: saldoRestante });
                        }
                      }}
                      className={`rounded-2xl border px-3 py-2 text-left transition ${
                        selected
                          ? "border-[#0f9f9a] bg-[#dff8f6]"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                      title={disabledText}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 shrink-0 text-slate-700" />
                        <span className="text-sm font-semibold leading-tight text-slate-900">{opcao.label}</span>
                      </div>
                      {opcao.hint && available ? (
                        <p className="mt-1 text-[11px] leading-tight text-slate-500">{opcao.hint}</p>
                      ) : null}
                      {!available ? (
                        <p className="mt-1 text-[11px] text-slate-500">Indisponível</p>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {isFaturado && (
                <div className="mt-4 border-t border-slate-100 pt-4 flex flex-col gap-1.5 max-w-md">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Subtipo do faturamento</label>
                  <select
                    value={form.tipoCobranca}
                    onChange={(e) => patchForm({ tipoCobranca: e.target.value as CobrancaTipo })}
                    className={inputClass}
                  >
                    <option value="E-FATURADO">E-Faturado</option>
                    <option value="E-RETRABALHO">E-Retrabalho</option>
                    <option value="E-PERMUTA">E-Permuta</option>
                    <option value="E-AMOSTRA">E-Amostra</option>
                  </select>
                </div>
              )}
              {!tipoDisponivel ? (
                <p className="mt-3 text-xs text-orange-700">{indisponibilidadeMensagem || "Indisponível para esta empresa."}</p>
              ) : null}
            </PanelCard>

            

            {isFaturado ? (
              <PanelCard
                title="Campos mínimos do faturado"
                description="Condição comercial e aviso resumido de crédito."
              >
                <div className="max-w-md">
                  <Field label="Condição comercial">
                    <input
                      value={form.condicaoPagamento}
                      onChange={(event) => patchForm({ condicaoPagamento: event.target.value })}
                      className={inputClass}
                      placeholder="Ex.: Faturado 28 dias"
                    />
                  </Field>
                </div>

                {isLoadingCredit ? (
                  <div className="mt-4 p-4 text-center rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
                    <span className="text-sm text-slate-600 font-semibold">Consultando análise de crédito real...</span>
                  </div>
                ) : (
                  <div className="mt-4 space-y-4">
                    <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
                      <InfoBox label="Limite de crédito" value={formatCurrency(analiseCredito.limite)} />
                      <InfoBox label="Utilizado" value={formatCurrency(analiseCredito.utilizado)} />
                      <InfoBox label="Disponível" value={formatCurrency(analiseCredito.disponivel - form.valor)} />

                      <InfoBox label="Valor solicitado" value={formatCurrency(analiseCredito.valorSolicitado)} />
                      <InfoBox 
                        label="Faturamentos vencidos" 
                        value={analiseCredito.qtdAtrasados > 0 ? `${analiseCredito.qtdAtrasados} pendente(s)` : "Nenhum atraso"} 
                        detail={analiseCredito.qtdAtrasados > 0 ? "Requer avaliação do financeiro" : "Histórico regular"}
                        tone={analiseCredito.qtdAtrasados > 0 ? "danger" : undefined}
                      />
                      <InfoBox label="Risco de crédito" value={analiseCredito.risco} />
                    </div>

                    {analiseCredito.statusAnalise === "APROVADO" ? (
                      <div className="rounded-2xl border p-4 border-teal-200 bg-teal-50 text-teal-800">
                        <p className="font-semibold">Limite operacional disponível.</p>
                        <p className="mt-1 text-sm leading-6">
                          Cliente possui limite livre e sem atrasos. A cobrança entrará como pendência financeira aguardando autorização operacional do financeiro.
                        </p>
                      </div>
                    ) : null}
                  </div>
                )}
              </PanelCard>
            ) : null}

            <p className="text-sm text-slate-600">
              Esta proposta já possui <strong className="text-slate-900">{cobrancasDaProposta.length}</strong> cobrança(s) gerada(s).
            </p>
          </div>

          <div className="border-t border-slate-100 bg-white p-4 sm:p-5 md:p-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <p className="text-sm font-semibold text-slate-700">
                Proposta #{proposta.id_int} • {getRotuloModalidadeExibicao(form.tipoCobranca, form.cartaoFluxo)} • {formatCurrency(form.parcelaSelecionada?.valorFinal ?? form.valor)}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSubmitClick}
                  disabled={
                      isSaving ||
                      !tipoDisponivel ||
                      (form.tipoCobranca === "E-CREDITO" && (form.valor <= 0 || form.valor > saldoCredito || form.valor > saldoRestante)) ||
                      (form.tipoCobranca === "E-CREDITO" && form.valor < saldoRestante && tipoSecundario === "E-FATURADO" && !condicaoSecundaria)
                    }
                  className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
                >
                  {isSaving ? "Gerando cobrança..." : "Gerar cobrança"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    ) : null}

      {showPendingAlert ? (
        <div className="fixed inset-0 z-[80] bg-slate-950/60 p-4 flex items-center justify-center" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-6">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-slate-950">Aviso de Pendência</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Este cliente possui faturamento vencido em aberto. A solicitação ficará bloqueada sob avaliação do financeiro.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowPendingAlert(false)}
                className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={async () => {
                  setShowPendingAlert(false);
                  await handleSubmit(true);
                }}
                className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
              >
                Enviar para avaliação
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showDebitoModal ? (
        <div className="fixed inset-0 z-[85] bg-slate-950/60 p-4 flex items-center justify-center" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-5">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-slate-950">Cliente com débito em aberto</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                {proposta.cliente?.nome ?? "Este cliente"} possui <strong>{formatCurrency(saldoDevedor)}</strong> em débito na conta corrente.
                Quer incluir nesta cobrança parte ou o total do débito deste cliente?
              </p>
              <p className="text-xs text-slate-500">Não é obrigatório — a cobrança pode ser gerada normalmente pelo valor da proposta.</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-500">Valor do débito a incluir (R$)</label>
              <input
                type="text"
                inputMode="decimal"
                value={debitoInputValor}
                onChange={(e) => setDebitoInputValor(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm"
                placeholder="0,00"
              />
              <p className="text-[11px] text-slate-400">Máximo: {formatCurrency(pendenciaDebitoAlvo?.valor_saldo ?? 0)}</p>
              {pendenciaDebitoAlvo && saldoDevedor > pendenciaDebitoAlvo.valor_saldo + 0.01 ? (
                <p className="text-[11px] text-amber-600">
                  Este cliente possui outras pendências de débito além desta ({formatCurrency(saldoDevedor)} no total).
                  Esta cobrança pode incluir no máximo a pendência mais antiga; use a tela de Conta Corrente para as demais.
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowDebitoModal(false)}
                className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setDebitoIncluido(0);
                  setDebitoResolvido(true);
                  setShowDebitoModal(false);
                  void handleSubmit(undefined, 0);
                }}
                className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Não incluir
              </button>
              <button
                type="button"
                onClick={() => {
                  const parsed = parseFloat(debitoInputValor.replace(",", "."));
                  const limiteReservavel = pendenciaDebitoAlvo?.valor_saldo ?? 0;
                  if (isNaN(parsed) || parsed <= 0 || parsed > limiteReservavel + 0.01) {
                    showToast({ type: "error", title: `Informe um valor entre R$ 0,01 e ${formatCurrency(limiteReservavel)}.` });
                    return;
                  }
                  const arredondado = Math.round(parsed * 100) / 100;
                  setDebitoIncluido(arredondado);
                  setDebitoResolvido(true);
                  setShowDebitoModal(false);
                  void handleSubmit(undefined, arredondado);
                }}
                className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
              >
                Incluir no valor
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
  }

  if (selectedCobrancaId) {
    return (
      <CobrancaDetail 
        cobrancaId={selectedCobrancaId} 
        onClose={() => setSelectedCobrancaId(null)} 
        onRefreshProposta={onRefreshProposta}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PanelCard
        title="Cobranças já geradas"
        description="A cobrança continua nascendo dentro da proposta. O modal de criação foi simplificado para um fluxo rápido e operacional."
      >
        {cobrancasIndefinidas ? (
          // Sem dado real ainda: não afirma que a proposta está sem cobrança e
          // não oferece "Gerar cobrança" — criar aqui poderia duplicar uma
          // cobrança já existente que simplesmente não terminou de carregar.
          <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center flex flex-col items-center justify-center gap-3">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-[#0b2f4a]" />
            <p className="text-sm font-medium text-slate-600">Carregando as cobranças desta proposta...</p>
            <button
              type="button"
              onClick={() => void refreshCobrancas()}
              className="text-xs font-semibold text-slate-500 underline underline-offset-4 hover:text-slate-700"
            >
              Demorando? Tentar novamente
            </button>
          </div>
        ) : !hasCobrancas ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center flex flex-col items-center justify-center gap-4">
            <p className="text-sm font-medium text-slate-600">
              Nenhuma cobrança criada para esta proposta ainda.
            </p>
            {saldoRestante > 0 && (
              <button
                type="button"
                onClick={async () => {
                  if (onSavePropostaRequest) {
                    setIsSaving(true);
                    const saved = await onSavePropostaRequest();
                    setIsSaving(false);
                    if (!saved) return;
                  }
                  openModal();
                }}
                disabled={isSaving}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                ) : null}
                {isSaving ? "Salvando..." : "Gerar cobrança"}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="rounded-3xl border border-[#d7e5e8] bg-slate-50 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-800">
                    Proposta #{proposta.id_int} • {proposta.cliente.nome} • {empresa?.nome ?? proposta.empresa}
                  </p>
                  <p className="text-sm text-slate-600">
                    Total {formatCurrency(totalPropostaRounded)} • Já cobrado {formatCurrency(totalGerado)} • Saldo {formatCurrency(saldoRestante)}
                  </p>
                  {hasCobrancaExcedente ? (
                    <p className="text-xs font-semibold text-orange-700">
                      {source === "supabase"
                        ? "Atenção: o total das cobranças excede o valor total da proposta."
                        : "Cobranças excedem o valor da proposta no mock."}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={getLiberacaoPedidoLabel(liberacaoStatus)} tone={getLiberacaoPedidoTone(liberacaoStatus)} />
                    {propostaLiberada ? <StatusBadge status="LIBERADA_PARA_PEDIDO" tone="success" /> : null}
                  </div>
                </div>


              </div>

              <div className="border-t border-slate-100 bg-white p-4 sm:p-5 md:p-6">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <p className="text-sm font-semibold text-slate-700">
                    Proposta #{proposta.id_int} • Saldo restante a cobrar: <strong className="text-slate-900">{formatCurrency(saldoRestante)}</strong>
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {podeAbonarDiferenca && (
                      <button
                        type="button"
                        onClick={handleAbonarDiferenca}
                        disabled={isAbonando || isSaving}
                        title="Registra um desconto no valor exato do saldo pendente e recalcula a quitação (ação de administrador, registrada no Histórico)."
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-800 shadow-sm transition hover:bg-amber-100 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {isAbonando ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-300 border-t-amber-700" />
                        ) : null}
                        {isAbonando ? "Abonando..." : `Abonar diferença (${formatCurrency(saldoRestante)})`}
                      </button>
                    )}
                    {saldoRestante > 0 && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (onSavePropostaRequest) {
                            setIsSaving(true);
                            const saved = await onSavePropostaRequest();
                            setIsSaving(false);
                            if (!saved) return;
                          }
                          openModal();
                        }}
                        disabled={isSaving || refreshingSaldo}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61] disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {isSaving ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                        ) : null}
                        {isSaving ? "Salvando..." : "Gerar cobrança"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5">
              <CobrancasDaPropostaList 
                cobrancas={cobrancasAtivas} 
                onSelectCobranca={setSelectedCobrancaId}
                onRefreshProposta={onRefreshProposta}
              />
            </div>
          </>
        )}
      </PanelCard>

      {modalOpen ? (
        <div className="fixed inset-0 z-[70] bg-slate-950/60 p-2 sm:p-6" role="dialog" aria-modal="true" onClick={(event) => {
          if (event.target === event.currentTarget) {
            closeModal();
          }
        }}>
          <div className="mx-auto flex h-[calc(100vh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl sm:h-auto sm:max-h-[94vh] sm:rounded-[28px]">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-4 sm:p-5 md:p-6">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">Criar cobrança - {pagador?.nome ?? proposta.cliente.nome}</h2>
                <p className="mt-1 text-sm text-slate-600 flex flex-wrap gap-x-2 gap-y-1">
                  <span><strong>Empresa:</strong> {empresa?.nome ?? proposta.empresa}</span>
                  <span>• <strong>Total:</strong> {formatCurrency(totalPropostaRounded)}</span>
                  <span>• <strong>Já cobrado:</strong> {formatCurrency(totalGerado)}</span>
                  <span>• <strong>Saldo:</strong> {formatCurrency(saldoRestante)}</span>
                  <span>• <strong>Proposta:</strong> #{proposta.id_int}</span>
                  <span>• <strong>Situação:</strong> {situacaoFinanceira}</span>
                </p>
                {hasCobrancaExcedente ? (
                  <p className="mt-1 text-xs font-semibold text-orange-700">
                    {source === "supabase"
                      ? "Atenção: o total das cobranças excede o valor total da proposta."
                      : "Cobranças excedem o valor da proposta no mock."}
                  </p>
                ) : null}
              </div>
              <button type="button" onClick={closeModal} className="rounded-2xl bg-slate-100 p-2 text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5 md:p-6">
              <PanelCard
                title="Dados da cobrança"
                description={source === "supabase"
                  ? "Preencha os dados essenciais para gerar a cobrança real."
                  : "Preencha os dados essenciais para gerar a cobrança mockada."}
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Empresa recebedora">
                  <select
                    value={form.id_empresa ?? 1}
                    onChange={(event) => handleEmpresaChange(Number(event.target.value))}
                    className={inputClass}
                  >
                    {EMPRESAS_RECEBEDORAS_FIXAS.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nome}
                      </option>
                    ))}
                  </select>
                  </Field>
                  <Field label="Forma de pagamento selecionada">
                    <input readOnly value={getRotuloModalidadeExibicao(form.tipoCobranca, form.cartaoFluxo)} className={`${inputClass} cursor-not-allowed bg-slate-100 text-slate-500`} />
                  </Field>
                  <Field label="OS Ideal *">
                    <input
                      value={form.osIdeal}
                      onChange={(event) => {
                        const onlyNumbers = event.target.value.replace(/\D/g, "");
                        patchForm({ osIdeal: onlyNumbers });
                      }}
                      className={inputClass}
                      placeholder="Ex.: 2101"
                    />
                  </Field>
                  <Field label="Valor da cobrança *">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={form.valor}
                      onChange={(event) => {
                        setIsUserEditingValor(true);
                        patchForm({ valor: Number(event.target.value) || 0 });
                      }}
                      className={inputClass}
                    />
                    {saldoRestante < totalPropostaRounded && (
                      <p className="mt-1.5 text-xs text-amber-700 font-semibold bg-amber-50/70 border border-amber-100 rounded-xl p-2.5">
                        ⚠️ Cobrança complementar. Saldo restante: {formatCurrency(saldoRestante)}.
                      </p>
                    )}
                  </Field>

            {isFaturado ? (
                    <Field label="Condição de pagamento *">
                      <select
                        value={modeloSelecionadoId}
                        onChange={(event) => setModeloSelecionadoId(event.target.value)}
                        className={inputClass}
                      >
                        <option value="">Selecione...</option>
                        {modelosCobranca.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.resultado}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : null}
                  <div className="md:col-span-2">
                    <Field label={isFaturado ? "Observações (Condição comercial solicitada)" : "Observações"}>
                      <textarea
                        value={form.observacao}
                        onChange={(event) => patchForm({ observacao: event.target.value })}
                        className={`${inputClass} min-h-24 resize-y`}
                        placeholder={isFaturado ? "Observação opcional, ex.: 14/28 dias" : "Observação opcional"}
                      />
                    </Field>
                  </div>
                </div>
              </PanelCard>

              <PanelCard
                title="Forma de pagamento"
                description="Escolha uma opção operacional. Detalhes técnicos de geração ficam para backend e detalhe da cobrança."
              >
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                  {opcoesPagamento.map((opcao) => {
                    const Icon = opcao.icon;
                    const selected = opcao.id === "E-FATURADO"
                      ? ["E-FATURADO", "E-RETRABALHO", "E-PERMUTA", "E-AMOSTRA"].includes(form.tipoCobranca)
                      : opcao.id === "CARD_ASAS"
                        ? (form.tipoCobranca === "CARD_PARCELADO" && form.cartaoFluxo === "ASAS")
                        : opcao.id === "CARD_PARCELADO"
                          ? (form.tipoCobranca === "CARD_PARCELADO" && form.cartaoFluxo !== "ASAS")
                          : form.tipoCobranca === opcao.id;
                    const available = isFormaPagamentoDisponivel(opcao.id, idEmpresaReal, proposta.empresa);
                    const isActuallyDisabled = !available;
                    const disabledText = available
                      ? ""
                      : "Indisponível para esta empresa.";

                    return (
                      <button
                        key={opcao.id}
                        type="button"
                        disabled={isActuallyDisabled}
                        onClick={() => {
                          if (opcao.id === "CARD_ASAS") {
                            handleTipoChange("CARD_PARCELADO", "ASAS");
                          } else {
                            handleTipoChange(opcao.id);
                          }
                        }}
                        className={`rounded-2xl border px-3 py-2 text-left transition ${
                          selected
                            ? "border-[#0f9f9a] bg-[#dff8f6]"
                            : "border-slate-200 bg-white hover:bg-slate-50"
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                        title={disabledText}
                      >
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 shrink-0 text-slate-700" />
                          <span className="text-sm font-semibold leading-tight text-slate-900">{opcao.label}</span>
                        </div>
                        {opcao.hint && available ? (
                          <p className="mt-1 text-[11px] leading-tight text-slate-500">{opcao.hint}</p>
                        ) : null}
                        {!available ? (
                          <p className="mt-1 text-[11px] text-slate-500">Indisponível</p>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                {isFaturado && (
                  <div className="mt-4 border-t border-slate-100 pt-4 flex flex-col gap-1.5 max-w-md">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Subtipo do faturamento</label>
                    <select
                      value={form.tipoCobranca}
                      onChange={(e) => patchForm({ tipoCobranca: e.target.value as CobrancaTipo })}
                      className={inputClass}
                    >
                      <option value="E-FATURADO">E-Faturado</option>
                      <option value="E-RETRABALHO">E-Retrabalho</option>
                      <option value="E-PERMUTA">E-Permuta</option>
                      <option value="E-AMOSTRA">E-Amostra</option>
                    </select>
                  </div>
                )}
                {!tipoDisponivel ? (
                  <p className="mt-3 text-xs text-orange-700">{indisponibilidadeMensagem || "Indisponível para esta empresa."}</p>
                ) : null}
              </PanelCard>

              {/* Painel de parcelas removido por solicitação */}

              {form.tipoCobranca === "E-CREDITO" ? (
              <PanelCard
                title="Campos do E-Crédito"
                description="Utilize o saldo na conta corrente do cliente para abater o valor da proposta."
              >
                <div className="space-y-4">
                  <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                    <InfoBox label="Saldo de Crédito" value={formatCurrency(saldoCredito)} />
                    <InfoBox label="Saldo Restante OS" value={formatCurrency(saldoRestante)} />
                  </div>
                  {form.valor > 0 && form.valor < saldoRestante && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800 md:col-span-4 mt-2">
                      <p className="font-semibold text-sm mb-2">Cobrança Parcial (Pagamento Combinado)</p>
                      <p className="text-xs leading-5 mb-4">
                        Restará <strong>{formatCurrency(saldoRestante - form.valor)}</strong> a ser cobrado.
                        Selecione a forma de pagamento secundária que será gerada automaticamente.
                      </p>
                      
                      <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[13px] font-semibold text-amber-900">Forma de Pagamento Secundária *</label>
                          <select
                            value={tipoSecundario}
                            onChange={(e) => setTipoSecundario(e.target.value as any)}
                            className="w-full rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                          >
                            <option value="PIX">PIX</option>
                            <option value="BOLETO">Boleto</option>
                            <option value="CARD_PARCELADO">Cartão de Crédito</option>
                            <option value="E-FATURADO">E-Faturado</option>
                          </select>
                        </div>
                        
                        {tipoSecundario === "E-FATURADO" && (
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[13px] font-semibold text-amber-900">Condição Secundária *</label>
                            <select
                              value={condicaoSecundaria}
                              onChange={(e) => setCondicaoSecundaria(e.target.value)}
                              className="w-full rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                            >
                              <option value="">Selecione...</option>
                              {modelosCobranca.map((m) => (
                                <option key={m.id} value={m.resultado}>
                                  {m.resultado}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {form.valor > 0 && form.valor >= saldoRestante && saldoRestante > 0 && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800 md:col-span-4 mt-2">
                      <p className="mb-1 text-sm font-semibold">Pagamento integral com E-Crédito</p>
                      <p className="text-xs leading-5">
                        O crédito de <strong>{formatCurrency(saldoRestante)}</strong> cobre todo o saldo desta cobrança.
                        Nenhum pagamento secundário é necessário.
                      </p>
                    </div>
                  )}
                </div>
              </PanelCard>
            ) : null}

            {isFaturado ? (
                <PanelCard
                  title="Campos mínimos do faturado"
                  description="Condição comercial e aviso resumido de crédito."
                >
                  <div className="max-w-md">
                    <Field label="Condição comercial">
                      <input
                        value={form.condicaoPagamento}
                        onChange={(event) => patchForm({ condicaoPagamento: event.target.value })}
                        className={inputClass}
                        placeholder="Ex.: Faturado 28 dias"
                      />
                    </Field>
                  </div>

                  {isLoadingCredit ? (
                    <div className="mt-4 p-4 text-center rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
                      <span className="text-sm text-slate-600 font-semibold">Consultando análise de crédito real...</span>
                    </div>
                  ) : (
                    <div className="mt-4 space-y-4">
                      <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
                        <InfoBox label="Limite de crédito" value={formatCurrency(analiseCredito.limite)} />
                        <InfoBox label="Utilizado" value={formatCurrency(analiseCredito.utilizado)} />
                        <InfoBox label="Disponível" value={formatCurrency(analiseCredito.disponivel - form.valor)} />
                        <InfoBox label="Valor solicitado" value={formatCurrency(analiseCredito.valorSolicitado)} />
                        <InfoBox 
                          label="Faturamentos vencidos" 
                          value={analiseCredito.qtdAtrasados > 0 ? `${analiseCredito.qtdAtrasados} pendente(s)` : "Nenhum atraso"} 
                          detail={analiseCredito.qtdAtrasados > 0 ? "Requer avaliação do financeiro" : "Histórico regular"}
                          tone={analiseCredito.qtdAtrasados > 0 ? "danger" : undefined}
                        />
                        <InfoBox label="Risco de crédito" value={analiseCredito.risco} />
                      </div>

                      {analiseCredito.statusAnalise === "APROVADO" ? (
                        <div className="rounded-2xl border p-4 border-teal-200 bg-teal-50 text-teal-800">
                          <p className="font-semibold">Limite operacional disponível.</p>
                          <p className="mt-1 text-sm leading-6">
                            Cliente possui limite livre e sem atrasos. A cobrança entrará como pendência financeira aguardando autorização operacional do financeiro.
                          </p>
                        </div>
                      ) : null}
                    </div>
                  )}
                </PanelCard>
              ) : null}

              <p className="text-sm text-slate-600">
                Esta proposta já possui <strong className="text-slate-900">{cobrancasDaProposta.length}</strong> cobrança(s) gerada(s).
              </p>
            </div>

            <div className="border-t border-slate-100 bg-white p-4 sm:p-5 md:p-6">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-sm font-semibold text-slate-700">
                  Proposta #{proposta.id_int} • {getRotuloModalidadeExibicao(form.tipoCobranca, form.cartaoFluxo)} • {formatCurrency(form.parcelaSelecionada?.valorFinal ?? form.valor)}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitClick}
                    disabled={
                      isSaving ||
                      !tipoDisponivel ||
                      (form.tipoCobranca === "E-CREDITO" && (form.valor <= 0 || form.valor > saldoCredito || form.valor > saldoRestante)) ||
                      (form.tipoCobranca === "E-CREDITO" && form.valor < saldoRestante && tipoSecundario === "E-FATURADO" && !condicaoSecundaria)
                    }
                    className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
                  >
                    {isSaving ? "Gerando cobrança..." : "Gerar cobrança"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showPendingAlert ? (
        <div className="fixed inset-0 z-[80] bg-slate-950/60 p-4 flex items-center justify-center animate-fade-in" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-6">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-slate-950">Aviso de Pendência</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Este cliente possui faturamento vencido em aberto. A solicitação ficará bloqueada sob avaliação do financeiro.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowPendingAlert(false)}
                className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={async () => {
                  setShowPendingAlert(false);
                  await handleSubmit(true);
                }}
                className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
              >
                Enviar para avaliação
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showDebitoModal ? (
        <div className="fixed inset-0 z-[85] bg-slate-950/60 p-4 flex items-center justify-center animate-fade-in" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-5">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-slate-950">Cliente com débito em aberto</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                {proposta.cliente?.nome ?? "Este cliente"} possui <strong>{formatCurrency(saldoDevedor)}</strong> em débito na conta corrente.
                Quer incluir nesta cobrança parte ou o total do débito deste cliente?
              </p>
              <p className="text-xs text-slate-500">Não é obrigatório — a cobrança pode ser gerada normalmente pelo valor da proposta.</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-500">Valor do débito a incluir (R$)</label>
              <input
                type="text"
                inputMode="decimal"
                value={debitoInputValor}
                onChange={(e) => setDebitoInputValor(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm"
                placeholder="0,00"
              />
              <p className="text-[11px] text-slate-400">Máximo: {formatCurrency(pendenciaDebitoAlvo?.valor_saldo ?? 0)}</p>
              {pendenciaDebitoAlvo && saldoDevedor > pendenciaDebitoAlvo.valor_saldo + 0.01 ? (
                <p className="text-[11px] text-amber-600">
                  Este cliente possui outras pendências de débito além desta ({formatCurrency(saldoDevedor)} no total).
                  Esta cobrança pode incluir no máximo a pendência mais antiga; use a tela de Conta Corrente para as demais.
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowDebitoModal(false)}
                className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setDebitoIncluido(0);
                  setDebitoResolvido(true);
                  setShowDebitoModal(false);
                  void handleSubmit(undefined, 0);
                }}
                className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Não incluir
              </button>
              <button
                type="button"
                onClick={() => {
                  const parsed = parseFloat(debitoInputValor.replace(",", "."));
                  const limiteReservavel = pendenciaDebitoAlvo?.valor_saldo ?? 0;
                  if (isNaN(parsed) || parsed <= 0 || parsed > limiteReservavel + 0.01) {
                    showToast({ type: "error", title: `Informe um valor entre R$ 0,01 e ${formatCurrency(limiteReservavel)}.` });
                    return;
                  }
                  const arredondado = Math.round(parsed * 100) / 100;
                  setDebitoIncluido(arredondado);
                  setDebitoResolvido(true);
                  setShowDebitoModal(false);
                  void handleSubmit(undefined, arredondado);
                }}
                className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
              >
                Incluir no valor
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {telefoneModalOpen ? (
      <CorrigirTelefonePagadorModal
        isOpen={true}
        onClose={() => setTelefoneModalOpen(false)}
        pagador={pagador ? { idCliente: pagador.idCliente, nome: pagador.nome } : null}
        fontes={fonesDoPagadorAtual ?? { whatsapp1: null, whatsapp2: null, telefoneFixo: null }}
        modalidade={modalidadeBloqueada}
        somenteCelular={somenteCelularNoModal}
        onSalvo={(whatsapp1Normalizado) => {
          // Reflete a gravação no estado local para o gate liberar na hora, sem
          // depender de reabrir o modal ou reler o cadastro.
          setFonesPagador((atual) =>
            atual ? { ...atual, whatsapp1: whatsapp1Normalizado } : atual
          );
          showToast({
            type: "success",
            title: "Telefone atualizado no cadastro",
            description: "Pode gerar a cobrança."
          });
        }}
      />
      ) : null}
    </div>
  );
}

function CobrancasDaPropostaList({ cobrancas, onSelectCobranca, onRefreshProposta }: { cobrancas: Cobranca[], onSelectCobranca: (id: string) => void, onRefreshProposta?: () => void }) {
  const { showToast } = useAppToast();
  const { user } = useAuth();
  const [cobrancaParaExcluir, setCobrancaParaExcluir] = useState<Cobranca | null>(null);

  // Cancelar cobrança exige permissão. `cobrancas.cancel` = poder financeiro pleno;
  // `propostas.cancelar_cobranca_nao_paga` = só cobrança não paga da própria proposta.
  // A rota /api/cobrancas/cancelar-externo revalida permissão, escopo e estado.
  const podeCancelarCobranca = Boolean(
    user?.isSuperAdmin ||
    user?.isAdmin ||
    hasPermissao(user, "cobrancas.cancel") ||
    hasPermissao(user, "propostas.cancelar_cobranca_nao_paga")
  );

  const handleAbrirCheckout = async (url: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showToast({
        type: "success",
        title: "Link do checkout copiado."
      });
    } catch (err) {
      console.error("[PropostaCobrancaPanel] Erro ao copiar link do checkout:", err);
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleCopyUrl = async (url: string | undefined) => {
    if (!url) {
      showToast({ type: "error", title: "URL indisponível." });
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast({ type: "success", title: "URL copiada com sucesso." });
    } catch {
      showToast({ type: "error", title: "Erro ao copiar URL." });
    }
  };



  if (!cobrancas.length) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500 text-center">
        Nenhuma cobrança criada para esta proposta ainda.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {cobrancas.map((cobranca) => {
        const valorCobranca = getValorCobranca(cobranca);
        const tipoNormalized = cobranca.tipo_cobranca?.trim().toUpperCase().replace(/_/g, "-");
        const isFaturado = tipoNormalized === "E-FATURADO" || tipoNormalized === "FATURADO";
        const isBoleto = tipoNormalized === "BOLETO";
        const isPix = tipoNormalized === "PIX";
        const isCard = tipoNormalized === "CARD-PARCELADO" || tipoNormalized === "CARD_PARCELADO";
        const boletoUrl = cobranca.url_pdf || cobranca.pix_copia_cola || "";

        return (
          <div
            key={cobranca.id}
            className="rounded-2xl border border-slate-200 bg-white hover:border-slate-300 transition duration-150 shadow-sm"
          >
            {/* Desktop Layout */}
            <div className="hidden lg:grid lg:grid-cols-[1fr_1.3fr_1.3fr_1fr_1.2fr_2.2fr] lg:gap-4 lg:items-center p-4">
              {/* Col 1: Identificador */}
              <div className="truncate">
                <p className="text-sm font-bold text-slate-900">{cobranca.id_pagamento}</p>
              </div>

              {/* Col 2: Cliente */}
              <div className="truncate" title={cobranca.cliente}>
                <p className="text-xs text-slate-600 truncate">{cobranca.cliente}</p>
              </div>

              {/* Col 3: Tipo + OS Ideal */}
              <div>
                <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800">
                  {getCobrancaTipoLabel(cobranca.tipo_cobranca)}
                </span>
                <p className="mt-1 text-[11px] text-slate-500">
                  OS: <span className="font-semibold text-slate-700">{cobranca.os_ideal || "-"}</span>
                </p>
              </div>

              {/* Col 4: Valor */}
              <div>
                <p className="text-sm font-bold text-slate-900">
                  {formatCurrency(valorCobranca)}
                </p>
                {cobranca.tipo_cobranca === "CARD_PARCELADO" && cobranca.cartao_parcelas ? (
                  <p className="text-[10px] text-slate-500">{cobranca.cartao_parcelas}x</p>
                ) : null}
              </div>

              {/* Col 5: Confirmação */}
              <div>
                {cobranca.status === "CANCELADO" ? (
                  <StatusBadge status="CANCELADO" />
                ) : cobranca.confirmado ? (
                  <StatusBadge status="CONFIRMADO" />
                ) : isCreditoPendente(cobranca) ? (
                  <StatusBadge status="AGUARDANDO_CREDITO" />
                ) : cobranca.status === "A_VENCER" ? (
                  <StatusBadge status="A_VENCER" />
                ) : cobranca.status === "PAID" ? (
                  // Pago e aguardando conferência. A lista caía no genérico
                  // "Não confirmado" enquanto o detalhe da mesma cobrança já
                  // dizia "Pago / A liberar" — o vendedor lia como não pago.
                  <StatusBadge status="PAGO_A_LIBERAR" />
                ) : (
                  <StatusBadge status="NAO_CONFIRMADO" />
                )}
              </div>

              {/* Col 6: Ações */}
              <div className="flex flex-wrap sm:flex-nowrap items-center justify-end gap-2 w-full sm:w-auto">
                {isBoleto ? (
                  <>
                    {boletoUrl ? (
                      <a
                        href={boletoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-10 min-w-[120px] px-4 inline-flex items-center justify-center rounded-xl text-sm font-semibold whitespace-nowrap bg-teal-600 text-white hover:bg-teal-700 shadow-sm transition"
                      >
                        Abrir boleto
                      </a>
                    ) : (
                      <button
                        disabled
                        className="h-10 min-w-[120px] px-4 inline-flex items-center justify-center rounded-xl text-sm font-semibold whitespace-nowrap bg-slate-200 text-slate-400 cursor-not-allowed transition"
                        title="Boleto ainda não disponível"
                      >
                        Indisponível
                      </button>
                    )}
                  </>
                ) : isPix ? (
                  <>
                    {cobranca.pix_copia_cola && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(cobranca.pix_copia_cola || "");
                            showToast({ type: "success", title: "PIX Copia e Cola copiado!" });
                          } catch {
                            showToast({ type: "error", title: "Erro ao copiar PIX." });
                          }
                        }}
                        className="h-10 min-w-[120px] px-4 inline-flex items-center justify-center rounded-xl text-sm font-semibold whitespace-nowrap border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition"
                        title="Copiar código PIX"
                      >
                        Pix Copia e cola
                      </button>
                    )}
                  </>
                ) : isCard ? (
                  <>
                    {cobranca.cartao_checkout_url ? (
                      <a
                        href={cobranca.cartao_checkout_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-10 min-w-[120px] px-4 inline-flex items-center justify-center rounded-xl text-sm font-semibold whitespace-nowrap bg-teal-600 text-white hover:bg-teal-700 shadow-sm transition"
                      >
                        Abrir checkout
                      </a>
                    ) : cobranca.url_cobranca ? (
                      <button
                        type="button"
                        onClick={() => handleAbrirCheckout(cobranca.url_cobranca || "")}
                        className="h-10 min-w-[120px] px-4 inline-flex items-center justify-center rounded-xl text-sm font-semibold whitespace-nowrap border border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100 transition"
                      >
                        Abrir checkout
                      </button>
                    ) : (
                      <button
                        disabled
                        className="h-10 min-w-[120px] px-4 inline-flex items-center justify-center rounded-xl text-sm font-semibold whitespace-nowrap bg-slate-200 text-slate-400 cursor-not-allowed transition"
                        title="Página do cartão ainda não disponível"
                      >
                        Indisponível
                      </button>
                    )}
                  </>
                ) : (
                  cobranca.url_cobranca && !isFaturado && (
                    <button
                      type="button"
                      onClick={() => handleAbrirCheckout(cobranca.url_cobranca || "")}
                      className="h-10 min-w-[120px] px-4 inline-flex items-center justify-center rounded-xl text-sm font-semibold whitespace-nowrap border border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100 transition"
                    >
                      Abrir checkout
                    </button>
                  )
                )}

                <button
                  type="button"
                  onClick={() => handleCopyUrl(cobranca.url_cobranca || cobranca.cartao_checkout_url || cobranca.pix_copia_cola || cobranca.linha_digitavel)}
                  disabled={!(cobranca.url_cobranca || cobranca.cartao_checkout_url || cobranca.pix_copia_cola || cobranca.linha_digitavel)}
                  className="h-10 min-w-[120px] px-4 inline-flex items-center justify-center rounded-xl text-sm font-semibold whitespace-nowrap border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copiar
                </button>

                <button
                  type="button"
                  onClick={() => onSelectCobranca(cobranca.id)}
                  className="h-10 min-w-[120px] px-4 inline-flex items-center justify-center rounded-xl text-sm font-semibold whitespace-nowrap bg-[#0b2f4a] text-white hover:bg-[#123f61] transition"
                >
                  Ver cobrança
                </button>

                <button
                  type="button"
                  disabled={!podeCancelarCobranca || cobranca.status === "PAID" || cobranca.status === "A_VENCER" || cobranca.confirmado}
                  onClick={() => setCobrancaParaExcluir(cobranca)}
                  title={
                    !podeCancelarCobranca ? "Sem permissão para cancelar cobrança"
                    : cobranca.status === "PAID" ? "Não é possível excluir cobrança paga"
                    : cobranca.status === "A_VENCER" ? "Não é possível excluir faturamento aprovado"
                    : cobranca.confirmado ? "Não é possível excluir cobrança confirmada"
                    : "Excluir cobrança"
                  }
                  className="h-10 min-w-[120px] px-4 inline-flex items-center justify-center rounded-xl text-sm font-semibold whitespace-nowrap bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  Excluir
                </button>

              </div>
            </div>

            {/* Mobile Layout */}
            <div className="lg:hidden p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-900">{cobranca.id_pagamento}</p>
                  <p className="text-xs text-slate-500 truncate max-w-[200px]" title={cobranca.cliente}>
                    {cobranca.cliente}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-900">
                    {formatCurrency(valorCobranca)}
                  </p>
                  <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800">
                    {getCobrancaTipoLabel(cobranca.tipo_cobranca)}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-2 py-2 border-t border-b border-slate-100 text-xs">
                <div>
                  <span className="text-slate-500">OS Ideal: </span>
                  <span className="font-semibold text-slate-800">{cobranca.os_ideal || "-"}</span>
                </div>
                <div>
                  <span className="text-slate-500">Confirmado: </span>
                  <span className="font-semibold text-slate-800">{cobranca.confirmado ? "Sim" : "Não"}</span>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                <div>
                  {cobranca.status === "CANCELADO" ? (
                    <StatusBadge status="CANCELADO" />
                  ) : cobranca.confirmado ? (
                    <StatusBadge status="CONFIRMADO" />
                  ) : isCreditoPendente(cobranca) ? (
                    <StatusBadge status="AGUARDANDO_CREDITO" />
                  ) : cobranca.status === "A_VENCER" ? (
                    <StatusBadge status="A_VENCER" />
                  ) : cobranca.status === "PAID" ? (
                    // Mesma regra do bloco acima e do detalhe da cobrança.
                    <StatusBadge status="PAGO_A_LIBERAR" />
                  ) : (
                    <StatusBadge status="NAO_CONFIRMADO" />
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  <button
                    type="button"
                    disabled={!podeCancelarCobranca || cobranca.status === "PAID" || cobranca.status === "A_VENCER" || cobranca.confirmado}
                    onClick={() => setCobrancaParaExcluir(cobranca)}
                    title={
                      !podeCancelarCobranca ? "Sem permissão para cancelar cobrança"
                      : cobranca.status === "PAID" ? "Não é possível excluir cobrança paga"
                      : cobranca.status === "A_VENCER" ? "Não é possível excluir faturamento aprovado"
                      : cobranca.confirmado ? "Não é possível excluir cobrança confirmada"
                      : "Excluir cobrança"
                    }
                    className="inline-flex items-center justify-center rounded-xl bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed border border-red-200"
                  >
                    Excluir
                  </button>
                  {isBoleto ? (
                    <>
                      {boletoUrl ? (
                        <a
                          href={boletoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center rounded-xl bg-teal-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-700 shadow-sm"
                        >
                          Abrir boleto
                        </a>
                      ) : (
                        <button
                          disabled
                          className="inline-flex items-center justify-center rounded-xl bg-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-400 cursor-not-allowed"
                        >
                          Indisponível
                        </button>
                      )}
                    </>
                  ) : isPix ? (
                    <>
                      {cobranca.url_cobranca && (
                        <button
                          type="button"
                          onClick={() => handleAbrirCheckout(cobranca.url_cobranca || "")}
                          className="inline-flex items-center justify-center rounded-xl border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-800 transition hover:bg-teal-100"
                        >
                          Abrir checkout
                        </button>
                      )}
                      {cobranca.pix_copia_cola && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(cobranca.pix_copia_cola || "");
                              showToast({ type: "success", title: "PIX Copia e Cola copiado!" });
                            } catch {
                              showToast({ type: "error", title: "Erro ao copiar PIX." });
                            }
                          }}
                          className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                          title="Copiar código PIX"
                        >
                          Pix Copia e cola
                        </button>
                      )}
                    </>
                  ) : isCard ? (
                    <>
                      {cobranca.cartao_checkout_url ? (
                        <a
                          href={cobranca.cartao_checkout_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center rounded-xl bg-teal-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-700 shadow-sm"
                        >
                          Abrir checkout cartão
                        </a>
                      ) : cobranca.url_cobranca ? (
                        <button
                          type="button"
                          onClick={() => handleAbrirCheckout(cobranca.url_cobranca || "")}
                          className="inline-flex items-center justify-center rounded-xl border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-800 transition hover:bg-teal-100"
                        >
                          Escolher parcelas
                        </button>
                      ) : (
                        <button
                          disabled
                          className="inline-flex items-center justify-center rounded-xl bg-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-400 cursor-not-allowed"
                        >
                          Indisponível
                        </button>
                      )}
                    </>
                  ) : (
                    cobranca.url_cobranca && !isFaturado && (
                      <button
                        type="button"
                        onClick={() => handleAbrirCheckout(cobranca.url_cobranca || "")}
                        className="inline-flex items-center justify-center rounded-xl border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-800 transition hover:bg-teal-100"
                      >
                        Abrir checkout
                      </button>
                    )
                  )}
                  <button
                    type="button"
                    onClick={() => handleCopyUrl(cobranca.url_cobranca || cobranca.cartao_checkout_url || cobranca.pix_copia_cola || cobranca.linha_digitavel)}
                    disabled={!(cobranca.url_cobranca || cobranca.cartao_checkout_url || cobranca.pix_copia_cola || cobranca.linha_digitavel)}
                    className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Copiar link"
                  >
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    Copiar
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectCobranca(cobranca.id)}
                    className="inline-flex items-center justify-center rounded-xl bg-[#0b2f4a] px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-[#123f61]"
                  >
                    Ver
                  </button>


                </div>
              </div>
            </div>
          </div>
        );
      })}

      {cobrancaParaExcluir ? (
        <CancelCobrancaModal
          isOpen={true}
          onClose={() => setCobrancaParaExcluir(null)}
          cobrancaId={cobrancaParaExcluir.id}
          onSuccess={() => {
            setCobrancaParaExcluir(null);
            onRefreshProposta?.();
          }}
        />
      ) : null}
    </div>
  );
}

function getValorCobranca(cobranca: Cobranca) {
  const tipoNormalized = cobranca.tipo_cobranca?.trim().toUpperCase().replace(/_/g, "-");
  if (tipoNormalized === "CARD-PARCELADO" && typeof cobranca.cartao_valor_final === "number" && cobranca.cartao_valor_final > 0) {
    return cobranca.cartao_valor_final;
  }
  return cobranca.valor;
}



function getEmpresaIdByNome(nome: string | undefined): number {
  if (!nome) return 1;
  const normalized = nome.trim().toUpperCase();
  if (normalized.includes("IDEAL GRÁFICA") || normalized.includes("IDEAL GRAFICA") || normalized.includes("INGRESSO IDEAL")) {
    return 1;
  }
  if (normalized.includes("IDEAL BIRÔ") || normalized.includes("IDEAL BIRO") || normalized.includes("BIRO")) {
    return 2;
  }
  if (normalized.includes("E3 BRINDES") || normalized.includes("E3")) {
    return 3;
  }
  return 1; // Default
}
