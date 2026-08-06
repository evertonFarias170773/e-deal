import { APP_NAME } from '@/constants/brand';
import type { ConversationContext } from '../../types';
import type { AIRequest } from './ai.types';
import type { ResponseModel, ResponseMetadata } from '../response/response.types';
import { specialistRegistry } from '../../specialists/specialist.registry';
import {
  buildEntidadesSummary,
  buildSecuritySummary,
  buildFallbackInstructions,
} from '../knowledge/index';

// ---------------------------------------------------------------------------
// Resumo de relacionamentos (inline — não despeja JSON gigante)
// ---------------------------------------------------------------------------

const RELACIONAMENTOS_RESUMO = `
## Relacionamentos Chave do ERP

### Chave id_int (chave transversal)
Um mesmo id_int conecta: propostas → produtos_proposta → pagamentos_v2 → propostas_os → pedidos_modelos → pedidos_artes → propostas_chat → propostas_pendencias → cotacao_frete.

### Chave id_cliente (chave de cliente)
Um mesmo id_cliente conecta: cadastros_clientes → propostas → pagamentos_v2 → boletos → propostas_pendencias.

### ATENÇÃO: dois IDs de cliente
- clientDisplayCode: código exibido ao usuário (ex: "8469") — string
- clientInternalId: inteiro interno do banco (propostas.id_cliente) — número
Nunca assumir que são iguais sem confirmar.
`.trim();

const REGRAS_NEGOCIO_RESUMO = `
## Regras de Negócio (resumo)

- public.propostas é a tabela central: representa orçamentos E pedidos (distinção por status_interno).
- Pedido real = is_prd_aprovado=true OU status_interno IN [REVISAO ATENDENTE, REVISAO PRODUCAO, EM PRODUCAO...].
- OS (Ordem de Serviço) está em public.propostas_os — só existe após liberação para produção.
- NUNCA chamar proposta de OS sem ter confirmado public.propostas_os.
- Proposta com status APROVADO ainda pode NÃO ser um pedido real.

## Regras Financeiras (resumo)

- pagamentos_v2 = cobrança geral do ERP (Pix, Link, Boleto, Cartão, E-Faturado).
- boletos = boleto bancário físico via C6 Bank (tabela separada).
- Pago: status=PAID ou paid_at preenchido.
- Vencido: status pendente + vencimento < hoje.
- Tipos E-* (E-Faturado, E-Retrabalho) exigem confirmação manual financeira.
- Dados sensíveis nunca exibidos: pix_copia_cola, linha_digitavel, token_publico, url_cobranca.

## Regras Fiscais (resumo)

- NF-e = produto físico (tabela notas_fiscais, modelo 55).
- NFS-e = serviço (tabela notas_servico).
- libera_nf=true habilita emissão de NF para aquele pedido.
- Maestro NUNCA emite, cancela ou altera nota fiscal.
`.trim();

// ---------------------------------------------------------------------------
// buildSystemPrompt — monta o prompt base usando a KB estruturada
// ---------------------------------------------------------------------------

