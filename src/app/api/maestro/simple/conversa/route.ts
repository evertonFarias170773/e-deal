/**
 * /api/maestro/simple/conversa/route.ts
 *
 * Retomada de conversa do Maestro (persistência server-side, RLS por usuário).
 *
 *   GET  → última conversa NÃO encerrada do usuário + mensagens (ordem
 *          cronológica) + contexto_json para reidratar o front após reload.
 *   POST → { conversationId, action: 'encerrar' } marca a conversa como
 *          encerrada (flag lógica — histórico permanece imutável).
 *
 * SEGURANÇA (idêntica à rota principal /api/maestro/simple):
 *   - token do usuário no header Authorization → client Supabase anon com RLS;
 *   - sem service_role; cada usuário só enxerga as próprias conversas;
 *   - com MAESTRO_PERSISTENCE_ENABLED != 'true' retorna vazio (front segue
 *     com conversa nova — comportamento anterior preservado).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { recuperarUltimaConversa } from '../../../../../features/maestro/core/simple/maestro-persistence.server';

const MAX_MENSAGENS = 60; // ~30 turnos — mesma janela do histórico do agente

async function criarClientAutenticado(request: NextRequest): Promise<
  { ok: true; supabase: SupabaseClient } | { ok: false; response: NextResponse }
> {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Sessão não encontrada. Faça login para usar o Maestro.' },
        { status: 401 }
      ),
    };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Sessão inválida ou expirada. Faça login novamente.' },
        { status: 401 }
      ),
    };
  }

  return { ok: true, supabase };
}

export async function GET(request: NextRequest) {
  const auth = await criarClientAutenticado(request);
  if (!auth.ok) return auth.response;

  if (process.env.MAESTRO_PERSISTENCE_ENABLED !== 'true') {
    return NextResponse.json({ conversa: null }, { status: 200 });
  }

  try {
    const ultima = await recuperarUltimaConversa(auth.supabase);
    if (!ultima) {
      return NextResponse.json({ conversa: null }, { status: 200 });
    }

    const { data: mensagens, error } = await auth.supabase
      .from('maestro_mensagens')
      .select('role, content, created_at')
      .eq('conversa_id', ultima.id)
      .order('created_at', { ascending: false })
      .limit(MAX_MENSAGENS);

    if (error) {
      console.warn('[/api/maestro/simple/conversa] Falha ao ler mensagens:', error.message);
      return NextResponse.json({ conversa: null }, { status: 200 });
    }

    return NextResponse.json(
      {
        conversa: {
          id: ultima.id,
          contextoJson: ultima.contextoJson,
          mensagens: (mensagens ?? [])
            .reverse()
            .filter(m => m.role === 'user' || m.role === 'maestro')
            .map(m => ({
              role: m.role as 'user' | 'maestro',
              content: String(m.content ?? ''),
              criadaEm: String(m.created_at ?? ''),
            })),
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.warn('[/api/maestro/simple/conversa] Erro inesperado (retornando vazio):', err);
    return NextResponse.json({ conversa: null }, { status: 200 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await criarClientAutenticado(request);
  if (!auth.ok) return auth.response;

  if (process.env.MAESTRO_PERSISTENCE_ENABLED !== 'true') {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  let body: { conversationId?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 });
  }

  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : '';
  if (body.action !== 'encerrar' || !conversationId) {
    return NextResponse.json({ error: 'Ação não suportada.' }, { status: 400 });
  }

  try {
    // RLS garante que só a conversa do próprio usuário é afetada
    const { error } = await auth.supabase
      .from('maestro_conversas')
      .update({ encerrada: true, updated_at: new Date().toISOString() })
      .eq('id', conversationId);

    if (error) {
      console.warn('[/api/maestro/simple/conversa] Falha ao encerrar conversa:', error.message);
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.warn('[/api/maestro/simple/conversa] Erro inesperado ao encerrar (ignorado):', err);
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}
