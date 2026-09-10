/**
 * Correção de frete pós-liberação — AVALIAÇÃO, sem escrever nada.
 *
 * O QUE ISTO É
 *   A Etapa 1+2 do plano: responde "se eu mudar a modalidade/transportadora
 *   deste pedido, dá? e quanto muda?" sem tocar em uma linha do banco.
 *
 * POR QUE MORA AQUI E NÃO DENTRO DA ROTA
 *   A rota fica fina e este módulo fica testável: o mesmo código que responde ao
 *   navegador pode ser rodado contra os pedidos reais por um script, que foi
 *   como as barreiras e a projeção foram conferidas antes de publicar.
 *
 * O QUE ELE NÃO FAZ
 *   Não grava, não cria a flag do `saveProposta` (Etapa 3) e não chama
 *   `editar-paga`. A gravação é rodada seguinte.
 *
 * SOBRE O NÚMERO PROJETADO
 *   `totalProjetado` reproduz a MESMA conta do `recalcular_proposta_v3`, que é
 *   quem de fato grava depois:
 *
 *       valor_total = soma(produtos ativos) - desconto + frete escolhido
 *
 *   e o frete passa por `valorFreteEfetivo`, a regra vigente da modalidade (FOB
 *   não cobra frete). É projeção, não promessa: quem decide o valor gravado
 *   continua sendo o banco, depois dos triggers. Na rodada da gravação o valor
 *   real é relido do banco antes de virar pendência financeira — é por isso que
 *   este número serve para ESCOLHER a ação, não para registrá-la.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { valorFreteEfetivo, type ModalidadeFrete } from "@/features/orcamentos/lib/modalidade-frete";
import { avaliarCoberturaFinanceira } from "@/features/cobrancas/services/cobertura-financeira-proposta";

/** Status em que a correção é oferecida. Ver `MOTIVO_FORA_DA_FAIXA`. */
export const STATUS_CORRIGIVEIS = ["EXPEDICAO", "A RETIRAR"] as const;

export type MotivoBloqueio =
  | "SEM_PERMISSAO"
  | "PROPOSTA_NAO_ENCONTRADA"
  | "NF_AUTORIZADA"
  | "DESPACHO_CONFIRMADO"
  | "ENTREGUE"
  | "FORA_DA_FAIXA"
  | "MODALIDADE_INVALIDA"
  /**
   * Entrou em 10/09/2026, e é o motivo pelo qual esta lista existe: ele já era
   * avaliado na GRAVAÇÃO e não aqui, então o modal mostrava tudo verde e a
   * confirmação recusava. Ver `titulosAtivosBloqueiam`.
   */
  | "TITULOS_ATIVOS";

export type SimulacaoCorrigirFrete = {
  permitido: boolean;
  /** Preenchido só quando `permitido` é false. */
  motivo: MotivoBloqueio | null;
  mensagem: string | null;
  /** HTTP que a rota deve devolver quando bloqueado. */
  status: number;
  /** Não bloqueia — apenas informa. */
  avisos: string[];
  dados: {
    idInt: number;
    idCliente: number | null;
    cliente: string;
    statusInterno: string;
    modalidadeAtual: ModalidadeFrete | null;
    modalidadeNova: ModalidadeFrete;
    transportadoraAtualId: number | null;
    transportadoraNovaId: number | null;
    valorTotalAtual: number;
    valorFreteAtual: number;
    valorFreteProjetado: number;
    /**
     * `cotacao_frete.servico` da linha escolhida. Exposto para a TELA derivar a
     * categoria do painel com a MESMA funcao do servidor, em vez de adivinhar
     * quando perguntar rodoviario ou aereo. Nao participa de nenhuma barreira.
     */
    servicoCotado: string;
    totalProjetado: number;
    valorPagoConfirmado: number;
    /** > 0 o cliente deve; < 0 há crédito a devolver. Base do modal financeiro. */
    diferenca: number;
    /** Efeito ISOLADO da correção sobre o total. Ver o comentário no cálculo. */
    deltaTotal: number;
    /** Sem diferença o fluxo grava direto, sem abrir o modal. */
    exigeAcaoFinanceira: boolean;
  } | null;
};

