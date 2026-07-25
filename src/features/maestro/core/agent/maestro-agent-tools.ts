/**
 * maestro-agent-tools.ts
 *
 * Registro de tools READ-ONLY do Maestro Agent Loop + wrapper de guardrails.
 *
 * Cada tool declara:
 *   - schema           → formato OpenAI function calling (o modelo só vê isto);
 *   - handler          → executa o adapter server-side existente com o client RLS;
 *   - needsActiveClient→ exige cliente resolvido na sessão (isolamento por id_cliente);
 *   - requiredPermission → permissão granular via verificarPermissaoServerSide
 *     (mecanismo pronto; atribuição das strings por tool será definida quando a
 *     taxonomia de permissões de leitura do Maestro for oficializada).
 *
 * Guardrails aplicados por executeAgentTool (deny-by-default):
 *   1. tool fora do catálogo → erro;
 *   2. isolamento: id_cliente só é aceito se presente em state.resolvedClientIds
 *      (ids resolvidos NESTA conversa pelo servidor — nunca pelo modelo);
 *   3. permissão sensível → recusa amigável;
 *   4. saída sanitizada (maestro-agent-sanitize.ts) antes de voltar ao modelo.
 *
 * NÃO existe tool de SQL livre nem de escrita — impossível gravar via catálogo.
 *
 * ⚠️ Roda apenas no servidor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { verificarPermissaoServerSide } from '../../../../lib/auth/verificar-permissao';
import type { SimpleClientContext } from '../simple/maestro-simple-context';
import {
  buscarClientePorCodigo,
  buscarClientePorTexto,
  buscarEnderecosCliente,
  buscarContatosCliente,
  buscarSociosCliente,
} from '../simple/maestro-simple-clientes.server';
import {
  buscarUltimoOrcamento,
  buscarMaiorPedido,
  calcularFaturamentoPeriodo,
  listarPropostasCliente,
  type PedidoSimples,
} from '../simple/maestro-simple-propostas.server';
import {
  calcularRecebimentoPeriodo,
  compararRecebimentoClienteMeses,
} from '../simple/maestro-simple-pagamentos.server';
import { buscarBoletosCliente } from '../simple/maestro-simple-boletos.server';
import { simularOrcamentoAvulsoDb } from '../simple/maestro-simple-produtos.server';
import { resolverTermoCatalogo } from '../simple/maestro-orcamento-catalogo-oficial';
import type { MaestroPeriodo } from '../simple/maestro-simple-intents';
import { sanitizeAgentToolOutput } from './maestro-agent-sanitize';

// ─── Estado da sessão do agente (controlado SOMENTE pelo servidor) ───────────

export interface AgentClientCandidate {
  id_cliente: number;
  nome: string;
  fantasia: string;
  documento: string;
  cidade_uf: string;
}

export interface AgentSessionState {
  /** Cliente ativo completo (populado por resolver_cliente ou pelo contexto V2) */
  activeClient: SimpleClientContext | null;
  /** Ids de cliente resolvidos nesta conversa — única origem aceita em id_cliente */
  resolvedClientIds: Set<number>;
  /**
   * Candidatos aguardando confirmação do usuário (gravados pelo SERVIDOR em
   * resolver_cliente; persistidos entre turnos via contexto V2). É a única
   * origem aceita por confirmar_cliente_candidato.
   */
  pendingClientCandidates: AgentClientCandidate[] | null;
}

export interface AgentToolContext {
  supabase: SupabaseClient;
  userId: string;
  state: AgentSessionState;
}

export interface AgentToolExecution {
  ok: boolean;
  /** Saída sanitizada da tool (já mascarada) — serializável em JSON */
  result?: unknown;
  /** Mensagem de erro legível pelo modelo (nunca contém dado sensível) */
  error?: string;
}

interface AgentToolDefinition {
  schema: {
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  };
  needsActiveClient?: boolean;
  requiredPermission?: string;
  handler: (args: Record<string, unknown>, ctx: AgentToolContext) => Promise<unknown>;
}

// ─── Helpers de período (UTC — mesma convenção dos adapters) ─────────────────

interface PeriodoArg {
  tipo: 'mes_atual' | 'mes_passado' | 'ultimos_dias' | 'mes_especifico';
  mes?: number;
  ano?: number;
  dias?: number;
  label?: string;
}

