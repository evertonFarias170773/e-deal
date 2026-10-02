/**
 * maestro-agent-escopo.server.ts
 *
 * Trava de vendedor nas consultas POR CLIENTE do Maestro (propostas,
 * recebimentos, boletos, conta corrente) — decisao do dono em 02/10/2026:
 * a mesma regra da consulta por pedido. Vendedor sem visao geral ve so os
 * proprios clientes e pedidos.
 *
 * A REGRA
 *   Vale para quem `escopoDePedidos` classifica como `proprios` (vendedor sem
 *   `propostas.view_all`). Visao geral e quem nao vende seguem como estavam.
 *
 *   1. O CLIENTE e dele quando esta na carteira dele (`clientes.nome_vendedor`)
 *      OU quando ele tem ao menos um pedido ligado ao cliente (como cliente ou
 *      como faturado). Fora disso, nenhuma consulta por cliente devolve dado.
 *   2. Dentro de um cliente dele, so os PEDIDOS dele: proposta, pagamento,
 *      boleto e movimento de pedido de outro vendedor nao aparecem. Linha sem
 *      pedido nenhum (boleto avulso) aparece so para o dono da carteira.
 *
 * ONDE A TRAVA MORA
 *   Dentro dos adapters de dados (maestro-simple-*.server.ts), e nao em quem os
 *   chama: assim vale igual para o agent loop e para o motor legado, e um
 *   chamador novo nao escapa por esquecimento. A RLS dessas tabelas e aberta
 *   para qualquer usuario logado — por isso a trava tem de estar no codigo.
 *
 * QUEM ESTA PERGUNTANDO
 *   A rota registra o usuario da sessao no client Supabase da requisicao
 *   (`registrarUsuarioDoMaestro`). Os adapters so recebem o client, entao e por
 *   ele que descobrem o usuario. Client sem registro = usuario nao identificado
 *   = consulta recusada (falha fechada).
 *
 * ⚠️ Roda apenas no servidor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  carregarAcessoUsuario,
  escopoDePedidos,
  pedidoEDoVendedor,
  type AcessoUsuario,
} from './maestro-agent-acesso.server';

export type CodigoDeRecusa = 'CLIENTE_DE_OUTRO_VENDEDOR' | 'USUARIO_NAO_IDENTIFICADO' | 'ESCOPO_INDISPONIVEL';

export interface EscopoDoCliente {
  /** false = visao geral ou quem nao vende: nada e recusado nem filtrado */
  restrito: boolean;
  permitido: boolean;
  codigo?: CodigoDeRecusa;
  /** O cliente esta na carteira de quem pergunta */
  carteira: boolean;
  /** Grafias de propostas.vendedor que sao de quem pergunta, entre os pedidos ligados ao cliente */
  nomesDele: string[];
  /** Pedidos ligados ao cliente (como cliente ou faturado) que sao dele */
  idsDele: ReadonlySet<number>;
  /** Pedidos ligados ao cliente que sao de outro vendedor */
  idsDeOutros: ReadonlySet<number>;
}

const VAZIO: ReadonlySet<number> = new Set<number>();

const LIVRE: EscopoDoCliente = { restrito: false, permitido: true, carteira: false, nomesDele: [], idsDele: VAZIO, idsDeOutros: VAZIO };

function recusado(codigo: CodigoDeRecusa): EscopoDoCliente {
  return { restrito: true, permitido: false, codigo, carteira: false, nomesDele: [], idsDele: VAZIO, idsDeOutros: VAZIO };
}

/** Texto para o MODELO quando o cliente nao e de quem pergunta. Nenhum dado do cliente. */
export const RECUSA_CLIENTE_DE_OUTRO_VENDEDOR =
  'CLIENTE_DE_OUTRO_VENDEDOR: este cliente não está na carteira de quem pergunta e ele não tem nenhum pedido com o cliente. ' +
  'O perfil dele só consulta os próprios clientes e pedidos. NENHUM dado comercial ou financeiro deste cliente foi consultado: ' +
  'não informe propostas, pedidos, valores, recebimentos, boletos nem saldo de conta corrente, e não complete com o histórico da conversa. ' +
  'Diga isso com naturalidade e oriente a pedir ao vendedor do cliente ou a quem tem visão geral (permissão "Ver Todas as Propostas"). ' +
  'Cadastro, cotação e frete do cliente continuam disponíveis.';

/** Texto para o USUARIO, usado quando a recusa acontece no motor legado. */
export const RESPOSTA_CLIENTE_DE_OUTRO_VENDEDOR =
  'Esse cliente não está na sua carteira e você não tem pedido com ele. Pelo seu perfil, eu só consulto propostas, recebimentos, ' +
  'boletos e conta corrente dos seus próprios clientes e pedidos. Para esses dados, peça ao vendedor do cliente ou a quem tem a ' +
  'permissão "Ver Todas as Propostas". Cadastro, cotação e frete eu continuo fazendo normalmente.';

