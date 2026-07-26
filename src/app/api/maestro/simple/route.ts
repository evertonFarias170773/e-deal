/**
 * /api/maestro/simple/route.ts
 *
 * Route handler server-side para o Maestro Simple v1.
 *
 * AUTENTICAÇÃO:
 * - O hook browser envia o access_token da sessão Supabase no header
 *   "Authorization: Bearer <token>" (não no body).
 * - A rota valida o token com supabase.auth.getUser(token).
 * - Cria um Supabase client com o token injetado para que a RLS funcione
 *   corretamente nas queries subsequentes.
 *
 * SEGURANÇA:
 * - Token NÃO está no body — body contém { query, context, recentMessages? }
 * - Sem service_role
 * - Sem alteração de RLS, schema, triggers, views
 * - Escritas possíveis (todas com RLS do usuário e confirmação explícita):
 *   salvar cotação como proposta; persistência de conversa e auditoria
 *   quando as flags MAESTRO_PERSISTENCE_ENABLED / MAESTRO_AUDIT_DB_ENABLED
 *   estiverem ativas e as migrations correspondentes aplicadas.
 * - recentMessages é sanitizado no servidor (maestro-recent-turns.ts)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { processSimpleQueryWithBrain } from '../../../../features/maestro/core/simple/maestro-simple-engine';
import { sanitizeRecentTurns } from '../../../../features/maestro/core/simple/maestro-recent-turns';
import { persistirTurnoMaestro, carregarContextoConversa } from '../../../../features/maestro/core/simple/maestro-persistence.server';
import { deserializeV2Context } from '../../../../features/maestro/core/simple/maestro-v2-context-manager';
import { deveUsarAgentLoop } from '../../../../features/maestro/core/agent/maestro-agent-config';
import { runMaestroAgentLoop } from '../../../../features/maestro/core/agent/maestro-agent-loop';
import { registrarAcaoMaestro } from '../../../../features/maestro/core/simple/maestro-audit.server';
import type { ConversationContext } from '../../../../features/maestro/types';

export async function POST(request: NextRequest) {
  // ── 1. Lê o token do header Authorization ─────────────────────────────────
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) {
    return NextResponse.json(
      { error: 'Sessão não encontrada. Faça login para usar o Maestro.' },
      { status: 401 }
    );
  }

  // ── 2. Cria client Supabase com o token do usuário (RLS funcionará) ────────
  //    O token é injetado no header global → PostgREST identifica o usuário
  //    Sem service_role, sem bypass de RLS.
  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  });

  // ── 3. Valida o token antes de prosseguir ──────────────────────────────────
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: 'Sessão inválida ou expirada. Faça login novamente.' },
      { status: 401 }
    );
  }

  // ── 4. Leitura do payload ──────────────────────────────────────────────────
  let body: { query?: unknown; context?: unknown; recentMessages?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 });
  }

  const query   = typeof body.query === 'string' ? body.query.trim() : '';
  const context = (body.context ?? {}) as ConversationContext;
  // Histórico recente (campo OPCIONAL — clients antigos sem ele mantêm o
  // comportamento anterior). Sanitizado no servidor: nunca confiar no browser.
  const recentTurns = sanitizeRecentTurns(body.recentMessages);

  if (!query) {
    return NextResponse.json(
      { error: 'Campo "query" é obrigatório e não pode estar vazio.' },
      { status: 400 }
    );
  }

  // Extrai o primeiro nome do usuário logado (usado para humanização)
  const metadata = user.user_metadata || {};
  const fullName = metadata.nome || metadata.name || metadata.first_name || '';
  const userName = fullName ? fullName.split(' ')[0] : undefined;

  // ── 5. Motor de resposta ──────────────────────────────────────────────────
  //    Agent Loop (leitura, atrás de MAESTRO_AGENT_LOOP_ENABLED) OU motor
  //    legado. Estado de cotação/escrita ativo SEMPRE permanece no legado —
  //    o fluxo de criar/salvar orçamento fica intacto.
  try {
    let result;

    // Contexto V2: quando a conversa está persistida, o rascunho gravado pelo
    // SERVIDOR no fim do turno anterior é a fonte da verdade — o eco do
    // browser vira fallback. Estado autorado pelo servidor (pendências de
    // ESCRITA, candidatos de cliente) nunca fica refém do round-trip cliente.
    const contextoServidor = await carregarContextoConversa(supabase, context.conversationId);
    if (contextoServidor != null) {
      context.v2ContextJson = contextoServidor;
    }
    console.info('[/api/maestro/simple] contexto V2: fonte =', contextoServidor != null ? 'servidor (maestro_conversas)' : 'browser');

    const v2CtxProbe = deserializeV2Context(context.v2ContextJson);
    if (deveUsarAgentLoop(v2CtxProbe)) {
      try {
        result = await runMaestroAgentLoop({
          query,
          context,
          supabase,
          userId: user.id,
          userName,
          recentTurns,
        });
      } catch (agentErr) {
        // Falha do agent loop NUNCA derruba o Maestro — fallback para o legado.
        console.error('[/api/maestro/simple] Agent loop falhou — fallback para o motor legado:', agentErr);
        await registrarAcaoMaestro(supabase, {
          userId: user.id,
          acao: 'agent_fallback_legado',
          resultado: 'erro',
          detalhe: agentErr instanceof Error ? agentErr.message.slice(0, 300) : String(agentErr).slice(0, 300),
        });
        result = null;
      }
    }

    if (!result) {
      result = await processSimpleQueryWithBrain(query, context, {
        supabase,
        userName,
        userId: user.id,
        recentTurns,
      });
    }

    // ── 6. Persistência de conversa/rascunho (flag-gated; nunca quebra o fluxo)
    try {
      const conversationId = await persistirTurnoMaestro(supabase, {
        conversationId: context.conversationId ?? null,
        userQuery: query,
        assistantContent: result.message?.content ?? '',
        contextoJson: result.context?.v2ContextJson ?? null,
      });
      if (conversationId && result.context) {
        result.context.conversationId = conversationId;
      }
    } catch (persistErr) {
      console.warn('[/api/maestro/simple] Persistência falhou (ignorada):', persistErr);
    }

    return NextResponse.json(result, { status: 200 });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[/api/maestro/simple] Erro interno:', msg);
    return NextResponse.json(
      { error: 'Erro interno ao processar a mensagem.' },
      { status: 500 }
    );
  }
}
