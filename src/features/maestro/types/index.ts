export type MessageRole = 'user' | 'maestro' | 'system';

export type MessageContentType =
  | 'text'
  | 'card'
  | 'table'
  | 'list'
  | 'badge'
  | 'summary'
  | 'actions'
  | 'sources';

export type SpecialistType =
  | 'comercial'
  | 'financeiro'
  | 'produtos'
  | 'producao'
  | 'fiscal'
  | 'expedicao'
  | 'geral';

import type { ExecutionPlan } from '../core/planner/planner.types';
import type { RegistryResolution } from '../core/registry/registry.result';
import type { ToolResult } from '../core/tools/tools.types';
import type { PolicyDecision } from '../core/policy/policy.result';
import type { ResponseModel, ResponseMetadata } from '../core/response/response.types';

export interface MessageSource {
  table: string;
  label: string;
  queriedAt: string;
}

export interface MessageComponent {
  type: MessageContentType;
  data: unknown;
}

export type MessageStatus = 'waiting' | 'thinking' | 'streaming' | 'completed' | 'error';

export interface MaestroAction {
  /** Texto exibido no botão */
  label: string;
  /** Texto enviado ao chat ao clicar, ou URL iniciando com '/' para navegação */
  value: string;
  /** Estilo visual do botão */
  style?: 'primary' | 'danger' | 'default';
}

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  contentType?: MessageContentType;
  components?: MessageComponent[];
  sources?: MessageSource[];
  specialist?: SpecialistType;
  timestamp: string;
  confidence?: 'high' | 'medium' | 'low';
  isStreaming?: boolean;
  status?: MessageStatus;
  
  responseModel?: ResponseModel;
  responseMetadata?: ResponseMetadata;
  /** Botões de ação inline exibidos abaixo da mensagem */
  actions?: MaestroAction[];
}


export interface ActivityStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
  detail?: string;
  timestamp?: string;
}

export interface ConversationContext {
  rawQuery?: string;

  // ── Identificadores de cliente (separados para evitar ambiguidade) ──────────
  /** Código de exibição ao usuário (ex: "8469"). Pode ser string. Retrocompat. */
  clientId?: string;
  /** Código de exibição ao usuário (ex: "8469"). Alias explícito de clientId. */
  clientDisplayCode?: string;
  /** ID inteiro interno do banco (propostas.id_cliente). Usado em filtros SQL. */
  clientInternalId?: number;
  /** Nome/razão social do cliente */
  clientName?: string;
  /** CPF ou CNPJ do cliente (mascarado quando exibido) */
  clientDocument?: string;
  /** Cidade / UF do cliente (ex: "Porto Alegre/RS") */
  clientCityUf?: string;

  // ── Campos legados preservados para retrocompatibilidade ────────────────────
  clientCode?: string;
  clientCnpj?: string;
  /** Texto de busca por nome quando não há código numérico (ex: 'LISITON DOCUMENTOS') */
  clientSearchName?: string;

  // ── Dados extras do cliente ativo (populados após clientes.consultar) ───────
  /** Telefone fixo ou WhatsApp do cliente */
  clientTelefone?: string | null;
  /** Nome do vendedor vinculado ao cliente */
  clientVendedor?: string | null;
  /** Limite de crédito do cliente */
  clientLimiteCredito?: number | null;
  /** Crédito disponível do cliente */
  clientCredito?: number | null;
  /** E-mail do cliente */
  clientEmail?: string | null;
  /** Data de fundação/abertura do cliente */
  clientDataFundacao?: string | null;
  /** Quantidade de pedidos históricos (vw_cadastros_clientes_lista.qtd_pedidos) */
  clientQtdPedidos?: number | null;
  /** Data do último pedido (vw_cadastros_clientes_lista.data_ult_pedido) */
  clientDataUltPedido?: string | null;
  /** Última resposta serializada (JSON de LastAnswerRecord) — persiste entre turnos */
  clientLastAnswerJson?: string | null;
  /** Padrão de pagamento do cliente */
  clientPadraoPagamento?: string | null;
  /** Categoria do cliente */
  clientCategoria?: string | null;
  /** Risco de crédito do cliente */
  clientRiscoCredito?: string | null;
  /** Indica se o cliente tem alguma restrição */
  clientRestricao?: boolean | null;
  /** Indica se o cadastro está ativo */
  clientAtivo?: boolean | null;
  /** Flag de bônus comercial do cliente */
  clientIsBonus?: boolean | null;
  /** Percentual de bônus comercial do cliente */
  clientPercentualBonus?: number | null;
  /** Indica se o cliente usa preço fixo */
  clientUsaPrecoFixo?: boolean | null;
  /** JSON da lista de preços fixos do cliente */
  clientPrecosFixosJson?: string | null;


  // ── Contexto de proposta/pedido ativo ───────────────────────────────────────
  proposalId?: string;
  proposalValue?: number;
  proposalStatus?: string;
  /** id_int ativo (número inteiro da proposta/pedido, ex: 18560) */
  activeIdInt?: number;
  /** status_interno da proposta ativa */
  activeProposalStatus?: string;
  /** true se a proposta ativa é um pedido real (is_prd_aprovado=true) */
  activeIsRealOrder?: boolean;

  orderId?: string;
  specialist?: SpecialistType;
  activeEntities?: {
    clientId?: string;
    clientInternalId?: number;
    clientName?: string;
    clientSearchName?: string; // ← Adicionado
    proposalId?: string;
    activeIdInt?: number;
  };
  company?: string;
  intentId?: string;
  intent?: string;
  domain?: string;
  targetObject?: string;
  confidence?: 'high' | 'medium' | 'low';
  contextSummary?: string;
  activePlan?: ExecutionPlan;
  registryResolution?: RegistryResolution;
  toolResults?: Record<string, ToolResult>;
  policyDecisions?: Record<string, PolicyDecision>;
  v2ContextJson?: string | null;
  /** Conversa persistida no Supabase (quando MAESTRO_PERSISTENCE_ENABLED=true) */
  conversationId?: string | null;
}

export interface ConversationSession {
  id: string;
  title: string;
  summary: string;
  lastMessage: string;
  updatedAt: string;
  specialist?: SpecialistType;
}

export interface MaestroSuggestion {
  id: string;
  label: string;
  description: string;
  icon: string;
  query: string;
  specialist: SpecialistType;
}
