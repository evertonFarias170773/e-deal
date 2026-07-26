/**
 * maestro-agent-cobranca.server.ts
 *
 * Escrita assistida do agent loop — Trilha B, ação B3 (§2.3 da matriz
 * MATRIZ-PERMISSOES-ESCRITA-MAESTRO.md): gerar_cobranca_pix.
 *
 * Escopo ESTRITO: UMA cobrança PIX À VISTA nova por execução, para proposta
 * do cliente ativo, valor 100% validado no servidor (padrão = saldo restante,
 * nunca acima dele), empresa herdada da proposta (1/2/3 apenas).
 *
 *   - PROPOR: valida proposta/cliente/saldo/empresa e monta o resumo EXATO.
 *     Nada é gravado.
 *   - EXECUTAR: re-verifica tudo agora; divergência → aborta e re-propõe (§4);
 *     grava com o payload ESTRITO do fluxo oficial (createCobranca) + token
 *     público/link + gerarPixBancoInter (o MESMO service da rota gerar-pix).
 *     Falha do PIX bancário NÃO desfaz o registro — a cobrança fica pendente
 *     para o financeiro, com aviso explícito.
 *
 * Boleto, cartão, faturado, confirmação e cancelamento seguem BLOQUEADOS
 * (§2.4). O link público de pagamento (url_cobranca) é retornado no campo
 * dedicado `linkPagamento` — única exceção de exibição autorizada (§2.3).
 *
 * ⚠️ Roda apenas no servidor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MaestroV2Context } from '../simple/maestro-v2-context-manager';
import { gerarPixBancoInter } from '@/features/cobrancas/services/banco-inter.service';
import { registrarAcaoMaestro } from '../simple/maestro-audit.server';
import { idEmpresaPorNome } from './maestro-agent-pdf.server';
import { resolverEnderecoFrete } from './maestro-agent-frete.server';

export type PendenciaGerarCobrancaPix = Extract<
  NonNullable<MaestroV2Context['agentPendingWriteAction']>,
  { tipo: 'gerar_cobranca_pix' }
>;

const TOLERANCIA = 0.01;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function hojeIso(): string {
  return new Date().toISOString().split('T')[0];
}

type ProporCobrancaResultado =
  | { ok: true; pendencia: PendenciaGerarCobrancaPix }
  | { ok: false; motivo: string };

/**
 * FASE PROPOR — valida pré-condições §2.3 (a)–(e) e monta a pendência.
 * Nada é gravado. `valorReq` é o valor pedido pelo usuário (opcional);
 * ausente = saldo restante da proposta.
 */
