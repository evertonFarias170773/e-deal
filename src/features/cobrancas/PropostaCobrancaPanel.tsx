"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, Landmark, QrCode, ReceiptText, X } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { Field, PanelCard, inputClass, InfoBox } from "@/features/cobrancas/form-ui";
import type { Cobranca, CobrancaTipo, CriarCobrancaFormValues, CreditAnalysisResult, ModeloCobranca } from "@/features/cobrancas/types";
import type { Proposta } from "@/features/orcamentos/types";
import { CobrancaDetail } from "@/features/cobrancas/CobrancaDetail";
import { CancelCobrancaModal } from "./CancelCobrancaModal";
import { getSupabaseClient } from "@/lib/supabase/client";
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

export function PropostaCobrancaPanel({
  proposta,
  isModalOpen,
  onOpenModal,
  onCloseModal,
  defaultModalOpen = false,
  onlyModal = false,
  onSavePropostaRequest,
  onRefreshProposta
}: PropostaCobrancaPanelProps) {
  const { showToast } = useAppToast();
  const { createCobranca, getCobrancasByProposta, source, cobrancas } = useCobrancas();
  const [internalModalOpen, setInternalModalOpen] = useState(defaultModalOpen);
  const [selectedCobrancaId, setSelectedCobrancaId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUserEditingValor, setIsUserEditingValor] = useState(false);
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

  /** Retorna data futura no formato YYYY-MM-DD (padrão: 30 dias à frente). */
  function getDefaultVencimento(daysAhead = 3): string {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function buildInitialFormState(): CriarCobrancaFormValues {
    const cobrancaComOs = cobrancasDaProposta.find((item) => item.os_ideal && item.os_ideal.trim() !== "");
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const tipoDisponivel = source === "supabase"
    ? (form.tipoCobranca === "PIX"
        ? (idEmpresaReal === 1 || idEmpresaReal === 2 || idEmpresaReal === 3)
        : form.tipoCobranca === "BOLETO"
          ? (idEmpresaReal === 1 || idEmpresaReal === 3)
          : form.tipoCobranca === "CARD_PARCELADO"
            ? (idEmpresaReal === 1 || idEmpresaReal === 3)
            : isFaturado
              ? true
              : false)
    : isTipoDisponivelParaEmpresa(proposta.empresa, form.tipoCobranca);

  const indisponibilidadeMensagem = source === "supabase"
    ? (form.tipoCobranca === "PIX"
        ? (idEmpresaReal === 1 || idEmpresaReal === 2 || idEmpresaReal === 3 ? "" : "PIX real disponível apenas para as empresas Ideal Gráfica, Ideal Birô e E3 Brindes.")
        : form.tipoCobranca === "BOLETO"
          ? (idEmpresaReal === 1 || idEmpresaReal === 3 ? "" : "Boleto real disponível apenas para as empresas Ideal Gráfica e E3 Brindes.")
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
      const saldoCarteira = realCreditAnalysis.saldo_carteira;
      const qtdAtrasados = realCreditAnalysis.qtd_pagamentos_atrasados;
      
      const aprovado = disponivel >= form.valor && qtdAtrasados === 0;

      return {
        limite,
        utilizado,
        saldoCarteira,
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
      saldoCarteira: 0,
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

    // Reset do formulário apenas ao abrir o modal para evitar sobrescrever edição em andamento.
    setIsUserEditingValor(false);
    setForm(buildInitialFormState());

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

    onCloseModal?.();
  }, [isControlled, onCloseModal]);

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

  function handleTipoChange(tipo: CobrancaTipo) {
    patchForm({
      tipoCobranca: tipo,
      parcelaSelecionada: undefined,
      condicaoPagamento: tipo === "CARD_PARCELADO" ? "Cartão de crédito" : (tipo === "E-FATURADO" ? "Faturado" : proposta.formaPagamento),
      vencimento: tipo === "BOLETO" || tipo === "E-FATURADO" ? form.vencimento || getDefaultVencimento(30) : form.vencimento
    });
  }

  async function handleSubmit(bypassPendingCheck?: boolean | React.MouseEvent) {
    const shouldBypass = bypassPendingCheck === true;
    if (isSaving) {
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

    if (source === "supabase" && form.tipoCobranca !== "PIX" && form.tipoCobranca !== "BOLETO" && form.tipoCobranca !== "CARD_PARCELADO" && form.tipoCobranca !== "E-FATURADO") {
      showToast({ type: "warning", title: "Forma de pagamento em preparação. Selecione PIX, Boleto ou Cartão para testes reais." });
      return;
    }

    if (source === "supabase" && idEmpresaReal !== 1 && idEmpresaReal !== 2 && idEmpresaReal !== 3) {
      showToast({ type: "error", title: "Criação de cobrança real disponível apenas para as empresas Ideal Gráfica, Ideal Birô e E3 Brindes nesta etapa." });
      return;
    }

    if (source === "supabase" && form.tipoCobranca === "BOLETO" && idEmpresaReal === 2) {
      showToast({ type: "error", title: "Geração de boleto real não disponível para a empresa Ideal Birô." });
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

    if (isFaturado && !form.observacao?.trim()) {
      showToast({ type: "error", title: "A observação do faturamento (condição desejada) é obrigatória." });
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
        p_qtd_parcelas: selectedModel.qtd_parcela,
        p_dias_pra_inicio: selectedModel.inicio,
        p_intervalo: selectedModel.intervalo,
        p_valor_entrada: selectedModel.entrada_porcento > 0 ? (roundedValor * (selectedModel.entrada_porcento / 100)) : 0
      };
    }

    const payload: CriarCobrancaFormValues = {
      ...form,
      ...extraPayload,
      vencimento: payloadVencimento,
      valor: roundedValor,
      descricao: `Cobrança ${getCobrancaTipoLabel(form.tipoCobranca)} da proposta #${proposta.id_int}`,
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
        showToast({
          type: "warning",
          title: "Faturamento em análise",
          description: "Solicitação enviada para avaliação do financeiro."
        });
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

  const opcoesPagamento: Array<{
    id: CobrancaTipo;
    label: string;
    icon: typeof QrCode;
    blockedText?: string;
  }> = [
    { id: "PIX", label: "PIX", icon: QrCode },
    { id: "BOLETO", label: "Boleto", icon: ReceiptText },
    { id: "CARD_PARCELADO", label: "Cartão de crédito", icon: CreditCard },
    { id: "E-FATURADO", label: "Faturado", icon: Landmark }
  ];

  const hasCobrancas = cobrancasAtivas.length > 0;

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
                    onChange={(event) => {
                      const selectedId = Number(event.target.value);
                      const matched = EMPRESAS_RECEBEDORAS_FIXAS.find((e) => e.id === selectedId);
                      if (matched) {
                        patchForm({
                          id_empresa: matched.id,
                          empresa: matched.nome
                        });
                      }
                    }}
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
                  <input readOnly value={getCobrancaTipoLabel(form.tipoCobranca)} className={`${inputClass} cursor-not-allowed bg-slate-100 text-slate-500`} />
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
                  <Field label={isFaturado ? "Observações (Condição comercial solicitada) *" : "Observações"}>
                    <textarea
                      value={form.observacao}
                      onChange={(event) => patchForm({ observacao: event.target.value })}
                      className={`${inputClass} min-h-24 resize-y ${isFaturado && !form.observacao?.trim() ? "border-red-300 focus:border-red-500 focus:ring-red-100" : ""}`}
                      placeholder={isFaturado ? "Informe a condição desejada, ex.: 14/28 dias (obrigatório)" : "Observação opcional"}
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
                    : form.tipoCobranca === opcao.id;
                  const available = source === "supabase"
                    ? (opcao.id === "PIX"
                        ? (idEmpresaReal === 1 || idEmpresaReal === 2 || idEmpresaReal === 3)
                        : opcao.id === "BOLETO"
                          ? (idEmpresaReal === 1 || idEmpresaReal === 3)
                          : opcao.id === "CARD_PARCELADO"
                            ? (idEmpresaReal === 1 || idEmpresaReal === 3)
                            : true)
                    : isTipoDisponivelParaEmpresa(proposta.empresa, opcao.id);
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
                        handleTipoChange(opcao.id);
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
                        <Icon className="h-4 w-4 text-slate-700" />
                        <span className="text-sm font-semibold text-slate-900">{opcao.label}</span>
                      </div>
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
                      {source === "supabase" && (
                        <InfoBox label="Saldo de carteira" value={formatCurrency(analiseCredito.saldoCarteira || 0)} />
                      )}
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
                Proposta #{proposta.id_int} • {getCobrancaTipoLabel(form.tipoCobranca)} • {formatCurrency(form.parcelaSelecionada?.valorFinal ?? form.valor)}
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
                  onClick={handleSubmit}
                  disabled={isSaving || !tipoDisponivel}
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
        {!hasCobrancas ? (
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
                  patchForm({ valor: saldoRestante });
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

                <div className="flex flex-col gap-2 sm:flex-row">
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
                        patchForm({ valor: saldoRestante });
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
                    onChange={(event) => {
                      const selectedId = Number(event.target.value);
                      const matched = EMPRESAS_RECEBEDORAS_FIXAS.find((e) => e.id === selectedId);
                      if (matched) {
                        patchForm({
                          id_empresa: matched.id,
                          empresa: matched.nome
                        });
                      }
                    }}
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
                    <input readOnly value={getCobrancaTipoLabel(form.tipoCobranca)} className={`${inputClass} cursor-not-allowed bg-slate-100 text-slate-500`} />
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
                    <Field label={isFaturado ? "Observações (Condição comercial solicitada) *" : "Observações"}>
                      <textarea
                        value={form.observacao}
                        onChange={(event) => patchForm({ observacao: event.target.value })}
                        className={`${inputClass} min-h-24 resize-y ${isFaturado && !form.observacao?.trim() ? "border-red-300 focus:border-red-500 focus:ring-red-100" : ""}`}
                        placeholder={isFaturado ? "Informe a condição desejada, ex.: 14/28 dias (obrigatório)" : "Observação opcional"}
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
                      : form.tipoCobranca === opcao.id;
                    const available = source === "supabase"
                      ? (opcao.id === "PIX"
                          ? (idEmpresaReal === 1 || idEmpresaReal === 2 || idEmpresaReal === 3)
                          : opcao.id === "BOLETO"
                            ? (idEmpresaReal === 1 || idEmpresaReal === 3)
                            : opcao.id === "CARD_PARCELADO"
                              ? (idEmpresaReal === 1 || idEmpresaReal === 3)
                              : true)
                      : isTipoDisponivelParaEmpresa(proposta.empresa, opcao.id);
                    const isActuallyDisabled = !available;
                    const disabledText = available
                      ? ""
                      : "Indisponível para esta empresa.";

                    return (
                      <button
                        key={opcao.id}
                        type="button"
                        disabled={isActuallyDisabled}
                        onClick={() => handleTipoChange(opcao.id)}
                        className={`rounded-2xl border px-3 py-2 text-left transition ${
                          selected
                            ? "border-[#0f9f9a] bg-[#dff8f6]"
                            : "border-slate-200 bg-white hover:bg-slate-50"
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                        title={disabledText}
                      >
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-slate-700" />
                          <span className="text-sm font-semibold text-slate-900">{opcao.label}</span>
                        </div>
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
                        {source === "supabase" && (
                          <InfoBox label="Saldo de carteira" value={formatCurrency(analiseCredito.saldoCarteira || 0)} />
                        )}
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
                  Proposta #{proposta.id_int} • {getCobrancaTipoLabel(form.tipoCobranca)} • {formatCurrency(form.parcelaSelecionada?.valorFinal ?? form.valor)}
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
                    onClick={handleSubmit}
                    disabled={isSaving || !tipoDisponivel}
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
    </div>
  );
}

function CobrancasDaPropostaList({ cobrancas, onSelectCobranca, onRefreshProposta }: { cobrancas: Cobranca[], onSelectCobranca: (id: string) => void, onRefreshProposta?: () => void }) {
  const { showToast } = useAppToast();
  const [cobrancaParaExcluir, setCobrancaParaExcluir] = useState<Cobranca | null>(null);

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
                  onClick={() => onSelectCobranca(cobranca.id)}
                  className="h-10 min-w-[120px] px-4 inline-flex items-center justify-center rounded-xl text-sm font-semibold whitespace-nowrap bg-[#0b2f4a] text-white hover:bg-[#123f61] transition"
                >
                  Ver cobrança
                </button>

                <button
                  type="button"
                  disabled={cobranca.status === "PAID" || cobranca.status === "A_VENCER" || cobranca.confirmado}
                  onClick={() => setCobrancaParaExcluir(cobranca)}
                  title={
                    cobranca.status === "PAID" ? "Não é possível excluir cobrança paga"
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
                  ) : (
                    <StatusBadge status="NAO_CONFIRMADO" />
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  <button
                    type="button"
                    disabled={cobranca.status === "PAID" || cobranca.status === "A_VENCER" || cobranca.confirmado}
                    onClick={() => setCobrancaParaExcluir(cobranca)}
                    title={
                      cobranca.status === "PAID" ? "Não é possível excluir cobrança paga"
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
