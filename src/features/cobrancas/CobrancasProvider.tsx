"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Cobranca, CriarCobrancaFormValues, CreditAnalysisResult, ModeloCobranca } from "@/features/cobrancas/types";
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
import {
  registrarMensagemSistemaProposta,
  createPropostaChatMentions
} from "@/features/orcamentos/services/orcamentos.service";
import { PROPOSTA_STATUS_PROTEGIDOS } from "@/features/orcamentos/services/status-protegidos";
import type { DestinoValorCancelado, MotivoCancelamentoPago } from "@/features/cobrancas/cancelamento-pago";

/** Payload do cancelamento de cobrança JÁ PAGA — espelha o objeto que o
 *  CancelCobrancaModal monta e o contrato de POST /api/cobrancas/cancelar-pago. */
export type DadosCancelamentoCobrancaPaga = {
  motivo: MotivoCancelamentoPago;
  motivoTexto: string;
  destino: DestinoValorCancelado;
  confirmaMesFechado: boolean;
};

/** Códigos de erro da rota /api/cobrancas/cancelar-pago. */
export type CancelamentoPagoErrorCode =
  | "NEGADO"
  | "NAO_ENCONTRADA"
  | "NAO_PAGA"
  | "PRODUCAO_ATIVA"
  | "MES_FECHADO"
  | "MOTIVO_INVALIDO"
  | "FALHA_CREDITO";

