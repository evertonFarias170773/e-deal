import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Tarefa criada pelo sistema (etapa 2 — spec 2026-09-30-tarefas-equipe-design.md).
 *
 * Hoje so o pagamento combinado usa: quando o credito ja foi consumido e a
 * cobranca do restante falha, o Financeiro precisa regularizar a proposta.
 *
 * QUEM RECEBE (decisao do dono, 01/10/2026)
 *   Quem tem setor Financeiro E perfil de administrador. Se nao houver ninguem
 *   assim, todos os administradores. "Administrador" e o mesmo criterio do
 *   banco (`tarefas_equipe__eh_admin`): perfil ativo com `*` ou
 *   `admin.usuarios.view`.
 *
 * COMO GRAVA
 *   Pela funcao `tarefas_equipe_criar`, com a SESSAO do operador que disparou
 *   o pagamento (ele fica como quem criou). Sem service role e sem funcao nova
 *   no banco.
 */

export type UsuarioParaRegra = { user_id: string; setor: string | null; id_perfil: number | null };
export type PerfilParaRegra = { id: number; permissoes: unknown; ativo: boolean | null };

const semAcento = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** "Financeiro", " financeiro ", "FINANCEIRO" → verdadeiro. "Diretor Financeiro" → falso. */
export function ehSetorFinanceiro(setor: string | null | undefined) {
  return semAcento(String(setor ?? "")).trim().toLowerCase() === "financeiro";
}

function ehAdmin(u: UsuarioParaRegra, perfilPorId: Map<number, string[]>) {
  const permissoes = u.id_perfil != null ? perfilPorId.get(u.id_perfil) : undefined;
  return Boolean(permissoes && (permissoes.includes("*") || permissoes.includes("admin.usuarios.view")));
}

/**
 * Regra pura, sem banco: devolve os destinatarios e qual ramo valeu.
 * `FINANCEIRO` = admins do setor Financeiro; `TODOS_ADMINS` = reserva.
 */
export function escolherDestinatariosFinanceiro(
  usuarios: UsuarioParaRegra[],
  perfis: PerfilParaRegra[]
): { destinatarios: string[]; regra: "FINANCEIRO" | "TODOS_ADMINS" | "NINGUEM" } {
  const perfilPorId = new Map<number, string[]>();
  for (const p of perfis) {
    if (p.ativo && Array.isArray(p.permissoes)) perfilPorId.set(p.id, p.permissoes.map(String));
  }
  const admins = usuarios.filter((u) => ehAdmin(u, perfilPorId));
  const financeiro = admins.filter((u) => ehSetorFinanceiro(u.setor));
  if (financeiro.length > 0) return { destinatarios: financeiro.map((u) => u.user_id), regra: "FINANCEIRO" };
  if (admins.length > 0) return { destinatarios: admins.map((u) => u.user_id), regra: "TODOS_ADMINS" };
  return { destinatarios: [], regra: "NINGUEM" };
}

/**
 * Cria a tarefa Alta para o Financeiro, vinculada ao pedido. Nunca lanca:
 * a rota que chama ja esta tratando uma falha, e o aviso no chat da proposta
 * continua sendo gravado por ela.
 */
export async function criarTarefaAutomaticaFinanceiro(
  supabaseUser: SupabaseClient,
  dados: { titulo: string; descricao: string; idInt: number | null; idCliente: number | null }
): Promise<{ ok: boolean; id?: number; regra?: string; erro?: string }> {
  try {
    const [{ data: usuarios, error: errU }, { data: perfis, error: errP }] = await Promise.all([
      supabaseUser.from("usuarios").select("user_id, setor, id_perfil"),
      supabaseUser.from("perfis").select("id, permissoes, ativo")
    ]);
    if (errU || errP) throw new Error((errU ?? errP)?.message);

    const { destinatarios, regra } = escolherDestinatariosFinanceiro(
      (usuarios ?? []) as UsuarioParaRegra[],
      (perfis ?? []) as PerfilParaRegra[]
    );
    if (destinatarios.length === 0) throw new Error("Nenhum administrador para receber a tarefa.");

    const criar = (idCliente: number | null) =>
      supabaseUser.rpc("tarefas_equipe_criar", {
        p_tipo: "TAREFA",
        p_titulo: dados.titulo.slice(0, 200),
        p_descricao: dados.descricao.slice(0, 5000),
        p_prioridade: "ALTA",
        p_destinatarios: destinatarios,
        p_para_todos: false,
        p_id_int: dados.idInt,
        p_id_cliente: idCliente,
        p_data_limite: null
      });

    let { data, error } = await criar(dados.idCliente);
    // Cliente sem linha em `clientes` (legado): a tarefa vale mais que o vinculo.
    if (error?.code === "23503" && dados.idCliente != null) ({ data, error } = await criar(null));
    if (error || typeof data !== "number") throw new Error(error?.message ?? "Resposta inesperada.");

    return { ok: true, id: data, regra };
  } catch (err) {
    const erro = err instanceof Error ? err.message : String(err);
    console.error("[tarefa-automatica] Falha ao criar a tarefa do Financeiro:", erro);
    return { ok: false, erro };
  }
}
