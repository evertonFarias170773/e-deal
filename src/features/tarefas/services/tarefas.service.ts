import { getSupabaseClient } from "@/lib/supabase/client";
import { fetchComSessao, SessaoExpiradaError } from "@/lib/supabase/sessao";
import {
  TAREFA_STATUS_ATIVOS,
  TAREFA_STATUS_ENCERRADOS,
  type PessoaEquipe,
  type Tarefa,
  type TarefaAcao,
  type TarefaTipo
} from "@/features/tarefas/types";

/**
 * Leitura direta pelo cliente Supabase (o RLS de `tarefas_equipe` filtra o que
 * cada um ve). Escrita so pelas rotas /api/tarefas.
 */

export type AbaTarefas = "minhas" | "criadas" | "todas" | "melhorias";
export type SituacaoFiltro = "abertas" | "encerradas";

const LIMITE_LISTA = 300;

export async function listarTarefas(params: {
  aba: AbaTarefas;
  situacao: SituacaoFiltro;
  userId: string;
}): Promise<Tarefa[]> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase indisponível.");

  const statuses = params.situacao === "abertas" ? TAREFA_STATUS_ATIVOS : TAREFA_STATUS_ENCERRADOS;
  let query = supabase.from("tarefas_equipe").select("*").in("status", statuses);

  if (params.aba === "melhorias") {
    query = query.eq("tipo", "MELHORIA");
  } else {
    query = query.eq("tipo", "TAREFA");
    if (params.aba === "minhas") query = query.eq("responsavel_user_id", params.userId);
    if (params.aba === "criadas") query = query.eq("criado_por_user_id", params.userId);
  }

  // Em aberto: mais antiga primeiro (fila). Encerradas: mais recente primeiro.
  query = query.order("created_at", { ascending: params.situacao === "abertas" }).limit(LIMITE_LISTA);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Tarefa[];
}

/** Contador do menu e da Topbar: minhas tarefas em aberto ou em andamento. */
export async function contarMinhasTarefasAtivas(userId: string): Promise<number> {
  const supabase = getSupabaseClient();
  if (!supabase) return 0;
  const { count, error } = await supabase
    .from("tarefas_equipe")
    .select("id", { count: "exact", head: true })
    .eq("responsavel_user_id", userId)
    .in("status", TAREFA_STATUS_ATIVOS);
  if (error) {
    console.warn("[tarefas] Falha ao contar tarefas:", error.message);
    return 0;
  }
  return count ?? 0;
}

type PerfilLinha = { id: number; permissoes: unknown; ativo: boolean };
type UsuarioLinha = { user_id: string; nome_usuario: string | null; email: string | null; id_perfil: number | null };

/**
 * Pessoas que podem receber tarefa. Mesmo criterio do banco
 * (`tarefas_equipe__eh_da_equipe`): perfil ativo com alguma permissao.
 * `admin` segue `tarefas_equipe__eh_admin`: perfil com `*` ou `admin.usuarios.view`.
 */
export async function listarPessoasEquipe(): Promise<PessoaEquipe[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const [{ data: usuarios, error: errU }, { data: perfis, error: errP }] = await Promise.all([
    supabase.from("usuarios").select("user_id, nome_usuario, email, id_perfil"),
    supabase.from("perfis").select("id, permissoes, ativo")
  ]);
  if (errU) throw new Error(errU.message);
  if (errP) throw new Error(errP.message);

  const perfilPorId = new Map<number, string[]>();
  for (const p of (perfis ?? []) as PerfilLinha[]) {
    if (p.ativo && Array.isArray(p.permissoes)) perfilPorId.set(p.id, p.permissoes.map(String));
  }

  const pessoas: PessoaEquipe[] = [];
  for (const u of (usuarios ?? []) as UsuarioLinha[]) {
    const permissoes = u.id_perfil != null ? perfilPorId.get(u.id_perfil) : undefined;
    if (!permissoes || permissoes.length === 0) continue;
    pessoas.push({
      user_id: u.user_id,
      nome: u.nome_usuario?.trim() || u.email || "Sem nome",
      admin: permissoes.includes("*") || permissoes.includes("admin.usuarios.view")
    });
  }
  return pessoas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Nomes de todos os usuarios (para mostrar quem criou/concluiu). */
export async function mapaNomesUsuarios(): Promise<Map<string, string>> {
  const supabase = getSupabaseClient();
  const mapa = new Map<string, string>();
  if (!supabase) return mapa;
  const { data } = await supabase.from("usuarios").select("user_id, nome_usuario, email");
  for (const u of (data ?? []) as UsuarioLinha[]) {
    mapa.set(u.user_id, u.nome_usuario?.trim() || u.email || "Sem nome");
  }
  return mapa;
}

type RespostaRota = { success: boolean; message?: string; id?: number };

async function postar(url: string, corpo: unknown): Promise<RespostaRota> {
  try {
    const res = await fetchComSessao(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo)
    });
    const json = (await res.json().catch(() => ({}))) as RespostaRota;
    if (!res.ok || !json.success) {
      return { success: false, message: json.message || "Não foi possível concluir a operação." };
    }
    return json;
  } catch (err) {
    if (err instanceof SessaoExpiradaError) return { success: false, message: err.message };
    return { success: false, message: "Falha de conexão. Tente de novo." };
  }
}

export function criarTarefa(dados: {
  tipo: TarefaTipo;
  titulo: string;
  descricao: string;
  responsavel_user_id: string | null;
  id_int: string;
  id_cliente: string;
  data_limite: string;
}) {
  return postar("/api/tarefas", dados);
}

export function mudarSituacaoTarefa(id: number, acao: TarefaAcao, observacao?: string) {
  return postar(`/api/tarefas/${id}/situacao`, { acao, observacao });
}
