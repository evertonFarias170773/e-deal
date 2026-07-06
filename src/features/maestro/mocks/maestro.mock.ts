import type {
  ConversationSession,
  ConversationMessage,
  ActivityStep,
  ConversationContext,
  MaestroSuggestion,
} from '../types';

export const MOCK_SESSIONS: ConversationSession[] = [
  {
    id: 'sess-001',
    title: 'Propostas Cliente XPTO',
    summary: '3 propostas abertas encontradas',
    lastMessage: 'Proposta #1234 aguardando aprovação',
    updatedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    specialist: 'comercial',
  },
  {
    id: 'sess-002',
    title: 'Frete Pulseiras RFID',
    summary: 'Cotações verificadas para SP',
    lastMessage: 'Ideal Express: R$ 142,00 — 3 dias úteis',
    updatedAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    specialist: 'expedicao',
  },
  {
    id: 'sess-003',
    title: 'Pendências Financeiras',
    summary: '2 boletos vencidos identificados',
    lastMessage: 'Cliente Biro com R$ 4.800 em aberto',
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    specialist: 'financeiro',
  },
  {
    id: 'sess-004',
    title: 'Pedido 17890',
    summary: 'Status: Em produção — 68% concluído',
    lastMessage: 'Previsão de expedição: 07/07/2026',
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 28).toISOString(),
    specialist: 'producao',
  },
  {
    id: 'sess-005',
    title: 'Produção Cliente Biro',
    summary: 'OS 445 finalizada ontem',
    lastMessage: 'Produto enviado para expedição',
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 32).toISOString(),
    specialist: 'producao',
  },
];

export const MOCK_WELCOME_MESSAGES: ConversationMessage[] = [];

export const MOCK_ACTIVITY_STEPS: ActivityStep[] = [
  { id: 'step-1', label: 'Entendi sua solicitação', status: 'done', timestamp: '10:32:00' },
  { id: 'step-2', label: 'Cliente identificado', status: 'done', detail: 'XPTO Ltda', timestamp: '10:32:01' },
  { id: 'step-3', label: 'Consultando propostas', status: 'done', timestamp: '10:32:02' },
  { id: 'step-4', label: '3 propostas encontradas', status: 'done', timestamp: '10:32:03' },
  { id: 'step-5', label: 'Montando resposta', status: 'done', timestamp: '10:32:04' },
];

export const MOCK_INITIAL_CONTEXT: ConversationContext = {
  company: 'Ideal',
  specialist: 'geral',
};

export const MOCK_SUGGESTIONS: MaestroSuggestion[] = [
  {
    id: 'sug-1',
    label: 'Criar orçamento',
    description: 'Iniciar novo orçamento para um cliente',
    icon: 'FileText',
    query: 'Quero criar um orçamento',
    specialist: 'comercial',
  },
  {
    id: 'sug-2',
    label: 'Consultar cliente',
    description: 'Ver dados, histórico e propostas',
    icon: 'Users',
    query: 'Consultar dados do cliente XPTO',
    specialist: 'comercial',
  },
  {
    id: 'sug-3',
    label: 'Encontrar proposta',
    description: 'Buscar proposta por número ou cliente',
    icon: 'ClipboardList',
    query: 'Mostrar propostas abertas do cliente XPTO',
    specialist: 'comercial',
  },
  {
    id: 'sug-4',
    label: 'Localizar pedido',
    description: 'Status e produção de pedido',
    icon: 'Package',
    query: 'Status do pedido 17890',
    specialist: 'producao',
  },
  {
    id: 'sug-5',
    label: 'Consultar frete',
    description: 'Cotações de frete disponíveis',
    icon: 'Truck',
    query: 'Consultar frete para a proposta 1234',
    specialist: 'expedicao',
  },
  {
    id: 'sug-6',
    label: 'Consultar boleto',
    description: 'Segunda via e status de pagamento',
    icon: 'CreditCard',
    query: 'Ver boletos em aberto do cliente XPTO',
    specialist: 'financeiro',
  },
  {
    id: 'sug-7',
    label: 'Nota fiscal',
    description: 'Consultar NF-e ou NFS-e',
    icon: 'Receipt',
    query: 'Consultar nota fiscal do pedido 17890',
    specialist: 'fiscal',
  },
  {
    id: 'sug-8',
    label: 'Analisar vendas',
    description: 'Resumo de desempenho comercial',
    icon: 'BarChart3',
    query: 'Analisar propostas do mês',
    specialist: 'comercial',
  },
];
