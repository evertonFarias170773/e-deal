// TYPES: src/features/producao/types.ts
// Descrição: Tipagens estáticas para as tabelas pedidos_modelos e pedidos_artes

export type StatusArteProducao =
  | "PENDENTE"
  | "EM_CRIACAO"
  | "EM_REVISAO_INTERNA"
  | "AGUARDANDO_CLIENTE"
  | "REPROVADA_CLIENTE"
  | "APROVADA_CLIENTE"
  | "LIBERADA"
  | "IMPRESSA"
  | "NAO_NECESSARIA";

export type StatusProducaoModelo =
  | "PENDENTE"
  | "EM_IMPRESSAO"
  | "EM_ACABAMENTO"
  | "CONCLUIDA"
  | "PAUSADA"
  | "CANCELADA";

// Aliases para compatibilidade anterior
export type ArteStatus = StatusArteProducao;
export type ProducaoStatus = StatusProducaoModelo;

export interface PedidoModelo {
  id: string; // uuid
  id_int: number;
  id_pedido: string | null; // uuid
  id_item: string | null; // uuid
  id_produto_proposta_origem: number | null; // bigint
  nome_modelo: string;
  descricao: string | null;
  quantidade: number;
  tipo_numeracao: string | null;
  numeracao_inicio: number | null;
  numeracao_fim: number | null;
  obs_impressao: string | null;
  status_arte: StatusArteProducao;
  status_producao: StatusProducaoModelo;
  ordem: number;
  created_at: string;
  updated_at: string | null;
}

export type PedidosModelo = PedidoModelo;

export interface PedidoArte {
  id: string; // uuid
  id_int: number;
  arquivos?: any[] | null; // jsonb array of ArquivoReferencia
  // Campos de briefing da Aba Artes
  nome_evento?: string | null;
  data_evento?: string | null;
  local_evento?: string | null;
  observacoes?: any | null; // jsonb
  designer_uid?: string | null;
  designer_nome?: string | null;
  // Cadastro do Boletim de Produção (campos próprios do boletim)
  setor?: string | null;
  hora?: string | null; // TIME (HH:MM)
  status: StatusArteProducao;
  comentarios_revisao: string | null;
  enviado_por: string | null;
  enviado_por_uid: string | null; // uuid
  aprovado_por: string | null;
  data_aprovacao: string | null;
  created_at: string;
  updated_at: string | null;
}

export type PedidosArte = PedidoArte;