type CobrancasContextValue = {
  cobrancas: Cobranca[];
  cobrancasStats: Cobranca[];
  source: CobrancasReadSource;
  createCobranca: (values: CriarCobrancaFormValues, proposta?: Proposta) => Promise<Cobranca>;
  confirmPagamento: (id: string) => void;
  cancelCobranca: (
    id: string,
    motivo: string,
    dadosPago?: DadosCancelamentoCobrancaPaga
  ) => Promise<{ success: boolean; errorMessage?: string; code?: CancelamentoPagoErrorCode }>;
  cancelarExterno: (cobranca: Cobranca, acaoLocal: "DELETE" | "CANCEL", motivo?: string) => Promise<{ success: boolean; errorMessage?: string }>;
  
  liberarParaPedido: (idInt: number) => boolean;
  refreshCobrancas: (filters?: any) => Promise<CobrancasReadResult>;
  getCobrancaById: (id: string) => Cobranca | undefined;
  getCobrancaByToken: (token: string) => Cobranca | undefined;
  getCobrancasByProposta: (idInt: number) => Cobranca[];
  liberarCobrancaReal: (id: string, confirmadoPor: string, status?: string, confirmado?: boolean, acao?: string) => Promise<boolean>;
  voltarCobrancaFilaReal: (id: string) => Promise<boolean>;
  emitirBoletoReal: (id: string) => Promise<{ success: boolean; errorMessage?: string }>;
  alterarCondicaoCobrancaReal: (id: string, novoModelo: ModeloCobranca, operador: string, obs?: string) => Promise<{ success: boolean; errorMessage?: string }>;
  reprovarCondicaoCobrancaReal: (id: string, motivo: string, operador: string) => Promise<{ success: boolean; errorMessage?: string }>;
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

function normalizarNome(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

type VendedorProposta = { user_id: string; nome_usuario: string; email: string };

/** Retorno de public.cobranca_reprovar_condicao (migration 20260730). */
type ReprovarCondicaoRpcResult = {
  ok?: boolean;
  already_cancelled?: boolean;
  id_int?: number;
  pagamento_status?: string;
  proposta_status?: string;
  proposta_status_anterior?: string;
  motivo?: string;
  obs_v2?: string;
};

/**
 * Traduz o erro da RPC de reprovação para o operador.
 *
 * A RPC falha fechada: em qualquer erro nenhuma das duas escritas persiste,
 * então a mensagem pode ser exibida sem ressalva de estado parcial.
 */
function traduzirErroReprovacao(error: { message?: string; code?: string }): string {
  const code = String(error.code || "");
  const raw = String(error.message || "").trim();

  if (code === "PGRST202" || code === "42883" || /could not find the function/i.test(raw)) {
    return "Reprovação indisponível: a função cobranca_reprovar_condicao não existe no banco (migration 20260730_rpc_cobranca_reprovar_condicao.sql pendente). Nenhuma alteração foi feita.";
  }

  const semPrefixo = raw.replace(/^REPROVA(_[A-Z_]+)?:\s*/, "");
  return semPrefixo || "Falha ao reprovar a condição.";
}

/**
 * Resolve o vendedor responsável pela proposta para receber notificação no chat.
 *
 * `public.propostas.user_id` é o UID de autenticação de quem lançou a proposta e
 * corresponde ao nome exibido em `public.propostas.vendedor` (confirmado no banco).
 * `public.propostas.id_vendedor` NÃO serve: é um UUID distinto por proposta que
 * não referencia `public.usuarios`.
 *
 * O fallback por nome usa a mesma normalização de `verificarEscopoPropostaServerSide`
 * e cobre linhas legadas sem `user_id`; só é aceito quando resolve um único usuário.
 */
async function resolverVendedorProposta(
  client: SupabaseClient,
  idInt: number
): Promise<VendedorProposta | null> {
  const { data: proposta, error } = await client
    .from("propostas")
    .select("user_id, vendedor")
    .eq("id_int", idInt)
    .maybeSingle();

  if (error || !proposta) {
    console.warn("[CobrancasProvider] Não foi possível ler o vendedor da proposta:", error?.message);
    return null;
  }

  if (proposta.user_id) {
    const { data: usuario } = await client
      .from("usuarios")
      .select("user_id, nome_usuario, email")
      .eq("user_id", proposta.user_id)
      .maybeSingle();

    if (usuario?.user_id) {
      return {
        user_id: String(usuario.user_id),
        nome_usuario: usuario.nome_usuario || proposta.vendedor || "Vendedor",
        email: usuario.email || ""
      };
    }
  }

  const nomeVendedor = String(proposta.vendedor || "").trim();
  if (!nomeVendedor) return null;

  const { data: candidatos } = await client
    .from("usuarios")
    .select("user_id, nome_usuario, email")
    .ilike("nome_usuario", nomeVendedor);

  const exatos = (candidatos || []).filter(
    (u: { nome_usuario: string | null }) => normalizarNome(u.nome_usuario || "") === normalizarNome(nomeVendedor)
  );

  if (exatos.length !== 1) {
    console.warn(
      `[CobrancasProvider] Vendedor da proposta #${idInt} não identificado de forma única ("${nomeVendedor}").`
    );
    return null;
  }

  return {
    user_id: String(exatos[0].user_id),
    nome_usuario: exatos[0].nome_usuario || nomeVendedor,
    email: exatos[0].email || ""
  };
}

const soDigitos = (valor: unknown): string => String(valor ?? "").replace(/\D/g, "");

/**
 * Payload do boleto à vista. Extraído do fluxo do C6 sem alterar nenhum campo,
 * para que a criação e a rechamada (empresa 2) usem exatamente a mesma
 * montagem e não possam divergir.
 *
 * Roteamento por empresa fica na rota /api/cobrancas/gerar-boleto: empresa 2
 * (Ideal Birô) vai para o Inter, as demais seguem no C6.
 */
function montarPayloadBoletoAVista(params: {
  proposta: Proposta;
  valor: number;
  idPagamento: string;
  idEmpresa: number;
}): Record<string, unknown> {
  const { proposta, valor, idPagamento, idEmpresa } = params;

  const payload: Record<string, unknown> = {
    external_reference_id: String(proposta.id_int),
    valor_total: roundMoney(valor),
    name: proposta.cliente.nome,
    id_pagamento: idPagamento,
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

  // O Inter recusa campos com máscara. O C6 continua recebendo os valores
  // exatamente como recebia antes.
  if (idEmpresa === 2) {
    payload.documento = soDigitos(payload.documento);
    payload.zip_code = soDigitos(payload.zip_code);
    payload.contato = soDigitos(payload.contato);
    payload.whats = soDigitos(payload.whats);
  }

  return payload;
}

/**
 * Pede ao servidor a avaliação de liberação automática do E-FATURADO.
 *
 * Best-effort de propósito: a decisão é do backend, e qualquer falha aqui
 * (rede, sessão, indisponibilidade) deixa a cobrança PENDENTE — que é o estado
 * seguro e o comportamento atual. Nunca lança: uma falha de liberação não pode
 * derrubar a criação da cobrança, que já foi persistida.
 *
 * Retorna true apenas quando o servidor confirma a liberação.
 */
async function acionarAprovacaoAutomaticaFaturado(client: SupabaseClient, cobrancaId: string): Promise<boolean> {
  try {
    const sessionResponse = await client.auth.getSession();
    const tokenSessao = sessionResponse.data.session?.access_token || "";

    const resposta = await fetch("/api/cobrancas/aprovar-faturado-automatico", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Authorization": `Bearer ${tokenSessao}`
      },
      body: JSON.stringify({ cobrancaId })
    });

    const resultado = await resposta.json().catch(() => null);

    if (!resposta.ok || !resultado?.success) {
      console.warn("[CobrancasProvider] Avaliacao automatica do faturado sem efeito:", resultado?.message);
      return false;
    }

    return resultado.aprovadoAutomaticamente === true;
  } catch (erro) {
    console.warn("[CobrancasProvider] Falha ao avaliar liberacao automatica do faturado:", erro);
    return false;
  }
}

/** Marcador do Cartão Asas na descrição. Identifica a cobrança sem coluna nova. */
export const MARCADOR_CARTAO_ASAS = "Cartão Asas";

/** URL interna gravada na criação, antes de qualquer integração externa. */
const PREFIXO_URL_INTERNA = "https://pay.ai-ideal.com.br/";

/** Só a URL que já não é a interna comprova que o provedor gravou o checkout. */
function urlDoProvedor(url?: string | null): boolean {
  return Boolean(url && !url.startsWith(PREFIXO_URL_INTERNA));
}

/**
 * Aciona o Cartão Asas para uma cobrança já existente. A rota é idempotente:
 * se a cobrança já tem link do provedor, devolve o existente sem reacionar o n8n.
 */
async function acionarCartaoAsas(client: SupabaseClient, cobrancaId: string): Promise<void> {
  const sessionResponse = await client.auth.getSession();
  const tokenSessao = sessionResponse.data.session?.access_token || "";

  const resposta = await fetch("/api/cobrancas/gerar-cartao-asas", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Authorization": `Bearer ${tokenSessao}`
    },
    body: JSON.stringify({ cobrancaId })
  });

  const resultado = await resposta.json().catch(() => null);

  if (!resposta.ok || !resultado?.success) {
    throw new Error(resultado?.message || "Falha ao gerar o link de pagamento do Cartão Asas.");
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

  const loadData = useCallback(async (filters?: any): Promise<CobrancasReadResult> => {
    const stored = readStoredCobrancas();
    const result = await getCobrancasReadOnlyData(filters);

    if (!isMountedRef.current) {
      return result;
    }

    if (result.warnings.length > 0) {
      console.info("[Cobrancas][Supabase]", result.warnings);
    }

    // Falha de consulta: preserva o último estado válido em vez de zerar a tela
    // ou trocar cobranças reais por mock. Sem isso, uma recarga que falhasse
    // (ex.: logo após cancelar uma cobrança) fazia os pagamentos existentes
    // sumirem até o usuário dar F5.
    if (result.errorMessage) {
      console.error("[CobrancasProvider] Recarga de cobranças falhou; estado anterior preservado:", result.errorMessage);
      return result;
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

  const refreshCobrancas = useCallback(async (filters?: any) => {
    return loadData(filters);
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
      // Conjunto COMPLETO (cobrancasStats), não a fatia de 500 de `cobrancas`:
      // cobrança nova e pendente não tem paid_at nem data_confirmacao, então
      // fica no fim da ordenação e pode cair fora da fatia — o saldo aqui
      // divergia do que a aba Pagamentos mostra.
      const cobrancasDaProposta = cobrancasStats.filter((item) => item.id_int === proposta.id_int && item.status !== "CANCELADO");
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

      // Cartão Asas — antiduplicidade em nova tentativa. A linha de pagamentos_v2
      // é criada ANTES da chamada ao n8n; se a integração falhou, a cobrança
      // ficou pendente sem link do provedor e um novo clique criaria uma SEGUNDA
      // linha. Reaproveita a equivalente: com link, devolve; sem link, reaciona
      // o n8n sobre a MESMA cobrança.
      if (values.tipoCobranca === "CARD_PARCELADO" && values.cartaoFluxo === "ASAS") {
        const { data: candidatas } = await client
          .from("pagamentos_v2")
          .select("id, valor, url_cobranca")
          .eq("id_int", proposta.id_int)
          .eq("tipo_cobranca", "CARD_PARCELADO")
          .eq("status", "A_RECEBER")
          .ilike("descricao", `%${MARCADOR_CARTAO_ASAS}%`)
          .returns<Array<{ id: string; valor: number | null; url_cobranca: string | null }>>();

        const equivalente = (candidatas || []).find(
          (item) => roundMoney(Number(item.valor ?? 0)) === roundMoney(values.valor)
        );

        if (equivalente) {
          if (!urlDoProvedor(equivalente.url_cobranca)) {
            await acionarCartaoAsas(client, equivalente.id);
          }

          const loadResult = await loadData();
          const found = loadResult.cobrancas.find((item) => item.id === equivalente.id) ||
                        loadResult.cobrancasStats.find((item) => item.id === equivalente.id);

          if (!found) {
            throw new Error("Cobrança do Cartão Asas não encontrada ao recarregar. Atualize a tela.");
          }

          return found;
        }
      }

      const empresaOption = getEmpresaRecebedoraByProposta(proposta);
      const idEmpresa = values.id_empresa ?? (empresaOption?.id ?? 1);
      const nomeEmpresa = values.empresa ?? (empresaOption?.nome ?? proposta.empresa);

      // Boleto Inter (empresa 2) — antiduplicidade em nova tentativa. A linha de
      // pagamentos_v2 é criada ANTES da chamada ao webhook; se a integração
      // falhar, a cobrança fica pendente e um novo clique criaria um SEGUNDO
      // pagamento. Reaproveita a equivalente em vez de inserir outra. O fluxo do
      // C6 (empresas 1 e 3) não passa por aqui.
      if (values.tipoCobranca === "BOLETO" && idEmpresa === 2) {
        const { data: pendentes } = await client
          .from("pagamentos_v2")
          .select("id, id_pagamento, valor, linha_digitavel")
          .eq("id_int", proposta.id_int)
          .eq("tipo_cobranca", "BOLETO")
          .eq("id_empresa", 2)
          .eq("status", "A_RECEBER")
          .returns<Array<{ id: string; id_pagamento: string | null; valor: number | null; linha_digitavel: string | null }>>();

        const equivalente = (pendentes || []).find(
          (item) => roundMoney(Number(item.valor ?? 0)) === roundMoney(values.valor)
        );

        if (equivalente) {
          // Sem linha digitável, o webhook não concluiu: reaciona sobre a MESMA
          // cobrança. Com linha digitável, apenas devolve a existente.
          if (!equivalente.linha_digitavel && equivalente.id_pagamento) {
            const sessionResponse = await client.auth.getSession();
            const tokenSessao = sessionResponse.data.session?.access_token || "";

            const retry = await fetch("/api/cobrancas/gerar-boleto", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "Authorization": `Bearer ${tokenSessao}`
              },
              body: JSON.stringify(
                montarPayloadBoletoAVista({
                  proposta,
                  valor: values.valor,
                  idPagamento: equivalente.id_pagamento,
                  idEmpresa
                })
              )
            });

            const retryResult = await retry.json().catch(() => null);
            if (!retry.ok || !retryResult?.success) {
              throw new Error(retryResult?.message || "Falha ao gerar o boleto no Banco Inter.");
            }
          }

          const loadResult = await loadData();
          const found = loadResult.cobrancas.find((item) => item.id === equivalente.id) ||
                        loadResult.cobrancasStats.find((item) => item.id === equivalente.id);

          if (!found) {
            throw new Error("Boleto encontrado, mas a cobrança não foi localizada ao recarregar. Atualize a tela.");
          }

          return found;
        }
      }

       const isFaturadoType = ["E-FATURADO", "E-RETRABALHO", "E-PERMUTA", "E-AMOSTRA"].includes(values.tipoCobranca);

       if (isFaturadoType) {
         if (!values.forma_fatu) {
           throw new Error("Condição de pagamento (forma_fatu) inválida ou não selecionada.");
         }
         if (values.p_qtd_parcelas == null || values.p_dias_pra_inicio == null || values.p_intervalo == null) {
           throw new Error("Dados de parcelamento inválidos ou não selecionados.");
         }
       }

       // `pagamentos_v2.os_ideal` é INTEGER: só número entra, nunca texto.
       // O mapper preenche `Cobranca.os_ideal` com `id_pagamento` quando a
       // coluna está nula, e esse valor ("20130-A") chegava aqui pelo
       // pré-preenchimento do formulário, derrubando o insert com
       // `invalid input syntax for type integer`.
       const osIdealTexto = values.osIdeal.trim();
       const osIdealNumero = /^\d+$/.test(osIdealTexto) ? Number(osIdealTexto) : null;

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
         os_ideal: osIdealNumero,
         atendente: proposta.vendedor || proposta.cliente.vendedor || "Sistema",
         descricao: values.descricao || `Cobrança ${values.tipoCobranca} da proposta #${proposta.id_int}`,
         vencimento: values.vencimento || null,
         obs_v2: values.observacao || null,
         confirmado: false,
         forma_fatu: isFaturadoType ? (values.forma_fatu || null) : null,
         forma_pgto: isFaturadoType ? (values.forma_fatu || null) : null,
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

        const webhookPayload = montarPayloadBoletoAVista({
          proposta,
          valor: values.valor,
          idPagamento: createdRow.id_pagamento || String(proposta.id_int),
          idEmpresa
        });

        const sessionResponse = await client.auth.getSession();
        const token = sessionResponse.data.session?.access_token || "";

        response = await fetch("/api/cobrancas/gerar-boleto", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Authorization": `Bearer ${token}`
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

        const sessionResponse = await client.auth.getSession();
        const token = sessionResponse.data.session?.access_token || "";

        response = await fetch("/api/cobrancas/gerar-pix", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify(webhookPayload)
        });
      } else {
        // Para CARTAO (CARD_PARCELADO) ou FATURADO (E-FATURADO):
        // O checkout/faturamento é gerado no backend. Não disparamos webhook externo no front.
        // Apenas recarregamos os dados e retornamos a linha correspondente.

        // Exceção: o Cartão Asas aciona a rota que fala com o n8n. O cartão
        // padrão segue exatamente como antes, sem chamada externa aqui.
        // Se a rota falhar, o erro propaga e a cobrança NÃO é apresentada como
        // gerada — ela fica preservada para nova tentativa sem duplicar.
        if (values.tipoCobranca === "CARD_PARCELADO" && values.cartaoFluxo === "ASAS") {
          await acionarCartaoAsas(client, cobrancaId);
        }

        // E-FATURADO: o servidor avalia se o cliente está elegível e, em caso
        // positivo, grava `aprovado_por` — o que encaminha a cobrança direto
        // para a Fila de Conferência. Roda DEPOIS do INSERT de propósito: a
        // cobrança recém-criada precisa entrar no comprometido pendente.
        // Falha aqui mantém a cobrança em análise, sem interromper a criação.
        let liberadoAutomaticamente = false;
        if (values.tipoCobranca === "E-FATURADO") {
          liberadoAutomaticamente = await acionarAprovacaoAutomaticaFaturado(client, cobrancaId);
        }

        const loadResult = await loadData();
        const found = loadResult.cobrancas.find((item) => item.id === cobrancaId) ||
                      loadResult.cobrancasStats.find((item) => item.id === cobrancaId);

        const isFaturadoType = ["E-FATURADO", "E-RETRABALHO", "E-PERMUTA", "E-AMOSTRA"].includes(values.tipoCobranca);
        let msg = "";
        if (isFaturadoType) {
          const label = getTipoCobrancaLabel(values.tipoCobranca);
          let condicaoText = "";
          if (values.forma_fatu) {
            condicaoText = ` - Condição solicitada pelo vendedor: ${values.forma_fatu}. Sujeita à aprovação do Financeiro.`;
          }
          const observacoesText = ` Observações: ${values.observacao || "Nenhuma"}`;
          msg = liberadoAutomaticamente
            ? `${label} liberado automaticamente por limite operacional (sem faturamentos vencidos e com crédito disponível). Enviado para a Conferência.${condicaoText}${observacoesText}`
            : `${label} enviado para análise financeira.${condicaoText}${observacoesText}`;
        } else {
          const sufixoCartao = values.cartaoFluxo === "ASAS" ? " ASAS" : "";
          msg = `Registrada nova cobrança CARTÃO${sufixoCartao}, valor: R$ ${values.valor.toFixed(2).replace(".", ",")}.`;
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
        // Nunca jogar o corpo cru na tela: quando a resposta não vem da nossa
        // API (erro de proxy/plataforma), o corpo é uma PÁGINA HTML inteira, e
        // ela ia parar dentro do toast. Só a `message` da nossa API é exibível;
        // qualquer outra coisa vira mensagem curta e vai para o console.
        const bruto = await response.text();
        let mensagem = "";
        try {
          mensagem = String((JSON.parse(bruto) as { message?: unknown })?.message ?? "");
        } catch {
          console.error(
            `[CobrancasProvider] Resposta não-JSON ao gerar ${values.tipoCobranca}. status=${response.status} preview=${JSON.stringify(bruto.slice(0, 300))}`
          );
        }
        throw new Error(
          mensagem || `Não foi possível gerar o ${values.tipoCobranca} agora (HTTP ${response.status}). Tente novamente em instantes.`
        );
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
  }, [source, loadData, cobrancas, cobrancasStats]);


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
        // Obter status atual para evitar regressão destrutiva
        const { data: propData, error: propError } = await client
          .from("propostas")
          .select("status_interno")
          .eq("id_int", idInt)
          .maybeSingle();

        if (propError) {
          console.error("[CobrancasProvider] Erro ao consultar status_interno:", propError);
          return;
        }

        if (propData) {
          const currentStatus = String(propData.status_interno || "NOVO").trim().toUpperCase();

          if ((PROPOSTA_STATUS_PROTEGIDOS as readonly string[]).includes(currentStatus)) {
            console.log(`[CobrancasProvider] Cancelamento ignorou regressão pois status ${currentStatus} é protegido.`);
            return;
          }

          let nextStatus = "NOVO";
          if (currentStatus === "AGUARDANDO / EM ARTE" || currentStatus === "NOVO / EM ARTE") {
            nextStatus = "NOVO / EM ARTE";
          }

          const { error: updateError } = await client
            .from("propostas")
            .update({ status_interno: nextStatus })
            .eq("id_int", idInt);

          if (updateError) {
            console.error("[CobrancasProvider] Erro ao reverter status da proposta:", updateError);
          } else {
            console.log(`[CobrancasProvider] Proposta ${idInt} revertida para ${nextStatus} com sucesso.`);
          }
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

  // Cancelamento de cobranca JA PAGA: rota dedicada e isolada (POST
  // /api/cobrancas/cancelar-pago), restrita a super admin no servidor. Nao
  // reusa cancelarExterno de proposito — cobranca paga nao tem titulo em
  // aberto para baixar no provedor (o PIX ja caiu, o boleto ja liquidou), e a
  // rota antiga continua intocada, protegendo as cobrancas pagas de sempre.
  const cancelarCobrancaPaga = useCallback(async (
    id: string,
    dados: DadosCancelamentoCobrancaPaga
  ): Promise<{ success: boolean; errorMessage?: string; code?: CancelamentoPagoErrorCode }> => {
    try {
      const client = getSupabaseClient();
      if (!client) {
        return { success: false, errorMessage: "Cliente Supabase não inicializado." };
      }
      const sessionResponse = await client.auth.getSession();
      const token = sessionResponse.data.session?.access_token || "";
      if (!token) {
        return { success: false, errorMessage: "Sessão não encontrada. Faça login novamente." };
      }

      const response = await fetch("/api/cobrancas/cancelar-pago", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          id,
          motivo: dados.motivo,
          motivo_texto: dados.motivoTexto,
          destino_valor: dados.destino,
          confirma_mes_fechado: dados.confirmaMesFechado
        })
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        return {
          success: false,
          errorMessage: data?.message || "Não foi possível cancelar a cobrança paga.",
          code: data?.code as CancelamentoPagoErrorCode | undefined
        };
      }

      // Atualiza o estado local de imediato para a UI reagir; o refreshCobrancas
      // logo abaixo traz o motivo_cancela definitivo gravado pela rota.
      const updateCobLocal = (list: Cobranca[]): Cobranca[] =>
        list.map((cobranca) => (cobranca.id === id ? { ...cobranca, status: "CANCELADO" } : cobranca));
      setCobrancas(updateCobLocal);
      setCobrancasStats(updateCobLocal);

      await refreshCobrancas();
      const cobAlvo = cobrancasStats.find((item) => item.id === id) || cobrancas.find((item) => item.id === id);
      if (cobAlvo?.id_int) {
        await recalcularBoletoIdIntsLocal(cobAlvo.id_int);
        await checkAndRevertPropostaStatus(cobAlvo.id_int);
      }
      return { success: true };
    } catch (error) {
      return { success: false, errorMessage: error instanceof Error ? error.message : "Falha na comunicação com a API." };
    }
  }, [cobrancas, cobrancasStats, refreshCobrancas, recalcularBoletoIdIntsLocal, checkAndRevertPropostaStatus]);

  const cancelCobranca = useCallback(async (
    id: string,
    motivo: string,
    dadosPago?: DadosCancelamentoCobrancaPaga
  ): Promise<{ success: boolean; errorMessage?: string; code?: CancelamentoPagoErrorCode }> => {
    const cob = cobrancasStats.find((item) => item.id === id) || cobrancas.find((item) => item.id === id);
    if (!cob) {
      return { success: false, errorMessage: "Cobrança não encontrada." };
    }

    if (source === "supabase") {
      const client = getSupabaseClient();
      if (!client) {
        return { success: false, errorMessage: "Cliente Supabase não inicializado." };
      }

      // Revalidar status atual no Supabase para impedir cancelamento indevido
      const { data: dbRow, error: fetchError } = await client
        .from("pagamentos_v2")
        .select("status")
        .eq("id", id)
        .maybeSingle();

      if (fetchError || !dbRow) {
        console.error("[cancelCobranca] Erro ao buscar status atual da cobrança:", fetchError);
        return {
          success: false,
          errorMessage: fetchError?.message || "Não foi possível verificar o status atual da cobrança no banco."
        };
      }

      const dbStatusNorm = String(dbRow.status || "").trim().toUpperCase();
      // Cobranca paga tem fluxo proprio: rota dedicada, so super admin, motivo de
      // catalogo e destino do valor. O guard antigo continua valendo para tudo que
      // nao for paga.
      if (dbStatusNorm === "PAID" || dbStatusNorm === "A_VENCER") {
        if (!dadosPago) {
          return { success: false, errorMessage: "Não é permitido cancelar cobrança paga ou com faturamento aprovado (A_VENCER)." };
        }
        return await cancelarCobrancaPaga(id, dadosPago);
      }

      // Toda escrita financeira de cancelamento passa pela API protegida
      // (JWT + cobrancas.cancel + escopo de empresa). A rota decide se há
      // cancelamento no provedor ou apenas cancelamento lógico local.
      const extResult = await cancelarExterno(cob, "CANCEL", motivo);
      if (!extResult.success) {
        return extResult;
      }

      // O histórico do cancelamento é gravado pela rota /api/cobrancas/cancelar-externo,
      // que registra o AUTOR real (aqui só seria possível gravar autor "Sistema").

      // Update local state immediately so UI updates reactively
      const updateCobLocal = (list: Cobranca[]): Cobranca[] =>
        list.map((cobranca) => {
          if (cobranca.id !== id) return cobranca;
          return { ...cobranca, status: "CANCELADO", motivo_cancela: motivo };
        });
      setCobrancas(updateCobLocal);
      setCobrancasStats(updateCobLocal);

      await refreshCobrancas();
      if (cob.id_int) {
        await recalcularBoletoIdIntsLocal(cob.id_int);
        await checkAndRevertPropostaStatus(cob.id_int);
      }
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
  }, [source, cobrancas, cobrancasStats, refreshCobrancas, recalcularBoletoIdIntsLocal, cancelarCobrancaPaga]);

  const cancelarExterno = useCallback(async (cobranca: Cobranca, acaoLocal: "DELETE" | "CANCEL", motivo?: string): Promise<{ success: boolean; errorMessage?: string }> => {
    try {
      const client = getSupabaseClient();
      if (!client) {
        return { success: false, errorMessage: "Cliente Supabase não inicializado." };
      }
      const sessionResponse = await client.auth.getSession();
      const token = sessionResponse.data.session?.access_token || "";
      if (!token) {
        return { success: false, errorMessage: "Sessão não encontrada. Faça login novamente." };
      }

      const response = await fetch("/api/cobrancas/cancelar-externo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          id: cobranca.id,
          id_int: cobranca.id_int,
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

      // A ação local no backend é sempre cancelamento lógico (nunca DELETE físico):
      // o registro permanece com status CANCELADO, para os dois valores de acaoLocal.
      const updateCob = (list: Cobranca[]): Cobranca[] =>
        list.map((c) => (c.id === cobranca.id ? { ...c, status: "CANCELADO", motivo_cancela: motivo || "" } : c));
      setCobrancas(updateCob);
      setCobrancasStats(updateCob);

      await refreshCobrancas();
      if (cobranca.id_int) {
        await recalcularBoletoIdIntsLocal(cobranca.id_int);
        await checkAndRevertPropostaStatus(cobranca.id_int);
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, errorMessage: error.message || "Falha na comunicação com a API." };
    }
  }, [refreshCobrancas, recalcularBoletoIdIntsLocal]);

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
    // confirmado=true em pagamentos_v2 representa liberação operacional da cobrança para os próximos fluxos. 
    if (!id) {
      throw new Error("ID de cobranca invalido.");
    }

    const isAutorizacao = acao === "autorizar_faturamento";

    if (source === "supabase") {
      const client = getSupabaseClient();
      if (!client) {
        throw new Error("Cliente Supabase não inicializado.");
      }
      const sessionResponse = await client.auth.getSession();
      const token = sessionResponse.data.session?.access_token || "";
      if (!token) {
        throw new Error("Sessão não encontrada. Faça login novamente.");
      }

      // Chama a nova API Server-Side para validar regras de quitação de proposta
      const response = await fetch("/api/cobrancas/confirmar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          idCobranca: id,
          confirmadoPor,
          acao
        })
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 422 && data.isConferenciaBloqueada) {
          // Lançar um erro estruturado para o modal capturar
          throw { 
            name: "ConferenciaBloqueadaError", 
            message: data.error || "Confirmação bloqueada", 
            situacao: data.situacao 
          };
        }
        throw new Error(data.error || "Falha ao confirmar cobrança via API.");
      }

      if (!data.success) {
        throw new Error(data.error || "Falha lógica na confirmação da API.");
      }

      // Atualiza os dados localmente para refletir a mudança imediata na interface
      await refreshCobrancas();
      return true;
    }

    // Mock fallback (não mais usado na real, mas mantido)
    return true;
  }, [source, refreshCobrancas]);

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
        id_boleto_c6: resJson.integration?.id_boleto_c6 || null,
        // Encargos sempre explícitos: omitir estas colunas fazia o título herdar o
        // DEFAULT antigo da tabela (multa 2% / mora 0,033% ao dia) e acumular
        // encargo no vencimento, sem ninguém ter pedido.
        multa: 0,
        juros_dia: 0
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

  const alterarCondicaoCobrancaReal = useCallback(async (id: string, novoModelo: ModeloCobranca, operador: string, obs?: string) => {
    if (source !== "supabase") return { success: false, errorMessage: "Ambiente mock não suporta alteração real." };
    const client = getSupabaseClient();
    if (!client) return { success: false, errorMessage: "Cliente Supabase não inicializado." };

    try {
      const cobranca = cobrancas.find((c) => c.id === id) || cobrancasStats.find((c) => c.id === id);
      if (!cobranca) return { success: false, errorMessage: "Cobrança não encontrada no front-end." };

      const payloadUpdate: any = {
        forma_pgto: novoModelo.resultado,
        // id_modelo_cobranca: novoModelo.id, // TODO: Descomentar após migration
      };

      const { error } = await client
        .from("pagamentos_v2")
        .update(payloadUpdate)
        .eq("id", id);

      if (error) {
        return { success: false, errorMessage: error.message };
      }

      // Log no chat da proposta
      const obsSuffix = obs?.trim() ? ` Obs: ${obs.trim()}` : "";
      const mensagemChat = `Condição de faturamento alterada pelo financeiro.\nCondição anterior: ${cobranca.forma_fatu || cobranca.forma_pgto || "Não informada"}\nNova condição: ${novoModelo.resultado}${obsSuffix}`;

      await registrarMensagemSistemaProposta({
        idInt: cobranca.id_int,
        idCliente: cobranca.id_cliente,
        mensagem: mensagemChat,
        setor: "Financeiro"
      }).catch(err => console.warn("Falha ao registrar historico:", err));

      const updateList = (list: Cobranca[]) =>
        list.map((item) =>
          item.id === id
            ? { ...item, forma_pgto: novoModelo.resultado, id_modelo_cobranca: novoModelo.id }
            : item
        );
      setCobrancas(updateList);
      setCobrancasStats(updateList);

      return { success: true };
    } catch (err: any) {
      return { success: false, errorMessage: err.message || "Erro inesperado." };
    }
  }, [source, cobrancas, cobrancasStats, refreshCobrancas]);

  const reprovarCondicaoCobrancaReal = useCallback(async (id: string, motivo: string, operador: string) => {
    if (source !== "supabase") return { success: false, errorMessage: "Ambiente mock não suporta reprovação real." };
    const client = getSupabaseClient();
    if (!client) return { success: false, errorMessage: "Cliente Supabase não inicializado." };

    try {
      const cobranca = cobrancas.find((c) => c.id === id) || cobrancasStats.find((c) => c.id === id);
      if (!cobranca) return { success: false, errorMessage: "Cobrança não encontrada no front-end." };

      const motivoFinal = motivo.trim();
      if (!motivoFinal) {
        return { success: false, errorMessage: "Motivo da reprovação é obrigatório." };
      }

      // Transação única no banco (public.cobranca_reprovar_condicao, migration
      // 20260730): cancela a cobrança em pagamentos_v2 E devolve
      // propostas.status_interno para NOVO no mesmo corpo de função, além de
      // recusar propostas em status operacional protegido.
      //
      // Os dois passos precisam ser atômicos porque a trigger
      // trg_sync_status_proposta (atualizar_status_financeiro_proposta) grava
      // CANCELADO na proposta durante o cancelamento da cobrança — o retorno para
      // NOVO é a correção logo em seguida. Feitos como dois updates separados do
      // frontend, uma falha entre eles deixava a proposta CANCELADA.
      const { data, error } = await client.rpc("cobranca_reprovar_condicao", {
        p_id_pagamento: id,
        p_motivo: motivoFinal
      });

      if (error) {
        return { success: false, errorMessage: traduzirErroReprovacao(error) };
      }

      const resultado = (data || {}) as ReprovarCondicaoRpcResult;

      // A cobrança está CANCELADO no banco: reflete no estado local. obs_v2 vem da
      // RPC, que é quem compôs o histórico.
      const updateList = (list: Cobranca[]) =>
        list.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "CANCELADO" as const,
                motivo_cancela: resultado.motivo || motivoFinal,
                obs_v2: resultado.obs_v2 ?? item.obs_v2
              }
            : item
        );
      setCobrancas(updateList);
      setCobrancasStats(updateList);

      // Duplo clique: a cobrança já estava cancelada, a RPC não reprovou de novo e
      // o vendedor já foi avisado na primeira vez. Não notifica outra vez.
      if (resultado.already_cancelled) {
        return { success: true };
      }

      // Reprovação concluída com sucesso. Só a partir daqui a notificação é enviada,
      // uma única vez (uma mensagem + uma menção), em regime best-effort: a timeline
      // não pode desfazer uma reprovação já efetivada no banco.
      // O id_int vem da RPC, que o leu da própria cobrança no banco.
      const idIntProposta = resultado.id_int ?? cobranca.id_int;
      const condicaoSolicitada = cobranca.forma_pgto || cobranca.forma_fatu || "Não informada";
      const mensagemChat = `Condição de pagamento REPROVADA pelo Financeiro.\nProposta: #${idIntProposta}\nCliente: ${cobranca.cliente || "Não informado"}\nCondição solicitada: ${condicaoSolicitada}\nMotivo: ${motivoFinal}\nA cobrança atual foi cancelada e a proposta voltou para NOVO para permitir que uma nova solicitação seja criada.`;

      const chatResult = await registrarMensagemSistemaProposta({
        idInt: idIntProposta,
        idCliente: cobranca.id_cliente,
        mensagem: mensagemChat,
        setor: "Financeiro"
      }).catch((err) => {
        console.warn("Falha ao registrar historico:", err);
        return { success: false as const, data: undefined };
      });

      if (chatResult.success && chatResult.data?.id) {
        const vendedor = await resolverVendedorProposta(client, idIntProposta);
        if (vendedor) {
          const { data: sessionData } = await client.auth.getSession();
          const mentionResult = await createPropostaChatMentions(
            Number(chatResult.data.id),
            idIntProposta,
            [vendedor],
            { id: sessionData?.session?.user?.id ?? null, name: operador }
          );
          if (!mentionResult.success) {
            console.warn(
              `[CobrancasProvider] Reprovação registrada, mas falha ao notificar o vendedor da proposta #${idIntProposta}: ${mentionResult.errorMessage}`
            );
          }
        }
      } else {
        console.warn(
          `[CobrancasProvider] Reprovação registrada, mas a mensagem da timeline falhou — vendedor da proposta #${idIntProposta} não foi notificado.`
        );
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, errorMessage: err.message || "Erro inesperado." };
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
      alterarCondicaoCobrancaReal,
      reprovarCondicaoCobrancaReal,
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
      cancelarExterno,
      confirmPagamento,
      createCobranca,
      liberarParaPedido,
      refreshCobrancas,
      liberarCobrancaReal,
      voltarCobrancaFilaReal,
      emitirBoletoReal,
      alterarCondicaoCobrancaReal,
      reprovarCondicaoCobrancaReal,
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
