/**
 * maestro-agent-loop.ts
 *
 * Orquestrador do loop agêntico do Maestro (v1 — somente leitura).
 *
 * Fluxo por turno:
 *   1. reconstrói o histórico real da conversa (persistência server-side quando
 *      disponível; senão recentMessages sanitizado do client);
 *   2. monta messages[] = system + histórico + turno atual;
 *   3. chama a OpenAI com o catálogo de tools read-only (tool_choice auto);
 *   4. executa cada tool_call no servidor (RLS do usuário) via wrapper de
 *      guardrails, devolve a saída SANITIZADA como {role:'tool'} e re-chama o
 *      modelo até não haver mais tool-calls;
 *   5. guardas: MAX_ITERATIONS, MAX_TOOL_CALLS, TIMEOUT_MS → resposta parcial segura.
 *
 * Roda DENTRO da rota segura /api/maestro/simple (token do usuário → RLS,
 * sem service_role). Erros inesperados são propagados para a rota, que faz
 * fallback para o motor legado — o Maestro nunca fica mudo.
 *
 * ⚠️ Roda apenas no servidor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConversationContext, ConversationMessage, ActivityStep } from '../../types';
import type { RecentTurn } from '../simple/maestro-recent-turns';
import type { SimpleClientContext } from '../simple/maestro-simple-context';
import {
  deserializeV2Context,
  serializeV2Context,
  descreverEstadoReal,
} from '../simple/maestro-v2-context-manager';
import {
  getAgentModel,
  getAgentMaxIterations,
  getAgentMaxToolCalls,
  getAgentTimeoutMs,
} from './maestro-agent-config';
import { buildAgentSystemPrompt } from './maestro-agent-prompt';
import {
  AGENT_TOOL_SCHEMAS,
  executeAgentTool,
  type AgentSessionState,
  type AgentToolContext,
} from './maestro-agent-tools';
import { carregarHistoricoConversa } from './maestro-agent-history.server';
import { registrarAcaoMaestro } from '../simple/maestro-audit.server';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface AgentLoopInput {
  query: string;
  context: ConversationContext;
  supabase: SupabaseClient;
  userId: string;
  userName?: string;
  /** Histórico recente sanitizado vindo do client (fallback sem persistência) */
  recentTurns?: RecentTurn[];
}

export interface AgentLoopResult {
  message: ConversationMessage;
  activity: ActivityStep[];
  context: ConversationContext;
  simpleClient?: SimpleClientContext | null;
}

const RESPOSTA_PARCIAL_SEGURA =
  'Não consegui concluir todas as consultas a tempo. Pode repetir a pergunta ou dividi-la em partes menores? Assim eu consulto o ERP com calma.';

// ─── Guarda de citações (defesa determinística contra números inventados) ────
// Todo número citado como identificador de proposta/pedido na resposta precisa
// ter aparecido na saída de alguma tool DESTE turno. O prompt já proíbe;
// esta camada garante no servidor.

/** Coleta ids presentes num JSON de resultado de tool. */
export function coletarIdsDeToolResult(json: string, destino: Set<string>): void {
  const re = /"(?:id_int|id_cliente|id_produto|savedIdInt|clientInternalId|clientDisplayCode|numero)"\s*:\s*"?(\d+)"?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(json)) !== null) destino.add(m[1]);
}

/**
 * Números presentes na mensagem do usuário — o usuário os introduziu, logo não
 * são alucinação do modelo (ex.: "cliente 8469", "e a proposta 12345?"). Sem
 * isto, ecoar o número da pergunta ("não encontrei a 12345") seria redigido.
 */
export function coletarNumerosDaPergunta(texto: string, destino: Set<string>): void {
  const re = /\d{3,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) destino.add(m[0]);
}

/**
 * Extrai números que o texto apresenta como identificadores (proposta/pedido)
 * — combina padrões contextuais com inteiros "soltos" de 4–6 dígitos,
 * excluindo anos, valores monetários, quantidades, datas e telefones.
 */
