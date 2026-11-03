/**
 * Valor negociado do frete — gravação pelo bloco admin da aba Fretes.
 *
 * POR QUE EXISTE
 *   Em CIF com transportadora própria o frete é negociado, e nem sempre há card
 *   de cotação que o represente. Depois de LIBERADO a proposta é somente leitura
 *   para frete, e o select de transportadora do bloco admin grava só o vínculo.
 *   Faltava onde gravar o VALOR — o que o cliente paga.
 *
 * O QUE GRAVA, E COMO
 *   `propostas.valor_frete` e `propostas.valor_total` num UPDATE SÓ, com trava
 *   otimista nos dois valores lidos. Um statement é uma transação: não existe
 *   estado em que o frete mudou e o total não. Se outra operação mudou qualquer
 *   um dos dois entre a leitura e a escrita, o UPDATE não casa nenhuma linha e
 *   a gravação é recusada sem escrever nada.
 *
 *   O total é LINEAR no frete: `valor_total + (frete novo − frete antigo)`, o
 *   mesmo modelo de `exp_aplicar_recotacao`. Por isso o total gravado precisa
 *   estar coerente com `cc__total_soberano_proposta` ANTES — somar o frete sobre
 *   um total já errado só moveria o erro de lugar. A coerência é conferida antes
 *   e depois, em centavos.
 *
 *   NÃO toca `cotacao_frete` (os três triggers de lá reescrevem `valor_total` e
 *   `status_interno`) nem `boletos`. Cobrança, só no caso do faturado abaixo, e
 *   só pela `aplicarDiferencaFinanceira`.
 *
 * FATURADO A VENCER SEM TÍTULO (03/11/2026)
 *   Uma cobrança só, E-Faturado A_VENCER sem pagamento, zero linhas em `boletos`
 *   (`entradaFaturadoPeloCampo`), e quem grava com a permissão da `editar-paga`
 *   (`propostas.editar_paga` ou `propostas.editar_faturado`): grava o frete e a
 *   cobrança passa a valer o total novo, com a linha de autoria no chat — a
 *   MESMA função e a MESMA conta da `editar-paga`. Não há transação entre os
 *   dois UPDATEs: se a cobrança não acompanhar e continuar com o valor de
 *   antes, o frete é desfeito com a mesma trava otimista. Repetir o mesmo valor
 *   para no passo 4 e não escreve nada.
 *
 * A REGRA FINANCEIRA NÃO MORA AQUI
 *   Antes de gravar, `avaliarCoberturaFinanceira` (só leitura) diz por qual porta
 *   a proposta segue. Depois de gravar, `aplicarDiferencaFinanceira` decide o que
 *   fazer com a diferença — as mesmas duas funções de `/api/orcamentos/editar-paga`
 *   e da correção de frete da Expedição. Este módulo só junta os campos, recusa o
 *   que este bloco não pode resolver e chama.
 *
 * O QUE ESTE BLOCO RECUSA, ANTES DE GRAVAR (decisões de 14/09/2026)
 *   - faturado a vencer fora do caso acima (título, outra cobrança) ou sem a
 *     permissão: o caminho é editar a proposta e "Salvar alterações";
 *   - cobrança enviada e ainda não paga: o link tem valor fixo no provedor;
 *   - total menor que o pago sem `propostas.editar_paga`: a pendência de Conta
 *     Corrente exige essa permissão, conferida pela MESMA função do banco que
 *     `cc_abrir_pendencia` usa;
 *   - total menor que o pago que exigiria decidir o destino do crédito: este
 *     bloco não tem essa tela;
 *   - proposta antes de LIBERADO: ali o frete se define no orçamento, e o
 *     Salvar reescreveria este valor.
 *
 *   Total maior que o pago em LIBERADO ou APROVADO GRAVA, e a reconciliação
 *   oficial leva para AGUARDANDO: LIBERADO sem cobertura integral é estado
 *   inválido. É resultado esperado, não efeito colateral.
 *
 * AUTOR, DATA E HISTÓRICO saem de `trg_audit_propostas` (`audit.logs_v2`), por
 *   isso o client é o do USUÁRIO, nunca service role.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { estaNaFaseDeOrcamento, modalidadeCobraFrete, type ModalidadeFrete } from "@/features/orcamentos/lib/modalidade-frete";
import { avaliarCoberturaFinanceira } from "@/features/cobrancas/services/cobertura-financeira-proposta";
import { aplicarDiferencaFinanceira } from "@/features/cobrancas/services/diferenca-financeira-proposta";
import {
  avaliarEdicaoFaturado,
  isCobrancaAtiva,
  isFaturadoAjustavel,
  type CobrancaParaFaturado
} from "@/features/orcamentos/services/faturado-editavel";
import {
  PERMISSAO_FATURADO,
  PERMISSAO_PROPOSTA_PAGA,
  verificarPermissaoEditarPaga
} from "@/lib/auth/permissao-editar-paga";
import { barreiraNfAutorizada } from "@/features/expedicao/services/corrigir-frete-simulacao";
import { CODIGO_PEDIDO_ENTREGUE, MENSAGEM_PEDIDO_ENTREGUE, statusEhEntregue } from "@/features/orcamentos/services/pedido-entregue";

export type RecusaValorFrete = {
  ok: false;
  status: number;
  code: string;
  mensagem: string;
  /** Verdadeiro quando `valor_frete`/`valor_total` JÁ foram gravados antes da falha. */
  gravado: boolean;
};

