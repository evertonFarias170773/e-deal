/**
 * maestro-agent-pedido.server.ts
 *
 * Consulta SOMENTE LEITURA da situacao real de UM pedido/proposta pelo numero
 * (id_int), sem exigir cliente ativo na conversa. E o que deixa o Maestro olhar
 * o caso concreto antes de orientar ("os boletos do pedido 22812").
 *
 * Partes (o modelo pede so as que a pergunta precisa):
 *   situacao     → public.propostas
 *   cobrancas    → public.pagamentos_v2          (aba Pagamentos / Conferencia)
 *   titulos      → public.boletos                (Carteira)
 *   nota_fiscal  → public.notas_fiscais          (Notas fiscais)
 *   producao     → public.propostas_os(+setores) (Producao)
 *   expedicao    → public.expedicoes             (Expedicao)
 *   tarefas      → public.tarefas_equipe         (Tarefas — a RLS ja recorta)
 *
 * DUAS TRAVAS, as duas no servidor e ANTES de qualquer dado sair:
 *   1. Escopo por vendedor (maestro-agent-acesso.server.ts): vendedor sem visao
 *      geral so consulta o pedido em que ele e o vendedor. Pedido de outro
 *      vendedor devolve recusa SEM nenhum dado do pedido.
 *   2. Permissao por parte: cada parte exige a permissao da tela onde aquele
 *      dado aparece. Parte negada devolve so o nome da permissao que falta.
 *
 * Nunca sai daqui: linha digitavel, codigo de barras, nosso numero, PIX, link
 * de cobranca ou de PDF, chave de NF-e, CPF/CNPJ. O que o usuario precisa saber
 * ("o boleto esta registrado no banco?") sai como sim/nao calculado aqui.
 *
 * Todo total e contagem ja sai PRONTO — o modelo nunca soma.
 *
 * ⚠️ Roda apenas no servidor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { rotuloDaPermissao } from '../../../usuarios-perfis/catalogo-permissoes';
import {
  escopoDePedidos,
  pedidoEDoVendedor,
  podeNaTela,
  type AcessoUsuario,
} from './maestro-agent-acesso.server';

export const SECOES_DO_PEDIDO = ['situacao', 'cobrancas', 'titulos', 'nota_fiscal', 'producao', 'expedicao', 'tarefas'] as const;
export type SecaoDoPedido = (typeof SECOES_DO_PEDIDO)[number];

/** Permissao da tela de cada parte: basta UMA das chaves (alem de admin / super admin). */
const PERMISSAO_DA_SECAO: Record<SecaoDoPedido, { chaves: string[]; tela: string }> = {
  situacao: { chaves: ['propostas.view', 'propostas.view_own', 'propostas.view_all'], tela: 'Pedidos' },
  cobrancas: { chaves: ['cobrancas.view', 'cobrancas.create', 'conferencia.view'], tela: 'aba Pagamentos da proposta / Conferência' },
  titulos: { chaves: ['contas_receber.view'], tela: 'Financeiro → Carteira' },
  nota_fiscal: { chaves: ['fiscal.view'], tela: 'Financeiro → Notas fiscais' },
  producao: { chaves: ['pedidos.view'], tela: 'Produção' },
  expedicao: { chaves: ['expedicao.view'], tela: 'Expedição' },
  tarefas: { chaves: ['tarefas.participar'], tela: 'Tarefas' },
};

type Linha = Record<string, unknown>;

// ─── Formatacao (formatar nao e calcular) ────────────────────────────────────

