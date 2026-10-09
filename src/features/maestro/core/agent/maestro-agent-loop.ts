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
import { camposDeMedicao, medicaoDoTurnoLigada, novaMedicao, somarUso } from './maestro-agent-medicao';
import {
  aplicarTravaDeNaoRepetir,
  avaliarCasoSemFicha,
  casoSemFichaLigado,
  orientacaoDeCasoSemFicha,
  registrarCasoSemFicha,
  type CasoSemFicha,
} from './maestro-agent-caso-sem-ficha';
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
  AGENT_TOOLS,
  AGENT_TOOL_SCHEMAS,
  executeAgentTool,
  type AgentSessionState,
  type AgentToolContext,
} from './maestro-agent-tools';
import { carregarManual, indiceDoManual } from './maestro-agent-manual.server';
import { registrarUsuarioDoMaestro } from './maestro-agent-escopo.server';
import {
  AVISO_SEM_CONSULTA,
  citaFonteSemConsulta,
  chamadaTemNumeroDePedido,
  coletarNumerosDosArgumentos,
  correcaoDePedidoSemConsulta,
  pedidosCitadosSemConsulta,
  removerLinhasDeFonte,
  respostaDePedidoSemConsulta,
} from './maestro-agent-trava-pedido';
import {
  aplicarRotulosDeTela,
  coletarStatusDaConsulta,
  correcaoDeStatus,
  corrigirStatusNaResposta,
  novoStatusConsultados,
  rotuloDoStatus,
  statusForaDaConsulta,
  type StatusDoPedidoConsultado,
} from './maestro-agent-status';
import {
  conferirAssuntoDaResposta,
  respostaDeAssuntoSemPagina,
  type ClienteDeChat,
  type ConferenciaDoAssunto,
} from './maestro-agent-conferencia.server';
import {
  avaliarTravaDoManual,
  instrucaoDeCorrecao,
  removerOfertaFinal,
  RESPOSTA_SEM_PAGINA_NO_MANUAL,
  type VereditoDaTrava,
} from './maestro-agent-trava-manual';
import { carregarHistoricoConversa } from './maestro-agent-history.server';
import { registrarAcaoMaestro } from '../simple/maestro-audit.server';
import { verificarPermissaoServerSide } from '../../../../lib/auth/verificar-permissao';
import { buscarNomeUsuario } from '../simple/maestro-simple-vendedores.server';

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

// ─── Resumo de cada consulta para a auditoria ────────────────────────────────
// Guarda O QUE foi consultado (ferramenta, pagina do manual, numero do pedido,
// partes e se saiu dado), nunca o conteudo devolvido.

export interface ConsultaAuditada {
  ferramenta: string;
  ok: boolean;
  [detalhe: string]: unknown;
}