export async function proporGerarCobrancaPix(
  supabase: SupabaseClient,
  idCliente: number,
  clientName: string,
  idInt: number,
  valorReq: number | undefined,
  turnId: string,
): Promise<ProporCobrancaResultado> {
  if (!Number.isFinite(idInt) || idInt <= 0) {
    return { ok: false, motivo: 'Número de proposta inválido para gerar cobrança.' };
  }

  // (a) proposta existe, é do cliente ativo e não está cancelada
  const { data: proposta, error: propErr } = await supabase
    .from('propostas')
    .select('id_int, id_faturado, valor_total, status_interno, empresa, vendedor')
    .eq('id_int', idInt)
    .maybeSingle();
  if (propErr || !proposta) {
    return { ok: false, motivo: `Proposta ${idInt} não encontrada.` };
  }
  if (Number(proposta.id_faturado) !== idCliente) {
    return {
      ok: false,
      motivo: `A proposta ${idInt} não pertence ao cliente ativo da conversa — resolva o cliente correto antes de gerar cobrança.`,
    };
  }
  const statusInterno = String(proposta.status_interno ?? '').toUpperCase();
  if (statusInterno.includes('CANCELAD')) {
    return { ok: false, motivo: `A proposta ${idInt} está cancelada — não recebe cobrança.` };
  }

  // (b) cliente cadastrado com documento válido
  const { data: clienteRow, error: cliErr } = await supabase
    .from('clientes')
    .select('nome, documento, restricao')
    .eq('id_cliente', idCliente)
    .maybeSingle();
  if (cliErr || !clienteRow) {
    return { ok: false, motivo: 'Não foi possível confirmar o cadastro do cliente.' };
  }
  const documentoDigits = String(clienteRow.documento ?? '').replace(/\D/g, '');
  if (documentoDigits.length !== 11 && documentoDigits.length !== 14) {
    return {
      ok: false,
      motivo: 'Cliente sem CPF/CNPJ válido no cadastro — complete o cadastro antes de gerar a cobrança PIX.',
    };
  }

  // Empresa recebedora herdada da proposta — somente 1/2/3
  const idEmpresa = idEmpresaPorNome(proposta.empresa as string | null);
  if (idEmpresa == null) {
    return {
      ok: false,
      motivo: `Empresa da proposta ("${proposta.empresa ?? ''}") não suportada para cobrança PIX (apenas Ideal Gráfica, Ideal Birô e E3 Brindes).`,
    };
  }

  // (c) saldo restante — MESMO cálculo do fluxo oficial (createCobranca)
  const { data: cobrancas, error: cobErr } = await supabase
    .from('pagamentos_v2')
    .select('valor, cartao_valor_final, status')
    .eq('id_int', idInt)
    .limit(200);
  if (cobErr) {
    return { ok: false, motivo: 'Não foi possível conferir as cobranças existentes da proposta.' };
  }
  const totalProposta = roundMoney(Number(proposta.valor_total) || 0);
  const totalCobrado = roundMoney(
    (cobrancas ?? [])
      .filter(c => String(c.status ?? '').toUpperCase() !== 'CANCELADO')
      .reduce((acc, c) => acc + Number(c.cartao_valor_final ?? c.valor ?? 0), 0),
  );
  const saldoRestante = Math.max(roundMoney(totalProposta - totalCobrado), 0);
  if (saldoRestante <= 0) {
    return {
      ok: false,
      motivo: `A proposta ${idInt} já está totalmente cobrada (saldo R$ 0,00) — nenhuma cobrança nova é permitida.`,
    };
  }

  // (d) valor validado no servidor — padrão = saldo restante
  const valor = valorReq != null ? roundMoney(Number(valorReq)) : saldoRestante;
  if (!Number.isFinite(valor) || valor <= 0) {
    return { ok: false, motivo: 'Valor de cobrança inválido.' };
  }
  if (valor > saldoRestante + TOLERANCIA) {
    return {
      ok: false,
      motivo: `Valor R$ ${valor.toFixed(2)} acima do saldo restante da proposta (R$ ${saldoRestante.toFixed(2)}).`,
    };
  }

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
      // alerta indisponível não bloqueia — as validações acima continuam valendo
    }
  }

  return {
    ok: true,
    pendencia: {
      tipo: 'gerar_cobranca_pix',
      turnId,
      criadaEm: new Date().toISOString(),
      idCliente,
      clientName,
      idInt,
      valor,
      saldoRestante,
      totalProposta,
      empresa: String(proposta.empresa ?? ''),
      idEmpresa,
      alertaRestricao,
    },
  };
}

type ExecutarCobrancaResultado =
  | { ok: true; idPagamento: string; linkPagamento: string; pixOk: boolean; aviso?: string }
  | { ok: false; motivo: string; reproposta?: PendenciaGerarCobrancaPix };

/**
 * FASE EXECUTAR — somente após confirmação do turno anterior. Re-verifica
 * tudo agora (camada 6); divergência → re-propõe (§4). Grava com o payload
 * ESTRITO do fluxo oficial e dispara o PIX pelo MESMO service da rota.
 */
