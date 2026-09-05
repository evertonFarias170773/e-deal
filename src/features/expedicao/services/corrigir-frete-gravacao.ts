/**
 * Correção de frete pós-liberação — GRAVAÇÃO.
 *
 * O QUE ISTO É
 *   A Etapa 4 do plano: o modo `confirmar`. Reavalia as barreiras, grava a
 *   correção e aplica a decisão financeira que já existe.
 *
 * POR QUE NÃO PASSA PELO `saveProposta`
 *   O `saveProposta` com `force` faz DELETE + INSERT em `cotacao_frete`, DELETE
 *   por diff em `produtos_proposta` e DELETE + INSERT em
 *   `produtos_proposta_variacao`. Para não destruir nada ele precisa de um
 *   `PropostaFormState` fiel, e o único lugar que monta um é o
 *   `OrcamentoFormPage` — que INVENTA linhas (`createFretesMock`, o card
 *   "Retirada Local" quando a UF é RS, o `frete_manual_unico` da avulsa). Elas
 *   voltariam para o `cotacao_frete` da proposta.
 *
 *   E, mesmo com um formState fiel, ele não corrigiria o dinheiro: depois de
 *   LIBERADO o `usarDeclaracaoPersistida` faz `modalidadeVigente` ser a
 *   modalidade JÁ GRAVADA, e `valor_frete`/`frete_escolhido` são calculados a
 *   partir dela e escritos ANTES do gate da modalidade. Uma correção CIF→FOB
 *   gravaria `modalidade_frete = FOB` com o valor e o nome do SEDEX. Houve uma
 *   opção no `saveProposta` para abrir aquele gate (8475ff3); ela foi removida
 *   por exatamente este motivo, e não deve voltar.
 *
 * O QUE ESTE MÓDULO ESCREVE — e só isto:
 *   `propostas`: modalidade_frete, transporte_categoria, id_transportadora_cliente,
 *                valor_frete, frete_escolhido
 *   `cotacao_frete`: `valor` da linha ESCOLHIDA, por UPDATE
 *
 *   O UPDATE da cotação não é cosmético e não é opcional: `recalcular_proposta_v3`
 *   lê o frete de `cotacao_frete.valor`, NÃO de `propostas.valor_frete`, e o único
 *   trigger que o dispara (`trg_recalc_after_frete`) mora em `cotacao_frete`. Sem
 *   esse UPDATE o `valor_total` não seria recalculado por ninguém, e as duas
 *   colunas ficariam divergentes — estado que não existe em nenhuma proposta da
 *   base, porque o `saveProposta` grava o valor EFETIVO nas duas.
 *
 *   `servico`, `prazo`, `peso`, `cep` e `id_cotacao` NÃO são tocados: a memória
 *   de com quanto e como o frete foi cotado continua intacta, ao contrário do que
 *   o DELETE + INSERT do `saveProposta` faria.
 *
 *   Produtos, variações, modelos e desconto não são tocados de forma alguma.
 *
 * O QUE OS TRIGGERS FAZEM DEPOIS
 *   `trg_recalc_after_frete` → `recalcular_proposta_v3`, que escreve `valor_total`
 *   (e `volume`, e `valor` quando a proposta NÃO é avulsa — em avulsa o `valor`
 *   digitado sobrevive, desde a migration 20260903233333).
 *   `trg_frete_sync_financeiro` → `atualizar_status_financeiro_proposta`, que
 *   RETORNA CEDO em EXPEDICAO e A RETIRAR pela guarda de status protegido. É por
 *   isso que a faixa da correção é essa e não outra.
 *   `tg_recalc_frete_v4` só faz SELECT: não escreve.
 *
 * A REGRA FINANCEIRA NÃO MORA AQUI
 *   O gate de cobertura é `avaliarCoberturaFinanceira` e a decisão é
 *   `aplicarDiferencaFinanceira` — as mesmas funções que o `/api/orcamentos/editar-paga`
 *   usa, na mesma ordem. Este módulo só reúne os onze campos e chama.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  nomeTransporteEfetivo,
  nomeTransportadoraCadastro,
  type ModalidadeFrete
} from "@/features/orcamentos/lib/modalidade-frete";
import { categoriaDerivadaDaEscolha } from "@/features/orcamentos/lib/transporte-categoria";
import {
  categoriaDoServico,
  categoriaPorNomeConhecido,
  ehCategoriaFrete,
  type CategoriaFrete
} from "@/features/orcamentos/lib/categoria-frete";
import type { CobrancaParaFaturado } from "@/features/orcamentos/services/faturado-editavel";
import { avaliarCoberturaFinanceira } from "@/features/cobrancas/services/cobertura-financeira-proposta";
import { aplicarDiferencaFinanceira } from "@/features/cobrancas/services/diferenca-financeira-proposta";
import { simularCorrecaoFrete, type MotivoBloqueio } from "./corrigir-frete-simulacao";

/**
 * A única ação financeira que o backend sabe executar para diferença CREDORA:
 * abrir a pendência a favor do cliente na Conta Corrente, exatamente como o
 * `editar-paga` faz. Enquanto a tela da Expedição não existir (Etapa 5), quem
 * chama precisa dizer isto explicitamente — é o "sem ação" que a rota recusa.
 */
