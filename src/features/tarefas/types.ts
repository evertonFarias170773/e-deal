/**
 * Tarefas da equipe — central única de pendências (tabela `public.tarefas_equipe`).
 * Especificacao: docs/superpowers/specs/2026-09-30-tarefas-equipe-design.md
 */

export type TarefaTipo = "TAREFA" | "MELHORIA";
export type TarefaStatus = "ABERTA" | "EM_ANDAMENTO" | "CONCLUIDA" | "CANCELADA";
export type TarefaAcao = "assumir" | "concluir" | "cancelar";
export type TarefaPrioridade = "NORMAL" | "ALTA" | "URGENTE";
export type AnexoMomento = "CRIACAO" | "ANDAMENTO" | "CONCLUSAO";

export type Tarefa = {
  id: number;
  tipo: TarefaTipo;
  titulo: string;
  descricao: string | null;
  prioridade: TarefaPrioridade;
  prioridade_ordem: number;
  para_todos: boolean;
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
  /** user_id dos destinatarios escolhidos (vazio em tarefa para todos e em melhoria). */
  destinatarios: string[];
};

export type TarefaAnexo = {
  id: number;
  tarefa_id: number;
  momento: AnexoMomento;
  nome_arquivo: string;
  tipo_mime: string;
  tamanho_bytes: number;
  enviado_por_user_id: string;
  created_at: string;
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

export const PRIORIDADES: TarefaPrioridade[] = ["NORMAL", "ALTA", "URGENTE"];
export const PRIORIDADE_ROTULO: Record<TarefaPrioridade, string> = {
  NORMAL: "Normal",
  ALTA: "Alta",
  URGENTE: "Urgente"
};

export const MOMENTO_ROTULO: Record<AnexoMomento, string> = {
  CRIACAO: "na criação",
  ANDAMENTO: "durante a tarefa",
  CONCLUSAO: "na conclusão"
};

export const TITULO_MAX = 200;
export const DESCRICAO_MAX = 5000;
export const OBSERVACAO_MAX = 1000;

/** Mesmo limite e tipos do bucket `tarefas-anexos`. */
export const ANEXO_BUCKET = "tarefas-anexos";
export const ANEXO_MAX_BYTES = 10 * 1024 * 1024;
export const ANEXO_TIPOS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif"
};
export const ANEXO_ACCEPT = Object.keys(ANEXO_TIPOS).join(",");