export async function executarGerarCobrancaPix(
  supabase: SupabaseClient,
  userId: string,
  pendencia: PendenciaGerarCobrancaPix,
  turnIdAtual: string,
): Promise<ExecutarCobrancaResultado> {
  const fresh = await proporGerarCobrancaPix(
    supabase,
    pendencia.idCliente,
    pendencia.clientName,
    pendencia.idInt,
    pendencia.valor,
    turnIdAtual,
  );
  if (!fresh.ok) {
    return { ok: false, motivo: `A cobrança não é mais válida: ${fresh.motivo}` };
  }
  const mudou =
    Math.abs(fresh.pendencia.valor - pendencia.valor) > TOLERANCIA ||
    Math.abs(fresh.pendencia.saldoRestante - pendencia.saldoRestante) > TOLERANCIA ||
    fresh.pendencia.idEmpresa !== pendencia.idEmpresa ||
    (fresh.pendencia.alertaRestricao ?? null) !== (pendencia.alertaRestricao ?? null);
  if (mudou) {
    return {
      ok: false,
      motivo: 'Os dados mudaram desde a proposta de cobrança (saldo, valor ou situação do cliente).',
      reproposta: fresh.pendencia,
    };
  }

  // Dados do cliente e da proposta para o payload oficial
  const { data: clienteRow } = await supabase
    .from('clientes')
    .select('nome, documento')
    .eq('id_cliente', pendencia.idCliente)
    .maybeSingle();
  const { data: propostaRow } = await supabase
    .from('propostas')
    .select('vendedor')
    .eq('id_int', pendencia.idInt)
    .maybeSingle();
  const nomeCliente = String(clienteRow?.nome ?? pendencia.clientName);
  const documento = String(clienteRow?.documento ?? '');
  const hoje = hojeIso();

  // 1. Registro em pagamentos_v2 — payload ESTRITO do fluxo oficial
  //    (createCobranca, tipo PIX à vista)
  const payloadInicial = {
    id_int: pendencia.idInt,
    id_cliente: pendencia.idCliente,
    cliente: nomeCliente,
    documento,
    valor: roundMoney(pendencia.valor),
    status: 'A_RECEBER',
    tipo_cobranca: 'PIX',
    empresa: pendencia.empresa,
    id_empresa: pendencia.idEmpresa,
    os_ideal: '',
    atendente: String(propostaRow?.vendedor ?? '') || 'Sistema',
    descricao: `Cobrança PIX da proposta #${pendencia.idInt}`,
    vencimento: hoje,
    obs_v2: null,
    confirmado: false,
    forma_fatu: null,
    forma_pgto: null,
    p_valor_entrada: null,
    p_qtd_parcelas: null,
    p_dias_pra_inicio: null,
    p_intervalo: null,
    paid_at: null,
  };
  const { data: createdRows, error: insertError } = await supabase
    .from('pagamentos_v2')
    .insert([payloadInicial])
    .select()
    .returns<Array<{ id: string; id_pagamento?: string }>>();
  if (insertError || !createdRows || !createdRows.length) {
    return { ok: false, motivo: insertError?.message ?? 'O registro da cobrança foi rejeitado pelo banco.' };
  }
  const created = createdRows[0];

  // 2. Token público + link de pagamento (mesmo padrão do fluxo oficial)
  const tokenPublico = created.id.split('-')[0];
  const linkPagamento = `https://pay.ai-ideal.com.br/i/${tokenPublico}`;
  const { error: tokenErr } = await supabase
    .from('pagamentos_v2')
    .update({ token_publico: tokenPublico, url_cobranca: linkPagamento })
    .eq('id', created.id);
  if (tokenErr) {
    return { ok: false, motivo: `Cobrança criada, mas o link de pagamento falhou: ${tokenErr.message}` };
  }

  // 3. PIX real (Banco Inter) — mesmo service da rota /api/cobrancas/gerar-pix.
  //    Falha aqui NÃO desfaz o registro (§2.3): a cobrança fica pendente.
  const endereco = await resolverEnderecoFrete(supabase, pendencia.idCliente);
  const resPix = await gerarPixBancoInter(supabase, {
    cobrancaId: created.id,
    idEmpresa: pendencia.idEmpresa,
    seuNumero:
      pendencia.idEmpresa === 2
        ? created.id_pagamento || String(pendencia.idInt)
        : String(pendencia.idInt),
    valorNominal: roundMoney(pendencia.valor),
    dataVencimento: hoje,
    telefone: '',
    cpfCnpj: documento,
    nome: nomeCliente,
    endereco: endereco?.enderecoFull ?? '',
    cidade: endereco?.cidade ?? '',
    uf: endereco?.uf ?? '',
    cep: endereco?.cep ?? '',
  });

  // 4. Timeline da proposta (não-bloqueante) + auditoria obrigatória
  void supabase
    .from('propostas_chat')
    .insert([
      {
        id_int: pendencia.idInt,
        id_cliente: pendencia.idCliente,
        mensagem: `Cobrança PIX de R$ ${pendencia.valor.toFixed(2).replace('.', ',')} criada via Maestro.${resPix.success ? '' : ' Integração bancária pendente.'}`,
        tipo: 'SISTEMA',
        autor_nome: 'Sistema',
        setor: 'Financeiro',
        visivel_externo: false,
        anexos: null,
      },
    ])
    .then(({ error }) => {
      if (error) console.warn('[MaestroAgentCobranca] Timeline não registrada:', error.message);
    });
  await registrarAcaoMaestro(supabase, {
    userId,
    acao: 'gerar_cobranca_pix',
    resultado: 'sucesso',
    idCliente: pendencia.idCliente,
    idInt: pendencia.idInt,
    detalhe: resPix.success ? 'cobranca criada com PIX emitido' : 'cobranca criada; PIX bancario pendente',
    payload: {
      cobranca_id: created.id,
      valor: pendencia.valor,
      id_empresa: pendencia.idEmpresa,
      pix_ok: resPix.success,
    },
  });

  return {
    ok: true,
    idPagamento: created.id_pagamento || created.id,
    linkPagamento,
    pixOk: resPix.success,
    aviso: resPix.success
      ? undefined
      : `A cobrança foi registrada, mas o PIX bancário não pôde ser emitido agora (${resPix.error ?? 'falha na integração'}) — o financeiro pode reprocessar pela tela de cobranças; o link de pagamento já vale.`,
  };
}
