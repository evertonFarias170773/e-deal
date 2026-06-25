"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Cobranca, CriarCobrancaFormValues, CreditAnalysisResult } from "@/features/cobrancas/types";
import type { Proposta } from "@/features/orcamentos/types";
import { clonePagamentosMock, createCobrancaFromForm, getEmpresaRecebedoraByProposta } from "@/lib/mocks/pagamentos.mock";
import { canLiberarParaPedido, roundMoney, getTipoCobrancaLabel } from "@/features/cobrancas/cobrancas-utils";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  getCobrancasReadOnlyData,
  updatePagamentoV2StatusConfirmacao,
  type CobrancasReadResult,
  type CobrancasReadSource
} from "@/features/cobrancas/services/pagamentos-v2.service";
import { registrarMensagemSistemaProposta } from "@/features/orcamentos/services/orcamentos.service";

type CobrancasContextValue = {
  cobrancas: Cobranca[];
  cobrancasStats: Cobranca[];
  source: CobrancasReadSource;
  createCobranca: (values: CriarCobrancaFormValues, proposta?: Proposta) => Promise<Cobranca>;
  confirmPagamento: (id: string) => void;
  cancelCobranca: (id: string, motivo: string) => Promise<{ success: boolean; errorMessage?: string }>;
  deleteCobranca: (id: string) => Promise<{ success: boolean; errorMessage?: string }>;
  cancelarExterno: (cobranca: Cobranca, acaoLocal: "DELETE" | "CANCEL", motivo?: string) => Promise<{ success: boolean; errorMessage?: string }>;
  
  liberarParaPedido: (idInt: number) => boolean;
  refreshCobrancas: () => Promise<CobrancasReadResult>;
  getCobrancaById: (id: string) => Cobranca | undefined;
  getCobrancaByToken: (token: string) => Cobranca | undefined;
  getCobrancasByProposta: (idInt: number) => Cobranca[];
  liberarCobrancaReal: (id: string, confirmadoPor: string, status?: string, confirmado?: boolean, acao?: string) => Promise<boolean>;
  voltarCobrancaFilaReal: (id: string) => Promise<boolean>;
  emitirBoletoReal: (id: string) => Promise<{ success: boolean; errorMessage?: string }>;
  existingBoletoIdInts: Set<number>;
  hasBoletoHistoryIdInts: Set<number>;
  marcarComoBoletosPreparadosLocal: (id: string, idInt: number) => void;
  recalcularBoletoIdIntsLocal: (idInt: number) => Promise<void>;
};

const STORAGE_KEY = "erp_ideal_mock_cobrancas_v6";
const CobrancasContext = createContext<CobrancasContextValue | null>(null);

function createInitialState() {
  return clonePagamentosMock();
}