export function resumirConsulta(
  nome: string,
  args: Record<string, unknown>,
  ok: boolean,
  resultado: unknown,
  erro?: string,
): ConsultaAuditada {
  const base: ConsultaAuditada = { ferramenta: nome, ok };
  // Recusa: guarda so o CODIGO (o texto em maiusculas antes dos dois-pontos).
  if (!ok) {
    const codigo = /^([A-Z_]{5,40}):/.exec(erro ?? '');
    base.recusa = codigo ? codigo[1] : 'ERRO';
  }
  const r = (resultado ?? {}) as Record<string, unknown>;

  if (nome === 'consultar_manual') {
    const lidas = Array.isArray(r.paginas) ? r.paginas.map(p => String((p as Record<string, unknown>).pagina ?? '')) : [];
    const pedidas = Array.isArray(args.paginas) ? args.paginas.map(String).slice(0, 5) : [];
    return { ...base, paginas_pedidas: pedidas, paginas_lidas: lidas, sem_pagina: lidas.length === 0 };
  }

  if (nome === 'consultar_pedido') {
    const secoes = (r.secoes ?? {}) as Record<string, unknown>;
    const partes: Record<string, string> = {};
    for (const [secao, valor] of Object.entries(secoes)) {
      const v = (valor ?? {}) as Record<string, unknown>;
      partes[secao] = v.disponivel === true ? 'dados' : String(v.motivo ?? 'sem dados');
    }
    return {
      ...base,
      numero: Number(args.numero) || null,
      dados_entregues: r.ok === true,
      motivo_da_recusa: r.ok === true ? null : String(r.motivo ?? 'ERRO'),
      partes,
    };
  }

  return base;
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
  // Os adapters de dados descobrem o usuario pelo client da requisicao.
  registrarUsuarioDoMaestro(supabase, userId);
  const currentDateIso = new Date().toISOString();
  const deadline = Date.now() + getAgentTimeoutMs();

  // Estado da sessão (servidor é a única fonte de resolvedClientIds)
  const state = seedStateFromContext(context);
  const v2Ctx = deserializeV2Context(context.v2ContextJson);
  const toolCtx: AgentToolContext = { supabase, userId, state };

  // ── Histórico: persistência server-side > fallback recentMessages ─────────
  const historicoDb = await carregarHistoricoConversa(supabase, context.conversationId);
  const historico: RecentTurn[] = historicoDb.length > 0 ? historicoDb : (input.recentTurns ?? []);

  // ── Escopo do usuário logado (determinístico, autorado pelo servidor) ─────
  // O modelo precisa saber ANTES de responder o que este perfil pode ver —
  // sem isto ele promete "vendas de todos" a um vendedor de escopo próprio.
  let escopoUsuario = '';
  try {
    const [gestorVendas, identidade] = await Promise.all([
      verificarPermissaoServerSide(supabase, userId, 'propostas.view_all'),
      buscarNomeUsuario(supabase, userId),
    ]);
    const rotulo = identidade.nome ?? identidade.nomeComercial ?? 'usuário';
    escopoUsuario = gestorVendas
      ? `\n- Usuário logado: ${rotulo} — PODE ver vendas, ranking e números de TODOS os vendedores (perfil de gestão).`
      : `\n- Usuário logado: ${rotulo}${identidade.isVendedor ? ' (vendedor)' : ''} — escopo PRÓPRIO: ele NÃO pode ver ` +
        'vendas, ranking nem números de OUTROS vendedores (vendas_por_vendedor devolve apenas os números dele), ' +
        'nem propostas, recebimentos, boletos e conta corrente de CLIENTE que não é da carteira dele e com quem ele não tem pedido ' +
        '(as consultas por cliente devolvem CLIENTE_DE_OUTRO_VENDEDOR). ' +
        'Se perguntarem "posso ver as vendas de todos?", responda que o perfil mostra somente os próprios números ' +
        '— NUNCA prometa ranking ou dados de colegas.';
  } catch {
    // Sem escopo resolvido o gate das tools continua valendo — só perde o aviso antecipado
  }

  // ── Prompt e messages[] ───────────────────────────────────────────────────
  let estadoReal = descreverEstadoReal(
    v2Ctx,
    state.activeClient
      ? { nome: state.activeClient.clientFantasia || state.activeClient.clientName, id: state.activeClient.clientInternalId }
      : null
  );
  estadoReal += escopoUsuario;

  if (state.pendingClientCandidates && state.pendingClientCandidates.length > 0) {
    const lista = state.pendingClientCandidates
      .map((c, i) => `${i + 1}. ${c.fantasia || c.nome} (id_cliente ${c.id_cliente})`)
      .join('; ');
    estadoReal +=
      `\n- Candidatos de cliente aguardando confirmação do usuário: ${lista}. ` +
      'Se a mensagem confirmar um deles, chame confirmar_cliente_candidato AGORA.';
  }

  if (state.pendingWriteAction) {
    const p = state.pendingWriteAction;
    estadoReal +=
      `\n- AÇÃO DE ESCRITA PROPOSTA no turno anterior, aguardando a DECISÃO do usuário: salvar cotação de ` +
      `${p.clientName} (${p.itens.length} item(ns), frete ${p.freteEscolhido ? `${p.freteEscolhido.transportadora} R$ ${p.freteEscolhido.valor.toFixed(2)}` : 'Retira no Balcão R$ 0,00'}, total R$ ${p.total.toFixed(2)}` +
      (p.alertaRestricao ? `; ALERTA: ${p.alertaRestricao}` : '') +
      '). Se a mensagem CONFIRMAR explicitamente, chame salvar_cotacao_como_proposta AGORA (sem itens) para executar. ' +
      'Se negar, mudar de assunto ou pedir alteração, NÃO chame — a proposta expira neste turno e você deve seguir o novo assunto.';
  }

  // Indice do manual de uso (docs/manual). Vazio/ausente → o Maestro diz que nao
  // tem o passo a passo; nunca improvisa.
  let indiceManual = '';
  try {
    indiceManual = indiceDoManual();
  } catch (err) {
    console.error('[MaestroAgentLoop] Falha ao montar o indice do manual:', err);
  }

  const systemPrompt = buildAgentSystemPrompt({ currentDateIso, userName, estadoReal, indiceManual: indiceManual || undefined });

  type ChatMessage = Record<string, unknown>;
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...historico.map(t => ({ role: t.role, content: t.content })),
    { role: 'user', content: query },
  ];

  // Erro técnico na mensagem: sem ficha que o cite, ou em assunto sensível.
  // O modelo é avisado antes de responder; a trava e o registro ficam no fim.
  let casoSemFicha: CasoSemFicha | null = null;
  if (casoSemFichaLigado()) {
    try {
      const manual = carregarManual();
      casoSemFicha = avaliarCasoSemFicha(query, manual.map(p => p.conteudo), manual.map(p => p.slug));
    } catch (err) {
      console.error('[MaestroAgentLoop] Falha ao avaliar caso sem ficha:', err);
    }
    if (casoSemFicha) messages.push({ role: 'system', content: orientacaoDeCasoSemFicha(casoSemFicha) });
  }

  // ── Loop de tool-calls ────────────────────────────────────────────────────
  const { default: OpenAI } = await import('openai');
  // maxRetries 1 (default 2): falha dura da API cai rápido no fallback legado
  // em vez de segurar o usuário por ~20s de retries.
  const openai = new OpenAI({ apiKey, maxRetries: 1 });
  const model = getAgentModel();
  // Medição do turno: tokens, idas ao modelo e tempo (vai para a auditoria).
  const medicao = novaMedicao();
  const inicioDoTurno = Date.now();
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
  coletarNumerosDaPergunta(query, idsConfirmados);
  let correcoesDeCitacao = 0;

  // Trava do pedido: número apresentado como pedido/proposta só vale se uma
  // ferramenta foi chamada com ele, ou o devolveu, NESTA pergunta. A pergunta
  // do usuário e o histórico NÃO entram aqui (era o furo da guarda acima: em
  // 02/10/2026 o modelo respondeu o pedido 23071 com os dados do 23020, sem
  // consultar nada). O estado real é autorado pelo servidor e entra.
  const numerosConsultados = new Set<string>();
  coletarNumerosDosArgumentos(estadoReal, numerosConsultados);
  let consultasComSucesso = 0;
  let correcoesDePedido = 0;
  // Para o número SOLTO (sem a palavra pedido) valem também os códigos de
  // cliente que o servidor já conhece na sessão: o modelo pode citá-los sem
  // rótulo e eles não são pedido.
  const codigosDaSessao = (): Set<string> => {
    const codigos = new Set<string>();
    state.resolvedClientIds.forEach(id => codigos.add(String(id)));
    (state.pendingClientCandidates ?? []).forEach(c => codigos.add(String(c.id_cliente)));
    if (state.activeClient?.clientDisplayCode) codigos.add(String(state.activeClient.clientDisplayCode));
    if (state.activeClient?.clientInternalId != null) codigos.add(String(state.activeClient.clientInternalId));
    return codigos;
  };

  // Trava do status: o status que a resposta declara tem de ser o que a
  // consulta devolveu nesta pergunta (ou o rótulo de tela dele). Status que a
  // lista de Propostas mostra com outro nome (APROVADO → "Liberado") sai pelo rótulo.
  const statusConsultados = novoStatusConsultados();
  const statusPorPedido = new Map<string, StatusDoPedidoConsultado>();
  let correcoesDeStatus = 0;

  // Trava do manual: o que foi lido/consultado neste turno e a unica origem
  // aceita para nome de menu, aba ou botao na resposta.
  const consultas: ConsultaAuditada[] = [];
  const fontesDoTurno: string[] = [query, indiceManual];
  let manualLido = false;
  const paginasLidas: string[] = [];
  let houveEscrita = false;
  let correcoesDoManual = 0;
  const avaliarTrava = (texto: string): VereditoDaTrava =>
    avaliarTravaDoManual({ texto, manualLido, fontes: fontesDoTurno, indice: indiceManual });
  // Citar o manual sem ler: não mexe em turno que gravou algo, e deixa passar
  // o "o manual não cobre isso" quando o turno trouxe dados de outra consulta.
  const barraCitacao = (v: VereditoDaTrava): boolean =>
    v.tipo === 'cita_manual_sem_ler' && !houveEscrita && !(v.negativa && toolCallsExecutados > 0);
  let travaDireta: string | null = null;

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
          // Erro técnico relatado: a primeira chamada é obrigatoriamente ao
          // manual. Ninguém diz "não tenho esse passo a passo" sem ter olhado.
          tool_choice:
            casoSemFicha && iter === 0 && toolCallsExecutados === 0
              ? { type: 'function', function: { name: 'consultar_manual' } }
              : 'auto',
          messages: messages as never,
        },
        { signal: controller.signal }
      );
    } catch (err) {
      clearTimeout(timeoutId);
      // Estouro do orçamento de tempo NO MEIO da chamada: o SDK da OpenAI
      // lança APIUserAbortError ("Request was aborted.") — não o AbortError
      // do DOM. Sem reconhecer os dois nomes, o estouro vazava para o
      // fallback LEGADO, que respondia no fluxo antigo e plantava estado de
      // cotação no contexto — prendendo a conversa fora do agente.
      const nomeErr = err instanceof Error ? err.name : '';
      const msgErr = err instanceof Error ? err.message : '';
      if (nomeErr === 'AbortError' || nomeErr === 'APIUserAbortError' || /abort/i.test(msgErr)) {
        estourouLimite = true;
        break;
      }
      throw err;
    }
    clearTimeout(timeoutId);
    somarUso(medicao, completion.usage);

    const msg = completion.choices[0]?.message;
    if (!msg) break;

    const toolCalls = msg.tool_calls ?? [];

    if (toolCalls.length === 0) {
      const candidato = msg.content?.trim() || null;

      // Guarda de citações: número de proposta que não veio de tool → uma
      // rodada forçada de correção (o modelo pode re-consultar); persiste o
      // problema → a defesa final abaixo redige o número.
      if (candidato) {
        // Trava do pedido: pedido citado sem consulta nesta pergunta, ou "Fonte"
        // sem consulta nenhuma → uma rodada forçada mandando consultar.
        const pedidosSemConsulta = pedidosCitadosSemConsulta(candidato, numerosConsultados, codigosDaSessao());
        const fonteSemConsulta = citaFonteSemConsulta(candidato, consultasComSucesso);
        if ((pedidosSemConsulta.length > 0 || fonteSemConsulta) && correcoesDePedido < 1 && Date.now() < deadline - 3_000) {
          correcoesDePedido++;
          console.warn(
            `[MaestroAgentLoop] Trava do pedido (${pedidosSemConsulta.join(', ') || 'fonte sem consulta'}) — forçando consulta.`
          );
          messages.push({ role: 'assistant', content: candidato });
          messages.push({ role: 'system', content: correcaoDePedidoSemConsulta(pedidosSemConsulta, fonteSemConsulta) });
          continue;
        }

        const invalidos = numerosNaoConfirmados(candidato, idsConfirmados);
        if (invalidos.length > 0 && correcoesDeCitacao < 1 && Date.now() < deadline - 3_000) {
          correcoesDeCitacao++;
          console.warn(`[MaestroAgentLoop] Citação não confirmada (${invalidos.join(', ')}) — forçando correção.`);
          messages.push({ role: 'assistant', content: candidato });
          messages.push({
            role: 'system',
            content:
              `CORREÇÃO OBRIGATÓRIA: o(s) número(s) ${invalidos.join(', ')} citado(s) na sua resposta NÃO vieram de nenhuma ferramenta neste turno — podem estar inventados. ` +
              'Chame AGORA a ferramenta adequada e responda novamente citando somente números confirmados; se o dado não existir nas ferramentas, diga que não tem essa informação.',
          });
          continue;
        }

        // Trava do status: status declarado que não é o consultado → uma
        // rodada forçada de reescrita (sem nova consulta).
        const statusErrados = statusForaDaConsulta(candidato, statusConsultados);
        if (statusErrados.length > 0 && correcoesDeStatus < 1 && Date.now() < deadline - 3_000) {
          correcoesDeStatus++;
          console.warn(`[MaestroAgentLoop] Trava do status (${statusErrados.map(e => e.escrito.trim()).join(' | ')}) — forçando correção.`);
          messages.push({ role: 'assistant', content: candidato });
          messages.push({ role: 'system', content: correcaoDeStatus(statusErrados, [...statusPorPedido.values()], statusConsultados) });
          continue;
        }

        // Trava do manual: passo a passo sem pagina lida, ou nome de tela que
        // nao esta na pagina → uma rodada forcada de correcao.
        const veredito = avaliarTrava(candidato);
        // Só disse "o manual não tem isso", de cabeça e sem consultar nada: vira
        // o texto fixo na hora — uma rodada a mais não traria informação nova.
        if (veredito.tipo === 'cita_manual_sem_ler' && veredito.negativa && barraCitacao(veredito)) {
          travaDireta = 'sem_pagina_sem_consulta';
          finalContent = RESPOSTA_SEM_PAGINA_NO_MANUAL;
          break;
        }
        const correcao =
          veredito.tipo === 'cita_manual_sem_ler' && !barraCitacao(veredito) ? null : instrucaoDeCorrecao(veredito);
        if (correcao && correcoesDoManual < 1 && Date.now() < deadline - 3_000) {
          correcoesDoManual++;
          console.warn(
            `[MaestroAgentLoop] Trava do manual (${veredito.tipo}${veredito.tipo === 'nomes_fora_da_pagina' ? `: ${veredito.nomes.join(' | ')}` : ''}) — forçando correção.`
          );
          messages.push({ role: 'assistant', content: candidato });
          messages.push({ role: 'system', content: correcao });
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
      } else if (tc.function.name === 'consultar_pedido' && !chamadaTemNumeroDePedido(tc.function.arguments)) {
        // Consulta de pedido sem número: não roda, não conta e não entra na auditoria.
        resultadoParaModelo = JSON.stringify({
          erro: 'consultar_pedido não foi executada: o usuário não informou o número do pedido. Não chame esta ferramenta sem número. Responda com o que já tem e, se o número for necessário, peça-o.',
        });
      } else {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          args = {};
        }

        // O número com que a ferramenta foi chamada conta como consultado
        // mesmo quando ela recusa ou não encontra: "não achei o 23071" é legítimo.
        coletarNumerosDosArgumentos(JSON.stringify(args), numerosConsultados);

        const execucao = await executeAgentTool(tc.function.name, args, toolCtx);
        // O status chega ao modelo como a lista de Propostas mostra: APROVADO
        // vira "Liberado" e os "/ PENDENTE" viram "Aguardando", em qualquer ferramenta.
        const exec = execucao.ok ? { ...execucao, result: aplicarRotulosDeTela(execucao.result) } : execucao;
        toolCallsExecutados++;
        const nomeTool = tc.function.name;
        if (exec.ok) {
          consultasComSucesso++;
          const saida = JSON.stringify(exec.result);
          coletarIdsDeToolResult(saida, idsConfirmados);
          // Tudo o que uma ferramenta devolveu NESTA pergunta foi consultado
          // agora — inclusive os pedidos de uma lista (propostas do cliente).
          coletarNumerosDosArgumentos(saida, numerosConsultados);
          coletarStatusDaConsulta(exec.result, statusConsultados);
          if (nomeTool === 'consultar_pedido') {
            const r = exec.result as { numero?: unknown; secoes?: Record<string, Record<string, unknown> | undefined> } | null;
            const status =
              r?.secoes?.situacao?.status ??
              (r?.secoes?.cobrancas?.cobertura as Record<string, unknown> | undefined)?.status_do_pedido ??
              r?.secoes?.expedicao?.status_do_pedido;
            if (r?.numero != null && typeof status === 'string' && status) {
              statusPorPedido.set(String(r.numero), { numero: String(r.numero), status, rotulo: rotuloDoStatus(status) });
            }
          }
          if (nomeTool === 'consultar_manual' || nomeTool === 'consultar_pedido' || nomeTool === 'consultar_saude_infra') {
            // Tudo o que estas duas devolvem veio do servidor: os numeros sao
            // citaveis (OS, parcela, nota) e o texto legitima nomes de tela.
            coletarNumerosDaPergunta(saida, idsConfirmados);
            fontesDoTurno.push(saida.split('\\n').join(' '));
          }
          if (nomeTool === 'consultar_manual') {
            const paginas = (exec.result as { paginas?: unknown[] } | null)?.paginas;
            if (Array.isArray(paginas) && paginas.length > 0) {
              manualLido = true;
              for (const p of paginas) {
                const slug = String((p as { pagina?: unknown } | null)?.pagina ?? '');
                if (slug && !paginasLidas.includes(slug)) paginasLidas.push(slug);
              }
            }
          }
          if (AGENT_TOOLS[nomeTool]?.isWrite) houveEscrita = true;
        }
        consultas.push(resumirConsulta(nomeTool, args, exec.ok, exec.ok ? exec.result : null, exec.error));
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
        somarUso(medicao, completion.usage);
        finalContent = completion.choices[0]?.message?.content?.trim() || null;
      } catch {
        finalContent = null;
      }
    }
  }

  let content = finalContent || RESPOSTA_PARCIAL_SEGURA;

  // Defesa final da trava do pedido — vale para qualquer caminho de saída.
  // Redigir só o número não basta: os DADOS em volta dele são de outra
  // consulta. A resposta inteira é trocada (menos em turno que gravou algo).
  const pedidosSemConsultaFinais = pedidosCitadosSemConsulta(content, numerosConsultados, codigosDaSessao());
  let travaDoPedido: string | null = null;
  if (pedidosSemConsultaFinais.length > 0) {
    console.warn(`[MaestroAgentLoop] Pedido citado sem consulta na resposta final: ${pedidosSemConsultaFinais.join(', ')}`);
    if (houveEscrita) {
      travaDoPedido = 'aviso_pedido_sem_consulta';
      content += `\n\n⚠️ Não consultei o(s) pedido(s) ${pedidosSemConsultaFinais.join(', ')} nesta resposta — desconsidere os dados citados sobre ele(s).`;
    } else {
      travaDoPedido = 'resposta_substituida';
      content = respostaDePedidoSemConsulta(pedidosSemConsultaFinais);
    }
  } else if (citaFonteSemConsulta(content, consultasComSucesso)) {
    console.warn('[MaestroAgentLoop] "Fonte" declarada sem nenhuma consulta nesta pergunta — linha removida.');
    travaDoPedido = 'fonte_removida';
    content = `${removerLinhasDeFonte(content)}\n\n${AVISO_SEM_CONSULTA}`;
  }

  // Defesa final da trava do status — sem o modelo: troca o status errado
  // pelo consultado (um pedido) ou acrescenta o aviso com o status certo.
  let travaDoStatus: string | null = null;
  if (statusForaDaConsulta(content, statusConsultados).length > 0) {
    const corrigida = corrigirStatusNaResposta(content, [...statusPorPedido.values()], statusConsultados);
    console.warn(`[MaestroAgentLoop] Status fora da consulta na resposta final — ${corrigida.trocas} troca(s)${corrigida.aviso ? ' e aviso' : ''}.`);
    content = corrigida.texto;
    travaDoStatus = corrigida.aviso ? (corrigida.trocas > 0 ? 'status_trocado_e_aviso' : 'aviso_de_status') : 'status_trocado';
  }

  // Defesa final da guarda de citações — vale para qualquer caminho de saída
  const invalidosFinais = numerosNaoConfirmados(content, idsConfirmados);
  if (invalidosFinais.length > 0) {
    console.warn(`[MaestroAgentLoop] Redigindo números não confirmados na resposta final: ${invalidosFinais.join(', ')}`);
    content =
      redigirNumerosNaoConfirmados(content, invalidosFinais) +
      '\n\n⚠️ Removi número(s) de proposta que não pude confirmar nas consultas deste turno — desconfie de qualquer número que eu não tenha buscado agora.';
  }

  // Conferencia do assunto: a pagina lida ensina a MESMA tarefa perguntada?
  // Pagina parecida adaptada para outra tarefa e resposta errada com cara de
  // certa — sai o texto fixo de "ainda nao tenho esse passo a passo".
  // Roda em TODA resposta que leu o manual (nao so nas que tem cara de passo a
  // passo): a adaptacao tambem aparece em prosa, com um botao solto no meio.
  let conferenciaDoAssunto: ConferenciaDoAssunto | null = null;
  if (manualLido && finalContent && !houveEscrita) {
    conferenciaDoAssunto = await conferirAssuntoDaResposta(
      openai as unknown as ClienteDeChat,
      model,
      { pergunta: query, historico, paginasLidas, resposta: content },
      deadline - Date.now() - 1_000,
      usage => somarUso(medicao, usage),
    );
    if (conferenciaDoAssunto === 'outra_tarefa') {
      console.warn(`[MaestroAgentLoop] A página lida (${paginasLidas.join(', ')}) ensina outra tarefa — resposta substituída.`);
      content = respostaDeAssuntoSemPagina(paginasLidas);
    }
  }

  // Resposta de uso (manual lido) termina no ultimo passo ou aviso, sem despedida.
  if (manualLido) content = removerOfertaFinal(content);

  // Defesa final da trava do manual — vale para qualquer caminho de saida.
  const vereditoFinal = avaliarTrava(content);
  let travaDoManual: string | null = travaDireta;
  if (travaDireta) {
    // já é o texto fixo
  } else if (barraCitacao(vereditoFinal)) {
    console.warn('[MaestroAgentLoop] Resposta cita o manual sem ter lido nenhuma página — substituída.');
    travaDoManual = 'resposta_substituida_cita_sem_ler';
    content = RESPOSTA_SEM_PAGINA_NO_MANUAL;
  } else if (vereditoFinal.tipo === 'passos_sem_manual') {
    console.warn('[MaestroAgentLoop] Passo a passo sem página do manual na resposta final.');
    if (houveEscrita) {
      // Nunca apaga a resposta de um turno que gravou algo: so avisa.
      travaDoManual = 'aviso_passos_sem_manual';
      content += '\n\n⚠️ As orientações de tela acima não vieram do manual do Vibe — confira antes de seguir.';
    } else {
      travaDoManual = 'resposta_substituida';
      content = RESPOSTA_SEM_PAGINA_NO_MANUAL;
    }
  } else if (vereditoFinal.tipo === 'nomes_fora_da_pagina') {
    console.warn(`[MaestroAgentLoop] Nomes de tela fora do manual na resposta final: ${vereditoFinal.nomes.join(', ')}`);
    travaDoManual = 'aviso_nomes_fora_da_pagina';
    content +=
      `\n\n⚠️ Não confirmei no manual do Vibe estes nomes de tela ou botão: ${vereditoFinal.nomes.join(', ')}. Confira na tela antes de seguir.`;
  }

  // Trava do caso sensível — sem o modelo: erro técnico em assunto de dinheiro
  // ou nota fiscal nunca sai com sugestão de repetir a ação.
  let travaDeRepetir: number | null = null;
  if (casoSemFicha?.trava) {
    const semRepeticao = aplicarTravaDeNaoRepetir(content);
    if (semRepeticao.removidas > 0) {
      console.warn(`[MaestroAgentLoop] Erro técnico em assunto sensível — ${semRepeticao.removidas} sugestão(ões) de repetir a ação removida(s).`);
    }
    content = semRepeticao.texto;
    travaDeRepetir = semRepeticao.removidas;
  }
  if (casoSemFicha?.semFicha) {
    await registrarCasoSemFicha({ supabase, userId, caso: casoSemFicha, paginasLidas, resposta: content, frasesRemovidas: travaDeRepetir ?? 0 });
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
      correcoes_de_citacao: correcoesDeCitacao,
      correcoes_de_pedido: correcoesDePedido,
      trava_do_pedido: travaDoPedido,
      correcoes_de_status: correcoesDeStatus,
      trava_do_status: travaDoStatus,
      // O que foi consultado (nunca o conteudo): pagina do manual, pedido e partes.
      consultas,
      manual_lido: manualLido,
      conferencia_do_assunto: conferenciaDoAssunto,
      correcoes_do_manual: correcoesDoManual,
      trava_do_manual: travaDoManual,
      caso_sem_ficha: casoSemFicha?.semFicha ? casoSemFicha.erro.tipo : null,
      trava_de_repetir: travaDeRepetir,
      // Modelo, tokens, idas e tempo — nunca o texto da pergunta ou da resposta.
      ...(medicaoDoTurnoLigada() ? camposDeMedicao(medicao, model, Date.now() - inicioDoTurno) : {}),
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
