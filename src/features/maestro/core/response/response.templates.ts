import type { ResponseModel } from './response.types';
import type { ConversationContext } from '../../types';

// ---------------------------------------------------------------------------
// Helper: monta identificação do cliente para uso nos fallbacks
// ---------------------------------------------------------------------------

function buildClientInfo(context?: ConversationContext): string | undefined {
  if (!context) return undefined;
  const codigo = context.clientDisplayCode || context.clientId;
  const nome = context.clientName;
  if (codigo && nome) return `${codigo} — ${nome}`;
  if (nome) return nome;
  if (codigo) return `cliente ${codigo}`;
  return undefined;
}

// ---------------------------------------------------------------------------
// templatePolicyBlocked — Bloqueio de policy
// ---------------------------------------------------------------------------

export function templatePolicyBlocked(
  toolId: string,
  reason: string,
  isConfirmation: boolean
): ResponseModel {
  return {
    title: isConfirmation ? 'Confirmação Necessária' : 'Ação Bloqueada',
    summary: isConfirmation
      ? `A ferramenta **${toolId}** requer sua aprovação antes de prosseguir.`
      : `Não foi possível executar **${toolId}** devido a restrições de segurança ou de política do ERP.`,
    warnings: [reason],
    nextActions: isConfirmation
      ? [{ label: 'Autorizar Execução', actionId: 'auth_execute', payload: { toolId } }]
      : [],
  };
}

// ---------------------------------------------------------------------------
// templateErroGenerico — Erro técnico
// ---------------------------------------------------------------------------

export function templateErroGenerico(message: string): ResponseModel {
  return {
    title: 'Não consegui concluir a ação',
    summary: 'Encontrei uma dificuldade técnica ao tentar executar essa operação.',
    warnings: [message],
    recommendations: ['Você pode tentar novamente ou perguntar sobre outro assunto.'],
  };
}

// ---------------------------------------------------------------------------
// templateOrcamentoFallback — Criação de orçamento
// ---------------------------------------------------------------------------

export function templateOrcamentoFallback(): ResponseModel {
  return {
    title: 'Criação de Orçamento',
    summary:
      'Ainda não consigo criar orçamentos automaticamente, mas posso te ajudar a organizar as informações necessárias.',
    explanation:
      'Para montar um orçamento, vou precisar de:\n• cliente\n• produto\n• quantidade\n• variações ou observações\n• frete, se necessário.',
    recommendations: [
      'Você pode começar me dizendo algo como: **"cliente 8469, 5000 pulseiras RFID"**',
    ],
  };
}

// ---------------------------------------------------------------------------
// templatePedidoFallback — Fallback para consultas de pedido/proposta sem tool
// ---------------------------------------------------------------------------

export function templatePedidoFallback(
  clientInfo?: string,
  idInt?: string | number,
  context?: ConversationContext
): ResponseModel {
  const cliente = clientInfo || buildClientInfo(context);
  const pedidoRef = idInt ? ` #${idInt}` : '';
  const clienteSufixo = cliente ? ` do cliente **${cliente}**` : '';

  return {
    title: 'Consulta de Pedido / Proposta',
    summary: cliente
      ? `Entendi que você quer consultar o pedido${pedidoRef}${clienteSufixo}.`
      : `Entendi que você quer consultar o pedido${pedidoRef}.`,
    explanation: [
      'Para responder isso com precisão, o Maestro precisaria:',
      `1. Consultar **public.propostas** filtrando por cliente${pedidoRef ? ` e id_int${pedidoRef}` : ''}.`,
      '2. Verificar **is_prd_aprovado** e **status_interno** para confirmar se é pedido real.',
      '3. Verificar **public.propostas_os** para confirmar se existe OS vinculada.',
      '',
      'A ferramenta **propostas.consultar** está planejada para a próxima fase do Maestro.',
      'Por enquanto não vou inventar esse dado.',
    ].join('\n'),
    recommendations: [
      'Posso consultar os dados cadastrais do cliente agora.',
      'Quer que eu busque informações de contato, cidade ou CNPJ?',
    ],
  };
}

// ---------------------------------------------------------------------------
// templateFinanceiroFallback — Fallback para consultas financeiras sem tool
// ---------------------------------------------------------------------------

export function templateFinanceiroFallback(
  clientInfo?: string,
  tipo: 'pagamento' | 'boleto' | 'cobranca' | 'financeiro' = 'financeiro',
  context?: ConversationContext
): ResponseModel {
  const cliente = clientInfo || buildClientInfo(context);
  const clienteSufixo = cliente ? ` do cliente **${cliente}**` : '';
  const tipoLabel = tipo === 'boleto' ? 'boletos' : tipo === 'cobranca' ? 'cobranças' : 'pagamentos';
  const tabelaLabel =
    tipo === 'boleto'
      ? 'public.boletos (boletos bancários C6 Bank)'
      : 'public.pagamentos_v2 (cobranças do ERP: Pix, Link, Boleto, E-Faturado)';

  return {
    title: `Consulta de ${tipo === 'boleto' ? 'Boleto' : 'Financeiro'}`,
    summary: cliente
      ? `Entendi que você quer consultar **${tipoLabel}**${clienteSufixo}.`
      : `Entendi que você quer consultar **${tipoLabel}** do ERP.`,
    explanation: [
      'Para responder isso com precisão, o Maestro precisaria:',
      `1. Consultar **${tabelaLabel}** filtrando por id_cliente.`,
      tipo === 'boleto'
        ? '2. Verificar campos: vencimento, dias_atraso, status, valor_atualizado.'
        : '2. Verificar campos: status, paid_at, vencimento, confirmado.',
      '3. Verificar perfil do usuário — dados financeiros exigem autorização.',
      '',
      `A ferramenta **${tipo === 'boleto' ? 'boletos' : 'cobrancas'}.consultar** está planejada para fase futura.`,
      'Por enquanto não vou inventar dado financeiro.',
    ].join('\n'),
    warnings: [
      'Dados financeiros como linha digitável, Pix copia-e-cola e tokens de cobrança nunca são exibidos pelo Maestro sem fluxo seguro.',
    ],
    recommendations: [
      'Para verificar cobranças reais, acesse o módulo **Cobranças** do ERP.',
      'Posso consultar os dados cadastrais do cliente agora, se quiser.',
    ],
  };
}

