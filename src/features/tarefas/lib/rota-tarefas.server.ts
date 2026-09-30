import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Apoio comum das rotas /api/tarefas.
 *
 * As rotas gravam COM A SESSAO DO USUARIO (anon key + Bearer do usuario), nunca
 * com service role. Assim o RLS e a trigger `tarefas_equipe__guarda` valem aqui
 * exatamente como valeriam numa chamada direta — a rota so valida formato e
 * traduz a recusa do banco.
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

type ErroBanco = { code?: string; message?: string; details?: string } | null;

/**
 * Traduz a recusa do banco. As mensagens da trigger ja vem em portugues
 * simples (P0001/42501 com texto proprio); o resto vira frase generica.
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
    // Mensagens proprias da trigger (responsavel invalido) comecam com maiuscula e
    // sem o nome da constraint; as de CHECK trazem "violates check constraint".
    if (!msg.includes("violates check constraint")) return recusa(msg, 400, "RECUSADO");
    if (msg.includes("responsavel_chk")) return recusa("Escolha para quem é a tarefa.", 400, "SEM_RESPONSAVEL");
    if (msg.includes("titulo_chk")) return recusa("O título deve ter de 1 a 200 caracteres.", 400, "TITULO");
    return recusa("Algum campo está fora do limite permitido.", 400, "LIMITE");
  }
  if (code === "42501" || code === "P0001") {
    // "permission denied for table" e a recusa de privilegio, nao da trigger.
    if (msg.startsWith("permission denied") || msg.includes("row-level security")) {
      return recusa("Você não tem permissão para esta ação.", 403, "SEM_PERMISSAO");
    }
    return recusa(msg, 403, "RECUSADO");
  }
  return recusa("Não foi possível gravar a tarefa. Tente de novo.", 500, "ERRO_BANCO");
}
