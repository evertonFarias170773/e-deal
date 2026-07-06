import { recognizeIntent } from './intent.recognizer';
import type { ConversationContext } from '../../types';

/**
 * buildContext
 *
 * Constrói o contexto conversacional a partir da query do usuário e do contexto anterior.
 * Preserva contexto ativo (cliente, proposta, id_int) sem sobrescrever quando a query
 * é referencial ("dele", "desse cliente", "para esse pedido").
 */
export function buildContext(query: string, currentContext: ConversationContext): ConversationContext {
  const recognition = recognizeIntent(query);

  // ── Extração de IDs explícitos da query ────────────────────────────────────
  // Prefixo # (ex: #18555)
  const idMatch = query.match(/#(\d+)/);
  const potentialId = idMatch ? `#${idMatch[1]}` : undefined;

  // Número puro de proposta (ex: 'proposta 18555', 'valor da 18555', 'essa 18555')
  // REGRA: entidade explícita na mensagem tem PRIORIDADE sobre contexto anterior
  const isAboutPropostaExplicita =
    query.toLowerCase().includes('proposta') ||
    query.toLowerCase().includes('orçamento') ||
    query.toLowerCase().includes('orcamento');

  const propostaPureMatch = isAboutPropostaExplicita
    ? query.match(/(?:proposta|orçamento|orcamento|valor da|status da|essa|#)\s*(\d{4,})/i) ||
      query.match(/(\d{5,})/) // número sozinho com 5+ dígitos = provavelmente id_int
    : idMatch; // só aceita # fora do contexto de proposta

  const propostaIdInt = propostaPureMatch
    ? Number(propostaPureMatch[1] || propostaPureMatch[0].replace('#', ''))
    : undefined;

  const newContext = { ...currentContext, rawQuery: query };

  // Atualizar inteligência inferida
  newContext.intentId = recognition.intentId || undefined;
  newContext.intent = recognition.intent || undefined;
  newContext.domain = recognition.domain || undefined;
  newContext.targetObject = recognition.targetObject || undefined;
  newContext.confidence = recognition.confidence;
  newContext.specialist = recognition.specialist;

  // Mock property bindings based on domain (to simulate named entity recognition)
  // PRIORIDADE: número explícito de proposta na query > contexto anterior de cliente
  if (propostaIdInt && propostaIdInt > 0) {
    // Entidade explícita detectada — sobrescreve intenção do recognizer
    newContext.activeIdInt       = propostaIdInt;
    newContext.intent            = 'consultar';
    newContext.domain            = 'Comercial';
    newContext.targetObject      = 'proposta';
    newContext.intentId          = 'com-consultar-proposta-por-id';
    // Preserva cliente ativo — não sobrescreve clientInternalId
  } else if (recognition.domain === 'Comercial' && recognition.targetObject === 'proposta' && potentialId) {
    newContext.proposalId = potentialId;
  }
  if (recognition.domain === 'Produção' && potentialId) {
    newContext.orderId = potentialId;
  }

  // Detecta tipo de pergunta
  const qL = query.toLowerCase();

  const isAboutOrderOrProposal =
    qL.includes('pedido') || qL.includes('proposta') || qL.includes('orçamento') ||
    qL.includes('compra') || qL.includes('histórico') || qL.includes('ultimo') || qL.includes('último');

  const isAboutFinanceiro =
    qL.includes('pagamento') || qL.includes('cobrança') || qL.includes('boleto') ||
    qL.includes('pagar') || qL.includes('vencimento') || qL.includes('vencido') ||
    qL.includes('financeiro') || qL.includes('deve') || qL.includes('inadimplente');

  const isAboutFiscal =
    qL.includes('nota fiscal') || qL.includes('nf-e') || qL.includes('nfse') ||
    qL.includes('nf ') || qL.includes(' nf') || qL.includes('fatura');

  const isClientProfileQuery =
    qL.includes('cnpj') || qL.includes('telefone') || qL.includes('cidade') ||
    qL.includes('cadastro') || qL.includes('email') || qL.includes('e-mail') ||
    qL.includes('quem') || qL.includes('contato') || qL.includes('celular') ||
    qL.includes('whatsapp') || qL.includes('cpf') || qL.includes('documento') ||
    qL.includes('localizado') || qL.includes('fica') || qL.includes('fundão') ||
    // Fase 1 — adicionados para cobrir perguntas básicas do dia a dia
    qL.includes('vendedor') || qL.includes('crédito') || qL.includes('credito') ||
    qL.includes('limite') || qL.includes('responsavel') || qL.includes('responsável') ||
    qL.includes('e-mail') || qL.includes('situacao') || qL.includes('situação') ||
    qL.includes('bloqueado') || qL.includes('ativo') || qL.includes('inativo') ||
    qL.includes('razao social') || qL.includes('inscricao') ||
    qL.includes('endereco') || qL.includes('rua') || qL.includes('bairro') || qL.includes('cep');

  const hasClientReference =
    qL.includes('dele') || qL.includes('dela') || qL.includes('cliente') ||
    qL.includes('desse') || qL.includes('deste') || qL.includes('esse cliente') ||
    qL.includes('para ele') || qL.includes('da empresa') || qL.includes('deste cliente') ||
    qL.includes('do cadastro');

  // ── Contexto de cliente ativo ───────────────────────────────────────────────
  if (newContext.clientId && !potentialId) {
    if (isAboutFinanceiro) {
      // Pergunta financeira com cliente ativo no contexto
      newContext.domain = 'Financeiro';
      newContext.targetObject = qL.includes('boleto') ? 'boleto' : 'pagamento';
      // Não força intentId — sem tool financeira conectada, cai no fallback correto
    } else if (isAboutFiscal) {
      newContext.domain = 'Fiscal';
      newContext.targetObject = 'nota-fiscal';
    } else if (isAboutOrderOrProposal) {
      // Se está perguntando de pedido/proposta "dele", mantemos o targetObject do recognizer
      // O targetObject já deve ser 'pedido' ou 'proposta' via recognizer
    } else if (isClientProfileQuery || hasClientReference) {
      // Pergunta direta sobre o cliente (ex: "telefone dele", "onde ele fica")
      newContext.intent = 'consultar';
      newContext.domain = 'Comercial';
      newContext.targetObject = 'cliente';
      newContext.intentId = 'com-consultar-cliente'; // Força o intentId correto para rodar a Tool real
    }
  } else if (potentialId && qL.includes('cliente')) {
    // Nova busca de cliente por ID explicitada com # + palavra "cliente"
    const numericId = potentialId.replace('#', '');
    newContext.clientId = numericId;
    newContext.clientDisplayCode = numericId;
    if (!isNaN(Number(numericId))) {
      newContext.clientInternalId = Number(numericId);
    }
    newContext.intent = 'consultar';
    newContext.domain = 'Comercial';
    newContext.targetObject = 'cliente';
    newContext.intentId = 'com-consultar-cliente';
  } else if (!potentialId) {
    // ── GATILHOS ALTERNATIVOS DE CLIENTE ──────────────────────────────────────
    // Suporta: "cliente 8469", "cli 8469", "c8469", "cadastro 8469", "#8469",
    //          CPF, CNPJ, e-mail

    // Padrão: "cli NNNN", "c NNNN", "c8469" (atalhos sem a palavra "cliente" inteira)
    const cliMatch =
      query.match(/^cli\s+(\d{2,})/i) ||      // cli 8469
      query.match(/^c\s*(\d{3,})/i) ||         // c 8469 | c8469
      query.match(/^cadastro\s+(\d{2,})/i) ||  // cadastro 8469
      query.match(/^cad\s+(\d{2,})/i) ||       // cad 8469
      query.match(/^#(\d{2,})$/);              // #8469 (sozinho, sem palavra proposta)

    // Palavra "cliente" com número
    const clienteNumMatch = !cliMatch
      ? query.match(/cliente\s+(\d{2,})/i) ||
        query.match(/(?:do|da|para o|para a)\s+cliente\s+(\d{2,})/i)
      : null;

    // CPF: 000.000.000-00
    const cpfMatch = query.match(/\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/);

    // CNPJ: 00.000.000/0000-00
    const cnpjMatch = query.match(/\b(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/);

    // E-mail como busca
    const emailMatch = query.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);

    if (cliMatch) {
      const code = cliMatch[1];
      newContext.clientId = code;
      newContext.clientDisplayCode = code;
      newContext.clientInternalId = Number(code);
      newContext.intent = 'consultar';
      newContext.domain = 'Comercial';
      newContext.targetObject = 'cliente';
      newContext.intentId = 'com-consultar-cliente';
    } else if (clienteNumMatch) {
      const code = clienteNumMatch[1];
      newContext.clientId = code;
      newContext.clientDisplayCode = code;
      newContext.clientInternalId = Number(code);
      newContext.intent = 'consultar';
      newContext.domain = 'Comercial';
      newContext.targetObject = 'cliente';
      newContext.intentId = 'com-consultar-cliente';
    } else if (cnpjMatch) {
      newContext.clientSearchName = undefined;
      newContext.clientDisplayCode = cnpjMatch[1];
      // Adapter usa idClienteSearch para busca por documento
      newContext.clientId = cnpjMatch[1];
      newContext.intent = 'consultar';
      newContext.domain = 'Comercial';
      newContext.targetObject = 'cliente';
      newContext.intentId = 'com-consultar-cliente';
    } else if (cpfMatch) {
      newContext.clientId = cpfMatch[1];
      newContext.clientDisplayCode = cpfMatch[1];
      newContext.intent = 'consultar';
      newContext.domain = 'Comercial';
      newContext.targetObject = 'cliente';
      newContext.intentId = 'com-consultar-cliente';
    } else if (emailMatch && qL.includes('cliente')) {
      newContext.clientSearchName = emailMatch[1];
      newContext.intent = 'consultar';
      newContext.domain = 'Comercial';
      newContext.targetObject = 'cliente';
      newContext.intentId = 'com-consultar-cliente';
    } else if (qL.includes('cliente')) {
      // Busca por nome textual
      const nameMatch =
        query.match(/cliente\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]{2,})/i) ||
        query.match(/(?:d[ao]s?|para\s+(?:a|o))\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]{2,})/i);
      if (nameMatch) {
        newContext.clientSearchName = nameMatch[1].trim();
        newContext.intent = 'consultar';
        newContext.domain = 'Comercial';
        newContext.targetObject = 'cliente';
        newContext.intentId = 'com-consultar-cliente';
      }
    }
  }

  // ── Derição de clientInternalId a partir de clientDisplayCode ───────────────
  // Garante que toda consulta de proposta tenha clientInternalId mesmo que venha de contexto anterior
  if (!newContext.clientInternalId && newContext.clientDisplayCode) {
    const parsed = Number(newContext.clientDisplayCode);
    if (!isNaN(parsed) && parsed > 0) {
      newContext.clientInternalId = parsed;
    }
  }
  if (!newContext.clientInternalId && newContext.clientId) {
    const parsed = Number(newContext.clientId);
    if (!isNaN(parsed) && parsed > 0) {
      newContext.clientInternalId = parsed;
    }
  }

  // ── Resumo narrativo automático ─────────────────────────────────────────────
  const intentStr = newContext.intent ? `**${newContext.intent}**` : 'lidar com';
  const objStr = newContext.targetObject ? `um **${newContext.targetObject}**` : 'um item';
  const domainStr = newContext.domain ? `no contexto **${newContext.domain}**` : 'no sistema';

  newContext.contextSummary = `Identificado que você deseja ${intentStr} ${objStr} ${domainStr}.`;

  return newContext;
}