export function buildSystemPrompt(context: ConversationContext): string {
  const specialistId = context.specialist || 'geral';
  const domain = context.domain || 'multidomínio';

  // ── Identidade e contexto ativo ──────────────────────────────────────────────
  let clienteInfo = '';
  if (context.clientName || context.clientId) {
    const codigo = context.clientDisplayCode || context.clientId || '';
    const nome = context.clientName || '';
    clienteInfo = `\nCLIENTE ATIVO: ${codigo} — ${nome}`;
    if (context.clientDocument) clienteInfo += `\n  CNPJ/CPF: ${context.clientDocument}`;
    if (context.clientCityUf) clienteInfo += `\n  Cidade/UF: ${context.clientCityUf}`;
    if (context.clientTelefone) clienteInfo += `\n  Telefone: ${context.clientTelefone}`;
    if (context.clientEmail) clienteInfo += `\n  E-mail: ${context.clientEmail}`;
    if (context.clientVendedor) clienteInfo += `\n  Vendedor: ${context.clientVendedor}`;
    if (typeof context.clientLimiteCredito === 'number') {
      clienteInfo += `\n  Limite de crédito: R$ ${context.clientLimiteCredito.toLocaleString('pt-BR')}`;
    }
    if (typeof context.clientCredito === 'number') {
      clienteInfo += `\n  Crédito disponível: R$ ${context.clientCredito.toLocaleString('pt-BR')}`;
    }
  }

  if (context.activeIdInt) {
    clienteInfo += `\nPROPOSTA/PEDIDO ATIVO: #${context.activeIdInt}`;
    if (context.activeProposalStatus) {
      clienteInfo += ` (status: ${context.activeProposalStatus})`;
    }
  }

  // ── Bloco de identidade e diretrizes gerais ─────────────────────────────────
  let prompt = `Você é o Maestro, assistente inteligente do ${APP_NAME} (Ideal Gráfica).
Papel: copiloto do ERP — não um chatbot genérico.
Especialista Ativo: [${specialistId.toUpperCase()}]
Domínio: [${domain.toUpperCase()}]${clienteInfo}

REGRAS FUNDAMENTAIS (MAESTRO-PROMPT-BASE v1.0):
1. Nunca invente dados. Se o campo vier nulo: diga "não cadastrado" — nunca exiba "—" sem explicação.
2. Nunca use jargões técnicos: não diga "tool", "policy engine", "id_int", "executor", "presenter".
3. Nunca exiba "Execução concluída", "Ação realizada" ou qualquer mensagem técnica de sistema.
4. Sempre cite a fonte quando o dado vier do ERP (ex: "Fonte: public.propostas · filtro: id_int = 18555").
5. Se há cliente ativo, perguntas com "ele", "dela", "desse cliente" referem-se a esse cliente.
6. Se não há cliente ativo e a pergunta for referencial: peça o código, nome ou CNPJ.
7. Seja direto: resposta curta para perguntas simples, completa para perguntas complexas.

FASE ATUAL: Cliente 100% (Fase 1 do Maestro)
Foco total em localizar clientes e responder perguntas básicas sobre eles.
Quando não há tool conectada para o domínio perguntado: explique com nome do cliente e indique o módulo correto do ERP.

FALLBACK CORRETO (exemplos obrigatórios):
- Sem cliente ativo + pergunta referencial: "Não tenho cliente ativo. Informe o código, nome ou CNPJ."
- Domínio não conectado: "Entendi que você quer saber sobre [DOMÍNIO] do cliente [NOME] ([CÓDIGO]). Essa área ainda não está conectada ao Maestro. Acesse o módulo [MÓDULO] do ERP."
- Dado nulo: "O campo [CAMPO] de [NOME DO CLIENTE] não está cadastrado no sistema."`;

  // ── Knowledge Base resumida ─────────────────────────────────────────────────
  prompt += `\n\n${buildEntidadesSummary()}`;
  prompt += `\n\n${RELACIONAMENTOS_RESUMO}`;
  prompt += `\n\n${REGRAS_NEGOCIO_RESUMO}`;
  prompt += `\n\n${buildSecuritySummary()}`;
  prompt += `\n\n${buildFallbackInstructions()}`;

  // ── Instruções do Especialista (dinâmicas, por domínio) ─────────────────────
  const specialist = specialistRegistry.resolve(specialistId);

  if (specialist) {
    prompt += `\n\n--- INSTRUÇÕES DO ESPECIALISTA (${specialist.name}) ---\n`;

    const prompts = specialist.getPrompts();
    if (prompts.length > 0) {
      prompt += `\nPOSTURA E TOM:\n`;
      prompts.forEach(p => (prompt += `- ${p}\n`));
    }

    const rules = specialist.getRules();
    if (rules.length > 0) {
      prompt += `\nREGRAS DE OPERAÇÃO (COMO AGIR):\n`;
      rules.forEach(r => (prompt += `- ${r}\n`));
    }

    const guardrails = specialist.getGuardrails();
    if (guardrails.length > 0) {
      prompt += `\nGUARDRAILS (O QUE NUNCA FAZER):\n`;
      guardrails.forEach(g => (prompt += `- [RESTRIÇÃO] ${g}\n`));
    }

    const examples = specialist.getExamples();
    if (examples.length > 0) {
      prompt += `\nEXEMPLOS DE ATUAÇÃO (FEW-SHOT):\n`;
      examples.forEach((ex, idx) => {
        prompt += `Exemplo ${idx + 1}:\n`;
        prompt += `  Usuário: "${ex.query}"\n`;
        if (ex.toolsUsed.length > 0) {
          prompt += `  Ferramentas Acionadas: [${ex.toolsUsed.join(', ')}]\n`;
        }
        prompt += `  Maestro: "${ex.expectedResponse}"\n\n`;
      });
    }
  }

  return prompt;
}

// ---------------------------------------------------------------------------
// buildAIPromptPayload — constrói o payload completo para o AI Provider
// ---------------------------------------------------------------------------

export function buildAIPromptPayload(
  userPrompt: string,
  context: ConversationContext,
  responseModel?: ResponseModel,
  responseMetadata?: ResponseMetadata
): AIRequest {
  const systemPrompt = buildSystemPrompt(context);

  return {
    systemPrompt,
    userPrompt,
    conversationContext: context,
    executionPlan: context.activePlan,
    registryResolution: context.registryResolution,
    policyDecisions: context.policyDecisions,
    toolResults: context.toolResults,
    responseModel,
    responseMetadata,
    temperature: 0.2, // Corporativo: baixa "criatividade", alta precisão
  };
}
