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
 * - Token NÃO está no body — body contém apenas { query, context }
 * - Sem service_role
 * - Sem alteração de RLS, schema, triggers, views
 * - Somente leitura — zero INSERT, UPDATE, DELETE, UPSERT
 * - OpenAI NÃO é chamada neste endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { processSimpleQueryWithBrain } from '../../../../features/maestro/core/simple/maestro-simple-engine';
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
  let body: { query?: unknown; context?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 });
  }

  const query   = typeof body.query === 'string' ? body.query.trim() : '';
  const context = (body.context ?? {}) as ConversationContext;

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

  // ── 5. Motor simples — sem LLM, sem planner, sem policy ───────────────────
  try {
    const result = await processSimpleQueryWithBrain(query, context, { supabase, userName });
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