export type SucessoValorFrete = {
  ok: true;
  idInt: number;
  /** Nada foi escrito: o valor informado já era o gravado. */
  semAlteracao: boolean;
  valorFreteAnterior: number;
  valorFreteNovo: number;
  valorTotalAnterior: number;
  valorTotalNovo: number;
  statusAnterior: string;
  statusNovo: string;
  valorPagoConfirmado: number;
  /** > 0 a cobrar do cliente, < 0 a favor do cliente, 0 coberto. */
  saldo: number;
  pendenciaAtiva: { id: number; descricao: string } | null;
  /** Cobrança faturada que acompanhou o frete (03/11/2026); null fora desse caso. */
  faturadoAjustado: { id: string; valorAnterior: number; valorNovo: number } | null;
};

const MOTIVO_PENDENCIA = "FRETE";

/** Valor em centavos inteiros. Toda comparação deste módulo é nessa unidade. */
const centavos = (valor: unknown): number => Math.round((Number(valor) || 0) * 100);
const moeda = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;

function recusa(status: number, code: string, mensagem: string, gravado = false): RecusaValorFrete {
  return { ok: false, status, code, mensagem, gravado };
}

export async function gravarValorFreteNegociado(
  supabase: SupabaseClient,
  entrada: {
    idInt: number;
    /** Em reais, já com no máximo duas casas. */
    valorFrete: number;
    chaveEvento?: string | null;
    ator: { uid: string; nome: string; email: string };
  }
): Promise<SucessoValorFrete | RecusaValorFrete> {
  const { idInt, valorFrete, chaveEvento, ator } = entrada;

  // ── 1. O valor ────────────────────────────────────────────────────────────
  // Sem arredondar para caber: valor com fração de centavo é recusado, não
  // ajustado. R$ 0,01 conta.
  if (!Number.isFinite(valorFrete) || valorFrete < 0) {
    return recusa(400, "VALOR_INVALIDO", "Informe um valor de frete válido, maior ou igual a zero.");
  }
  if (Math.abs(valorFrete * 100 - Math.round(valorFrete * 100)) > 1e-6) {
    return recusa(400, "VALOR_INVALIDO", "O valor do frete aceita no máximo duas casas decimais.");
  }
  const freteNovoC = Math.round(valorFrete * 100);

  // ── 2. A proposta como está no banco ──────────────────────────────────────
  const { data: propRow, error: propErro } = await supabase
    .from("propostas")
    .select("id_int, id_cliente, status_interno, modalidade_frete, valor_frete, valor_total, is_avulso, id_int_pedido_principal")
    .eq("id_int", idInt)
    .maybeSingle();

  if (propErro) return recusa(500, "FALHA_LEITURA", `Não foi possível ler a proposta #${idInt}: ${propErro.message}`);
  if (!propRow) return recusa(404, "NAO_ENCONTRADA", `Proposta #${idInt} não encontrada.`);

  const proposta = propRow as {
    id_int: number;
    id_cliente: number | null;
    status_interno: string | null;
    modalidade_frete: string | null;
    valor_frete: number | string | null;
    valor_total: number | null;
    is_avulso: boolean | null;
    id_int_pedido_principal: number | null;
  };
  const statusAnterior = String(proposta.status_interno ?? "");
  const statusBase = statusAnterior.split("/")[0].trim().toUpperCase();

  // ── 3. Onde este bloco vale ───────────────────────────────────────────────
  if (estaNaFaseDeOrcamento(proposta.status_interno)) {
    return recusa(
      409,
      "ANTES_DE_LIBERADO",
      `A proposta #${idInt} ainda está em ${statusAnterior || "orçamento"}: o frete se define no próprio orçamento, e o Salvar reescreveria este valor.`
    );
  }
  if (statusBase === "CANCELADO") {
    return recusa(409, "CANCELADA", `A proposta #${idInt} está cancelada e não aceita alteração de frete.`);
  }
  // Pedido entregue não pode ser alterado (02/11/2026): status lido do banco acima.
  if (statusEhEntregue(proposta.status_interno)) {
    return recusa(409, CODIGO_PEDIDO_ENTREGUE, MENSAGEM_PEDIDO_ENTREGUE);
  }
  if (proposta.id_int_pedido_principal !== null && proposta.id_int_pedido_principal !== undefined) {
    return recusa(
      409,
      "PEDIDO_COMPLEMENTAR",
      `O pedido #${idInt} é complementar: o frete dele é a diferença do peso somado, aplicada pela própria rota do complemento.`
    );
  }
  if (!modalidadeCobraFrete(proposta.modalidade_frete as ModalidadeFrete | null)) {
    return recusa(
      409,
      "MODALIDADE_SEM_FRETE",
      `A proposta #${idInt} é ${proposta.modalidade_frete}: nessa modalidade o cliente não paga frete à empresa, e o valor é sempre zero.`
    );
  }

  const freteAtualC = centavos(proposta.valor_frete);
  const totalAtualC = centavos(proposta.valor_total);

  // ── 4. Nada a fazer ───────────────────────────────────────────────────────
  if (freteNovoC === freteAtualC) {
    return {
      ok: true,
      idInt,
      semAlteracao: true,
      valorFreteAnterior: freteAtualC / 100,
      valorFreteNovo: freteAtualC / 100,
      valorTotalAnterior: totalAtualC / 100,
      valorTotalNovo: totalAtualC / 100,
      statusAnterior,
      statusNovo: statusAnterior,
      valorPagoConfirmado: 0,
      saldo: 0,
      pendenciaAtiva: null,
      faturadoAjustado: null
    };
  }

  // ── 4b. NF-e viva (02/11/2026) ────────────────────────────────────────────
  // Com nota autorizada, frete e total não mudam por aqui: MESMA barreira do
  // Corrigir frete e da aba Fretes, com a nota lida do banco. Sem isto a nota
  // ficava com o frete antigo.
  const nfViva = await barreiraNfAutorizada(supabase, idInt);
  if (nfViva) return recusa(nfViva.status, nfViva.motivo ?? "NF_AUTORIZADA", nfViva.mensagem ?? "Pedido com NF-e autorizada: cancele a nota antes de corrigir o frete.");

  // ── 5. O total gravado já confere com o cálculo do banco? ─────────────────
  const { data: soberanoAntes, error: soberanoErro } = await supabase.rpc("cc__total_soberano_proposta", {
    p_id_int: idInt
  });
  if (soberanoErro || soberanoAntes === null || soberanoAntes === undefined) {
    return recusa(500, "FALHA_TOTAL", `Não foi possível conferir o total da proposta #${idInt} no banco. Nada foi alterado.`);
  }
  const soberanoAntesC = centavos(soberanoAntes);
  if (proposta.valor_total === null || soberanoAntesC !== totalAtualC) {
    return recusa(
      409,
      "TOTAL_DIVERGENTE",
      `O total gravado da proposta #${idInt} (${proposta.valor_total === null ? "vazio" : moeda(totalAtualC)}) já difere do ` +
        `calculado pelo banco com itens + frete − desconto (${moeda(soberanoAntesC)}), uma diferença de ` +
        `${moeda(Math.abs(soberanoAntesC - totalAtualC))}. Corrija o total antes de alterar o frete: somar o frete sobre ` +
        `um total divergente só moveria o erro. Nada foi alterado.`
    );
  }

  const totalNovoC = totalAtualC + (freteNovoC - freteAtualC);
  if (totalNovoC < 0) {
    return recusa(409, "TOTAL_NEGATIVO", "Com esse frete o total da proposta ficaria negativo. Nada foi alterado.");
  }

  // ── 6. Cobranças e cobertura (só leitura) ─────────────────────────────────
  const { data: cobrancasBanco, error: cobrancasErro } = await supabase
    .from("pagamentos_v2")
    .select("id, id_pagamento, tipo_cobranca, status, confirmado, paid_at, valor, obs_v2")
    .eq("id_int", idInt)
    .neq("status", "CANCELADO");
  if (cobrancasErro) {
    return recusa(500, "FALHA_LEITURA", "Não foi possível ler as cobranças da proposta. Nada foi alterado.");
  }
  const cobrancas = (cobrancasBanco || []) as (CobrancaParaFaturado & { confirmado?: boolean | null; obs_v2?: string | null })[];
  const temCobrancasAtivas = cobrancas.length > 0;

  // Pago confirmado: a MESMA regra de `/api/orcamentos/editar-paga` e de
  // `corrigir-frete-simulacao` — PAID ou A_VENCER confirmado, com o abatimento de
  // débito antigo ([ABATIMENTO_DEBITO:x] em obs_v2) fora da conta.
  const pagoC = centavos(
    cobrancas
      .filter((c) => c.status === "PAID" || (c.status === "A_VENCER" && c.confirmado))
      .reduce((soma, c) => {
        const marcador = String(c.obs_v2 || "").match(/\[ABATIMENTO_DEBITO:(\d+(?:\.\d{1,2})?)\]/);
        const abatimento = marcador ? Number(marcador[1]) || 0 : 0;
        return soma + Math.max(0, (Number(c.valor) || 0) - abatimento);
      }, 0)
  );
  const ehPropostaPaga = temCobrancasAtivas && pagoC > 0;

  const cobertura = await avaliarCoberturaFinanceira(supabase, {
    idInt,
    cobrancas,
    valorPagoRealArredondado: pagoC / 100,
    valorTotalAntesEdicao: totalAtualC / 100,
    novoTotalPrevisto: totalNovoC / 100
  });
  if (!cobertura.ok) {
    return recusa(cobertura.status, "FALHA_COBERTURA", `${cobertura.error} Nada foi alterado.`);
  }
  const { estavaIntegralmentePaga, titulos, ehCaminhoFaturado, valorCobradoPendente } = cobertura;

  // ── 7. Recusas antes de gravar ────────────────────────────────────────────
  // Decisão 1 (revista em 03/11/2026): faturado a vencer só passa por aqui no
  // caso estreito de `entradaFaturadoPeloCampo` e com a permissão da
  // `editar-paga`; a cobrança acompanha pela mesma `aplicarDiferencaFinanceira`.
  // Fora disso, a recusa de sempre, com o caminho real na mensagem.
  let faturadoLiberado: { faturadoId: string; valorAnterior: number } | null = null;
  if (ehCaminhoFaturado) {
    const entrada = entradaFaturadoPeloCampo({ cobrancas, titulos });
    if (!entrada) {
      return recusa(409, "FATURADO_A_VENCER", mensagemFaturadoForaDoCampo(idInt, titulos.length > 0));
    }
    const permissao = await verificarPermissaoEditarPaga(supabase, ator.uid, [PERMISSAO_PROPOSTA_PAGA, PERMISSAO_FATURADO]);
    if (!permissao.autorizado) {
      return recusa(403, "SEM_PERMISSAO_EDITAR_FATURADO", mensagemFaturadoSemPermissao(idInt));
    }
    // Mesma conta que a gravação fará, antes de escrever: o que não couber é
    // recusado aqui, e não depois com o frete já gravado.
    const previa = avaliarEdicaoFaturado({ cobrancas, titulos, novoTotal: totalNovoC / 100 });
    if (!previa.elegivel) {
      return recusa(409, previa.motivo, `${previa.mensagem} Nada foi alterado.`);
    }
    faturadoLiberado = { faturadoId: previa.faturadoId, valorAnterior: centavos(entrada.valor) };
  }

  // Link de cobrança enviado e não pago: o valor dele está fixo no provedor.
  // No caminho do faturado não vale: a cobrança é a própria faturada, que acompanha.
  if (!ehCaminhoFaturado && centavos(valorCobradoPendente) > 0) {
    return recusa(
      409,
      "COBRANCA_ENVIADA",
      `A proposta #${idInt} tem ${moeda(centavos(valorCobradoPendente))} em cobrança enviada ao cliente e ainda não paga. ` +
        `O link tem valor fixo: para mudar o frete, a cobrança precisa ser cancelada primeiro na aba Pagamentos. Nada foi alterado.`
    );
  }

  // Avulsa (ou sem produto ativo) paga não é editável — a mesma regra do
  // `editar-paga`, que vale para todos, admin inclusive (e, como lá, fora do
  // caminho do faturado).
  if (ehPropostaPaga && !ehCaminhoFaturado) {
    let semProdutosAtivos = Boolean(proposta.is_avulso);
    if (!semProdutosAtivos) {
      const { count, error: produtosErro } = await supabase
        .from("produtos_proposta")
        .select("id", { count: "exact", head: true })
        .eq("id_int", idInt)
        .or("status_item.is.null,status_item.neq.CANCELADO");
      if (produtosErro) {
        return recusa(500, "FALHA_LEITURA", "Não foi possível verificar os produtos da proposta. Nada foi alterado.");
      }
      semProdutosAtivos = (count ?? 0) === 0;
    }
    if (semProdutosAtivos) {
      return recusa(
        403,
        "PAGA_SEM_PRODUTOS",
        proposta.is_avulso
          ? `A proposta #${idInt} é avulsa e já está paga: não pode ser alterada. Nada foi alterado.`
          : `A proposta #${idInt} está paga e não tem produto ativo: não pode ser alterada. Nada foi alterado.`
      );
    }
  }

  // Decisão 3: total menor que o pago.
  // No faturado a diferença vai para a cobrança, não para crédito do cliente.
  const ficaAbaixoDoPago = ehPropostaPaga && !ehCaminhoFaturado && totalNovoC < pagoC;
  if (ficaAbaixoDoPago && !estavaIntegralmentePaga) {
    // A Conta Corrente só recebe diferença de proposta que estava integralmente
    // paga. Fora disso o crédito do cliente ficaria sem destino — e decidir o
    // destino é tela que este bloco não tem.
    return recusa(
      409,
      "EXIGE_DECISAO_CREDITO",
      `Com esse frete o cliente ficaria com ${moeda(pagoC - totalNovoC)} a favor na proposta #${idInt}, que não estava ` +
        `integralmente paga. O destino desse crédito se decide na própria proposta: altere o frete e clique em ` +
        `"Salvar alterações" (permissão Editar Proposta Paga, propostas.editar_paga). Nada foi alterado.`
    );
  }

  // `aplicarDiferencaFinanceira` chama `cc_abrir_pendencia` quando a proposta
  // estava integralmente paga e o total não fica acima do pago, ou quando há
  // pendência aberta a reconciliar. Tudo que a RPC exigiria é conferido AQUI,
  // antes da escrita, para ela nunca recusar com o frete já gravado.
  if (ehPropostaPaga && estavaIntegralmentePaga && !ehCaminhoFaturado) {
    const { data: pendencias, error: pendErro } = await supabase
      .from("conta_corrente_pendencias")
      .select("id, valor_original, valor_saldo, valor_reservado, status")
      .eq("id_int", idInt)
      .in("status", ["ABERTA", "PARCIALMENTE_RESOLVIDA"]);
    if (pendErro) {
      return recusa(500, "FALHA_LEITURA", "Não foi possível ler as pendências de Conta Corrente. Nada foi alterado.");
    }
    const pendenciaAberta = (pendencias || [])[0] as
      | { id: number; valor_original: number; valor_saldo: number; valor_reservado: number }
      | undefined;

    const vaiParaContaCorrente = totalNovoC <= pagoC || Boolean(pendenciaAberta);
    if (vaiParaContaCorrente) {
      const { error: permErro } = await supabase.rpc("cc__assert_permissao", {
        p_uid: ator.uid,
        p_perm: "propostas.editar_paga"
      });
      if (permErro) {
        return recusa(
          403,
          "SEM_PERMISSAO_EDITAR_PAGA",
          `Este frete deixa a proposta #${idInt} ${totalNovoC < pagoC ? `com ${moeda(pagoC - totalNovoC)} a favor do cliente` : "com pendência de Conta Corrente a ajustar"}, ` +
            `e isso exige a permissão propostas.editar_paga, que este usuário não tem. Nada foi alterado.`
        );
      }
      // Valor já usado ou reservado da pendência: a RPC recusaria pedindo revisão
      // do financeiro. Recusar antes é não deixar o frete gravado pela metade.
      if (pendenciaAberta && centavos(pendenciaAberta.valor_original) - centavos(pendenciaAberta.valor_saldo) > 0) {
        return recusa(
          409,
          "EXIGE_REVISAO_FINANCEIRO",
          `A proposta #${idInt} tem pendência de Conta Corrente com valor já usado ou reservado. O Financeiro precisa ` +
            `revisar antes de uma nova alteração de valor. Nada foi alterado.`
        );
      }
    }
  }

  if (ehPropostaPaga && (proposta.id_cliente === null || proposta.id_cliente === undefined)) {
    return recusa(409, "SEM_CLIENTE", `A proposta #${idInt} está paga e não tem cliente vinculado. Nada foi alterado.`);
  }

  // ── 8. A escrita: um UPDATE, trava otimista nos dois valores lidos ────────
  let escrita = supabase
    .from("propostas")
    .update({ valor_frete: freteNovoC / 100, valor_total: totalNovoC / 100 })
    .eq("id_int", idInt);
  escrita = proposta.valor_frete === null ? escrita.is("valor_frete", null) : escrita.eq("valor_frete", proposta.valor_frete);
  // `valor_total` é double precision: o valor guardado pode não ser o double
  // exato do número que a API devolve (a 17974 guarda um 5864,66 que não é igual
  // a 5864.66::float8), então igualdade exata recusaria sem ninguém ter mexido.
  // A trava vale no MESMO CENTAVO lido — qualquer mudança real de total é de
  // pelo menos R$ 0,01 e cai fora da faixa. `valor_frete` é numeric: exato.
  escrita = escrita.gte("valor_total", (totalAtualC - 0.5) / 100).lt("valor_total", (totalAtualC + 0.5) / 100);

  const { data: gravadas, error: escritaErro } = await escrita.select("id_int, valor_frete, valor_total, status_interno");
  if (escritaErro) {
    return recusa(500, "FALHA_GRAVACAO", `Não foi possível gravar o frete: ${escritaErro.message}. Nada foi alterado.`);
  }
  const gravada = (gravadas || [])[0] as { valor_frete: number | string; valor_total: number } | undefined;
  if (!gravada) {
    return recusa(
      409,
      "VALORES_MUDARAM",
      `O frete ou o total da proposta #${idInt} foi alterado por outra operação enquanto você editava. ` +
        `Nada foi gravado: recarregue a página e tente de novo.`
    );
  }
  const totalGravadoC = centavos(gravada.valor_total);

  // ── 9. Conferência depois: frete e total seguem coerentes? ────────────────
  const { data: soberanoDepois } = await supabase.rpc("cc__total_soberano_proposta", { p_id_int: idInt });
  if (soberanoDepois === null || soberanoDepois === undefined || centavos(soberanoDepois) !== totalGravadoC) {
    console.error(
      `[valor-frete-negociado] Pedido #${idInt}: gravado frete ${moeda(freteNovoC)} e total ${moeda(totalGravadoC)}, ` +
        `mas o calculo do banco deu ${soberanoDepois === null || soberanoDepois === undefined ? "vazio" : moeda(centavos(soberanoDepois))}.`
    );
    // Faturado: a cobrança ainda não foi tocada; desfaz o frete para não deixar
    // a proposta com valor novo e a cobrança com o velho.
    if (faturadoLiberado && (await desfazerFrete(supabase, idInt, proposta, freteNovoC, totalGravadoC))) {
      return recusa(
        500,
        "TOTAL_DIVERGENTE_APOS_GRAVAR",
        `O total da proposta #${idInt} não conferiu com o cálculo do banco depois de gravar o frete, então o frete foi ` +
          `desfeito e a cobrança não foi tocada. Nada foi alterado. Avise o financeiro.`
      );
    }
    return recusa(
      500,
      "TOTAL_DIVERGENTE_APOS_GRAVAR",
      `O frete da proposta #${idInt} foi gravado (${moeda(freteNovoC)}, total ${moeda(totalGravadoC)}), mas o total não ` +
        `confere com itens + frete − desconto calculado pelo banco. A diferença financeira NÃO foi tratada. Avise o financeiro.`,
      true
    );
  }

  // ── 10. A decisão financeira oficial ──────────────────────────────────────
  const resultado = await aplicarDiferencaFinanceira(supabase, {
    idInt,
    idCliente: Number(proposta.id_cliente ?? 0),
    novoTotalRealArredondado: totalGravadoC / 100,
    valorPagoRealArredondado: pagoC / 100,
    ehPropostaPaga,
    estavaIntegralmentePaga,
    ehCaminhoFaturado,
    cobrancas,
    titulos,
    motivoFinal: MOTIVO_PENDENCIA,
    chaveEvento,
    ator,
    emailExibicao: ator.email
  });
  if (!resultado.ok) {
    if (faturadoLiberado) {
      return await desfazerAposFalhaDoFaturado(supabase, {
        idInt,
        proposta,
        freteNovoC,
        totalGravadoC,
        faturado: faturadoLiberado,
        falha: resultado
      });
    }
    return recusa(resultado.status, resultado.code ?? "FALHA_FINANCEIRA", resultado.error, true);
  }

  const { data: statusRow } = await supabase.from("propostas").select("status_interno").eq("id_int", idInt).maybeSingle();

  return {
    ok: true,
    idInt,
    semAlteracao: false,
    valorFreteAnterior: freteAtualC / 100,
    valorFreteNovo: centavos(gravada.valor_frete) / 100,
    valorTotalAnterior: totalAtualC / 100,
    valorTotalNovo: totalGravadoC / 100,
    statusAnterior,
    statusNovo: String((statusRow as { status_interno?: string | null } | null)?.status_interno ?? statusAnterior),
    valorPagoConfirmado: pagoC / 100,
    // Faturado: a cobrança passou a valer o total novo, não sobra saldo a cobrar.
    saldo: faturadoLiberado ? 0 : (totalGravadoC - pagoC) / 100,
    pendenciaAtiva: resultado.pendenciaCriada,
    faturadoAjustado: resultado.faturadoAjustado
  };
}

