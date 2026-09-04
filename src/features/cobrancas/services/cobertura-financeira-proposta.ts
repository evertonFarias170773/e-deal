/**
 * A proposta ESTAVA quitada antes desta edição? E qual caminho ela segue?
 *
 * POR QUE ISTO EXISTE COMO MÓDULO
 *   Estes três valores decidem QUANDO a decisão financeira se aplica —
 *   `aplicarDiferencaFinanceira` decide O QUE fazer, este módulo decide se ela
 *   entra em cena e por qual porta. Viviam inline no handler de
 *   `/api/orcamentos/editar-paga`, e a correção de frete pós-liberação precisa
 *   dos mesmos três.
 *
 *   Copiá-los deixaria a decisão de "o que fazer" num lugar só (a extração de
 *   2062dd6) e a de "quando aplicar" em dois — que é a mesma divergência, um
 *   nível acima. A tolerância de dois centavos e o gate de cobertura têm
 *   contra-exemplos reais registrados (19511 e 19514); duplicá-los é garantir
 *   que um dos dois lados fique para trás na próxima correção.
 *
 * EXTRAÇÃO PURA
 *   Nenhuma regra mudou, nenhuma ordem mudou. A leitura de `boletos` continua
 *   acontecendo no mesmo ponto do fluxo, e o erro dela virou resultado
 *   discriminado em vez de `NextResponse.json` — a função não conhece Next.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  avaliarEdicaoFaturado,
  type CobrancaParaFaturado,
  type TituloParaFaturado
} from "@/features/orcamentos/services/faturado-editavel";

/**
 * Dois centavos. NÃO é número mágico: participa só da COBERTURA (o gate abaixo),
 * nunca da classificação devedora/credora — usá-la lá deixava débitos de
 * R$ 0,01–0,02 no fluxo antigo, regressão vista na #19514 (pago R$ 140,44 ×
 * total R$ 140,45). Ver o comentário correspondente em
 * `diferenca-financeira-proposta.ts`.
 */
export const TOLERANCIA_CC = 0.02;

export type CoberturaFinanceira = {
  ok: true;
  /**
   * Já cobrado mas ainda NÃO pago (PIX/boleto A_RECEBER, A_VENCER não
   * confirmado). É saldo de uma cobrança em `pagamentos_v2` — resolve-se
   * confirmando OU cancelando a cobrança, e NUNCA vira pendência de Conta
   * Corrente.
   */
  valorCobradoPendente: number;
  /** O gate da Conta Corrente. Ver o comentário no cálculo. */
  estavaIntegralmentePaga: boolean;
  /** Títulos do Contas a Receber, lidos aqui e reaproveitados pelo chamador. */
  titulos: TituloParaFaturado[];
  /** Avaliação preliminar do faturado — o chamador usa `titulosParaExcluir` e `motivo`. */
  avaliacaoPrevia: ReturnType<typeof avaliarEdicaoFaturado>;
  /** Atalho de `avaliacaoPrevia.elegivel`. */
  ehCaminhoFaturado: boolean;
};

export type FalhaCoberturaFinanceira = {
  ok: false;
  status: number;
  error: string;
};

