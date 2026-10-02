/**
 * Tarefas da equipe — central única de pendências (tabela `public.tarefas_equipe`).
 * Especificacao: docs/superpowers/specs/2026-09-30-tarefas-equipe-design.md
 */

export type TarefaTipo = "TAREFA" | "MELHORIA";
export type TarefaStatus = "ABERTA" | "EM_ANDAMENTO" | "CONCLUIDA" | "CANCELADA";
export type TarefaAcao = "assumir" | "concluir" | "cancelar";
export type TarefaPrioridade = "NORMAL" | "ALTA" | "URGENTE";
export type AnexoMomento = "CRIACAO" | "ANDAMENTO" | "CONCLUSAO" | "MENSAGEM";
/** Ultima novidade da tarefa: faz o sinal piscar para os outros participantes. */
export type NovidadeTipo = "CRIADA" | "MENSAGEM" | "ASSUMIDA" | "CONCLUIDA" | "CANCELADA" | "ALTERADA";

/**
 * Linha do historico de prazo e prioridade. So a trigger de guarda escreve:
 * uma entrada por campo mudado. `de`/`para` sao "AAAA-MM-DD" (ou null, sem
 * prazo) em PRAZO, e o codigo da prioridade em PRIORIDADE.
 */
export type TarefaAlteracao = {
  em: string;
  por: string | null;
  campo: "PRAZO" | "PRIORIDADE";
  de: string | null;
  para: string | null;
};

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
  novidade_em: string | null;
  novidade_por_user_id: string | null;
  novidade_tipo: NovidadeTipo | null;
  /** Historico de mudancas de prazo e prioridade, em ordem. */
  alteracoes?: TarefaAlteracao[] | null;
  /** user_id dos destinatarios escolhidos (vazio em tarefa para todos e em melhoria). */
  destinatarios: string[];
};

export type TarefaAnexo = {
  id: number;
  tarefa_id: number;
  momento: AnexoMomento;
  /** Mensagem da conversa a que o anexo pertence (momento MENSAGEM). */
  mensagem_id: number | null;
  nome_arquivo: string;
  tipo_mime: string;
  tamanho_bytes: number;
  enviado_por_user_id: string;
  created_at: string;
};

/** Mensagem da conversa da tarefa. Ninguem edita nem apaga. */
export type TarefaMensagem = {
  id: number;
  tarefa_id: number;
  autor_user_id: string;
  mensagem: string;
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
  CONCLUSAO: "na conclusão",
  MENSAGEM: "na conversa"
};

export const TITULO_MAX = 200;
export const DESCRICAO_MAX = 5000;
export const OBSERVACAO_MAX = 1000;
export const MENSAGEM_MAX = 2000;

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