/**
 * enrichContextFromToolResult
 *
 * Enriquece o contexto com dados retornados por uma tool de cliente.
 * Separa explicitamente clientInternalId (inteiro) de clientDisplayCode (string).
 * Chamado pelo response engine após execução bem-sucedida da tool clientes.consultar.
 */
export function enrichContextFromToolResult(
  context: ConversationContext,
  toolId: string,
  toolData: any[]
): ConversationContext {
  if (toolId !== 'clientes.consultar' || !toolData || toolData.length !== 1) {
    return context;
  }

  const c = toolData[0];
  const enriched: ConversationContext = { ...context };

  // Preserva displayCode legado e adiciona separação explícita
  enriched.clientId           = c.idCliente;               // string de exibição (retrocompat)
  enriched.clientDisplayCode  = c.idCliente;               // código exibido ("8469")
  enriched.clientInternalId   = typeof c.idClienteInterno === 'number'
    ? c.idClienteInterno
    : undefined;                                           // inteiro interno do banco
  enriched.clientName         = c.razaoSocial;
  enriched.clientDocument     = c.cpfCnpj;
  enriched.clientCityUf       = c.cidade;

  // Campos extras — populados para permitir respostas diretas sem nova tool call
  enriched.clientTelefone     = c.telefone ?? c.whatsapp ?? null;
  enriched.clientVendedor     = c.vendedor ?? null;
  enriched.clientCredito      = typeof c.credito === 'number' ? c.credito : null;
  enriched.clientLimiteCredito = typeof c.limiteCredito === 'number' ? c.limiteCredito : null;
  enriched.clientEmail        = c.email ?? null;

  return enriched;
}
