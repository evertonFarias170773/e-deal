import type { ConversationMessage, ActivityStep, ConversationContext, SpecialistType } from '../types';

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function now(): string {
  return new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

interface MockResponse {
  message: ConversationMessage;
  activity: ActivityStep[];
  context: ConversationContext;
}

function buildResponse(
  intent: string,
  content: string,
  specialist: SpecialistType,
  components: ConversationMessage['components'],
  sources: ConversationMessage['sources'],
  activity: ActivityStep[],
  context: ConversationContext,
): MockResponse {
  return {
    message: {
      id: generateId(),
      role: 'maestro',
      content,
      contentType: 'card',
      specialist,
      timestamp: new Date().toISOString(),
      confidence: 'high',
      sources,
      components,
    },
    activity,
    context,
  };
}

function getPropostasResponse(): MockResponse {
  const t = now();
  return buildResponse(
    'propostas',
    'Encontrei **3 propostas abertas** para o cliente XPTO Ltda:',
    'comercial',
    [
      {
        type: 'table',
        data: {
          headers: ['Proposta', 'Valor', 'Status', 'Data'],
          rows: [
            ['#1234', 'R$ 8.400,00', 'Aguardando aprovação', '01/07/2026'],
            ['#1215', 'R$ 3.200,00', 'Em negociação', '28/06/2026'],
            ['#1198', 'R$ 12.000,00', 'Pendente de arte', '25/06/2026'],
          ],
        },
      },
    ],
    [{ table: 'public.propostas', label: 'Propostas', queriedAt: t }],
    [
      { id: 'a1', label: 'Entendi sua solicitação', status: 'done', timestamp: t },
      { id: 'a2', label: 'Cliente identificado', status: 'done', detail: 'XPTO Ltda', timestamp: t },
      { id: 'a3', label: 'Consultando propostas', status: 'done', timestamp: t },
      { id: 'a4', label: '3 propostas encontradas', status: 'done', timestamp: t },
      { id: 'a5', label: 'Resposta montada', status: 'done', timestamp: t },
    ],
    { clientName: 'XPTO Ltda', clientCnpj: '12.345.XXX/0001-XX', specialist: 'comercial', company: 'Ideal' },
  );
}

function getClienteResponse(): MockResponse {
  const t = now();
  return buildResponse(
    'cliente',
    'Aqui está o resumo do cliente **XPTO Ltda**:',
    'comercial',
    [
      {
        type: 'card',
        data: {
          title: 'XPTO Ltda',
          items: [
            { label: 'CNPJ', value: '12.345.XXX/0001-XX' },
            { label: 'Contato', value: 'João Silva — (11) 99999-XXXX' },
            { label: 'Cidade', value: 'São Paulo — SP' },
            { label: 'Status', value: 'Ativo', type: 'badge-success' },
            { label: 'Propostas abertas', value: '3' },
            { label: 'Último pedido', value: '#17890 — Jun/2026' },
          ],
        },
      },
    ],
    [{ table: 'public.clientes', label: 'Clientes', queriedAt: t }],
    [
      { id: 'a1', label: 'Entendi sua solicitação', status: 'done', timestamp: t },
      { id: 'a2', label: 'Buscando cliente', status: 'done', timestamp: t },
      { id: 'a3', label: 'Cliente encontrado', status: 'done', detail: 'XPTO Ltda', timestamp: t },
      { id: 'a4', label: 'Carregando histórico', status: 'done', timestamp: t },
      { id: 'a5', label: 'Resposta montada', status: 'done', timestamp: t },
    ],
    { clientName: 'XPTO Ltda', clientCnpj: '12.345.XXX/0001-XX', specialist: 'comercial', company: 'Ideal' },
  );
}

function getPedidoResponse(): MockResponse {
  const t = now();
  return buildResponse(
    'pedido',
    'Encontrei o **Pedido #17890** com as seguintes informações:',
    'producao',
    [
      {
        type: 'card',
        data: {
          title: 'Pedido #17890',
          items: [
            { label: 'Cliente', value: 'XPTO Ltda' },
            { label: 'Produto', value: 'Pulseira RFID 125kHz — 500 un.' },
            { label: 'Status', value: 'Em produção', type: 'badge-warning' },
            { label: 'Progresso', value: '68%', type: 'progress' },
            { label: 'OS Produção', value: '#445' },
            { label: 'Previsão expedição', value: '07/07/2026' },
          ],
        },
      },
    ],
    [{ table: 'public.pedidos', label: 'Pedidos', queriedAt: t }],
    [
      { id: 'a1', label: 'Entendi sua solicitação', status: 'done', timestamp: t },
      { id: 'a2', label: 'Pedido localizado', status: 'done', detail: '#17890', timestamp: t },
      { id: 'a3', label: 'Consultando OS de produção', status: 'done', timestamp: t },
      { id: 'a4', label: 'Status verificado', status: 'done', timestamp: t },
      { id: 'a5', label: 'Resposta montada', status: 'done', timestamp: t },
    ],
    { orderId: '#17890', clientName: 'XPTO Ltda', specialist: 'producao', company: 'Ideal' },
  );
}

function getBoletoResponse(): MockResponse {
  const t = now();
  return buildResponse(
    'boleto',
    'Encontrei **2 boletos** para o cliente XPTO Ltda:',
    'financeiro',
    [
      {
        type: 'table',
        data: {
          headers: ['Boleto', 'Valor', 'Vencimento', 'Status'],
          rows: [
            ['#BOL-001', 'R$ 3.200,00', '05/07/2026', 'Vencido'],
            ['#BOL-002', 'R$ 5.200,00', '15/07/2026', 'A vencer'],
          ],
        },
      },
    ],
    [{ table: 'public.boletos', label: 'Boletos', queriedAt: t }],
    [
      { id: 'a1', label: 'Entendi sua solicitação', status: 'done', timestamp: t },
      { id: 'a2', label: 'Verificando perfil financeiro', status: 'done', timestamp: t },
      { id: 'a3', label: 'Consultando boletos', status: 'done', timestamp: t },
      { id: 'a4', label: '2 boletos encontrados', status: 'done', timestamp: t },
      { id: 'a5', label: 'Resposta montada', status: 'done', timestamp: t },
    ],
    { clientName: 'XPTO Ltda', specialist: 'financeiro', company: 'Ideal' },
  );
}

function getFreteResponse(): MockResponse {
  const t = now();
  return buildResponse(
    'frete',
    'Encontrei **2 cotações de frete** para a Proposta #1234 (18,4 kg — destino SP):',
    'expedicao',
    [
      {
        type: 'table',
        data: {
          headers: ['Transportadora', 'Valor', 'Prazo', 'Tipo'],
          rows: [
            ['Ideal Express', 'R$ 142,00', '3 dias úteis', 'Rodoviário'],
            ['Transp. São Paulo', 'R$ 98,00', '5 dias úteis', 'Rodoviário'],
          ],
        },
      },
    ],
    [{ table: 'public.cotacao_frete', label: 'Cotação de Frete', queriedAt: t }],
    [
      { id: 'a1', label: 'Entendi sua solicitação', status: 'done', timestamp: t },
      { id: 'a2', label: 'Proposta identificada', status: 'done', detail: '#1234', timestamp: t },
      { id: 'a3', label: 'Calculando peso total', status: 'done', detail: '18,4 kg', timestamp: t },
      { id: 'a4', label: 'Consultando cotações', status: 'done', timestamp: t },
      { id: 'a5', label: '2 cotações encontradas', status: 'done', timestamp: t },
    ],
    { proposalId: '#1234', specialist: 'expedicao', company: 'Ideal' },
  );
}

function getProdutoResponse(): MockResponse {
  const t = now();
  return buildResponse(
    'produto',
    'Encontrei o produto **Pulseira RFID 125kHz** no catálogo:',
    'produtos',
    [
      {
        type: 'card',
        data: {
          title: 'Pulseira RFID 125kHz',
          items: [
            { label: 'Código', value: 'PRD-0091' },
            { label: 'Tipo', value: 'Pulseira RFID' },
            { label: 'Peso unitário', value: '32g' },
            { label: 'Estoque', value: '2.400 unidades', type: 'badge-success' },
            { label: 'Variações', value: 'Azul, Vermelho, Preto, Branco' },
            { label: 'Prazo produção', value: '5 dias úteis' },
          ],
        },
      },
    ],
    [{ table: 'public.produtos', label: 'Produtos', queriedAt: t }],
    [
      { id: 'a1', label: 'Entendi sua solicitação', status: 'done', timestamp: t },
      { id: 'a2', label: 'Buscando produto', status: 'done', timestamp: t },
      { id: 'a3', label: 'Produto localizado', status: 'done', detail: 'PRD-0091', timestamp: t },
      { id: 'a4', label: 'Carregando variações', status: 'done', timestamp: t },
      { id: 'a5', label: 'Resposta montada', status: 'done', timestamp: t },
    ],
    { specialist: 'produtos', company: 'Ideal' },
  );
}

export function detectIntent(query: string): string {
  const lower = query.toLowerCase();
  if (lower.includes('proposta') || lower.includes('orçamento') || lower.includes('orcamento') || lower.includes('criar')) return 'propostas';
  if (lower.includes('cliente') || lower.includes('xpto') || lower.includes('biro') || lower.includes('cadastro')) return 'cliente';
  if (lower.includes('pedido') || lower.includes('producao') || lower.includes('produção') || lower.includes('os ') || lower.includes('status do pedido')) return 'pedido';
  if (lower.includes('boleto') || lower.includes('pagamento') || lower.includes('inadimplência') || lower.includes('financeiro') || lower.includes('cobran')) return 'boleto';
  if (lower.includes('frete') || lower.includes('transportadora') || lower.includes('expedição') || lower.includes('expedicao') || lower.includes('cotação')) return 'frete';
  if (lower.includes('produto') || lower.includes('rfid') || lower.includes('pulseira') || lower.includes('catálogo') || lower.includes('estoque')) return 'produto';
  return 'propostas';
}

export function getSpecialistForIntent(query: string): SpecialistType {
  const intent = detectIntent(query);
  const map: Record<string, SpecialistType> = {
    propostas: 'comercial',
    cliente: 'comercial',
    pedido: 'producao',
    boleto: 'financeiro',
    frete: 'expedicao',
    produto: 'produtos',
  };
  return map[intent] || 'geral';
}

export async function getMockResponse(query: string): Promise<MockResponse> {
  // Simulate network latency
  await new Promise(r => setTimeout(r, 1000 + Math.random() * 800));
  const intent = detectIntent(query);
  switch (intent) {
    case 'propostas': return getPropostasResponse();
    case 'cliente': return getClienteResponse();
    case 'pedido': return getPedidoResponse();
    case 'boleto': return getBoletoResponse();
    case 'frete': return getFreteResponse();
    case 'produto': return getProdutoResponse();
    default: return getPropostasResponse();
  }
}
