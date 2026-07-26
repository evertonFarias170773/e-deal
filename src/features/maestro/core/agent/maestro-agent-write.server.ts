/**
 * maestro-agent-write.server.ts
 *
 * Escrita assistida do agent loop — Trilha B, ação B1 (§2.1 da matriz
 * MATRIZ-PERMISSOES-ESCRITA-MAESTRO.md): salvar_cotacao_como_proposta.
 *
 * Este módulo implementa as camadas 5–8 do modelo de decisão (§3):
 *   - PROPOR: valida pré-condições, monta o snapshot EXATO do que será
 *     gravado (inclusive bônus do cliente aplicado como desconto geral —
 *     mesmo cálculo do fluxo oficial) e devolve a pendência autorada pelo
 *     SERVIDOR. Nada é gravado.
 *   - EXECUTAR: re-verifica tudo NO MOMENTO da execução; se o alvo mudou
 *     (preços, bônus, restrição) ABORTA e devolve uma nova proposta (§4);
 *     grava SOMENTE pelo fluxo oficial salvarCotacaoComoPropostaReal
 *     (que revalida preços/endereço/frete e audita em maestro_acoes).
 *
 * Bloqueios desta ação (§2.1):
 *   - cliente com preço fixo → NÃO propõe (a simulação usa preço de tabela;
 *     o fluxo assistido do chat legado é o caminho para esses clientes);
 *   - frete: "Retira no Balcão" (R$ 0,00) por padrão, ou uma opção COTADA
 *     pelo servidor (maestro-agent-frete.server) escolhida pelo usuário —
 *     §2.1(c): frete definido (calculado ou retira no balcão explícito);
 *   - nunca altera proposta existente; data sempre atual.
 *
 * ⚠️ Roda apenas no servidor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MaestroV2Context, PendingSaveQuotation } from '../simple/maestro-v2-context-manager';
import { simularOrcamentoAvulsoDb } from '../simple/maestro-simple-produtos.server';
import { salvarCotacaoComoPropostaReal } from '../simple/maestro-save-proposta.server';
import {
  cotarOpcoesFrete,
  escolherOpcaoFrete,
  OPCAO_RETIRA_BALCAO,
  type OpcaoFrete,
} from './maestro-agent-frete.server';

export type AgentPendingWriteAction = NonNullable<MaestroV2Context['agentPendingWriteAction']>;

const TOLERANCIA = 0.01;
const MAX_ITENS = 20;

export interface ItemCotacaoReq {
  quantidade: number;
  termo: string;
}

type ProporResultado =
  | { ok: true; pendencia: AgentPendingWriteAction }
  | { ok: false; motivo: string };

/**
 * FASE PROPOR — monta a pendência de escrita (nada é gravado).
 * Pré-condições §2.1 (a)(b)(e): cliente ativo já garantido pelo wrapper;
 * itens simulados com sucesso; alerta de restrição/limite quando houver.
 */