function readStoredCobrancas() {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as Cobranca[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function CobrancasProvider({ children }: { children: ReactNode }) {
  const [cobrancas, setCobrancas] = useState<Cobranca[]>(createInitialState);
  const [cobrancasStats, setCobrancasStats] = useState<Cobranca[]>(createInitialState);
  const [source, setSource] = useState<CobrancasReadSource>("mock");
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);
  const [existingBoletoIdInts, setExistingBoletoIdInts] = useState<Set<number>>(new Set());
  const [hasBoletoHistoryIdInts, setHasBoletoHistoryIdInts] = useState<Set<number>>(new Set());
  const isMountedRef = useRef(true);

  const loadData = useCallback(async (): Promise<CobrancasReadResult> => {
    const stored = readStoredCobrancas();
    const result = await getCobrancasReadOnlyData();

    if (!isMountedRef.current) {
      return result;
    }

    if (result.warnings.length > 0) {
      console.info("[Cobrancas][Supabase]", result.warnings);
    }

    if (result.source === "supabase") {
      setCobrancas(result.cobrancas);
      setCobrancasStats(result.cobrancasStats);
      setSource("supabase");
    } else if (stored) {
      setCobrancas(stored);
      setCobrancasStats(result.cobrancasStats);
      setSource("mock");
    } else {
      setCobrancas(result.cobrancas.length > 0 ? result.cobrancas : createInitialState());
      setCobrancasStats(result.cobrancasStats.length > 0 ? result.cobrancasStats : createInitialState());
      setSource(result.source);
    }

    // Buscar todos os id_int da tabela public.boletos no banco de dados
    // independentemente do source dos dados (seja mock ou supabase, a verificação de duplicidade de boleto é sempre real)
    // Definimos limit(30000) e selecionamos apenas id_int,status para otimizar desempenho e evitar problemas de paginação do Supabase
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data: boletosData, error } = await client
          .from("boletos")
          .select("id_int, status")
          .limit(30000);
        if (error) {
          console.error("[CobrancasProvider] Erro ao buscar id_int de boletos:", error);
        } else if (boletosData) {
          const ids = new Set<number>();
          const historyIds = new Set<number>();
          boletosData.forEach((b) => {
            if (b.id_int !== null && b.id_int !== undefined) {
              const idIntNum = Number(b.id_int);
              historyIds.add(idIntNum); // Adiciona todos ao histórico, inclusive CANCELADO
              const statusStr = String(b.status || "").trim().toUpperCase();
              if (statusStr !== "CANCELADO") {
                ids.add(idIntNum); // Adiciona apenas ativos ao existingBoletoIdInts
              }
            }
          });
          setExistingBoletoIdInts(ids);
          setHasBoletoHistoryIdInts(historyIds);
        }
      } catch (err) {
        console.error("[CobrancasProvider] Erro inesperado ao buscar boletos:", err);
      }
    } else {
      setExistingBoletoIdInts(new Set());
      setHasBoletoHistoryIdInts(new Set());
    }

    setHasLoadedStorage(true);
    return result;
  }, []);

  const marcarComoBoletosPreparadosLocal = useCallback((id: string, idInt: number) => {
    setCobrancas((prev) =>
      prev.map((c) => (c.id === id ? { ...c, boleto_enviadoo: true } : c))
    );
    setCobrancasStats((prev) =>
      prev.map((c) => (c.id === id ? { ...c, boleto_enviadoo: true } : c))
    );
    setExistingBoletoIdInts((prev) => {
      const next = new Set(prev);
      next.add(idInt);
      return next;
    });
    setHasBoletoHistoryIdInts((prev) => {
      const next = new Set(prev);
      next.add(idInt);
      return next;
    });
  }, []);

  const recalcularBoletoIdIntsLocal = useCallback(async (idInt: number) => {
    const client = getSupabaseClient();
    if (!client) return;

    try {
      console.log('[CobrancasProvider] Recalculando boletos para id_int:', idInt);
      const { data: boletosData, error } = await client
        .from("boletos")
        .select("status")
        .eq("id_int", idInt);

      if (error) {
        console.error("[CobrancasProvider] Erro ao recalcular boletos do id_int:", idInt, error);
        return;
      }

      if (boletosData) {
        const temHistorico = boletosData.length > 0;
        
        // Verificar se existe qualquer boleto ativo (ou seja, status !== 'CANCELADO')
        const temBoletoAtivo = boletosData.some((b) => {
          const statusStr = String(b.status || "").trim().toUpperCase();
          return statusStr !== "CANCELADO";
        });

        console.log('[CobrancasProvider] Resultado recalculado para id_int:', idInt, 'temBoletoAtivo:', temBoletoAtivo, 'temHistorico:', temHistorico);

        setExistingBoletoIdInts((prev) => {
          const next = new Set(prev);
          if (temBoletoAtivo) {
            next.add(idInt);
          } else {
            next.delete(idInt);
            console.log('[CobrancasProvider] Removido id_int de existingBoletoIdInts local:', idInt);
          }
          return next;
        });

        setHasBoletoHistoryIdInts((prev) => {
          const next = new Set(prev);
          if (temHistorico) {
            next.add(idInt);
          } else {
            next.delete(idInt);
            console.log('[CobrancasProvider] Removido id_int de hasBoletoHistoryIdInts local:', idInt);
          }
          return next;
        });
      }
    } catch (err) {
      console.error("[CobrancasProvider] Erro inesperado ao recalcular boletos:", err);
    }
  }, []);

  const refreshCobrancas = useCallback(async () => {
    return loadData();
  }, [loadData]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedStorage || source === "supabase") {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cobrancas));
  }, [cobrancas, hasLoadedStorage, source]);

  const createCobranca = useCallback(async (values: CriarCobrancaFormValues, proposta?: Proposta): Promise<Cobranca> => {
    if (proposta) {
      if (proposta.clienteNaoCadastrado || proposta.cliente.idCliente === null || proposta.cliente.idCliente === undefined || Number(proposta.cliente.idCliente) === 0) {
        throw new Error("Cadastre ou vincule um cliente antes de gerar cobrança.");
      }
      const cobrancasDaProposta = cobrancas.filter((item) => item.id_int === proposta.id_int && item.status !== "CANCELADO");
      const totalPropostaRounded = roundMoney(proposta.resumo.valorTotal);
      const totalCobradoReal = cobrancasDaProposta.reduce((total, item) => total + (item.cartao_valor_final ?? item.valor), 0);
      const totalCobradoRealRounded = roundMoney(totalCobradoReal);
      const saldoRestante = Math.max(totalPropostaRounded - totalCobradoRealRounded, 0);

      if (saldoRestante <= 0) {
        throw new Error(`Não é possível gerar cobrança: a proposta #${proposta.id_int} já está totalmente cobrada (saldo R$ 0,00).`);
      }
    }

    if (source === "supabase") {
      if (!proposta) {
        throw new Error("Dados da proposta sao obrigatorios para criar cobranca no Supabase.");
      }

      if (values.tipoCobranca === "BOLETO") {
        const emailCliente = proposta.contato?.email?.trim() || proposta.cliente?.email?.trim() || "";
        if (!emailCliente) {
          throw new Error("Cliente sem e-mail cadastrado para geração do boleto.");
        }
      }

      const client = getSupabaseClient();
      if (!client) {
        throw new Error("Cliente do Supabase nao inicializado.");
      }

      const empresaOption = getEmpresaRecebedoraByProposta(proposta);
      const idEmpresa = values.id_empresa ?? (empresaOption?.id ?? 1);
      const nomeEmpresa = values.empresa ?? (empresaOption?.nome ?? proposta.empresa);

       const isFaturadoType = ["E-FATURADO", "E-RETRABALHO", "E-PERMUTA", "E-AMOSTRA"].includes(values.tipoCobranca);

       if (isFaturadoType) {
         if (!values.forma_fatu) {
           throw new Error("Condição de pagamento (forma_fatu) inválida ou não selecionada.");
         }
         if (values.p_qtd_parcelas == null || values.p_dias_pra_inicio == null || values.p_intervalo == null) {
           throw new Error("Dados de parcelamento inválidos ou não selecionados.");
         }
       }

       // 1. Criar registro inicial em pagamentos_v2
       // Usa dados do pagador efetivo (id_faturado) quando disponíveis; fallback para cliente principal (propostas antigas)
       const payloadInicial = {
         id_int: proposta.id_int,
         id_cliente: values.pagadorIdCliente ?? proposta.cliente.idCliente,
         cliente: values.pagadorNome ?? proposta.cliente.nome,
         documento: values.pagadorDocumento ?? proposta.cliente.documento,
         valor: roundMoney(values.valor),
         status: isFaturadoType ? "A_VENCER" : "A_RECEBER",
         tipo_cobranca: values.tipoCobranca,
         empresa: nomeEmpresa,
         id_empresa: idEmpresa,
         os_ideal: values.osIdeal.trim(),
         atendente: proposta.vendedor || proposta.cliente.vendedor || "Sistema",
         descricao: values.descricao || `Cobrança ${values.tipoCobranca} da proposta #${proposta.id_int}`,
         vencimento: values.vencimento || null,
         obs_v2: values.observacao || null,
         confirmado: false,
         forma_fatu: isFaturadoType ? (values.forma_fatu || null) : null,
         p_valor_entrada: isFaturadoType ? (values.p_valor_entrada ?? null) : null,
         p_qtd_parcelas: isFaturadoType ? (values.p_qtd_parcelas ?? null) : null,
         p_dias_pra_inicio: isFaturadoType ? (values.p_dias_pra_inicio ?? null) : null,
         p_intervalo: isFaturadoType ? (values.p_intervalo ?? null) : null,
         paid_at: null
       };

      console.log("[DEBUG CobrancasProvider] isFaturadoType: ", isFaturadoType);
      console.log("[DEBUG CobrancasProvider] payloadInicial: ", payloadInicial);

      const { data: createdRows, error: insertError } = await client
        .from("pagamentos_v2")
        .insert([payloadInicial])
        .select()
        .returns<Array<{ id: string; id_pagamento?: string }>>();

      if (insertError || !createdRows || !createdRows.length) {
        throw new Error(insertError?.message || "Erro ao criar cobranca inicial no Supabase.");
      }

      const createdRow = createdRows[0];
      const cobrancaId = createdRow.id;

      // 2. Gerar token_publico e url_cobranca a partir do primeiro bloco do UUID
      const tokenPublico = cobrancaId.split("-")[0];
      const urlCobranca = `https://pay.ai-ideal.com.br/i/${tokenPublico}`;

      // 3. Atualizar o registro com token_publico e url_cobranca
      const { error: updateTokenError } = await client
        .from("pagamentos_v2")
        .update({
          token_publico: tokenPublico,
          url_cobranca: urlCobranca
        })
        .eq("id", cobrancaId);

      if (updateTokenError) {
        throw new Error(updateTokenError.message || "Erro ao atualizar token publico no Supabase.");
      }

      let response: Response;

      if (values.tipoCobranca === "BOLETO") {
        // 4. Chamar o webhook BOLETO pela camada server-side
        const cobrancasDaProposta = cobrancas.filter((item) => item.id_int === proposta.id_int && item.tipo_cobranca === "BOLETO");
        const boletoSeq = cobrancasDaProposta.length + 1;
        const extReference = `AV${boletoSeq}${proposta.id_int}`;
        
        let due_date = values.vencimento;
        if (!due_date) {
          const date = new Date();
          date.setDate(date.getDate() + 3);
          due_date = date.toISOString().split("T")[0];
        }

        const webhookPayload = {
          external_reference_id: String(proposta.id_int),
          valor_total: roundMoney(values.valor),
          name: proposta.cliente.nome,
          id_pagamento: createdRow.id_pagamento || String(proposta.id_int),
          documento: proposta.cliente.documento,
          email: proposta.contato?.email?.trim() || proposta.cliente?.email?.trim() || "",
          logradouro: proposta.enderecoEntrega?.endereco || "",
          numero: proposta.enderecoEntrega?.numero || "S/N",
          complemento: proposta.enderecoEntrega?.complemento || "",
          cidade: proposta.enderecoEntrega?.cidade || "",
          UF: proposta.enderecoEntrega?.uf || "",
          zip_code: proposta.enderecoEntrega?.cep || "",
          qtd_parcelas: 1,
          intervalo: 0,
          inicia_em: 0,
          multa: 0,
          juros: 0,
          descricao: "O Pedido entrará em produção após a confirmação do pagamento.",
          id_cliente: proposta.cliente.idCliente,
          nf: "",
          status: "A_RECEBER",
          "e-faturado": false,
          contato: proposta.contato?.whatsapp || proposta.cliente.whatsapp || "",
          whats: proposta.contato?.whatsapp || proposta.cliente.whatsapp || "",
          enviar_whats: false,
          avulso: false,
          empresa: String(idEmpresa),
          is_prorrogado: false
        };

        response = await fetch("/api/cobrancas/gerar-boleto", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(webhookPayload)
        });
      } else if (values.tipoCobranca === "PIX") {
        // 4. Chamar o webhook PIX da empresa correspondente pela camada server-side
        const webhookPayload = {
          cobrancaId: cobrancaId,
          idEmpresa: idEmpresa,
          seuNumero: idEmpresa === 2 ? ((createdRow as { id_pagamento?: string }).id_pagamento || String(proposta.id_int)) : String(proposta.id_int),
          valorNominal: roundMoney(values.valor),
          dataVencimento: values.vencimento || new Date().toISOString().split("T")[0],
          telefone: proposta.contato?.whatsapp || proposta.cliente.whatsapp || "",
          cpfCnpj: proposta.cliente.documento,
          nome: proposta.cliente.nome,
          endereco: proposta.enderecoEntrega?.endereco || "",
          cidade: proposta.enderecoEntrega?.cidade || "",
          uf: proposta.enderecoEntrega?.uf || "",
          cep: proposta.enderecoEntrega?.cep || ""
        };

        response = await fetch("/api/cobrancas/gerar-pix", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(webhookPayload)
        });
      } else {
        // Para CARTAO (CARD_PARCELADO) ou FATURADO (E-FATURADO):
        // O checkout/faturamento é gerado no backend. Não disparamos webhook externo no front.
        // Apenas recarregamos os dados e retornamos a linha correspondente.
        const loadResult = await loadData();
        const found = loadResult.cobrancas.find((item) => item.id === cobrancaId) ||
                      loadResult.cobrancasStats.find((item) => item.id === cobrancaId);

        const isFaturadoType = ["E-FATURADO", "E-RETRABALHO", "E-PERMUTA", "E-AMOSTRA"].includes(values.tipoCobranca);
        let msg = "";
        if (isFaturadoType) {
          const label = getTipoCobrancaLabel(values.tipoCobranca);
          msg = `${label} enviado para análise financeira. Observações: ${values.observacao || "Nenhuma"}`;
        } else {
          msg = `Registrada nova cobrança CARTÃO, valor: R$ ${values.valor.toFixed(2).replace(".", ",")}.`;
        }

        void registrarMensagemSistemaProposta({
          idInt: proposta.id_int,
          idCliente: proposta.cliente.idCliente,
          mensagem: msg,
          setor: "Financeiro"
        }).catch((chatErr) => {
          console.warn("Falha ao registrar historico no chat:", chatErr);
        });

        if (found) {
          return found;
        }

        return {
          id: cobrancaId,
          id_pagamento: `${proposta.id_int}-${tokenPublico}`,
          os_ideal: "",
          id_int: proposta.id_int,
          id_cliente: proposta.cliente.idCliente,
          valor: values.valor,
          status: isFaturadoType ? "A_VENCER" : "A_RECEBER",
          tipo_cobranca: values.tipoCobranca,
          created_at: new Date().toISOString(),
          paid_at: undefined,
          vencimento: values.vencimento || undefined,
          cliente: proposta.cliente.nome,
          empresa: proposta.empresa,
          descricao: `Cobrança ${values.tipoCobranca} registrada.`,
          documento: proposta.cliente.documento || "",
          atendente: proposta.vendedor || "",
          confirmado: false,
          id_empresa: idEmpresa,
          token_publico: tokenPublico,
          url_cobranca: urlCobranca,
          forma_fatu: isFaturadoType ? (values.modeloFatu || "BOLETO") : undefined,
          proposta: {
            id_int: proposta.id_int,
            statusProposta: proposta.status,
            cliente: proposta.cliente.nome,
            documento: proposta.cliente.documento || "",
            valorTotal: proposta.resumo.valorTotal,
            valorPendente: proposta.resumo.valorTotal - values.valor,
            empresaProposta: proposta.empresa,
            vendedor: proposta.vendedor || "",
            descricao: `Cobrança ${values.tipoCobranca} registrada para proposta #${proposta.id_int}`,
            valorFrete: proposta.resumo.frete
          },
          historico: [],
          propostasChat: []
        };
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Erro ao gerar ${values.tipoCobranca}: ${errorText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || `Falha no retorno da API de ${values.tipoCobranca}.`);
      }

      // 5. Enviar mensagem no chat da proposta para BOLETO ou PIX usando a nova função padronizada
      const msg = values.tipoCobranca === "BOLETO"
        ? `Registrada nova cobrança BOLETO, valor: R$ ${values.valor.toFixed(2).replace(".", ",")}.`
        : `Registrada nova cobrança PIX, valor: R$ ${values.valor.toFixed(2).replace(".", ",")}.`;

      void registrarMensagemSistemaProposta({
        idInt: proposta.id_int,
        idCliente: proposta.cliente.idCliente,
        mensagem: msg,
        setor: "Financeiro"
      }).catch((chatErr) => {
        console.warn("Falha ao registrar historico no chat:", chatErr);
      });

      const loadResult = await loadData();
      const found = loadResult.cobrancas.find((item) => item.id === cobrancaId) ||
                    loadResult.cobrancasStats.find((item) => item.id === cobrancaId);

      return result.data || found || {
        id: cobrancaId,
        id_pagamento: `${proposta.id_int}-${tokenPublico}`,
        os_ideal: "",
        id_int: proposta.id_int,
        id_cliente: proposta.cliente.idCliente,
        valor: values.valor,
        status: "A_RECEBER",
        tipo_cobranca: values.tipoCobranca,
        created_at: new Date().toISOString(),
        cliente: proposta.cliente.nome,
        empresa: proposta.empresa,
        descricao: `Cobrança ${values.tipoCobranca} registrada.`,
        documento: proposta.cliente.documento || "",
        atendente: proposta.vendedor || "",
        confirmado: false,
        id_empresa: idEmpresa,
        token_publico: tokenPublico,
        url_cobranca: urlCobranca,
        proposta: {
          id_int: proposta.id_int,
          statusProposta: proposta.status,
          cliente: proposta.cliente.nome,
          documento: proposta.cliente.documento || "",
          valorTotal: proposta.resumo.valorTotal,
          valorPendente: proposta.resumo.valorTotal - values.valor,
          empresaProposta: proposta.empresa,
          vendedor: proposta.vendedor || "",
          descricao: `Cobrança ${values.tipoCobranca} registrada para proposta #${proposta.id_int}`,
          valorFrete: proposta.resumo.frete
        },
        historico: [],
        propostasChat: []
      };
    }

    if (!proposta) {
      throw new Error("Dados da proposta são obrigatórios para criar cobrança.");
    }

    const next = createCobrancaFromForm(values, proposta, cobrancas);
    setCobrancas((current) => [next, ...current]);
    setCobrancasStats((current) => [next, ...current]);
    return next;
  }, [source, loadData, cobrancas]);


  const checkAndRevertPropostaStatus = useCallback(async (idInt: number) => {
    if (source !== "supabase") return;
    const client = getSupabaseClient();
    if (!client) return;

    try {
      const { count, error } = await client
        .from("pagamentos_v2")
        .select("*", { count: "exact", head: true })
        .eq("id_int", idInt)
        .neq("status", "CANCELADO");

      if (error) {
        console.error("[CobrancasProvider] Erro ao contar cobrancas:", error);
        return;
      }

      if (count === 0) {
        const { error: updateError } = await client
          .from("propostas")
          .update({ status_interno: "NOVO" })
          .eq("id_int", idInt)
          .neq("status_interno", "APROVADO");

        if (updateError) {
          console.error("[CobrancasProvider] Erro ao reverter status da proposta:", updateError);
        } else {
          console.log(`[CobrancasProvider] Proposta ${idInt} revertida para NOVO com sucesso.`);
        }
      }
    } catch (err) {
      console.error("[CobrancasProvider] Falha em checkAndRevertPropostaStatus:", err);
    }
  }, [source]);

  const confirmPagamento = useCallback((id: string) => {
    // Buscar cobrança para registrar na timeline antes de retornar caso Supabase
    const cobranca = cobrancas.find((c) => c.id === id) || cobrancasStats.find((c) => c.id === id);
    if (cobranca && cobranca.id_int) {
      const isEFaturado = cobranca.tipo_cobranca === "E-FATURADO";
      const msgText = isEFaturado
        ? "Faturamento aprovado pelo financeiro. Crédito liberado."
        : "Pagamento confirmado pelo financeiro.";

      void registrarMensagemSistemaProposta({
        idInt: cobranca.id_int,
        idCliente: cobranca.id_cliente,
        mensagem: msgText,
        setor: "Financeiro"
      }).catch((chatErr) => {
        console.warn("Falha ao registrar historico de confirmacao no chat:", chatErr);
      });
    }

    if (source === "supabase") {
      return;
    }

    const updateCob = (list: Cobranca[]): Cobranca[] =>
      list.map((cobranca) => {
        if (cobranca.id !== id) {
          return cobranca;
        }

        const paidAt = new Date().toISOString();
        const isEFaturado = cobranca.tipo_cobranca === "E-FATURADO";

        return {
          ...cobranca,
          status: isEFaturado ? "A_VENCER" : "PAID",
          paid_at: cobranca.paid_at || paidAt,
          confirmado: true,
          confirmado_por: "Financeiro mockado",
          data_confirmacao: paidAt,
          creditoPendente: false,
          creditoAnalise: cobranca.creditoAnalise
            ? {
                ...cobranca.creditoAnalise,
                statusAnalise: "APROVADO",
                mensagem: "Crédito aprovado pelo financeiro."
              }
            : undefined,
          historico: [
            {
              id: `hist_confirm_${paidAt}`,
              data: paidAt,
              titulo: isEFaturado ? "Crédito aprovado no mock" : "Pagamento confirmado no mock",
              descricao: isEFaturado
                ? "Faturamento aprovado pelo setor financeiro."
                : "Status alterado para pago via ação manual.",
              tipo: "success"
            },
            ...cobranca.historico
          ]
        } as Cobranca;
      });

    setCobrancas(updateCob);
    setCobrancasStats(updateCob);
  }, [source, cobrancas, cobrancasStats]);

  const cancelCobranca = useCallback(async (id: string, motivo: string): Promise<{ success: boolean; errorMessage?: string }> => {
    const cob = cobrancasStats.find((item) => item.id === id) || cobrancas.find((item) => item.id === id);
    if (!cob) {
      return { success: false, errorMessage: "Cobrança não encontrada." };
    }

    if (source === "supabase") {
      const client = getSupabaseClient();
      if (!client) {
        return { success: false, errorMessage: "Cliente Supabase não inicializado." };
      }

      const tipoNormalized = cob.tipo_cobranca?.trim().toUpperCase().replace(/_/g, "-");
      const isExternoCancelable = (tipoNormalized === "BOLETO" || tipoNormalized === "CARD-PARCELADO") && !!cob.cod_solicitacao_inter;

      if (isExternoCancelable) {
        const extResult = await cancelarExterno(cob, "CANCEL", motivo);
        if (!extResult.success) {
          return extResult;
        }
      } else {
        const { error: updateError } = await client
          .from("pagamentos_v2")
          .update({ status: "CANCELADO", motivo_cancela: motivo })
          .eq("id", id);

        if (updateError) {
          console.error("[cancelCobranca] Erro ao cancelar cobrança no Supabase:", updateError);
          return { success: false, errorMessage: updateError.message || "Erro ao cancelar cobrança no banco." };
        }
      }

      const msg = `Cobrança cancelada. Motivo: ${motivo}`;
      try {
        await registrarMensagemSistemaProposta({
          idInt: cob.id_int,
          idCliente: cob.id_cliente,
          mensagem: msg,
          setor: "Financeiro"
        });
      } catch (chatErr) {
        console.warn("[cancelCobranca] Falha ao registrar histórico no chat:", chatErr);
      }

      await refreshCobrancas();
      if (cob.id_int) await checkAndRevertPropostaStatus(cob.id_int);
      return { success: true };
    }

    const updateCob = (list: Cobranca[]): Cobranca[] =>
      list.map((cobranca) => {
        if (cobranca.id !== id) {
          return cobranca;
        }

        const cancelledAt = new Date().toISOString();

        return {
          ...cobranca,
          status: "CANCELADO",
          motivo_cancela: motivo,
          historico: [
            {
              id: `hist_cancel_${cancelledAt}`,
              data: cancelledAt,
              titulo: "Cobrança cancelada no mock",
              descricao: motivo,
              tipo: "danger"
            },
            ...cobranca.historico
          ]
        } as Cobranca;
      });

    setCobrancas(updateCob);
    setCobrancasStats(updateCob);
    return { success: true };
  }, [source, cobrancas, cobrancasStats, refreshCobrancas]);

  const cancelarExterno = useCallback(async (cobranca: Cobranca, acaoLocal: "DELETE" | "CANCEL", motivo?: string): Promise<{ success: boolean; errorMessage?: string }> => {
    try {
      const response = await fetch("/api/cobrancas/cancelar-externo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: cobranca.id,
          tipo_cobranca: cobranca.tipo_cobranca,
          acao_local: acaoLocal,
          cod_c6: cobranca.cod_solicitacao_inter,
          id_empresa: cobranca.id_empresa,
          motivo: motivo
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        return { success: false, errorMessage: data.message || "Erro desconhecido ao cancelar externamente." };
      }

      await refreshCobrancas();
      if (cobranca.id_int) await checkAndRevertPropostaStatus(cobranca.id_int);
      return { success: true };
    } catch (error: any) {
      return { success: false, errorMessage: error.message || "Falha na comunicação com a API." };
    }
  }, [refreshCobrancas]);

  const deleteCobranca = useCallback(async (id: string): Promise<{ success: boolean; errorMessage?: string }> => {
    const cobranca = cobrancasStats.find((item) => item.id === id) || cobrancas.find((item) => item.id === id);
    if (!cobranca) {
      return { success: false, errorMessage: "Cobrança não encontrada." };
    }

    const statusNormalized = cobranca.status?.trim().toUpperCase();
    if (statusNormalized === "PAID" || statusNormalized === "A_VENCER") {
      return { success: false, errorMessage: "Não é permitido excluir cobrança paga ou com faturamento aprovado (A_VENCER)." };
    }

    if (source === "supabase") {
      const client = getSupabaseClient();
      if (!client) {
        return { success: false, errorMessage: "Cliente Supabase não inicializado." };
      }

      // Revalidar status atual no Supabase para impedir exclusão de PAID em tempo real
      const { data: dbRow, error: fetchError } = await client
        .from("pagamentos_v2")
        .select("status")
        .eq("id", id)
        .maybeSingle();

      if (fetchError || !dbRow) {
        console.error("[deleteCobranca] Erro ao buscar status atual da cobrança:", fetchError);
        return {
          success: false,
          errorMessage: fetchError?.message || "Não foi possível verificar o status atual da cobrança no banco."
        };
      }

      const dbStatusNorm = String(dbRow.status || "").trim().toUpperCase();
      if (dbStatusNorm === "PAID" || dbStatusNorm === "A_VENCER") {
        return { success: false, errorMessage: "Não é permitido excluir cobrança paga ou aprovada (A_VENCER)." };
      }

      const { error } = await client
        .from("pagamentos_v2")
        .delete()
        .eq("id", id);

      if (error) {
        console.error("[deleteCobranca] Erro ao excluir do Supabase:", error);
        return { success: false, errorMessage: error.message };
      }

      await refreshCobrancas();
      if (cobranca.id_int) await checkAndRevertPropostaStatus(cobranca.id_int);
      return { success: true };
    } else {
      const updateCob = (list: Cobranca[]): Cobranca[] => list.filter((c) => c.id !== id);
      setCobrancas(updateCob);
      setCobrancasStats(updateCob);
      return { success: true };
    }
  }, [source, cobrancas, cobrancasStats, refreshCobrancas]);


  const liberarParaPedido = useCallback((idInt: number) => {
    if (source === "supabase") {
      return false;
    }

    const cobrancasDaProposta = cobrancasStats.filter((item) => item.id_int === idInt);

    if (!canLiberarParaPedido(cobrancasDaProposta)) {
      return false;
    }

    const liberadoAt = new Date().toISOString();

    const updateCob = (list: Cobranca[]): Cobranca[] =>
      list.map((cobranca) => {
        if (cobranca.id_int !== idInt) {
          return cobranca;
        }

        return {
          ...cobranca,
          pedidoLiberadoMock: true,
          historico: [
            {
              id: `hist_liberacao_${cobranca.id}_${liberadoAt}`,
              data: liberadoAt,
              titulo: "Proposta liberada para pedido no mock",
              descricao: "Financeiro conferiu os pagamentos válidos e liberou a proposta para virar pedido.",
              tipo: "success"
            },
            ...cobranca.historico
          ]
        } as Cobranca;
      });

    setCobrancas(updateCob);
    setCobrancasStats(updateCob);

    return true;
  }, [cobrancasStats, source]);

  const liberarCobrancaReal = useCallback(async (id: string, confirmadoPor: string, status?: string, confirmado = true, acao?: string): Promise<boolean> => {
    // confirmado=true em pagamentos_v2 representa liberação operacional da cobrança para os próximos fluxos. Não significa criação de pedido de produção nem geração de OS física.
    if (!id) {
      throw new Error("ID de cobranca invalido.");
    }

    const isAutorizacao = acao === "autorizar_faturamento";
    const finalConfirmado = isAutorizacao ? false : confirmado;
    const finalConfirmadoPor = finalConfirmado ? confirmadoPor : null;
    const finalDataConfirmacao = finalConfirmado ? new Date().toISOString() : null;

    if (source === "supabase") {
      const result = await updatePagamentoV2StatusConfirmacao(id, {
        confirmado: finalConfirmado,
        confirmado_por: finalConfirmadoPor,
        data_confirmacao: finalDataConfirmacao,
        status,
        ...(isAutorizacao ? { aprovado_por: confirmadoPor } : {})
      });

      if (!result.success || !result.updated) {
        throw new Error(result.errorMessage || "Falha ao liberar cobranca no Supabase.");
      }

      const updated = result.updated;
      const updateList = (list: Cobranca[]) => list.map((item) => (item.id === id ? updated : item));
      setCobrancas(updateList);
      setCobrancasStats(updateList);
      return true;
    }

    // Mock fallback
    const mockConfirmadoAt = new Date().toISOString();
    const updateList = (list: Cobranca[]) =>
      list.map((item) =>
        item.id === id
          ? ({
              ...item,
              confirmado: finalConfirmado,
              confirmado_por: finalConfirmado ? confirmadoPor : (isAutorizacao ? confirmadoPor : undefined),
              data_confirmacao: finalConfirmado ? mockConfirmadoAt : undefined,
              status: status || item.status
            } as Cobranca)
          : item
      );
    setCobrancas(updateList);
    setCobrancasStats(updateList);
    return true;
  }, [source]);

  const voltarCobrancaFilaReal = useCallback(async (id: string): Promise<boolean> => {
    if (!id) {
      throw new Error("ID de cobranca invalido.");
    }

    if (source === "supabase") {
      const result = await updatePagamentoV2StatusConfirmacao(id, {
        confirmado: false,
        confirmado_por: null,
        data_confirmacao: null
      });

      if (!result.success || !result.updated) {
        throw new Error(result.errorMessage || "Falha ao estornar cobranca no Supabase.");
      }

      const updated = result.updated;
      const updateList = (list: Cobranca[]) => list.map((item) => (item.id === id ? updated : item));
      setCobrancas(updateList);
      setCobrancasStats(updateList);
      return true;
    }

    // Mock fallback
    const updateList = (list: Cobranca[]) =>
      list.map((item) =>
        item.id === id
          ? ({
              ...item,
              confirmado: false,
              confirmado_por: undefined,
              data_confirmacao: undefined
            } as Cobranca)
          : item
      );
    setCobrancas(updateList);
    setCobrancasStats(updateList);
    return true;
  }, [source]);

  const emitirBoletoReal = useCallback(async (id: string): Promise<{ success: boolean; errorMessage?: string }> => {
    const cobranca = cobrancasStats.find((item) => item.id === id) || cobrancas.find((item) => item.id === id);
    if (!cobranca) {
      return { success: false, errorMessage: "Cobrança não encontrada." };
    }

    if (source === "supabase") {
      const client = getSupabaseClient();
      if (!client) {
        return { success: false, errorMessage: "Cliente Supabase não inicializado." };
      }

      // 1. Verificar duplicidade na tabela public.boletos
      // Priorizar busca por id_pagamento se existir, caso contrário usar id_int como fallback.
      let existingBoletos: Array<{ id: string; id_int: number | null; id_pagamento: string | null; status: string | null }> = [];
      if (cobranca.id_pagamento && cobranca.id_pagamento.trim() !== "") {
        const { data, error } = await client
          .from("boletos")
          .select("id, id_int, id_pagamento, status")
          .eq("id_pagamento", cobranca.id_pagamento);
        if (error) {
          console.error("Erro ao verificar boletos por id_pagamento:", error);
          return { success: false, errorMessage: `Erro ao verificar boletos existentes: ${error.message}` };
        }
        if (data) {
          existingBoletos = data;
        }
      } else {
        const { data, error } = await client
          .from("boletos")
          .select("id, id_int, id_pagamento, status")
          .eq("id_int", cobranca.id_int);
        if (error) {
          console.error("Erro ao verificar boletos por id_int fallback:", error);
          return { success: false, errorMessage: `Erro ao verificar boletos existentes (fallback id_int): ${error.message}` };
        }
        if (data) {
          existingBoletos = data;
        }
      }

      const statusInativos = ["CANCELADO", "CANCELADA", "ESTORNADO", "ERRO", "FALHA"];
      const temBoletoAtivo = existingBoletos.some((b) => {
        const status = b.status;
        if (status === null || status === undefined) {
          return true; // Trata status null/undefined como ativo para evitar reemissão indevida
        }
        const statusStr = String(status).trim();
        if (statusStr === "") {
          return true; // Trata status vazio como ativo
        }
        return !statusInativos.includes(statusStr.toUpperCase());
      });

      if (temBoletoAtivo) {
        return {
          success: false,
          errorMessage: "Já existe boleto lançado para esta proposta/cobrança. Abra o registro existente no Contas a Receber."
        };
      }

      // 2. Obter dados complementares do cliente, contato e endereço
      let email = "";
      let whats = "";
      let contato = "";
      let logradouro = "";
      let complemento = "";
      let cidade = "";
      let uf = "";
      let zipCode = "";

      try {
        const { data: clientData } = await client
          .from("clientes")
          .select("email, email_financeiro, email_contato, whatsapp_1, whatsapp_2")
          .eq("id_cliente", cobranca.id_cliente)
          .maybeSingle();

        if (clientData) {
          email = clientData.email_financeiro || clientData.email || clientData.email_contato || "";
          whats = clientData.whatsapp_1 || clientData.whatsapp_2 || "";
        }

        const { data: contactData } = await client
          .from("contatos")
          .select("nome_contato, whats, e_mail")
          .eq("id_cliente", cobranca.id_cliente)
          .limit(1);

        if (contactData && contactData.length > 0) {
          contato = contactData[0].nome_contato || "";
          if (!email) email = contactData[0].e_mail || "";
          if (!whats) whats = contactData[0].whats || "";
        }

        const { data: addressData } = await client
          .from("enderecos")
          .select("cep, endereco, numero, complemento, cidade, uf")
          .eq("id_cliente", cobranca.id_cliente)
          .limit(1);

        if (addressData && addressData.length > 0) {
          const addr = addressData[0];
          logradouro = `${addr.endereco || ""}${addr.numero ? ", " + addr.numero : ""}`;
          complemento = addr.complemento || "";
          cidade = addr.cidade || "";
          uf = addr.uf || "";
          zipCode = addr.cep || "";
        }
      } catch (err) {
        console.warn("Erro ao buscar dados complementares do cliente:", err);
      }

      if (!email) {
        return { success: false, errorMessage: "Cliente sem e-mail cadastrado para geração do boleto." };
      }

      // 3. Chamar a rota local de geração de boleto
      const webhookPayload = {
        cobrancaId: cobranca.id,
        idEmpresa: cobranca.id_empresa || 1,
        external_reference_id: cobranca.id_int,
        valor_total: roundMoney(cobranca.valor),
        name: cobranca.cliente,
        id_pagamento: cobranca.id_pagamento || String(cobranca.id_int),
        documento: cobranca.documento,
        email,
        logradouro,
        complemento,
        cidade,
        UF: uf,
        zip_code: zipCode,
        qtd_parcelas: 1,
        intervalo: 0,
        inicia_em: 3,
        multa: 0,
        juros: 0,
        descricao: cobranca.descricao || `Boleto E-Faturado da proposta #${cobranca.id_int}`,
        id_cliente: cobranca.id_cliente,
        nf: "",
        status: "A_VENCER",
        "e-faturado": true,
        contato,
        whats,
        enviar_whats: false,
        avulso: false,
        is_prorrogado: false,
        empresa: cobranca.empresa
      };

      const response = await fetch("/api/cobrancas/gerar-boleto", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(webhookPayload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, errorMessage: `Erro ao emitir boleto: ${errorText}` };
      }

      const resJson = await response.json();
      if (!resJson.success) {
        return { success: false, errorMessage: resJson.message || "Erro retornado da API do boleto." };
      }

      // 4. Inserir na tabela public.boletos
      const boletoData = {
        id_int: cobranca.id_int,
        id_pagamento: cobranca.id_pagamento || null,
        id_cliente: cobranca.id_cliente,
        valor: cobranca.valor,
        vencimento: cobranca.vencimento || null,
        empresa: cobranca.empresa,
        id_empresa: cobranca.id_empresa,
        nome_cliente: cobranca.cliente,
        documento: cobranca.documento,
        linha_digitavel: resJson.integration?.linha_digitavel || null,
        url_pdf: resJson.integration?.url_pdf || null,
        status: "A_VENCER",
        nosso_numero: resJson.integration?.nosso_numero || null,
        id_boleto_c6: resJson.integration?.id_boleto_c6 || null
      };

      const { error: insertError } = await client
        .from("boletos")
        .insert([boletoData]);

      if (insertError) {
        console.error("Erro ao registrar boleto no Contas a Receber:", insertError);
        return {
          success: false,
          errorMessage: `Boleto gerado, mas ocorreu um erro ao registrar no Contas a Receber: ${insertError.message}`
        };
      }

      // 5. Registrar na timeline propostas_chat
      await registrarMensagemSistemaProposta({
        idInt: cobranca.id_int,
        idCliente: cobranca.id_cliente,
        mensagem: "Boleto emitido e lançado no Contas a Receber.",
        setor: "Financeiro"
      });

      await refreshCobrancas();
      return { success: true };
    } else {
      // Mock/fallback local storage
      const nowStr = new Date().toISOString();
      const updatedList = (list: Cobranca[]) =>
        list.map((item) =>
          item.id === id
            ? ({
                ...item,
                boleto_enviadoo: true,
                linha_digitavel: "34191.79001 01043.513184 91020.150008 7 90000000000000",
                url_pdf: "https://example.com/boleto-mock.pdf"
              } as Cobranca)
            : item
        );
      
      setCobrancas(updatedList);
      setCobrancasStats(updatedList);

      const target = cobrancasStats.find((item) => item.id === id) || cobrancas.find((item) => item.id === id);
      if (target) {
        target.propostasChat = [
          {
            id: `msg_${nowStr}`,
            data: nowStr,
            autor: "Sistema",
            mensagem: "Boleto emitido e lançado no Contas a Receber.",
            categoria: "SISTEMA"
          },
          ...target.propostasChat
        ];
      }

      return { success: true };
    }
  }, [source, cobrancas, cobrancasStats, refreshCobrancas]);

  const value = useMemo<CobrancasContextValue>(
    () => ({
      cobrancas,
      cobrancasStats,
      source,
      createCobranca,
      confirmPagamento,
      cancelCobranca,
      deleteCobranca,
      cancelarExterno,
      liberarParaPedido,
      refreshCobrancas,
      getCobrancaById: (id: string) => cobrancas.find((item) => item.id === id) ?? cobrancasStats.find((item) => item.id === id),
      getCobrancaByToken: (token: string) =>
        cobrancas.find((item) => item.token_publico === token) ?? cobrancasStats.find((item) => item.token_publico === token),
      getCobrancasByProposta: (idInt: number) => cobrancasStats.filter((item) => item.id_int === idInt),
      liberarCobrancaReal,
      voltarCobrancaFilaReal,
      emitirBoletoReal,
      existingBoletoIdInts,
      hasBoletoHistoryIdInts,
      marcarComoBoletosPreparadosLocal,
      recalcularBoletoIdIntsLocal
    }),
    [
      cobrancas,
      cobrancasStats,
      source,
      cancelCobranca,
      deleteCobranca,
      cancelarExterno,
      confirmPagamento,
      createCobranca,
      liberarParaPedido,
      refreshCobrancas,
      liberarCobrancaReal,
      voltarCobrancaFilaReal,
      emitirBoletoReal,
      existingBoletoIdInts,
      hasBoletoHistoryIdInts,
      marcarComoBoletosPreparadosLocal,
      recalcularBoletoIdIntsLocal
    ]
  );

  return <CobrancasContext.Provider value={value}>{children}</CobrancasContext.Provider>;
}

export function useCobrancas() {
  const context = useContext(CobrancasContext);

  if (!context) {
    throw new Error("useCobrancas deve ser usado dentro de CobrancasProvider.");
  }

  return context;
}
