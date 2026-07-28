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

interface PrepararBoletosModalProps {
  isOpen: boolean;
  onClose: () => void;
  cobranca: Cobranca;
  onSuccess: (extReference: string) => void;
  defaultQtdParcelas?: number;
  defaultDiasPraInicio?: number;
  defaultIntervalo?: number;
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
  defaultIntervalo
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

  // Installment Config parameters
  const valorEntrada = 0;
  const [qtdParcelas, setQtdParcelas] = useState<number>(defaultQtdParcelas && defaultQtdParcelas >= 1 ? defaultQtdParcelas : 1);
  const [diasPraInicio, setDiasPraInicio] = useState<number>(defaultDiasPraInicio !== undefined && defaultDiasPraInicio >= 0 ? defaultDiasPraInicio : 30);
  const [intervalo, setIntervalo] = useState<number>(defaultIntervalo !== undefined && defaultIntervalo >= 0 ? defaultIntervalo : 30);

  // Generated installments list
  const [installments, setInstallments] = useState<GeneratedInstallment[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Load origin details (NF-e ref/number or fallback safely without fake NFE- prefix)
  useEffect(() => {
    async function loadOriginDetails() {
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
  }, [cobranca]);

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

  const checkDuplicateBoletos = async (list: GeneratedInstallment[]) => {
    const client = getSupabaseClient();
    if (!client) return false;

    const { data: existing, error } = await client
      .from("boletos")
      .select("parcela, total_parcelas, status, ext_reference")
      .eq("id_int", cobranca.id_int);

    if (error) {
      console.error("[PrepararBoletosModal] Erro ao consultar duplicidade:", error);
      throw new Error(`Erro ao verificar duplicidade no banco: ${error.message}`);
    }

    if (!existing || existing.length === 0) return false;

    for (const item of list) {
      const expectedExtRef = hasNfe
        ? extReference
        : `P${item.parcela}${item.total_parcelas}${cobranca.id_int}`;

      const isDuplicate = existing.some((eb) => {
        const statusStr = String(eb.status || "").toUpperCase();
        return (
          Number(eb.parcela) === item.parcela &&
          Number(eb.total_parcelas) === item.total_parcelas &&
          String(eb.ext_reference || "").trim() === expectedExtRef &&
          statusStr !== "CANCELADO"
        );
      });
      if (isDuplicate) {
        return true;
      }
    }

    return false;
  };

  const handleConfirmarFaturamento = async () => {
    setValidationError(null);
    if (installments.length === 0) {
      setValidationError("Gere as parcelas antes de confirmar o lançamento.");
      return;
    }

    // 1. Validar soma das parcelas
    const soma = installments.reduce((acc, curr) => acc + (Number(curr.valor) || 0), 0);
    const totalCobranca = Number(cobranca.valor) || 0;
    if (Math.abs(soma - totalCobranca) > 0.01) {
      setValidationError(
        `A soma das parcelas (R$ ${soma.toFixed(2)}) deve ser exatamente igual ao total (R$ ${totalCobranca.toFixed(2)}).`
      );
      return;
    }

    // 2. Validar parcelas com vencimento pendente, vencimento no passado ou valor <= 0
    const hojeStr = getTodayLocalDateString();
    for (const item of installments) {
      if (!item.vencimento) {
        setValidationError(`A parcela ${item.parcela}/${item.total_parcelas} não possui vencimento definido.`);
        return;
      }
      if (item.vencimento < hojeStr) {
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

    setIsSaving(true);
    try {
      // 3. Validar duplicidade
      const hasDuplicate = await checkDuplicateBoletos(installments);
      if (hasDuplicate) {
        setValidationError(
          `Duplicidade detectada! Já existem parcelas registradas para a referência "${extReference}" no Contas a Receber.`
        );
        setIsSaving(false);
        return;
      }

      const client = getSupabaseClient();
      if (!client) throw new Error("Supabase client not initialized");

      // 4. Inserir boletos
      const payloadBoletos = installments.map((item) => ({
        id_int: cobranca.id_int,
        id_cliente: cobranca.id_cliente,
        id_empresa: cobranca.id_empresa,
        empresa: cobranca.empresa,
        nome_cliente: cobranca.cliente,
        documento: cobranca.documento,
        n_nf: numeroNf && numeroNf.trim() !== "" ? numeroNf.trim() : null,
        ext_reference: hasNfe ? extReference : `P${item.parcela}${item.total_parcelas}${cobranca.id_int}`,
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
      }));

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

      // Sucesso na transação real do Supabase: fazer update do boleto_enviadoo em pagamentos_v2
      console.log('[PrepararBoletosModal] Iniciando UPDATE pagamentos_v2. Set boleto_enviadoo = true. ID:', cobranca.id, 'id_int:', cobranca.id_int);
      try {
        const { data: patchData, error: patchError } = await client
          .from("pagamentos_v2")
          .update({ boleto_enviadoo: true })
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
  const somaConfere =
    installments.length > 0 && Math.abs(somaParcelas - (Number(cobranca.valor) || 0)) <= 0.01;
  const parcelasValidas =
    installments.length > 0 &&
    installments.every(
      (item) => Boolean(item.vencimento) && item.vencimento >= hojeLocal && Number(item.valor) > 0
    );
  const revisaoValida = somaConfere && parcelasValidas;
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
                  <span className="text-slate-400 block uppercase tracking-wider text-[9px] font-bold">Empresa</span>
                  <strong className="text-slate-800 text-sm block truncate font-medium">
                    {cobranca.empresa}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block uppercase tracking-wider text-[9px] font-bold">Valor Total</span>
                  <strong className="text-slate-800 text-sm block font-mono font-bold text-slate-900">
                    {formatCurrency(cobranca.valor)}
                  </strong>
                </div>
              </div>

              {/* Formulário de Parcelamento */}
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
                                className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:border-[#0b2f4a] outline-none font-mono"
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
                              min={hojeLocal}
                              onChange={(e) => handleInstallmentChange(idx, "vencimento", e.target.value)}
                              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:border-[#0b2f4a] outline-none font-mono"
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
                                ? `Confere com o total de ${formatCurrency(Number(cobranca.valor) || 0)}.`
                                : `Deve ser igual ao total de ${formatCurrency(Number(cobranca.valor) || 0)}.`}
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
                    ? "Gere as parcelas antes de confirmar."
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