export async function proporSalvarCotacao(
  supabase: SupabaseClient,
  idCliente: number,
  clientName: string,
  itensReq: ItemCotacaoReq[],
  turnId: string,
  /** Escolha de frete do usuário (id/nome da opção); vazio = Retira no Balcão */
  freteReq?: string,
): Promise<ProporResultado> {
  const itens = (itensReq ?? [])
    .map(i => ({ quantidade: Number(i?.quantidade), termo: String(i?.termo ?? '').trim() }))
    .filter(i => Number.isFinite(i.quantidade) && i.quantidade > 0 && i.termo.length > 0)
    .slice(0, MAX_ITENS);
  if (itens.length === 0) {
    return { ok: false, motivo: 'Nenhum item válido para cotar. Informe produto e quantidade.' };
  }

  // (b) simulação NO SERVIDOR — o modelo nunca fornece valores
  const sim = await simularOrcamentoAvulsoDb(supabase, itens);
  const problemas: string[] = [];
  for (const item of sim.itens) {
    if (item.status !== 'sucesso') {
      problemas.push(`"${item.termo}": ${item.status}`);
    } else if (item.produtosEncontrados.length !== 1 || item.subtotalCalculado == null) {
      problemas.push(`"${item.termo}": produto ambíguo ou preço incompleto`);
    }
  }
  if (problemas.length > 0) {
    return {
      ok: false,
      motivo:
        `Itens não prontos para salvar: ${problemas.join('; ')}. ` +
        'Resolva os itens (produto exato do catálogo, ativo e com preço) antes de propor o salvamento.',
    };
  }

  // Cliente: preço fixo bloqueia; bônus define o desconto geral que o fluxo
  // oficial aplicará (o resumo precisa ser EXATO — §2.1)
  const { data: clienteRow, error: cliErr } = await supabase
    .from('clientes')
    .select('restricao, usa_preco_fixo, is_bonus, percentual_bunus')
    .eq('id_cliente', idCliente)
    .maybeSingle();
  if (cliErr || !clienteRow) {
    return { ok: false, motivo: 'Não foi possível confirmar o cadastro do cliente para o salvamento.' };
  }
  if (clienteRow.usa_preco_fixo === true) {
    return {
      ok: false,
      motivo:
        'Este cliente usa PREÇO FIXO — os valores simulados (tabela geral) não valem para ele. ' +
        'O salvamento deve seguir o fluxo assistido de cotação do chat, que aplica a tabela do cliente.',
    };
  }

  const percentualBonus =
    clienteRow.is_bonus === true && clienteRow.percentual_bunus != null
      ? Number(clienteRow.percentual_bunus) || 0
      : 0;

  // (e) alerta de restrição/limite — a confirmação DEVE mencioná-lo
  let alertaRestricao: string | null = null;
  if (clienteRow.restricao === true) {
    alertaRestricao = 'Cliente com RESTRIÇÃO ativa no cadastro.';
  } else {
    try {
      const { data: analise } = await supabase.rpc('fn_analise_credito_cliente', { p_id_cliente: idCliente });
      const linha = Array.isArray(analise) ? (analise[0] as Record<string, unknown> | undefined) : null;
      const disponivel = linha?.limite_disponivel != null ? Number(linha.limite_disponivel) : null;
      if (disponivel != null && disponivel <= 0) {
        alertaRestricao = 'Cliente com LIMITE DE CRÉDITO esgotado.';
      }
    } catch {
      // alerta indisponível não bloqueia a proposta — a revalidação oficial
      // do save continua valendo integralmente
    }
  }

  const pendItens: AgentPendingWriteAction['itens'] = sim.itens.map(item => {
    const p = item.produtosEncontrados[0];
    return {
      termo: item.termo,
      id_produto: p.id_produto,
      // Nome COMERCIAL na proposta (nomeReal), nunca a descrição técnica crua
      nome: (p.nomeReal && p.nomeReal.trim()) || p.descricao,
      quantidade: item.quantidade,
      valorUnitario: p.valorUnt ?? 0,
      valorFixo: p.valorFixo ?? 0,
      subtotal: item.subtotalCalculado ?? 0,
      pesoUnitario: p.pesoUnitario ?? 0,
      prazoProducao: p.prazo ?? null,
    };
  });
  const subtotal = Number(pendItens.reduce((acc, i) => acc + i.subtotal, 0).toFixed(2));
  const descontoReais = Number((subtotal * (percentualBonus / 100)).toFixed(2));

  // Frete: Retira no Balcão por padrão; escolha do usuário → cotação NO
  // SERVIDOR e match determinístico (§2.1(c) — o modelo nunca fornece valor)
  const pesoBrutoGramas = Math.round(pendItens.reduce((acc, i) => acc + i.pesoUnitario * i.quantidade, 0));
  const pesoUsado = Math.round(pesoBrutoGramas * 1.02);
  const termoFrete = (freteReq ?? '').trim();
  let freteOpcao: OpcaoFrete = OPCAO_RETIRA_BALCAO;
  if (!/\b(retira|retirada|balc[aã]o|local)\b/i.test(termoFrete)) {
    const cot = await cotarOpcoesFrete(supabase, idCliente, { pesoGramas: pesoBrutoGramas, valorTotal: subtotal });
    if (termoFrete) {
      const escolha = escolherOpcaoFrete(cot.opcoes, termoFrete);
      if (!escolha.ok) {
        return { ok: false, motivo: [escolha.motivo, ...cot.avisos].join(' ') };
      }
      freteOpcao = escolha.opcao;
    } else {
      // Padrão do ERP: SEDEX quando cotável; sem SEDEX → Retira no Balcão
      freteOpcao =
        cot.opcoes.find(o => `${o.transportadora} ${o.servico}`.toLowerCase().includes('sedex')) ??
        OPCAO_RETIRA_BALCAO;
    }
  }

  const total = Number((subtotal - descontoReais + freteOpcao.valor).toFixed(2));

  return {
    ok: true,
    pendencia: {
      tipo: 'salvar_cotacao_como_proposta',
      turnId,
      criadaEm: new Date().toISOString(),
      idCliente,
      clientName,
      itens: pendItens,
      subtotal,
      percentualBonus,
      descontoReais,
      freteEscolhido: {
        id: freteOpcao.id,
        transportadora: freteOpcao.transportadora,
        servico: freteOpcao.servico,
        valor: freteOpcao.valor,
        prazo: freteOpcao.prazo,
        pesoUsado,
      },
      total,
      alertaRestricao,
    },
  };
}

type ExecutarResultado =
  | { ok: true; idInt: number }
  | { ok: false; motivo: string; reproposta?: AgentPendingWriteAction };

/**
 * FASE EXECUTAR — chamada SOMENTE quando o usuário confirmou a proposta do
 * turno anterior. Re-verifica o alvo agora; divergência → aborta e re-propõe
 * com os dados novos (§4). Gravação exclusivamente pelo fluxo oficial.
 */
