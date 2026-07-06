/**
 * maestro-simple-context.ts
 *
 * Contexto simples e plano do Maestro Simple v1.
 * Evoluído para "Cliente Detalhado" (Fase Cliente 100%).
 * Contém dados do cliente, endereços, contatos e sócios — sem dependências de orçamentos.
 */

// ─── Registro da Última Resposta ───────────────────────────────────────────

/**
 * Guarda evidência da última resposta dada pelo Maestro.
 * Usado para responder "tem certeza?" / "qual a fonte?" com precisão.
 */
export interface LastAnswerRecord {
  type: 'field' | 'client_found' | 'summary' | 'comparison' | 'other';
  field?: string;
  value: string;
  label: string;
  dbField?: string;
  source: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  answeredAt: string;
  data?: any;
}

// ─── Sub-Entidades ─────────────────────────────────────────────────────────

export interface EnderecoSimples {
  tipoEndereco: string | null;
  cep: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  obs: string | null; // Apenas para checagem interna, evite expor
}

export interface ContatoSimples {
  nomeContato: string | null;
  cargo: string | null;
  whats: string | null;
  email: string | null;
}

export interface SocioSimples {
  idClienteSocio: number | null;
  tipoRelacao: string | null;
  nomeSocio?: string; // Enriquecido via tabela clientes
}

// ─── Contexto do Cliente Ativo (Cliente Detalhado) ─────────────────────────

export interface SimpleClientContext {
  // Identificação Básica
  clientDisplayCode: string;
  clientInternalId?: number;
  clientName: string;
  clientFantasia?: string;
  clientDocument?: string;
  tipoPessoa?: string;

  // Contato Direto (tabela clientes)
  clientPhone?: string; // whatsapp_1 ou telefone_fixo
  clientWhatsapp2?: string;
  clientEmail?: string; // email prioritário
  clientEmailContato?: string;
  clientEmailFinanceiro?: string;

  // Localização Base
  clientCityUf?: string; // campo desnormalizado da tabela clientes
  
  // Comercial / Crédito
  clientSeller?: string;
  clientCredit?: number;
  clientCreditLimit?: number;
  isBonus?: boolean;
  percentualBonus?: number;
  riscoCredito?: string;
  restricao?: boolean;
  ativo?: boolean;
  padraoPagamento?: string;
  categoria?: string;


  // Datas
  clientDataFundacao?: string; // Data de fundação (nascimento)
  clientDataCadastro?: string; // Data de cadastro no ERP
  clientDataUltPedido?: string; // (Apenas prévia)
  clientQtdPedidos?: number;    // (Apenas prévia)

  // Metadados / Segurança
  obsInterna?: string; // mapeado, mas NÃO exibir por padrão

  // Relações (Fase Cliente 100%)
  enderecos: EnderecoSimples[];
  contatos: ContatoSimples[];
  socios: SocioSimples[];

  // Fontes de Rastreamento
  source: string;
  queriedAt: string;
  fontesRelacoes: {
    enderecos: string;
    contatos: string;
    socios: string;
  };
}

// ─── Contexto Global da Sessão ─────────────────────────────────────────────

export interface SimpleMaestroContext {
  activeClient: SimpleClientContext | null;
  lastAnswer: LastAnswerRecord | null;
}

/** Estado inicial limpo */
export const EMPTY_SIMPLE_CONTEXT: SimpleMaestroContext = {
  activeClient: null,
  lastAnswer: null,
};

// ─── Helpers ───────────────────────────────────────────────────────────────

export function hasActiveClient(ctx: SimpleMaestroContext): boolean {
  return ctx.activeClient !== null;
}

export function getClientLabel(ctx: SimpleMaestroContext): string {
  if (!ctx.activeClient) return 'cliente';
  const { clientName, clientDisplayCode } = ctx.activeClient;
  return clientName
    ? `${clientName} (${clientDisplayCode})`
    : `cliente ${clientDisplayCode}`;
}

export function serializeLastAnswer(record: LastAnswerRecord): string {
  return JSON.stringify(record);
}

export function deserializeLastAnswer(json: string | null | undefined): LastAnswerRecord | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as LastAnswerRecord;
  } catch {
    return null;
  }
}
