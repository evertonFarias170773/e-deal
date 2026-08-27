"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { X, FileText, AlertTriangle, Loader2, CheckCircle2, Calendar } from "lucide-react";
import { formatCurrency } from "@/lib/formatters/currency";
import { useAppToast } from "@/components/common/AppToast";
import { useAuth } from "@/features/auth/AuthProvider";
import type { Cobranca, ModeloCobranca } from "@/features/cobrancas/types";

/** Uma linha ativa de `notas_fiscais_pagamentos`, do jeito que foi gravada. */
export interface ParcelaFiscalOrigem {
  numero_parcela: number;
  total_parcelas: number;
  data_vencimento: string;
  valor: number;
}

/**
 * Abertura a partir de uma NF-e autorizada.
 *
 * Quando esta prop vem preenchida, as parcelas do contas a receber NÃO são
 * calculadas: são as parcelas fiscais já gravadas em `notas_fiscais_pagamentos`
 * (ativo = true), com a data e o valor exatos de cada linha. A duplicata já foi
 * transmitida à SEFAZ com essas datas — recalcular aqui faria o título divergir
 * do documento fiscal.
 */
export interface OrigemNfeLancamento {
  /** `notas_fiscais.ref` — vai para `boletos.ext_reference`. */
  ref: string;
  /** `notas_fiscais.numero_nf` — vai para `boletos.n_nf`. */
  numeroNf: string | null;
  /** Linhas ativas, já ordenadas por `numero_parcela`. */
  parcelas: ParcelaFiscalOrigem[];
  /**
   * Soma das cobranças faturadas EM ABERTO do mesmo `id_int`. A conferência é
   * por totais da proposta, não por cobrança: a venda pode ter sido dividida em
   * vários pagamentos.
   */
  totalFaturadoEmAberto: number;
}

interface PrepararBoletosModalProps {
  isOpen: boolean;
  onClose: () => void;
  cobranca: Cobranca;
  onSuccess: (extReference: string) => void;
  defaultQtdParcelas?: number;
  defaultDiasPraInicio?: number;
  defaultIntervalo?: number;
  /** Ausente = fluxo do Registro de Recebíveis, com gerador automático ativo. */
  origemNfe?: OrigemNfeLancamento;
}

/** Empresa do grupo habilitada a emitir boleto. */
interface EmpresaRecebedora {
  id: number;
  empresa: string;
}

interface GeneratedInstallment {
  parcela: number;
  total_parcelas: number;
  valor: number;
  vencimento: string;
  descricao: string;
  multa: number;
  juros_dia: number;
  deposito_conta: boolean;
}

function getTodayLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateBrFromIso(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  if (!year || !month || !day) return dateStr;
  return `${day}/${month}/${year}`;
}

/**
 * Converte as parcelas fiscais em parcelas do contas a receber, uma para uma.
 *
 * Nada é calculado: `data_vencimento` e `valor` saem como estão na linha. Multa
 * e juros nascem zerados, igual ao gerador manual — a coluna tem DEFAULT antigo
 * (2% / 0,033% ao dia) que entraria sozinho se estes campos fossem omitidos.
 */
function montarParcelasFiscais(origem: OrigemNfeLancamento): GeneratedInstallment[] {
  return origem.parcelas.map((parcela) => ({
    parcela: parcela.numero_parcela,
    total_parcelas: parcela.total_parcelas,
    valor: Number(parcela.valor) || 0,
    vencimento: String(parcela.data_vencimento ?? "").split("T")[0],
    descricao: `Vencimento fiscal ${parcela.numero_parcela}/${parcela.total_parcelas} - Ref: ${origem.ref}`,
    multa: 0,
    juros_dia: 0,
    deposito_conta: false
  }));
}