export const RESPOSTA_USUARIO_NAO_IDENTIFICADO =
  'Não consegui confirmar o seu perfil agora, então não consultei os dados desse cliente. Tente de novo em instantes.';

/** Lancada pelos adapters quando a consulta e recusada. Quem chama decide a mensagem. */
export class RecusaDeEscopoDoMaestro extends Error {
  readonly codigo: CodigoDeRecusa;
  constructor(codigo: CodigoDeRecusa) {
    super(codigo);
    this.name = 'RecusaDeEscopoDoMaestro';
    this.codigo = codigo;
  }
}

// ─── Usuario da requisicao ───────────────────────────────────────────────────

interface Registro {
  userId: string;
  acesso?: Promise<AcessoUsuario>;
  clientes: Map<number, Promise<EscopoDoCliente>>;
}

// Um client Supabase por requisicao → o registro some junto com ele.
const REGISTROS = new WeakMap<object, Registro>();

/** Diz aos adapters de quem e esta requisicao. Idempotente para o mesmo usuario. */
export function registrarUsuarioDoMaestro(supabase: SupabaseClient, userId: string): void {
  const atual = REGISTROS.get(supabase);
  if (atual && atual.userId === userId) return;
  REGISTROS.set(supabase, { userId, clientes: new Map() });
}

function acessoDoRegistro(supabase: SupabaseClient, registro: Registro): Promise<AcessoUsuario> {
  if (!registro.acesso) registro.acesso = carregarAcessoUsuario(supabase, registro.userId);
  return registro.acesso;
}

// ─── Escopo de um cliente ────────────────────────────────────────────────────

const PAGINA = 1000; // teto de linhas por leitura do PostgREST deste projeto
const MAX_PAGINAS = 10;

async function calcularEscopo(supabase: SupabaseClient, acesso: AcessoUsuario, idCliente: number): Promise<EscopoDoCliente> {
  const { data: cliente, error: erroCliente } = await supabase
    .from('clientes')
    .select('nome_vendedor')
    .eq('id_cliente', idCliente)
    .maybeSingle();
  if (erroCliente) return recusado('ESCOPO_INDISPONIVEL');

  const carteira = pedidoEDoVendedor(acesso, (cliente as { nome_vendedor?: string | null } | null)?.nome_vendedor ?? null);

  // Pedidos ligados ao cliente: como cliente do pedido ou como faturado.
  const idsDele = new Set<number>();
  const idsDeOutros = new Set<number>();
  const nomesDele = new Set<string>();
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const { data, error } = await supabase
      .from('propostas')
      .select('id_int, vendedor')
      .or(`id_cliente.eq.${idCliente},id_faturado.eq.${idCliente}`)
      .order('id_int', { ascending: true })
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
    if (error) return recusado('ESCOPO_INDISPONIVEL');
    const linhas = (data ?? []) as Array<{ id_int: unknown; vendedor: unknown }>;
    for (const l of linhas) {
      const id = Number(l.id_int);
      if (!Number.isFinite(id)) continue;
      const vendedor = typeof l.vendedor === 'string' ? l.vendedor : null;
      if (pedidoEDoVendedor(acesso, vendedor)) {
        idsDele.add(id);
        if (vendedor) nomesDele.add(vendedor);
      } else {
        // Pedido sem vendedor nao e de ninguem: fica fora, como o de outro vendedor.
        idsDeOutros.add(id);
      }
    }
    if (linhas.length < PAGINA) break;
  }

  const permitido = carteira || idsDele.size > 0;
  return {
    restrito: true,
    permitido,
    codigo: permitido ? undefined : 'CLIENTE_DE_OUTRO_VENDEDOR',
    carteira,
    nomesDele: [...nomesDele],
    idsDele,
    idsDeOutros,
  };
}

/**
 * Escopo de quem pergunta sobre este cliente. Nunca lanca: qualquer falha vira
 * recusa (falha fechada). Resultado guardado pela duracao da requisicao.
 */
export async function escopoDoClienteNaConsulta(supabase: SupabaseClient, idCliente: number): Promise<EscopoDoCliente> {
  const registro = REGISTROS.get(supabase);
  if (!registro) return recusado('USUARIO_NAO_IDENTIFICADO');

  try {
    const acesso = await acessoDoRegistro(supabase, registro);
    if (!acesso.encontrado) return recusado('USUARIO_NAO_IDENTIFICADO');
    if (escopoDePedidos(acesso) !== 'proprios') return LIVRE;
    if (!Number.isFinite(idCliente)) return recusado('CLIENTE_DE_OUTRO_VENDEDOR');

    let pendente = registro.clientes.get(idCliente);
    if (!pendente) {
      pendente = calcularEscopo(supabase, acesso, idCliente).catch(() => recusado('ESCOPO_INDISPONIVEL'));
      registro.clientes.set(idCliente, pendente);
    }
    return await pendente;
  } catch (err) {
    console.error('[MaestroEscopo] Erro ao resolver o escopo do cliente:', err);
    return recusado('ESCOPO_INDISPONIVEL');
  }
}

