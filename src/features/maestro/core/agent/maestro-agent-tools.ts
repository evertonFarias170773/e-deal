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
  buscarDetalheProposta,
  calcularFaturamentoPeriodo,
  listarPropostasCliente,
  type PedidoSimples,
} from '../simple/maestro-simple-propostas.server';
import {
  calcularRecebimentoPeriodo,
  calcularPerfilPagamento,
  calcularFaturamentoOficial,
  compararRecebimentoClienteMeses,
} from '../simple/maestro-simple-pagamentos.server';
import { buscarBoletosCliente } from '../simple/maestro-simple-boletos.server';
import { simularOrcamentoAvulsoDb, listarProdutosCatalogo, buscarFotosProduto } from '../simple/maestro-simple-produtos.server';
import { cotarOpcoesFrete } from './maestro-agent-frete.server';
import { gerarPdfPropostaServer } from './maestro-agent-pdf.server';
import { buscarNomeUsuario } from '../simple/maestro-simple-vendedores.server';
import { buscarContaCorrenteCliente, buscarAnaliseCredito } from '../simple/maestro-simple-conta-corrente.server';
import { isAgentWriteEnabled, isWriteSalvarCotacaoEnabled } from './maestro-agent-config';
import {
  proporSalvarCotacao,
  executarSalvarCotacao,
  type AgentPendingWriteAction,
  type ItemCotacaoReq,
} from './maestro-agent-write.server';
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
  /**
   * Ação de ESCRITA proposta aguardando confirmação (matriz §4: vale só para
   * o turno seguinte). Autorada pelo SERVIDOR — o modelo nunca fornece valores.
   */
  pendingWriteAction: AgentPendingWriteAction | null;
  /** Identificador do turno atual — impede propor e executar no MESMO turno */
  currentTurnId: string;
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
  /** Tool de ESCRITA — sujeita às camadas 1 e 3 da matriz (flags de escrita) */
  isWrite?: boolean;
  /** Camada 3 — flag específica da ação (matriz §3). Ausente em tool de escrita = negado. */
  writeActionFlagEnabled?: () => boolean;
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

// Princípio permanente (§1.0 da matriz): toda consulta financeira suporta
// recorte por empresa via pagamentos_v2.id_empresa
const ID_EMPRESA_PROP = {
  id_empresa: {
    type: 'number',
    description: 'Opcional — recorte por empresa (pagamentos_v2.id_empresa; nunca a empresa do cadastro do cliente).',
  },
} as const;