const PERIODO_SCHEMA = {
  type: 'object',
  properties: {
    tipo: { type: 'string', enum: ['mes_atual', 'mes_passado', 'ultimos_dias', 'mes_especifico'] },
    mes: { type: 'number' },
    ano: { type: 'number' },
    dias: { type: 'number' },
    label: { type: 'string' },
  },
  required: ['tipo'],
  additionalProperties: false,
} as const;

function inicioMesUtc(ano: number, mesIndex0: number): string {
  return new Date(Date.UTC(ano, mesIndex0, 1)).toISOString();
}

/** Converte MaestroPeriodo em intervalo desde/ate (UTC) para listagens. */
function intervaloDoPeriodo(p: MaestroPeriodo): { desde?: string; ate?: string } {
  const agora = new Date();
  const ano = agora.getUTCFullYear();
  const mes = agora.getUTCMonth();
  switch (p.tipo) {
    case 'mes_atual':
      return { desde: inicioMesUtc(ano, mes) };
    case 'mes_passado':
      return { desde: inicioMesUtc(ano, mes - 1), ate: inicioMesUtc(ano, mes) };
    case 'dinamico':
      return { desde: p.start, ate: p.end };
    default:
      return {};
  }
}

/** Marca cada proposta com o conceito oficial de pedido real (fila de Produção). */
function marcarPedidoReal(items: PedidoSimples[]): Array<PedidoSimples & { pedido_real: boolean }> {
  return items.map(p => ({
    ...p,
    pedido_real: p.is_prd_aprovado === true && p.is_reproved !== true,
  }));
}

/** Nota fixa de semântica — devolvida junto com resultados de propostas. */
const SEMANTICA_PROPOSTAS =
  'pedido_real=true (is_prd_aprovado E NOT is_reproved) = na fila oficial de Producao. ' +
  'status_interno = estado operacional (fluxo oficial: NOVO -> AGUARDANDO -> LIBERADO -> REVISAO -> EM PRODUCAO -> ... -> ENTREGUE); ' +
  'o valor legado "APROVADO" em status_interno significa aprovacao COMERCIAL e NAO significa pedido real.';

function mapPeriodoArg(raw: unknown): MaestroPeriodo | null {
  const p = raw as PeriodoArg | undefined;
  if (!p || typeof p !== 'object' || !p.tipo) return null;

  switch (p.tipo) {
    case 'mes_atual':
      return { tipo: 'mes_atual', label: p.label || 'mês atual' };
    case 'mes_passado':
      return { tipo: 'mes_passado', label: p.label || 'mês passado' };
    case 'ultimos_dias': {
      const dias = Number(p.dias);
      if (!Number.isFinite(dias) || dias <= 0 || dias > 366) return null;
      const start = new Date();
      start.setUTCDate(start.getUTCDate() - dias);
      return { tipo: 'dinamico', start: start.toISOString(), label: p.label || `últimos ${dias} dias` };
    }
    case 'mes_especifico': {
      const mes = Number(p.mes);
      const ano = Number(p.ano);
      if (!Number.isFinite(mes) || mes < 1 || mes > 12 || !Number.isFinite(ano) || ano < 2000 || ano > 2100) {
        return null;
      }
      return {
        tipo: 'dinamico',
        start: inicioMesUtc(ano, mes - 1),
        end: inicioMesUtc(ano, mes),
        label: p.label || `${String(mes).padStart(2, '0')}/${ano}`,
      };
    }
    default:
      return null;
  }
}

// ─── Resolução do id_cliente com isolamento ──────────────────────────────────

function resolverIdClienteSeguro(
  args: Record<string, unknown>,
  ctx: AgentToolContext
): { id: number } | { erro: string } {
  const idArg = args.id_cliente;
  if (idArg != null) {
    const n = Number(idArg);
    if (!Number.isFinite(n) || !ctx.state.resolvedClientIds.has(n)) {
      return { erro: 'id_cliente não corresponde a um cliente resolvido nesta conversa. Use resolver_cliente primeiro.' };
    }
    return { id: n };
  }
  const ativo = ctx.state.activeClient?.clientInternalId;
  if (ativo == null) {
    return { erro: 'Nenhum cliente ativo na conversa. Use resolver_cliente para localizar o cliente antes desta consulta.' };
  }
  return { id: ativo };
}

/** Registra um cliente resolvido pelo SERVIDOR no estado da sessão. */
export function registrarClienteResolvido(state: AgentSessionState, client: SimpleClientContext): void {
  state.activeClient = client;
  if (client.clientInternalId != null) {
    state.resolvedClientIds.add(client.clientInternalId);
  }
}