/** Para os adapters: devolve o escopo ou LANCA a recusa antes de qualquer leitura de dado. */
export async function exigirClienteNoEscopo(supabase: SupabaseClient, idCliente: number): Promise<EscopoDoCliente> {
  const escopo = await escopoDoClienteNaConsulta(supabase, idCliente);
  if (!escopo.permitido) throw new RecusaDeEscopoDoMaestro(escopo.codigo ?? 'CLIENTE_DE_OUTRO_VENDEDOR');
  return escopo;
}

/** O cliente tem pedido de outro vendedor? So nesse caso ha o que filtrar em propostas. */
export function temPedidoDeOutroVendedor(escopo: EscopoDoCliente): boolean {
  return escopo.restrito && escopo.idsDeOutros.size > 0;
}

/**
 * Consulta em public.propostas: restringe aos pedidos de quem pergunta, pelo
 * nome gravado no pedido. So mexe na consulta quando o cliente tem pedido de
 * outro vendedor — no caso comum a consulta sai identica a de antes.
 */
export function soPropostasDoVendedor<Q>(consulta: Q, escopo: EscopoDoCliente): Q {
  if (!temPedidoDeOutroVendedor(escopo)) return consulta;
  // O tipo do construtor de consultas do Supabase e fundo demais para uma
  // restricao generica (TS2589); o metodo `in` devolve o proprio construtor.
  const comIn = consulta as unknown as { in(coluna: string, valores: readonly string[]): unknown };
  // Sem nenhum pedido dele: uma grafia impossivel faz a consulta voltar vazia.
  return comIn.in('vendedor', escopo.nomesDele.length > 0 ? escopo.nomesDele : ['\u0001sem pedido proprio']) as Q;
}

/**
 * Linhas financeiras (pagamentos, boletos, pendencias, movimentos): mantem so
 * as de pedido de quem pergunta.
 *   - pedido dele → fica;
 *   - pedido de outro vendedor → sai;
 *   - pedido que nao esta ligado ao cliente → confere o vendedor do pedido;
 *   - linha sem pedido (avulsa) → fica so para o dono da carteira.
 */
export async function soLinhasDoVendedor<T>(supabase: SupabaseClient, escopo: EscopoDoCliente, linhas: readonly T[]): Promise<T[]> {
  if (!escopo.restrito) return [...linhas];

  const idDe = (linha: T): number | null => {
    const bruto = (linha as { id_int?: unknown }).id_int;
    const n = bruto == null || bruto === '' ? NaN : Number(bruto);
    return Number.isFinite(n) ? n : null;
  };

  const desconhecidos = [...new Set(linhas.map(idDe).filter((id): id is number => id !== null && !escopo.idsDele.has(id) && !escopo.idsDeOutros.has(id)))];
  const pedidoExiste = new Set<number>();
  const pedidoDele = new Set<number>();
  if (desconhecidos.length > 0) {
    const registro = REGISTROS.get(supabase);
    const acesso = registro ? await acessoDoRegistro(supabase, registro) : null;
    for (let i = 0; i < desconhecidos.length; i += 300) {
      const { data, error } = await supabase.from('propostas').select('id_int, vendedor').in('id_int', desconhecidos.slice(i, i + 300));
      // Sem conseguir conferir, o pedido conta como de outro vendedor.
      if (error) return linhas.filter(l => { const id = idDe(l); return id !== null && escopo.idsDele.has(id); });
      for (const p of (data ?? []) as Array<{ id_int: unknown; vendedor: unknown }>) {
        const id = Number(p.id_int);
        pedidoExiste.add(id);
        if (acesso && pedidoEDoVendedor(acesso, typeof p.vendedor === 'string' ? p.vendedor : null)) pedidoDele.add(id);
      }
    }
  }

  return linhas.filter(linha => {
    const id = idDe(linha);
    if (id === null) return escopo.carteira;
    if (escopo.idsDele.has(id)) return true;
    if (escopo.idsDeOutros.has(id)) return false;
    if (pedidoExiste.has(id)) return pedidoDele.has(id);
    return escopo.carteira;
  });
}

/** Frase que acompanha um resultado filtrado, para o modelo dizer o recorte. */
export const NOTA_SO_OS_PEDIDOS_DELE =
  'Este cliente também tem pedidos de outro vendedor. O resultado considera SOMENTE os pedidos de quem pergunta — diga isso ao apresentar os números.';