export async function avaliarCoberturaFinanceira(
  supabase: SupabaseClient,
  params: {
    idInt: number;
    /**
     * Cobranças ativas, como o chamador já as leu. `confirmado` entra no tipo
     * porque o cálculo de `valorCobradoPendente` depende dele e ele não faz
     * parte de `CobrancaParaFaturado`.
     */
    cobrancas: (CobrancaParaFaturado & { confirmado?: boolean | null })[];
    /** Pago confirmado, já arredondado. */
    valorPagoRealArredondado: number;
    /** Total ANTES desta edição — lido do banco, antes do save. */
    valorTotalAntesEdicao: number;
    /**
     * Total que o chamador espera gravar, só para escolher o CAMINHO. O valor
     * gravado sai da reavaliação pós-save, soberana.
     */
    novoTotalPrevisto: number;
  }
): Promise<CoberturaFinanceira | FalhaCoberturaFinanceira> {
  const { idInt, cobrancas, valorPagoRealArredondado, valorTotalAntesEdicao, novoTotalPrevisto } = params;

  // ── 5a. Separar os três valores que NÃO podem ser confundidos ────────────
  //  a) valorPagoRealArredondado  → pago confirmado (PAID / A_VENCER confirmado)
  //  b) valorCobradoPendente      → já cobrado mas ainda NÃO pago (PIX/boleto
  //     A_RECEBER, A_VENCER não confirmado). É saldo de uma cobrança em
  //     pagamentos_v2 — resolve-se confirmando OU cancelando a cobrança, e
  //     NUNCA vira pendência de Conta Corrente.
  //  c) diferença de Conta Corrente → só existe quando a proposta já estava
  //     INTEGRALMENTE PAGA e sofreu alteração posterior real (ver gate abaixo).
  const valorCobradoPendente = Math.round(
    cobrancas
      .filter(c => !(c.status === "PAID" || (c.status === "A_VENCER" && c.confirmado)))
      .reduce((sum, c) => sum + (Number(c.valor) || 0), 0) * 100
  ) / 100;

  // Conta Corrente só se aplica a diferença pós-pagamento: a proposta precisava
  // já estar quitada (pago confirmado cobre o total anterior) E sem cobrança
  // pendente em aberto. Se ainda há saldo a cobrar (pago < total) ou cobrança
  // pendente (ex.: PIX A_RECEBER de R$ 48 numa proposta de R$ 63 com R$ 15 de
  // E-Crédito), a proposta está no fluxo normal de "aguardando pagamento" — o
  // gap pertence à cobrança em pagamentos_v2, não à Conta Corrente, e NÃO deve
  // abrir pendência FAVOR_EMPRESA nem banner de débito nem modal de diferença.
  const estavaIntegralmentePaga =
    valorTotalAntesEdicao > 0 &&
    valorPagoRealArredondado >= valorTotalAntesEdicao - TOLERANCIA_CC &&
    valorCobradoPendente <= TOLERANCIA_CC;

  // ── 5a2. Caminho do faturado a vencer ─────────────────────────────────────
  // Faturado a vencer é receita autorizada, não dinheiro recebido: a proposta
  // ainda pode mudar e o valor da cobrança acompanha. Sem este desvio ela cai
  // no fluxo de proposta paga e abre pendência de Conta Corrente por um
  // dinheiro que nunca entrou. Avaliado ANTES dos bloqueios do chamador porque
  // muda o que cada um deles decide.
  // Ver features/orcamentos/services/faturado-editavel.ts.
  const { data: titulosBanco, error: titulosError } = await supabase
    .from("boletos")
    .select("id, id_pagamento, parcela, total_parcelas, valor, vencimento, status, paid_at, deposito_conta, id_boleto_c6, id_empresa")
    .eq("id_int", idInt);

  if (titulosError) {
    return {
      ok: false,
      status: 500,
      error: "Erro ao verificar os títulos desta proposta no Contas a Receber."
    };
  }

  const titulos = (titulosBanco || []) as TituloParaFaturado[];
  // Avaliação preliminar: usa o total que o cliente calculou apenas para
  // decidir o caminho e barrar o que impede a edição (título quitado, título
  // ainda ativo). O valor gravado sai da reavaliação pós-save, soberana.
  const avaliacaoPrevia = avaliarEdicaoFaturado({
    cobrancas,
    titulos,
    novoTotal: novoTotalPrevisto
  });
  const ehCaminhoFaturado = avaliacaoPrevia.elegivel;

  // Inelegível NÃO bloqueia: significa apenas que este não é o caminho do
  // faturado, e a proposta segue pelo fluxo de sempre (Conta Corrente).
  // Isso importa porque título quitado com cobrança ainda em A_VENCER é a
  // situação MAIS COMUM na base — 181 das 247 propostas faturadas em
  // 13/08/2026. Ali o dinheiro entrou de verdade (o `pagamentos_v2` é que não
  // acompanha), então quem tem `propostas.editar_paga` deve continuar
  // editando pela Conta Corrente, exatamente como antes. Barrar aqui seria
  // tirar da mesa uma edição que hoje funciona.

  return {
    ok: true,
    valorCobradoPendente,
    estavaIntegralmentePaga,
    titulos,
    avaliacaoPrevia,
    ehCaminhoFaturado
  };
}