// ---------------------------------------------------------------------------
// templateFiscalFallback — Fallback para consultas de NF sem tool
// ---------------------------------------------------------------------------

export function templateFiscalFallback(
  clientInfo?: string,
  context?: ConversationContext
): ResponseModel {
  const cliente = clientInfo || buildClientInfo(context);
  const clienteSufixo = cliente ? ` do cliente **${cliente}**` : '';

  return {
    title: 'Consulta Fiscal / Nota Fiscal',
    summary: `Entendi que você quer consultar o status de nota fiscal${clienteSufixo}.`,
    explanation: [
      'Para responder isso, o Maestro precisaria:',
      '1. Verificar se **libera_nf = true** na proposta.',
      '2. Consultar **public.notas_fiscais** (NF-e) ou **public.notas_servico** (NFS-e).',
      '3. Verificar campos: status, numero_nf, data_autorizacao.',
      '',
      'A ferramenta **fiscal.consultar** está planejada para fase futura.',
      'O Maestro **nunca emite, cancela ou altera** nota fiscal.',
    ].join('\n'),
    recommendations: [
      'Para emitir ou consultar notas fiscais, acesse o módulo **Fiscal** do ERP.',
      '• NF-e = produto físico (crachás, pulseiras, brindes)',
      '• NFS-e = serviço (design, arte, personalização)',
    ],
  };
}

// ---------------------------------------------------------------------------
// templateConsultaFallback — Fallback genérico com contexto de cliente
// ---------------------------------------------------------------------------

export function templateConsultaFallback(
  tipo: string,
  identificador?: string,
  context?: any
): ResponseModel {
  const isPedido = tipo.toLowerCase().includes('pedido');
  const isProposta = tipo.toLowerCase().includes('proposta') || tipo.toLowerCase().includes('orçamento');
  const isComercial = tipo.toLowerCase().includes('comercial');

  let pluralType = tipo.toLowerCase();
  if (isPedido) pluralType = 'pedidos';
  else if (isProposta) pluralType = 'propostas';
  else if (isComercial) pluralType = 'dados comerciais';
  else if (tipo.toLowerCase() === 'cliente') pluralType = 'clientes';
  else pluralType = `${tipo.toLowerCase()}s`;

  let title = `Consulta de ${tipo}`;
  let summary = `Ainda não consigo consultar **${pluralType}** reais nesta versão.`;
  let explanation = '';

  const clientInfo = buildClientInfo(context) || identificador;

  if (context?.clientId || context?.clientName) {
    summary = `Entendi que você quer consultar **${pluralType}**${clientInfo ? ` do cliente **${clientInfo}**` : ''}.`;
    explanation = [
      `A ferramenta de ${pluralType} ainda não está conectada ao Maestro nesta fase.`,
      '',
      'Mantive esse cliente como contexto ativo da conversa.',
      'Posso continuar ajudando com dados cadastrais: telefone, CNPJ, cidade ou e-mail.',
    ].join('\n');
  } else if (identificador) {
    explanation = `Entendi que você quer localizar **${identificador}**. Já registrei essa informação como contexto. Quando a ferramenta estiver conectada, essa pergunta será respondida diretamente.`;
  } else {
    explanation = `Essa consulta será atendida pelo especialista correspondente usando a ferramenta apropriada em breve.`;
  }

  return {
    title,
    summary,
    explanation,
    recommendations: [
      'Por enquanto, já consigo consultar dados cadastrais de clientes.',
      'Você quer consultar um cliente ou testar uma busca por nome/CNPJ?',
    ],
  };
}

// ---------------------------------------------------------------------------
// templateContextoAbstrato — Pergunta não compreendida
// ---------------------------------------------------------------------------

export function templateContextoAbstrato(): ResponseModel {
  return {
    title: 'Como posso ajudar?',
    summary: 'Olá! Sou o Maestro, assistente do ERP Ideal. Para começar, me informe o cliente ou o que você quer consultar.',
    explanation: [
      '**Para consultar um cliente**, diga:',
      '• `cliente 8469` — pelo código',
      '• `cli 8469` — atalho',
      '• `12.345.678/0001-99` — pelo CNPJ',
      '• `cliente empresa ABC` — pelo nome',
      '',
      '**Para consultar propostas/orçamentos:**',
      '• `qual o último orçamento do cliente 8469?`',
      '• `proposta 18555` — detalhe por número',
    ].join('\n'),
    recommendations: [
      'Comece informando o código do cliente (ex: `cliente 8469`).',
      'Depois posso responder sobre telefone, CNPJ, cidade, vendedor, orçamentos e mais.',
    ],
  };
}
