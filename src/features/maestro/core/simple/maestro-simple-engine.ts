/**
 * maestro-simple-engine.ts
 *
 * Orquestrador do Maestro Simple v1.
 *
 * Fluxo:
 *   query → normalizar → detectIntent → consultar ERP (se necessário)
 *         → atualizar contexto → montar resposta → registrar lastAnswer
 *
 * Sem: planner, registry, policy engine, AI gateway, response engine complexo.
 * Com: consulta read-only ao ERP via adapter server-side autenticado.
 *      Tracking de última resposta para "tem certeza?" funcionar.
 *
 * ⚠️  Este módulo é chamado EXCLUSIVAMENTE pela rota server-side /api/maestro/simple/route.ts
 *     Não deve ser importado em arquivos 'use client'.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buscarClientePorCodigo,
  buscarClientePorTexto,
  buscarEnderecosCliente,
  buscarContatosCliente,
  buscarSociosCliente,
} from './maestro-simple-clientes.server';
import {
  buscarUltimosPedidos,
  calcularFaturamentoPeriodo,
  buscarMaiorPedido,
  buscarPropostasNaoAprovadas,
  buscarUltimoOrcamento,
} from './maestro-simple-propostas.server';
import {
  calcularRecebimentoPeriodo,
  compararRecebimentoClienteMeses,
} from './maestro-simple-pagamentos.server';
import {
  buscarBoletosCliente,
} from './maestro-simple-boletos.server';
import { simularOrcamentoAvulsoDb } from './maestro-simple-produtos.server';
import { processarOrcamentoService } from './maestro-orcamento-service.server';
import { solicitarCotacaoSedex, solicitarCotacaoAzulCargo, solicitarCotacaoTransportadoras, solicitarCotacaoVeppo } from '@/features/orcamentos/services/frete.service';
import type { PropostaFrete } from '@/features/orcamentos/types';
import { resolverTermoCatalogo } from './maestro-orcamento-catalogo-oficial';
import { extrairCepDaQueryEstruturado } from './maestro-cep-resolver.server';

import { callExternalAgent } from './maestro-external-intent.server';
import { mapExternalIntentToRouterResult } from './maestro-external-intent.mapper';
import { extrairClienteDaQuery, routeToolSimple } from './maestro-v2-router';
import { processarOrcamentoAvulso } from './maestro-orcamento-engine';
import { detectIntent } from './maestro-simple-intents';
import type {
  SimpleClientContext,
  SimpleMaestroContext,
  LastAnswerRecord,
} from './maestro-simple-context';
import {
  deserializeLastAnswer,
  serializeLastAnswer,
} from './maestro-simple-context';
import {
  presenterClienteEncontrado,
  presenterClienteNaoEncontrado,
  presenterClienteMultiplosCandidatos,
  presenterClienteMatchParcial,
  presenterClienteBuscaAmpla,
  presenterClienteErroAuth,
  presenterClienteSummary,
  presenterCampoContextual,
  presenterCampoDesconhecido,
  presenterClienteConfirmation,
  presenterClienteHistoryFase2,
  presenterClienteSwitch,
  presenterClienteContacts,
  presenterClientePartners,
  presenterSemContexto,
  presenterAjuda,
  presenterFallback,
  presenterErro,
  presenterRevalidacaoFinanceira,
  presenterRevalidacaoGenerica,
  presenterClosure,
  presenterWaitUser,
  // Fase 2
  presenterSemClienteComercial,
  presenterUltimosPedidos,
  presenterFaturamentoPeriodo,
  presenterMaiorPedido,
  presenterPropostasAbertas,
  presenterBoletos,
  presenterRecebimentoPeriodo,
  presenterComparacaoRecebimentos,
  presenterAnaliseComparacao,
  presenterUltimoOrcamento,
  presenterUltimoPedido,
  presenterOrcamentoAvulso,
  presenterOrcamentoAvulsoService,
  presenterEsclarecerOrcamento,
  presenterContinuacaoOrcamento,
  presenterLimparOrcamento,
  presenterVoltarOrcamento,
  presenterPerguntarQuantidade,
  presenterRecuperacaoOrcamento,
  presenterEscolhaEndereco,
  presenterSolicitarEnderecoManual,
  // Fase 3a: Save
  presenterPerguntarSalvarCotacao,
  presenterSaveCotacaoSucesso,
  presenterCancelarSaveCotacao,
  presenterEditarAntesSave,
  presenterPropostaJaSalva,
  presenterErroSaveCotacao,
  presenterRespostaSocialCotacao,
  presenterCancelarOrcamentoAvulso,
  presenterMostrarItensOrcamento,
  type PresenterResult,
} from './maestro-simple-presenter';
import { deserializeV2Context, serializeV2Context, normalizeText } from './maestro-v2-context-manager';
import { salvarCotacaoComoPropostaReal } from './maestro-save-proposta.server';

import type { ConversationMessage, ActivityStep, ConversationContext } from '../../types';

// ─── Opções do Motor ──────────────────────────────────────────────────────

export interface SimpleEngineOptions {
  /** Supabase client autenticado via cookies — passado pela rota server-side */
  supabase: SupabaseClient;
  /** Nome do usuário logado (usado para humanização amigável) */
  userName?: string;
  /** UUID do usuário logado — usado para salvar proposta com RLS correta */
  userId?: string;
}

// ─── Resultado do Motor ───────────────────────────────────────────────────

export interface SimpleEngineResult {
  message: ConversationMessage;
  activity: ActivityStep[];
  context: ConversationContext;
  /**
   * Cliente completo com todas as relações (endereços, contatos, sócios).
   * Usado pelo Brain para garantir que os fatos enviados ao LLM batem com o card.
   * Não serializado — disponível apenas na resposta imediata da rota.
   */
  simpleClient?: SimpleClientContext | null;
}

// ─── Conversão de Contextos ───────────────────────────────────────────────

function legacyContextToSimple(ctx: ConversationContext): SimpleMaestroContext {
  if (!ctx.clientDisplayCode && !ctx.clientId) {
    return {
      activeClient: null,
      lastAnswer: deserializeLastAnswer(ctx.clientLastAnswerJson),
    };
  }
  return {
    activeClient: {
      clientDisplayCode: ctx.clientDisplayCode || ctx.clientId || '',
      clientInternalId:  ctx.clientInternalId,
      clientName:        ctx.clientName || '',
      clientFantasia:    undefined,
      clientDocument:    ctx.clientDocument ?? undefined,
      clientEmail:       ctx.clientEmail ?? undefined,
      clientPhone:       ctx.clientTelefone ?? undefined,
      clientCityUf:      ctx.clientCityUf ?? undefined,
      clientSeller:      ctx.clientVendedor ?? undefined,
      clientCredit:      ctx.clientCredito ?? undefined,
      clientCreditLimit: ctx.clientLimiteCredito ?? undefined,
      clientDataFundacao: ctx.clientDataFundacao ?? undefined,
      clientQtdPedidos:  ctx.clientQtdPedidos ?? undefined,
      clientDataUltPedido: ctx.clientDataUltPedido ?? undefined,
      riscoCredito:      ctx.clientRiscoCredito ?? undefined,
      restricao:         ctx.clientRestricao ?? undefined,
      ativo:             ctx.clientAtivo ?? undefined,
      padraoPagamento:   ctx.clientPadraoPagamento ?? undefined,
      categoria:         ctx.clientCategoria ?? undefined,
      isBonus:           ctx.clientIsBonus ?? undefined,
      percentualBonus:   ctx.clientPercentualBonus ?? undefined,
      usaPrecoFixo:      ctx.clientUsaPrecoFixo ?? undefined,
      precosFixos:       ctx.clientPrecosFixosJson ? JSON.parse(ctx.clientPrecosFixosJson) : undefined,
      enderecos:         [],
      contatos:          [],
      socios:            [],
      source:            'vw_cadastros_clientes_lista',
      queriedAt:         new Date().toISOString(),
      fontesRelacoes: {
        enderecos: 'public.enderecos',
        contatos: 'public.contatos',
        socios: 'public.clientes_socios',
      }
    },
    lastAnswer: deserializeLastAnswer(ctx.clientLastAnswerJson),
  };
}

function simpleClientToLegacyContext(
  client: SimpleClientContext,
  prevCtx: ConversationContext,
  lastAnswer?: LastAnswerRecord | null
): ConversationContext {
  return {
    ...prevCtx,
    activePlan:        undefined,
    registryResolution: undefined,
    policyDecisions:   undefined,
    toolResults:       undefined,
    // Cliente ativo
    clientId:          client.clientDisplayCode,
    clientDisplayCode: client.clientDisplayCode,
    clientInternalId:  client.clientInternalId,
    clientName:        client.clientName,
    clientDocument:    client.clientDocument,
    clientCityUf:      client.clientCityUf,
    clientTelefone:    client.clientPhone ?? null,
    clientEmail:       client.clientEmail ?? null,
    clientDataFundacao: client.clientDataFundacao ?? null,
    clientVendedor:    client.clientSeller ?? null,
    clientCredito:     client.clientCredit ?? null,
    clientLimiteCredito: client.clientCreditLimit ?? null,
    clientQtdPedidos:  client.clientQtdPedidos ?? null,
    clientDataUltPedido: client.clientDataUltPedido ?? null,
    clientPadraoPagamento: client.padraoPagamento ?? null,
    clientCategoria:   client.categoria ?? null,
    clientRiscoCredito: client.riscoCredito ?? null,
    clientRestricao:   client.restricao ?? null,
    clientAtivo:       client.ativo ?? null,
    clientIsBonus:     client.isBonus ?? null,
    clientPercentualBonus: client.percentualBonus ?? null,
    clientUsaPrecoFixo: client.usaPrecoFixo ?? null,
    clientPrecosFixosJson: client.precosFixos ? JSON.stringify(client.precosFixos) : null,
    // Última resposta (persiste entre turnos)
    clientLastAnswerJson: lastAnswer != null
      ? serializeLastAnswer(lastAnswer)
      : prevCtx.clientLastAnswerJson,
    specialist:        'comercial',
    rawQuery:          undefined,
  };
}

/** Contexto legado preservado mas com lastAnswer atualizado */
function updateLastAnswerInCtx(
  prevCtx: ConversationContext,
  lastAnswer: LastAnswerRecord | null
): ConversationContext {
  return {
    ...prevCtx,
    clientLastAnswerJson: lastAnswer != null
      ? serializeLastAnswer(lastAnswer)
      : prevCtx.clientLastAnswerJson,
  };
}

// ─── Motor Principal ──────────────────────────────────────────────────────