// ─── Catálogo de tools (somente leitura) ─────────────────────────────────────

const ID_CLIENTE_PROP = {
  id_cliente: {
    type: 'number',
    description: 'Opcional — id interno já resolvido nesta conversa. Omitir usa o cliente ativo.',
  },
} as const;

export const AGENT_TOOLS: Record<string, AgentToolDefinition> = {
  resolver_cliente: {
    schema: {
      type: 'function',
      function: {
        name: 'resolver_cliente',
        description:
          'Localizar e ativar um cliente pelo nome, código numérico ou CPF/CNPJ. ' +
          'Obrigatório antes de qualquer consulta por cliente. Pode retornar lista de candidatos para o usuário escolher.',
        parameters: {
          type: 'object',
          properties: { busca: { type: 'string', description: 'Termo exato digitado pelo usuário.' } },
          required: ['busca'],
          additionalProperties: false,
        },
      },
    },
    handler: async (args, ctx) => {
      const busca = String(args.busca ?? '').trim();
      if (!busca) return { found: false, reason: 'termo_vazio' };

      const soDigitos = busca.replace(/\D/g, '');
      const ehCodigo = /^\d+$/.test(busca) && soDigitos.length <= 8;

      const result = ehCodigo
        ? await buscarClientePorCodigo(ctx.supabase, busca)
        : await buscarClientePorTexto(ctx.supabase, busca);

      if (result.found && result.client) {
        registrarClienteResolvido(ctx.state, result.client);
        ctx.state.pendingClientCandidates = null;
        return {
          found: true,
          confidence: result.confidence ?? 'high',
          cliente: result.client,
        };
      }

      // Candidatos ficam guardados NO SERVIDOR para o turno de confirmação
      const candidatos = (result.candidates ?? []) as AgentClientCandidate[];
      ctx.state.pendingClientCandidates = candidatos.length > 0 ? candidatos : null;

      return {
        found: false,
        reason: result.reason,
        candidatos,
        termo: busca,
        instrucao:
          candidatos.length > 0
            ? 'Apresente os candidatos ao usuário. Quando ele confirmar (por número, nome ou "esse mesmo"), chame confirmar_cliente_candidato.'
            : undefined,
      };
    },
  },

  confirmar_cliente_candidato: {
    schema: {
      type: 'function',
      function: {
        name: 'confirmar_cliente_candidato',
        description:
          'Ativar um cliente da lista de candidatos retornada por resolver_cliente, após o usuário confirmar ' +
          '(vale "sim", "esse mesmo", "o primeiro", o número ou o nome). Se há apenas 1 candidato e o usuário ' +
          'confirmou, chame com indice=1. NUNCA responda que vai ativar — chame esta tool imediatamente.',
        parameters: {
          type: 'object',
          properties: {
            indice: { type: 'number', description: 'Posição (1-based) do candidato na lista apresentada.' },
            id_cliente: { type: 'number', description: 'Alternativa: id_cliente exato de um dos candidatos.' },
          },
          additionalProperties: false,
        },
      },
    },
    handler: async (args, ctx) => {
      const candidatos = ctx.state.pendingClientCandidates ?? [];
      if (candidatos.length === 0) {
        return {
          found: false,
          erro: 'Não há candidatos pendentes de confirmação. Use resolver_cliente para buscar o cliente.',
        };
      }

      let escolhido: AgentClientCandidate | undefined;
      const indice = Number(args.indice);
      const idCliente = Number(args.id_cliente);

      if (Number.isFinite(indice) && indice >= 1 && indice <= candidatos.length) {
        escolhido = candidatos[indice - 1];
      } else if (Number.isFinite(idCliente)) {
        escolhido = candidatos.find(c => c.id_cliente === idCliente);
      } else if (candidatos.length === 1) {
        escolhido = candidatos[0];
      }

      if (!escolhido) {
        return {
          found: false,
          erro: 'Escolha não corresponde a nenhum candidato pendente. Pergunte ao usuário qual da lista é o correto.',
          candidatos,
        };
      }

      const result = await buscarClientePorCodigo(ctx.supabase, String(escolhido.id_cliente));
      if (result.found && result.client) {
        registrarClienteResolvido(ctx.state, result.client);
        ctx.state.pendingClientCandidates = null;
        return { found: true, cliente: result.client };
      }

      return { found: false, erro: 'Falha ao carregar o cadastro do cliente escolhido. Tente resolver_cliente novamente.' };
    },
  },

  dados_cadastrais_cliente: {
    needsActiveClient: true,
    schema: {
      type: 'function',
      function: {
        name: 'dados_cadastrais_cliente',
        description:
          'Cadastro completo do cliente ativo: contato, cidade, vendedor, crédito, limite, bônus (percentual), ' +
          'risco de crédito, restrição, padrão de pagamento, categoria, datas e ativo/inativo.',
        parameters: {
          type: 'object',
          properties: { ...ID_CLIENTE_PROP },
          additionalProperties: false,
        },
      },
    },
    handler: async (args, ctx) => {
      const idCliente = (args.__idClienteSeguro as number)!;
      // Reusa o snapshot completo quando é o cliente ativo; senão busca fresco.
      if (ctx.state.activeClient?.clientInternalId === idCliente) {
        return { cliente: ctx.state.activeClient };
      }
      const result = await buscarClientePorCodigo(ctx.supabase, String(idCliente));
      if (result.found && result.client) return { cliente: result.client };
      return { found: false, reason: result.reason ?? 'not_found' };
    },
  },

  enderecos_cliente: {
    needsActiveClient: true,
    schema: {
      type: 'function',
      function: {
        name: 'enderecos_cliente',
        description: 'Endereços cadastrados do cliente ativo (tipo, logradouro, cidade/UF, CEP). Fonte: public.enderecos.',
        parameters: { type: 'object', properties: { ...ID_CLIENTE_PROP }, additionalProperties: false },
      },
    },
    handler: async (args, ctx) => {
      const idCliente = (args.__idClienteSeguro as number)!;
      const enderecos = await buscarEnderecosCliente(ctx.supabase, idCliente);
      return { enderecos, count: enderecos.length, source: 'public.enderecos' };
    },
  },

  contatos_cliente: {
    needsActiveClient: true,
    schema: {
      type: 'function',
      function: {
        name: 'contatos_cliente',
        description: 'Contatos do cliente ativo (nome, cargo, WhatsApp, e-mail). Fonte: public.contatos.',
        parameters: { type: 'object', properties: { ...ID_CLIENTE_PROP }, additionalProperties: false },
      },
    },
    handler: async (args, ctx) => {
      const idCliente = (args.__idClienteSeguro as number)!;
      const contatos = await buscarContatosCliente(ctx.supabase, idCliente);
      return { contatos, count: contatos.length, source: 'public.contatos' };
    },
  },

  socios_cliente: {
    needsActiveClient: true,
    schema: {
      type: 'function',
      function: {
        name: 'socios_cliente',
        description: 'Sócios/vínculos do cliente ativo. Fonte: public.clientes_socios.',
        parameters: { type: 'object', properties: { ...ID_CLIENTE_PROP }, additionalProperties: false },
      },
    },
    handler: async (args, ctx) => {
      const idCliente = (args.__idClienteSeguro as number)!;
      const socios = await buscarSociosCliente(ctx.supabase, idCliente);
      return { socios, count: socios.length, source: 'public.clientes_socios' };
    },
  },

  propostas_cliente: {
    needsActiveClient: true,
    schema: {
      type: 'function',
      function: {
        name: 'propostas_cliente',
        description:
          'Propostas do cliente ativo (fonte: public.propostas; valor comercial — NÃO é recebimento), com filtro de ' +
          'período opcional e AGREGADOS JÁ CALCULADOS: contagens E somas de valor por status_interno, ' +
          'aprovadas_comercial (status APROVADO/LIBERADO) e pedidos_producao (fila real). ' +
          'Responda "quantas..." e "qual o valor..." SOMENTE com esses agregados — nunca conte nem some itens. ' +
          'Os itens listados são apenas as mais recentes; para "último pedido real" use o primeiro item com pedido_real=true.',
        parameters: {
          type: 'object',
          properties: {
            ...ID_CLIENTE_PROP,
            periodo: { ...PERIODO_SCHEMA, description: 'Opcional — filtra por data de criação da proposta.' },
            limite: { type: 'number', description: 'Máximo de propostas listadas (padrão 50, máx 200).' },
          },
          additionalProperties: false,
        },
      },
    },
    handler: async (args, ctx) => {
      const idCliente = (args.__idClienteSeguro as number)!;

      let desde: string | undefined;
      let ate: string | undefined;
      let periodoLabel: string | undefined;
      if (args.periodo != null) {
        const periodo = mapPeriodoArg(args.periodo);
        if (!periodo) return { found: false, error: 'Período inválido.' };
        const intervalo = intervaloDoPeriodo(periodo);
        desde = intervalo.desde;
        ate = intervalo.ate;
        periodoLabel = periodo.label;
      }

      const limite = Number.isFinite(Number(args.limite)) ? Number(args.limite) : 20;
      const res = await listarPropostasCliente(ctx.supabase, idCliente, { desde, ate, periodoLabel, limite });

      return {
        found: res.found,
        periodo: res.periodo,
        total_propostas_no_periodo: res.count,
        soma_valor_total_no_periodo: res.totalValor,
        contagem_por_status_interno: res.contagemPorStatus,
        soma_valor_por_status_interno: res.somaPorStatus,
        aprovadas_comercial: {
          quantidade: res.aprovadasComercial.quantidade,
          somaValor: res.aprovadasComercial.somaValor,
          maior_valor: res.aprovadasComercial.maior ? marcarPedidoReal([res.aprovadasComercial.maior])[0] : null,
          criterio: 'status_interno APROVADO* ou LIBERADO* (aprovação comercial)',
        },
        pedidos_producao: {
          quantidade: res.pedidosProducao.quantidade,
          somaValor: res.pedidosProducao.somaValor,
          maior_valor: res.pedidosProducao.maior ? marcarPedidoReal([res.pedidosProducao.maior])[0] : null,
          criterio: 'is_prd_aprovado=true e não reprovado (fila real de Produção)',
        },
        maior_proposta_do_periodo: res.maiorProposta ? marcarPedidoReal([res.maiorProposta])[0] : null,
        truncado: res.truncado,
        itens_mais_recentes: marcarPedidoReal(res.items),
        semantica: SEMANTICA_PROPOSTAS,
        error: res.error,
      };
    },
  },

  ultimo_orcamento_cliente: {
    needsActiveClient: true,
    schema: {
      type: 'function',
      function: {
        name: 'ultimo_orcamento_cliente',
        description: 'Último orçamento/proposta gerado do cliente ativo (independente de aprovação). Fonte: public.propostas.',
        parameters: { type: 'object', properties: { ...ID_CLIENTE_PROP }, additionalProperties: false },
      },
    },
    handler: async (args, ctx) => {
      const idCliente = (args.__idClienteSeguro as number)!;
      const res = await buscarUltimoOrcamento(ctx.supabase, idCliente);
      return {
        ...res,
        items: marcarPedidoReal(res.items),
        semantica: SEMANTICA_PROPOSTAS,
        atencao: 'Este é o último ORÇAMENTO/proposta gerado — só chame de "aprovado" ou "pedido" se pedido_real=true.',
      };
    },
  },

  maior_pedido_cliente: {
    needsActiveClient: true,
    schema: {
      type: 'function',
      function: {
        name: 'maior_pedido_cliente',
        description: 'Pedido real de maior valor do cliente ativo (is_prd_aprovado=true AND is_reproved=false).',
        parameters: { type: 'object', properties: { ...ID_CLIENTE_PROP }, additionalProperties: false },
      },
    },
    handler: async (args, ctx) => {
      const idCliente = (args.__idClienteSeguro as number)!;
      const res = await buscarMaiorPedido(ctx.supabase, idCliente);
      return { ...res, items: marcarPedidoReal(res.items), semantica: SEMANTICA_PROPOSTAS };
    },
  },

  faturamento_comercial_periodo: {
    needsActiveClient: true,
    schema: {
      type: 'function',
      function: {
        name: 'faturamento_comercial_periodo',
        description:
          'Soma do VALOR COMERCIAL dos pedidos reais do cliente ativo em um período (public.propostas). ' +
          'NÃO é dinheiro recebido — para recebimento use recebimento_periodo.',
        parameters: {
          type: 'object',
          properties: { ...ID_CLIENTE_PROP, periodo: PERIODO_SCHEMA },
          required: ['periodo'],
          additionalProperties: false,
        },
      },
    },
    handler: async (args, ctx) => {
      const idCliente = (args.__idClienteSeguro as number)!;
      const periodo = mapPeriodoArg(args.periodo);
      if (!periodo) return { found: false, error: 'Período inválido.' };
      return await calcularFaturamentoPeriodo(ctx.supabase, idCliente, periodo);
    },
  },

  recebimento_periodo: {
    needsActiveClient: true,
    schema: {
      type: 'function',
      function: {
        name: 'recebimento_periodo',
        description:
          'Valor efetivamente RECEBIDO do cliente ativo em um período. Fonte: public.pagamentos_v2 ' +
          '(status=PAID, confirmado=true, referência paid_at). Diferente de faturamento comercial e de boletos.',
        parameters: {
          type: 'object',
          properties: { ...ID_CLIENTE_PROP, periodo: PERIODO_SCHEMA },
          required: ['periodo'],
          additionalProperties: false,
        },
      },
    },
    handler: async (args, ctx) => {
      const idCliente = (args.__idClienteSeguro as number)!;
      const periodo = mapPeriodoArg(args.periodo);
      if (!periodo) return { found: false, error: 'Período inválido.' };
      return await calcularRecebimentoPeriodo(ctx.supabase, idCliente, periodo);
    },
  },

  comparar_recebimento_meses: {
    needsActiveClient: true,
    schema: {
      type: 'function',
      function: {
        name: 'comparar_recebimento_meses',
        description: 'Comparar recebimentos (pagamentos_v2, PAID) do cliente ativo em múltiplos meses específicos (máximo 6).',
        parameters: {
          type: 'object',
          properties: {
            ...ID_CLIENTE_PROP,
            meses: {
              type: 'array',
              maxItems: 6,
              items: {
                type: 'object',
                properties: {
                  mes: { type: 'number' },
                  ano: { type: 'number' },
                  label: { type: 'string' },
                },
                required: ['mes', 'ano'],
                additionalProperties: false,
              },
            },
          },
          required: ['meses'],
          additionalProperties: false,
        },
      },
    },
    handler: async (args, ctx) => {
      const idCliente = (args.__idClienteSeguro as number)!;
      const mesesRaw: unknown[] = Array.isArray(args.meses) ? args.meses : [];
      const meses = mesesRaw
        .slice(0, 6)
        .map(raw => {
          const m = raw as { mes?: unknown; ano?: unknown; label?: unknown } | null;
          const mes = Number(m?.mes);
          const ano = Number(m?.ano);
          if (!Number.isFinite(mes) || mes < 1 || mes > 12 || !Number.isFinite(ano)) return null;
          return {
            startDate: inicioMesUtc(ano, mes - 1),
            endDate: inicioMesUtc(ano, mes),
            label: typeof m?.label === 'string' && m.label ? m.label : `${String(mes).padStart(2, '0')}/${ano}`,
          };
        })
        .filter((m): m is { startDate: string; endDate: string; label: string } => m !== null);

      if (meses.length === 0) return { found: false, error: 'Nenhum mês válido informado.' };
      return await compararRecebimentoClienteMeses(ctx.supabase, idCliente, meses);
    },
  },

  boletos_cliente: {
    needsActiveClient: true,
    schema: {
      type: 'function',
      function: {
        name: 'boletos_cliente',
        description:
          'Boletos bancários do cliente ativo (títulos, vencimentos, atrasos). Fonte: public.boletos — ' +
          'NUNCA equivale a pagamentos_v2. filtro: "atrasados" | "abertos" | "todos" (não liquidados).',
        parameters: {
          type: 'object',
          properties: {
            ...ID_CLIENTE_PROP,
            filtro: { type: 'string', enum: ['todos', 'atrasados', 'abertos'] },
          },
          additionalProperties: false,
        },
      },
    },
    handler: async (args, ctx) => {
      const idCliente = (args.__idClienteSeguro as number)!;
      const filtroArg = typeof args.filtro === 'string' ? args.filtro : 'todos';
      const filtro = filtroArg === 'atrasados' ? 'atraso' : filtroArg === 'abertos' ? 'aberto' : 'todos';
      return await buscarBoletosCliente(ctx.supabase, idCliente, filtro);
    },
  },

  buscar_produto: {
    schema: {
      type: 'function',
      function: {
        name: 'buscar_produto',
        description:
          'Buscar produto do catálogo por apelido, descrição ou id (preço unitário, valor fixo, ativo). ' +
          'Não exige cliente ativo. Passe o termo EXATO digitado pelo usuário.',
        parameters: {
          type: 'object',
          properties: { termo: { type: 'string' } },
          required: ['termo'],
          additionalProperties: false,
        },
      },
    },
    handler: async (args, ctx) => {
      const termo = String(args.termo ?? '').trim();
      if (!termo) return { found: false, reason: 'termo_vazio' };
      const res = await simularOrcamentoAvulsoDb(ctx.supabase, [{ quantidade: 1, termo }]);
      const item = res.itens[0];
      return {
        termo,
        status: item?.status ?? 'nao_encontrado',
        produtos: item?.produtosEncontrados ?? [],
        source: 'public.produtos',
      };
    },
  },

  simular_orcamento_avulso: {
    schema: {
      type: 'function',
      function: {
        name: 'simular_orcamento_avulso',
        description:
          'Simular valor de orçamento por produto e quantidade (cálculo informativo, NADA é salvo). ' +
          'Subtotais e total JÁ VÊM CALCULADOS — nunca recalcule. Não exige cliente ativo.',
        parameters: {
          type: 'object',
          properties: {
            itens: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  quantidade: { type: 'number' },
                  termo: { type: 'string' },
                },
                required: ['quantidade', 'termo'],
                additionalProperties: false,
              },
            },
          },
          required: ['itens'],
          additionalProperties: false,
        },
      },
    },
    handler: async (args, ctx) => {
      const itensRaw: unknown[] = Array.isArray(args.itens) ? args.itens : [];
      const itens = itensRaw
        .map(raw => {
          const i = raw as { quantidade?: unknown; termo?: unknown } | null;
          return { quantidade: Number(i?.quantidade), termo: String(i?.termo ?? '').trim() };
        })
        .filter(i => Number.isFinite(i.quantidade) && i.quantidade > 0 && i.termo.length > 0)
        .slice(0, 20);
      if (itens.length === 0) return { found: false, error: 'Nenhum item válido informado.' };

      const res = await simularOrcamentoAvulsoDb(ctx.supabase, itens);
      // Enriquece com o nome comercial oficial do catálogo — é ele que deve
      // aparecer no orçamento formatado (não a descrição crua do banco).
      return {
        ...res,
        itens: res.itens.map(item => {
          const catalogo = resolverTermoCatalogo(item.termo);
          return {
            ...item,
            nomeComercialOficial:
              catalogo.nomeComercial ??
              item.produtosEncontrados[0]?.descricao ??
              item.termo,
          };
        }),
      };
    },
  },
};