export const ACAO_ABRIR_PENDENCIA_CREDITO = "ABRIR_PENDENCIA_CREDITO";

/** `FRETE` está na `MOTIVOS_VALIDOS` do `editar-paga`. Aqui é sempre esse. */
const MOTIVO_PENDENCIA = "FRETE";

export type MotivoRecusaCorrecao =
  | MotivoBloqueio
  | "TITULOS_ATIVOS"
  | "AGUARDA_DECISAO_CREDITO"
  | "SEM_COTACAO_ESCOLHIDA"
  | "SEM_CLIENTE"
  | "FALHA_GRAVACAO"
  | "FALHA_FINANCEIRA";

export type ResultadoCorrecaoFrete =
  | {
      ok: true;
      idInt: number;
      modalidadeAnterior: ModalidadeFrete | null;
      modalidadeNova: ModalidadeFrete;
      transportadoraNovaId: number | null;
      transporteCategoria: string | null;
      categoriaFrete: CategoriaFrete | null;
      freteEscolhido: string;
      valorFreteAnterior: number;
      valorFreteNovo: number;
      valorTotalAnterior: number;
      /** Lido de `propostas.valor_total` DEPOIS do recalculo. Soberano. */
      valorTotalNovo: number;
      totalProjetado: number;
      valorPagoConfirmado: number;
      diferenca: number;
      pendenciaAtiva: { id: number; descricao: string } | null;
      faturadoAjustado: { id: string; valorAnterior: number; valorNovo: number } | null;
      avisos: string[];
    }
  | { ok: false; status: number; motivo: MotivoRecusaCorrecao; mensagem: string };

function recusa(motivo: MotivoRecusaCorrecao, mensagem: string, status: number): ResultadoCorrecaoFrete {
  return { ok: false, status, motivo, mensagem };
}

const moeda = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

/**
 * Executa a correção. `supabase` precisa ser o client autenticado da rota: as
 * gravações e a RPC respeitam RLS e permissões como sempre.
 */
