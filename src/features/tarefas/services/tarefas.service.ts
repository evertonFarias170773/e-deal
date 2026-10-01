import { getSupabaseClient } from "@/lib/supabase/client";
import { fetchComSessao, SessaoExpiradaError } from "@/lib/supabase/sessao";
import { ehEmailDeTeste, perfilParticipaDasTarefas } from "@/features/tarefas/lib/participacao";
import {
  ANEXO_BUCKET,
  ANEXO_MAX_BYTES,
  ANEXO_TIPOS,
  TAREFA_STATUS_ATIVOS,
  TAREFA_STATUS_ENCERRADOS,
  type AnexoMomento,
  type NovidadeTipo,
  type PessoaEquipe,
  type Tarefa,
  type TarefaAcao,
  type TarefaAnexo,
  type TarefaMensagem,
  type TarefaPrioridade,
  type TarefaTipo
} from "@/features/tarefas/types";

/**
 * Leitura direta pelo cliente Supabase (o RLS filtra o que cada um ve).
 * Escrita de tarefa e de anexo so pelas rotas /api/tarefas; "visto" e gravado
 * direto (o RLS so aceita a linha do proprio usuario numa tarefa que ele ve).
 */

export type AbaTarefas = "minhas" | "criadas" | "todas" | "melhorias";
export type SituacaoFiltro = "abertas" | "encerradas";

const LIMITE_LISTA = 300;
const SELECT_TAREFA = "*, tarefas_equipe_destinatarios(user_id)";

type LinhaTarefa = Omit<Tarefa, "destinatarios"> & { tarefas_equipe_destinatarios?: { user_id: string }[] | null };

function paraTarefa(linha: LinhaTarefa): Tarefa {
  const { tarefas_equipe_destinatarios: dest, ...resto } = linha;
  return { ...resto, destinatarios: (dest ?? []).map((d) => d.user_id) };
}

function cliente() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase indisponível.");
  return supabase;
}

/** Tarefas em que sou destinatario escolhido (para o filtro de Minhas). */
async function idsOndeSouDestinatario(userId: string): Promise<number[]> {
  const { data, error } = await cliente()
    .from("tarefas_equipe_destinatarios")
    .select("tarefa_id")
    .eq("user_id", userId)
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((d: { tarefa_id: number }) => d.tarefa_id);
}

export async function listarTarefas(params: {
  aba: AbaTarefas;
  situacao: SituacaoFiltro;
  userId: string;
  /** Participo das Tarefas? So quem participa recebe as tarefas "para todos". */
  participa: boolean;
}): Promise<Tarefa[]> {
  const statuses = params.situacao === "abertas" ? TAREFA_STATUS_ATIVOS : TAREFA_STATUS_ENCERRADOS;
  let query = cliente().from("tarefas_equipe").select(SELECT_TAREFA).in("status", statuses);

  if (params.aba === "melhorias") {
    query = query.eq("tipo", "MELHORIA");
  } else {
    query = query.eq("tipo", "TAREFA");
    if (params.aba === "criadas") query = query.eq("criado_por_user_id", params.userId);
    if (params.aba === "minhas") {
      // Minhas = assumidas por mim, OU em que sou destinatario, OU para todos ainda sem responsavel.
      const ids = await idsOndeSouDestinatario(params.userId);
      const ou = [
        `responsavel_user_id.eq.${params.userId}`,
        ...(params.participa ? ["and(para_todos.is.true,responsavel_user_id.is.null)"] : []),
        ...(ids.length > 0 ? [`id.in.(${ids.join(",")})`] : [])
      ];
      query = query.or(ou.join(","));
    }
  }

  // Prioridade primeiro; depois a data (em aberto: mais antiga primeiro).
  query = query
    .order("prioridade_ordem", { ascending: false })
    .order("created_at", { ascending: params.situacao === "abertas" })
    .limit(LIMITE_LISTA);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as LinhaTarefa[]).map(paraTarefa);
}

