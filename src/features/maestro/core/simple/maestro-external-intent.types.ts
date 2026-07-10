/**
 * maestro-external-intent.types.ts
 *
 * Contratos de interface para a camada de interpretação de intenções externa (Agent Service / n8n).
 */

export type ExternalIntentName =
  | 'social_response'
  | 'buscar_cliente'
  | 'criar_cotacao'
  | 'repetir_orcamento_para_outro_cliente'
  | 'selecionar_endereco'
  | 'selecionar_frete'
  | 'trocar_frete'
  | 'consultar_cotacao_ativa'
  | 'cancelar_cotacao'
  | 'salvar_proposta'
  | 'consultar_campo_cliente'
  | 'consultar_financeiro'
  | 'mensagem_frustracao'
  | 'fallback_clarificacao';

export const ALLOWED_EXTERNAL_INTENTS: ExternalIntentName[] = [
  'social_response',
  'buscar_cliente',
  'criar_cotacao',
  'repetir_orcamento_para_outro_cliente',
  'selecionar_endereco',
  'selecionar_frete',
  'trocar_frete',
  'consultar_cotacao_ativa',
  'cancelar_cotacao',
  'salvar_proposta',
  'consultar_campo_cliente',
  'consultar_financeiro',
  'mensagem_frustracao',
  'fallback_clarificacao'
];

export interface ExternalIntentResponse {
  intent: ExternalIntentName | string;
  confidence: 'high' | 'medium' | 'low';
  params: Record<string, any>;
  reasoning?: string;
}

export interface ExternalIntentPayload {
  query: string;
  currentDateIso: string;
  activeClient: {
    clientInternalId?: number;
    clientDisplayCode: string;
    clientName: string;
    clientFantasia?: string;
  } | null;
  v2Context: {
    domain: string;
    lastTool: string | null;
    hasPendingAddressChoice: boolean;
    hasPendingFreightChoice: boolean;
    hasPendingSaveQuotation: boolean;
    hasActiveQuote: boolean;
    orcamentoItensCount: number;
    pendingClientCandidatesCount: number;
  };
  lastAnswer: {
    type?: string;
    label?: string;
    value?: string;
  } | null;
  recentTurns: Array<{ role: string; content: string }>;
}
