/**
 * O QUE FAZER COM A DIFERENÇA quando uma proposta já paga é alterada.
 *
 * POR QUE ISTO EXISTE COMO MÓDULO
 *   Este bloco vivia inline no handler de `/api/orcamentos/editar-paga`, em 142
 *   linhas amarradas a onze variáveis construídas ao longo dos 590 passos
 *   anteriores. A correção de frete pós-liberação precisa da MESMA decisão —
 *   quando abrir pendência de Conta Corrente, quando ajustar o faturado, quando
 *   reconciliar o status.
 *
 *   Escrever uma segunda versão criaria duas regras financeiras divergentes.
 *   Já aconteceu duas vezes nesta base por outro motivo (os chips da Expedição e
 *   os cards de Orçamentos, ambos com duas definições da mesma pergunta), e ali
 *   o preço de divergir era um número errado na tela. Aqui seria dinheiro de
 *   cliente indo para a Conta Corrente quando não devia — ou não indo quando
 *   devia.
 *
 * EXTRAÇÃO PURA
 *   Nenhuma regra mudou, nenhuma ordem mudou, nenhuma gravação mudou. O que era
 *   `return NextResponse.json(...)` no meio do handler virou um resultado
 *   discriminado que a rota traduz de volta em HTTP, com os mesmos status e as
 *   mesmas mensagens — a função não conhece Next, e é isso que a torna
 *   reaproveitável.
 *
 * O CONTRATO
 *   `ContextoDiferencaFinanceira` é a lista explícita do que a rota precisa
 *   fornecer. Ela existe para a PRÓXIMA rota saber o que reunir antes de chamar:
 *   se um campo não puder ser preenchido de forma honesta, a chamada não deveria
 *   acontecer.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { aplicarStatusRecomendadoProposta } from "@/features/orcamentos/services/status-writer.service";
import {
  avaliarEdicaoFaturado,
  type CobrancaParaFaturado,
  type TituloParaFaturado
} from "@/features/orcamentos/services/faturado-editavel";

export type ContextoDiferencaFinanceira = {
  /** Proposta e cliente — `id_int`, não o uuid. */
  idInt: number;
  idCliente: number;

  /**
   * Total DEPOIS da gravação, lido do banco (`saveProposta().valor_total`), já
   * arredondado. NUNCA o total calculado no cliente: quem decide o valor é o
   * banco, depois dos triggers.
   */
  novoTotalRealArredondado: number;
  /** Pago confirmado, pela regra da rota (abatimento de débito já descontado). */
  valorPagoRealArredondado: number;

  /** A proposta tinha pagamento confirmado ANTES desta edição. */
  ehPropostaPaga: boolean;
  /** Estava integralmente paga antes — gate da pendência de Conta Corrente. */
  estavaIntegralmentePaga: boolean;
  /** Caminho do faturado a vencer, que ajusta a cobrança em vez de abrir pendência. */
  ehCaminhoFaturado: boolean;

  /** Cobranças ativas da proposta, como a rota já as leu. */
  cobrancas: CobrancaParaFaturado[];
  /** Títulos do Contas a Receber, para a avaliação do faturado. */
  titulos: TituloParaFaturado[];

  /** Motivo da pendência, já validado contra a lista de motivos aceitos. */
  motivoFinal: string;
  /** Chave de idempotência do evento; uuid inválido ou ausente vira um novo. */
  chaveEvento: string | null | undefined;

  /** Quem está operando — vai para o histórico e para a reconciliação de status. */
  ator: { uid: string; nome: string; email: string };
  /** E-mail exibido nas mensagens ("Operador: ..."). */
  emailExibicao: string;
};

export type FalhaDiferencaFinanceira = {
  ok: false;
  status: number;
  code?: string;
  error: string;
};

