import type { ConversationContext } from '../../types';
import type { ResponseModel, ResponseMetadata } from './response.types';
import {
  templatePolicyBlocked,
  templateErroGenerico,
  templateOrcamentoFallback,
  templateConsultaFallback,
  templateContextoAbstrato,
  templatePedidoFallback,
  templateFinanceiroFallback,
  templateFiscalFallback,
} from './response.templates';
import { comercialResponsePresenter } from '../../specialists/comercial/comercial.response.presenter';
import { comercialPropostaPresenter } from '../../specialists/comercial/comercial.proposta.presenter';
import { enrichContextFromToolResult } from '../context/context.builder';

// ---------------------------------------------------------------------------
// Helpers de detecção de domínio para roteamento de fallback
// ---------------------------------------------------------------------------

function isFinanceiroQuery(context: ConversationContext): boolean {
  const q = (context.rawQuery || '').toLowerCase();
  return (
    q.includes('pagamento') || q.includes('cobrança') || q.includes('pagar') ||
    q.includes('financeiro') || q.includes('deve') || q.includes('inadimplente') ||
    q.includes('vencimento') || q.includes('vencido') || q.includes('a receber') ||
    context.domain === 'Financeiro'
  );
}

function isBoletoQuery(context: ConversationContext): boolean {
  const q = (context.rawQuery || '').toLowerCase();
  return q.includes('boleto') || q.includes('linha digitável') || q.includes('conta a receber');
}

function isPedidoQuery(context: ConversationContext): boolean {
  const q = (context.rawQuery || '').toLowerCase();
  return (
    q.includes('pedido') || q.includes('último pedido') || q.includes('ultimo pedido') ||
    q.includes('proposta virou') || q.includes('já virou') || q.includes('os vinculada') ||
    q.includes('ordem de serviço') || (context.targetObject === 'pedido' && !context.rawQuery?.toLowerCase().includes('cliente'))
  );
}

function isFiscalQuery(context: ConversationContext): boolean {
  const q = (context.rawQuery || '').toLowerCase();
  return (
    q.includes('nota fiscal') || q.includes('nf-e') || q.includes('nfse') ||
    q.includes('nf ') || q.includes(' nf') || q.includes('fatura') ||
    q.includes('emitir nota') || context.domain === 'Fiscal'
  );
}

function buildClientInfo(context: ConversationContext): string | undefined {
  const codigo = context.clientDisplayCode || context.clientId;
  const nome = context.clientName;
  if (codigo && nome) return `${codigo} — ${nome}`;
  if (nome) return nome;
  if (codigo) return `cliente ${codigo}`;
  return undefined;
}

/**
 * resolveDirectContextResponse
 *
 * Quando o cliente já está no contexto E o usuário pede um campo específico
 * que já foi carregado (telefone, CNPJ, cidade, vendedor, email, crédito),
 * responde DIRETAMENTE sem fazer nova tool call.
 *
 * Retorna null se não conseguir resolver — fluxo continua normalmente.
 */