// ── Faturado a vencer pelo campo (03/11/2026) ───────────────────────────────

/**
 * O caso em que este campo ajusta a cobrança faturada: UMA cobrança ativa, ela
 * E-Faturado ajustável (A_VENCER, sem pagamento — `isFaturadoAjustavel`, a
 * mesma regra da `editar-paga`), e ZERO linhas em `boletos` para o pedido
 * (nem cancelada: título já houve, a conta é do Financeiro). Pedido entregue e
 * NF-e autorizada já foram recusados antes. Devolve a cobrança, ou null.
 */
export function entradaFaturadoPeloCampo(entrada: {
  cobrancas: CobrancaParaFaturado[];
  titulos: unknown[];
}): CobrancaParaFaturado | null {
  if (entrada.titulos.length > 0) return null;
  const ativas = entrada.cobrancas.filter(isCobrancaAtiva);
  if (ativas.length !== 1) return null;
  return isFaturadoAjustavel(ativas[0]) ? ativas[0] : null;
}

const CAMINHO_SALVAR =
  `abra a proposta, altere o frete e clique em "Salvar alterações" — exige a permissão Editar Proposta com ` +
  `Faturado a Vencer (propostas.editar_faturado) ou Editar Proposta Paga (propostas.editar_paga)`;

/** Faturado a vencer fora do caso do campo (título no Contas a Receber ou outra cobrança). */
export function mensagemFaturadoForaDoCampo(idInt: number, temTitulo: boolean): string {
  return (
    `A proposta #${idInt} tem cobrança faturada a vencer ${temTitulo ? "com título no Contas a Receber" : "junto de outras cobranças"}: ` +
    `este campo só ajusta a cobrança quando ela é a única da proposta e ainda não tem título. Para mudar o frete, ` +
    `${CAMINHO_SALVAR}. Nada foi alterado.`
  );
}

