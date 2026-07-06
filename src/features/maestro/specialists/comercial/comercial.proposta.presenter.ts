/**
 * comercial.proposta.presenter.ts
 * Formata a resposta do Maestro para consultas de proposta/orçamento.
 *
 * Recebe o ToolResult de propostas.consultar_por_cliente e gera um ResponseModel
 * estruturado para exibição no Maestro. Toda inteligência de apresentação do domínio
 * Comercial/Propostas fica aqui — o Response Engine permanece genérico.
 *
 * Regras:
 * - Citar fonte: "public.propostas"
 * - Não chamar de OS (não consultou propostas_os)
 * - Diferenciar orçamento (aberto) de pedido real (is_prd_aprovado=true)
 * - Mascarar valor_total se não for permitido (por ora: exibir com aviso)
 * - Se não encontrar: resposta assistiva com cliente ativo
 * - Se erro RLS: resposta informativa, mantém contexto de cliente
 */

import type { ToolResult } from '../../core/tools/tools.types';
import type { ResponseModel } from '../../core/response/response.types';
import type { ConversationContext } from '../../types';
import type { PropostaMaestroItem } from '../../core/tools/adapters/propostas.adapter';

// ---------------------------------------------------------------------------
// Helpers de formatação
// ---------------------------------------------------------------------------

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatMoeda(valor: number | null): string {
  if (valor === null || valor === undefined) return '—';
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function getTipoLabel(proposta: PropostaMaestroItem): string {
  if (proposta.is_prd_aprovado) return 'Pedido Real';
  const status = (proposta.status_interno || '').toUpperCase();
  if (status.startsWith('AGUARDANDO') || status === 'NOVO' || status.startsWith('NOVO /')) {
    return 'Orçamento';
  }
  if (status === 'APROVADO' || status.startsWith('APROVADO /')) {
    return 'Aprovado (aguarda liberação para produção)';
  }
  return 'Proposta';
}

function getStatusColor(proposta: PropostaMaestroItem): 'success' | 'warning' | 'danger' | 'info' | 'default' {
  if (proposta.is_prd_aprovado) return 'success';
  const status = (proposta.status_interno || '').toUpperCase();
  if (status === 'CANCELADO') return 'danger';
  if (status.startsWith('APROVADO')) return 'info';
  if (status.includes('AGUARDANDO')) return 'warning';
  return 'default';
}

// ---------------------------------------------------------------------------
// Presenter principal
// ---------------------------------------------------------------------------

export function comercialPropostaPresenter(
  query: string,
  toolResult: ToolResult,
  context: ConversationContext
): ResponseModel {
  const clienteLabel =
    context.clientName
      ? `${context.clientDisplayCode || context.clientId || ''} — ${context.clientName}`.trim()
      : context.clientDisplayCode || context.clientId || '';

  const fonte = 'public.propostas';
  const horario = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // ── Erro: permissão / RLS ───────────────────────────────────────────────────
  const isPermissionError = toolResult.errors.some(
    e => e.toLowerCase().includes('permissão') || e.toLowerCase().includes('rls') || e.toLowerCase().includes('permission')
  );

  if (!toolResult.success && isPermissionError) {
    return {
      title: 'Acesso Restrito',
      summary: clienteLabel
        ? `Não consegui consultar propostas do cliente **${clienteLabel}** agora.`
        : 'Não consegui consultar propostas agora.',
      explanation: [
        'Acesso negado pela política de segurança do banco de dados (RLS).',
        clienteLabel ? `O cliente **${clienteLabel}** continua como contexto ativo da conversa.` : '',
        `Fonte consultada: ${fonte}`,
      ].filter(Boolean).join('\n'),
      warnings: ['Verifique se está autenticado corretamente no ERP.'],
      recommendations: [
        'Tente acessar o módulo Orçamentos do ERP diretamente.',
        'Se o problema persistir, entre em contato com o administrador.',
      ],
    };
  }

  // ── Erro genérico ───────────────────────────────────────────────────────────
  if (!toolResult.success) {
    return {
      title: 'Erro ao Consultar Propostas',
      summary: clienteLabel
        ? `Encontrei um problema ao buscar propostas do cliente **${clienteLabel}**.`
        : 'Encontrei um problema ao buscar propostas.',
      explanation: toolResult.errors[0] || 'Erro desconhecido.',
      warnings: toolResult.errors,
      recommendations: ['Tente novamente ou verifique a conexão com o ERP.'],
    };
  }

  // ── Nenhuma proposta encontrada ─────────────────────────────────────────────
  if (!toolResult.data || toolResult.data.length === 0) {
    return {
      title: 'Nenhum Orçamento Encontrado',
      summary: clienteLabel
        ? `Não encontrei orçamentos ou propostas para o cliente **${clienteLabel}**.`
        : 'Não encontrei orçamentos ou propostas para este cliente.',
      explanation: [
        `Fonte consultada: **${fonte}**`,
        `Filtro: id_cliente = ${context.clientInternalId || '?'}`,
        `Horário da consulta: ${horario}`,
      ].join('\n'),
      recommendations: [
        'Verifique se o cliente possui orçamentos cadastrados no ERP.',
        'Ou tente buscar pelo nome ou CNPJ do cliente.',
      ],
    };
  }

  // ── 1 ou mais propostas encontradas ─────────────────────────────────────────
  const propostas: PropostaMaestroItem[] = toolResult.data;
  const principal = propostas[0]; // mais recente (ORDER BY created_at DESC)

  const tipo = getTipoLabel(principal);
  const statusColor = getStatusColor(principal);
  const isUnico = propostas.length === 1;

  // Título dinâmico baseado na intenção
  const isIntencaoOrcamento =
    query.toLowerCase().includes('orçamento') ||
    query.toLowerCase().includes('orcamento') ||
    query.toLowerCase().includes('cotação') ||
    (!principal.is_prd_aprovado && query.toLowerCase().includes('proposta'));

  const isIntencaoPedido =
    query.toLowerCase().includes('pedido') && principal.is_prd_aprovado;

  const tituloContextual = isIntencaoPedido
    ? 'Último Pedido Real'
    : isIntencaoOrcamento
      ? 'Último Orçamento'
      : 'Última Proposta';

  // Regra de valor: valor_total à valor à null (nunca inventa)
  const valorExibir = principal.valor_total ?? principal.valor ?? null;

  // Card principal da proposta
  const highlights = [
    { label: 'Nº', value: `#${principal.id_int}`, color: 'info' as const },
    { label: 'Tipo', value: tipo, color: statusColor },
    { label: 'Status', value: principal.status_interno || '—', color: statusColor },
    { label: 'Data', value: formatDate(principal.created_at) },
    { label: 'Valor Total', value: formatMoeda(valorExibir) },
    ...(principal.empresa ? [{ label: 'Empresa', value: principal.empresa }] : []),
    ...(principal.vendedor ? [{ label: 'Vendedor', value: principal.vendedor }] : []),
    ...(principal.is_prd_aprovado ? [{ label: 'Pedido Real', value: 'Sim ✅', color: 'success' as const }] : []),
    ...(principal.libera_nf ? [{ label: 'Libera NF', value: 'Sim', color: 'info' as const }] : []),
  ];

  // Se há múltiplas propostas, montar tabela resumo
  const tables = propostas.length > 1
    ? [{
        headers: ['Nº', 'Tipo', 'Status', 'Valor', 'Data'],
        rows: propostas.map(p => [
          `#${p.id_int}`,
          getTipoLabel(p),
          p.status_interno || '—',
          formatMoeda(p.valor_total ?? p.valor ?? null),
          formatDate(p.created_at),
        ]),
      }]
    : undefined;

  const summaryText = isUnico
    ? clienteLabel
      ? `**${tituloContextual}** do cliente **${clienteLabel}**: proposta **#${principal.id_int}** — ${principal.status_interno || tipo} — ${formatMoeda(valorExibir)} — ${formatDate(principal.created_at)}.`
      : `**Proposta #${principal.id_int}** — ${principal.status_interno || tipo} — Valor: ${formatMoeda(valorExibir)} — ${formatDate(principal.created_at)}.`
    : clienteLabel
      ? `Encontrei **${propostas.length} propostas/orçamentos** do cliente **${clienteLabel}**. A mais recente é a **#${principal.id_int}** (${principal.status_interno || tipo}).`
      : `Encontrei **${propostas.length} propostas/orçamentos**. A mais recente é a **#${principal.id_int}**.`;

  // Fonte: usa toolResult.sourceLabel quando vier do adapter (ex: 'public.propostas · filtro: id_int = N')
  const fonteLabel = toolResult.sourceLabel || fonte;

  return {
    title: isUnico && !clienteLabel
      ? `Proposta #${principal.id_int}`
      : `${tituloContextual}${clienteLabel ? ` — ${clienteLabel}` : ''}`,
    summary: summaryText,
    highlights,
    tables,
    explanation: [
      `Fonte: **${fonteLabel}** | ${horario}`,
      !principal.is_prd_aprovado
        ? '⚠️ Esta proposta ainda não foi liberada para produção (is_prd_aprovado=false). Não é um pedido confirmado.'
        : '',
      valorExibir === null
        ? '⚠️ O valor desta proposta não está disponível no registro consultado (valor_total e valor estão nulos).'
        : '',
      toolResult.warnings?.length ? `⚠️ ${toolResult.warnings[0]}` : '',
    ].filter(Boolean).join('\n'),
    recommendations: [
      !principal.is_prd_aprovado ? 'Para consultar o status de produção, acesse o módulo Pedidos.' : '',
      'Para detalhes de pagamento, acesse o módulo Cobranças.',
      propostas.length === 5 ? 'Exibindo as 5 propostas mais recentes. Pode haver mais.' : '',
    ].filter(Boolean),
  };
}