function resolveDirectContextResponse(context: ConversationContext): ResponseModel | null {
  // Só age se o cliente está ativo no contexto
  if (!context.clientId && !context.clientName) return null;

  const q = (context.rawQuery || '').toLowerCase();
  const nome = context.clientName || context.clientDisplayCode || context.clientId || 'cliente';
  const codigo = context.clientDisplayCode || context.clientId;
  const fonte = codigo
    ? `vw_cadastros_clientes_lista · id_cliente = ${codigo}`
    : 'contexto ativo';

  // Telefone / WhatsApp
  if (q.includes('telefone') || q.includes('whatsapp') || q.includes('celular') || q.includes('contato')) {
    if (context.clientTelefone !== undefined) {
      const val = context.clientTelefone || 'não cadastrado';
      return {
        title: `Telefone — ${nome}`,
        summary: `O telefone/WhatsApp de **${nome}** é **${val}**.`,
        explanation: `Fonte: ${fonte}`,
      };
    }
  }

  // CNPJ / CPF / Documento
  if (q.includes('cnpj') || q.includes('cpf') || q.includes('documento')) {
    if (context.clientDocument !== undefined) {
      const val = context.clientDocument || 'não informado';
      return {
        title: `CNPJ/CPF — ${nome}`,
        summary: `O CNPJ/CPF de **${nome}** é **${val}**.`,
        explanation: `Fonte: ${fonte}`,
      };
    }
  }

  // Cidade / UF / Localização
  if (q.includes('cidade') || q.includes('uf') || q.includes('estado') || q.includes('fica') || q.includes('localizado') || q.includes('endereço') || q.includes('endereco')) {
    if (context.clientCityUf !== undefined) {
      const val = context.clientCityUf || 'não informada';
      return {
        title: `Localização — ${nome}`,
        summary: `O cliente **${nome}** está localizado em **${val}**.`,
        explanation: `Fonte: ${fonte}`,
      };
    }
  }

  // E-mail
  if (q.includes('email') || q.includes('e-mail')) {
    if (context.clientEmail !== undefined) {
      const val = context.clientEmail || 'não cadastrado';
      return {
        title: `E-mail — ${nome}`,
        summary: `O e-mail de **${nome}** é **${val}**.`,
        explanation: `Fonte: ${fonte}`,
      };
    }
  }

  // Vendedor
  if (q.includes('vendedor') || q.includes('responsavel') || q.includes('responsável')) {
    if (context.clientVendedor !== undefined) {
      const val = context.clientVendedor || 'não vinculado';
      return {
        title: `Vendedor — ${nome}`,
        summary: `O vendedor responsável por **${nome}** é **${val}**.`,
        explanation: `Fonte: ${fonte}`,
      };
    }
  }

  // Crédito / Limite
  if (q.includes('crédito') || q.includes('credito') || q.includes('limite')) {
    if (context.clientCredito !== undefined || context.clientLimiteCredito !== undefined) {
      const formatBRL = (v: number | null | undefined) =>
        typeof v === 'number'
          ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
          : 'não disponível';
      return {
        title: `Crédito — ${nome}`,
        summary: `**${nome}** tem limite de crédito de **${formatBRL(context.clientLimiteCredito)}** e crédito disponível de **${formatBRL(context.clientCredito)}**.`,
        explanation: `Fonte: ${fonte}`,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// presenterGenericoAmigavel — presenter para tools sem presenter dedicado
// Elimina mensagens técnicas como "Execução: toolId" e "Ação concluída"
// ---------------------------------------------------------------------------

function presenterGenericoAmigavel(
  toolId: string,
  toolResult: any,
  context: ConversationContext
): ResponseModel {
  const clienteLabel = context.clientName
    ? `${context.clientName}${context.clientDisplayCode ? ` (${context.clientDisplayCode})` : ''}`
    : context.clientDisplayCode || undefined;

  const source = toolResult?.sourceLabel || toolResult?.source || 'ERP Ideal';
  const data = toolResult?.data;
  const count = toolResult?.count || 0;

  // Se retornou dados — tenta apresentar de forma amigável
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    // Extrai campos genéricos para exibir
    const camposExibir: Record<string, string> = {};
    const ignorar = ['id', '__typename', 'toolId'];
    for (const [key, val] of Object.entries(first)) {
      if (ignorar.includes(key)) continue;
      if (val === null || val === undefined || val === '') continue;
      if (typeof val === 'object') continue;
      // Converte camelCase para label legível
      const label = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
      camposExibir[label] = String(val);
    }

    const cards = Object.keys(camposExibir).length > 0
      ? [{ title: 'Dados encontrados', metadata: camposExibir }]
      : undefined;

    return {
      title: clienteLabel ? `Resultado para ${clienteLabel}` : 'Resultado',
      summary: count > 1
        ? `Encontrei **${count} registros**.${clienteLabel ? ` (cliente: ${clienteLabel})` : ''}`
        : `Dado localizado.${clienteLabel ? ` (cliente: ${clienteLabel})` : ''}`,
      cards,
      explanation: `Fonte: ${source}`,
    };
  }

  // Sem dados — fallback informativo (nunca técnico)
  const clienteSufixo = clienteLabel ? ` do cliente **${clienteLabel}**` : '';
  return {
    title: 'Sem resultados',
    summary: `Não encontrei dados${clienteSufixo} para essa consulta.`,
    explanation: `Fonte: ${source}`,
    recommendations: [
      'Verifique se o cliente ou número está correto.',
      'Você pode tentar outra busca ou perguntar sobre outro dado.',
    ],
  };
}

// ---------------------------------------------------------------------------
// generateResponse — motor principal de resposta
// ---------------------------------------------------------------------------

export function generateResponse(context: ConversationContext): { model: ResponseModel; metadata: ResponseMetadata } {
  const plan = context.activePlan;
  let model: ResponseModel;
  let toolId = '';
  let policyStatus = '';
  let execTime = 0;
  let enrichedContext = context;

  if (plan && plan.steps.length > 0) {
    // Encontrar a tool primária que foi executada
    const registryResult = context.registryResolution?.results.find(r => r.toolId && r.toolId !== 'unknown');
    toolId = registryResult?.toolId || '';

    if (registryResult) {
      const policyDecision = context.policyDecisions?.[registryResult.toolId];
      policyStatus = policyDecision?.status || '';

      if (policyDecision && !policyDecision.canExecute) {
        model = templatePolicyBlocked(registryResult.toolId, policyDecision.reason, policyDecision.requiresConfirmation);
      } else {
        const toolResult = context.toolResults?.[registryResult.toolId];
        if (toolResult) {
          execTime = toolResult.executionTime;
          if (!toolResult.success) {
            model = templateErroGenerico(toolResult.errors[0] || 'Falha ao executar ferramenta.');
          } else if (registryResult.toolId === 'clientes.consultar') {
            // Enriquece o contexto com dados retornados — separa clientInternalId de clientDisplayCode
            enrichedContext = enrichContextFromToolResult(context, 'clientes.consultar', toolResult.data || []);
            // Delega montagem visual ao Presenter Comercial
            model = comercialResponsePresenter(
              context.rawQuery || context.activePlan?.steps[0].title || '',
              toolResult,
              enrichedContext
            );
          } else if (
            registryResult.toolId === 'propostas.consultar_por_cliente' ||
            registryResult.toolId === 'propostas.consultar_por_id_int'
          ) {
            // Delega montagem visual ao Presenter de Propostas
            // (suporta lista por cliente e detalhe único por id_int)
            model = comercialPropostaPresenter(
              context.rawQuery || '',
              toolResult,
              enrichedContext
            );
          } else {
            // Presenter genérico amigável — para tools sem presenter dedicado
            // NÃO exibe: "Execução: toolId", "Ação concluída", "sem presenter dedicado"
            model = presenterGenericoAmigavel(registryResult.toolId, toolResult, enrichedContext);
          }
        } else {
          model = templateErroGenerico('Houve uma falha temporária de comunicação com o sistema, por favor tente novamente.');
        }
      }
    } else {
      // Sem tool disponível — tenta resposta direta do contexto antes do fallback genérico
      model = resolveDirectContextResponse(context) ?? resolveContextualFallback(context);
    }
  } else {
    // Sem plano de execução — tenta resposta direta do contexto antes do fallback
    if (context.intent === 'criar' && context.targetObject?.toLowerCase().includes('orçamento')) {
      model = templateOrcamentoFallback();
    } else {
      model = resolveDirectContextResponse(context) ?? resolveContextualFallback(context) ?? templateContextoAbstrato();
    }
  }

  const metadata: ResponseMetadata = {
    responseId: `res-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    templateId: toolId === 'clientes.consultar' ? 'tpl-clientes' : 'tpl-generic',
    templateVersion: '1.1',
    confidence: 1.0,
    dataSources: ['ERP'],
    toolsUsed: toolId ? [toolId] : [],
    executionTime: execTime,
    policyDecision: policyStatus,
    executionPlanId: plan?.id,
  };

  return { model, metadata };
}

// ---------------------------------------------------------------------------
// resolveContextualFallback — roteador de fallback por domínio
// ---------------------------------------------------------------------------

function resolveContextualFallback(context: ConversationContext): ResponseModel {
  const clientInfo = buildClientInfo(context);

  // Criação de orçamento
  if (context.intent === 'criar' && (context.targetObject?.toLowerCase().includes('orçamento') || context.domain === 'orçamentos')) {
    return templateOrcamentoFallback();
  }

  // Boleto / Contas a Receber
  if (isBoletoQuery(context)) {
    return templateFinanceiroFallback(clientInfo, 'boleto', context);
  }

  // Financeiro geral (pagamento, cobrança)
  if (isFinanceiroQuery(context)) {
    return templateFinanceiroFallback(clientInfo, 'pagamento', context);
  }

  // Fiscal / NF
  if (isFiscalQuery(context)) {
    return templateFiscalFallback(clientInfo, context);
  }

  // Pedido / Proposta / OS
  if (isPedidoQuery(context)) {
    const idInt = context.activeIdInt || context.orderId;
    return templatePedidoFallback(clientInfo, idInt, context);
  }

  // Consulta genérica com contexto de cliente
  if (context.intent === 'consultar' && context.targetObject) {
    return templateConsultaFallback(context.targetObject, context.proposalId || context.orderId || context.targetObject, context);
  }

  // Fallback geral
  return templateConsultaFallback(context.domain || 'informações', undefined, context);
}