export type SucessoDiferencaFinanceira = {
  ok: true;
  /** > 0 favor da empresa, < 0 favor do cliente, 0 sem pendência. */
  diferenca: number;
  pendenciaCriada: { id: number; descricao: string } | null;
  faturadoAjustado: { id: string; valorAnterior: number; valorNovo: number } | null;
};

export type ResultadoDiferencaFinanceira =
  | SucessoDiferencaFinanceira
  | FalhaDiferencaFinanceira;

const moeda = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

/**
 * Executa, NA MESMA ORDEM de antes:
 *   9b. ajuste do faturado a vencer (quando `ehCaminhoFaturado`);
 *   10. pendência de Conta Corrente via `cc_abrir_pendencia`;
 *   11. reconciliação de `status_interno` (best-effort).
 *
 * `supabase` precisa ser o client autenticado da rota — a RPC e as gravações
 * respeitam RLS e permissões como sempre.
 */
export async function aplicarDiferencaFinanceira(
  supabase: SupabaseClient,
  ctx: ContextoDiferencaFinanceira
): Promise<ResultadoDiferencaFinanceira> {
  const {
    idInt,
    idCliente,
    novoTotalRealArredondado,
    valorPagoRealArredondado,
    ehPropostaPaga,
    estavaIntegralmentePaga,
    ehCaminhoFaturado,
    cobrancas,
    titulos,
    motivoFinal,
    chaveEvento,
    ator,
    emailExibicao
  } = ctx;

  // ── 9b. Caminho do faturado: a cobrança acompanha o novo total ────────────
  // Reavaliação soberana com o total que o banco calculou — o `novoTotal` do
  // cliente serviu só para escolher o caminho. Como o faturamento é lido de
  // `pagamentos_v2`, este UPDATE é o que faz o mês fechar certo; não existe
  // outro lugar para corrigir.
  let faturadoAjustado: SucessoDiferencaFinanceira["faturadoAjustado"] = null;

  if (ehCaminhoFaturado) {
    const avaliacao = avaliarEdicaoFaturado({
      cobrancas,
      titulos,
      novoTotal: novoTotalRealArredondado
    });

    if (!avaliacao.elegivel) {
      // A proposta já foi gravada e a cobrança não pode acompanhar. Nada de
      // silêncio: o financeiro precisa saber que os dois valores divergiram.
      console.error(`[diferenca-financeira] Proposta #${idInt} salva, mas o faturado nao pode ser ajustado: ${avaliacao.motivo}`);
      return {
        ok: false,
        status: 409,
        code: avaliacao.motivo,
        error: `A proposta foi salva, mas a cobrança faturada NÃO foi ajustada: ${avaliacao.mensagem} Acerte a cobrança manualmente na aba Pagamentos.`
      };
    }

    const faturadoAtual = cobrancas.find((c) => c.id === avaliacao.faturadoId);
    const valorAnterior = Math.round((Number(faturadoAtual?.valor) || 0) * 100) / 100;

    if (Math.abs(valorAnterior - avaliacao.novoValorFaturado) >= 0.01) {
      // `boleto_enviadoo` volta a false junto com o valor: com valor novo, os
      // títulos anteriores não servem mais e a cobrança precisa reaparecer em
      // Registros de Recebíveis para ser registrada de novo.
      const { error: updateFaturadoError } = await supabase
        .from("pagamentos_v2")
        .update({ valor: avaliacao.novoValorFaturado, boleto_enviadoo: false })
        .eq("id", avaliacao.faturadoId);

      if (updateFaturadoError) {
        console.error("[diferenca-financeira] Falha ao ajustar o valor do faturado:", updateFaturadoError.message);
        return {
          ok: false,
          status: 500,
          code: "FALHA_AJUSTE_FATURADO",
          error: "A proposta foi salva, mas o valor da cobrança faturada não pôde ser atualizado. Acerte a cobrança manualmente na aba Pagamentos."
        };
      }

      faturadoAjustado = {
        id: avaliacao.faturadoId,
        valorAnterior,
        valorNovo: avaliacao.novoValorFaturado
      };

      await supabase.from("propostas_chat").insert([
        {
          id_int: idInt,
          id_cliente: idCliente,
          mensagem:
            `Proposta alterada com cobrança faturada a vencer. ` +
            `Valor da cobrança ajustado de ${moeda(valorAnterior)} para ${moeda(avaliacao.novoValorFaturado)}` +
            (avaliacao.valorOutrasCobrancas > 0
              ? ` (outras cobranças da proposta: ${moeda(avaliacao.valorOutrasCobrancas)}, sem alteração).`
              : ".") +
            ` A cobrança voltou para Registros de Recebíveis. Responsável: ${emailExibicao}.`,
          tipo: "SISTEMA",
          autor_nome: "Sistema",
          setor: "Financeiro",
          visivel_externo: false
        }
      ]);
    }
  }

  // ── 10. Abrir/ajustar a pendência de Conta Corrente via RPC cc_abrir_pendencia ──
  // A RPC recalcula soberanamente (dentro do banco) e reconcilia com qualquer
  // pendência ABERTA/PARCIALMENTE_RESOLVIDA já existente para esta proposta —
  // não há mais necessidade de recalcular diferença/reconciliação aqui.
  let diferenca = 0;
  let pendenciaCriada: SucessoDiferencaFinanceira["pendenciaCriada"] = null;

  // Só abre/ajusta pendência de Conta Corrente quando a proposta JÁ ESTAVA
  // integralmente paga antes desta edição (gate estavaIntegralmentePaga). Caso
  // contrário — cobrança pendente ou saldo ainda a cobrar — o gap é da própria
  // cobrança em pagamentos_v2, e chamar cc_abrir_pendencia criaria um débito
  // FAVOR_EMPRESA indevido (ex.: proposta #19511: R$ 63 total, R$ 15 pago,
  // R$ 48 PIX pendente → a RPC calcularia 63−15 = 48 de débito).
  //
  // REGRA (2026-07-22): diferença DEVEDORA (novo total > pago) NUNCA entra na
  // Conta Corrente — é saldo ainda devido da própria proposta, resolvido por
  // cobrança complementar na aba Pagamentos, abono do administrador ou
  // E-Crédito. A proposta salva normalmente, sem modal de opções, e o status
  // vai para AGUARDANDO pela reconciliação abaixo (cobertura parcial). A RPC
  // só é chamada no caso devedor quando existe pendência ABERTA a reconciliar
  // (ex.: crédito antigo que a nova edição zerou) — nunca para criar débito.
  // Classificação DEVEDORA por comparação direta dos dois valores já
  // arredondados a 2 casas: QUALQUER centavo devido (≥ R$ 0,01) segue o fluxo
  // novo. A tolerância (TOLERANCIA_CC) NÃO participa desta classificação — ela
  // serve só à cobertura (estavaIntegralmentePaga); usá-la aqui deixava
  // débitos de R$ 0,01–0,02 no fluxo antigo (RPC → pendência → modal),
  // regressão vista na #19514 (pago R$ 140,44 × total R$ 140,45).
  // No caminho do faturado a Conta Corrente não entra: a diferença foi para o
  // valor da própria cobrança, e não há dinheiro recebido para creditar ou
  // cobrar do cliente.
  const ehDiferencaDevedora = novoTotalRealArredondado > valorPagoRealArredondado;
  let temPendenciaAbertaParaReconciliar = false;

  if (!ehCaminhoFaturado && estavaIntegralmentePaga && ehDiferencaDevedora) {
    const { data: pendAbertas } = await supabase
      .from("conta_corrente_pendencias")
      .select("id")
      .eq("id_int", idInt)
      .in("status", ["ABERTA", "PARCIALMENTE_RESOLVIDA"])
      .limit(1);
    temPendenciaAbertaParaReconciliar = Boolean(pendAbertas && pendAbertas.length > 0);
  }

  if (!ehCaminhoFaturado && estavaIntegralmentePaga && (!ehDiferencaDevedora || temPendenciaAbertaParaReconciliar)) {
    const eventoUuid = chaveEvento && /^[0-9a-f-]{36}$/i.test(chaveEvento) ? chaveEvento : crypto.randomUUID();

    const { data: idPendenciaRpc, error: rpcError } = await supabase.rpc("cc_abrir_pendencia", {
      p_id_int: idInt,
      p_id_cliente: idCliente,
      p_chave_evento: eventoUuid,
      p_motivo: motivoFinal,
      p_total_soberano: novoTotalRealArredondado,
      p_observacao: `Operador: ${emailExibicao}.`,
    });

    if (rpcError) {
      const msg = rpcError.message || "Erro ao abrir/ajustar pendência de Conta Corrente.";
      const revisaoNecessaria = msg.includes("CC_AJUSTE_ABAIXO_COMPROMETIDO") || msg.includes("CC_FLIP_COM_COMPROMETIDO");
      console.error("[diferenca-financeira] Erro na RPC cc_abrir_pendencia:", msg);
      return {
        ok: false,
        status: revisaoNecessaria ? 409 : 500,
        error: revisaoNecessaria
          ? "Esta proposta já teve parte da diferença anterior usada ou reservada. O Financeiro precisa revisar manualmente antes de novas alterações."
          : msg
      };
    }

    // No caso devedor a RPC foi chamada apenas para reconciliar/encerrar uma
    // pendência antiga — nunca devolvemos diferença/pendência ao front nesse
    // caso (nenhum modal, salvamento normal; o saldo devedor vive na proposta).
    if (idPendenciaRpc != null && !ehDiferencaDevedora) {
      const { data: pendRow } = await supabase
        .from("conta_corrente_pendencias")
        .select("id, direcao, valor_saldo, valor_reservado, motivo")
        .eq("id", idPendenciaRpc)
        .maybeSingle();

      if (pendRow && (Number(pendRow.valor_saldo) > 0 || Number(pendRow.valor_reservado) > 0)) {
        const valorPendente = Math.round((Number(pendRow.valor_saldo) + Number(pendRow.valor_reservado)) * 100) / 100;
        diferenca = pendRow.direcao === "FAVOR_CLIENTE" ? -valorPendente : valorPendente;
        pendenciaCriada = {
          id: pendRow.id,
          descricao: `Proposta #${idInt} alterada após pagamento confirmado. Diferença pendente: R$ ${valorPendente.toFixed(2).replace(".", ",")} (${pendRow.direcao === "FAVOR_CLIENTE" ? "a favor do cliente" : "a favor da empresa"}). Motivo: ${pendRow.motivo}.`,
        };
      }
    }
  }

  // ── Reconciliar status_interno pelo fluxo oficial ──────────────────────────
  // Roda para qualquer proposta com pagamento confirmado (ehPropostaPaga),
  // INCLUSIVE quando não há diferença de Conta Corrente — é o que mantém
  // #19511 em "AGUARDANDO" (pago 15 de 63, PIX 48 pendente) em vez de status
  // congelado. status_interno nunca era recalculado ao salvar, e
  // formState.status (vindo do cliente) era persistido às cegas; nunca confiar
  // nele. Best-effort: nunca falha o salvamento da proposta em si.
  if (ehPropostaPaga) {
    const reconciliacao = await aplicarStatusRecomendadoProposta(
      idInt,
      ator,
      supabase,
      "AUTO_FINANCEIRO"
    );
    if (!reconciliacao.success) {
      console.warn(`[diferenca-financeira] Reconciliação de status sem efeito para proposta #${idInt}: ${reconciliacao.errorMessage}`);
    }
  }

  return { ok: true, diferenca, pendenciaCriada, faturadoAjustado };
}