const MODALIDADES_VALIDAS: ModalidadeFrete[] = ["RETIRA", "FOB", "CIF"];

/** Centavo — os valores trafegam como float dos dois lados, como em `edicao-financeira`. */
const TOLERANCIA = 0.005;

function arredondar(valor: number): number {
  return Math.round((Number(valor) || 0) * 100) / 100;
}

function bloqueio(
  motivo: MotivoBloqueio,
  mensagem: string,
  status: number
): SimulacaoCorrigirFrete {
  return { permitido: false, motivo, mensagem, status, avisos: [], dados: null };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TÍTULO ATIVO SÓ BARRA QUANDO O TOTAL MUDA (10/09/2026).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O QUE A TRAVA PROTEGE
 *   Título já emitido carrega valor PRÓPRIO (`boletos.valor`, `numeric NOT
 *   NULL`), que este fluxo só lê e nunca escreve. Se o total da proposta mudar
 *   com título ativo, o Contas a Receber fica com o valor velho e ninguém o
 *   reconcilia depois — vários pontos somam `boletos.valor` sem contestar.
 *
 * POR QUE ELA NÃO PODE SER "EXISTE TÍTULO, BARRA"
 *   Delta zero não produz esse risco: se o total não muda, o título continua
 *   exato. O #21778 é o caso que mostrou isso — correção de CIF para RETIRA com
 *   frete R$ 0,00 → R$ 0,00, total R$ 835,00 → R$ 835,00, título de R$ 835,00
 *   que seguiria correto — e mesmo assim era recusado.
 *
 * DE ONDE VEIO A REGRA ANTIGA
 *   Ela nasceu em 13/08/2026 (f149548) no `editar-paga`, onde o comentário diz
 *   "a tela exclui os títulos antes de salvar" — e lá isso é VERDADE
 *   (`OrcamentoFormPage.tsx:3924` abre o modal que os exclui e rechama o save).
 *   Em 04/09/2026 (4a44ba8) o gate foi copiado para a correção de frete SEM a
 *   tela que o resolve, virando um beco sem saída: a mensagem manda excluir os
 *   títulos e nenhuma tela da Expedição oferece isso. O `editar-paga` fica como
 *   está, de propósito — lá a saída existe.
 *
 * ESTE PREDICADO É A REGRA INTEIRA, E OS DOIS PONTOS O CHAMAM
 *   A simulação (que alimenta o modal) e a gravação. Era a divergência entre os
 *   dois que produzia "tudo verde na tela, recusa na confirmação".
 *
 * SOBRE A TOLERÂNCIA
 *   `deltaTotal` já vem de `arredondar`, então só assume múltiplos de centavo:
 *   comparar com 0,005 ou com 0,01 dá o mesmo resultado. O modal usa 0,01 na
 *   frase "O total não muda" (`CorrigirFreteModal.tsx:202`) e continua de acordo
 *   com esta conta. Ao mexer numa, confira a outra.
 */
export function titulosAtivosBloqueiam(entrada: {
  /** Efeito ISOLADO da correção sobre o total, já arredondado. */
  deltaTotal: number;
  /** `avaliacaoPrevia.elegivel` — a proposta está no caminho do faturado. */
  elegivel: boolean;
  /** `avaliacaoPrevia.titulosParaExcluir.length`. */
  titulosAtivos: number;
}): boolean {
  if (Math.abs(entrada.deltaTotal) <= TOLERANCIA) return false;
  return entrada.elegivel && entrada.titulosAtivos > 0;
}

/** A mensagem da recusa, idêntica nos dois pontos. */
export function mensagemTitulosAtivos(idInt: number, titulosAtivos: number): string {
  return (
    `Pedido #${idInt} ainda tem ${titulosAtivos} titulo(s) ativo(s) no Contas a Receber. ` +
    `Eles precisam ser excluidos antes da correcao de frete.`
  );
}

/**
 * Avalia a correção. SOMENTE LEITURA — todas as consultas são `select`.
 *
 * `supabase` precisa ser o client COM a sessão do usuário: as barreiras leem
 * `propostas`, `expedicoes`, `notas_fiscais` e — desde 10/09/2026, pela
 * barreira 5 — `pagamentos_v2` e `boletos`, e a permissão já foi conferida
 * pela rota com o mesmo token. Nenhuma consulta aqui fala como `anon`.
 */
export async function simularCorrecaoFrete(
  supabase: SupabaseClient,
  params: {
    idInt: number;
    modalidade: string;
    transportadoraId: number | null;
    temPermissaoEditarPaga: boolean;
  }
): Promise<SimulacaoCorrigirFrete> {
  const { idInt, transportadoraId, temPermissaoEditarPaga } = params;

  if (!temPermissaoEditarPaga) {
    return bloqueio(
      "SEM_PERMISSAO",
      "Voce nao tem permissao para corrigir o frete de um pedido ja liberado.",
      403
    );
  }

  const modalidadeNova = String(params.modalidade ?? "").trim().toUpperCase() as ModalidadeFrete;
  if (!MODALIDADES_VALIDAS.includes(modalidadeNova)) {
    return bloqueio(
      "MODALIDADE_INVALIDA",
      `Modalidade invalida. Use uma destas: ${MODALIDADES_VALIDAS.join(", ")}.`,
      400
    );
  }

  const { data: proposta, error: propostaErro } = await supabase
    .from("propostas")
    .select("id_int, id_cliente, cliente, status_interno, modalidade_frete, id_transportadora_cliente, valor_total, valor, valor_frete, is_avulso")
    .eq("id_int", idInt)
    .maybeSingle();

  if (propostaErro || !proposta) {
    return bloqueio(
      "PROPOSTA_NAO_ENCONTRADA",
      `Pedido #${idInt} nao encontrado.`,
      propostaErro ? 500 : 404
    );
  }

  const statusInterno = String(proposta.status_interno ?? "").trim().toUpperCase();

  // ── Barreiras, na ordem em que o usuario consegue agir sobre elas ─────────

  // 1. NF autorizada: a nota ja foi transmitida e o valor dela e o da proposta.
  //    So o cancelamento da nota reabre a correcao.
  const { data: notas, error: notasErro } = await supabase
    .from("notas_fiscais")
    .select("numero_nf, status")
    .eq("id_int", idInt);

  if (notasErro) {
    return bloqueio("PROPOSTA_NAO_ENCONTRADA", "Nao foi possivel conferir as notas fiscais deste pedido.", 500);
  }

  const nfAutorizada = (notas ?? []).find(
    (n) =>
      String((n as { status?: string | null }).status ?? "").trim().toUpperCase() === "AUTORIZADA" &&
      String((n as { numero_nf?: string | null }).numero_nf ?? "").trim() !== ""
  );

  if (nfAutorizada) {
    const numero = String((nfAutorizada as { numero_nf?: string | null }).numero_nf ?? "").trim();
    return bloqueio(
      "NF_AUTORIZADA",
      `Pedido #${idInt} tem a NF-e ${numero} autorizada. Mudar o frete mudaria o valor total, e o valor da nota ja foi transmitido. ` +
        `Cancele a nota antes de corrigir o frete.`,
      409
    );
  }

  // 2. ENTREGUE: o transporte terminou.
  if (statusInterno === "ENTREGUE") {
    return bloqueio(
      "ENTREGUE",
      `Pedido #${idInt} ja foi entregue. O transporte terminou e o frete nao e mais corrigivel por aqui.`,
      409
    );
  }

  // 3. Despacho confirmado: a caixa saiu, e `expedicoes` guarda o que de fato
  //    levou. Voltar um passo desfaz o despacho e reabre a correcao.
  const { data: expedicao, error: expedicaoErro } = await supabase
    .from("expedicoes")
    .select("data_despacho, etiqueta_impressa_em")
    .eq("id_int", idInt)
    .maybeSingle();

  if (expedicaoErro) {
    return bloqueio("PROPOSTA_NAO_ENCONTRADA", "Nao foi possivel conferir a expedicao deste pedido.", 500);
  }

  if (expedicao?.data_despacho) {
    return bloqueio(
      "DESPACHO_CONFIRMADO",
      `Pedido #${idInt} ja foi despachado. Para corrigir o frete, volte um passo pelo menu Acoes do painel da Expedicao ` +
        `e tente de novo.`,
      409
    );
  }

  // 4. Faixa. Fica por ultimo entre os bloqueios porque as mensagens acima sao
  //    mais acionaveis: dizem O QUE FAZER, e esta so diz que nao da.
  if (!STATUS_CORRIGIVEIS.includes(statusInterno as (typeof STATUS_CORRIGIVEIS)[number])) {
    return bloqueio(
      "FORA_DA_FAIXA",
      `Pedido #${idInt} esta em ${statusInterno || "(sem status)"}. A correcao de frete vale para pedido em ` +
        `${STATUS_CORRIGIVEIS.join(" ou ")}.`,
      409
    );
  }

  // ── Projeção ──────────────────────────────────────────────────────────────

  const [{ data: itens }, { data: desconto }, { data: freteEscolhido }] = await Promise.all([
    supabase.from("produtos_proposta").select("valor_sub_total, status_item").eq("id_int", idInt),
    supabase
      .from("desconto_proposta")
      .select("valor_percentual, valor_nominal")
      .eq("id_int", idInt)
      .maybeSingle(),
    supabase
      .from("cotacao_frete")
      .select("valor, servico")
      .eq("id_int", idInt)
      .eq("escolhido", true)
      .maybeSingle()
  ]);

  /**
   * AVULSA nao tem item: o valor e digitado a mao e vive em `propostas.valor`,
   * e quem monta o total dela e o trigger `tg_propostas_valor_total_avulsa`.
   * Somar `produtos_proposta` numa avulsa da ZERO — foi o que a primeira versao
   * desta funcao fez, e ela projetou o total do pedido 21085 caindo de
   * R$ 85.000,00 para R$ 0,00. Duas das 17 propostas em EXPEDICAO sao avulsas.
   */
  const ehAvulsa = proposta.is_avulso === true;
  const valorProdutos = ehAvulsa
    ? Number(proposta.valor) || 0
    : (itens ?? [])
        .filter((i) => String((i as { status_item?: string | null }).status_item ?? "PENDENTE").toUpperCase() !== "CANCELADO")
        .reduce((soma, i) => soma + (Number((i as { valor_sub_total?: unknown }).valor_sub_total) || 0), 0);

  const percentual = Number(desconto?.valor_percentual ?? 0);
  const nominal = Number(desconto?.valor_nominal ?? 0);
  const valorDesconto = percentual > 0 ? (valorProdutos * percentual) / 100 : nominal;

  // A cotação NÃO muda: a correção troca a modalidade, e é a modalidade que
  // decide se o valor cotado é cobrado. Trocar a cotação é outro fluxo.
  const valorCotado = Number(freteEscolhido?.valor ?? 0) || 0;
  const valorFreteProjetado = valorFreteEfetivo(valorCotado, modalidadeNova);

  const totalProjetado = arredondar(valorProdutos - valorDesconto + valorFreteProjetado);

  // Mesma regra de `editar-paga`: cobrança que embute abatimento de débito da
  // conta corrente não conta como pagamento DESTA proposta.
  // As colunas são as MESMAS que a gravação lê: além do cálculo do pago, elas
  // alimentam `avaliarCoberturaFinanceira` na barreira 5, e a avaliação do
  // faturado precisa de `id`, `id_pagamento`, `tipo_cobranca` e `paid_at`.
  const { data: cobrancas } = await supabase
    .from("pagamentos_v2")
    .select("id, id_pagamento, tipo_cobranca, status, confirmado, paid_at, valor, obs_v2")
    .eq("id_int", idInt)
    .neq("status", "CANCELADO");

  const valorPagoConfirmado = arredondar(
    (cobrancas ?? [])
      .filter((c) => {
        const status = String((c as { status?: string | null }).status ?? "").toUpperCase();
        const confirmado = (c as { confirmado?: boolean | null }).confirmado === true;
        return status === "PAID" || (status === "A_VENCER" && confirmado);
      })
      .reduce((soma, c) => {
        const marcador = String((c as { obs_v2?: string | null }).obs_v2 ?? "").match(
          /\[ABATIMENTO_DEBITO:(\d+(?:\.\d{1,2})?)\]/
        );
        const abatimento = marcador ? Number(marcador[1]) || 0 : 0;
        return soma + Math.max(0, (Number((c as { valor?: unknown }).valor) || 0) - abatimento);
      }, 0)
  );

  const diferenca = arredondar(totalProjetado - valorPagoConfirmado);

  /**
   * `deltaTotal` e o efeito ISOLADO da correcao: quanto o total muda por causa
   * da troca de modalidade. `diferenca` e outra coisa — e o saldo contra o que o
   * cliente ja pagou, que e o numero de que o modal financeiro precisa.
   *
   * Os dois separados porque em pedido sem pagamento confirmado `diferenca` vale
   * o total inteiro, o que nao diz nada sobre a correcao. E porque quando os dois
   * discordam ha um terceiro fato: `propostas.valor_total` esta desatualizado no
   * banco (visto em producao nos pedidos 20960 e 20890).
   */
  const deltaTotal = arredondar(totalProjetado - (Number(proposta.valor_total) || 0));

  // 5. Título ativo no Contas a Receber — a ÚNICA barreira que depende do
  //    número, e por isso a única que não cabe junto das outras quatro lá em
  //    cima. Ver `titulosAtivosBloqueiam`: delta zero passa.
  //
  //    Mesma função de cobertura que a gravação usa, e não uma segunda leitura
  //    com regra própria: é o que garante que os dois respondam igual.
  const cobertura = await avaliarCoberturaFinanceira(supabase, {
    idInt,
    cobrancas: cobrancas ?? [],
    valorPagoRealArredondado: valorPagoConfirmado,
    valorTotalAntesEdicao: arredondar(Number(proposta.valor_total) || 0),
    novoTotalPrevisto: totalProjetado
  });

  if (!cobertura.ok) {
    return bloqueio("PROPOSTA_NAO_ENCONTRADA", cobertura.error, cobertura.status);
  }

  const { avaliacaoPrevia } = cobertura;
  const titulosAtivos = avaliacaoPrevia.elegivel ? avaliacaoPrevia.titulosParaExcluir.length : 0;

  if (titulosAtivosBloqueiam({ deltaTotal, elegivel: avaliacaoPrevia.elegivel, titulosAtivos })) {
    return bloqueio("TITULOS_ATIVOS", mensagemTitulosAtivos(idInt, titulosAtivos), 409);
  }

  const avisos: string[] = [];
  if (expedicao?.etiqueta_impressa_em) {
    avisos.push(
      "A etiqueta ja foi impressa e segue valida: ela le a expedicao, que nao muda com esta correcao."
    );
  }

  return {
    permitido: true,
    motivo: null,
    mensagem: null,
    status: 200,
    avisos,
    dados: {
      idInt,
      idCliente: proposta.id_cliente !== null ? Number(proposta.id_cliente) : null,
      cliente: String(proposta.cliente ?? ""),
      statusInterno,
      modalidadeAtual: (proposta.modalidade_frete as ModalidadeFrete | null) ?? null,
      modalidadeNova,
      transportadoraAtualId:
        proposta.id_transportadora_cliente !== null ? Number(proposta.id_transportadora_cliente) : null,
      transportadoraNovaId: transportadoraId,
      valorTotalAtual: arredondar(Number(proposta.valor_total) || 0),
      valorFreteAtual: arredondar(Number(proposta.valor_frete) || 0),
      servicoCotado: String(freteEscolhido?.servico ?? ""),
      valorFreteProjetado: arredondar(valorFreteProjetado),
      totalProjetado,
      valorPagoConfirmado,
      diferenca,
      deltaTotal,
      exigeAcaoFinanceira: Math.abs(diferenca) > TOLERANCIA
    }
  };
}
