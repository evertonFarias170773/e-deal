import { createStep } from './planner.steps';
import type { PlanStep } from './planner.types';

export const PLAN_TEMPLATES: Record<string, () => PlanStep[]> = {
  'fin-consultar-boleto': () => [
    createStep('step-1', {
      title: 'Identificar cliente',
      description: 'Extrair cliente do contexto ou solicitar ao usuário.',
      type: 'identify',
      executionMode: 'auto',
      estimatedSpecialist: 'financeiro',
    }),
    createStep('step-2', {
      title: 'Localizar cobrança',
      description: 'Buscar boletos pendentes para o cliente identificado.',
      type: 'search',
      executionMode: 'auto',
      estimatedSpecialist: 'financeiro',
      dependsOn: ['step-1'],
    }),
    createStep('step-3', {
      title: 'Validar acesso',
      description: 'Verificar se o usuário possui permissão para ver dados financeiros do cliente.',
      type: 'validate',
      executionMode: 'blocked',
      dependsOn: ['step-2'],
    }),
    createStep('step-4', {
      title: 'Consultar boleto',
      description: 'Obter linha digitável e PDF do boleto.',
      type: 'consult',
      executionMode: 'auto',
      estimatedSpecialist: 'financeiro',
      dependsOn: ['step-3'],
    }),
    createStep('step-5', {
      title: 'Preparar resposta',
      description: 'Formatar dados financeiros para exibição.',
      type: 'respond',
      executionMode: 'auto',
      dependsOn: ['step-4'],
    }),
  ],

  'com-consultar-proposta': () => [
    createStep('step-1', {
      title: 'Identificar cliente',
      description: 'Extrair id_cliente do contexto ou da query. Se não houver clientInternalId, resolver via clientes.consultar primeiro.',
      type: 'identify',
      executionMode: 'auto',
      estimatedSpecialist: 'comercial',
    }),
    createStep('step-2', {
      title: 'Consultar propostas/orçamentos do cliente',
      description:
        'Buscar public.propostas por id_cliente (inteiro interno). ' +
        'Ordenar por created_at DESC. Para orçamento: todos os status. Para pedido: is_prd_aprovado=true.',
      type: 'consult',
      estimatedTool: 'propostas.consultar_por_cliente',
      executionMode: 'auto',
      estimatedSpecialist: 'comercial',
      dependsOn: ['step-1'],
    }),
    createStep('step-3', {
      title: 'Preparar resposta',
      description: 'Formatar dados de proposta/orçamento: id_int, status, valor, data, empresa, vendedor.',
      type: 'respond',
      executionMode: 'auto',
      dependsOn: ['step-2'],
    }),
  ],

  // Consulta proposta específica por id_int (ex: "qual valor da proposta 18555?")
  // Entidade explícita na query tem prioridade sobre contexto de cliente anterior.
  'com-consultar-proposta-por-id': () => [
    createStep('step-1', {
      title: 'Consultar proposta por id_int',
      description:
        'Buscar public.propostas WHERE id_int = activeIdInt. ' +
        'Retornar: id_int, cliente, status_interno, valor_total, valor, created_at, vendedor, empresa. ' +
        'Se valor_total for null, usar campo valor. Se ambos nulos, informar sem inventar.',
      type: 'consult',
      estimatedTool: 'propostas.consultar_por_id_int',
      executionMode: 'auto',
      estimatedSpecialist: 'comercial',
    }),
    createStep('step-2', {
      title: 'Preparar resposta de proposta específica',
      description: 'Formatar detalhe único: id_int, status, valor, cliente, data, empresa, vendedor. Citar fonte.',
      type: 'respond',
      executionMode: 'auto',
      dependsOn: ['step-1'],
    }),
  ],

  'com-consultar-cliente': () => [
    createStep('step-1', {
      title: 'Identificar cliente',
      description: 'Extrair cliente do contexto ou solicitar ao usuário.',
      type: 'identify',
      executionMode: 'auto',
      estimatedSpecialist: 'comercial',
    }),
    createStep('step-2', {
      title: 'Consultar cadastro do cliente',
      description: 'Buscar dados cadastrais detalhados do cliente no banco real.',
      type: 'consult',
      estimatedTool: 'clientes.consultar',
      executionMode: 'auto',
      estimatedSpecialist: 'comercial',
      dependsOn: ['step-1'],
    }),
    createStep('step-3', {
      title: 'Validar retorno',
      description: 'Processar os dados brutos e refinar propriedades.',
      type: 'validate',
      executionMode: 'auto',
      dependsOn: ['step-2'],
    }),
    createStep('step-4', {
      title: 'Preparar resposta',
      description: 'Formatar dados do cliente para exibição nos cards.',
      type: 'respond',
      executionMode: 'auto',
      dependsOn: ['step-3'],
    }),
  ],

  'com-criar-proposta': () => [
    createStep('step-1', {
      title: 'Identificar cliente',
      description: 'Extrair ou solicitar dados do cliente.',
      type: 'identify',
      executionMode: 'auto',
      estimatedSpecialist: 'comercial',
    }),
    createStep('step-2', {
      title: 'Identificar produto',
      description: 'Extrair os produtos desejados do contexto.',
      type: 'identify',
      executionMode: 'auto',
      dependsOn: ['step-1'],
    }),
    createStep('step-3', {
      title: 'Calcular quantidade',
      description: 'Validar volume e estoque necessário.',
      type: 'calculate',
      executionMode: 'auto',
      dependsOn: ['step-2'],
    }),
    createStep('step-4', {
      title: 'Consultar preços',
      description: 'Buscar a tabela de preços correspondente.',
      type: 'consult',
      executionMode: 'auto',
      estimatedSpecialist: 'comercial',
      dependsOn: ['step-3'],
    }),
    createStep('step-5', {
      title: 'Preparar proposta',
      description: 'Montar a cotação inicial.',
      type: 'generate',
      executionMode: 'confirm',
      dependsOn: ['step-4'],
    }),
  ],

  /**
   * Pedido/Proposta por cliente — tool propostas.consultar (planejada)
   */
  'prod-consultar-pedido': () => [
    createStep('step-1', {
      title: 'Identificar cliente',
      description: 'Extrair id_cliente do contexto ou da query.',
      type: 'identify',
      executionMode: 'auto',
      estimatedSpecialist: 'comercial',
    }),
    createStep('step-2', {
      title: 'Consultar pedidos/propostas do cliente',
      description:
        'Buscar public.propostas filtrando por id_cliente, is_prd_aprovado=true, ORDER BY created_at DESC.',
      type: 'consult',
      estimatedTool: 'propostas.consultar',
      executionMode: 'auto',
      estimatedSpecialist: 'comercial',
      dependsOn: ['step-1'],
    }),
    createStep('step-3', {
      title: 'Verificar OS vinculada',
      description:
        'Se necessário, verificar public.propostas_os pelo mesmo id_int para confirmar existência de OS.',
      type: 'validate',
      estimatedTool: 'os.consultar',
      executionMode: 'auto',
      dependsOn: ['step-2'],
    }),
    createStep('step-4', {
      title: 'Preparar resposta',
      description: 'Formatar dados do pedido/proposta para exibição.',
      type: 'respond',
      executionMode: 'auto',
      dependsOn: ['step-3'],
    }),
  ],

  /**
   * Pagamento/cobrança por id_int ou cliente — tool cobrancas.consultar (planejada)
   */
  'fin-consultar-pagamento': () => [
    createStep('step-1', {
      title: 'Identificar cliente ou proposta',
      description: 'Extrair id_cliente ou id_int do contexto.',
      type: 'identify',
      executionMode: 'auto',
      estimatedSpecialist: 'financeiro',
    }),
    createStep('step-2', {
      title: 'Verificar permissão financeira',
      description: 'Confirmar se o usuário tem perfil financeiro para acesso a dados de cobrança.',
      type: 'validate',
      executionMode: 'blocked',
      dependsOn: ['step-1'],
    }),
    createStep('step-3', {
      title: 'Consultar cobranças',
      description:
        'Buscar public.pagamentos_v2 por id_cliente ou id_int. Nunca exibir campos sensíveis.',
      type: 'consult',
      estimatedTool: 'cobrancas.consultar',
      executionMode: 'auto',
      estimatedSpecialist: 'financeiro',
      dependsOn: ['step-2'],
    }),
    createStep('step-4', {
      title: 'Preparar resposta financeira',
      description: 'Formatar status, valores e vencimentos. Mascarar dados sensíveis.',
      type: 'respond',
      executionMode: 'auto',
      dependsOn: ['step-3'],
    }),
  ],

  /**
   * Status de NF-e / NFS-e — tool fiscal.consultar (planejada)
   */
  'fis-consultar-nf': () => [
    createStep('step-1', {
      title: 'Identificar proposta/pedido',
      description: 'Extrair id_int ou id_cliente do contexto para localizar a NF.',
      type: 'identify',
      executionMode: 'auto',
      estimatedSpecialist: 'fiscal',
    }),
    createStep('step-2', {
      title: 'Verificar libera_nf',
      description: 'Confirmar se propostas.libera_nf = true para o id_int identificado.',
      type: 'validate',
      estimatedTool: 'fiscal.consultar',
      executionMode: 'auto',
      dependsOn: ['step-1'],
    }),
    createStep('step-3', {
      title: 'Consultar status da NF',
      description:
        'Ler public.notas_fiscais (NF-e) ou public.notas_servico (NFS-e). Apenas leitura de status.',
      type: 'consult',
      estimatedTool: 'fiscal.consultar',
      executionMode: 'auto',
      estimatedSpecialist: 'fiscal',
      dependsOn: ['step-2'],
    }),
    createStep('step-4', {
      title: 'Preparar resposta fiscal',
      description:
        'Informar status, número e data da NF. NUNCA emitir, cancelar ou alterar.',
      type: 'respond',
      executionMode: 'auto',
      dependsOn: ['step-3'],
    }),
  ],
};