export function extrairNumerosDePropostaCitados(texto: string): string[] {
  const encontrados = new Set<string>();

  // (a) padrões contextuais explícitos
  const padroes = [
    /(?:propostas?|pedidos?|or[çc]amentos?)\s+(?:reais?\s+)?(?:n[º°o.]{0,2}\s*)?#?\s*(\d{3,})/gi,
    /n[º°]\s*(\d{3,})/gi,
  ];
  for (const re of padroes) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto)) !== null) encontrados.add(m[1]);
  }

  // (b) inteiros soltos de 4–6 dígitos com exclusões conservadoras
  const generico = /\d{4,6}/g;
  let m: RegExpExecArray | null;
  while ((m = generico.exec(texto)) !== null) {
    const n = m[0];
    const antes = texto.slice(Math.max(0, m.index - 4), m.index);
    const depois = texto.slice(m.index + n.length, m.index + n.length + 12);

    if (/[\d/-]$/.test(antes)) continue;             // parte de data/telefone/número maior
    if (/\d[.,]$/.test(antes)) continue;             // parte de valor formatado (49.941)
    if (/R\$\s?$/.test(antes)) continue;             // dinheiro sem separador
    if (/^(\d|[.,]\d|[/%-])/.test(depois)) continue; // continuação de número/data/percentual
    const num = parseInt(n, 10);
    if (num >= 1990 && num <= 2099) continue;        // ano
    if (/^\s*(unidades|un\b|gramas|g\b|dias?|min)/i.test(depois)) continue; // qtd/peso/prazo

    encontrados.add(n);
  }

  return [...encontrados];
}

export function numerosNaoConfirmados(texto: string, idsConfirmados: Set<string>): string[] {
  return extrairNumerosDePropostaCitados(texto).filter(n => !idsConfirmados.has(n));
}

/** Defesa final: redige do texto números de proposta não confirmados. */
export function redigirNumerosNaoConfirmados(texto: string, invalidos: string[]): string {
  let s = texto;
  for (const n of invalidos) {
    s = s.replace(new RegExp(`\\b${n}\\b`, 'g'), '(número não confirmado)');
  }
  return s;
}

// ─── Guarda de LINKS (defesa determinística contra URLs inventadas) ──────────
// Toda URL exibida na resposta precisa ter vindo de saída de tool DESTE turno
// (pdfUrl, link_pagamento, fotos) ou da mensagem do usuário. Link fabricado
// (ex.: domínio "plausível" inventado pelo modelo) é removido no servidor.