/** Tarefas ligadas a um pedido (as que o usuario pode ver). */
export async function listarTarefasDoPedido(idInt: number): Promise<Tarefa[]> {
  const { data, error } = await cliente()
    .from("tarefas_equipe")
    .select(SELECT_TAREFA)
    .eq("id_int", idInt)
    .order("prioridade_ordem", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return ((data ?? []) as LinhaTarefa[]).map(paraTarefa);
}

/**
 * Abrir a tarefa = ver. Regrava a hora da ultima abertura (funcao do banco:
 * so grava a linha do proprio usuario, e so de tarefa que ele enxerga).
 */
export async function marcarVista(tarefaId: number): Promise<void> {
  const { error } = await cliente().rpc("tarefas_equipe_marcar_vista", { p_tarefa: tarefaId });
  if (error) console.warn("[tarefas] Falha ao marcar como vista:", error.message);
}

/**
 * Tarefas com novidade para mim: recebidas que nunca abri, e as que tiveram
 * mensagem, assumir, concluir ou cancelar de outra pessoa depois da minha
 * ultima abertura. A regra mora no banco (`tarefas_equipe_novas`).
 */
export async function listarNovas(): Promise<Map<number, NovidadeTipo>> {
  const mapa = new Map<number, NovidadeTipo>();
  const supabase = getSupabaseClient();
  if (!supabase) return mapa;
  const { data, error } = await supabase.rpc("tarefas_equipe_novas");
  if (error) {
    console.warn("[tarefas] Falha ao ler as novidades:", error.message);
    return mapa;
  }
  for (const linha of (data ?? []) as { tarefa_id: number; tipo: NovidadeTipo }[]) mapa.set(linha.tarefa_id, linha.tipo);
  return mapa;
}

/** Contador do menu e da Topbar: minhas tarefas em aberto. */
export async function contarMinhas(): Promise<number> {
  const supabase = getSupabaseClient();
  if (!supabase) return 0;
  const { data, error } = await supabase.rpc("tarefas_equipe_resumo");
  if (error) {
    console.warn("[tarefas] Falha ao ler o resumo:", error.message);
    return 0;
  }
  const linha = (Array.isArray(data) ? data[0] : data) as { minhas?: number } | null;
  return linha?.minhas ?? 0;
}

export async function listarMensagens(tarefaId: number): Promise<TarefaMensagem[]> {
  const { data, error } = await cliente()
    .from("tarefas_equipe_mensagens")
    .select("id, tarefa_id, autor_user_id, mensagem, created_at")
    .eq("tarefa_id", tarefaId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as TarefaMensagem[];
}

export async function listarAnexos(tarefaId: number): Promise<TarefaAnexo[]> {
  const { data, error } = await cliente()
    .from("tarefas_equipe_anexos")
    .select("id, tarefa_id, momento, mensagem_id, nome_arquivo, tipo_mime, tamanho_bytes, enviado_por_user_id, created_at")
    .eq("tarefa_id", tarefaId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as TarefaAnexo[];
}

type PerfilLinha = { id: number; permissoes: unknown; ativo: boolean };
type UsuarioLinha = { user_id: string; nome_usuario: string | null; email: string | null; id_perfil: number | null };

/**
 * Pessoas que podem receber tarefa. Mesmo criterio do banco
 * (`tarefas_equipe__eh_da_equipe`): perfil ativo com `tarefas.participar` (ou
 * `*`) e e-mail que nao e de teste. Ver lib/participacao.ts.
 */
export async function listarPessoasEquipe(): Promise<PessoaEquipe[]> {
  const supabase = cliente();
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
    if (!permissoes || !perfilParticipaDasTarefas(permissoes) || ehEmailDeTeste(u.email)) continue;
    pessoas.push({
      user_id: u.user_id,
      nome: u.nome_usuario?.trim() || u.email || "Sem nome",
      admin: permissoes.includes("*") || permissoes.includes("admin.usuarios.view")
    });
  }
  return pessoas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Nomes de todos os usuarios (para mostrar quem criou, recebeu, concluiu). */
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

type RespostaRota = { success: boolean; message?: string; id?: number; [k: string]: unknown };

async function chamar(url: string, init: RequestInit): Promise<RespostaRota> {
  try {
    const res = await fetchComSessao(url, init);
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

const postar = (url: string, corpo: unknown) =>
  chamar(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });

export function criarTarefa(dados: {
  tipo: TarefaTipo;
  titulo: string;
  descricao: string;
  prioridade: TarefaPrioridade;
  destinatarios: string[];
  para_todos: boolean;
  id_int: string;
  id_cliente: string;
  data_limite: string;
}) {
  return postar("/api/tarefas", dados);
}

export function mudarSituacaoTarefa(id: number, acao: TarefaAcao, observacao?: string) {
  return postar(`/api/tarefas/${id}/situacao`, { acao, observacao });
}

/** Escreve na conversa da tarefa, sem mudar a situacao. Devolve o id da mensagem. */
export function enviarMensagem(tarefaId: number, mensagem: string) {
  return postar(`/api/tarefas/${tarefaId}/mensagens`, { mensagem });
}

/** Erro de validacao local do arquivo, ou null se pode enviar. */
export function validarArquivo(arquivo: File): string | null {
  if (!ANEXO_TIPOS[arquivo.type]) return `"${arquivo.name}": só PDF ou imagem (PNG, JPG, WEBP, GIF).`;
  if (arquivo.size <= 0) return `"${arquivo.name}" está vazio.`;
  if (arquivo.size > ANEXO_MAX_BYTES) return `"${arquivo.name}" passa de 10 MB.`;
  return null;
}

/** Envia um anexo: pede o link assinado, sobe direto ao bucket e registra. */
export async function enviarAnexo(
  tarefaId: number,
  arquivo: File,
  momento: AnexoMomento,
  mensagemId?: number
): Promise<RespostaRota> {
  const invalido = validarArquivo(arquivo);
  if (invalido) return { success: false, message: invalido };

  const prep = await postar(`/api/tarefas/${tarefaId}/anexos/preparar`, {
    nome: arquivo.name,
    tipo: arquivo.type,
    tamanho: arquivo.size,
    momento
  });
  if (!prep.success) return prep;

  const caminho = String(prep.caminho);
  const { error } = await cliente()
    .storage.from(ANEXO_BUCKET)
    .uploadToSignedUrl(caminho, String(prep.token), arquivo, { contentType: arquivo.type });
  if (error) return { success: false, message: `Falha ao enviar "${arquivo.name}": ${error.message}` };

  return postar(`/api/tarefas/${tarefaId}/anexos`, { caminho, nome: arquivo.name, momento, mensagem_id: mensagemId ?? null });
}

/** Pede o link assinado curto e abre o download. */
export async function baixarAnexo(anexoId: number): Promise<RespostaRota> {
  const r = await chamar(`/api/tarefas/anexos/${anexoId}`, { method: "GET" });
  if (r.success && typeof r.url === "string") window.location.assign(r.url);
  return r;
}

export function tamanhoLegivel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