export async function executarSalvarCotacao(
  supabase: SupabaseClient,
  userId: string,
  pendencia: AgentPendingWriteAction,
  turnIdAtual: string,
): Promise<ExecutarResultado> {
  // Frete confirmado pelo usuário (pendências antigas sem o campo = retira)
  const freteConfirmado = pendencia.freteEscolhido ?? { ...OPCAO_RETIRA_BALCAO, pesoUsado: 0 };
  const freteCalculado = freteConfirmado.id !== OPCAO_RETIRA_BALCAO.id;

  // Re-verificação integral no momento da execução (camada 6) — frete
  // calculado é RE-COTADO pelo nome da opção (ids de cotação não são estáveis);
  // retira confirmada é EXPLÍCITA (o padrão do propor sem frete é SEDEX)
  const fresh = await proporSalvarCotacao(
    supabase,
    pendencia.idCliente,
    pendencia.clientName,
    pendencia.itens.map(i => ({ quantidade: i.quantidade, termo: i.termo })),
    turnIdAtual,
    freteCalculado ? `${freteConfirmado.transportadora} ${freteConfirmado.servico}` : 'retira no balcão',
  );
  if (!fresh.ok) {
    return { ok: false, motivo: `A cotação não é mais válida: ${fresh.motivo}` };
  }

  const mudou =
    Math.abs(fresh.pendencia.total - pendencia.total) > TOLERANCIA ||
    Math.abs(fresh.pendencia.subtotal - pendencia.subtotal) > TOLERANCIA ||
    Math.abs((fresh.pendencia.freteEscolhido?.valor ?? 0) - freteConfirmado.valor) > TOLERANCIA ||
    fresh.pendencia.percentualBonus !== pendencia.percentualBonus ||
    (fresh.pendencia.alertaRestricao ?? null) !== (pendencia.alertaRestricao ?? null) ||
    fresh.pendencia.itens.length !== pendencia.itens.length;
  if (mudou) {
    return {
      ok: false,
      motivo: 'Os dados mudaram desde a proposta (preço, frete, bônus ou situação do cliente).',
      reproposta: fresh.pendencia,
    };
  }

  // Endereço do cliente (preferindo PRINCIPAL) — frete é Retira no Balcão
  let enderecoId = '';
  let cep = '';
  let cidade = '';
  let uf = '';
  let enderecoFull = '';
  try {
    const { data: ends } = await supabase
      .from('enderecos')
      .select('*')
      .eq('id_cliente', pendencia.idCliente)
      .limit(10);
    if (ends && ends.length > 0) {
      const principal =
        ends.find(e => String((e as Record<string, unknown>).tipo_endereco ?? '').toUpperCase().includes('PRINCIPAL')) ?? ends[0];
      const p = principal as Record<string, unknown>;
      enderecoId = p.id != null ? String(p.id) : '';
      cep = typeof p.cep === 'string' ? p.cep : '';
      cidade = typeof p.cidade === 'string' ? p.cidade : '';
      uf = typeof p.uf === 'string' ? p.uf : '';
      const rua = [p.rua, p.logradouro, p.endereco].find(v => typeof v === 'string' && v) as string | undefined;
      const numero = p.numero != null ? String(p.numero) : '';
      enderecoFull = [rua, numero].filter(Boolean).join(', ');
    }
  } catch {
    // sem endereço → segue vazio (Retira no Balcão não depende de entrega)
  }

  const pesoTotalGramas = Math.round(
    pendencia.itens.reduce((acc, i) => acc + i.pesoUnitario * i.quantidade, 0) * 1.02,
  );

  const pending: PendingSaveQuotation = {
    clientInternalId: pendencia.idCliente,
    clientName: pendencia.clientName,
    enderecoId,
    cep,
    cidade,
    uf,
    enderecoFull,
    itens: pendencia.itens.map(i => ({
      id_produto: i.id_produto,
      nome: i.nome,
      quantidade: i.quantidade,
      valorUnitario: i.valorUnitario,
      valorFixo: i.valorFixo,
      subtotal: i.subtotal,
      pesoUnitario: i.pesoUnitario,
    })),
    // Valores CONFIRMADOS pelo usuário (a revalidação fresh garantiu que
    // continuam válidos dentro da tolerância)
    freteEscolhido: {
      id: freteConfirmado.id,
      servico: freteConfirmado.servico,
      transportadora: freteConfirmado.transportadora,
      valor: freteConfirmado.valor,
      prazo: freteConfirmado.prazo,
      pesoUsado: freteConfirmado.pesoUsado > 0 ? freteConfirmado.pesoUsado : pesoTotalGramas,
    },
    subtotal: pendencia.subtotal,
    percentualBonus: pendencia.percentualBonus,
    descontoReais: pendencia.descontoReais,
    subtotalLiquido: Number((pendencia.subtotal - pendencia.descontoReais).toFixed(2)),
    pesoTotalGramas,
    total: pendencia.total,
    timestamp: new Date().toISOString(),
  };

  // Camada 8: fluxo oficial (revalida preços/endereço/frete e audita)
  const result = await salvarCotacaoComoPropostaReal(pending, supabase, userId);
  if (!result.success || !result.idInt) {
    return { ok: false, motivo: result.errorMessage ?? 'O fluxo oficial rejeitou o salvamento.' };
  }
  return { ok: true, idInt: result.idInt };
}
