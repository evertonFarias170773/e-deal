import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Apoio comum das rotas /api/tarefas.
 *
 * Dados sempre COM A SESSAO DO USUARIO (anon key + Bearer): o RLS e a trigger
 * `tarefas_equipe__guarda` valem aqui como numa chamada direta. A service role
 * (`clienteServico`) so toca o bucket privado de anexos, e so depois de a
 * sessao provar que o usuario enxerga a tarefa.
 */

export function recusa(message: string, status: number, code: string) {
  return NextResponse.json({ success: false, code, message }, { status });
}

export type ContextoTarefas = { supabase: SupabaseClient; userId: string };

export async function abrirContexto(
  request: NextRequest
): Promise<{ ok: true; ctx: ContextoTarefas } | { ok: false; resposta: NextResponse }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[api/tarefas] ENV AUSENTE");
    return { ok: false, resposta: recusa("Configuração de ambiente incompleta.", 500, "ENV") };
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return { ok: false, resposta: recusa("Sessão não encontrada.", 401, "SEM_SESSAO") };

  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { ok: false, resposta: recusa("Sessão inválida ou expirada.", 401, "SESSAO_INVALIDA") };
  }
  return { ok: true, ctx: { supabase, userId: data.user.id } };
}

/** Service role, SO para o bucket de anexos. Nunca para ler ou gravar tabelas. */
export function clienteServico(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("[api/tarefas] SUPABASE_SERVICE_ROLE_KEY ausente: anexos indisponíveis.");
    return null;
  }
  return createSupabaseClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

type ErroBanco = { code?: string; message?: string; details?: string } | null;

/**
 * Traduz a recusa do banco. As mensagens da trigger e da funcao de criacao ja
 * vem em portugues simples; o resto vira frase generica.
 */
export function respostaDoErroBanco(error: ErroBanco, contexto: string) {
  const code = error?.code ?? "";
  const msg = error?.message ?? "";
  console.error(`[api/tarefas] ${contexto}:`, code, msg);

  if (code === "23503") {
    if (msg.includes("id_int")) return recusa("Pedido não encontrado. Confira o número.", 400, "PEDIDO_INEXISTENTE");
    if (msg.includes("id_cliente")) return recusa("Cliente não encontrado. Confira o código.", 400, "CLIENTE_INEXISTENTE");
    return recusa("Um dos vínculos informados não existe.", 400, "VINCULO_INEXISTENTE");
  }
  if (code === "23514") {
    if (!msg.includes("violates check constraint")) return recusa(msg, 400, "RECUSADO");
    if (msg.includes("titulo_chk")) return recusa("O título deve ter de 1 a 200 caracteres.", 400, "TITULO");
    if (msg.includes("prioridade_chk")) return recusa("Prioridade inválida.", 400, "PRIORIDADE");
    return recusa("Algum campo está fora do limite permitido.", 400, "LIMITE");
  }
  if (code === "42501" || code === "P0001") {
    if (msg.startsWith("permission denied") || msg.includes("row-level security")) {
      return recusa("Você não tem permissão para esta ação.", 403, "SEM_PERMISSAO");
    }
    return recusa(msg, 403, "RECUSADO");
  }
  return recusa("Não foi possível gravar. Tente de novo.", 500, "ERRO_BANCO");
}

/** A sessao enxerga a tarefa? Devolve a situacao, ou null (inexistente ou sem acesso). */
export async function tarefaVisivel(supabase: SupabaseClient, id: number) {
  const { data, error } = await supabase.from("tarefas_equipe").select("id, status").eq("id", id).maybeSingle();
  if (error) {
    console.error("[api/tarefas] ler tarefa:", error.code, error.message);
    return null;
  }
  return data as { id: number; status: string } | null;
}
