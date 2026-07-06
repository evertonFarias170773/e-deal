/**
 * index.ts — Knowledge Base Canônica do Maestro ERP Ideal
 *
 * Exporta a estrutura unificada ERP_IDEAL_KNOWLEDGE_BASE e todos os módulos.
 * Use este arquivo para consumir o conhecimento no Prompt Builder, Planner e Context Engine.
 */

export * from './erp-ideal.context';
export * from './erp-relationships';
export * from './business-rules';
export * from './finance-rules';
export * from './fiscal-rules';
export * from './security-rules';

// ---------------------------------------------------------------------------
// Knowledge Base Unificada
// ---------------------------------------------------------------------------

import { ERP_IDENTITY, MAESTRO_IDENTITY } from './erp-ideal.context';
import { ERP_ENTITIES, ID_INT_RELACIONAMENTOS, ID_CLIENTE_RELACIONAMENTOS } from './erp-relationships';
import { PROPOSTA_STATUS_GRUPOS, REGRAS_PEDIDO_REAL, REGRAS_OS } from './business-rules';
import { FINANCE_TABLES, REGRAS_STATUS_PAGAMENTO, REGRAS_ACESSO_FINANCEIRO, CAMPOS_FINANCEIROS_SENSIVEIS } from './finance-rules';
import { FISCAL_TIPOS, MAESTRO_ACOES_FISCAIS } from './fiscal-rules';
import { CLASSIFICACAO_DADOS, CAMPOS_PROIBIDOS, REGRAS_CONDUTA, TRILHO_LIBERACAO } from './security-rules';

/**
 * Estrutura canônica consolidada.
 * Usada pelo Prompt Builder para gerar instruções resumidas ao Maestro.
 */
export const ERP_IDEAL_KNOWLEDGE_BASE = {
  identidade: {
    erp: ERP_IDENTITY,
    maestro: MAESTRO_IDENTITY,
  },

  entidades: ERP_ENTITIES,

  relacionamentos: {
    porIdInt: ID_INT_RELACIONAMENTOS,
    porIdCliente: ID_CLIENTE_RELACIONAMENTOS,
  },

  regrasNegocio: {
    statusProposta: PROPOSTA_STATUS_GRUPOS,
    pedidoReal: REGRAS_PEDIDO_REAL,
    os: REGRAS_OS,
  },

  regrasFinanceiras: {
    tabelas: FINANCE_TABLES,
    identificarStatus: REGRAS_STATUS_PAGAMENTO,
    acessoSensivel: REGRAS_ACESSO_FINANCEIRO,
    camposSensiveis: CAMPOS_FINANCEIROS_SENSIVEIS,
  },

  regrasFiscais: {
    tipos: FISCAL_TIPOS,
    acoesPermitidas: MAESTRO_ACOES_FISCAIS,
  },

  seguranca: {
    classificacaoDados: CLASSIFICACAO_DADOS,
    camposProibidos: CAMPOS_PROIBIDOS,
    conduta: REGRAS_CONDUTA,
    trilhoLiberacao: TRILHO_LIBERACAO,
  },
} as const;

// ---------------------------------------------------------------------------
// Helpers para o Prompt Builder
// ---------------------------------------------------------------------------

/**
 * Gera um resumo textual das entidades ativas para inserção no system prompt.
 * Retorna apenas as que têm tool ativa ou planejada — não despeja a estrutura inteira.
 */
export function buildEntidadesSummary(): string {
  const linhas: string[] = [
    '## Entidades Principais do ERP',
    '',
  ];

  for (const [, entity] of Object.entries(ERP_ENTITIES)) {
    const statusIcon = entity.status === 'ativo' ? '✅' : '🔜';
    const tool = 'toolReadOnly' in entity ? ` | tool: ${entity.toolReadOnly}` : '';
    linhas.push(`- ${statusIcon} **${entity.label}** (${entity.tabela})${tool}`);
  }

  return linhas.join('\n');
}

/**
 * Gera resumo de regras de segurança críticas para o system prompt.
 */
export function buildSecuritySummary(): string {
  return [
    '## Regras de Segurança (invioláveis)',
    '',
    ...REGRAS_CONDUTA.proibicaoInventar.map(r => `- [PROIBIDO] ${r}`),
    '',
    '### Campos nunca exibidos diretamente:',
    CAMPOS_PROIBIDOS.map(c => `\`${c}\``).join(', '),
    '',
    '### Segurança funciona como trilho progressivo:',
    TRILHO_LIBERACAO.map(t => `${t.nivel}. **${t.label}**: ${t.descricao}`).join('\n'),
  ].join('\n');
}

/**
 * Gera resumo das regras de fallback para o system prompt.
 */
export function buildFallbackInstructions(): string {
  return [
    '## Instruções de Fallback',
    '',
    'Quando a ferramenta necessária não estiver conectada:',
    '1. Identifique o que o usuário quer consultar.',
    '2. Identifique qual domínio e qual tool precisaria.',
    '3. Mencione o cliente/contexto ativo, se houver.',
    '4. Explique que a ferramenta ainda não está conectada nesta fase.',
    '5. Nunca invente o dado. Nunca responda "não sei" sem alternativa.',
    '',
    'Exemplos de fallback assistivo:',
    '- Financeiro: "Entendi que você quer consultar pagamentos do cliente [X]. A ferramenta financeira ainda não está conectada."',
    '- Pedido: "Entendi que você quer o último pedido de [X]. A ferramenta propostas.consultar está planejada para a próxima fase."',
    '- OS: "Para verificar se existe OS vinculada, precisaria consultar public.propostas_os, que ainda não está conectada ao Maestro."',
    '- NF: "Para status de NF, encaminhe ao módulo Fiscal. O Maestro não emite nem cancela notas."',
  ].join('\n');
}