/** Schemas expostos ao modelo (formato OpenAI `tools`). */
export const AGENT_TOOL_SCHEMAS = Object.values(AGENT_TOOLS).map(t => t.schema);

// ─── Wrapper de execução com guardrails ──────────────────────────────────────

export async function executeAgentTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentToolContext
): Promise<AgentToolExecution> {
  // 1. Deny-by-default: só executa tool do catálogo
  const tool = Object.prototype.hasOwnProperty.call(AGENT_TOOLS, name) ? AGENT_TOOLS[name] : undefined;
  if (!tool) {
    return { ok: false, error: `Ferramenta "${name}" não existe no catálogo.` };
  }

  // 2. Isolamento por id_cliente (somente ids resolvidos pelo servidor)
  if (tool.needsActiveClient) {
    const resolucao = resolverIdClienteSeguro(args, ctx);
    if ('erro' in resolucao) {
      return { ok: false, error: resolucao.erro };
    }
    // id validado é injetado em campo interno — o handler nunca lê args.id_cliente cru
    args = { ...args, __idClienteSeguro: resolucao.id };
  }

  // 3. Permissão sensível (quando declarada) → recusa amigável
  if (tool.requiredPermission) {
    const permitido = await verificarPermissaoServerSide(ctx.supabase, ctx.userId, tool.requiredPermission);
    if (!permitido) {
      return {
        ok: false,
        error:
          'PERMISSAO_NEGADA: o usuário não tem acesso a esta informação. ' +
          'Responda de forma educada explicando que o perfil dele não permite esta consulta.',
      };
    }
  }

  // 4. Executa o adapter e sanitiza a saída
  try {
    const raw = await tool.handler(args, ctx);
    return { ok: true, result: sanitizeAgentToolOutput(raw) };
  } catch (err) {
    console.error(`[MaestroAgentTools] Erro na tool "${name}":`, err);
    return { ok: false, error: 'Erro interno ao consultar o ERP. Informe que a consulta falhou e sugira tentar novamente.' };
  }
}