function addDaysToLocalDateString(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function PrepararBoletosModal({
  isOpen,
  onClose,
  cobranca,
  onSuccess,
  defaultQtdParcelas,
  defaultDiasPraInicio,
  defaultIntervalo,
  origemNfe
}: PrepararBoletosModalProps) {
  const router = useRouter();
  const { showToast } = useAppToast();
  const { marcarComoBoletosPreparadosLocal } = useCobrancas();
  const { user } = useAuth();
  const podeArredondar = Boolean(user?.isAdmin || user?.isSuperAdmin);
  const [step] = useState<"FORM" | "SUCCESS">("FORM");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Condições de pagamento existentes (tabela modelos_cobranca)
  const [modelosCobranca, setModelosCobranca] = useState<ModeloCobranca[]>([]);
  const [modeloSelecionadoId, setModeloSelecionadoId] = useState<string>("");

  // Arredondamento de parcelas (apenas admin/superadmin)
  const [arredondarParcelas, setArredondarParcelas] = useState(false);

  // Parcela única com vencimento escolhido manualmente
  const [parcelaUnica, setParcelaUnica] = useState(false);
  const [vencimentoUnico, setVencimentoUnico] = useState<string>("");

  // Origin info loaded from database
  const [extReference, setExtReference] = useState("");
  const [numeroNf, setNumeroNf] = useState<string | null>(null);
  const [hasNfe, setHasNfe] = useState(false);

  // Empresa recebedora: o financeiro pode emitir por outra empresa do grupo.
  // A escolha vale para o lançamento inteiro e acompanha a cobrança, porque o
  // faturamento por empresa sai de pagamentos_v2.
  const [empresas, setEmpresas] = useState<EmpresaRecebedora[]>([]);
  // `null` = o financeiro não trocou; vale a empresa da própria cobrança. Guardar
  // a escolha e derivar o valor evita resetar estado dentro de efeito, que gera
  // render em cascata.
  const [empresaEscolhida, setEmpresaEscolhida] = useState<number | null>(null);
  const [cobrancaAnterior, setCobrancaAnterior] = useState<string>(String(cobranca.id));

  // Padrão do React para ajustar estado quando a prop muda: o modal não é
  // desmontado ao fechar, então sem isto a escolha de um lançamento vazaria
  // para o próximo.
  if (String(cobranca.id) !== cobrancaAnterior) {
    setCobrancaAnterior(String(cobranca.id));
    setEmpresaEscolhida(null);
  }

  const empresaId = empresaEscolhida ?? (Number(cobranca.id_empresa) || 0);

  // Installment Config parameters
  const valorEntrada = 0;
  const [qtdParcelas, setQtdParcelas] = useState<number>(defaultQtdParcelas && defaultQtdParcelas >= 1 ? defaultQtdParcelas : 1);
  const [diasPraInicio, setDiasPraInicio] = useState<number>(defaultDiasPraInicio !== undefined && defaultDiasPraInicio >= 0 ? defaultDiasPraInicio : 30);
  const [intervalo, setIntervalo] = useState<number>(defaultIntervalo !== undefined && defaultIntervalo >= 0 ? defaultIntervalo : 30);

  // Generated installments list. Vindo de NF, nasce já preenchida com as
  // parcelas fiscais — não há passo de "gerar".
  const [installments, setInstallments] = useState<GeneratedInstallment[]>(() =>
    origemNfe ? montarParcelasFiscais(origemNfe) : []
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  /** Origem NF: parcelas vêm do documento fiscal e não podem ser recalculadas. */
  const origemEhNfe = Boolean(origemNfe);

  // Mesmo padrão do `cobrancaAnterior` acima: o modal não é desmontado ao
  // fechar, então sem isto as parcelas de uma nota vazariam para a próxima.
  const [refNfeAnterior, setRefNfeAnterior] = useState<string | null>(origemNfe?.ref ?? null);
  if ((origemNfe?.ref ?? null) !== refNfeAnterior) {
    setRefNfeAnterior(origemNfe?.ref ?? null);
    setInstallments(origemNfe ? montarParcelasFiscais(origemNfe) : []);
    setValidationError(null);
  }

  /**
   * Conferência por totais da proposta: soma das parcelas fiscais ativas contra
   * a soma das cobranças faturadas em aberto do mesmo `id_int`. Mesma tolerância
   * de 1 centavo do fluxo manual.
   */
  const somaParcelasFiscais = origemNfe
    ? Math.round(installments.reduce((acc, item) => acc + (Number(item.valor) || 0), 0) * 100) / 100
    : 0;
  const divergenciaNfe =
    origemNfe && Math.abs(somaParcelasFiscais - origemNfe.totalFaturadoEmAberto) > 0.01
      ? Math.round((somaParcelasFiscais - origemNfe.totalFaturadoEmAberto) * 100) / 100
      : null;
  const mensagemDivergenciaNfe = origemNfe
    ? `As parcelas fiscais da NF somam ${formatCurrency(somaParcelasFiscais)} e as cobranças faturadas em aberto desta proposta somam ${formatCurrency(origemNfe.totalFaturadoEmAberto)} — diferença de ${formatCurrency(Math.abs(divergenciaNfe ?? 0))}. O lançamento está bloqueado. Regularize a nota ou o financeiro antes de lançar; os valores não são ajustáveis por aqui.`
    : "";

  // Load origin details (NF-e ref/number or fallback safely without fake NFE- prefix)
  useEffect(() => {
    async function loadOriginDetails() {
      // Aberto pela NF: a origem já veio resolvida por quem abriu, com a nota
      // exata que o operador escolheu. Buscar de novo por `id_int` poderia
      // devolver OUTRA nota da mesma proposta (a mais recente), e o título sairia
      // com número e ref de uma nota diferente da que gerou as parcelas.
      if (origemNfe) {
        setExtReference(origemNfe.ref);
        setNumeroNf(origemNfe.numeroNf);
        setHasNfe(true);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const client = getSupabaseClient();
        if (!client) return;

        const { data: nfe, error } = await client
          .from("notas_fiscais")
          .select("ref, numero_nf")
          .eq("id_int", cobranca.id_int)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error("[PrepararBoletosModal] Erro ao buscar NF-e:", error);
        }

        if (nfe) {
          setExtReference(nfe.ref || "");
          setNumeroNf(nfe.numero_nf ? String(nfe.numero_nf) : null);
          setHasNfe(true);
        } else {
          // Safe origin fallback (no fake NFE- simulated)
          let fallbackRef = "";
          if (cobranca.os_ideal && String(cobranca.os_ideal).trim() !== "") {
            fallbackRef = String(cobranca.os_ideal).trim();
          } else if (cobranca.id_pagamento && String(cobranca.id_pagamento).trim() !== "") {
            fallbackRef = String(cobranca.id_pagamento).trim();
          } else {
            fallbackRef = `EFAT-${cobranca.id_int}`;
          }
          setExtReference(fallbackRef);
          setNumeroNf(null);
          setHasNfe(false);
        }
      } catch (err) {
        console.error("[PrepararBoletosModal] Falha ao carregar detalhes:", err);
      } finally {
        setIsLoading(false);
      }
    }

    void loadOriginDetails();
  }, [cobranca, origemNfe]);

  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const fetchEmpresas = async () => {
      const client = getSupabaseClient();
      if (!client) return;
      // Só entram empresas com modelo de boleto: sem `url_boleto_base` a
      // geração do PDF é bloqueada depois, com erro que o operador não
      // conseguiria resolver na tela.
      const { data, error } = await client
        .from("empresas")
        .select("id, empresa, url_boleto_base")
        .order("id", { ascending: true });
      if (error || !data) {
        console.error("[PrepararBoletosModal] Erro ao carregar empresas:", error);
        return;
      }
      setEmpresas(
        (data as Array<{ id: number; empresa: string; url_boleto_base: string | null }>)
          .filter((e) => String(e.url_boleto_base ?? "").trim() !== "")
          .map((e) => ({ id: Number(e.id), empresa: String(e.empresa ?? "") }))
      );
    };
    void fetchEmpresas();
  }, [isOpen]);

  const handleSelecionarModelo = (id: string) => {
    setModeloSelecionadoId(id);
    const modelo = modelosCobranca.find((m) => String(m.id) === id);
    if (!modelo) return;

    const qtd = Number(modelo.qtd_parcela);
    const inicio = Number(modelo.inicio);
    const intervaloModelo = Number(modelo.intervalo);

    setQtdParcelas(Number.isFinite(qtd) && qtd >= 1 ? qtd : 1);
    setDiasPraInicio(Number.isFinite(inicio) && inicio >= 0 ? inicio : 30);
    setIntervalo(Number.isFinite(intervaloModelo) && intervaloModelo >= 0 ? intervaloModelo : 30);
  };

  const handleToggleParcelaUnica = (ativa: boolean) => {
    setParcelaUnica(ativa);
    // Parcelas já geradas no outro modo ficariam inconsistentes na revisão.
    setInstallments([]);
    setValidationError(null);
  };

  const handleGerarParcelas = () => {
    const total = Number(cobranca.valor) || 0;

    if (parcelaUnica) {
      if (!vencimentoUnico) {
        showToast({ type: "warning", title: "Selecione a data de vencimento da parcela única." });
        return;
      }
      if (vencimentoUnico < getTodayLocalDateString()) {
        showToast({ type: "warning", title: "O vencimento não pode ser anterior à data atual." });
        return;
      }

      const descBaseUnica = `Boleto E-Faturado - OS: ${cobranca.os_ideal || cobranca.id_int}`;
      setInstallments([
        {
          parcela: 1,
          total_parcelas: 1,
          valor: Number(total.toFixed(2)),
          vencimento: vencimentoUnico,
          descricao: `Parcela 1/1 - ${descBaseUnica}`,
          multa: 0,
          juros_dia: 0,
          deposito_conta: false
        }
      ]);
      setValidationError(null);
      return;
    }

    const entrada = Number(valorEntrada) || 0;
    const numParcelasFuturas = Number(qtdParcelas) || 1;
    const diasInicio = Number(diasPraInicio) || 0;
    const interv = Number(intervalo) || 0;

    if (entrada < 0) {
      showToast({ type: "warning", title: "Valor de entrada inválido." });
      return;
    }
    if (entrada >= total) {
      showToast({ type: "warning", title: "O valor de entrada deve ser menor que o valor total." });
      return;
    }
    if (numParcelasFuturas < 1) {
      showToast({ type: "warning", title: "A quantidade de parcelas deve ser de no mínimo 1." });
      return;
    }

    const list: GeneratedInstallment[] = [];
    const hojeStr = getTodayLocalDateString();

    const descBase = `Boleto E-Faturado - OS: ${cobranca.os_ideal || cobranca.id_int}`;

    if (entrada > 0) {
      const totalParcelas = numParcelasFuturas + 1;
      // Parcela 1: Entrada
      list.push({
        parcela: 1,
        total_parcelas: totalParcelas,
        valor: entrada,
        vencimento: hojeStr, // Hoje por padrão, porém editável
        descricao: `Entrada - ${descBase}`,
        multa: 0,
        juros_dia: 0,
        deposito_conta: false,
      });

      const valorRestante = Number((total - entrada).toFixed(2));
      const valorBaseParcela = Math.floor((valorRestante / numParcelasFuturas) * 100) / 100;
      const totalCalculado = Number((valorBaseParcela * numParcelasFuturas).toFixed(2));
      const diferenca = Number((valorRestante - totalCalculado).toFixed(2));

      for (let i = 1; i <= numParcelasFuturas; i++) {
        const parcelaNum = i + 1;
        const vencimento = addDaysToLocalDateString(hojeStr, diasInicio + (i - 1) * interv);
        const valorParcela = i === numParcelasFuturas
          ? Number((valorBaseParcela + diferenca).toFixed(2))
          : valorBaseParcela;

        list.push({
          parcela: parcelaNum,
          total_parcelas: totalParcelas,
          valor: valorParcela,
          vencimento,
          descricao: `Parcela ${parcelaNum}/${totalParcelas} - ${descBase}`,
          multa: 0,
          juros_dia: 0,
          deposito_conta: false,
        });
      }
    } else {
      const totalParcelas = numParcelasFuturas;
      const aplicarArredondamento = arredondarParcelas && podeArredondar && totalParcelas > 1;
      const valorBaseParcela = aplicarArredondamento
        ? Math.round(total / totalParcelas)
        : Math.floor((total / totalParcelas) * 100) / 100;
      const totalCalculado = Number((valorBaseParcela * totalParcelas).toFixed(2));
      const diferenca = Number((total - totalCalculado).toFixed(2));

      for (let i = 1; i <= totalParcelas; i++) {
        const vencimento = addDaysToLocalDateString(hojeStr, diasInicio + (i - 1) * interv);
        const valorParcela = i === totalParcelas
          ? Number((valorBaseParcela + diferenca).toFixed(2))
          : valorBaseParcela;

        list.push({
          parcela: i,
          total_parcelas: totalParcelas,
          valor: valorParcela,
          vencimento,
          descricao: `Parcela ${i}/${totalParcelas} - ${descBase}`,
          multa: 0,
          juros_dia: 0,
          deposito_conta: false,
        });
      }
    }

    setInstallments(list);
    setValidationError(null);
  };

  const handleInstallmentChange = (
    index: number,
    field: keyof GeneratedInstallment,
    value: string | number | boolean | null
  ) => {
    setInstallments((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value } as GeneratedInstallment;
      return next;
    });
  };

  /** Parcela já ocupada por um boleto ATIVO — cancelado não ocupa. */
  type ParcelaOcupada = { parcela: number; status: string };

  /*
   * Espelha o índice `boletos_unico_parcela_ativo`, que é UNIQUE (id_int, parcela)
   * restrito a `upper(status) is distinct from 'CANCELADO'`.
   *
   * A normalização aqui tem de ser idêntica à do predicado do índice, inclusive
   * para status nulo (que conta como ativo dos dois lados). Divergir foi o que
   * gerou o bug anterior: a tela liberava o lançamento e o INSERT estourava no
   * Postgres com a mensagem crua da constraint.
   *
   * Boleto cancelado permanece como histórico e NÃO ocupa a parcela — a mesma
   * parcela pode ser refaturada.
   */
  const checkDuplicateBoletos = async (list: GeneratedInstallment[]): Promise<ParcelaOcupada | null> => {
    const client = getSupabaseClient();
    if (!client) return null;

    const { data: existing, error } = await client
      .from("boletos")
      .select("parcela, status")
      .eq("id_int", cobranca.id_int);

    if (error) {
      console.error("[PrepararBoletosModal] Erro ao consultar duplicidade:", error);
      throw new Error(`Erro ao verificar duplicidade no banco: ${error.message}`);
    }

    if (!existing || existing.length === 0) return null;

    for (const item of list) {
      const ocupada = existing.find(
        (eb) =>
          Number(eb.parcela) === Number(item.parcela) &&
          String(eb.status || "").toUpperCase() !== "CANCELADO"
      );
      if (ocupada) {
        return { parcela: Number(item.parcela), status: String(ocupada.status || "").toUpperCase() };
      }
    }

    return null;
  };

  const handleConfirmarFaturamento = async () => {
    setValidationError(null);
    if (installments.length === 0) {
      setValidationError(
        origemEhNfe
          ? "Esta nota não tem parcela fiscal ativa para lançar."
          : "Gere as parcelas antes de confirmar o lançamento."
      );
      return;
    }

    // 1. Validar soma das parcelas.
    // Vindo de NF a conferência é por TOTAIS da proposta — soma das parcelas
    // fiscais contra a soma das cobranças faturadas em aberto do mesmo id_int —
    // e não contra uma cobrança isolada: a venda pode ter sido dividida em
    // vários pagamentos. Mesma tolerância de 1 centavo dos dois lados.
    if (origemNfe) {
      if (divergenciaNfe !== null) {
        setValidationError(mensagemDivergenciaNfe);
        return;
      }
    } else {
      const soma = installments.reduce((acc, curr) => acc + (Number(curr.valor) || 0), 0);
      const totalCobranca = Number(cobranca.valor) || 0;
      if (Math.abs(soma - totalCobranca) > 0.01) {
        setValidationError(
          `A soma das parcelas (R$ ${soma.toFixed(2)}) deve ser exatamente igual ao total (R$ ${totalCobranca.toFixed(2)}).`
        );
        return;
      }
    }

    // 2. Validar parcelas com vencimento pendente, vencimento no passado ou valor <= 0
    const hojeStr = getTodayLocalDateString();
    for (const item of installments) {
      if (!item.vencimento) {
        setValidationError(`A parcela ${item.parcela}/${item.total_parcelas} não possui vencimento definido.`);
        return;
      }
      // Vencimento no passado só barra o fluxo manual. Vindo de NF a data é a da
      // duplicata já transmitida à SEFAZ: pode ter vencido enquanto a nota
      // esperava lançamento, e empurrar para hoje faria o título divergir do
      // documento fiscal.
      if (!origemEhNfe && item.vencimento < hojeStr) {
        setValidationError("O vencimento não pode ser anterior à data atual.");
        return;
      }
      if (Number(item.valor) <= 0) {
        setValidationError(`A parcela ${item.parcela}/${item.total_parcelas} deve ter valor superior a zero.`);
        return;
      }
      if (item.multa === null || item.multa === undefined || Number.isNaN(Number(item.multa))) {
        setValidationError(`A parcela ${item.parcela}/${item.total_parcelas} deve ter uma multa válida (não nula).`);
        return;
      }
      if (item.juros_dia === null || item.juros_dia === undefined || Number.isNaN(Number(item.juros_dia))) {
        setValidationError(`A parcela ${item.parcela}/${item.total_parcelas} deve ter juros válidos (não nulos).`);
        return;
      }
    }

    // A empresa recebedora decide o banco emissor e entra no faturamento.
    // Sem ela resolvida, o lançamento iria para o banco errado ou sem empresa.
    const empresaEscolhidaId = Number(empresaId) || Number(cobranca.id_empresa) || 0;
    const empresaEscolhidaNome =
      empresas.find((item) => item.id === empresaEscolhidaId)?.empresa ||
      (empresaEscolhidaId === Number(cobranca.id_empresa) ? String(cobranca.empresa ?? "") : "");

    if (!empresaEscolhidaId || !empresaEscolhidaNome) {
      setValidationError("Selecione a empresa recebedora antes de confirmar o lançamento.");
      return;
    }

    setIsSaving(true);
    try {
      // 3. Validar duplicidade
      const parcelaOcupada = await checkDuplicateBoletos(installments);
      if (parcelaOcupada) {
        setValidationError(
          `Duplicidade detectada! A parcela ${parcelaOcupada.parcela} desta origem já possui um boleto ativo no Contas a Receber (status ${parcelaOcupada.status}). Cancele o boleto atual antes de refaturar a parcela.`
        );
        setIsSaving(false);
        return;
      }

      const client = getSupabaseClient();
      if (!client) throw new Error("Sistema indisponivel no momento. Tente novamente.");

      // 4. Inserir boletos
      const payloadBoletos = installments.map((item) => {
        /*
         * A mesma referência vai em `ext_reference` e em `n_doc_boleto`.
         *
         * A Edge Function do link público (`boleto-publico?codigo=X`) procura o
         * boleto por `n_doc_boleto` — não por `ext_reference`. Gravar só a
         * referência fazia o link devolver 404 "Boleto não encontrado" em todo
         * faturado criado por esta tela, mesmo com nosso número, linha digitável
         * e código do banco corretos. Depois da migração do FlutterFlow para o
         * Vibe esta virou a única porta de criação do faturado, então passou a
         * valer para 100% deles, nas três empresas e nos dois bancos.
         *
         * O valor é determinístico, e `idx_boletos_n_doc_boleto_ativo` é único —
         * mas condicional, ignorando cancelados, para não travar o refaturamento
         * de uma parcela cancelada (migration 20260817).
         */
        const referencia = hasNfe
          ? extReference
          : `P${item.parcela}${item.total_parcelas}${cobranca.id_int}`;

        /*
         * `ext_reference` é a ref da nota, igual para todas as parcelas — é o
         * vínculo com o documento fiscal.
         *
         * `n_doc_boleto` NÃO pode repetir: `idx_boletos_n_doc_boleto_ativo` é
         * UNIQUE nessa coluna. Uma nota com duas parcelas mandaria o mesmo valor
         * duas vezes e a segunda linha estouraria a constraint no Postgres. Por
         * isso o caminho da NF sufixa com a parcela. O fluxo do Registro de
         * Recebíveis segue exatamente como estava.
         */
        const extReferenceFinal = origemNfe ? origemNfe.ref : referencia;
        const nDocBoleto = origemNfe ? `${origemNfe.ref}-P${item.parcela}` : referencia;

        return {
          id_int: cobranca.id_int,
          id_cliente: cobranca.id_cliente,
          id_empresa: empresaEscolhidaId,
          empresa: empresaEscolhidaNome,
          nome_cliente: cobranca.cliente,
          documento: cobranca.documento,
          // Vindo de NF, número e ref saem da nota escolhida, não do campo da
          // tela (que nem é editável neste modo).
          n_nf: origemNfe
            ? (origemNfe.numeroNf && origemNfe.numeroNf.trim() !== "" ? origemNfe.numeroNf.trim() : null)
            : numeroNf && numeroNf.trim() !== ""
            ? numeroNf.trim()
            : null,
          ext_reference: extReferenceFinal,
          n_doc_boleto: nDocBoleto,
          parcela: item.parcela,
          total_parcelas: item.total_parcelas,
          valor: Number(item.valor),
          vencimento: item.vencimento,
          descricao: item.descricao || "",
          multa: Number(item.multa ?? 0),
          juros_dia: Number(item.juros_dia ?? 0),
          deposito_conta: Boolean(item.deposito_conta),
          status: "A_VENCER",
          is_faturado: true,
          is_avulso: false,
          id_pagamento: cobranca.id_pagamento || null
        };
      });

      const supabase = client;

      console.log('[PrepararBoletosModal] Payload boletos:', JSON.stringify(payloadBoletos, null, 2));

      const { data, error } = await supabase
        .from('boletos')
        .insert(payloadBoletos)
        .select('id, id_int, parcela, total_parcelas, valor, vencimento, status, ext_reference');

      console.log('[PrepararBoletosModal] Insert boletos result:', { data, error });

      if (error) {
        console.error('[PrepararBoletosModal] Supabase insert error detalhado:', JSON.stringify(error, null, 2));
        console.error('[PrepararBoletosModal] Supabase insert error bruto:', error);
        throw new Error(error.message || 'Erro desconhecido ao inserir boletos');
      }

      // Sucesso na transação real do Supabase: fazer update do boleto_enviadoo em pagamentos_v2.
      //
      // Só no fluxo do Registro de Recebíveis, onde `cobranca` É a cobrança que
      // o operador escolheu. Vindo da NF a prop é um agregado do id_int montado
      // sobre a primeira cobrança faturada: marcar `boleto_enviadoo` nela
      // esconderia UMA das cobranças do Registro e deixaria as outras, dando a
      // impressão de que a proposta foi parcialmente lançada. Quem protege
      // contra lançamento repetido é `checkDuplicateBoletos` + o índice, que
      // valem para os dois caminhos.
      if (!origemEhNfe) {
      console.log('[PrepararBoletosModal] Iniciando UPDATE pagamentos_v2. Set boleto_enviadoo = true. ID:', cobranca.id, 'id_int:', cobranca.id_int);
      try {
        const { data: patchData, error: patchError } = await client
          .from("pagamentos_v2")
          .update({ boleto_enviadoo: true, id_empresa: empresaEscolhidaId, empresa: empresaEscolhidaNome })
          .eq("id", cobranca.id)
          .select();
        
        console.log('[PrepararBoletosModal] UPDATE pagamentos_v2 retorno:', { data: patchData, error: patchError });
        
        if (patchError) {
          console.error("[PrepararBoletosModal] ERRO ao atualizar pagamentos_v2.boleto_enviadoo:", JSON.stringify(patchError, null, 2));
          showToast({
            type: "warning",
            title: "Aviso de Sincronização",
            description: `Boletos gerados, mas falha ao marcar enviado no financeiro: ${patchError.message}`
          });
        } else {
          console.log("[PrepararBoletosModal] pagamentos_v2 atualizado com sucesso:", patchData);
        }
      } catch (patchErr) {
        console.error("[PrepararBoletosModal] Erro inesperado ao fazer UPDATE em pagamentos_v2:", patchErr);
        showToast({
          type: "warning",
          title: "Erro de Conexão",
          description: "Os boletos foram gerados, mas a rede falhou ao sincronizar o status no financeiro."
        });
      }

      // Independentemente do PATCH de boleto_enviadoo, marcamos como preparado localmente
      marcarComoBoletosPreparadosLocal(cobranca.id, Number(cobranca.id_int));
      }

      showToast({
        type: "success",
        title: "Sucesso!",
        description: "Contas a receber criado com sucesso. Redirecionando..."
      });

      onClose();
      // `ini`/`fim` como "todas" para o título recém-criado não ficar escondido
      // pelo período padrão (mês corrente) da tela de contas a receber.
      router.push(
        `/contas-a-receber?q=${cobranca.id_int}&ini=todas&fim=todas&autoRegister=1`
      );
    } catch (err) {
      const error = err as { message?: string; details?: string; hint?: string; code?: string };
      console.error('[PrepararBoletosModal] Erro ao salvar parcelas:', {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code,
        raw: error,
      });
      setValidationError(err instanceof Error ? err.message : "Erro desconhecido ao salvar parcelas.");
    } finally {
      setIsSaving(false);
    }
  };

  const hojeLocal = getTodayLocalDateString();
  const somaParcelas = installments.reduce((acc, item) => acc + (Number(item.valor) || 0), 0);
  /**
   * Total contra o qual a soma é conferida. Vindo de NF é o agregado das
   * cobranças faturadas em aberto do id_int; no fluxo manual é a cobrança que o
   * operador abriu.
   */
  const totalConferencia = origemNfe ? origemNfe.totalFaturadoEmAberto : Number(cobranca.valor) || 0;
  const somaConfere =
    installments.length > 0 && Math.abs(somaParcelas - totalConferencia) <= 0.01;
  const parcelasValidas =
    installments.length > 0 &&
    installments.every(
      (item) =>
        Boolean(item.vencimento) &&
        // Data no passado só invalida o fluxo manual: a duplicata da NF já foi
        // transmitida e pode ter vencido esperando o lançamento.
        (origemEhNfe || item.vencimento >= hojeLocal) &&
        Number(item.valor) > 0
    );
  const revisaoValida = somaConfere && parcelasValidas && divergenciaNfe === null;
  const nfAplicada = numeroNf && numeroNf.trim() !== "" ? numeroNf.trim() : null;
  const arredondamentoAtivo = arredondarParcelas && podeArredondar && installments.length > 1;
  const ultimaParcelaAjustada =
    arredondamentoAtivo &&
    Math.abs(installments[installments.length - 1].valor - installments[0].valor) > 0.001;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-4xl w-full overflow-hidden flex flex-col transform transition-all scale-100 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-5 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl shrink-0">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 leading-tight">
                {step === "FORM" ? "Preparar Cobrança" : "Lançamento Concluído"}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 font-mono">Origem: {extReference || "Carregando..."}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 rounded-xl transition text-slate-400 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Area */}
        <div className="px-6 py-6 overflow-y-auto max-h-[70vh] space-y-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500">
              <Loader2 className="h-8 w-8 animate-spin text-[#0b2f4a]" />
              <span className="text-sm font-medium">Carregando detalhes do faturamento...</span>
            </div>
          ) : step === "FORM" ? (
            <div className="space-y-6">
              {/* Informações Resumidas de Origem */}
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-slate-600">
                <div>
                  <span className="text-slate-400 block uppercase tracking-wider text-[9px] font-bold">Cliente</span>
                  <strong className="text-slate-800 text-sm block truncate font-medium">
                    {cobranca.cliente}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block uppercase tracking-wider text-[9px] font-bold">Documento</span>
                  <strong className="text-slate-800 text-sm block font-mono font-medium">
                    {cobranca.documento || "Não informado"}
                  </strong>
                </div>
                <div>
                  <label
                    htmlFor="empresa-recebedora"
                    className="text-slate-400 block uppercase tracking-wider text-[9px] font-bold"
                  >
                    Empresa recebedora
                  </label>
                  <select
                    id="empresa-recebedora"
                    value={empresaId ? String(empresaId) : ""}
                    onChange={(event) => setEmpresaEscolhida(Number(event.target.value))}
                    disabled={empresas.length === 0}
                    className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-800 outline-none focus:border-[#0b2f4a] disabled:bg-slate-100 disabled:text-slate-500"
                  >
                    {empresas.length === 0 ? <option value="">{cobranca.empresa}</option> : null}
                    {empresas.map((item) => (
                      <option key={item.id} value={String(item.id)}>
                        {item.empresa}
                      </option>
                    ))}
                  </select>
                  {empresaId !== Number(cobranca.id_empresa) ? (
                    <p className="mt-1 text-[10px] font-semibold text-amber-600 leading-tight">
                      Muda o banco emissor e o faturamento desta cobrança.
                    </p>
                  ) : null}
                </div>
                <div>
                  <span className="text-slate-400 block uppercase tracking-wider text-[9px] font-bold">Valor Total</span>
                  <strong className="text-slate-800 text-sm block font-mono font-bold text-slate-900">
                    {formatCurrency(cobranca.valor)}
                  </strong>
                </div>
              </div>

              {/* Divergência de totais na origem NF: bloqueia a confirmação e
                  diz exatamente quais são os dois números. */}
              {origemNfe && divergenciaNfe !== null && (
                <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-5">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
                    <div className="space-y-2 min-w-0">
                      <p className="text-sm font-bold text-red-800">Lançamento bloqueado: totais não fecham</p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        <div>
                          <span className="block text-red-500 uppercase tracking-wider text-[10px] font-bold">Parcelas fiscais da NF</span>
                          <strong className="block font-mono text-red-900 text-sm">{formatCurrency(somaParcelasFiscais)}</strong>
                        </div>
                        <div>
                          <span className="block text-red-500 uppercase tracking-wider text-[10px] font-bold">Faturado em aberto</span>
                          <strong className="block font-mono text-red-900 text-sm">{formatCurrency(origemNfe.totalFaturadoEmAberto)}</strong>
                        </div>
                        <div>
                          <span className="block text-red-500 uppercase tracking-wider text-[10px] font-bold">Diferença</span>
                          <strong className="block font-mono text-red-900 text-sm">{formatCurrency(Math.abs(divergenciaNfe))}</strong>
                        </div>
                      </div>
                      <p className="text-xs text-red-700 leading-relaxed">
                        Regularize a nota ou o financeiro antes de lançar. Os valores não são
                        ajustáveis por aqui — as parcelas vêm da NF-e já autorizada.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Formulário de Parcelamento — só existe fora da origem NF, onde
                  as parcelas vêm prontas do documento fiscal. */}
              {origemEhNfe ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-start gap-3">
                    <FileText className="h-5 w-5 shrink-0 text-slate-500 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800">
                        Parcelas definidas pela NF-e {origemNfe?.numeroNf ? `nº ${origemNfe.numeroNf}` : `(ref ${origemNfe?.ref})`}
                      </p>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                        O gerador automático está desabilitado: os vencimentos e valores abaixo são
                        os da duplicata já transmitida à SEFAZ. Recalcular aqui faria o título
                        divergir do documento fiscal. Para mudar as parcelas, use a aba Pagamentos
                        da nota — o que não é possível com a nota já autorizada.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">Condição de Pagamento</label>
                    <select
                      value={modeloSelecionadoId}
                      onChange={(e) => handleSelecionarModelo(e.target.value)}
                      disabled={parcelaUnica}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a] font-medium disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <option value="">Selecionar condição...</option>
                      {modelosCobranca.map((modelo) => (
                        <option key={String(modelo.id)} value={String(modelo.id)}>
                          {modelo.resultado}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Preenche parcelas, dias e intervalo abaixo (editáveis).
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">Número da NF (opcional)</label>
                    <input
                      type="text"
                      value={numeroNf ?? ""}
                      onChange={(e) => setNumeroNf(e.target.value)}
                      placeholder="Pode ser informada depois"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a] font-mono"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">
                      {hasNfe
                        ? "NF-e localizada automaticamente. Você pode ajustar."
                        : "Sem NF vinculada. O fiscal pode complementar depois."}
                    </p>
                  </div>
                </div>

                <div className="border-t border-slate-200 pt-4 space-y-4">
                  <h3 className="text-sm font-bold text-slate-800">Gerar Parcelas Automaticamente</h3>

                  {/* Parcela única com vencimento específico */}
                  <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="parcela-unica"
                        checked={parcelaUnica}
                        onChange={(e) => handleToggleParcelaUnica(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <label
                        htmlFor="parcela-unica"
                        className="text-xs font-semibold text-slate-700 cursor-pointer select-none"
                      >
                        Parcela única com vencimento específico
                        <span className="block text-[10px] font-normal text-slate-400">
                          Gera 1 parcela com o valor total da cobrança no vencimento escolhido.
                        </span>
                      </label>
                    </div>
                    {parcelaUnica && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">
                          Vencimento da parcela única
                        </label>
                        <input
                          type="date"
                          value={vencimentoUnico}
                          min={hojeLocal}
                          onChange={(e) => setVencimentoUnico(e.target.value)}
                          className="w-full md:w-48 rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a] font-mono"
                        />
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Qtd de parcelas futuras</label>
                      <input
                        type="number"
                        min="1"
                        value={qtdParcelas}
                        onChange={(e) => setQtdParcelas(Number(e.target.value))}
                        disabled={parcelaUnica}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a] font-mono disabled:bg-slate-100 disabled:text-slate-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Dias para 1ª parcela</label>
                      <input
                        type="number"
                        min="0"
                        value={diasPraInicio}
                        onChange={(e) => setDiasPraInicio(Number(e.target.value))}
                        disabled={parcelaUnica}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a] font-mono disabled:bg-slate-100 disabled:text-slate-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Intervalo entre parcelas (Dias)</label>
                      <input
                        type="number"
                        min="1"
                        value={intervalo}
                        onChange={(e) => setIntervalo(Number(e.target.value))}
                        disabled={parcelaUnica}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:border-[#0b2f4a] font-mono disabled:bg-slate-100 disabled:text-slate-400"
                      />
                    </div>
                    <div className="md:col-span-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      {podeArredondar ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="arredondar-parcelas"
                            checked={arredondarParcelas}
                            onChange={(e) => setArredondarParcelas(e.target.checked)}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <label
                            htmlFor="arredondar-parcelas"
                            className="text-xs font-semibold text-slate-700 cursor-pointer select-none"
                          >
                            Arredondar valores das parcelas
                            <span className="block text-[10px] font-normal text-slate-400">
                              Diferença ajustada na última parcela; o total da cobrança é preservado.
                            </span>
                          </label>
                        </div>
                      ) : (
                        <span />
                      )}
                      <button
                        type="button"
                        onClick={handleGerarParcelas}
                        disabled={parcelaUnica && !vencimentoUnico}
                        title={
                          parcelaUnica && !vencimentoUnico
                            ? "Selecione a data de vencimento da parcela única."
                            : undefined
                        }
                        className="rounded-xl bg-[#0b2f4a] hover:bg-[#061d2e] px-6 py-2.5 text-sm font-semibold text-white transition shadow-sm shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Gerar Parcelas
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              )}

              {/* Grade de Parcelas Editáveis */}
              {installments.length > 0 && (
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Calendar className="h-4 w-4 text-slate-500" />
                    Parcelas do Contas a Receber
                  </h4>
                  <div className="space-y-4">
                    {installments.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-5 border border-slate-100 rounded-3xl bg-white shadow-sm space-y-4 hover:border-slate-200 transition"
                      >
                        <div className="flex items-center justify-between border-b border-slate-50 pb-3">
                          <span className="font-bold text-slate-800 text-sm">
                            Parcela {item.parcela}/{item.total_parcelas}
                          </span>
                          {item.deposito_conta && (
                            <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 font-bold border border-emerald-200 rounded-lg text-[10px]">
                              Depósito em Conta
                            </span>
                          )}
                        </div>

                        {/* Inputs Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {/* Valor */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                              Valor
                            </label>
                            <div className="relative">
                              <span className="absolute left-3 top-2.5 text-xs text-slate-400 font-medium">R$</span>
                              <input
                                type="number"
                                step="0.01"
                                value={item.valor}
                                onChange={(e) => handleInstallmentChange(idx, "valor", Number(e.target.value))}
                                disabled={origemEhNfe}
                                title={origemEhNfe ? "Valor da parcela fiscal da NF-e. Não editável." : undefined}
                                className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:border-[#0b2f4a] outline-none font-mono disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                              />
                            </div>
                          </div>

                          {/* Vencimento */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                              Vencimento
                            </label>
                            <input
                              type="date"
                              value={item.vencimento}
                              min={origemEhNfe ? undefined : hojeLocal}
                              onChange={(e) => handleInstallmentChange(idx, "vencimento", e.target.value)}
                              disabled={origemEhNfe}
                              title={origemEhNfe ? "Vencimento da duplicata da NF-e. Não editável." : undefined}
                              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:border-[#0b2f4a] outline-none font-mono disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                            />
                          </div>

                          {/* Descrição */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                              Descrição
                            </label>
                            <input
                              type="text"
                              value={item.descricao}
                              onChange={(e) => handleInstallmentChange(idx, "descricao", e.target.value)}
                              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:border-[#0b2f4a] outline-none"
                            />
                          </div>

                          {/* Multa */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                              Multa (%)
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              value={item.multa}
                              onChange={(e) => handleInstallmentChange(idx, "multa", Number(e.target.value))}
                              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:border-[#0b2f4a] outline-none font-mono"
                            />
                          </div>

                          {/* Juros */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                              Juros/Dia (%)
                            </label>
                            <input
                              type="number"
                              step="0.0001"
                              value={item.juros_dia}
                              onChange={(e) => handleInstallmentChange(idx, "juros_dia", Number(e.target.value))}
                              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:border-[#0b2f4a] outline-none font-mono"
                            />
                          </div>

                        </div>

                        {/* Depósito em conta — bloco próprio, fora da grade de campos,
                            para ficar evidente qual parcela sai como depósito. */}
                        <label
                          className={`flex cursor-pointer select-none items-start gap-3 rounded-2xl border-2 p-4 transition ${
                            item.deposito_conta
                              ? "border-emerald-400 bg-emerald-50"
                              : "border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-slate-100"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={item.deposito_conta}
                            onChange={(e) => handleInstallmentChange(idx, "deposito_conta", e.target.checked)}
                            className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-2">
                              <span
                                className={`text-sm font-bold ${
                                  item.deposito_conta ? "text-emerald-800" : "text-slate-700"
                                }`}
                              >
                                Depósito em conta
                              </span>
                              {item.deposito_conta && (
                                <span className="rounded-lg bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                                  Selecionado
                                </span>
                              )}
                            </span>
                            <span
                              className={`mt-0.5 block text-xs ${
                                item.deposito_conta ? "text-emerald-700" : "text-slate-500"
                              }`}
                            >
                              {item.deposito_conta
                                ? "Esta parcela será lançada como depósito em conta, sem geração de boleto."
                                : "Deixe desmarcado para gerar boleto bancário desta parcela."}
                            </span>
                          </span>
                        </label>
                      </div>
                    ))}
                  </div>

                  {/* Revisão do Lançamento */}
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Revisão do lançamento
                      </h4>
                      {arredondamentoAtivo && (
                        <span className="px-2 py-0.5 bg-amber-50 text-amber-700 font-bold border border-amber-200 rounded-lg text-[10px]">
                          Valores arredondados
                        </span>
                      )}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                            <th className="px-4 py-2 font-bold">Parcela</th>
                            <th className="px-4 py-2 font-bold">Vencimento</th>
                            <th className="px-4 py-2 font-bold text-right">Valor</th>
                            <th className="px-4 py-2 font-bold">Tipo</th>
                            <th className="px-4 py-2 font-bold">NF aplicada</th>
                          </tr>
                        </thead>
                        <tbody>
                          {installments.map((item, idx) => {
                            const ehUltimaAjustada =
                              ultimaParcelaAjustada && idx === installments.length - 1;
                            return (
                              <tr key={idx} className="border-t border-slate-200 bg-white">
                                <td className="px-4 py-2 font-semibold text-slate-800">
                                  {item.parcela}/{item.total_parcelas}
                                </td>
                                <td className="px-4 py-2 font-mono text-slate-700">
                                  {item.vencimento ? (
                                    formatDateBrFromIso(item.vencimento)
                                  ) : (
                                    <span className="text-red-600 font-semibold">A definir</span>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-right font-mono font-semibold text-slate-800">
                                  {formatCurrency(Number(item.valor) || 0)}
                                  {ehUltimaAjustada && (
                                    <span className="ml-2 px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[9px] font-bold align-middle">
                                      Ajustada
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-2">
                                  {item.deposito_conta ? (
                                    <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 font-bold border border-emerald-200 rounded-lg text-[10px]">
                                      Depósito em conta
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 bg-sky-50 text-sky-700 font-bold border border-sky-200 rounded-lg text-[10px]">
                                      Boleto
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-2 font-mono text-slate-700">
                                  {nfAplicada ?? "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-slate-300 bg-slate-100">
                            <td className="px-4 py-2 font-bold text-slate-700" colSpan={2}>
                              Soma das parcelas
                            </td>
                            <td
                              className={`px-4 py-2 text-right font-mono font-bold ${somaConfere ? "text-emerald-700" : "text-red-600"}`}
                            >
                              {formatCurrency(somaParcelas)}
                            </td>
                            <td className="px-4 py-2 text-[10px] text-slate-500" colSpan={2}>
                              {somaConfere
                                ? `Confere com o total de ${formatCurrency(totalConferencia)}.`
                                : `Deve ser igual ao total de ${formatCurrency(totalConferencia)}.`}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Erro de Validação */}
              {validationError && (
                <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs flex items-start gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
                  <span className="font-semibold leading-relaxed">{validationError}</span>
                </div>
              )}
            </div>
          ) : (
            /* SUCCESS STEP (Internal success dialog replacing the inline success modal) */
            <div className="flex flex-col items-center justify-center py-6 text-center space-y-4">
              <div className="p-4 bg-emerald-50 text-emerald-600 rounded-full">
                <CheckCircle2 className="h-12 w-12" />
              </div>
              <div>
                <h4 className="text-lg font-bold text-slate-900">Lançamento Concluído</h4>
                <p className="text-sm text-slate-600 mt-2 max-w-md">
                  Contas a receber criado com sucesso. Deseja revisar e registrar os boletos no banco agora?
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end items-center gap-3">
          {step === "FORM" ? (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 disabled:opacity-50 transition rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmarFaturamento}
                disabled={isSaving || installments.length === 0 || !revisaoValida}
                title={
                  installments.length === 0
                    ? (origemEhNfe ? "Esta nota nao tem parcela fiscal ativa para lancar." : "Gere as parcelas antes de confirmar.")
                    : divergenciaNfe !== null
                      ? mensagemDivergenciaNfe
                      : !revisaoValida
                      ? "Revise as parcelas: soma igual ao total, valores válidos e vencimento a partir de hoje."
                      : undefined
                }
                className="px-5 py-2.5 text-xs font-bold text-white bg-[#0b2f4a] hover:bg-[#061d2e] disabled:opacity-50 rounded-xl shadow-sm transition flex items-center justify-center gap-1.5 min-w-[150px]"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  "Confirmar Lançamento"
                )}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition rounded-xl"
              >
                Agora não
              </button>
              <button
                type="button"
                onClick={() => {
                  onSuccess(hasNfe ? extReference : `P1${installments.length}${cobranca.id_int}`);
                }}
                className="px-5 py-2.5 text-xs font-bold text-white bg-[#0b2f4a] hover:bg-[#061d2e] rounded-xl shadow-sm transition flex items-center justify-center"
              >
                Revisar e registrar boletos
              </button>
            </>
          )}
        </div>

      </div>
    </div>
  );
}