/** Coleta URLs http(s) de um texto/JSON de fonte confiável. */
export function coletarUrlsDeTexto(texto: string, destino: Set<string>): void {
  const re = /https?:\/\/[^\s"'<>)\]]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) destino.add(m[0].replace(/[.,;]+$/, ''));
}

export function urlsNaoConfirmadas(texto: string, urlsConfirmadas: Set<string>): string[] {
  const achadas = new Set<string>();
  coletarUrlsDeTexto(texto, achadas);
  return [...achadas].filter(u => !urlsConfirmadas.has(u));
}

/** Defesa final: remove do texto links/URLs que nenhuma tool deste turno forneceu. */
export function redigirUrlsNaoConfirmadas(texto: string, invalidas: string[]): string {
  let s = texto;
  for (const url of invalidas) {
    const alvo = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Link markdown com URL inválida → mantém só o rótulo, sem link
    s = s.replace(new RegExp(`!?\\[([^\\]]*)\\]\\(${alvo}[^)]*\\)`, 'g'), '$1 (link não confirmado)');
    // URL solta no texto
    s = s.replace(new RegExp(alvo, 'g'), '(link não confirmado)');
  }
  return s;
}

// ─── Seed do estado a partir do contexto V2 (autorado pelo servidor) ─────────

function seedStateFromContext(context: ConversationContext): AgentSessionState {
  const state: AgentSessionState = {
    activeClient: null,
    resolvedClientIds: new Set<number>(),
    pendingClientCandidates: null,
    pendingWriteAction: null,
    // Turno único — impede propor e executar uma ação de escrita no MESMO turno
    currentTurnId: `t${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`,
  };

  const v2Ctx = deserializeV2Context(context.v2ContextJson);

  // Candidatos aguardando confirmação (gravados pelo agente no turno anterior)
  if (v2Ctx.agentPendingClientCandidates && v2Ctx.agentPendingClientCandidates.length > 0) {
    state.pendingClientCandidates = v2Ctx.agentPendingClientCandidates;
  }
  // Ação de escrita proposta no turno anterior (matriz §4 — vale só este turno)
  if (v2Ctx.agentPendingWriteAction) {
    state.pendingWriteAction = v2Ctx.agentPendingWriteAction;
  }
  const id = v2Ctx.activeEntities?.clientInternalId ?? context.clientInternalId;
  if (id != null && Number.isFinite(Number(id))) {
    const idNum = Number(id);
    state.resolvedClientIds.add(idNum);
    // Snapshot mínimo — dados completos são buscados sob demanda pelas tools
    state.activeClient = {
      clientDisplayCode: v2Ctx.activeEntities?.clientId ?? context.clientDisplayCode ?? String(idNum),
      clientInternalId: idNum,
      clientName: v2Ctx.activeEntities?.clientName ?? context.clientName ?? `Cliente ${idNum}`,
      enderecos: [],
      contatos: [],
      socios: [],
      source: 'contexto_v2 (sessão)',
      queriedAt: new Date().toISOString(),
      fontesRelacoes: { enderecos: 'não carregado', contatos: 'não carregado', socios: 'não carregado' },
    };
  }

  return state;
}

// ─── Loop principal ──────────────────────────────────────────────────────────

export async function runMaestroAgentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY não configurada — agent loop indisponível.');
  }

  const { query, context, supabase, userId, userName } = input;
  const currentDateIso = new Date().toISOString();
  const deadline = Date.now() + getAgentTimeoutMs();

  // Estado da sessão (servidor é a única fonte de resolvedClientIds)
  const state = seedStateFromContext(context);
  const v2Ctx = deserializeV2Context(context.v2ContextJson);
  const toolCtx: AgentToolContext = { supabase, userId, state };

  // ── Histórico: persistência server-side > fallback recentMessages ─────────
  const historicoDb = await carregarHistoricoConversa(supabase, context.conversationId);
  const historico: RecentTurn[] = historicoDb.length > 0 ? historicoDb : (input.recentTurns ?? []);

  // ── Prompt e messages[] ───────────────────────────────────────────────────
  let estadoReal = descreverEstadoReal(
    v2Ctx,
    state.activeClient
      ? { nome: state.activeClient.clientFantasia || state.activeClient.clientName, id: state.activeClient.clientInternalId }
      : null
  );

  if (state.pendingClientCandidates && state.pendingClientCandidates.length > 0) {
    const lista = state.pendingClientCandidates
      .map((c, i) => `${i + 1}. ${c.fantasia || c.nome} (id_cliente ${c.id_cliente})`)
      .join('; ');
    estadoReal +=
      `\n- Candidatos de cliente aguardando confirmação do usuário: ${lista}. ` +
      'Se a mensagem confirmar um deles, chame confirmar_cliente_candidato AGORA.';
  }

  if (state.pendingWriteAction?.tipo === 'salvar_cotacao_como_proposta') {
    const p = state.pendingWriteAction;
    estadoReal +=
      `\n- AÇÃO DE ESCRITA PROPOSTA no turno anterior, aguardando a DECISÃO do usuário: salvar cotação de ` +
      `${p.clientName} (${p.itens.length} item(ns), frete ${p.freteEscolhido ? `${p.freteEscolhido.transportadora} R$ ${p.freteEscolhido.valor.toFixed(2)}` : 'Retira no Balcão R$ 0,00'}, total R$ ${p.total.toFixed(2)}` +
      (p.alertaRestricao ? `; ALERTA: ${p.alertaRestricao}` : '') +
      '). Se a mensagem CONFIRMAR explicitamente, chame salvar_cotacao_como_proposta AGORA (sem itens) para executar. ' +
      'Se negar, mudar de assunto ou pedir alteração, NÃO chame — a proposta expira neste turno e você deve seguir o novo assunto.';
  } else if (state.pendingWriteAction?.tipo === 'gerar_cobranca_pix') {
    const p = state.pendingWriteAction;
    estadoReal +=
      `\n- AÇÃO DE ESCRITA PROPOSTA no turno anterior, aguardando a DECISÃO do usuário: gerar cobrança PIX de ` +
      `R$ ${p.valor.toFixed(2)} para a proposta ${p.idInt} de ${p.clientName} (empresa ${p.empresa}, saldo restante R$ ${p.saldoRestante.toFixed(2)}` +
      (p.alertaRestricao ? `; ALERTA: ${p.alertaRestricao}` : '') +
      '). Se a mensagem CONFIRMAR explicitamente, chame gerar_cobranca_pix AGORA (sem parâmetros) para executar — ' +
      'SEM essa chamada a cobrança NÃO existe e nenhum link existe: nunca anuncie sucesso sem o retorno dela. ' +
      'Se negar, mudar de assunto ou pedir alteração, NÃO chame — a proposta expira neste turno e você deve seguir o novo assunto.';
  }

  const systemPrompt = buildAgentSystemPrompt({ currentDateIso, userName, estadoReal });

  type ChatMessage = Record<string, unknown>;
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...historico.map(t => ({ role: t.role, content: t.content })),
    { role: 'user', content: query },
  ];

  // ── Loop de tool-calls ────────────────────────────────────────────────────
  const { default: OpenAI } = await import('openai');
  // maxRetries 1 (default 2): falha dura da API cai rápido no fallback legado
  // em vez de segurar o usuário por ~20s de retries.
  const openai = new OpenAI({ apiKey, maxRetries: 1 });
  const model = getAgentModel();
  const maxIterations = getAgentMaxIterations();
  const maxToolCalls = getAgentMaxToolCalls();

  const activity: ActivityStep[] = [];
  let toolCallsExecutados = 0;
  let finalContent: string | null = null;
  let estourouLimite = false;

  // Ids que o modelo PODE citar: tudo o que apareceu em saída de tool neste
  // turno + ids já resolvidos pelo servidor (cliente ativo, candidatos) +
  // números que o PRÓPRIO usuário digitou na pergunta.
  const idsConfirmados = new Set<string>();
  state.resolvedClientIds.forEach(id => idsConfirmados.add(String(id)));
  (state.pendingClientCandidates ?? []).forEach(c => idsConfirmados.add(String(c.id_cliente)));
  // Números autorados pelo SERVIDOR na pendência de escrita (ex.: nº da
  // proposta da cobrança) são citáveis no turno de confirmação
  if (state.pendingWriteAction?.tipo === 'gerar_cobranca_pix') {
    idsConfirmados.add(String(state.pendingWriteAction.idInt));
  }
  coletarNumerosDaPergunta(query, idsConfirmados);
  // URLs citáveis: somente as fornecidas por tool NESTE turno (ou pelo usuário)
  const urlsConfirmadas = new Set<string>();
  coletarUrlsDeTexto(query, urlsConfirmadas);
  let correcoesDeCitacao = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    const restanteMs = deadline - Date.now();
    if (restanteMs <= 1_000) {
      estourouLimite = true;
      break;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), restanteMs);

    let completion;
    try {
      completion = await openai.chat.completions.create(
        {
          model,
          temperature: 0.1,
          max_tokens: 900,
          tools: AGENT_TOOL_SCHEMAS,
          tool_choice: 'auto',
          messages: messages as never,
        },
        { signal: controller.signal }
      );
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        estourouLimite = true;
        break;
      }
      throw err;
    }
    clearTimeout(timeoutId);

    const msg = completion.choices[0]?.message;
    if (!msg) break;

    const toolCalls = msg.tool_calls ?? [];

    if (toolCalls.length === 0) {
      const candidato = msg.content?.trim() || null;

      // Guarda de citações: número de proposta que não veio de tool → uma
      // rodada forçada de correção (o modelo pode re-consultar); persiste o
      // problema → a defesa final abaixo redige o número.
      if (candidato) {
        const invalidos = numerosNaoConfirmados(candidato, idsConfirmados);
        const linksInvalidos = urlsNaoConfirmadas(candidato, urlsConfirmadas);
        if ((invalidos.length > 0 || linksInvalidos.length > 0) && correcoesDeCitacao < 1 && Date.now() < deadline - 3_000) {
          correcoesDeCitacao++;
          const problemas = [
            ...(invalidos.length > 0 ? [`número(s) ${invalidos.join(', ')}`] : []),
            ...(linksInvalidos.length > 0 ? [`link(s) ${linksInvalidos.join(', ')}`] : []),
          ].join(' e ');
          console.warn(`[MaestroAgentLoop] Citação não confirmada (${problemas}) — forçando correção.`);
          messages.push({ role: 'assistant', content: candidato });
          messages.push({
            role: 'system',
            content:
              `CORREÇÃO OBRIGATÓRIA: ${problemas} citado(s) na sua resposta NÃO vieram de nenhuma ferramenta neste turno — podem estar inventados. ` +
              'Chame AGORA a ferramenta adequada (para executar uma ação pendente confirmada, chame a ferramenta de escrita correspondente) e responda novamente ' +
              'citando somente números e links confirmados; se o dado não existir nas ferramentas, diga que não tem essa informação.',
          });
          continue;
        }
      }

      finalContent = candidato;
      break;
    }

    // Registra a mensagem do assistente com as tool_calls para o próximo round
    messages.push(msg as unknown as ChatMessage);

    for (const tc of toolCalls) {
      if (tc.type !== 'function') continue;

      let resultadoParaModelo: string;

      if (toolCallsExecutados >= maxToolCalls || Date.now() >= deadline) {
        estourouLimite = true;
        resultadoParaModelo = JSON.stringify({
          erro: 'Limite de consultas deste turno atingido. Responda com o que já foi obtido e avise que a consulta ficou parcial.',
        });
      } else {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          args = {};
        }

        const exec = await executeAgentTool(tc.function.name, args, toolCtx);
        toolCallsExecutados++;
        if (exec.ok) {
          const jsonResult = JSON.stringify(exec.result);
          coletarIdsDeToolResult(jsonResult, idsConfirmados);
          coletarUrlsDeTexto(jsonResult, urlsConfirmadas);
        }
        // Cliente ativado DURANTE o turno (resolver/confirmar) também é confirmado
        state.resolvedClientIds.forEach(id => idsConfirmados.add(String(id)));

        activity.push({
          id: `agent-tool-${toolCallsExecutados}`,
          label: `Consulta: ${tc.function.name}`,
          status: exec.ok ? 'done' : 'error',
          timestamp: new Date().toISOString(),
        });

        resultadoParaModelo = JSON.stringify(exec.ok ? exec.result : { erro: exec.error });
      }

      messages.push({ role: 'tool', tool_call_id: tc.id, content: resultadoParaModelo });
    }
  }

  // ── Estouro de guardas → tenta compor resposta parcial com o já obtido ───
  if (!finalContent) {
    const restanteMs = deadline - Date.now();
    if (restanteMs > 3_000) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), restanteMs);
        const completion = await openai.chat.completions.create(
          {
            model,
            temperature: 0.1,
            max_tokens: 600,
            messages: [
              ...(messages as never[]),
              {
                role: 'system',
                content:
                  'Encerre AGORA: componha a melhor resposta possível apenas com os dados já obtidos pelas ferramentas acima. Se algo ficou sem consultar, diga isso com transparência. Não invente nada.',
              },
            ] as never,
          },
          { signal: controller.signal }
        );
        clearTimeout(timeoutId);
        finalContent = completion.choices[0]?.message?.content?.trim() || null;
      } catch {
        finalContent = null;
      }
    }
  }

  let content = finalContent || RESPOSTA_PARCIAL_SEGURA;

  // Defesa final da guarda de citações — vale para qualquer caminho de saída
  const invalidosFinais = numerosNaoConfirmados(content, idsConfirmados);
  if (invalidosFinais.length > 0) {
    console.warn(`[MaestroAgentLoop] Redigindo números não confirmados na resposta final: ${invalidosFinais.join(', ')}`);
    content =
      redigirNumerosNaoConfirmados(content, invalidosFinais) +
      '\n\n⚠️ Removi número(s) de proposta que não pude confirmar nas consultas deste turno — desconfie de qualquer número que eu não tenha buscado agora.';
  }

  // Defesa final da guarda de LINKS — URL que nenhuma tool deste turno forneceu
  const urlsInvalidasFinais = urlsNaoConfirmadas(content, urlsConfirmadas);
  if (urlsInvalidasFinais.length > 0) {
    console.warn(`[MaestroAgentLoop] Removendo links não confirmados na resposta final: ${urlsInvalidasFinais.join(', ')}`);
    content =
      redigirUrlsNaoConfirmadas(content, urlsInvalidasFinais) +
      '\n\n⚠️ Removi link(s) que não vieram das consultas deste turno — um link só é confiável quando gerado pela ferramenta na hora.';
  }

  if (estourouLimite) {
    console.warn(
      `[MaestroAgentLoop] Guardas acionadas (toolCalls=${toolCallsExecutados}, ` +
      `budget=${getAgentTimeoutMs()}ms) — resposta ${finalContent ? 'parcial composta' : 'segura padrão'}.`
    );
  }

  // ── Auditoria do turno (log sempre; banco quando MAESTRO_AUDIT_DB_ENABLED) ─
  await registrarAcaoMaestro(supabase, {
    userId,
    acao: 'agent_turn',
    resultado: finalContent ? 'sucesso' : 'erro',
    idCliente: state.activeClient?.clientInternalId ?? undefined,
    detalhe: estourouLimite ? 'guardas acionadas (resposta parcial)' : undefined,
    payload: {
      tools: activity.map(a => a.label.replace(/^Consulta: /, '')),
      tool_calls: toolCallsExecutados,
      limite_atingido: estourouLimite,
      citacoes_redigidas: invalidosFinais.length,
      links_redigidos: urlsInvalidasFinais.length,
      correcoes_de_citacao: correcoesDeCitacao,
    },
  });

  // ── Contexto de retorno (servidor grava o cliente ativo no V2) ───────────
  const novoContexto: ConversationContext = { ...context, rawQuery: query };

  if (state.activeClient?.clientInternalId != null) {
    const c = state.activeClient;
    novoContexto.clientId = c.clientDisplayCode;
    novoContexto.clientDisplayCode = c.clientDisplayCode;
    novoContexto.clientInternalId = c.clientInternalId;
    novoContexto.clientName = c.clientName;

    v2Ctx.activeEntities = {
      ...v2Ctx.activeEntities,
      clientId: c.clientDisplayCode,
      clientInternalId: c.clientInternalId,
      clientName: c.clientName,
    };
  }
  // Candidatos pendentes de confirmação sobrevivem ao turno (campo do agente,
  // ignorado pelo motor legado e fora do gate de escrita)
  v2Ctx.agentPendingClientCandidates = state.pendingClientCandidates ?? null;

  // Ação de escrita: só sobrevive se foi criada NESTE turno (matriz §4 —
  // proposta não confirmada no turno seguinte expira; executada → já é null)
  v2Ctx.agentPendingWriteAction =
    state.pendingWriteAction && state.pendingWriteAction.turnId === state.currentTurnId
      ? state.pendingWriteAction
      : null;

  novoContexto.v2ContextJson = serializeV2Context(v2Ctx);

  const message: ConversationMessage = {
    id: 'maestro-msg-' + Date.now(),
    role: 'maestro',
    content,
    contentType: 'text',
    timestamp: new Date().toISOString(),
    status: 'completed',
  };

  return {
    message,
    activity,
    context: novoContexto,
    // Só expõe o cliente completo (seed mínimo do contexto não vira card)
    simpleClient: state.activeClient && state.activeClient.source !== 'contexto_v2 (sessão)'
      ? state.activeClient
      : null,
  };
}
