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
import { resolverTermoCatalogo } from './maestro-orcamento-catalogo-oficial';

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
  type PresenterResult,
} from './maestro-simple-presenter';
import { routeToolSimple } from './maestro-v2-router';
import { deserializeV2Context, serializeV2Context, normalizeText } from './maestro-v2-context-manager';

import type { ConversationMessage, ActivityStep, ConversationContext } from '../../types';

// ─── Opções do Motor ──────────────────────────────────────────────────────

export interface SimpleEngineOptions {
  /** Supabase client autenticado via cookies — passado pela rota server-side */
  supabase: SupabaseClient;
  /** Nome do usuário logado (usado para humanização amigável) */
  userName?: string;
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
          // CPF/CNPJ: busca via busca_geral (field normalizado na view)
          result = await buscarClientePorTexto(supabase, intent.document);
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
      const routeResult = await routeToolSimple(query, simpleCtx.activeClient, simpleCtx.lastAnswer, v2Ctx);
      if (routeResult.routed && routeResult.plan && routeResult.plan.steps.length > 0) {
        const step = routeResult.plan.steps[0];
        let pr: PresenterResult | null = null;
        let clientForCtx = simpleCtx.activeClient;

        // Atualizações do Gerenciador de Contexto Conversacional Geral
        v2Ctx.lastTool = step.tool;
        if (['consultarBoletos', 'consultarRecebimentoClientePeriodo', 'compararRecebimentoClienteMeses'].includes(step.tool)) {
          v2Ctx.domain = 'financeiro';
        } else if (['buscarCliente', 'consultarCampoCadastro'].includes(step.tool)) {
          v2Ctx.domain = 'cliente';
        } else if (['consultarPropostasCliente', 'consultarUltimoOrcamento'].includes(step.tool)) {
          v2Ctx.domain = 'proposta';
        }

        if (simpleCtx.activeClient) {
          v2Ctx.activeEntities.clientId = simpleCtx.activeClient.clientDisplayCode;
          v2Ctx.activeEntities.clientInternalId = simpleCtx.activeClient.clientInternalId;
          v2Ctx.activeEntities.clientName = simpleCtx.activeClient.clientName;
        }

        if (step.tool === 'cancelar_orcamento_avulso') {
          const { presenterCancelarOrcamentoAvulso } = require('./maestro-simple-presenter');
          pr = presenterCancelarOrcamentoAvulso(simpleCtx.activeClient);
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
          let lookupResult = { found: false } as any;

          // Prioridade 1: Busca exata por ID Numérico
          if (/^\d+$/.test(busca)) {
            const numCode = parseInt(busca, 10);
            if (!isNaN(numCode)) {
              const resExato = await supabase.from('vw_cadastros_clientes_lista')
                .select('id_cliente, id_cliente_text, nome, fantasia, documento, cidade_uf, ativo, qtd_pedidos, data_ult_pedido')
                .eq('id_cliente', numCode).limit(1);
              if (resExato.data && resExato.data.length > 0) {
                // Reaproveitamos a busca para forçar o enriquecimento chamando buscarClientePorCodigo diretamente com o id exato transformado pra string
                lookupResult = await buscarClientePorCodigo(supabase, numCode.toString());
              }
            }
          }

          // Prioridade 2: Documento exato (CPF/CNPJ) ou Texto Livre
          if (!lookupResult.found) {
            lookupResult = await buscarClientePorTexto(supabase, busca);
          }

          if (lookupResult.found && lookupResult.client) {
            pr = presenterClienteEncontrado(lookupResult.client);
            clientForCtx = lookupResult.client;
          } else if (lookupResult.reason === 'auth_error') {
            pr = presenterClienteErroAuth();
          } else {
            pr = presenterClienteNaoEncontrado(busca);
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

        else if (step.tool === 'simularOrcamentoAvulso') {
          const itens = step.params.itens;
          if (!itens || itens.length === 0) {
            pr = presenterFallback(simpleCtx);
          } else {
            // ─── CAMINHO NOVO: usa processarOrcamentoService (catálogo oficial + banco) ───
            // NUNCA usa simularOrcamentoAvulsoDb para o fluxo principal do chat
            const orcamentoState = {
              itens: (v2Ctx.orcamentoItens || []).map(i => ({ quantidade: i.quantidade, termo: i.termo })),
              pendingAmbiguity: !!v2Ctx.pendingProductResolution || !!v2Ctx.pendingAmbiguousItem,
              previousItens: (v2Ctx.previousOrcamentoItens || []).map(i => ({ quantidade: i.quantidade, termo: i.termo })),
            };

            const serviceResult = await processarOrcamentoService({
              query: step.params.itens
                ? `${itens.map(i => `${i.quantidade} ${i.termo}`).join(' + ')}`
                : '',
              state: { ...orcamentoState, itens: itens.map(i => ({ quantidade: i.quantidade, termo: i.termo })) },
              supabase,
            });

            // Atualiza contexto com o estado resolvido pelo service
            if (serviceResult.action !== 'NONE' && serviceResult.action !== 'ERROR') {
              v2Ctx.previousOrcamentoItens = JSON.parse(JSON.stringify(v2Ctx.orcamentoItens || []));
              v2Ctx.orcamentoItens = serviceResult.items.map(i => ({ quantidade: i.quantidade, termo: i.termo }));
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

            pr = presenterOrcamentoAvulsoService(serviceResult, cliente);
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
  const skipLLM = process.env.MAESTRO_SIMPLE_LLM_ENABLED !== 'true' 
    || v2Ctx.domain === 'orcamento_avulso'
    || v2Ctx.lastTool === 'orcamento_avulso_desativado';

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
