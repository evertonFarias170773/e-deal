/**
 * /api/maestro/simple/conversa/route.ts
 *
 * Retomada e histórico de conversas do Maestro (persistência server-side, RLS).
 *
 *   GET           → última conversa NÃO encerrada + mensagens + contexto_json.
 *   GET ?list=1   → lista das conversas do usuário (sidebar de histórico).
 *   GET ?id=<id>  → uma conversa específica + mensagens (abrir pelo histórico).
 *   POST → { conversationId, action: 'encerrar' | 'reabrir' } — flags lógicas;
 *          o histórico permanece imutável. 'reabrir' marca a conversa aberta
 *          (encerrada=false) e atualiza updated_at para o F5 retomá-la.
 *
 * SEGURANÇA (idêntica à rota principal /api/maestro/simple):
 *   - token do usuário no header Authorization → client Supabase anon com RLS;
 *   - sem service_role; cada usuário só enxerga as próprias conversas;
 *   - com MAESTRO_PERSISTENCE_ENABLED != 'true' retorna vazio (front segue
 *     com conversa nova — comportamento anterior preservado).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  recuperarUltimaConversa,
  persistirMensagemMaestro,
} from '../../../../../features/maestro/core/simple/maestro-persistence.server';
import { montarSaudacaoDoDia } from '../../../../../features/maestro/core/simple/maestro-saudacao.server';
import { ymdSaoPaulo } from '../../../../../features/maestro/core/simple/maestro-simple-tempo';

const MAX_MENSAGENS = 60; // ~30 turnos — mesma janela do histórico do agente

async function criarClientAutenticado(request: NextRequest): Promise<
  { ok: true; supabase: SupabaseClient; userId: string } | { ok: false; response: NextResponse }
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

  return { ok: true, supabase, userId: user.id };
}

/** Carrega mensagens de uma conversa em ordem cronológica (desempate por id). */
async function carregarMensagens(supabase: SupabaseClient, conversaId: string) {
  // Desempate por id: user e maestro do mesmo turno recebem created_at
  // idêntico — sem o id a ordem do par pode inverter na restauração.
  const { data, error } = await supabase
    .from('maestro_mensagens')
    .select('role, content, created_at')
    .eq('conversa_id', conversaId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(MAX_MENSAGENS);

  if (error) {
    console.warn('[/api/maestro/simple/conversa] Falha ao ler mensagens:', error.message);
    return null;
  }
  return (data ?? [])
    .reverse()
    .filter(m => m.role === 'user' || m.role === 'maestro')
    .map(m => ({
      role: m.role as 'user' | 'maestro',
      content: String(m.content ?? ''),
      criadaEm: String(m.created_at ?? ''),
    }));
}

export async function GET(request: NextRequest) {
  const auth = await criarClientAutenticado(request);
  if (!auth.ok) return auth.response;

  const listar = request.nextUrl.searchParams.get('list') === '1';
  const idParam = request.nextUrl.searchParams.get('id') ?? '';

  if (process.env.MAESTRO_PERSISTENCE_ENABLED !== 'true') {
    return NextResponse.json(listar ? { conversas: [] } : { conversa: null }, { status: 200 });
  }

  try {
    // ── Listagem para a sidebar (RLS limita ao próprio usuário) ─────────────
    if (listar) {
      const { data, error } = await auth.supabase
        .from('maestro_conversas')
        .select('id, titulo, encerrada, updated_at')
        .order('updated_at', { ascending: false })
        .limit(30);
      if (error) {
        console.warn('[/api/maestro/simple/conversa] Falha ao listar conversas:', error.message);
        return NextResponse.json({ conversas: [] }, { status: 200 });
      }
      return NextResponse.json({
        conversas: (data ?? []).map(c => ({
          id: String(c.id),
          titulo: typeof c.titulo === 'string' && c.titulo.trim() ? c.titulo.trim() : 'Conversa sem título',
          encerrada: c.encerrada === true,
          atualizadaEm: String(c.updated_at ?? ''),
        })),
      }, { status: 200 });
    }

    // ── Conversa específica (abrir pelo histórico) ou última não encerrada ──
    let alvo: { id: string; contextoJson: string | null } | null = null;
    if (idParam) {
      const { data, error } = await auth.supabase
        .from('maestro_conversas')
        .select('id, contexto_json')
        .eq('id', idParam)
        .maybeSingle();
      if (!error && data) {
        alvo = {
          id: String(data.id),
          contextoJson: data.contexto_json ? JSON.stringify(data.contexto_json) : null,
        };
      }
    } else {
      alvo = await recuperarUltimaConversa(auth.supabase);
    }

    // Saudação do dia (Maestro Vendedor) — SOMENTE na retomada padrão
    // (nunca ao abrir conversa específica pelo histórico); flag-gated e
    // idempotente por dia via mensagem persistida. Nunca quebra a retomada.
    const saudacao = idParam ? null : await montarSaudacaoDoDia(auth.supabase, auth.userId);

    if (!alvo) {
      if (!saudacao) {
        return NextResponse.json({ conversa: null }, { status: 200 });
      }
      const [ano, mes, dia] = ymdSaoPaulo().split('-');
      const convId = await persistirMensagemMaestro(auth.supabase, {
        conversationId: null,
        content: saudacao.content,
        tituloSeNova: `Resumo do dia ${dia}/${mes}/${ano}`,
      });
      if (!convId) {
        // Sem persistência não há idempotência — segue o comportamento antigo
        return NextResponse.json({ conversa: null }, { status: 200 });
      }
      return NextResponse.json(
        {
          conversa: {
            id: convId,
            contextoJson: null,
            mensagens: [{ role: 'maestro', content: saudacao.content, criadaEm: new Date().toISOString() }],
          },
        },
        { status: 200 }
      );
    }

    const mensagens = await carregarMensagens(auth.supabase, alvo.id);
    if (!mensagens) {
      return NextResponse.json({ conversa: null }, { status: 200 });
    }

    if (saudacao) {
      const convId = await persistirMensagemMaestro(auth.supabase, {
        conversationId: alvo.id,
        content: saudacao.content,
      });
      if (convId) {
        mensagens.push({ role: 'maestro', content: saudacao.content, criadaEm: new Date().toISOString() });
      }
    }

    return NextResponse.json(
      { conversa: { id: alvo.id, contextoJson: alvo.contextoJson, mensagens } },
      { status: 200 }
    );
  } catch (err) {
    console.warn('[/api/maestro/simple/conversa] Erro inesperado (retornando vazio):', err);
    return NextResponse.json(listar ? { conversas: [] } : { conversa: null }, { status: 200 });
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
  const action = body.action === 'encerrar' || body.action === 'reabrir' ? body.action : null;
  if (!action || !conversationId) {
    return NextResponse.json({ error: 'Ação não suportada.' }, { status: 400 });
  }

  try {
    // RLS garante que só a conversa do próprio usuário é afetada
    const { error } = await auth.supabase
      .from('maestro_conversas')
      .update({ encerrada: action === 'encerrar', updated_at: new Date().toISOString() })
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