function txt(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

function num(valor: unknown): number | null {
  if (valor == null || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function centavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function somar(linhas: Linha[], campo: (l: Linha) => number | null): number {
  return centavos(linhas.reduce((total, l) => total + (campo(l) ?? 0), 0));
}

/** "2026-10-14" → "14/10/2026" (data pura: sem fuso). */
function dataBR(valor: unknown): string | null {
  const s = txt(valor);
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

const FORMATO_DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Instante (timestamptz) → "29/09/2026 07:58", no horario de Brasilia. */
function dataHoraBR(valor: unknown): string | null {
  const s = txt(valor);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : FORMATO_DATA_HORA.format(d).replace(',', '');
}

// ─── Resultado ───────────────────────────────────────────────────────────────

export interface ConsultaDoPedido {
  /** false = nenhum dado do pedido foi devolvido */
  ok: boolean;
  numero: number;
  motivo?: 'NUMERO_INVALIDO' | 'USUARIO_NAO_IDENTIFICADO' | 'PEDIDO_NAO_ENCONTRADO' | 'PEDIDO_DE_OUTRO_VENDEDOR' | 'ERRO_NA_CONSULTA';
  orientacao?: string;
  escopo_de_quem_pergunta?: string;
  /** id_int confirmado — presente so quando ok */
  id_int?: number;
  secoes?: Partial<Record<SecaoDoPedido, unknown>>;
  nota?: string;
}

function recusaDaSecao(secao: SecaoDoPedido): Linha {
  const regra = PERMISSAO_DA_SECAO[secao];
  return {
    disponivel: false,
    motivo: 'SEM_PERMISSAO',
    tela: regra.tela,
    permissao_necessaria: regra.chaves.map(rotuloDaPermissao).join(' ou '),
    orientacao:
      'O perfil de quem pergunta nao abre esta parte. Nao mostre nem suponha esses dados. ' +
      'Explique o passo a passo do manual normalmente e diga para pedir a quem tem a permissao (ou a um administrador).',
  };
}

function erroDaSecao(mensagem: string): Linha {
  return { disponivel: false, motivo: 'ERRO_NA_CONSULTA', detalhe: mensagem.slice(0, 200), orientacao: 'Diga que esta parte nao pôde ser consultada agora. Nao suponha os dados.' };
}

// ─── Partes ──────────────────────────────────────────────────────────────────

function secaoSituacao(p: Linha): Linha {
  const faturado = num(p.id_faturado);
  return {
    disponivel: true,
    fonte: 'Pedidos',
    cliente: txt(p.cliente),
    codigo_do_cliente: num(p.id_cliente),
    faturado_para_outro_cliente: faturado != null && faturado !== num(p.id_cliente),
    codigo_do_cliente_faturado: faturado,
    vendedor: txt(p.vendedor),
    empresa: txt(p.empresa),
    criado_em: dataHoraBR(p.created_at),
    status: txt(p.status_interno),
    na_fila_de_producao: p.is_prd_aprovado === true && p.is_reproved !== true,
    liberado_para_producao_em: dataHoraBR(p.liberado_producao_em),
    reprovado: p.is_reproved === true,
    avulso: p.is_avulso === true,
    em_arte: p.em_arte === true,
    valor_total: num(p.valor_total),
    valor_do_frete: num(p.valor_frete),
    frete_escolhido: txt(p.frete_escolhido),
    modalidade_do_frete: txt(p.modalidade_frete),
    liberado_para_nota_fiscal: p.libera_nf === true,
    nota_emitida_no_sistema_antigo: p.faturado_fora_em != null,
  };
}

const SITUACAO_DA_COBRANCA: Record<string, string> = {
  PAID: 'Paga',
  A_RECEBER: 'Aguardando pagamento',
  CANCELADO: 'Cancelada',
  CANCELADA: 'Cancelada',
};

async function secaoCobrancas(supabase: SupabaseClient, numero: number): Promise<Linha> {
  const { data, error } = await supabase
    .from('pagamentos_v2')
    .select(
      'id_pagamento, tipo_cobranca, forma_pgto, valor, status, confirmado, vencimento, paid_at, data_confirmacao, cliente, empresa, ' +
        'boleto_enviadoo, p_qtd_parcelas, p_dias_pra_inicio, p_intervalo, is_parcial, is_extra, motivo_cancela, aprovado_por, created_at'
    )
    .eq('id_int', numero)
    .order('created_at', { ascending: true })
    .limit(40);
  if (error) return erroDaSecao(error.message);

  const linhas = (data ?? []) as unknown as Linha[];
  const ehCancelada = (l: Linha) => /^CANCELAD[OA]$/.test(String(l.status ?? ''));
  const ativas = linhas.filter(l => !ehCancelada(l));
  const pagas = linhas.filter(l => l.status === 'PAID');

  return {
    disponivel: true,
    fonte: 'Cobranças do pedido (aba Pagamentos da proposta e Conferência)',
    quantidade: linhas.length,
    resumo: {
      ativas: ativas.length,
      soma_das_ativas: somar(ativas, l => num(l.valor)),
      pagas: pagas.length,
      soma_das_pagas: somar(pagas, l => num(l.valor)),
      canceladas: linhas.length - ativas.length,
    },
    cobrancas: linhas.map(l => {
      const tipo = String(l.tipo_cobranca ?? '');
      const faturada = tipo.toUpperCase() === 'E-FATURADO';
      const status = String(l.status ?? '');
      const situacao =
        status === 'A_VENCER'
          ? l.confirmado === true
            ? 'A vencer, aprovada pelo financeiro'
            : 'A vencer, aguardando conferência do financeiro'
          : SITUACAO_DA_COBRANCA[status] ?? status;
      return {
        numero_do_pagamento: txt(l.id_pagamento),
        tipo: tipo || null,
        faturada,
        forma: txt(l.forma_pgto),
        valor: num(l.valor),
        situacao,
        cancelada: ehCancelada(l),
        motivo_do_cancelamento: ehCancelada(l) ? txt(l.motivo_cancela) : null,
        confirmada_pelo_financeiro: l.confirmado === true,
        aprovada_por: txt(l.aprovado_por),
        confirmada_em: dataHoraBR(l.data_confirmacao),
        paga_em: dataHoraBR(l.paid_at),
        vencimento: dataBR(l.vencimento),
        em_nome_de: txt(l.cliente),
        empresa: txt(l.empresa),
        criada_em: dataHoraBR(l.created_at),
        parcelamento_combinado: faturada
          ? { parcelas: num(l.p_qtd_parcelas), dias_para_a_primeira: num(l.p_dias_pra_inicio), intervalo_em_dias: num(l.p_intervalo) }
          : undefined,
        // So faz sentido em cobranca faturada: os titulos da Carteira ja foram gerados?
        titulos_gerados_na_carteira: faturada ? l.boleto_enviadoo === true : undefined,
        parcial: l.is_parcial === true,
        extra: l.is_extra === true,
      };
    }),
  };
}

function situacaoDoTitulo(l: Linha): { rotulo: string; grupo: 'cancelado' | 'pago' | 'vencido' | 'a_vencer' } {
  const status = String(l.status ?? '');
  // Mesma ordem da Carteira (getVisualStatus em ContasReceberPage.tsx).
  if (/^CANCELAD[OA]$/.test(status)) return { rotulo: 'Cancelado', grupo: 'cancelado' };
  if (status === 'PAID') return { rotulo: 'Pago', grupo: 'pago' };
  if (status === 'VENCIDO') return { rotulo: 'Vencido', grupo: 'vencido' };
  if (l.deposito_conta === true) return { rotulo: 'Depósito em conta', grupo: 'a_vencer' };
  const registrado = Boolean(txt(l.id_boleto_c6) || txt(l.nosso_numero) || txt(l.linha_digitavel));
  return registrado
    ? { rotulo: 'Boleto registrado', grupo: 'a_vencer' }
    : { rotulo: 'A receber criado — boleto não registrado', grupo: 'a_vencer' };
}

async function secaoTitulos(supabase: SupabaseClient, numero: number): Promise<Linha> {
  const { data, error } = await supabase
    .from('boletos')
    .select(
      'parcela, total_parcelas, valor, valor_atualizado, vencimento, status, paid_at, created_at, id_empresa, empresa, nome_cliente, n_nf, ' +
        'id_pagamento, dias_atraso, is_prorrogado, deposito_conta, forma_recebimento, id_boleto_c6, nosso_numero, linha_digitavel'
    )
    .eq('id_int', numero)
    .order('parcela', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(60);
  if (error) return erroDaSecao(error.message);

  const linhas = (data ?? []) as unknown as Linha[];
  const valorDe = (l: Linha) => num(l.valor_atualizado) ?? num(l.valor);
  const comSituacao = linhas.map(l => ({ l, s: situacaoDoTitulo(l) }));
  const doGrupo = (g: string) => comSituacao.filter(x => x.s.grupo === g).map(x => x.l);
  const emAberto = [...doGrupo('a_vencer'), ...doGrupo('vencido')];

  return {
    disponivel: true,
    fonte: 'Carteira (contas a receber)',
    quantidade: linhas.length,
    resumo: {
      em_aberto: emAberto.length,
      soma_em_aberto: somar(emAberto, valorDe),
      a_vencer: doGrupo('a_vencer').length,
      vencidos: doGrupo('vencido').length,
      pagos: doGrupo('pago').length,
      soma_dos_pagos: somar(doGrupo('pago'), valorDe),
      cancelados: doGrupo('cancelado').length,
    },
    titulos: comSituacao.map(({ l, s }) => {
      const deposito = l.deposito_conta === true;
      const registrado = !deposito && Boolean(txt(l.id_boleto_c6) || txt(l.nosso_numero) || txt(l.linha_digitavel));
      return {
        parcela: num(l.parcela),
        total_de_parcelas: num(l.total_parcelas),
        tipo: deposito ? 'Depósito em conta' : 'Boleto',
        situacao_na_carteira: s.rotulo,
        em_aberto: s.grupo === 'a_vencer' || s.grupo === 'vencido',
        valor: valorDe(l),
        vencimento: dataBR(l.vencimento),
        dias_de_atraso: s.grupo === 'vencido' ? num(l.dias_atraso) : null,
        pago_em: dataHoraBR(l.paid_at),
        forma_do_recebimento: txt(l.forma_recebimento),
        registrado_no_banco: registrado,
        // A empresa 2 (Ideal Biro) emite pelo Banco Inter; as demais, pelo C6.
        banco: deposito ? null : Number(l.id_empresa) === 2 ? 'Banco Inter' : 'C6 Bank',
        prorrogado: l.is_prorrogado === true,
        nota_fiscal: txt(l.n_nf),
        numero_do_pagamento_de_origem: txt(l.id_pagamento),
        em_nome_de: txt(l.nome_cliente),
        empresa: txt(l.empresa),
        criado_em: dataHoraBR(l.created_at),
      };
    }),
  };
}

async function secaoNotaFiscal(supabase: SupabaseClient, numero: number, p: Linha): Promise<Linha> {
  const { data, error } = await supabase
    .from('notas_fiscais')
    .select(
      'numero_nf, serie, modelo, tipo_nota, status, status_sefaz, mensagem_sefaz, erro_mensagem, ambiente, natureza_operacao, ' +
        'valor_total_nf, data_autorizacao, data_cancelamento, created_at, criado_por_nome, cancelado_por_nome'
    )
    .eq('id_int', numero)
    .order('created_at', { ascending: true })
    .limit(20);
  if (error) return erroDaSecao(error.message);

  const linhas = (data ?? []) as unknown as Linha[];
  return {
    disponivel: true,
    fonte: 'Notas fiscais',
    liberado_para_nota_fiscal: p.libera_nf === true,
    nota_emitida_no_sistema_antigo: p.faturado_fora_em != null,
    quantidade: linhas.length,
    resumo: {
      autorizadas: linhas.filter(l => l.status === 'AUTORIZADA').length,
      canceladas: linhas.filter(l => l.status === 'CANCELADA').length,
      com_erro: linhas.filter(l => String(l.status ?? '').startsWith('ERRO')).length,
    },
    notas: linhas.map(l => ({
      numero: txt(l.numero_nf) ?? num(l.numero_nf),
      serie: txt(l.serie) ?? num(l.serie),
      modelo: txt(l.modelo),
      tipo: txt(l.tipo_nota),
      status: txt(l.status),
      retorno_da_sefaz: txt(l.mensagem_sefaz) ?? txt(l.status_sefaz),
      erro: txt(l.erro_mensagem),
      ambiente: txt(l.ambiente),
      natureza_da_operacao: txt(l.natureza_operacao),
      valor_total: num(l.valor_total_nf),
      autorizada_em: dataHoraBR(l.data_autorizacao),
      cancelada_em: dataHoraBR(l.data_cancelamento),
      criada_em: dataHoraBR(l.created_at),
      criada_por: txt(l.criado_por_nome),
      cancelada_por: txt(l.cancelado_por_nome),
    })),
  };
}

async function secaoProducao(supabase: SupabaseClient, numero: number, p: Linha): Promise<Linha> {
  const [os, setores] = await Promise.all([
    supabase
      .from('propostas_os')
      .select('status_pedido, status_pagamento, status_arte, status_producao, status_expedicao, data_pedido, data_aprovacao_arte, data_termino')
      .eq('id_int', numero)
      .limit(5),
    supabase
      .from('propostas_os_setores')
      .select('setor, prazo, hora, status_producao, status_producao_em, impresso_em')
      .eq('id_int', numero)
      .order('setor', { ascending: true })
      .limit(20),
  ]);
  if (os.error) return erroDaSecao(os.error.message);
  if (setores.error) return erroDaSecao(setores.error.message);

  const ordens = (os.data ?? []) as unknown as Linha[];
  const porSetor = (setores.data ?? []) as unknown as Linha[];
  return {
    disponivel: true,
    fonte: 'Produção (ordem de serviço e boletim)',
    na_fila_de_producao: p.is_prd_aprovado === true && p.is_reproved !== true,
    liberado_para_producao_em: dataHoraBR(p.liberado_producao_em),
    etapa_atual: txt(p.etapa_operacional),
    status_do_pedido: txt(p.status_pedido),
    prazo_operacional: dataBR(p.prazo_operacional),
    em_arte: p.em_arte === true,
    tem_ordem_de_servico: ordens.length > 0,
    ordens_de_servico: ordens.map(o => ({
      status_do_pedido: txt(o.status_pedido),
      status_do_pagamento: txt(o.status_pagamento),
      status_da_arte: txt(o.status_arte),
      status_da_producao: txt(o.status_producao),
      status_da_expedicao: txt(o.status_expedicao),
      data_do_pedido: dataBR(o.data_pedido),
      arte_aprovada_em: dataBR(o.data_aprovacao_arte),
      data_limite_de_entrega: dataBR(o.data_termino),
    })),
    setores: porSetor.map(s => ({
      setor: txt(s.setor),
      prazo: dataBR(s.prazo),
      hora_do_prazo: txt(s.hora),
      status: txt(s.status_producao),
      status_desde: dataHoraBR(s.status_producao_em),
      impresso_em: dataHoraBR(s.impresso_em),
    })),
  };
}

async function secaoExpedicao(supabase: SupabaseClient, numero: number, p: Linha): Promise<Linha> {
  const { data, error } = await supabase
    .from('expedicoes')
    .select(
      'tipo_frete, transportadora_nome, modalidade_frete, categoria_frete, qtd_volumes, peso_kg, peso_bruto_kg, codigo_rastreamento, ' +
        'correios_codigo_objeto, data_pronto, data_despacho, data_entrega, coletado_em, etiqueta_impressa_em, ' +
        'correios_ultimo_evento, correios_ultimo_evento_em, prepostagem_cancelada_em'
    )
    .eq('id_int', numero)
    .order('created_at', { ascending: true })
    .limit(5);
  if (error) return erroDaSecao(error.message);

  const linhas = (data ?? []) as unknown as Linha[];
  return {
    disponivel: true,
    fonte: 'Expedição',
    status_do_pedido: txt(p.status_interno),
    frete_escolhido_na_proposta: txt(p.frete_escolhido),
    valor_do_frete_na_proposta: num(p.valor_frete),
    modalidade_do_frete_na_proposta: txt(p.modalidade_frete),
    tem_registro_de_expedicao: linhas.length > 0,
    expedicoes: linhas.map(e => ({
      tipo_de_frete: txt(e.tipo_frete),
      transportadora: txt(e.transportadora_nome),
      modalidade: txt(e.modalidade_frete),
      categoria: txt(e.categoria_frete),
      volumes: num(e.qtd_volumes),
      peso_kg: num(e.peso_bruto_kg) ?? num(e.peso_kg),
      pronto_em: dataHoraBR(e.data_pronto),
      etiqueta_impressa_em: dataHoraBR(e.etiqueta_impressa_em),
      coletado_em: dataHoraBR(e.coletado_em),
      despachado_em: dataHoraBR(e.data_despacho),
      entregue_em: dataHoraBR(e.data_entrega),
      codigo_de_rastreio: txt(e.correios_codigo_objeto) ?? txt(e.codigo_rastreamento),
      ultimo_evento_dos_correios: txt(e.correios_ultimo_evento),
      ultimo_evento_em: dataHoraBR(e.correios_ultimo_evento_em),
      prepostagem_cancelada: e.prepostagem_cancelada_em != null,
    })),
  };
}

async function secaoTarefas(supabase: SupabaseClient, numero: number): Promise<Linha> {
  const { data, error } = await supabase
    .from('tarefas_equipe')
    .select('id, tipo, titulo, status, prioridade, data_limite, created_at, para_todos, criado_por_user_id, responsavel_user_id')
    .eq('id_int', numero)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return erroDaSecao(error.message);

  const linhas = (data ?? []) as unknown as Linha[];
  const ids = [...new Set(linhas.flatMap(l => [txt(l.criado_por_user_id), txt(l.responsavel_user_id)]).filter((v): v is string => v !== null))];
  const nomes = new Map<string, string>();
  if (ids.length > 0) {
    const { data: usuarios } = await supabase.from('usuarios').select('user_id, nome_usuario').in('user_id', ids);
    for (const u of (usuarios ?? []) as unknown as Linha[]) {
      const id = txt(u.user_id);
      const nome = txt(u.nome_usuario);
      if (id && nome) nomes.set(id, nome);
    }
  }
  const nomeDe = (id: unknown) => (txt(id) ? nomes.get(txt(id) as string) ?? null : null);

  return {
    disponivel: true,
    fonte: 'Tarefas (so as que quem pergunta pode ver)',
    quantidade: linhas.length,
    resumo: {
      abertas: linhas.filter(l => l.status === 'ABERTA').length,
      em_andamento: linhas.filter(l => l.status === 'EM_ANDAMENTO').length,
      concluidas: linhas.filter(l => l.status === 'CONCLUIDA').length,
      canceladas: linhas.filter(l => l.status === 'CANCELADA').length,
    },
    tarefas: linhas.map(l => ({
      titulo: txt(l.titulo),
      tipo: txt(l.tipo),
      situacao: txt(l.status),
      prioridade: txt(l.prioridade),
      prazo: dataBR(l.data_limite),
      criada_em: dataHoraBR(l.created_at),
      criada_por: nomeDe(l.criado_por_user_id),
      responsavel: nomeDe(l.responsavel_user_id),
      para_todos: l.para_todos === true,
    })),
  };
}

// ─── Consulta ────────────────────────────────────────────────────────────────

export function normalizarSecoes(bruto: unknown): SecaoDoPedido[] {
  const pedidas = Array.isArray(bruto) ? bruto.map(String) : [];
  const validas = SECOES_DO_PEDIDO.filter(s => pedidas.includes(s));
  return validas.length > 0 ? validas : ['situacao'];
}

const COLUNAS_DO_PEDIDO =
  'id_int, cliente, id_cliente, id_faturado, vendedor, empresa, created_at, status_interno, status_pedido, etapa_operacional, ' +
  'prazo_operacional, is_prd_aprovado, is_reproved, is_avulso, em_arte, valor_total, valor_frete, frete_escolhido, modalidade_frete, ' +
  'libera_nf, faturado_fora_em, liberado_producao_em';

export async function consultarPedido(
  supabase: SupabaseClient,
  acesso: AcessoUsuario,
  numeroBruto: unknown,
  secoesBrutas: unknown,
): Promise<ConsultaDoPedido> {
  const numero = Number(numeroBruto);
  if (!Number.isInteger(numero) || numero <= 0) {
    return { ok: false, numero: 0, motivo: 'NUMERO_INVALIDO', orientacao: 'Peça o número do pedido.' };
  }
  if (!acesso.encontrado) {
    return {
      ok: false,
      numero,
      motivo: 'USUARIO_NAO_IDENTIFICADO',
      orientacao: 'Não foi possível identificar o perfil de quem pergunta. Nenhum dado do pedido foi consultado.',
    };
  }

  const { data, error } = await supabase.from('propostas').select(COLUNAS_DO_PEDIDO).eq('id_int', numero).maybeSingle();
  if (error) {
    return { ok: false, numero, motivo: 'ERRO_NA_CONSULTA', orientacao: 'A consulta falhou. Diga isso e sugira tentar de novo.' };
  }
  if (!data) {
    return { ok: false, numero, motivo: 'PEDIDO_NAO_ENCONTRADO', orientacao: `Não existe pedido ou proposta com o número ${numero}. Peça para conferir o número.` };
  }
  const pedido = data as unknown as Linha;

  // ── Trava 1: escopo por vendedor. Negou → NENHUM dado do pedido sai daqui. ──
  const escopo = escopoDePedidos(acesso);
  if (escopo === 'proprios' && !pedidoEDoVendedor(acesso, txt(pedido.vendedor))) {
    return {
      ok: false,
      numero,
      motivo: 'PEDIDO_DE_OUTRO_VENDEDOR',
      escopo_de_quem_pergunta: 'só os próprios pedidos',
      orientacao:
        `O pedido ${numero} é de outro vendedor e o perfil de quem pergunta só consulta os próprios pedidos. ` +
        'NENHUM dado deste pedido foi consultado: não informe cliente, valor, status, cobranças nem de quem é o pedido. ' +
        'Diga isso com naturalidade e oriente a pedir ao vendedor do pedido ou a quem tem visão geral ' +
        `(permissão "${rotuloDaPermissao('propostas.view_all')}"). O passo a passo do manual pode ser explicado normalmente.`,
    };
  }

  // ── Trava 2: permissao por parte ──
  const secoes = normalizarSecoes(secoesBrutas);
  const resultado: Partial<Record<SecaoDoPedido, unknown>> = {};
  await Promise.all(
    secoes.map(async secao => {
      if (!podeNaTela(acesso, PERMISSAO_DA_SECAO[secao].chaves)) {
        resultado[secao] = recusaDaSecao(secao);
        return;
      }
      try {
        if (secao === 'situacao') resultado[secao] = secaoSituacao(pedido);
        else if (secao === 'cobrancas') resultado[secao] = await secaoCobrancas(supabase, numero);
        else if (secao === 'titulos') resultado[secao] = await secaoTitulos(supabase, numero);
        else if (secao === 'nota_fiscal') resultado[secao] = await secaoNotaFiscal(supabase, numero, pedido);
        else if (secao === 'producao') resultado[secao] = await secaoProducao(supabase, numero, pedido);
        else if (secao === 'expedicao') resultado[secao] = await secaoExpedicao(supabase, numero, pedido);
        else resultado[secao] = await secaoTarefas(supabase, numero);
      } catch (err) {
        resultado[secao] = erroDaSecao(err instanceof Error ? err.message : 'falha inesperada');
      }
    }),
  );

  // Devolve as partes na ordem canonica (o Promise.all preenche fora de ordem).
  const ordenado: Partial<Record<SecaoDoPedido, unknown>> = {};
  for (const secao of secoes) ordenado[secao] = resultado[secao];

  return {
    ok: true,
    numero,
    id_int: numero,
    escopo_de_quem_pergunta:
      escopo === 'todos' ? 'visão geral (todos os pedidos)' : escopo === 'proprios' ? 'só os próprios pedidos (este é dele)' : 'pela permissão de cada tela',
    secoes: ordenado,
    nota:
      'Dados lidos agora no ERP. Totais e contagens já vêm prontos em "resumo" — não some nem conte. ' +
      'Parte com disponivel=false NÃO foi consultada: não suponha o conteúdo dela.',
  };
}
