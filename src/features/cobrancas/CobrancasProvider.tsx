"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Cobranca, CriarCobrancaFormValues } from "@/features/cobrancas/types";
import type { Proposta } from "@/features/orcamentos/types";
import { clonePagamentosMock, createCobrancaFromForm, getEmpresaRecebedoraByProposta } from "@/lib/mocks/pagamentos.mock";
import { canLiberarParaPedido, roundMoney } from "@/features/cobrancas/cobrancas-utils";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  getCobrancasReadOnlyData,
  type CobrancasReadResult,
  type CobrancasReadSource
} from "@/features/cobrancas/services/pagamentos-v2.service";

type CobrancasContextValue = {
  cobrancas: Cobranca[];
  cobrancasStats: Cobranca[];
  source: CobrancasReadSource;
  createCobranca: (values: CriarCobrancaFormValues, proposta?: Proposta) => Promise<Cobranca>;
  confirmPagamento: (id: string) => void;
  cancelCobranca: (id: string, motivo: string) => void;
  liberarParaPedido: (idInt: number) => boolean;
  refreshCobrancas: () => Promise<CobrancasReadResult>;
  getCobrancaById: (id: string) => Cobranca | undefined;
  getCobrancaByToken: (token: string) => Cobranca | undefined;
  getCobrancasByProposta: (idInt: number) => Cobranca[];
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

    setHasLoadedStorage(true);
    return result;
  }, []);

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
      const idEmpresa = empresaOption?.id ?? 1;
      const nomeEmpresa = empresaOption?.nome ?? proposta.empresa;

      // 1. Criar registro inicial em pagamentos_v2 com status A_RECEBER
      const payloadInicial = {
        id_int: proposta.id_int,
        id_cliente: proposta.cliente.idCliente,
        cliente: proposta.cliente.nome,
        documento: proposta.cliente.documento,
        valor: roundMoney(values.valor),
        status: "A_RECEBER",
        tipo_cobranca: values.tipoCobranca,
        empresa: nomeEmpresa,
        id_empresa: idEmpresa,
        os_ideal: values.osIdeal.trim(),
        atendente: proposta.vendedor || proposta.cliente.vendedor || "Sistema",
        descricao: values.descricao || `Cobrança ${values.tipoCobranca} da proposta #${proposta.id_int}`,
        vencimento: values.vencimento || null,
        obs_v2: values.observacao || null,
        confirmado: false
      };

      const { data: createdRows, error: insertError } = await client
        .from("pagamentos_v2")
        .insert([payloadInicial])
        .select()
        .returns<Array<{ id: string }>>();

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
        const webhookPayload = {
          cobrancaId: cobrancaId,
          idEmpresa: idEmpresa,
          external_reference_id: proposta.id_int,
          valor_total: roundMoney(values.valor),
          name: proposta.cliente.nome,
          id_pagamento: (createdRow as { id_pagamento?: string }).id_pagamento || String(proposta.id_int),
          documento: proposta.cliente.documento,
          email: proposta.contato?.email?.trim() || proposta.cliente?.email?.trim() || "",
          logradouro: proposta.enderecoEntrega?.endereco || "",
          complemento: proposta.enderecoEntrega?.complemento || "",
          cidade: proposta.enderecoEntrega?.cidade || "",
          UF: proposta.enderecoEntrega?.uf || "",
          zip_code: proposta.enderecoEntrega?.cep || "",
          qtd_parcelas: 1,
          intervalo: 0,
          inicia_em: 3,
          multa: 0,
          juros: 0,
          descricao: values.descricao || `Boleto da proposta #${proposta.id_int}`,
          id_cliente: proposta.cliente.idCliente,
          nf: "",
          status: "A_RECEBER",
          "e-faturado": false,
          contato: proposta.contato?.nome || "",
          whats: proposta.contato?.whatsapp || proposta.cliente.whatsapp || "",
          enviar_whats: false,
          avulso: false,
          is_prorrogado: false,
          empresa: nomeEmpresa
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

        try {
          const msg = values.tipoCobranca === "E-FATURADO"
            ? `Nova solicitação de faturamento registrada. Valor: R$ ${values.valor.toFixed(2).replace(".", ",")}.`
            : `Nova cobrança de Cartão de crédito registrada. Valor: R$ ${values.valor.toFixed(2).replace(".", ",")}.`;

          await client
            .from("propostas_chat")
            .insert([
              {
                id_int: proposta.id_int,
                id_cliente: proposta.cliente.idCliente,
                mensagem: msg,
                tipo: "SISTEMA",
                autor_nome: "Sistema",
                setor: "Financeiro",
                visivel_externo: false
              }
            ]);
        } catch (chatErr) {
          console.warn("Falha ao registrar historico no chat:", chatErr);
        }

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

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Erro ao gerar ${values.tipoCobranca}: ${errorText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || `Falha no retorno da API de ${values.tipoCobranca}.`);
      }

      // 5. Enviar mensagem no chat da proposta para BOLETO ou PIX
      try {
        const msg = values.tipoCobranca === "BOLETO"
          ? `Boleto registrado. Valor: R$ ${values.valor.toFixed(2).replace(".", ",")}.`
          : `Nova cobrança PIX registrada. Valor: R$ ${values.valor.toFixed(2).replace(".", ",")}.`;

        await client
          .from("propostas_chat")
          .insert([
            {
              id_int: proposta.id_int,
              id_cliente: proposta.cliente.idCliente,
              mensagem: msg,
              tipo: "SISTEMA",
              autor_nome: "Sistema",
              setor: "Financeiro",
              visivel_externo: false
            }
          ]);
      } catch (chatErr) {
        console.warn("Falha ao registrar historico no chat:", chatErr);
      }

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

    const next = createCobrancaFromForm(values);
    setCobrancas((current) => [next, ...current]);
    setCobrancasStats((current) => [next, ...current]);
    return next;
  }, [source, loadData]);

  const confirmPagamento = useCallback((id: string) => {
    if (source === "supabase") {
      return;
    }

    const updateCob = (list: Cobranca[]): Cobranca[] =>
      list.map((cobranca) => {
        if (cobranca.id !== id) {
          return cobranca;
        }

        const paidAt = new Date().toISOString();

        return {
          ...cobranca,
          status: "PAID",
          paid_at: paidAt,
          confirmado: true,
          confirmado_por: "Operador mockado",
          data_confirmacao: paidAt,
          historico: [
            {
              id: `hist_confirm_${paidAt}`,
              data: paidAt,
              titulo: "Pagamento confirmado no mock",
              descricao: "Status alterado para pago via ação manual.",
              tipo: "success"
            },
            ...cobranca.historico
          ]
        } as Cobranca;
      });

    setCobrancas(updateCob);
    setCobrancasStats(updateCob);
  }, [source]);

  const cancelCobranca = useCallback((id: string, motivo: string) => {
    if (source === "supabase") {
      return;
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
  }, [source]);

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

  const refreshCobrancas = useCallback(async () => {
    return loadData();
  }, [loadData]);

  const value = useMemo<CobrancasContextValue>(
    () => ({
      cobrancas,
      cobrancasStats,
      source,
      createCobranca,
      confirmPagamento,
      cancelCobranca,
      liberarParaPedido,
      refreshCobrancas,
      getCobrancaById: (id: string) => cobrancas.find((item) => item.id === id) ?? cobrancasStats.find((item) => item.id === id),
      getCobrancaByToken: (token: string) =>
        cobrancas.find((item) => item.token_publico === token) ?? cobrancasStats.find((item) => item.token_publico === token),
      getCobrancasByProposta: (idInt: number) => cobrancasStats.filter((item) => item.id_int === idInt)
    }),
    [cobrancas, cobrancasStats, source, cancelCobranca, confirmPagamento, createCobranca, liberarParaPedido, refreshCobrancas]
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
