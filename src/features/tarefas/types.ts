/**
 * Tarefas da equipe e lista de melhorias (tabela `public.tarefas_equipe`).
 * Especificacao: docs/superpowers/specs/2026-09-30-tarefas-equipe-design.md
 */

export type TarefaTipo = "TAREFA" | "MELHORIA";
export type TarefaStatus = "ABERTA" | "EM_ANDAMENTO" | "CONCLUIDA" | "CANCELADA";
export type TarefaAcao = "assumir" | "concluir" | "cancelar";

export type Tarefa = {
  id: number;
  tipo: TarefaTipo;
  titulo: string;
  descricao: string | null;
  responsavel_user_id: string | null;
  id_int: number | null;
  id_cliente: number | null;
  data_limite: string | null;
  status: TarefaStatus;
  criado_por_user_id: string;
  created_at: string;
  updated_at: string;
  assumido_por_user_id: string | null;
  assumido_at: string | null;
  concluido_por_user_id: string | null;
  concluido_at: string | null;
  observacao_conclusao: string | null;
  cancelado_por_user_id: string | null;
  cancelado_at: string | null;
};

/** Pessoa que pode receber tarefa: perfil ativo com alguma permissao. */
export type PessoaEquipe = {
  user_id: string;
  nome: string;
  admin: boolean;
};

export const TAREFA_STATUS_ATIVOS: TarefaStatus[] = ["ABERTA", "EM_ANDAMENTO"];
export const TAREFA_STATUS_ENCERRADOS: TarefaStatus[] = ["CONCLUIDA", "CANCELADA"];

export const TAREFA_STATUS_ROTULO: Record<TarefaStatus, string> = {
  ABERTA: "Aberta",
  EM_ANDAMENTO: "Em andamento",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada"
};

export const TITULO_MAX = 200;
export const DESCRICAO_MAX = 5000;
export const OBSERVACAO_MAX = 1000;