export async function confirmarCorrecaoFrete(
  supabase: SupabaseClient,
  params: {
    idInt: number;
    modalidade: string;
    transportadoraId: number | null;
    temPermissaoEditarPaga: boolean;
    /** `ACAO_ABRIR_PENDENCIA_CREDITO` ou nada. Ver a recusa da diferença credora. */
    acaoFinanceira: string | null;
    /**
     * RODOVIARIO ou AEREO declarado pelo operador, e só isso.
     *
     * A correção cai no MESMO ponto ambíguo do drop de FOB do orçamento: quando
     * a transportadora não é parceira, ninguém tem como saber o meio. A
     * derivação vence esta declaração, exatamente como no `saveProposta` — quem
     * corrigiu para RETIRA não fica com o aéreo declarado antes.
     */
    categoriaFreteDeclarada?: string | null;
    chaveEvento: string | null;
    ator: { uid: string; nome: string; email: string };
  }
): Promise<ResultadoCorrecaoFrete> {
  const { idInt, temPermissaoEditarPaga, acaoFinanceira, chaveEvento, ator } = params;

  // ── 1. Barreiras, reavaliadas do zero ─────────────────────────────────────
  // Nada do que a simulação anterior respondeu é levado em conta: entre a
  // simulação que a tela fez e este clique a NF pode ter sido autorizada e o
  // despacho pode ter sido confirmado. As mensagens são as mesmas do modo
  // simular, de propósito — quem for barrado lê o mesmo texto nos dois modos.
  const simulacao = await simularCorrecaoFrete(supabase, {
    idInt,
    modalidade: params.modalidade,
    transportadoraId: params.transportadoraId,
    temPermissaoEditarPaga
  });

  if (!simulacao.permitido || !simulacao.dados) {
    return recusa(
      (simulacao.motivo ?? "PROPOSTA_NAO_ENCONTRADA") as MotivoRecusaCorrecao,
      simulacao.mensagem ?? `Nao foi possivel corrigir o frete do pedido #${idInt}.`,
      simulacao.status
    );
  }

  const dados = simulacao.dados;
  const { modalidadeNova, transportadoraNovaId, valorFreteProjetado, totalProjetado } = dados;

  if (dados.idCliente === null) {
    // Sem cadastro não há a quem creditar ou de quem cobrar, e
    // `aplicarDiferencaFinanceira` precisa do id do cliente para a pendência.
    return recusa(
      "SEM_CLIENTE",
      `Pedido #${idInt} nao tem cadastro de cliente vinculado. A correcao de frete depende dele para tratar a diferenca financeira.`,
      409
    );
  }
  const idCliente = dados.idCliente;

  // ── 2. A linha da cotação escolhida ───────────────────────────────────────
  // Ela é a porta do recálculo: sem ela o `valor_total` não seria refeito por
  // ninguém e a proposta ficaria com o total antigo. Recusar é melhor do que
  // gravar a modalidade nova sobre um total velho.
  const { data: cotacao, error: cotacaoErro } = await supabase
    .from("cotacao_frete")
    .select("id, valor, servico")
    .eq("id_int", idInt)
    .eq("escolhido", true)
    .maybeSingle();

  if (cotacaoErro) {
    return recusa("SEM_COTACAO_ESCOLHIDA", "Nao foi possivel ler a cotacao de frete deste pedido.", 500);
  }
  if (!cotacao) {
    return recusa(
      "SEM_COTACAO_ESCOLHIDA",
      `Pedido #${idInt} nao tem cotacao de frete escolhida. Sem ela o total nao e recalculado, e a correcao nao pode ser gravada.`,
      409
    );
  }

  const servicoCotado = String((cotacao as { servico?: string | null }).servico ?? "");
  const cotacaoId = (cotacao as { id: number }).id;

  // O rótulo de que `classificarTransporte` precisa. O `saveProposta` monta
  // `${transportadora} ${servico}` porque as duas metades carregam vocabulário —
  // "Correios SEDEX" tem a marca no nome e o serviço em "Entrega Expressa", e a
  // cotação real inverte isso. Em `cotacao_frete` não existe coluna de
  // transportadora, então a segunda metade aqui é o `frete_escolhido` já
  // gravado: é exatamente o rótulo que `classificarTransporte` foi feito para
  // ler. Sem isto, um serviço genérico classificaria como nulo e apagaria uma
  // categoria que hoje está correta.
  const { data: propostaRotulo } = await supabase
    .from("propostas")
    .select("frete_escolhido")
    .eq("id_int", idInt)
    .maybeSingle();

  const rotuloParaCategoria = `${servicoCotado} ${
    String((propostaRotulo as { frete_escolhido?: string | null } | null)?.frete_escolhido ?? "")
  }`.trim();

  // ── 3. O nome do transporte, pela modalidade NOVA ─────────────────────────
  // `nomeTransporteEfetivo` é a mesma função que o `saveProposta` usa. Em FOB
  // ela devolve a transportadora declarada; fora de FOB, o serviço cotado.
  let nomeTransportadora: string | null = null;
  if (modalidadeNova === "FOB" && transportadoraNovaId !== null) {
    const { data: transpRow } = await supabase
      .from("clientes")
      .select("id_cliente, nome, fantasia")
      .eq("id_cliente", transportadoraNovaId)
      .maybeSingle();
    if (transpRow) {
      nomeTransportadora = nomeTransportadoraCadastro(
        transpRow as { id_cliente: number; nome?: string | null; fantasia?: string | null }
      );
    }
  }

  const freteEscolhido = nomeTransporteEfetivo(servicoCotado, modalidadeNova, nomeTransportadora);

  // Motoboy não entra aqui: a correção declara modalidade e transportadora, e a
  // tela que ofereceria a exceção do Motoboy é a Etapa 5. `false` é o mesmo que
  // o `saveProposta` passa quando `formState.transporteCategoria` não é MOTOBOY.
  const transporteCategoria = categoriaDerivadaDaEscolha(modalidadeNova, rotuloParaCategoria, false);

  /**
   * A CATEGORIA DO PAINEL, pela mesma derivação do orçamento.
   *
   * Em FOB o serviço cotado NÃO entra, pelo mesmo motivo de sempre: o card que
   * sobra ali é resíduo. Fora de FOB vale o serviço da cotação, que não muda com
   * a correção.
   *
   * A declaração do operador só é usada onde a derivação devolve `null` — a
   * transportadora sem meio conhecido. Sem declaração fica NULL, que é "não
   * classificada", e o painel a mostra em EXTRAS. Nada é chutado.
   */
  const categoriaDerivada = categoriaDoServico(
    freteEscolhido,
    modalidadeNova === "FOB" ? null : servicoCotado,
    modalidadeNova
  );
  const categoriaDeclarada: CategoriaFrete | null = ehCategoriaFrete(params.categoriaFreteDeclarada)
    ? params.categoriaFreteDeclarada
    : null;
  // Derivacao forte > declaracao do operador > tabela de nomes. Mesma ordem do
  // `saveProposta`, pelo mesmo motivo: a lista e o degrau mais fraco.
  const categoriaFrete =
    categoriaDerivada ?? categoriaDeclarada ?? categoriaPorNomeConhecido(freteEscolhido, servicoCotado);

  // ── 4. Cobrancas e cobertura, ANTES da gravação ───────────────────────────
  // `estavaIntegralmentePaga` pergunta como a proposta estava ANTES desta
  // alteração — depois do UPDATE a resposta já seria outra. Mesma posição que
  // ocupa no `editar-paga`.
  const { data: cobrancasBanco, error: cobrancasErro } = await supabase
    .from("pagamentos_v2")
    .select("id, id_pagamento, tipo_cobranca, status, confirmado, paid_at, valor, obs_v2")
    .eq("id_int", idInt)
    .neq("status", "CANCELADO");

  if (cobrancasErro) {
    return recusa("FALHA_GRAVACAO", "Erro ao buscar cobrancas da proposta no servidor.", 500);
  }

  const cobrancas = (cobrancasBanco || []) as CobrancaParaFaturado[];
  const temCobrancasAtivas = cobrancas.length > 0;
  const valorPagoRealArredondado = dados.valorPagoConfirmado;
  const ehPropostaPaga = temCobrancasAtivas && valorPagoRealArredondado > 0;

  const cobertura = await avaliarCoberturaFinanceira(supabase, {
    idInt,
    cobrancas,
    valorPagoRealArredondado,
    valorTotalAntesEdicao: dados.valorTotalAtual,
    novoTotalPrevisto: totalProjetado
  });

  if (!cobertura.ok) {
    return recusa("FALHA_GRAVACAO", cobertura.error, cobertura.status);
  }

  const { estavaIntegralmentePaga, titulos, avaliacaoPrevia, ehCaminhoFaturado } = cobertura;

  // Mesma rede de segurança do `editar-paga`: título ainda ativo no Contas a
  // Receber ficaria com o valor velho. `avaliacaoPrevia.elegivel` e não o
  // atalho, porque é ele que estreita a união.
  if (avaliacaoPrevia.elegivel && avaliacaoPrevia.titulosParaExcluir.length > 0) {
    return recusa(
      "TITULOS_ATIVOS",
      `Pedido #${idInt} ainda tem ${avaliacaoPrevia.titulosParaExcluir.length} titulo(s) ativo(s) no Contas a Receber. ` +
        `Eles precisam ser excluidos antes da correcao de frete.`,
      409
    );
  }

  // ── 5. Diferença CREDORA sem ação: recusa ANTES de gravar ────────────────
  // Credora é o cliente ter pago mais do que o novo total — dinheiro dele em
  // nossas mãos. Gravar primeiro e perguntar depois deixaria a proposta
  // corrigida com o crédito pendurado. A projeção da simulação basta para a
  // decisão: é exatamente para isso que ela existe (o valor gravado sai da
  // releitura do banco, logo abaixo).
  //
  // Devedora ou sem diferença salva direto, sem modal — a regra de 22/07 diz
  // que saldo devedor não entra na Conta Corrente, ele continua sendo da
  // própria proposta.
  const ehCredora = dados.exigeAcaoFinanceira && dados.diferenca < 0;
  if (ehCredora && acaoFinanceira !== ACAO_ABRIR_PENDENCIA_CREDITO) {
    return recusa(
      "AGUARDA_DECISAO_CREDITO",
      `Esta correcao deixa ${moeda(Math.abs(dados.diferenca))} a favor do cliente no pedido #${idInt}. ` +
        `Escolha o que fazer com esse credito antes de concluir — nada foi alterado.`,
      409
    );
  }

  // ── 6. Gravação ───────────────────────────────────────────────────────────
  // As cinco colunas de `propostas` primeiro, para que o recálculo disparado
  // pela cotação já encontre a modalidade nova gravada.
  const { error: propostaErro } = await supabase
    .from("propostas")
    .update({
      modalidade_frete: modalidadeNova,
      transporte_categoria: transporteCategoria,
      id_transportadora_cliente: transportadoraNovaId,
      valor_frete: valorFreteProjetado,
      frete_escolhido: freteEscolhido,
      // Sexta coluna desde 05/09/2026. Entra no MESMO update das outras cinco:
      // nenhum statement novo, nenhum trigger novo, e a correcao nao pode deixar
      // a categoria apontando para o transporte antigo.
      categoria_frete: categoriaFrete
    })
    .eq("id_int", idInt);

  if (propostaErro) {
    console.error(`[corrigir-frete] Falha ao gravar a correcao do pedido #${idInt}:`, propostaErro.message);
    return recusa("FALHA_GRAVACAO", "Nao foi possivel gravar a correcao de frete. Nada foi alterado.", 500);
  }

  // O UPDATE da cotação dispara `recalcular_proposta_v3`, que escreve o
  // `valor_total`. Só a coluna `valor`: a memória da cotação fica intacta.
  const { error: cotacaoUpdateErro } = await supabase
    .from("cotacao_frete")
    .update({ valor: valorFreteProjetado })
    .eq("id", cotacaoId);

  if (cotacaoUpdateErro) {
    // A proposta já mudou de modalidade e o total NÃO foi recalculado. Falhar
    // alto: silêncio aqui deixaria a proposta com o frete novo e o total velho.
    console.error(
      `[corrigir-frete] Pedido #${idInt}: modalidade gravada, mas a cotacao nao pode ser atualizada:`,
      cotacaoUpdateErro.message
    );
    return recusa(
      "FALHA_GRAVACAO",
      `A modalidade do pedido #${idInt} foi gravada, mas o valor do frete na cotacao NAO foi atualizado e o total continua o antigo. ` +
        `Avise o financeiro antes de qualquer nova alteracao neste pedido.`,
      500
    );
  }

  // ── 7. O total soberano ───────────────────────────────────────────────────
  // Relido do banco depois dos triggers. O `totalProjetado` serviu para escolher
  // a ação; quem decide o valor é o banco.
  const { data: propostaPos, error: relerErro } = await supabase
    .from("propostas")
    .select("valor_total")
    .eq("id_int", idInt)
    .maybeSingle();

  if (relerErro || !propostaPos) {
    console.error(`[corrigir-frete] Pedido #${idInt}: correcao gravada, mas o total nao pode ser relido.`);
    return recusa(
      "FALHA_GRAVACAO",
      `A correcao do pedido #${idInt} foi gravada, mas o novo total nao pode ser lido de volta. ` +
        `Confira a proposta antes de tratar a diferenca financeira.`,
      500
    );
  }

  const novoTotalRealArredondado = Math.round((Number(propostaPos.valor_total) || 0) * 100) / 100;

  // ── 8. A decisão financeira, na mesma ordem do `editar-paga` ─────────────
  // Onze campos, nenhum inventado: os quatro do gate saem de
  // `avaliarCoberturaFinanceira`, o total sai da releitura acima, o pago sai da
  // simulação (mesma regra de abatimento do `editar-paga`), o motivo é FRETE e o
  // ator vem da sessão.
  const resultadoFinanceiro = await aplicarDiferencaFinanceira(supabase, {
    idInt,
    idCliente,
    novoTotalRealArredondado,
    valorPagoRealArredondado,
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

  if (!resultadoFinanceiro.ok) {
    // A correção JÁ está gravada — é o mesmo desfecho do `editar-paga`, cujas
    // mensagens dizem "a proposta foi salva, mas...". O texto vem de lá.
    return recusa("FALHA_FINANCEIRA", resultadoFinanceiro.error, resultadoFinanceiro.status);
  }

  const avisos = [...simulacao.avisos];
  if (Math.abs(novoTotalRealArredondado - totalProjetado) >= 0.01) {
    // Divergir não é erro — significa que `propostas.valor_total` estava
    // desatualizado antes desta correção, e o recálculo o consertou junto.
    avisos.push(
      `O total recalculado pelo banco (${moeda(novoTotalRealArredondado)}) difere do projetado ` +
        `(${moeda(totalProjetado)}): o valor gravado antes desta correcao estava desatualizado.`
    );
  }

  return {
    ok: true,
    idInt,
    modalidadeAnterior: dados.modalidadeAtual,
    modalidadeNova,
    transportadoraNovaId,
    transporteCategoria,
    categoriaFrete,
    freteEscolhido,
    valorFreteAnterior: dados.valorFreteAtual,
    valorFreteNovo: valorFreteProjetado,
    valorTotalAnterior: dados.valorTotalAtual,
    valorTotalNovo: novoTotalRealArredondado,
    totalProjetado,
    valorPagoConfirmado: valorPagoRealArredondado,
    diferenca: resultadoFinanceiro.diferenca,
    pendenciaAtiva: resultadoFinanceiro.pendenciaCriada,
    faturadoAjustado: resultadoFinanceiro.faturadoAjustado,
    avisos
  };
}