/** Faturado a vencer no caso do campo, mas sem a permissão da `editar-paga`. */
export function mensagemFaturadoSemPermissao(idInt: number): string {
  return (
    `A proposta #${idInt} tem cobrança faturada a vencer: mudar o frete ajusta o valor dessa cobrança, e isso exige a ` +
    `permissão Editar Proposta com Faturado a Vencer (propostas.editar_faturado) ou Editar Proposta Paga ` +
    `(propostas.editar_paga), que este usuário não tem. Quem tem a permissão pode mudar por este campo ou ` +
    `${CAMINHO_SALVAR.replace(" — exige a permissão", ", com a permissão")}. Nada foi alterado.`
  );
}

type ValoresLidos = { valor_frete: number | string | null; valor_total: number | null };

/**
 * Volta `valor_frete` e `valor_total` ao que foi lido, só se a linha ainda tem
 * os valores que ESTA chamada gravou (mesma trava otimista da escrita). Devolve
 * true quando desfez.
 */
async function desfazerFrete(
  supabase: SupabaseClient,
  idInt: number,
  lidos: ValoresLidos,
  freteGravadoC: number,
  totalGravadoC: number
): Promise<boolean> {
  const { data, error } = await supabase
    .from("propostas")
    .update({ valor_frete: lidos.valor_frete, valor_total: lidos.valor_total })
    .eq("id_int", idInt)
    .eq("valor_frete", freteGravadoC / 100)
    .gte("valor_total", (totalGravadoC - 0.5) / 100)
    .lt("valor_total", (totalGravadoC + 0.5) / 100)
    .select("id_int");
  if (error) {
    console.error(`[valor-frete-negociado] Pedido #${idInt}: falha ao desfazer o frete: ${error.message}`);
    return false;
  }
  return (data || []).length === 1;
}