function idEmpresaDe(args: Record<string, unknown>): number | undefined {
  const n = Number(args.id_empresa);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

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

  visao_geral_cliente: {
    needsActiveClient: true,
    schema: {
      type: 'function',
      function: {
        name: 'visao_geral_cliente',
        description:
          'PRIMEIRA FONTE para perguntas gerais sobre o cliente ativo ("como está", "resumo", "situação", "me fala sobre"). ' +
          'Uma única chamada traz: cadastro essencial, crédito/limite, bônus, vendedor, resumo de boletos abertos/atrasados, ' +
          'últimos registros (última proposta, último pedido real, último recebimento, última movimentação) e os ' +
          'indicadores do MÊS ATUAL (propostas por status, aprovadas comerciais, fila de Produção, recebimento) já calculados. ' +
          'NÃO cobre: outros períodos, comparações, listagens item a item, endereços/contatos/sócios — ' +
          'para isso use as tools específicas. Fontes: vw_maestro_cliente_360 + public.propostas + public.pagamentos_v2.',
        parameters: { type: 'object', properties: { ...ID_CLIENTE_PROP }, additionalProperties: false },
      },
    },
    handler: async (args, ctx) => {
      const idCliente = (args.__idClienteSeguro as number)!;
      const agora = new Date();
      const inicioMes = inicioMesUtc(agora.getUTCFullYear(), agora.getUTCMonth());

      // View atemporal + indicadores do mês atual (adapters parametrizados) —
      // uma única chamada do agente, quatro leituras paralelas no servidor.
      const [visaoRes, propostasMes, recebimentoMes, faturamentoMes] = await Promise.all([
        ctx.supabase.from('vw_maestro_cliente_360').select('*').eq('id_cliente', idCliente).maybeSingle(),
        listarPropostasCliente(ctx.supabase, idCliente, { desde: inicioMes, periodoLabel: 'mês atual', limite: 0 }),
        calcularRecebimentoPeriodo(ctx.supabase, idCliente, { tipo: 'mes_atual', label: 'mês atual' }),
        calcularFaturamentoOficial(ctx.supabase, { desde: inicioMes, periodoLabel: 'mês atual', idCliente }),
      ]);

      if (visaoRes.error) {
        // View ainda não aplicada neste ambiente (42P01) ou indisponível —
        // degrada graciosamente entregando ao menos os indicadores do mês.
        console.warn('[MaestroAgentTools] vw_maestro_cliente_360 indisponível:', visaoRes.error.message);
      }

      const indicadoresMesAtual = {
        faturamento_oficial: {
          propostas: faturamentoMes.total_propostas,
          valor: faturamentoMes.faturamento,
          criterio: 'pagamentos_v2 confirmados (PAID/A_VENCER) por data_confirmacao — fonte oficial de faturamento',
        },
        pipeline_propostas_qtd: propostasMes.count,
        pipeline_propostas_valor: propostasMes.totalValor,
        contagem_por_status_interno: propostasMes.contagemPorStatus,
        aprovadas_comercial: {
          quantidade: propostasMes.aprovadasComercial.quantidade,
          somaValor: propostasMes.aprovadasComercial.somaValor,
        },
        pedidos_producao: {
          quantidade: propostasMes.pedidosProducao.quantidade,
          somaValor: propostasMes.pedidosProducao.somaValor,
        },
        recebimento_valor: recebimentoMes.totalValor ?? 0,
        recebimento_qtd: recebimentoMes.count,
      };

      if (visaoRes.error || !visaoRes.data) {
        return {
          found: !visaoRes.error,
          visao: null,
          aviso: visaoRes.error
            ? 'Visão consolidada indisponível neste ambiente — para cadastro/boletos use dados_cadastrais_cliente e boletos_cliente.'
            : 'Cliente não encontrado na visão consolidada.',
          indicadores_mes_atual: indicadoresMesAtual,
          semantica: SEMANTICA_PROPOSTAS,
        };
      }

      return {
        found: true,
        visao: visaoRes.data,
        indicadores_mes_atual: indicadoresMesAtual,
        referencia: 'visao = estado atual/últimos registros (atemporal); indicadores_mes_atual = calculados agora para o mês corrente.',
        semantica: SEMANTICA_PROPOSTAS,
        source: 'public.vw_maestro_cliente_360 + public.propostas + public.pagamentos_v2',
      };
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
          'PIPELINE COMERCIAL do cliente ativo (fonte: public.propostas — NÃO é faturamento nem recebimento; ' +
          'para faturamento use faturamento_cliente), com filtro de ' +
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

  detalhe_proposta: {
    needsActiveClient: true,
    schema: {
      type: 'function',
      function: {
        name: 'detalhe_proposta',
        description:
          'Detalhe de UMA proposta do cliente ativo pelo número: ITENS/PRODUTOS orçados ' +
          '(nome, quantidade, valor unitário, subtotal, desconto) e SITUAÇÃO OPERACIONAL do pedido ' +
          '(status_pedido, etapa_operacional, prazo_operacional, em_arte) — use também para "onde está o pedido X". ' +
          'ATENÇÃO: propostas AVULSAS (is_avulso=true) não têm itens detalhados no ERP — explique isso ' +
          'em vez de dizer que não tem acesso.',
        parameters: {
          type: 'object',
          properties: {
            ...ID_CLIENTE_PROP,
            numero: { type: 'number', description: 'Número da proposta (id_int) — obtido em consulta anterior ou informado pelo usuário.' },
          },
          required: ['numero'],
          additionalProperties: false,
        },
      },
    },
    handler: async (args, ctx) => {
      const idCliente = (args.__idClienteSeguro as number)!;
      const numero = Number(args.numero);
      if (!Number.isFinite(numero) || numero <= 0) {
        return { found: false, error: 'Número de proposta inválido.' };
      }
      const res = await buscarDetalheProposta(ctx.supabase, idCliente, numero);
      return {
        ...res,
        proposta: res.proposta ? marcarPedidoReal([res.proposta])[0] : null,
        nota_itens: res.found && !res.itens_detalhados
          ? (res.proposta?.is_avulso
              ? 'Proposta AVULSA: o ERP não registra itens detalhados neste tipo — o valor é lançado direto.'
              : 'Nenhum item detalhado registrado para esta proposta.')
          : undefined,
        semantica: SEMANTICA_PROPOSTAS,
      };
    },
  },

  ultimo_orcamento_cliente: {
    needsActiveClient: true,
    schema: {
      type: 'function',
      function: {
        name: 'ultimo_orcamento_cliente',
        description:
          'Último orçamento/proposta gerado do cliente ativo. Fonte: public.propostas. ' +
          'Use filtro="nao_aprovada_comercial" quando pedirem o último "ainda não aprovado" ' +
          '(vocabulário da equipe: não aprovado = status NOVO/AGUARDANDO — NUNCA responda com APROVADO/LIBERADO). ' +
          'Use filtro="nao_avulsa" quando pedirem o último que não seja proposta avulsa (com itens detalháveis).',
        parameters: {
          type: 'object',
          properties: {
            ...ID_CLIENTE_PROP,
            filtro: {
              type: 'string',
              enum: ['qualquer', 'nao_aprovada_comercial', 'nao_avulsa'],
              description: 'Padrão: qualquer (última proposta independente de status).',
            },
          },
          additionalProperties: false,
        },
      },
    },
    handler: async (args, ctx) => {
      const idCliente = (args.__idClienteSeguro as number)!;
      const filtroArg = typeof args.filtro === 'string' ? args.filtro : 'qualquer';
      const filtro = filtroArg === 'nao_aprovada_comercial' || filtroArg === 'nao_avulsa' ? filtroArg : 'qualquer';
      const res = await buscarUltimoOrcamento(ctx.supabase, idCliente, filtro);
      return {
        ...res,
        items: marcarPedidoReal(res.items),
        semantica: SEMANTICA_PROPOSTAS,
        atencao: res.janela_esgotada
          ? `Nenhuma encontrada nas ${res.varridas} propostas mais recentes — pode existir uma mais antiga; diga isso em vez de afirmar que não existe.`
          : 'Este é o último ORÇAMENTO/proposta gerado — só chame de "aprovado" ou "pedido" se pedido_real=true.',
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

  soma_pedidos_producao_periodo: {
    needsActiveClient: true,
    schema: {
      type: 'function',
      function: {
        name: 'soma_pedidos_producao_periodo',
        description:
          'Soma dos PEDIDOS REAIS DE PRODUÇÃO (is_prd_aprovado, fila oficial) do cliente ativo em um período. ' +
          'ATENÇÃO: isto NÃO é o "faturamento" do vocabulário da equipe — para faturamento/vendas de um período ' +
          'use propostas_cliente e responda com aprovadas_comercial. Também NÃO é dinheiro recebido (recebimento_periodo).',
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
          'Valor efetivamente RECEBIDO do cliente ativo em um período (caixa). Fonte: public.pagamentos_v2 ' +
          '(status=PAID, confirmado=true, referência paid_at). Aceita recorte por empresa (id_empresa). ' +
          'Diferente de faturamento oficial (data_confirmacao) e de boletos.',
        parameters: {
          type: 'object',
          properties: { ...ID_CLIENTE_PROP, periodo: PERIODO_SCHEMA, ...ID_EMPRESA_PROP },
          required: ['periodo'],
          additionalProperties: false,
        },
      },
    },
    handler: async (args, ctx) => {
      const idCliente = (args.__idClienteSeguro as number)!;
      const periodo = mapPeriodoArg(args.periodo);
      if (!periodo) return { found: false, error: 'Período inválido.' };
      return await calcularRecebimentoPeriodo(ctx.supabase, idCliente, periodo, idEmpresaDe(args));
    },
  },

  perfil_pagamento_cliente: {
    needsActiveClient: true,
    schema: {
      type: 'function',
      function: {
        name: 'perfil_pagamento_cliente',
        description:
          'Como o cliente ativo COSTUMA pagar de verdade: agregado dos pagamentos confirmados ' +
          '(pagamentos_v2, PAID) por tipo de cobrança (PIX, BOLETO, cartão...) com contagens, somas e ' +
          'condições a prazo usadas. Use para "como ele paga", "perfil/comportamento de pagamento". ' +
          'Números JÁ VÊM AGREGADOS — nunca conte nem some. Aceita recorte por empresa (id_empresa). ' +
          'Não confundir com o campo cadastral padrao_pagamento.',
        parameters: {
          type: 'object',
          properties: {
            ...ID_CLIENTE_PROP,
            ...ID_EMPRESA_PROP,
            dias: { type: 'number', description: 'Janela em dias (padrão 365, máx 1830).' },
          },
          additionalProperties: false,
        },
      },
    },
    handler: async (args, ctx) => {
      const idCliente = (args.__idClienteSeguro as number)!;
      const dias = Number.isFinite(Number(args.dias)) ? Number(args.dias) : 365;
      return await calcularPerfilPagamento(ctx.supabase, idCliente, dias, idEmpresaDe(args));
    },
  },

  comparar_recebimento_meses: {
    needsActiveClient: true,
    schema: {
      type: 'function',
      function: {
        name: 'comparar_recebimento_meses',
        description:
          'Comparar recebimentos (pagamentos_v2, PAID, por paid_at) do cliente ativo em múltiplos meses ' +
          'específicos (máximo 6). Aceita recorte por empresa (id_empresa).',
        parameters: {
          type: 'object',
          properties: {
            ...ID_CLIENTE_PROP,
            ...ID_EMPRESA_PROP,
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
      return await compararRecebimentoClienteMeses(ctx.supabase, idCliente, meses, idEmpresaDe(args));
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

  vendas_por_vendedor: {
    schema: {
      type: 'function',
      function: {
        name: 'vendas_por_vendedor',
        description:
          'FATURAMENTO OFICIAL por vendedor em um período: ranking ou um vendedor específico. ' +
          'Fonte oficial: pagamentos_v2 confirmados com status PAID ou A_VENCER, período por data_confirmacao; ' +
          'faturamento = soma dos pagamentos, propostas = id_int distintos (NUNCA por data de criação da proposta). ' +
          'Use para "quanto vendeu/faturou o(a) X", "ranking de vendedores", "vendas da equipe", comissão e metas. ' +
          'EMPRESA: separar_por_empresa=true devolve subtotais por empresa (pagamentos_v2.id_empresa — NUNCA a ' +
          'empresa do cadastro do cliente) com os vendedores dentro de cada uma; id_empresa filtra uma empresa. ' +
          'Pagamentos sem id_empresa aparecem num grupo próprio, nunca descartados. ' +
          'PERMISSÃO aplicada no servidor: sem propostas.view_all o usuário vê SOMENTE os próprios números ' +
          '(campo escopo="proprio" na resposta — explique a restrição com naturalidade). Não exige cliente ativo.',
        parameters: {
          type: 'object',
          properties: {
            vendedor: { type: 'string', description: 'Opcional — nome (ou parte) do vendedor. Omitir traz o ranking de todos.' },
            periodo: { ...PERIODO_SCHEMA, description: 'Período por data_confirmacao dos pagamentos.' },
            id_empresa: { type: 'number', description: 'Opcional — filtra uma empresa (pagamentos_v2.id_empresa).' },
            separar_por_empresa: { type: 'boolean', description: 'Opcional — subtotais por empresa com vendedores dentro de cada uma ("separe por empresa/filial").' },
          },
          required: ['periodo'],
          additionalProperties: false,
        },
      },
    },
    handler: async (args, ctx) => {
      const periodo = mapPeriodoArg(args.periodo);
      if (!periodo) return { found: false, error: 'Período inválido.' };
      const intervalo = intervaloDoPeriodo(periodo);
      if (!intervalo.desde) return { found: false, error: 'Período inválido.' };

      const vendedorArg = typeof args.vendedor === 'string' ? args.vendedor.trim() : '';

      // Gate de permissão (decisão de produto): gestores (propostas.view_all)
      // veem todos; os demais veem SOMENTE os próprios números.
      const gestor = await verificarPermissaoServerSide(ctx.supabase, ctx.userId, 'propostas.view_all');
      let vendedorNome = vendedorArg || undefined;
      let escopo: 'todos' | 'proprio' = 'todos';

      if (!gestor) {
        const eu = await buscarNomeUsuario(ctx.supabase, ctx.userId);
        if (!eu.nome) {
          return {
            found: false,
            error: 'PERMISSAO_NEGADA: o perfil do usuário não permite ver vendas de outros vendedores e não foi possível identificar o vendedor dele. Explique com educação.',
          };
        }
        vendedorNome = eu.nome;
        escopo = 'proprio';
      }

      const idEmpresaArg = Number(args.id_empresa);
      const res = await calcularFaturamentoOficial(ctx.supabase, {
        desde: intervalo.desde,
        ate: intervalo.ate,
        periodoLabel: periodo.label,
        vendedorNome,
        // ranking apenas quando não há filtro de vendedor
        agruparPorVendedor: !vendedorNome,
        idEmpresa: Number.isFinite(idEmpresaArg) && idEmpresaArg > 0 ? idEmpresaArg : undefined,
        agruparPorEmpresa: args.separar_por_empresa === true,
      });

      return {
        ...res,
        escopo,
        ...(escopo === 'proprio'
          ? { restricao: 'Usuário sem propostas.view_all — mostrando apenas os números do próprio vendedor.' }
          : {}),
      };
    },
  },

  conta_corrente_cliente: {
    needsActiveClient: true,
    schema: {
      type: 'function',
      function: {
        name: 'conta_corrente_cliente',
        description:
          'Conta corrente do cliente ativo: saldo de crédito disponível, pendências por direção ' +
          '(FAVOR_CLIENTE = a favor do cliente; FAVOR_EMPRESA = a favor da empresa) com somas das ABERTAS ' +
          'já calculadas, e extrato recente de créditos/débitos. Use para "saldo do cliente", "pendências", ' +
          '"crédito em conta", "extrato de crédito".',
        parameters: { type: 'object', properties: { ...ID_CLIENTE_PROP }, additionalProperties: false },
      },
    },
    handler: async (args, ctx) => {
      const idCliente = (args.__idClienteSeguro as number)!;
      return await buscarContaCorrenteCliente(ctx.supabase, idCliente);
    },
  },

  analise_credito_cliente: {
    needsActiveClient: true,
    // fn_analise_credito_cliente é SECURITY DEFINER (roda como owner) — além
    // do isolamento por cliente resolvido, exige a permissão do módulo de
    // crédito do ERP (Financeiro/Administração; vendedor comum não tem).
    requiredPermission: 'cadastros.view_credito',
    schema: {
      type: 'function',
      function: {
        name: 'analise_credito_cliente',
        description:
          'ANÁLISE DE CRÉDITO oficial do cliente ativo (RPC do ERP): limite, utilizado, saldo em carteira, ' +
          'disponível, status/risco de crédito, histórico de atrasos (média/maior/quantidade), pedidos aprovados ' +
          'e ticket médio. Use para "posso vender a prazo?", "como está o crédito", "análise de crédito". ' +
          'Exige permissão do módulo de crédito — se negada, explique com naturalidade.',
        parameters: { type: 'object', properties: { ...ID_CLIENTE_PROP }, additionalProperties: false },
      },
    },
    handler: async (args, ctx) => {
      const idCliente = (args.__idClienteSeguro as number)!;
      return await buscarAnaliseCredito(ctx.supabase, idCliente);
    },
  },

  faturamento_cliente: {
    needsActiveClient: true,
    schema: {
      type: 'function',
      function: {
        name: 'faturamento_cliente',
        description:
          'FATURAMENTO OFICIAL do cliente ativo em um período. Fonte oficial: pagamentos_v2 confirmados ' +
          'com status PAID ou A_VENCER, período por data_confirmacao; faturamento = soma dos pagamentos, ' +
          'propostas = id_int distintos. Use para "faturamento/vendas do cliente no período". ' +
          'Aceita recorte por empresa (id_empresa) e separar_por_empresa=true para subtotais por empresa. ' +
          'NÃO confundir com recebimento_periodo (caixa, por paid_at) nem com propostas_cliente (pipeline comercial).',
        parameters: {
          type: 'object',
          properties: {
            ...ID_CLIENTE_PROP,
            periodo: PERIODO_SCHEMA,
            ...ID_EMPRESA_PROP,
            separar_por_empresa: { type: 'boolean', description: 'Opcional — subtotais por empresa ("separe por empresa/filial").' },
          },
          required: ['periodo'],
          additionalProperties: false,
        },
      },
    },
    handler: async (args, ctx) => {
      const idCliente = (args.__idClienteSeguro as number)!;
      const periodo = mapPeriodoArg(args.periodo);
      if (!periodo) return { found: false, error: 'Período inválido.' };
      const intervalo = intervaloDoPeriodo(periodo);
      if (!intervalo.desde) return { found: false, error: 'Período inválido.' };

      return await calcularFaturamentoOficial(ctx.supabase, {
        desde: intervalo.desde,
        ate: intervalo.ate,
        periodoLabel: periodo.label,
        idCliente,
        idEmpresa: idEmpresaDe(args),
        agruparPorEmpresa: args.separar_por_empresa === true,
      });
    },
  },

  listar_produtos: {
    schema: {
      type: 'function',
      function: {
        name: 'listar_produtos',
        description:
          'Listar produtos do catálogo por busca AMPLA (nome, apelidos, descrição e categoria, match parcial). ' +
          'Use para "quais produtos temos", "lista de pulseiras/credenciais/cordões", "o que vendemos", para ' +
          'COMPARAR produtos e para DETALHES de um produto: cada item traz preço, formato (dimensões), peso unitário ' +
          'em gramas, prazo de produção, nível de segurança, personalização disponível, descrição oficial, frase ' +
          'comercial do consultor e quantidade mínima. Sem termo lista o catálogo ativo inteiro, agrupado por categoria. ' +
          'Não exige cliente ativo. Para COTAR um item específico continue usando buscar_produto/simular_orcamento_avulso.',
        parameters: {
          type: 'object',
          properties: {
            termo: { type: 'string', description: 'Opcional — família ou palavra-chave (ex.: pulseira, credencial, jacaré).' },
            incluir_inativos: { type: 'boolean', description: 'Padrão false — só produtos ativos.' },
          },
          additionalProperties: false,
        },
      },
    },
    handler: async (args, ctx) => {
      const termo = typeof args.termo === 'string' ? args.termo : undefined;
      return await listarProdutosCatalogo(ctx.supabase, {
        termo,
        incluirInativos: args.incluir_inativos === true,
      });
    },
  },

  fotos_produto: {
    schema: {
      type: 'function',
      function: {
        name: 'fotos_produto',
        description:
          'Fotos oficiais de um produto do catálogo (URLs públicas https). Use quando pedirem foto/imagem/"como é" ' +
          'o produto. Cada foto retornada deve ser exibida como imagem markdown: ![Nome do produto](url). ' +
          'Se found=false, use EXATAMENTE a mensagem_sem_fotos retornada (os administradores ainda não salvaram ' +
          'as fotos) — NUNCA diga que "não encontrou as fotos". Não exige cliente ativo.',
        parameters: {
          type: 'object',
          properties: {
            nome_produto: {
              type: 'string',
              description: 'Nome do produto (ideal: o nome exato do catálogo, ex.: "Pulseira Triband") ou o termo dito pelo usuário.',
            },
          },
          required: ['nome_produto'],
          additionalProperties: false,
        },
      },
    },
    handler: async (args, ctx) => {
      const nome = String(args.nome_produto ?? '').trim();
      if (!nome) return { found: false, reason: 'nome_vazio' };
      return await buscarFotosProduto(ctx.supabase, nome);
    },
  },

  buscar_produto: {
    schema: {
      type: 'function',
      function: {
        name: 'buscar_produto',
        description:
          'Buscar produto do catálogo por apelido, descrição ou id (preço unitário, valor fixo, ativo) — busca PONTUAL ' +
          'para cotação. Para listas por família ("todas as pulseiras") use listar_produtos. ' +
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

  opcoes_frete: {
    needsActiveClient: true,
    schema: {
      type: 'function',
      function: {
        name: 'opcoes_frete',
        description:
          'Cotar as opções de FRETE reais para entregar itens ao cliente ativo (endereço resolvido no servidor): ' +
          'SEDEX/PAC, Azul Cargo, transportadoras e VEPPO, conforme a região — mais "Retira no Balcão" R$ 0,00, ' +
          'sempre disponível. Nada é salvo. Apresente as opções numeradas com transportadora, valor EXATO e prazo; ' +
          'os valores são cotações do momento. Para salvar a proposta com uma delas, chame ' +
          'salvar_cotacao_como_proposta passando frete com o nome da opção.',
        parameters: {
          type: 'object',
          properties: {
            ...ID_CLIENTE_PROP,
            itens: {
              type: 'array',
              description: 'Itens da cotação (produto e quantidade) — o peso vem do cadastro dos produtos.',
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
      const idCliente = (args.__idClienteSeguro as number)!;
      const itensRaw: unknown[] = Array.isArray(args.itens) ? args.itens : [];
      const itens = itensRaw
        .map(raw => {
          const i = raw as { quantidade?: unknown; termo?: unknown } | null;
          return { quantidade: Number(i?.quantidade), termo: String(i?.termo ?? '').trim() };
        })
        .filter(i => Number.isFinite(i.quantidade) && i.quantidade > 0 && i.termo.length > 0);
      if (itens.length === 0) return { found: false, motivo: 'Informe os itens (produto e quantidade) para cotar o frete.' };

      const sim = await simularOrcamentoAvulsoDb(ctx.supabase, itens);
      const problemas: string[] = [];
      let pesoGramas = 0;
      let subtotal = 0;
      for (const item of sim.itens) {
        if (item.status !== 'sucesso' || item.produtosEncontrados.length !== 1) {
          problemas.push(`"${item.termo}": ${item.status}`);
          continue;
        }
        const p = item.produtosEncontrados[0];
        pesoGramas += (p.pesoUnitario ?? 0) * item.quantidade;
        subtotal += item.subtotalCalculado ?? 0;
      }
      if (problemas.length > 0) {
        return { found: false, motivo: `Itens não prontos para cotação de frete: ${problemas.join('; ')}.` };
      }
      return await cotarOpcoesFrete(ctx.supabase, idCliente, {
        pesoGramas: Math.round(pesoGramas),
        valorTotal: Number(subtotal.toFixed(2)),
      });
    },
  },

  salvar_cotacao_como_proposta: {
    needsActiveClient: true,
    isWrite: true,
    writeActionFlagEnabled: isWriteSalvarCotacaoEnabled,
    // §2.1 da matriz: perfis com propostas.create (Vendedor, Administrador)
    requiredPermission: 'propostas.create',
    schema: {
      type: 'function',
      function: {
        name: 'salvar_cotacao_como_proposta',
        description:
          'ÚNICA ação de escrita: salvar a cotação simulada como proposta REAL no ERP, em DUAS FASES. ' +
          '1ª chamada (com itens) = PROPOSTA: nada é salvo; apresente o resumo EXATO retornado (itens, valores, ' +
          'desconto/bônus, frete e total) e pergunte se o usuário confirma. ' +
          '2ª chamada (sem itens, no turno SEGUINTE, somente após confirmação EXPLÍCITA do usuário) = EXECUÇÃO ' +
          'pelo fluxo oficial. NUNCA chame para executar sem o usuário ter confirmado a proposta apresentada; ' +
          'NUNCA proponha e execute no mesmo turno. Se vier alertaRestricao, a confirmação deve mencioná-lo.',
        parameters: {
          type: 'object',
          properties: {
            ...ID_CLIENTE_PROP,
            itens: {
              type: 'array',
              description: 'Itens a salvar (obrigatório na fase de PROPOSTA; ignorado na execução).',
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
            frete: {
              type: 'string',
              description:
                'Opcional — frete escolhido pelo usuário: nome da opção cotada por opcoes_frete (ex.: "SEDEX", ' +
                '"Azul Cargo"), "mais barato" ou "retira" (padrão: Retira no Balcão R$ 0,00). Ignorado na execução.',
            },
          },
          additionalProperties: false,
        },
      },
    },
    handler: async (args, ctx) => {
      const idCliente = (args.__idClienteSeguro as number)!;
      const pend = ctx.state.pendingWriteAction;

      // ── FASE EXECUTAR: pendência criada em turno ANTERIOR + confirmação ────
      const pendDoTurnoAnterior =
        pend != null &&
        pend.tipo === 'salvar_cotacao_como_proposta' &&
        pend.turnId !== ctx.state.currentTurnId;

      if (pendDoTurnoAnterior) {
        if (pend.idCliente !== idCliente) {
          ctx.state.pendingWriteAction = null;
          return {
            fase: 'rejeitada',
            motivo: 'A proposta pendente era para OUTRO cliente — foi descartada. Proponha novamente se necessário.',
          };
        }
        const res = await executarSalvarCotacao(ctx.supabase, ctx.userId, pend, ctx.state.currentTurnId);
        if (res.ok) {
          ctx.state.pendingWriteAction = null;
          const freteDesc = pend.freteEscolhido
            ? `${pend.freteEscolhido.transportadora} R$ ${pend.freteEscolhido.valor.toFixed(2)}`
            : 'Retira no Balcão R$ 0,00';
          // PDF oficial da proposta recém-criada (best-effort — a proposta já existe)
          const pdf = await gerarPdfPropostaServer(ctx.supabase, res.idInt);
          return {
            fase: 'executada',
            savedIdInt: res.idInt,
            total: pend.total,
            pdfUrl: pdf.success ? pdf.url : null,
            pdfIndisponivel: pdf.success ? undefined : (pdf.errorMessage ?? 'falha na geração'),
            mensagem:
              `Proposta nº ${res.idInt} criada com sucesso pelo fluxo oficial (status NOVO, frete ${freteDesc}).` +
              (pdf.success && pdf.url
                ? ` PDF pronto — apresente o link markdown: [Baixar PDF da proposta ${res.idInt}](${pdf.url})`
                : ' O PDF não pôde ser gerado agora — a proposta existe e o PDF pode ser gerado na tela de Orçamentos.'),
          };
        }
        if (res.reproposta) {
          // §4: alvo mudou → aborta e re-propõe com os dados NOVOS
          ctx.state.pendingWriteAction = res.reproposta;
          return {
            fase: 'reproposta',
            motivo: res.motivo,
            resumo: res.reproposta,
            atencao:
              'NADA foi salvo — os dados mudaram desde a proposta. Apresente o NOVO resumo exato e peça nova confirmação.',
          };
        }
        ctx.state.pendingWriteAction = null;
        return { fase: 'rejeitada', motivo: res.motivo, atencao: 'NADA foi salvo. Explique o motivo ao usuário.' };
      }

      // ── FASE PROPOR ────────────────────────────────────────────────────────
      if (pend != null && pend.turnId === ctx.state.currentTurnId) {
        // O modelo tentou executar no MESMO turno da proposta — bloqueado (§4)
        return {
          fase: 'aguardando_confirmacao',
          atencao:
            'A proposta acabou de ser criada NESTE turno. Apresente o resumo ao usuário e AGUARDE a confirmação ' +
            'no próximo turno — não chame esta ferramenta de novo agora.',
          resumo: pend,
        };
      }

      const itensRaw: unknown[] = Array.isArray(args.itens) ? args.itens : [];
      const itens: ItemCotacaoReq[] = itensRaw.map(raw => {
        const i = raw as { quantidade?: unknown; termo?: unknown } | null;
        return { quantidade: Number(i?.quantidade), termo: String(i?.termo ?? '').trim() };
      });

      const prop = await proporSalvarCotacao(
        ctx.supabase,
        idCliente,
        ctx.state.activeClient?.clientFantasia || ctx.state.activeClient?.clientName || `Cliente ${idCliente}`,
        itens,
        ctx.state.currentTurnId,
        typeof args.frete === 'string' ? args.frete : undefined,
      );
      if (!prop.ok) {
        return { fase: 'nao_proposta', motivo: prop.motivo, atencao: 'NADA foi salvo.' };
      }

      ctx.state.pendingWriteAction = prop.pendencia;
      const freteResumo = prop.pendencia.freteEscolhido
        ? `${prop.pendencia.freteEscolhido.transportadora} R$ ${prop.pendencia.freteEscolhido.valor.toFixed(2)} (${prop.pendencia.freteEscolhido.prazo})`
        : 'Retira no Balcão R$ 0,00';
      return {
        fase: 'proposta_criada',
        resumo: prop.pendencia,
        atencao:
          'NADA FOI SALVO AINDA. Apresente este resumo EXATO (itens, quantidades, valores, desconto/bônus, total, ' +
          `frete ${freteResumo}` +
          (prop.pendencia.alertaRestricao ? `, e o ALERTA: ${prop.pendencia.alertaRestricao}` : '') +
          ') e pergunte se o usuário confirma o salvamento. A execução só acontece no próximo turno.',
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
          'Subtotais, total, pesoTotalGramas (peso da quantidade) e prazoProducao JÁ VÊM CALCULADOS — nunca recalcule. ' +
          'Também responde "quanto pesa X unidades de Y". Não exige cliente ativo.',
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
      // aparecer no orçamento formatado (não a descrição crua do banco) —
      // e com prazo de produção e peso total JÁ CALCULADOS (o modelo nunca calcula).
      return {
        ...res,
        itens: res.itens.map(item => {
          const catalogo = resolverTermoCatalogo(item.termo);
          const produto = item.produtosEncontrados.length === 1 ? item.produtosEncontrados[0] : null;
          const pesoUnit = produto?.pesoUnitario;
          return {
            ...item,
            nomeComercialOficial:
              catalogo.nomeComercial ??
              item.produtosEncontrados[0]?.descricao ??
              item.termo,
            prazoProducao: produto?.prazo ?? null,
            pesoTotalGramas:
              pesoUnit != null && Number.isFinite(pesoUnit) && item.quantidade > 0
                ? Number((pesoUnit * item.quantidade).toFixed(1))
                : null,
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
  // 1. Deny-by-default: só executa tool do catálogo (camada 2 da matriz)
  const tool = Object.prototype.hasOwnProperty.call(AGENT_TOOLS, name) ? AGENT_TOOLS[name] : undefined;
  if (!tool) {
    return { ok: false, error: `Ferramenta "${name}" não existe no catálogo.` };
  }

  // 1b. ESCRITA (camadas 1 e 3 da matriz): flag global + flag da ação.
  // Ambas default OFF — ausência de flag = NEGADO.
  if (tool.isWrite) {
    if (!isAgentWriteEnabled()) {
      return {
        ok: false,
        error:
          'ESCRITA_DESABILITADA: as ações de escrita do Maestro estão desligadas neste ambiente. ' +
          'Explique com naturalidade e oriente o módulo correspondente do ERP.',
      };
    }
    if (!tool.writeActionFlagEnabled || !tool.writeActionFlagEnabled()) {
      return {
        ok: false,
        error:
          'ESCRITA_DESABILITADA: esta ação específica ainda não está habilitada. ' +
          'Explique com naturalidade e oriente o módulo correspondente do ERP.',
      };
    }
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
    let permitido = false;
    try {
      permitido = await verificarPermissaoServerSide(ctx.supabase, ctx.userId, tool.requiredPermission);
    } catch (err) {
      // Falha na checagem NUNCA vira acesso — nega e registra
      console.error(`[MaestroAgentTools] Erro ao verificar permissão "${tool.requiredPermission}":`, err);
      permitido = false;
    }
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