export async function processSimpleQuery(
  query: string,
  legacyCtx: ConversationContext,
  options: SimpleEngineOptions
): Promise<SimpleEngineResult> {
  const { supabase } = options;
  const simpleCtx = legacyContextToSimple(legacyCtx);
  const intent    = detectIntent(query);

  /**
   * Converte PresenterResult em SimpleEngineResult, aplicando lastAnswer ao contexto.
   * Se o presenter indica que houve uma nova lastAnswer, persiste no contexto.
   * Se não, mantém a lastAnswer anterior.
   */
  function toResult(
    pr: PresenterResult,
    clientForCtx?: SimpleClientContext | null
  ): SimpleEngineResult {
    const newLastAnswer = pr.lastAnswerUpdate !== undefined
      ? pr.lastAnswerUpdate
      : simpleCtx.lastAnswer; // mantém a anterior

    let newCtx: ConversationContext;
    if (clientForCtx) {
      newCtx = simpleClientToLegacyContext(clientForCtx, legacyCtx, newLastAnswer);
    } else {
      newCtx = updateLastAnswerInCtx(legacyCtx, newLastAnswer);
    }
    return {
      message:      pr.message,
      activity:     pr.activity,
      context:      newCtx,
      // Passa o cliente completo para o Brain usar fatos consistentes com o card
      simpleClient: clientForCtx ?? simpleCtx.activeClient,
    };
  }

  try {
    switch (intent.type) {

      // ── Encerramento / Agradecimento ──────────────────────────────────────────
      case 'closure': {
        return toResult(presenterClosure());
      }

      // ── Aguardo / Pausa do Usuário ──────────────────────────────────────────
      case 'wait_user': {
        return toResult(presenterWaitUser());
      }

      // ── Busca de cliente (código / doc / nome) ──────────────────────────
      case 'client_lookup':
      case 'client_switch': {
        let result;
        const busca = intent.code ?? intent.document ?? intent.name ?? '?';

        if (intent.code) {
          result = await buscarClientePorCodigo(supabase, intent.code);
        } else if (intent.document) {
          // CPF/CNPJ: busca via busca_geral — passa se é documento parcial
          result = await buscarClientePorTexto(supabase, intent.document, {
            documentPartial: intent.documentPartial,
            documentType: intent.documentType
          });
        } else if (intent.name) {
          result = await buscarClientePorTexto(supabase, intent.name);
        } else {
          // client_switch sem código especificado → pede o código
          return toResult(presenterClienteSwitch());
        }

        if (result.found && result.client) {
          const pr = presenterClienteEncontrado(result.client);
          return toResult(pr, result.client);
        }
        if (result.reason === 'auth_error') {
          return toResult(presenterClienteErroAuth());
        }
        // Busca muito ampla: pede refinamento
        if (result.reason === 'too_many') {
          return toResult(presenterClienteBuscaAmpla(result.searchTerm ?? busca));
        }
        // Múltiplos candidatos (2–6): lista numerada para o usuário escolher
        if (result.reason === 'multiple' && result.candidates?.length) {
          return toResult(presenterClienteMultiplosCandidatos(busca, result.candidates));
        }
        // Match parcial único: pede confirmação sem abrir cliente
        if (result.reason === 'partial_match' && result.candidates?.length) {
          return toResult(presenterClienteMatchParcial(busca, result.candidates[0]));
        }
        // Não encontrado: resp sem activeClient para evitar contaminação
        return toResult(presenterClienteNaoEncontrado(busca));
      }

      // ── Resumo geral do cliente ativo ─────────────────────────────────
      case 'client_summary': {
        if (!simpleCtx.activeClient) {
          return toResult(presenterSemContexto());
        }
        return toResult(presenterClienteSummary(simpleCtx));
      }

      // ── Pergunta sobre campo específico ───────────────────────────────
      case 'client_field_question': {
        if (!simpleCtx.activeClient) {
          return toResult(presenterSemContexto());
        }
        return toResult(presenterCampoContextual(intent.field, simpleCtx));
      }

      // ── Confirmação / "tem certeza?" ──────────────────────────────────
      case 'client_confirmation': {
        return toResult(presenterClienteConfirmation(simpleCtx));
      }

      // ── Campo não reconhecido mas com referência ao cliente ───────────
      case 'client_unknown_field': {
        if (!simpleCtx.activeClient) {
          return toResult(presenterSemContexto());
        }
        return toResult(presenterCampoDesconhecido(simpleCtx));
      }

      // ── Contatos do Cliente ───────────────────────────────────────────
      case 'client_contacts_question': {
        if (!simpleCtx.activeClient) {
          return toResult(presenterSemContexto());
        }
        return toResult(presenterClienteContacts(simpleCtx));
      }

      // ── Sócios e Empresas Autorizadas ─────────────────────────────────
      case 'client_partners_question': {
        if (!simpleCtx.activeClient) {
          return toResult(presenterSemContexto());
        }
        return toResult(presenterClientePartners(simpleCtx));
      }

      // ── Fase 2: Últimos pedidos (is_prd_aprovado=true) ───────────────────
      case 'client_recent_orders': {
        if (!simpleCtx.activeClient?.clientInternalId) return toResult(presenterSemClienteComercial());
        
        if (intent.periodo) {
          const rRevenue = await calcularFaturamentoPeriodo(supabase, simpleCtx.activeClient.clientInternalId, intent.periodo);
          return toResult(presenterFaturamentoPeriodo(rRevenue, simpleCtx.activeClient, intent.periodo));
        }

        const rOrders = await buscarUltimosPedidos(supabase, simpleCtx.activeClient.clientInternalId, 5);
        return toResult(presenterUltimosPedidos(rOrders, simpleCtx.activeClient));
      }

      // ── Fase 2: Faturamento / Recebimento por período (pagamentos_v2) ──
      case 'client_revenue_period': {
        if (!simpleCtx.activeClient?.clientInternalId) return toResult(presenterSemClienteComercial());
        const periodo = intent.periodo ?? { tipo: 'ultimos_30_dias', label: 'nos últimos 30 dias' };
        const rRevenue = await calcularRecebimentoPeriodo(supabase, simpleCtx.activeClient.clientInternalId, periodo);
        return toResult(presenterRecebimentoPeriodo(rRevenue, simpleCtx.activeClient, periodo));
      }

      // ── Fase 2: Pedido de maior valor ─────────────────────────────────
      case 'client_biggest_order': {
        if (!simpleCtx.activeClient?.clientInternalId) return toResult(presenterSemClienteComercial());
        const rBiggest = await buscarMaiorPedido(supabase, simpleCtx.activeClient.clientInternalId);
        return toResult(presenterMaiorPedido(rBiggest, simpleCtx.activeClient));
      }

      // ── Fase 2: Propostas não aprovadas (is_prd_aprovado=false) neste mês ──
      case 'client_open_proposals': {
        if (!simpleCtx.activeClient?.clientInternalId) return toResult(presenterSemClienteComercial());
        const rOpen = await buscarPropostasNaoAprovadas(supabase, simpleCtx.activeClient.clientInternalId);
        return toResult(presenterPropostasAbertas(rOpen, simpleCtx.activeClient));
      }

      // ── Fase 2: Boletos (em aberto / atraso / não liquidados) ─────────────
      case 'client_boletos_status': {
        if (!simpleCtx.activeClient?.clientInternalId) return toResult(presenterSemClienteComercial());
        const filtro = intent.filtro ?? 'todos';
        const rBoletos = await buscarBoletosCliente(supabase, simpleCtx.activeClient.clientInternalId, filtro);
        return toResult(presenterBoletos(rBoletos, simpleCtx.activeClient));
      }

      // ── Histórico comercial genérico (stub legado) ────────────────────────
      case 'client_history_question': {
        if (!simpleCtx.activeClient?.clientInternalId) return toResult(presenterSemClienteComercial());
        
        const norm = query.toLowerCase();
        if (norm.includes('ultimo orcamento') || norm.includes('último orçamento')) {
          const rLast = await buscarUltimoOrcamento(supabase, simpleCtx.activeClient.clientInternalId);
          return toResult(presenterUltimoOrcamento(rLast, simpleCtx.activeClient));
        }
        
        if (norm.includes('ultimo pedido') || norm.includes('último pedido')) {
          const rLast = await buscarUltimosPedidos(supabase, simpleCtx.activeClient.clientInternalId, 1);
          return toResult(presenterUltimoPedido(rLast, simpleCtx.activeClient));
        }

        return toResult(presenterClienteHistoryFase2(simpleCtx));
      }

      // ── Ajuda ─────────────────────────────────────────────────────────
      case 'help': {
        return toResult(presenterAjuda());
      }

      // ── Fallback ──────────────────────────────────────────────────────
      case 'fallback':
      default: {
        return toResult(presenterFallback(simpleCtx));
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    return toResult(presenterErro(msg));
  }
}

// ─── Wrapper com Brain (humanização LLM) ────────────────────────────────────

/**
 * Executa o motor simples e, se MAESTRO_SIMPLE_LLM_ENABLED=true,
 * passa a resposta determinística pelo brain para humanização.
 *
 * Fallback automático: se o brain falhar, o texto determinístico é usado intacto.
 * O presenter existente nunca é removido — continua sendo o fallback seguro.
 */
export async function processSimpleQueryWithBrain(
  query: string,
  legacyCtx: ConversationContext,
  options: SimpleEngineOptions
): Promise<SimpleEngineResult> {
  const { supabase } = options;
  const simpleCtx = legacyContextToSimple(legacyCtx);

  // Carrega o contexto V2 (controlado por código) do historico da conversa
  const v2Ctx = deserializeV2Context(legacyCtx.v2ContextJson);

  // --- INTERCEPTAÇÃO E EXTRAÇÃO DO CEP ANTES DE QUALQUER OUTRA ANÁLISE ---
  const cepMatch = extrairCepDaQueryEstruturado(query);
  let queryOriginal = query;
  if (cepMatch) {
    // Corta cirurgicamente a menção de CEP/endereço da query original
    query = (
      query.substring(0, cepMatch.startIndex) +
      ' ' +
      query.substring(cepMatch.endIndex)
    ).replace(/\s+/g, ' ').trim();
    
    // Atualiza o contexto se for um CEP novo ou alterado
    if (v2Ctx.budgetAddressCep !== cepMatch.cep) {
      v2Ctx.budgetAddressCep = cepMatch.cep;
      // Limpa apenas o estado de destino manual anterior
      v2Ctx.budgetAddressId = undefined;
      v2Ctx.budgetAddressFull = undefined;
      v2Ctx.budgetAddressCidade = undefined;
      v2Ctx.budgetAddressUf = undefined;
      v2Ctx.pendingFreightChoice = null;
    }
  }

  // Helper toResult idêntico para construir o resultado com novo contexto
  function toResult(
    pr: PresenterResult,
    clientForCtx?: SimpleClientContext | null
  ): SimpleEngineResult {
    const newLastAnswer = pr.lastAnswerUpdate !== undefined
      ? pr.lastAnswerUpdate
      : simpleCtx.lastAnswer;

    let newCtx: ConversationContext;
    if (clientForCtx) {
      newCtx = simpleClientToLegacyContext(clientForCtx, legacyCtx, newLastAnswer);
    } else {
      newCtx = updateLastAnswerInCtx(legacyCtx, newLastAnswer);
    }

    // Salva o estado atualizado do contexto V2
    newCtx.v2ContextJson = serializeV2Context(v2Ctx);

    return {
      message:      pr.message,
      activity:     pr.activity,
      context:      newCtx,
      simpleClient: clientForCtx ?? simpleCtx.activeClient,
    };
  }

  let deterministicResult: SimpleEngineResult | null = null;

  // 1. Tenta rodar o Tool Router V2 se habilitado
  // Ignora o roteador se for um comando imediato estático seguro (busca de cliente, troca ou ajuda)
  const initialIntent = detectIntent(query);
  const isImmediateStatic = ['client_lookup', 'client_switch', 'help', 'closure', 'wait_user'].includes(initialIntent.type);

  if (process.env.MAESTRO_V2_ENABLED === 'true') {
    try {
      let routeResult: any = { routed: false };

      // Helper para decidir se chama o External Agent
      const shouldTryExternalIntent = (q: string, isStatic: boolean, ctx: any) => {
        const compoundIntentRegex = /(?:mesm[oa]\s+(?:or[cç]amento|cota[cç][aã]o)|repete\s+(?:ess[ea]|o)|faz(?:er)?\s+(?:o|esse)?\s*mesmo|cota\s+esse\s+mesmo)/i;
        const temComposta = compoundIntentRegex.test(q);

        if (ctx.pendingAddressChoice) return false;
        if (ctx.pendingFreightChoice) return false;
        
        // Se há candidatos pendentes para confirmação, desliga roteamento externo
        if (ctx.pendingClientCandidate || ctx.pendingClientCandidates?.length) return false;

        // Se houver intenção composta explícita, ela vence o pendingSaveQuotation
        if (ctx.pendingSaveQuotation && !temComposta) return false;

        if (!isStatic) return true;
        if (temComposta) return true;
        
        return false;
      };

      const tryExternal = shouldTryExternalIntent(query, isImmediateStatic, v2Ctx);

      if (process.env.MAESTRO_EXTERNAL_INTENT_ENABLED === 'true' && tryExternal) {
        try {
          
          const payload = {
            query,
            currentDateIso: new Date().toISOString(),
            activeClient: simpleCtx.activeClient ? {
              clientInternalId: simpleCtx.activeClient.clientInternalId,
              clientDisplayCode: simpleCtx.activeClient.clientDisplayCode,
              clientName: simpleCtx.activeClient.clientName,
              clientFantasia: simpleCtx.activeClient.clientFantasia,
            } : null,
            v2Context: {
              domain: v2Ctx.domain,
              lastTool: v2Ctx.lastTool ?? null,
              hasPendingAddressChoice: !!v2Ctx.pendingAddressChoice,
              hasPendingFreightChoice: !!v2Ctx.pendingFreightChoice,
              hasPendingSaveQuotation: !!v2Ctx.pendingSaveQuotation,
              hasActiveQuote: !!v2Ctx.activeQuote,
              orcamentoItensCount: v2Ctx.orcamentoItens?.length ?? 0,
              pendingClientCandidatesCount: v2Ctx.pendingClientCandidates?.length ?? 0
            },
            lastAnswer: simpleCtx.lastAnswer ? {
              type: simpleCtx.lastAnswer.type,
              label: simpleCtx.lastAnswer.label,
              value: simpleCtx.lastAnswer.value
            } : null,
            recentTurns: [] // Mantenha simples para a POC, poderia injetar as últimas mensagens de legacyCtx
          };

          const externalResult = await callExternalAgent(payload);
          if (externalResult) {
            const mappedRoute = mapExternalIntentToRouterResult(externalResult, v2Ctx, simpleCtx.activeClient);
            if (mappedRoute?.routed) {
              routeResult = mappedRoute;
            }
          }
        } catch (extErr) {
          console.warn('[MaestroEngine] External intent layer falhou silenciosamente — usando router interno.', extErr);
        }
      }

      // [FALLBACK] Se não roteado externamente, usa o router interno V2
      if (!routeResult.routed) {
        routeResult = await routeToolSimple(query, simpleCtx.activeClient, simpleCtx.lastAnswer, v2Ctx);
      }

      if (routeResult.routed && routeResult.plan && routeResult.plan.steps.length > 0) {
        const step = routeResult.plan.steps[0];
        let pr: PresenterResult | null = null;
        let clientForCtx = simpleCtx.activeClient;

        // Proteção centralizada contra cotação avulsa com cliente não resolvido na query mista
        const clienteNaQuery = extrairClienteDaQuery(query);
        const temClienteNaoResolvido = clienteNaQuery && (
          !simpleCtx.activeClient || (
            clienteNaQuery.tipo === 'id' && simpleCtx.activeClient.clientDisplayCode !== clienteNaQuery.valor
          )
        );

        // Se há cliente indicado e não resolvido na query mista, garante que qualquer item de orçamento nela contido seja preservado
        if (temClienteNaoResolvido) {
          const engineResult = processarOrcamentoAvulso(query, { 
            itens: [], 
            pendingAmbiguity: false 
          });
          if (engineResult.items && engineResult.items.length > 0) {
            console.log(`[MaestroEngine] Preservando ${engineResult.items.length} itens de orçamento na query mista com cliente não resolvido.`);
            v2Ctx.pendingBudgetForCandidate = engineResult.items;
            v2Ctx.lastExplicitBudgetItems = engineResult.items;
            v2Ctx.orcamentoItens = engineResult.items;
            v2Ctx.domain = 'orcamento_avulso';
          }
        }

        if (temClienteNaoResolvido && ['simularOrcamentoAvulso', 'perguntar_tipo_orcamento'].includes(step.tool)) {
          console.warn(`[MaestroEngine] Interceptado roteamento incorreto para cotação avulsa com cliente indicado ("${clienteNaQuery.valor}"). Redirecionando para buscarCliente.`);
          step.tool = 'buscarCliente';
          step.params = { busca: clienteNaQuery.valor };
        }

        if (step.tool === 'cancelar_orcamento_avulso') {
          pr = presenterCancelarOrcamentoAvulso(simpleCtx.activeClient);
        }

        if (step.tool === 'mostrar_itens_orcamento_avulso') {
          pr = presenterMostrarItensOrcamento(v2Ctx.orcamentoItens || []);
        }

        // Atualizações do Gerenciador de Contexto Conversacional Geral
        v2Ctx.lastTool = step.tool;
        if (['consultarBoletos', 'consultarRecebimentoClientePeriodo', 'compararRecebimentoClienteMeses'].includes(step.tool)) {
          v2Ctx.domain = 'financeiro';
        } else if (['buscarCliente', 'consultarCampoCadastro'].includes(step.tool)) {
          // Preserva 'orcamento_avulso' se há intenção composta (itens + cliente)
          // para que o LLM seja pulado e o presenter de cotação seja exibido
          const temItensCompostos = v2Ctx.lastExplicitBudgetItems && v2Ctx.lastExplicitBudgetItems.length > 0;
          if (!(v2Ctx.domain === 'orcamento_avulso' && temItensCompostos)) {
            v2Ctx.domain = 'cliente';
          }
        } else if (['consultarPropostasCliente', 'consultarUltimoOrcamento'].includes(step.tool)) {
          v2Ctx.domain = 'proposta';
        } else if (['simularOrcamentoAvulso', 'confirmar_frete_cotacao', 'salvar_proposta_cotacao'].includes(step.tool)) {
          v2Ctx.domain = 'orcamento_avulso';
        }

        if (simpleCtx.activeClient) {
          v2Ctx.activeEntities.clientId = simpleCtx.activeClient.clientDisplayCode;
          v2Ctx.activeEntities.clientInternalId = simpleCtx.activeClient.clientInternalId;
          v2Ctx.activeEntities.clientName = simpleCtx.activeClient.clientName;
        }

        if (step.tool === 'cancelar_orcamento_avulso') {
          const { presenterCancelarOrcamentoAvulso } = require('./maestro-simple-presenter');
          pr = presenterCancelarOrcamentoAvulso(simpleCtx.activeClient);
          v2Ctx.orcamentoItens = [];
          v2Ctx.lastExplicitBudgetItems = [];
          v2Ctx.budgetAddressCep = undefined;
          v2Ctx.budgetAddressCidade = undefined;
          v2Ctx.budgetAddressUf = undefined;
          v2Ctx.budgetAddressFull = undefined;
          v2Ctx.budgetAddressId = undefined;
          v2Ctx.pendingFreightChoice = null;
          v2Ctx.pendingAddressChoice = null;
        }

        else if (step.tool === 'mostrar_itens_orcamento') {
          const { presenterMostrarItensOrcamento } = require('./maestro-simple-presenter');
          const targetItems = v2Ctx.orcamentoItens && v2Ctx.orcamentoItens.length > 0
            ? v2Ctx.orcamentoItens
            : (v2Ctx.lastSuccessfulBudgetItems || v2Ctx.lastExplicitBudgetItems || []);
          pr = presenterMostrarItensOrcamento(targetItems);
        }

        else if (step.tool === 'requisicao_nao_suportada') {
          pr = presenterFallback(simpleCtx); // Usa o fallback natural como resposta de "não sei"
        }

        else if (step.tool === 'buscarCliente') {
          const busca = step.params.busca?.trim() ?? '';
          const documentPartial = step.params.documentPartial ?? false;
          const documentType = step.params.documentType as 'cpf' | 'cnpj' | undefined;
          let lookupResult = { found: false } as any;

          // Se a busca é pelo id_cliente de um candidato pendente, desvia para a confirmação
          const numCodeBusca = /^\d+$/.test(busca) ? parseInt(busca, 10) : null;
          const ehCandidatoPendente = numCodeBusca && (
            (v2Ctx.pendingClientCandidate?.id_cliente === numCodeBusca) ||
            (v2Ctx.pendingClientCandidates?.some((c: any) => c.id_cliente === numCodeBusca))
          );

          if (ehCandidatoPendente) {
            console.log(`[MaestroEngine] buscarCliente interceptado: busca "${busca}" é o candidato pendente. Desviando para confirmar_cliente_pendente.`);
            step.tool = 'confirmar_cliente_pendente';
            step.params = { id_cliente: numCodeBusca };
          } else {
            // Limpa candidatos pendentes antigos ao iniciar uma nova busca de cliente
            v2Ctx.pendingClientCandidate = null;
            v2Ctx.pendingClientCandidates = null;
            v2Ctx.pendingClientSearchTerm = null;

            // Prioridade 1: Busca exata por ID Numérico
            if (/^\d+$/.test(busca) && !documentPartial) {
              const numCode = parseInt(busca, 10);
              if (!isNaN(numCode)) {
                const resExato = await supabase.from('vw_cadastros_clientes_lista')
                  .select('id_cliente, id_cliente_text, nome, fantasia, documento, cidade_uf, ativo, qtd_pedidos, data_ult_pedido')
                  .eq('id_cliente', numCode).limit(1);
                if (resExato.data && resExato.data.length > 0) {
                  lookupResult = await buscarClientePorCodigo(supabase, numCode.toString());
                }
              }
            }

            // Prioridade 2: Texto livre (nome, CPF/CNPJ parcial)
            if (!lookupResult.found) {
              lookupResult = await buscarClientePorTexto(supabase, busca, { documentPartial, documentType });
            }

            // Itens de orçamento pendentes no contexto conversacional antes de qualquer limpeza
            const itensDePreservacao = v2Ctx.pendingBudgetForCandidate;

            // Itens da mensagem atual (somente os gerados por esta interação)
            const itensDaMensagemAtual =
              (v2Ctx.lastExplicitBudgetItems && v2Ctx.lastExplicitBudgetItems.length > 0)
                ? v2Ctx.lastExplicitBudgetItems
                : null;

            if (lookupResult.found && lookupResult.client) {
              // Limpar candidatos pendentes ao encontrar com confiança
              v2Ctx.pendingClientCandidate = null;
              v2Ctx.pendingClientCandidates = null;
              v2Ctx.pendingClientSearchTerm = null;
              v2Ctx.pendingBudgetForCandidate = null;
              // Limpar endereço se o cliente mudou
              const anteriorId = v2Ctx.activeEntities.clientInternalId;
              if (anteriorId && anteriorId !== lookupResult.client.clientInternalId) {
                console.log(`[MaestroEngine] buscarCliente: cliente mudou ${anteriorId} -> ${lookupResult.client.clientInternalId} — limpando endereço.`);
                v2Ctx.budgetAddressId = undefined;
                v2Ctx.budgetAddressFull = undefined;
                v2Ctx.budgetAddressCep = undefined;
                v2Ctx.budgetAddressCidade = undefined;
                v2Ctx.budgetAddressUf = undefined;
                v2Ctx.pendingAddressChoice = null;
                v2Ctx.activeQuote = null; // limpa cotação ativa ao trocar cliente
                v2Ctx.pendingSaveQuotation = null; // limpa save pendente do cliente antigo
                v2Ctx.pendingFreightChoice = null; // limpa frete pendente do cliente antigo
              }
              clientForCtx = lookupResult.client;

              // ── INTENÇÃO COMPOSTA: cliente + itens na mesma mensagem ──────────────
              // Se há itens salvos da mensagem atual, ou itens preservados do 'mesmo orçamento', ou itens pendentes salvos no contexto, prosseguir para cotação automaticamente.
              const itensCompostos = itensDaMensagemAtual 
                || itensDePreservacao 
                || (v2Ctx.orcamentoItens && v2Ctx.orcamentoItens.length > 0 ? v2Ctx.orcamentoItens : null);

              if (itensCompostos && itensCompostos.length > 0) {
                console.log(`[MaestroEngine] buscarCliente: intenção composta detectada. Cliente ${lookupResult.client.clientName} + ${itensCompostos.length} itens. Prosseguindo para cotação.`);
                v2Ctx.orcamentoItens = itensCompostos;
                v2Ctx.domain = 'orcamento_avulso';
                v2Ctx.lastExplicitBudgetItems = itensCompostos;
                v2Ctx.pendingBudgetForCandidate = null; // limpa a pendência
                v2Ctx.pendingClientCandidate = null;
                v2Ctx.pendingClientCandidates = null;
                v2Ctx.pendingClientSearchTerm = null;

                // Carregar endereços do cliente para mostrar lista de escolha
                const idClienteCompostos = lookupResult.client.clientInternalId;
                const { data: enderecosCompostos } = await supabase
                  .from('enderecos')
                  .select('id,id_cliente,tipo_endereco,cep,endereco,numero,complemento,bairro,cidade,uf')
                  .eq('id_cliente', idClienteCompostos)
                  .limit(10);

                const isEnderecoUtilizavel = (e: any) => {
                  return !!(e.cep && e.cep.trim().length >= 8 &&
                         e.cidade && e.cidade.trim().length > 0 &&
                         e.uf && e.uf.trim().length > 0);
                };

                const enderecosValidos = (enderecosCompostos || []).filter(isEnderecoUtilizavel);

                if (enderecosValidos.length === 1) {
                  const end = enderecosValidos[0];
                  v2Ctx.budgetAddressId = end.id;
                  v2Ctx.budgetAddressFull = `${end.endereco}, ${end.numero} - ${end.bairro}, ${end.cidade}/${end.uf}`;
                  v2Ctx.budgetAddressCep = end.cep;
                  v2Ctx.budgetAddressCidade = end.cidade;
                  v2Ctx.budgetAddressUf = end.uf;
                  v2Ctx.pendingAddressChoice = null;

                  // Transiciona para a simulação do orçamento no mesmo turno
                  step.tool = 'simularOrcamentoAvulso';
                  step.params = {
                    itens: v2Ctx.orcamentoItens && v2Ctx.orcamentoItens.length > 0
                      ? v2Ctx.orcamentoItens
                      : (v2Ctx.pendingBudgetForCandidate || v2Ctx.lastSuccessfulBudgetItems || v2Ctx.lastExplicitBudgetItems || [])
                  };
                  v2Ctx.pendingBudgetForCandidate = null;
                } else if (enderecosValidos.length > 1) {
                  // Tem múltiplos endereços válidos — mostrar lista para escolha
                  v2Ctx.pendingAddressChoice = {
                    clientId: idClienteCompostos,
                    addresses: enderecosValidos,
                  };
                  pr = presenterEscolhaEndereco(v2Ctx.pendingAddressChoice);
                } else {
                  // Sem endereços válidos cadastrados — pedir manual
                  pr = presenterSolicitarEnderecoManual(lookupResult.client);
                }
              } else {
                pr = presenterClienteEncontrado(lookupResult.client);
              }
            } else if (lookupResult.reason === 'auth_error') {
              pr = presenterClienteErroAuth();
            } else if (lookupResult.reason === 'too_many') {
              v2Ctx.pendingClientCandidate = null;
              v2Ctx.pendingClientCandidates = null;
              v2Ctx.pendingClientSearchTerm = busca;
              const candItemsTooMany = itensDaMensagemAtual || (v2Ctx.orcamentoItens && v2Ctx.orcamentoItens.length > 0 ? v2Ctx.orcamentoItens : null);
              if (candItemsTooMany) v2Ctx.pendingBudgetForCandidate = candItemsTooMany;
              pr = presenterClienteBuscaAmpla(lookupResult.searchTerm ?? busca, candItemsTooMany);
            } else if (lookupResult.reason === 'multiple' && lookupResult.candidates) {
              // 2-6 candidatos: grava lista para confirmação por código
              v2Ctx.pendingClientCandidates = lookupResult.candidates.map((c: any) => ({
                id_cliente: c.id_cliente,
                nome: c.nome ?? '',
                fantasia: c.fantasia ?? '',
                documento: c.documento ?? '',
                cidade_uf: c.cidade_uf ?? '',
              }));
              v2Ctx.pendingClientCandidate = null;
              v2Ctx.pendingClientSearchTerm = busca;
              const candItemsMulti = itensDaMensagemAtual || (v2Ctx.orcamentoItens && v2Ctx.orcamentoItens.length > 0 ? v2Ctx.orcamentoItens : null);
              if (candItemsMulti) v2Ctx.pendingBudgetForCandidate = candItemsMulti;
              pr = presenterClienteMultiplosCandidatos(busca, lookupResult.candidates);
            } else if (lookupResult.reason === 'partial_match' && lookupResult.candidates?.length) {
              const cand = lookupResult.candidates[0];
              // Candidato único: grava para confirmação por 'sim'/'esse'/código
              v2Ctx.pendingClientCandidate = {
                id_cliente: cand.id_cliente,
                nome: cand.nome ?? '',
                fantasia: cand.fantasia ?? '',
                documento: cand.documento ?? '',
                cidade_uf: cand.cidade_uf ?? '',
              };
              v2Ctx.pendingClientCandidates = null;
              v2Ctx.pendingClientSearchTerm = busca;
              const candItemsPartial = itensDaMensagemAtual || (v2Ctx.orcamentoItens && v2Ctx.orcamentoItens.length > 0 ? v2Ctx.orcamentoItens : null);
              if (candItemsPartial) v2Ctx.pendingBudgetForCandidate = candItemsPartial;
              pr = presenterClienteMatchParcial(busca, cand);
            } else {
              // Não encontrado: limpa, não usa cliente ativo anterior
              v2Ctx.pendingClientCandidate = null;
              v2Ctx.pendingClientCandidates = null;
              v2Ctx.pendingClientSearchTerm = null;
              pr = presenterClienteNaoEncontrado(busca);
            }
          }
        }

        else if ((step.tool as string) === 'consultar_cotacao_ativa') {
          const quote = v2Ctx.activeQuote;
          if (!quote) {
            pr = {
              message: {
                id: 'maestro-msg-' + Date.now(),
                role: 'maestro',
                content: 'Não há cotação ativa no momento. Gere uma cotação primeiro.',
                contentType: 'text',
                specialist: 'comercial',
                timestamp: new Date().toISOString(),
                status: 'completed',
              },
              activity: [],
              lastAnswerUpdate: null,
            };
          } else {
            const { presenterConsultarCotacaoAtiva } = await import('./maestro-simple-presenter');
            pr = presenterConsultarCotacaoAtiva(quote, step.params.query ?? 'resumo');
          }
        }

        else if ((step.tool as string) === 'trocar_frete_cotacao_ativa') {
          const quote = v2Ctx.activeQuote;
          if (!quote || quote.status === 'salva') {
            pr = {
              message: {
                id: 'maestro-msg-' + Date.now(),
                role: 'maestro',
                content: 'Não é possível trocar frete neste momento. A cotação já foi salva ou não existe.',
                contentType: 'text',
                specialist: 'comercial',
                timestamp: new Date().toISOString(),
                status: 'completed',
                confidence: 'medium',
              },
              activity: [],
              lastAnswerUpdate: null,
            };
          } else {
            const freteId = step.params.freteId;
            const novoFrete = quote.fretes.find(f => f.id === freteId);
            if (!novoFrete) {
              pr = {
                message: {
                  id: 'maestro-msg-' + Date.now(),
                  role: 'maestro',
                  content: 'Frete não encontrado. As opções disponíveis são: ' + quote.fretes.map(f => f.transportadora).join(', '),
                  contentType: 'text',
                  specialist: 'comercial',
                  timestamp: new Date().toISOString(),
                  status: 'completed',
                  confidence: 'medium',
                },
                activity: [],
                lastAnswerUpdate: null,
              };
            } else {
              quote.freteSelecionado = novoFrete;
              const baseParaTotal = quote.subtotalLiquido ?? quote.subtotalProdutos;
              quote.total = baseParaTotal + novoFrete.valor;
              if (v2Ctx.pendingSaveQuotation && !v2Ctx.pendingSaveQuotation.savedIdInt) {
                v2Ctx.pendingSaveQuotation.freteEscolhido = { ...novoFrete } as any;
                v2Ctx.pendingSaveQuotation.total = quote.total;
              }
              // Mostra o card formatado com o novo frete
              const { presenterFreteConfirmado } = await import('./maestro-simple-presenter');
              pr = presenterFreteConfirmado(quote);
              const { presenterPerguntarSalvarCotacao: perguntarSave3 } = await import('./maestro-simple-presenter');
              if (v2Ctx.pendingSaveQuotation) {
                const prSave3 = perguntarSave3(v2Ctx.pendingSaveQuotation);
                pr.message.content = pr.message.content + '\n\n' + prSave3.message.content;
                pr.message.actions = prSave3.message.actions;
              }
            }
          }
        }

        else if ((step.tool as string) === 'exibir_lista_fretes') {
          const quote = v2Ctx.activeQuote;
          if (!quote || quote.fretes.length === 0) {
            pr = {
              message: { id: 'maestro-msg-' + Date.now(), role: 'maestro', content: 'Não há opções de frete na cotação ativa.', contentType: 'text', specialist: 'comercial', timestamp: new Date().toISOString(), status: 'completed', confidence: 'medium' },
              activity: [],
            };
          } else {
            // Re-ativa pendingFreightChoice e exibe lista numerada
            v2Ctx.pendingFreightChoice = {
              clientInternalId: quote.clientInternalId,
              clientName: quote.clientName,
              enderecoId: quote.enderecoId,
              enderecoFull: quote.enderecoFull,
              cep: quote.cep ?? '',
              cidade: quote.cidade,
              uf: quote.uf,
              itens: quote.itens,
              subtotal: quote.subtotalProdutos,
              pesoTotalGramas: quote.pesoTotalGramas,
              fretes: quote.fretes as any[],
            };
            const { presenterEscolhaTransportadora } = await import('./maestro-simple-presenter');
            pr = presenterEscolhaTransportadora(quote.clientName, quote.enderecoFull, quote.itens, quote.subtotalProdutos, quote.fretes as any[]);
          }
        }

        else if ((step.tool as string) === 'frete_nao_disponivel') {
          const quote = v2Ctx.activeQuote;
          const mentioned = step.params.mentioned ?? '';
          const { presenterFreteNaoDisponivel } = await import('./maestro-simple-presenter');
          pr = presenterFreteNaoDisponivel(quote?.fretes ?? [], mentioned);
        }

        else if ((step.tool as string) === 'iniciar_troca_endereco_cotacao') {
          const quote = v2Ctx.activeQuote;
          if (!quote || !quote.clientInternalId) {
            pr = {
              message: {
                id: 'maestro-msg-' + Date.now(),
                role: 'maestro',
                content: 'Não encontrei cotação ativa para trocar o endereço.',
                contentType: 'text',
                specialist: 'comercial',
                timestamp: new Date().toISOString(),
                status: 'completed',
                confidence: 'medium',
              },
              activity: [],
              lastAnswerUpdate: null,
            };
          } else {
            const { data: enderecos } = await supabase
              .from('enderecos')
              .select('id,id_cliente,tipo_endereco,cep,endereco,numero,complemento,bairro,cidade,uf')
              .eq('id_cliente', quote.clientInternalId)
              .limit(10);
            if (enderecos && enderecos.length > 0) {
              // Marca que a troca de endereço é dentro de uma cotação ativa
              v2Ctx.pendingAddressChoice = {
                clientId: quote.clientInternalId,
                addresses: enderecos,
              };
              v2Ctx.lastExplicitBudgetItems = quote.itens.map(i => ({
                quantidade: i.quantidade,
                termo: i.nome,
              }));
              v2Ctx.domain = 'orcamento_avulso';
              pr = presenterEscolhaEndereco(v2Ctx.pendingAddressChoice);
            } else {
              pr = {
                message: {
                  id: 'maestro-msg-' + Date.now(),
                  role: 'maestro',
                  content: 'Não encontrei endereços cadastrados para este cliente.',
                  contentType: 'text',
                  specialist: 'comercial',
                  timestamp: new Date().toISOString(),
                  status: 'completed',
                  confidence: 'medium',
                },
                activity: [],
                lastAnswerUpdate: null,
              };
            }
          }
        }

        if ((step.tool as string) === 'confirmar_cliente_pendente') {
          const idCliente = step.params.id_cliente;
          if (!idCliente) {
            pr = presenterClienteNaoEncontrado('candidato pendente');
          } else {
            const confirmedResult = await buscarClientePorCodigo(supabase, String(idCliente));
            if (confirmedResult.found && confirmedResult.client) {
              const novoCliente = confirmedResult.client;
              // Limpar endereço se o cliente mudou
              const anteriorId = v2Ctx.activeEntities.clientInternalId;
              if (anteriorId && anteriorId !== novoCliente.clientInternalId) {
                console.log(`[MaestroEngine] confirmar_cliente_pendente: ${anteriorId} -> ${novoCliente.clientInternalId} — limpando endereço.`);
                v2Ctx.budgetAddressId = undefined;
                v2Ctx.budgetAddressFull = undefined;
                v2Ctx.budgetAddressCep = undefined;
                v2Ctx.budgetAddressCidade = undefined;
                v2Ctx.budgetAddressUf = undefined;
                v2Ctx.pendingAddressChoice = null;
              }
              const itensPendentes = v2Ctx.pendingBudgetForCandidate;
              v2Ctx.pendingClientCandidate = null;
              v2Ctx.pendingClientCandidates = null;
              v2Ctx.pendingClientSearchTerm = null;
              v2Ctx.pendingBudgetForCandidate = null;

              if (itensPendentes && itensPendentes.length > 0) {
                v2Ctx.orcamentoItens = itensPendentes;
                v2Ctx.domain = 'orcamento_avulso';
                v2Ctx.lastExplicitBudgetItems = itensPendentes;
                
                // Carregar endereços do cliente para mostrar lista de escolha
                const idClienteCompostos = novoCliente.clientInternalId;
                const { data: enderecosCompostos } = await supabase
                  .from('enderecos')
                  .select('id,id_cliente,tipo_endereco,cep,endereco,numero,complemento,bairro,cidade,uf')
                  .eq('id_cliente', idClienteCompostos)
                  .limit(10);

                const isEnderecoUtilizavel = (e: any) => {
                  return !!(e.cep && e.cep.trim().length >= 8 &&
                         e.cidade && e.cidade.trim().length > 0 &&
                         e.uf && e.uf.trim().length > 0);
                };

                const enderecosValidos = (enderecosCompostos || []).filter(isEnderecoUtilizavel);

                if (enderecosValidos.length === 1) {
                  const end = enderecosValidos[0];
                  v2Ctx.budgetAddressId = end.id;
                  v2Ctx.budgetAddressFull = `${end.endereco}, ${end.numero} - ${end.bairro}, ${end.cidade}/${end.uf}`;
                  v2Ctx.budgetAddressCep = end.cep;
                  v2Ctx.budgetAddressCidade = end.cidade;
                  v2Ctx.budgetAddressUf = end.uf;
                  v2Ctx.pendingAddressChoice = null;

                  // Transiciona para a simulação do orçamento no mesmo turno
                  step.tool = 'simularOrcamentoAvulso';
                  step.params = {
                    itens: v2Ctx.orcamentoItens && v2Ctx.orcamentoItens.length > 0
                      ? v2Ctx.orcamentoItens
                      : (v2Ctx.pendingBudgetForCandidate || v2Ctx.lastSuccessfulBudgetItems || v2Ctx.lastExplicitBudgetItems || [])
                  };
                  v2Ctx.pendingBudgetForCandidate = null;
                } else if (enderecosValidos.length > 1) {
                  v2Ctx.pendingAddressChoice = {
                    clientId: idClienteCompostos || 0,
                    addresses: enderecosValidos,
                  };
                  pr = presenterEscolhaEndereco(v2Ctx.pendingAddressChoice);
                } else {
                  pr = presenterSolicitarEnderecoManual(novoCliente);
                }
              } else {
                pr = presenterClienteEncontrado(novoCliente);
              }
              clientForCtx = novoCliente;
            } else {
              pr = presenterClienteNaoEncontrado(String(idCliente));
            }
          }
        }

        else if (step.tool === 'consultarCampoCadastro') {
          if (!simpleCtx.activeClient) {
            pr = presenterSemContexto();
          } else {
            const campo = step.params.campo;
            const idCliente = simpleCtx.activeClient.clientInternalId;
            
            console.log(`[MaestroEngine] consultarCampoCadastro executado. Campo: "${campo}", Cliente: "${simpleCtx.activeClient.clientName}" (${idCliente})`);
            
            if (idCliente) {
              try {
                if (campo === 'enderecos' && (!simpleCtx.activeClient.enderecos || simpleCtx.activeClient.enderecos.length === 0)) {
                  console.log(`[MaestroEngine] Carregando endereços do cliente ${idCliente} sob demanda.`);
                  const enderecos = await buscarEnderecosCliente(supabase, idCliente);
                  simpleCtx.activeClient.enderecos = enderecos;
                  console.log(`- Registros retornados: ${enderecos.length}`);
                } else if (campo === 'contatos' && (!simpleCtx.activeClient.contatos || simpleCtx.activeClient.contatos.length === 0)) {
                  console.log(`[MaestroEngine] Carregando contatos do cliente ${idCliente} sob demanda.`);
                  const contatos = await buscarContatosCliente(supabase, idCliente);
                  simpleCtx.activeClient.contatos = contatos;
                  console.log(`- Registros retornados: ${contatos.length}`);
                } else if (campo === 'socios' && (!simpleCtx.activeClient.socios || simpleCtx.activeClient.socios.length === 0)) {
                  console.log(`[MaestroEngine] Carregando sócios do cliente ${idCliente} sob demanda.`);
                  const socios = await buscarSociosCliente(supabase, idCliente);
                  simpleCtx.activeClient.socios = socios;
                  console.log(`- Registros retornados: ${socios.length}`);
                }
              } catch (err) {
                console.error(`[MaestroEngine] Erro ao carregar relacionamento "${campo}" sob demanda:`, err);
                (simpleCtx.activeClient as any).erroCarregamentoRelacao = true;
              }
            }
            
            pr = presenterCampoContextual(campo, simpleCtx);
          }
        }

        else if (step.tool === 'consultarBoletos') {
          if (!simpleCtx.activeClient?.clientInternalId) {
            pr = presenterSemClienteComercial();
          } else {
            const rawFiltro = step.params.filtro ?? 'todos';
            const mappedFiltro: 'todos' | 'atraso' | 'aberto' | 'nao_liquidado' =
              rawFiltro === 'atrasados'
                ? 'atraso'
                : rawFiltro === 'abertos'
                  ? 'aberto'
                  : rawFiltro === 'todos'
                    ? 'todos'
                    : 'todos';
            const rBoletos = await buscarBoletosCliente(supabase, simpleCtx.activeClient.clientInternalId, mappedFiltro);
            pr = presenterBoletos(rBoletos, simpleCtx.activeClient);
          }
        }

        else if ((step.tool as string) === 'consultarUltimosPedidos') {
          if (!simpleCtx.activeClient?.clientInternalId) {
            pr = presenterSemClienteComercial();
          } else {
            const limite = (step.params as any).limite ?? 5;
            const rOrders = await buscarUltimosPedidos(supabase, simpleCtx.activeClient.clientInternalId, limite);
            pr = presenterUltimosPedidos(rOrders, simpleCtx.activeClient);
          }
        }

        else if ((step.tool as string) === 'consultarMaiorPedido') {
          if (!simpleCtx.activeClient?.clientInternalId) {
            pr = presenterSemClienteComercial();
          } else {
            const rBiggest = await buscarMaiorPedido(supabase, simpleCtx.activeClient.clientInternalId);
            pr = presenterMaiorPedido(rBiggest, simpleCtx.activeClient);
          }
        }

        else if ((step.tool as string) === 'consultarPropostasNaoAprovadas') {
          if (!simpleCtx.activeClient?.clientInternalId) {
            pr = presenterSemClienteComercial();
          } else {
            const rOpen = await buscarPropostasNaoAprovadas(supabase, simpleCtx.activeClient.clientInternalId);
            pr = presenterPropostasAbertas(rOpen, simpleCtx.activeClient);
          }
        }

        else if (step.tool === 'consultarUltimoOrcamento') {
          if (!simpleCtx.activeClient?.clientInternalId) {
            pr = presenterSemClienteComercial();
          } else {
            const rLast = await buscarUltimoOrcamento(supabase, simpleCtx.activeClient.clientInternalId);
            pr = presenterUltimoOrcamento(rLast, simpleCtx.activeClient);
          }
        }

        else if ((step.tool as string) === 'consultarUltimoPedido') {
          if (!simpleCtx.activeClient?.clientInternalId) {
            pr = presenterSemClienteComercial();
          } else {
            const rLast = await buscarUltimosPedidos(supabase, simpleCtx.activeClient.clientInternalId, 1);
            pr = presenterUltimoPedido(rLast, simpleCtx.activeClient);
          }
        }

        // Permite transição contínua para simularOrcamentoAvulso no mesmo turno
        if (step.tool === 'simularOrcamentoAvulso') {
          if (step.params.addressIndex && v2Ctx.pendingAddressChoice) {
            const chosenIndex = step.params.addressIndex - 1;
            const chosenAddress = v2Ctx.pendingAddressChoice.addresses[chosenIndex];
            if (chosenAddress) {
              v2Ctx.budgetAddressId = chosenAddress.id;
              v2Ctx.budgetAddressFull = `${chosenAddress.endereco}, ${chosenAddress.numero} - ${chosenAddress.bairro}, ${chosenAddress.cidade}/${chosenAddress.uf}`;
              v2Ctx.budgetAddressCep = chosenAddress.cep;
              v2Ctx.budgetAddressCidade = chosenAddress.cidade;
              v2Ctx.budgetAddressUf = chosenAddress.uf;
            }
            v2Ctx.pendingAddressChoice = null;
          }

          // Resolução assíncrona do CEP manual se estiver presente mas faltarem dados de localidade
          let erroCepMensagem: string | undefined;
          if (v2Ctx.budgetAddressCep && (!v2Ctx.budgetAddressCidade || !v2Ctx.budgetAddressUf)) {
            const { resolverCepViaCep } = require('./maestro-cep-resolver.server');
            const resCep = await resolverCepViaCep(v2Ctx.budgetAddressCep);
            if (resCep.valido) {
              v2Ctx.budgetAddressCidade = resCep.cidade;
              v2Ctx.budgetAddressUf = resCep.uf;
              v2Ctx.budgetAddressFull = `CEP: ${v2Ctx.budgetAddressCep} - ${resCep.cidade}/${resCep.uf}`;
            } else {
              if (resCep.erroType === 'inexistente') {
                pr = {
                  message: {
                    id: 'maestro-msg-' + Date.now(),
                    role: 'maestro',
                    content: `O CEP ${v2Ctx.budgetAddressCep} não foi localizado. Por favor, verifique se digitou o CEP correto e tente novamente.`,
                    contentType: 'text',
                    specialist: 'comercial',
                    timestamp: new Date().toISOString(),
                    status: 'completed',
                    confidence: 'high'
                  },
                  activity: []
                };
                return toResult(pr);
              } else {
                erroCepMensagem = `⚠️ **Aviso:** Não foi possível consultar a localidade do CEP no ViaCEP (${resCep.mensagem || 'Serviço temporariamente indisponível'}). O cálculo de transportadoras locais foi pulado.`;
              }
            }
          }

          const itens = step.params.itens || v2Ctx.orcamentoItens;
          if (!itens || itens.length === 0) {
            pr = {
              message: {
                id: 'maestro-msg-' + Date.now(),
                role: 'maestro',
                content: `Não encontrei nenhum produto no seu orçamento atual. Por favor, me informe quais produtos você deseja cotar (ex: "5000 triband").`,
                contentType: 'text',
                specialist: 'comercial',
                timestamp: new Date().toISOString(),
                status: 'completed',
                confidence: 'high'
              },
              activity: []
            };
          } else {
            // ─── CAMINHO NOVO: usa processarOrcamentoService (catálogo oficial + banco) ───
            // NUNCA usa simularOrcamentoAvulsoDb para o fluxo principal do chat
            const orcamentoState = {
              itens: (v2Ctx.orcamentoItens || []).map(i => ({ quantidade: i.quantidade, termo: i.termo })),
              pendingAmbiguity: !!v2Ctx.pendingProductResolution || !!v2Ctx.pendingAmbiguousItem,
              previousItens: (v2Ctx.previousOrcamentoItens || []).map(i => ({ quantidade: i.quantidade, termo: i.termo })),
            };

            const serviceResult = await processarOrcamentoService({
              query: itens && itens.length > 0
                ? `${itens.map((i: any) => `${i.quantidade} ${i.termo}`).join(' + ')}`
                : 'restaura',
              state: { ...orcamentoState, itens: itens.map((i: any) => ({ quantidade: i.quantidade, termo: i.termo })) },
              supabase,
              clientContext: simpleCtx.activeClient || undefined,
              forceRecalculate: true
            });

            // Atualiza contexto com o estado resolvido pelo service
            if (serviceResult.action !== 'NONE' && serviceResult.action !== 'ERROR') {
              v2Ctx.previousOrcamentoItens = JSON.parse(JSON.stringify(v2Ctx.orcamentoItens || []));
              v2Ctx.orcamentoItens = serviceResult.items.map(i => ({
                quantidade: i.quantidade,
                termo: i.termo,
                produtoId: i.produtoId,
                precoUnitario: i.precoUnitario,
                pesoUnitario: i.pesoUnitario,
                valorFixo: i.valorFixo
              }));
              v2Ctx.lastSuccessfulBudgetItems = serviceResult.errors.length === 0
                ? JSON.parse(JSON.stringify(v2Ctx.orcamentoItens))
                : v2Ctx.lastSuccessfulBudgetItems;
              v2Ctx.pendingProductResolution = null;
              v2Ctx.pendingAmbiguousItem = null;

              if (serviceResult.temPendencia) {
                const itemAmbiguo = serviceResult.resolucao.find(r => r.status === 'ambiguo');
                if (itemAmbiguo) {
                  v2Ctx.pendingAmbiguousItem = {
                    lastRequestedQuantity: itemAmbiguo.quantidade,
                    lastRequestedTerm: itemAmbiguo.termo,
                    options: (itemAmbiguo.candidatos || []).map((c, i) => ({
                      index: i + 1,
                      id: c.id_produto,
                      name: c.descricao
                    }))
                  };
                }
              } else {
                const itemFailed = serviceResult.resolucao.find(r => r.status !== 'sucesso');
                if (itemFailed) {
                  v2Ctx.pendingProductResolution = {
                    lastRequestedQuantity: itemFailed.quantidade,
                    lastRequestedTerm: itemFailed.termo,
                    status: itemFailed.status as any
                  };
                }
              }
            }

            console.log('====== [MaestroEngine] DEV LOG ======');
            console.log(`- Domínio ativo: "${v2Ctx.domain}"`);
            console.log(`- Handler usado: simularOrcamentoAvulso (via SERVICE NOVO)`);
            console.log(`- itens no contexto: ${JSON.stringify(v2Ctx.orcamentoItens)}`);
            console.log('=====================================');

            // ── NOVA LÓGICA DE ENRIQUECIMENTO ──
            if (!clientForCtx && (v2Ctx.activeEntities?.clientInternalId || v2Ctx.activeEntities?.clientSearchName)) {
              let resolveResult = { found: false } as any;
              
              if (v2Ctx.activeEntities.clientInternalId) {
                resolveResult = await buscarClientePorCodigo(supabase, String(v2Ctx.activeEntities.clientInternalId));
              }
              
              if (!resolveResult.found && v2Ctx.activeEntities.clientSearchName) {
                // Faremos uma consulta manual rápida para checar ambiguidade, pois buscarClientePorTexto sempre pega o 1º
                const termo = normalizeText(v2Ctx.activeEntities.clientSearchName);
                if (termo && termo.length >= 3) {
                  const { data: rows } = await supabase
                    .from('vw_cadastros_clientes_lista')
                    .select('id_cliente, id_cliente_text, nome, fantasia, documento, cidade_uf, ativo, qtd_pedidos, data_ult_pedido')
                    .ilike('busca_geral', `%${termo}%`)
                    .order('id_cliente', { ascending: false })
                    .limit(2);
                    
                  if (rows && rows.length > 1) {
                    resolveResult = { found: false, reason: 'multiple_found', candidates: rows };
                  } else if (rows && rows.length === 1) {
                    resolveResult = await buscarClientePorCodigo(supabase, String(rows[0].id_cliente));
                  }
                }
              }

              if (resolveResult.found && resolveResult.client) {
                clientForCtx = resolveResult.client;
                // Preenche com o ID interno VERDADEIRO (Integer PK) e nome real
                v2Ctx.activeEntities!.clientInternalId = clientForCtx!.clientInternalId;
                v2Ctx.activeEntities!.clientName = clientForCtx!.clientName;
                v2Ctx.activeEntities!.clientId = clientForCtx!.clientDisplayCode;
              } else if (resolveResult.reason === 'multiple_found') {
                v2Ctx.domain = 'cliente';
                // Fallback simplificado pedindo para o usuário especificar o código
                pr = {
                  message: {
                    id: 'maestro-msg-' + Date.now(),
                    role: 'maestro',
                    content: `Encontrei mais de um cliente chamado "${v2Ctx.activeEntities.clientSearchName}". Por favor, me informe o código ou CNPJ exato do cliente para a cotação.`,
                    contentType: 'text',
                    specialist: 'comercial',
                    timestamp: new Date().toISOString(),
                    status: 'completed',
                    confidence: 'high'
                  },
                  activity: []
                };
                return toResult(pr);
              }
            }

            // Se o cliente mudou em relação ao que estava ativo no início da sessão,
            // limpa apenas os campos de CEP manual e frete anterior
            if (clientForCtx && (!simpleCtx.activeClient || simpleCtx.activeClient.clientInternalId !== clientForCtx.clientInternalId)) {
              console.log('[MaestroEngine] Cliente alterado na sessão. Limpando dados de frete manual anteriores.');
              v2Ctx.budgetAddressCep = undefined;
              v2Ctx.budgetAddressCidade = undefined;
              v2Ctx.budgetAddressUf = undefined;
              v2Ctx.budgetAddressFull = undefined;
              v2Ctx.budgetAddressId = undefined;
              v2Ctx.pendingFreightChoice = null;
              v2Ctx.pendingAddressChoice = null;
            }

            // Verifica necessidade de endereço
            let aguardandoEndereco = false;
            let solicitandoEnderecoManual = false;

            // Validação obrigatória de endereço por cliente
            if (v2Ctx.budgetAddressId && clientForCtx?.clientInternalId) {
              const { data: validAddr } = await supabase
                .from('enderecos')
                .select('id_cliente')
                .eq('id', v2Ctx.budgetAddressId)
                .single();

              if (validAddr && validAddr.id_cliente !== clientForCtx.clientInternalId) {
                console.log(`[MaestroEngine] INCONSISTÊNCIA DE ENDEREÇO DETECTADA: endereço ${v2Ctx.budgetAddressId} é de outro cliente. Limpando...`);
                v2Ctx.budgetAddressId = undefined;
                v2Ctx.budgetAddressFull = undefined;
                v2Ctx.budgetAddressCep = undefined;
                v2Ctx.budgetAddressCidade = undefined;
                v2Ctx.budgetAddressUf = undefined;
                v2Ctx.pendingFreightChoice = null;
              }
            }

            if (clientForCtx?.clientInternalId && !v2Ctx.budgetAddressId && !v2Ctx.pendingAddressChoice) {
              const { data: enderecos } = await supabase
                .from('enderecos')
                .select('id,id_cliente,tipo_endereco,cep,endereco,numero,complemento,bairro,cidade,uf')
                .eq('id_cliente', v2Ctx.activeEntities.clientInternalId)
                .limit(10);
              
              const isEnderecoUtilizavel = (e: any) => {
                return !!(e.cep && e.cep.trim().length >= 8 &&
                       e.cidade && e.cidade.trim().length > 0 &&
                       e.uf && e.uf.trim().length > 0);
              };

              const enderecosValidos = (enderecos || []).filter(isEnderecoUtilizavel);

              if (enderecosValidos.length === 1) {
                const end = enderecosValidos[0];
                v2Ctx.budgetAddressId = end.id;
                v2Ctx.budgetAddressFull = `${end.endereco}, ${end.numero} - ${end.bairro}, ${end.cidade}/${end.uf}`;
                v2Ctx.budgetAddressCep = end.cep;
                v2Ctx.budgetAddressCidade = end.cidade;
                v2Ctx.budgetAddressUf = end.uf;
              } else if (enderecosValidos.length > 1) {
                v2Ctx.pendingAddressChoice = {
                  clientId: v2Ctx.activeEntities.clientInternalId || 0,
                  addresses: enderecosValidos
                };
                aguardandoEndereco = true;
              } else {
                // 0 endereços utilizáveis encontrados para este cliente no banco
                solicitandoEnderecoManual = true;
              }
            }

            if (aguardandoEndereco && v2Ctx.pendingAddressChoice) {
               pr = presenterEscolhaEndereco(v2Ctx.pendingAddressChoice);
            } else if (solicitandoEnderecoManual) {
               pr = presenterSolicitarEnderecoManual(clientForCtx);
            } else {
               let fretesCalculados: PropostaFrete[] = [];
               
               if (v2Ctx.budgetAddressCep && serviceResult.totalGeral !== null) {
                 // Calcula pesoTotal
                 let pesoTotalBase = 0;
                 serviceResult.items.forEach(i => {
                   if (i.pesoUnitario && i.quantidade) {
                     pesoTotalBase += (i.pesoUnitario * i.quantidade);
                   }
                 });
                 
                 const pesoTotal = pesoTotalBase;
                 const volumesBase = Math.max(1, Math.ceil(pesoTotal / 14500));
                 
                 // Se tem peso válido, consulta APIs
                 if (pesoTotal > 0) {
                   const [sedexReq, azulReq, transpReq, veppoReq] = await Promise.allSettled([
                     solicitarCotacaoSedex({
                       peso: pesoTotal,
                       vol: volumesBase,
                       cep: v2Ctx.budgetAddressCep
                     }),
                     v2Ctx.budgetAddressUf?.toUpperCase() === 'RS' ? Promise.resolve([]) : solicitarCotacaoAzulCargo({
                       peso: pesoTotal,
                       cep: v2Ctx.budgetAddressCep,
                       valorTotal: serviceResult.totalGeral
                     }),
                     v2Ctx.budgetAddressCidade && v2Ctx.budgetAddressUf ? solicitarCotacaoTransportadoras({
                       peso: pesoTotal,
                       cidade: v2Ctx.budgetAddressCidade,
                       uf: v2Ctx.budgetAddressUf
                     }) : Promise.resolve([]),
                     v2Ctx.budgetAddressCidade && v2Ctx.budgetAddressUf ? solicitarCotacaoVeppo({
                       peso: pesoTotal,
                       valor: serviceResult.totalGeral || 0,
                       cidade: v2Ctx.budgetAddressCidade,
                       uf: v2Ctx.budgetAddressUf
                     }) : Promise.resolve([])
                   ]);
                   
                  if (sedexReq.status === 'fulfilled') fretesCalculados.push(...sedexReq.value);
                  if (azulReq.status === 'fulfilled') fretesCalculados.push(...azulReq.value);
                  if (transpReq.status === 'fulfilled') fretesCalculados.push(...transpReq.value);
                  if (veppoReq.status === 'fulfilled') fretesCalculados.push(...veppoReq.value);
                }
              }

              fretesCalculados.push({ id: 'retira_balcao', servico: 'Retirada no local', transportadora: 'Retira no balcão', valor: 0, prazo: 'A combinar', id_int: 0, observacao: '', escolhido: false, pesoUsado: 0 } as any);

              // check if weight was 0 to display warning
              const hasMissingWeight = !!(v2Ctx.budgetAddressCep && serviceResult.totalGeral !== null && (!serviceResult.items.some(i => i.pesoUnitario && i.pesoUnitario > 0)));

               pr = presenterOrcamentoAvulsoService(serviceResult, clientForCtx ?? undefined, v2Ctx.budgetAddressFull, fretesCalculados.length > 0 ? fretesCalculados : undefined, hasMissingWeight);
               if (erroCepMensagem) {
                 pr.message.content += `\n\n${erroCepMensagem}`;
               }

               let priorFreteId: string | undefined;

               // ── FASE 3c: Se houve mutação, desvincula saves antigos e cotações fechadas
               if (['ADD', 'UPDATE_QTD', 'REMOVE', 'REPLACE', 'RESTORE'].includes(serviceResult.action)) {
                 priorFreteId = v2Ctx.pendingSaveQuotation?.freteEscolhido?.id || (v2Ctx.activeQuote as any)?.freteEscolhido?.id;

                 if (v2Ctx.pendingSaveQuotation?.savedIdInt) {
                   const idAntigo = v2Ctx.pendingSaveQuotation.savedIdInt;
                   pr.message.content += `\n\n⚠️ **Nota:** Esta alteração não afeta a proposta #${idAntigo} já salva no ERP. Você está simulando um novo orçamento.`;
                 }
                 v2Ctx.pendingSaveQuotation = null;
                 v2Ctx.activeQuote = null;
                 v2Ctx.pendingFreightChoice = null; // Limpa para garantir estado fresco
               }
               // FASE 3a: calcula dados comuns e bifurca por numero de fretes
               if (
                 clientForCtx?.clientInternalId &&
                 v2Ctx.budgetAddressId &&
                 v2Ctx.budgetAddressCep &&
                 fretesCalculados.length > 0 &&
                 serviceResult.totalGeral !== null &&
                 serviceResult.resolucao.every(r => r.status === 'sucesso')
               ) {
                 let pesoBase = 0;
                 serviceResult.items.forEach((i) => {
                   if (i.pesoUnitario && i.quantidade) pesoBase += (i.pesoUnitario * i.quantidade);
                 });
                 const pesoTotalGramas = Math.ceil(pesoBase * 1.02);

                 const itensSave = serviceResult.resolucao
                   .filter((r) => r.status === 'sucesso' && r.produto)
                   .map((r) => ({
                     id_produto: r.produto!.id_produto,
                     nome: r.produto!.descricao,
                     quantidade: r.quantidade,
                     valorUnitario: r.precoUnitario ?? r.produto!.valorUnt ?? 0,
                     valorFixo: r.valorFixo ?? r.produto!.valorFixo ?? 0,
                     subtotal: r.subtotal ?? 0,
                     pesoUnitario: r.produto!.peso ?? 0,
                   }));

                 const subtotal = serviceResult.totalGeral;
                 const percentualBonus = clientForCtx.percentualBonus ?? 0;
                 const descontoReais = percentualBonus > 0 ? Number((subtotal * percentualBonus / 100).toFixed(2)) : 0;
                 const subtotalLiquido = Number((subtotal - descontoReais).toFixed(2));
                 
                 const clientNameFase3 = clientForCtx.clientName || clientForCtx.clientFantasia || 'Cliente';
                 const enderecoFullFase3 = v2Ctx.budgetAddressFull || '';

                 // Se tínhamos um save pendente com "retira_balcao", podemos preservá-mo
                 if (priorFreteId === 'retira_balcao' && fretesCalculados.length > 1) {
                   const freteRetira = fretesCalculados.find((f: any) => f.id === 'retira_balcao');
                   if (freteRetira) {
                     fretesCalculados = [freteRetira];
                   }
                 }

                 if (fretesCalculados.length > 1) {
                   // Multiplas transportadoras: salva rascunho e pede escolha numerada
                   v2Ctx.pendingFreightChoice = {
                     clientInternalId: clientForCtx.clientInternalId!,
                     clientName: clientNameFase3,
                     enderecoId: v2Ctx.budgetAddressId,
                     enderecoFull: enderecoFullFase3,
                     cep: v2Ctx.budgetAddressCep,
                     cidade: v2Ctx.budgetAddressCidade || '',
                     uf: v2Ctx.budgetAddressUf || '',
                     itens: itensSave,
                     subtotal,
                     pesoTotalGramas,
                     percentualBonus,
                     descontoReais,
                     subtotalLiquido,
                     fretes: fretesCalculados.map((f: any) => ({
                       id: f.id ?? f.servico,
                       servico: f.servico,
                       transportadora: f.transportadora,
                       valor: f.valor,
                       prazo: f.prazo,
                       pesoUsado: f.pesoUsado ?? pesoTotalGramas,
                       id_cotacao: f.id_cotacao ? String(f.id_cotacao) : undefined,
                     })),
                   };
                   console.log('[MaestroEngine] pendingFreightChoice salvo - aguardando escolha de transportadora');
                   const { presenterEscolhaTransportadora } = await import('./maestro-simple-presenter');
                   pr = presenterEscolhaTransportadora(clientNameFase3, enderecoFullFase3, itensSave, subtotal, fretesCalculados, percentualBonus, descontoReais, subtotalLiquido);

                 } else {
                   // Apenas 1 frete: finaliza direto
                   const freteEscolhido = fretesCalculados[0];
                   const total = subtotalLiquido + freteEscolhido.valor;

                   v2Ctx.pendingSaveQuotation = {
                     clientInternalId: clientForCtx.clientInternalId!,
                     clientName: clientNameFase3,
                     enderecoId: v2Ctx.budgetAddressId,
                     cep: v2Ctx.budgetAddressCep ?? '',
                     cidade: v2Ctx.budgetAddressCidade || '',
                     uf: v2Ctx.budgetAddressUf || '',
                     enderecoFull: enderecoFullFase3,
                     itens: itensSave,
                     freteEscolhido: { id: freteEscolhido.id, servico: freteEscolhido.servico, transportadora: freteEscolhido.transportadora, valor: freteEscolhido.valor, prazo: freteEscolhido.prazo, pesoUsado: freteEscolhido.pesoUsado, id_cotacao: freteEscolhido.id_cotacao },
                     fretes: fretesCalculados,
                     subtotal,
                     percentualBonus,
                     descontoReais,
                     subtotalLiquido,
                     total,
                     pesoTotalGramas,
                     timestamp: new Date().toISOString(),
                     savedIdInt: undefined,
                   };

                   v2Ctx.activeQuote = {
                     createdAt: new Date().toISOString(),
                     clientInternalId: clientForCtx.clientInternalId,
                     clientName: clientNameFase3,
                     itens: itensSave.map((it) => ({ id_produto: it.id_produto, nome: it.nome, quantidade: it.quantidade, valorUnitario: it.valorUnitario, valorFixo: it.valorFixo, subtotal: it.subtotal, pesoUnitario: it.pesoUnitario ?? 0 })),
                     enderecoId: v2Ctx.budgetAddressId,
                     enderecoFull: enderecoFullFase3,
                     cep: v2Ctx.budgetAddressCep,
                     cidade: v2Ctx.budgetAddressCidade || '',
                     uf: v2Ctx.budgetAddressUf || '',
                     fretes: fretesCalculados.map((f) => ({ id: f.id ?? f.servico, servico: f.servico, transportadora: f.transportadora, valor: f.valor, prazo: f.prazo, pesoUsado: f.pesoUsado ?? pesoTotalGramas })),
                     freteSelecionado: { id: freteEscolhido.id ?? freteEscolhido.servico, servico: freteEscolhido.servico, transportadora: freteEscolhido.transportadora, valor: freteEscolhido.valor, prazo: freteEscolhido.prazo, pesoUsado: freteEscolhido.pesoUsado ?? pesoTotalGramas },
                     subtotalProdutos: subtotal,
                     percentualBonus,
                     descontoReais,
                     subtotalLiquido,
                     total,
                     pesoTotalGramas,
                     status: 'nao_salva',
                   };
                   console.log('[MaestroEngine] activeQuote (1 frete) gravado:', clientNameFase3, '| total:', total);

                   const { presenterPerguntarSalvarCotacao: perguntarSave } = await import('./maestro-simple-presenter');
                   const prSave = perguntarSave(v2Ctx.pendingSaveQuotation!);
                   pr.message.content = pr.message.content + '\n\n' + prSave.message.content;
                   pr.message.actions = prSave.message.actions;
                 }
               }
            }
          }
        }
        else if ((step.tool as string) === 'confirmar_frete_cotacao') {
          const draft = v2Ctx.pendingFreightChoice;
          if (!draft || draft.fretes.length === 0) {
            pr = { message: { id: 'maestro-msg-' + Date.now(), role: 'maestro', content: 'Nenhuma selecao de transportadora pendente. Por favor, gere uma cotacao primeiro.', contentType: 'text', specialist: 'comercial', timestamp: new Date().toISOString(), status: 'completed', confidence: 'medium' }, activity: [] };
          } else {
            const idx = Math.max(1, Math.min(step.params.freteIndex ?? 1, draft.fretes.length));
            const freteEscolhido = draft.fretes[idx - 1];
            const subtotalLiquido = draft.subtotalLiquido ?? draft.subtotal;
            const total = subtotalLiquido + freteEscolhido.valor;

            v2Ctx.activeQuote = {
              createdAt: new Date().toISOString(),
              clientInternalId: draft.clientInternalId,
              clientName: draft.clientName,
              itens: draft.itens.map((it) => ({ id_produto: it.id_produto, nome: it.nome, quantidade: it.quantidade, valorUnitario: it.valorUnitario, valorFixo: it.valorFixo, subtotal: it.subtotal, pesoUnitario: it.pesoUnitario ?? 0 })),
              enderecoId: draft.enderecoId != null ? String(draft.enderecoId) : '',
              enderecoFull: draft.enderecoFull,
              cep: draft.cep ?? '',
              cidade: draft.cidade,
              uf: draft.uf,
              fretes: draft.fretes.map((f) => ({ id: f.id ?? f.servico, servico: f.servico, transportadora: f.transportadora, valor: f.valor, prazo: f.prazo ?? '', pesoUsado: f.pesoUsado ?? draft.pesoTotalGramas })),
              freteSelecionado: { id: freteEscolhido.id ?? freteEscolhido.servico, servico: freteEscolhido.servico, transportadora: freteEscolhido.transportadora, valor: freteEscolhido.valor, prazo: freteEscolhido.prazo ?? '', pesoUsado: freteEscolhido.pesoUsado ?? draft.pesoTotalGramas },
              subtotalProdutos: draft.subtotal,
              percentualBonus: draft.percentualBonus,
              descontoReais: draft.descontoReais,
              subtotalLiquido: draft.subtotalLiquido,
              total,
              pesoTotalGramas: draft.pesoTotalGramas,
              status: 'nao_salva',
            };

            v2Ctx.pendingSaveQuotation = {
              clientInternalId: draft.clientInternalId,
              clientName: draft.clientName,
              enderecoId: draft.enderecoId != null ? String(draft.enderecoId) : '',
              cep: draft.cep ?? '',
              cidade: draft.cidade,
              uf: draft.uf,
              enderecoFull: draft.enderecoFull,
              itens: draft.itens,
              freteEscolhido: { id: freteEscolhido.id ?? '', servico: freteEscolhido.servico, transportadora: freteEscolhido.transportadora, valor: freteEscolhido.valor, prazo: freteEscolhido.prazo ?? '', pesoUsado: freteEscolhido.pesoUsado ?? 0, id_cotacao: freteEscolhido.id_cotacao ? parseInt(freteEscolhido.id_cotacao, 10) || undefined : undefined },
              fretes: draft.fretes as any[],
              subtotal: draft.subtotal,
              percentualBonus: draft.percentualBonus,
              descontoReais: draft.descontoReais,
              subtotalLiquido: draft.subtotalLiquido,
              total,
              pesoTotalGramas: draft.pesoTotalGramas,
              timestamp: new Date().toISOString(),
              savedIdInt: undefined,
            };

            v2Ctx.pendingFreightChoice = null;
            console.log('[MaestroEngine] confirmar_frete_cotacao:', freteEscolhido.transportadora, '| total:', total);

            const { presenterFreteConfirmado } = await import('./maestro-simple-presenter');
            pr = presenterFreteConfirmado(v2Ctx.activeQuote!);
            const { presenterPerguntarSalvarCotacao: perguntarSave2 } = await import('./maestro-simple-presenter');
            const prSave2 = perguntarSave2(v2Ctx.pendingSaveQuotation!);
            pr.message.content = pr.message.content + '\n\n' + prSave2.message.content;
            pr.message.actions = prSave2.message.actions;
          }
        }

        else if (step.tool === 'consultar_fretes_cotacao') {
          if (v2Ctx.pendingSaveQuotation && v2Ctx.pendingSaveQuotation.fretes && v2Ctx.pendingSaveQuotation.fretes.length > 0) {
            const { presenterConsultarFretesCotacao } = await import('./maestro-simple-presenter');
            pr = presenterConsultarFretesCotacao(v2Ctx.pendingSaveQuotation);
          } else {
            pr = {
              message: {
                id: 'maestro-msg-' + Date.now(),
                role: 'maestro',
                content: "Não encontrei opções de frete na cotação ativa.",
                timestamp: new Date().toISOString()
              },
              activity: []
            };
          }
        }

        else if (step.tool === 'orcamento_avulso_desativado') {
          v2Ctx.domain = 'desconhecido';
          pr = {
            message: {
              id: 'maestro-msg-' + Date.now(),
              role: 'maestro',
              content: "Ainda estou ajustando a simulação de orçamento avulso. Por enquanto, me passe consultas de cliente ou financeiro.",
              timestamp: new Date().toISOString()
            },
            activity: []
          };
        }
        else if (step.tool === 'perguntar_tipo_orcamento') {
          pr = presenterEsclarecerOrcamento();
        }

        else if (step.tool === 'perguntar_continuacao_orcamento') {
          pr = presenterContinuacaoOrcamento();
        }

        else if (step.tool === 'limpar_orcamento_avulso') {
          pr = presenterLimparOrcamento();
        }

        else if (step.tool === 'voltar_orcamento_anterior') {
          pr = presenterVoltarOrcamento();
        }

        else if (step.tool === 'perguntar_quantidade_orcamento') {
          pr = presenterPerguntarQuantidade();
        }

        else if (step.tool === 'recuperacao_orcamento_avulso') {
          pr = presenterRecuperacaoOrcamento(v2Ctx.orcamentoItens || [], options.userName);
        }

        else if (step.tool === 'consultarRecebimentoClientePeriodo') {
          const { id_cliente, periodo } = step.params;
          if (id_cliente && periodo) {
            const mappedPeriod = {
              tipo: 'dinamico' as const,
              start: new Date().toISOString(), // Fallback (será sobrescrito pelo resolver abaixo)
              end: new Date().toISOString(),
              label: periodo.label || 'no período'
            };
            
            // Tratamento simplificado de datas usando base atual
            const now = new Date();
            if (periodo.tipo === 'mes_atual') {
              mappedPeriod.start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
              mappedPeriod.end = now.toISOString();
              mappedPeriod.label = 'neste mês';
            } else if (periodo.tipo === 'mes_passado') {
              mappedPeriod.start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
              mappedPeriod.end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();
              mappedPeriod.label = 'mês passado';
            } else if (periodo.tipo === 'mes_especifico' && periodo.mes && periodo.ano) {
              mappedPeriod.start = new Date(periodo.ano, periodo.mes - 1, 1).toISOString();
              mappedPeriod.end = new Date(periodo.ano, periodo.mes, 0, 23, 59, 59).toISOString();
              mappedPeriod.label = periodo.label || `em ${periodo.mes}/${periodo.ano}`;
            }

            const rRevenue = await calcularRecebimentoPeriodo(supabase, id_cliente, mappedPeriod);
            pr = presenterRecebimentoPeriodo(rRevenue, simpleCtx.activeClient!, mappedPeriod);
          }
        }

        else if (step.tool === 'revalidarUltimaConsulta') {
          if (simpleCtx.lastAnswer && simpleCtx.lastAnswer.type === 'comparison' && Array.isArray(simpleCtx.lastAnswer.data)) {
            const data = simpleCtx.lastAnswer.data as Array<{ startDate: string, endDate: string, label: string }>;
            if (data.length > 0 && simpleCtx.activeClient?.clientInternalId) {
              const rCompare = await compararRecebimentoClienteMeses(supabase, simpleCtx.activeClient.clientInternalId, data);
              pr = presenterRevalidacaoFinanceira(rCompare, simpleCtx.activeClient);
            } else {
              pr = presenterRevalidacaoGenerica(simpleCtx);
            }
          } else if (simpleCtx.lastAnswer) {
             pr = presenterRevalidacaoGenerica(simpleCtx);
          } else {
             pr = presenterSemContexto();
          }
        }

        else if ((step.tool as string) === 'compararRecebimentoClienteMeses') {
          const { id_cliente, meses } = step.params as any;
          if (id_cliente && meses && meses.length > 0) {
            const currentYear = new Date().getFullYear();
            const currentMonth = new Date().getMonth() + 1;
            
            const validMeses = (meses as any[])
              .map((m: any) => {
                const mes = Math.max(1, Math.min(12, m.mes));
                const ano = m.ano || currentYear;
                return { mes, ano, label: m.label };
              })
              .filter((m: any) => {
                if (m.ano > currentYear) return false;
                if (m.ano === currentYear && m.mes > currentMonth) return false;
                return true;
              });

            if (validMeses.length > 0) {
              const periodosMapeados = validMeses.map((m: any) => {
                const start = new Date(m.ano, m.mes - 1, 1).toISOString();
                const end = new Date(m.ano, m.mes, 0, 23, 59, 59).toISOString();
                return { startDate: start, endDate: end, label: m.label || `${m.mes}/${m.ano}` };
              });
              const rCompare = await compararRecebimentoClienteMeses(supabase, id_cliente, periodosMapeados);
              pr = presenterComparacaoRecebimentos(rCompare, simpleCtx.activeClient!);
            } else {
              pr = presenterFallback(simpleCtx);
            }
          }
        }

        if (step.tool === 'resposta_social_cotacao') {
          pr = presenterRespostaSocialCotacao(options.userName);
        }

        if (step.tool === 'resposta_frustracao_usuario') {
          const nome = options.userName ? options.userName.split(' ')[0] : '';
          const greeting = nome ? `Desculpa, ${nome}.` : `Desculpa.`;
          pr = {
            message: {
              id: 'maestro-msg-' + Date.now(),
              role: 'maestro',
              content: `${greeting} Eu me perdi no contexto. Me diga o cliente e os itens que eu refaço limpo.`,
              contentType: 'text',
              specialist: 'comercial',
              timestamp: new Date().toISOString(),
              status: 'completed',
              confidence: 'high'
            },
            activity: []
          };
        }

        if (step.tool === 'salvar_cotacao_confirmada') {
          if (!v2Ctx.pendingSaveQuotation) {
            pr = {
              message: {
                id: 'maestro-msg-' + Date.now(),
                role: 'maestro',
                content: 'Não encontrei nenhuma cotação pendente para salvar. Por favor, faça uma nova cotação primeiro.',
                contentType: 'text',
                timestamp: new Date().toISOString()
              },
              activity: []
            };
          } else if (v2Ctx.pendingSaveQuotation.savedIdInt) {
            // Já salvo — evita duplicação
            pr = presenterPropostaJaSalva(
              v2Ctx.pendingSaveQuotation.savedIdInt,
              v2Ctx.pendingSaveQuotation.clientName
            );
          } else {
            // Valida se possui cliente cadastrado
            if (!v2Ctx.pendingSaveQuotation.clientInternalId || v2Ctx.pendingSaveQuotation.clientInternalId === 0) {
              pr = presenterErroSaveCotacao(
                'Não é possível salvar propostas avulsas sem um cliente associado. Por favor, identifique o cliente primeiro (ex: "buscar cliente X") e depois solicite o salvamento.'
              );
            } else if (!options.userId) {
              pr = presenterErroSaveCotacao('Sessão do usuário não identificada. Faça login novamente e tente outra vez.');
            } else {
              try {
                const saveResult = await salvarCotacaoComoPropostaReal(
                  v2Ctx.pendingSaveQuotation,
                  supabase,
                  options.userId
                );

                if (saveResult.success && saveResult.idInt) {
                  // Grava idInt no contexto para impedir duplicação
                  v2Ctx.pendingSaveQuotation.savedIdInt = saveResult.idInt;
                  v2Ctx.pendingSaveQuotation.savedAt = new Date().toISOString();
                  // Marca activeQuote como salva
                  if (v2Ctx.activeQuote) {
                    v2Ctx.activeQuote.status = 'salva';
                    v2Ctx.activeQuote.savedIdInt = saveResult.idInt;
                  }
                  pr = presenterSaveCotacaoSucesso(saveResult.idInt, v2Ctx.pendingSaveQuotation.clientName);
                } else {
                  pr = presenterErroSaveCotacao(
                    saveResult.errorMessage || 'Erro desconhecido.',
                    saveResult.bloqueadoPorContato
                  );
                }
              } catch (saveErr) {
                const msg = saveErr instanceof Error ? saveErr.message : 'Erro interno.';
                console.error('[MaestroEngine] Erro ao salvar proposta:', saveErr);
                pr = presenterErroSaveCotacao(msg);
              }
            }
          }
        }

        else if (step.tool === 'cancelar_save_cotacao') {
          v2Ctx.pendingSaveQuotation = null;
          pr = presenterCancelarSaveCotacao();
        }

        else if (step.tool === 'editar_antes_save') {
          const idInt = v2Ctx.pendingSaveQuotation?.savedIdInt;
          pr = presenterEditarAntesSave(idInt);
        }

        else if (step.tool === 'proposta_ja_salva') {
          if (v2Ctx.pendingSaveQuotation?.savedIdInt) {
            pr = presenterPropostaJaSalva(
              v2Ctx.pendingSaveQuotation.savedIdInt,
              v2Ctx.pendingSaveQuotation.clientName
            );
          } else {
            pr = {
              message: {
                id: 'maestro-msg-' + Date.now(),
                role: 'maestro',
                content: 'Não encontrei nenhuma proposta salva recentemente.',
                contentType: 'text',
                timestamp: new Date().toISOString()
              },
              activity: []
            };
          }
        }

        else if (step.tool === 'consultarPropostasCliente') {
          // Fallback map since we don't have this tool specifically yet, we map to open proposals
          if (!simpleCtx.activeClient?.clientInternalId) {
            pr = presenterSemClienteComercial();
          } else {
            const rOpen = await buscarPropostasNaoAprovadas(supabase, simpleCtx.activeClient.clientInternalId);
            pr = presenterPropostasAbertas(rOpen, simpleCtx.activeClient);
          }
        }

        if (pr) {
          deterministicResult = toResult(pr, clientForCtx);
        }
      }
    } catch (routerErr) {
      console.warn('[MaestroEngine] Falha ao rodar piloto do Tool Router — usando fluxo estático:', routerErr);
    }
  }

  // 2. Roda o motor determinístico normal (fallback clássico) se não foi resolvido pelo Roteador
  if (!deterministicResult) {
    deterministicResult = await processSimpleQuery(query, legacyCtx, options);
    
    if (deterministicResult.simpleClient) {
      v2Ctx.domain = 'cliente';
      v2Ctx.activeEntities.clientId = deterministicResult.simpleClient.clientDisplayCode;
      v2Ctx.activeEntities.clientInternalId = deterministicResult.simpleClient.clientInternalId;
      v2Ctx.activeEntities.clientName = deterministicResult.simpleClient.clientName;
      v2Ctx.pendingProductResolution = null;
      v2Ctx.pendingAmbiguousItem = null;
    }
    
    deterministicResult.context.v2ContextJson = serializeV2Context(v2Ctx);
  }

  // 3. Se LLM não está habilitado, ou se for domínio de orçamento avulso (para preservar a formatação comercial), retorna resposta determinística
  // E também ignorar LLM se for 'orcamento_avulso_desativado', pois ele já tem resposta pronta
  // Para tools do P4 (cotação ativa): NÃO bloquear LLM — passa activeQuote como contexto e deixa o Brain humanizar
  // Exceção: 'simularOrcamentoAvulso' (o card formatado da cotação não deve ser reescrito pelo Brain)
  const skipLLM = process.env.MAESTRO_SIMPLE_LLM_ENABLED !== 'true'
    || (v2Ctx.domain === 'orcamento_avulso' && ['simularOrcamentoAvulso', 'confirmar_frete_cotacao', 'salvar_proposta_cotacao'].includes(v2Ctx.lastTool ?? ''))
    || v2Ctx.lastTool === 'orcamento_avulso_desativado'
    || v2Ctx.lastTool === 'resposta_social_cotacao'
    || v2Ctx.lastTool === 'resposta_frustracao_usuario';

  if (skipLLM) {
    return deterministicResult;
  }

  // 3. Importa brain lazily (server-only, evita bundle client)
  try {
    const { humanizeWithBrain } = await import('./maestro-simple-brain');

    // Constrói o contexto do Brain a partir do resultado da busca determinística.
    // deterministicResult.simpleClient carrega o cliente COMPLETO (com relações).
    // Isso garante consistência entre os dados do card e os fatos enviados ao LLM.
    const brainCtx: SimpleMaestroContext = deterministicResult.simpleClient
      ? {
          activeClient: deterministicResult.simpleClient,
          lastAnswer:   legacyContextToSimple(legacyCtx).lastAnswer,
        }
      : legacyContextToSimple(deterministicResult.context);

    const brainResult = await humanizeWithBrain({
      userQuery:    query,
      intentType:   detectIntent(query).type,
      fallbackText: deterministicResult.message.content,
      maestroCtx:   brainCtx,
      userName:     options.userName,
      activeQuote:  v2Ctx.activeQuote ?? null, // contexto da cotação ativa para responder perguntas naturais
    });

    // 4. Se o LLM humanizou, substitui o conteúdo da mensagem
    if (brainResult.usedLLM && brainResult.humanizedText) {
      return {
        ...deterministicResult,
        message: {
          ...deterministicResult.message,
          content: brainResult.humanizedText,
        },
      };
    }
  } catch (err) {
    console.warn('[MaestroEngine] Erro ao chamar brain — usando resposta determinística:', err);
  }

  // 5. Fallback: resposta determinística original
  return deterministicResult;
}
