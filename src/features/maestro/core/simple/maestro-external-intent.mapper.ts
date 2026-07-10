/**
 * maestro-external-intent.mapper.ts
 *
 * Mapeia a intenção detectada pela camada externa para o RouterResult interno
 * compreendido pelo Maestro (AllowedToolName).
 */

import type { RouterResult } from './maestro-v2-router';
import { ALLOWED_EXTERNAL_INTENTS, type ExternalIntentResponse } from './maestro-external-intent.types';
import type { MaestroV2Context } from './maestro-v2-context-manager';
import type { SimpleClientContext } from './maestro-simple-context';

export function mapExternalIntentToRouterResult(
  response: ExternalIntentResponse,
  v2Ctx: MaestroV2Context,
  activeClient: SimpleClientContext | null
): RouterResult | null {
  // 1. Valida whitelist
  if (!ALLOWED_EXTERNAL_INTENTS.includes(response.intent as any)) {
    console.warn(`[ExternalIntentMapper] Intent externa inválida ou não autorizada: ${response.intent}`);
    return null;
  }

  // 2. Rejeita ações sensíveis com baixa confiança
  const sensitiveIntents = [
    'salvar_proposta',
    'criar_cotacao',
    'selecionar_endereco',
    'selecionar_frete',
    'trocar_frete',
    'cancelar_cotacao'
  ];

  if (sensitiveIntents.includes(response.intent) && response.confidence === 'low') {
    console.warn(`[ExternalIntentMapper] Intent ${response.intent} rejeitada por baixa confiança.`);
    return null;
  }

  const p = response.params || {};

  switch (response.intent) {
    case 'buscar_cliente':
      if (!p.busca) return null;
      return { routed: true, plan: { steps: [{ tool: 'buscarCliente', params: { busca: p.busca } }] } };

    case 'criar_cotacao':
      if (!p.itens || !Array.isArray(p.itens) || p.itens.length === 0) return null;
      return { routed: true, plan: { steps: [{ tool: 'simularOrcamentoAvulso', params: { itens: p.itens } }] } };

    case 'repetir_orcamento_para_outro_cliente':
      // Mapeia para buscarCliente, o engine fará a junção com lastExplicitBudgetItems automaticamente
      if (!p.busca_cliente) return null;
      // Para funcionar, garantimos que domain='orcamento_avulso' e orcamentoItens esteja preenchido
      if (v2Ctx.lastExplicitBudgetItems && v2Ctx.lastExplicitBudgetItems.length > 0) {
        v2Ctx.orcamentoItens = [...v2Ctx.lastExplicitBudgetItems];
        v2Ctx.domain = 'orcamento_avulso';
      }
      return { routed: true, plan: { steps: [{ tool: 'buscarCliente', params: { busca: p.busca_cliente } }] } };

    case 'selecionar_endereco':
      if (typeof p.addressIndex !== 'number') return null;
      return { routed: true, plan: { steps: [{ tool: 'simularOrcamentoAvulso', params: { addressIndex: p.addressIndex } }] } };

    case 'selecionar_frete':
      if (typeof p.freteIndex !== 'number') return null;
      return { routed: true, plan: { steps: [{ tool: 'confirmar_frete_cotacao', params: { freteIndex: p.freteIndex } }] } };

    case 'trocar_frete':
      if (!p.transportadora_mencionada) return null;
      // Não temos o ID exato, então usamos 'frete_nao_disponivel' para disparar a lógica do presenter 
      // ou esperamos que o Router original handleFreightSwitch lide com a string.
      // O router interno trata troca por ID ou listagem.
      // Aqui delegamos pro router resolver a string se possível, ou rejeitamos para cair no fallback.
      return null; // Melhor deixar o router local lidar com a regex de "mudar frete" ou listar.

    case 'consultar_cotacao_ativa':
      return { routed: true, plan: { steps: [{ tool: 'consultar_cotacao_ativa', params: { query: p.query || 'resumo' } }] } };

    case 'cancelar_cotacao':
      return { routed: true, plan: { steps: [{ tool: 'cancelar_orcamento_avulso', params: {} }] } };

    case 'salvar_proposta':
      // Apenas avança para a confirmação de save. A escrita direta (salvarCotacaoComoPropostaReal) é bloqueada aqui.
      return { routed: true, plan: { steps: [{ tool: 'salvar_cotacao_confirmada', params: {} }] } };

    case 'consultar_campo_cliente':
      if (!p.campo) return null;
      return { routed: true, plan: { steps: [{ tool: 'consultarCampoCadastro', params: { campo: p.campo } }] } };

    case 'consultar_financeiro':
      if (!p.tipo || !p.periodo) return null;
      if (p.tipo === 'comparar_meses') {
          return { routed: true, plan: { steps: [{ tool: 'compararRecebimentoClienteMeses', params: { meses: Array.isArray(p.periodo) ? p.periodo : [p.periodo] } }] } };
      }
      return { routed: true, plan: { steps: [{ tool: 'consultarRecebimentoClientePeriodo', params: { periodo: p.periodo } }] } };

    case 'mensagem_frustracao':
      return { routed: true, plan: { steps: [{ tool: 'resposta_frustracao_usuario', params: {} }] } };

    case 'social_response':
      return { routed: true, plan: { steps: [{ tool: 'resposta_social_cotacao', params: {} }] } };

    case 'fallback_clarificacao':
      return { routed: true, plan: { steps: [{ tool: 'requisicao_nao_suportada', params: {} }] } };

    default:
      return null;
  }
}