/**
 * A cobrança faturada não acompanhou. Lê a cobrança: se ela continua com o valor
 * anterior, desfaz o frete e nada fica alterado. Se ela já mudou (ou não deu
 * para ler), NÃO desfaz — desfazer aí deixaria a cobrança nova com o frete velho.
 */
async function desfazerAposFalhaDoFaturado(
  supabase: SupabaseClient,
  p: {
    idInt: number;
    proposta: ValoresLidos;
    freteNovoC: number;
    totalGravadoC: number;
    faturado: { faturadoId: string; valorAnterior: number };
    falha: { status: number; code?: string; error: string };
  }
): Promise<RecusaValorFrete> {
  const { idInt, falha } = p;
  const code = falha.code ?? "FALHA_FINANCEIRA";
  const { data: atual, error: leituraErro } = await supabase
    .from("pagamentos_v2")
    .select("valor")
    .eq("id", p.faturado.faturadoId)
    .maybeSingle();
  const cobrancaIntacta =
    !leituraErro && atual !== null && centavos((atual as { valor?: unknown }).valor) === p.faturado.valorAnterior;

  if (cobrancaIntacta && (await desfazerFrete(supabase, idInt, p.proposta, p.freteNovoC, p.totalGravadoC))) {
    return recusa(
      falha.status,
      code,
      `A cobrança faturada da proposta #${idInt} não pôde ser ajustada, então o frete foi desfeito. Nada foi alterado. ` +
        `Tente de novo; se repetir, avise o financeiro.`
    );
  }
  console.error(
    `[valor-frete-negociado] Pedido #${idInt}: cobranca faturada nao ajustada (${code}) e o frete NAO foi desfeito ` +
      `(cobranca ${cobrancaIntacta ? "intacta, desfazer falhou" : "mudou ou nao foi lida"}).`
  );
  return recusa(
    falha.status,
    code,
    `O frete da proposta #${idInt} foi gravado, mas a cobrança faturada pode não ter acompanhado e não foi possível ` +
      `desfazer com segurança. Confira o valor da cobrança na aba Pagamentos e avise o financeiro.`,
    true
  );
}
