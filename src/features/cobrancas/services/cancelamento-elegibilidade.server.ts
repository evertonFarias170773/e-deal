/**
 * Coletor server-side do veredito de cancelamento: monta o dossiê a partir do
 * banco e chama o núcleo puro (`cancelamento-elegibilidade.ts`).
 *
 * As rotas chamam ESTA função diretamente (chamada de função, não HTTP); a UI
 * chama a rota `GET /api/cobrancas/pode-cancelar`, que também chama daqui.
 * O mesmo código decide nos dois caminhos — é isso que impede a divergência
 * entre tela e servidor que existia antes.
 *
 * Usa o client recebido (JWT do usuário, sem service role), então a RLS
 * continua valendo.
 *
 * Spec: docs/superpowers/specs/2026-08-25-cancelamento-cobranca-refaturamento-design.md
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  avaliarCancelamento,
  TODAS_AS_RECUSAS,
  type CodigoVeredito,
  type CobrancaParaElegibilidade,
  type DossieCancelamento,
  type NotaParaElegibilidade,
  type TituloParaElegibilidade,
  type VereditoCancelamento
} from "@/features/cobrancas/cancelamento-elegibilidade";

const SELECT_PAGAMENTO =
  "id, id_int, id_pagamento, id_cliente, id_empresa, status, confirmado, tipo_cobranca, " +
  "paid_at, data_confirmacao, cod_solicitacao_inter, reserva_estado, id_pendencia, chave_reserva, valor";

const SELECT_BOLETO =
  "id, id_int, id_pagamento, parcela, total_parcelas, valor, vencimento, status, paid_at, " +
  "id_empresa, id_boleto_c6, is_faturado";

type PagamentoRow = CobrancaParaElegibilidade & {
  id_cliente: number | null;
  id_empresa: number | null;
  cod_solicitacao_inter: string | null;
  reserva_estado: string | null;
  id_pendencia: number | null;
  chave_reserva: string | null;
  valor: number | null;
};

type BoletoRow = TituloParaElegibilidade & {
  id_int: number | null;
  id_pagamento: string | null;
  is_faturado: boolean | null;
};

type PropostaRow = { status_interno: string | null; is_prd_aprovado: boolean | null };
type NfeRow = { numero_nf: string | null; status: string | null; ambiente: string | null };
type NfseRow = { numero_nfse: string | null; status: string | null; ambiente: string | null };
type TipoRow = { id: string; tipo_cobranca: string | null };

/** Consulta que não precisou ser feita (a cobrança não tem o vínculo). */
function vazio<T>(): Promise<{ data: T | null; error: { message: string } | null }> {
  return Promise.resolve({ data: null, error: null });
}

function vazioLista<T>(): Promise<{ data: T[] | null; error: { message: string } | null }> {
  return Promise.resolve({ data: [], error: null });
}

export type ResultadoElegibilidade =
  | { ok: true; veredito: VereditoCancelamento; dossie: DossieCancelamento; pagamento: PagamentoRow }
  | { ok: false; erro: "NAO_ENCONTRADA" | "FALHA_LEITURA"; mensagem: string };

/**
 * Família faturado, normalizada. Não existe predicado canônico no módulo: há
 * três definições divergentes (`isCobrancaEFaturado` só cobre E-FATURADO,
 * `TIPOS_SEM_LINK_EXTERNO` cobre um conjunto maior, `pagamentos-v2.service`
 * usa outra lista). Aqui interessa só quem pode possuir título faturado.
 *
 * O banco hoje guarda duas grafias — "E-Faturado" (173) e "E-FATURADO" (109).
 * A comparação é feita sobre o valor normalizado, e não por `.in()` com
 * grafias exatas, para uma grafia nova não furar a checagem em silêncio.
 */
const FAMILIA_FATURADO = new Set(["E-FATURADO", "EFATURADO", "FATURADO"]);

function normalizarTipo(tipo: string | null | undefined): string {
  return String(tipo || "").trim().toUpperCase().replace(/_/g, "-");
}

function isFamiliaFaturado(tipo: string | null | undefined): boolean {
  return FAMILIA_FATURADO.has(normalizarTipo(tipo));
}

function toTitulo(row: BoletoRow): TituloParaElegibilidade {
  return {
    id: row.id,
    parcela: row.parcela,
    total_parcelas: row.total_parcelas,
    valor: row.valor,
    vencimento: row.vencimento,
    status: row.status,
    paid_at: row.paid_at,
    id_empresa: row.id_empresa,
    id_boleto_c6: row.id_boleto_c6
  };
}

/**
 * Monta o dossiê e devolve o veredito.
 *
 * `aplicaveis` deixa o chamador respeitar só um subconjunto das recusas — hoje
 * só `/api/orcamentos/cancelar-proposta` usa (`RECUSAS_DE_DINHEIRO`).
 */
export async function avaliarCancelamentoNoServidor(
  supabase: SupabaseClient,
  pagamentoId: string,
  aplicaveis: readonly CodigoVeredito[] = TODAS_AS_RECUSAS
): Promise<ResultadoElegibilidade> {
  // 1. A cobrança é a âncora: o id é a única informação de confiança que entra
  //    aqui. Tudo o mais é derivado do que está gravado nela.
  const { data: pagamento, error: erroPagamento } = await supabase
    .from("pagamentos_v2")
    .select(SELECT_PAGAMENTO)
    .eq("id", pagamentoId)
    .maybeSingle<PagamentoRow>();

  if (erroPagamento) {
    console.error("[elegibilidade] Falha ao ler a cobrança:", erroPagamento.message);
    return { ok: false, erro: "FALHA_LEITURA", mensagem: "Não foi possível ler a cobrança no banco." };
  }
  if (!pagamento) {
    return { ok: false, erro: "NAO_ENCONTRADA", mensagem: "Cobrança não encontrada." };
  }

  const idInt = pagamento.id_int;
  const idPagamento = pagamento.id_pagamento;
  const codBancario = pagamento.cod_solicitacao_inter;

  // 2. O resto em paralelo. Cada consulta é opcional conforme o que a cobrança
  //    tem gravado, mas NENHUMA falha pode ser lida como "não há" — ver o
  //    tratamento de erro logo abaixo.
  const [
    propostaRes,
    titulosPorPagamentoRes,
    titulosPorIdIntRes,
    nfeRes,
    nfseRes,
    cobrancasDaPropostaRes
  ] = await Promise.all([
    idInt != null
      ? supabase
          .from("propostas")
          .select("status_interno, is_prd_aprovado")
          .eq("id_int", idInt)
          .maybeSingle<PropostaRow>()
      : vazio<PropostaRow>(),

    // Vínculo primário: o título aponta para a cobrança.
    idPagamento
      ? supabase.from("boletos").select(SELECT_BOLETO).eq("id_pagamento", idPagamento).returns<BoletoRow[]>()
      : vazioLista<BoletoRow>(),

    // Todos os títulos da proposta — daqui saem os outros dois vínculos
    // (BOLETO por código bancário, e o fallback legado). Uma consulta só.
    idInt != null
      ? supabase.from("boletos").select(SELECT_BOLETO).eq("id_int", idInt).returns<BoletoRow[]>()
      : vazioLista<BoletoRow>(),

    idInt != null
      ? supabase.from("notas_fiscais").select("numero_nf, status, ambiente").eq("id_int", idInt).returns<NfeRow[]>()
      : vazioLista<NfeRow>(),

    idInt != null
      ? supabase.from("notas_servico").select("numero_nfse, status, ambiente").eq("id_int", idInt).returns<NfseRow[]>()
      : vazioLista<NfseRow>(),

    // Para decidir a ambiguidade do fallback: quantas cobranças faturadas a
    // proposta tem.
    idInt != null
      ? supabase.from("pagamentos_v2").select("id, tipo_cobranca").eq("id_int", idInt).returns<TipoRow[]>()
      : vazioLista<TipoRow>()
  ]);

  // Falha de leitura NUNCA vira "não há". Um erro em `notas_fiscais` lido como
  // lista vazia liberaria o cancelamento de uma cobrança com nota autorizada —
  // exatamente o tipo de falha silenciosa que este ponto único existe para
  // evitar. Recusar por indisponibilidade é o lado seguro.
  const falhas = [
    ["proposta", propostaRes.error],
    ["titulos", titulosPorPagamentoRes.error],
    ["titulos da proposta", titulosPorIdIntRes.error],
    ["notas fiscais", nfeRes.error],
    ["notas de serviço", nfseRes.error],
    ["cobranças da proposta", cobrancasDaPropostaRes.error]
  ].filter(([, erro]) => Boolean(erro)) as [string, { message: string }][];

  if (falhas.length > 0) {
    for (const [nome, erro] of falhas) {
      console.error(`[elegibilidade] Falha ao ler ${nome}:`, erro.message);
    }
    return {
      ok: false,
      erro: "FALHA_LEITURA",
      mensagem:
        "Não foi possível verificar todas as condições de cancelamento agora " +
        `(${falhas.map(([nome]) => nome).join(", ")}). Tente novamente.`
    };
  }

  const titulosDaProposta = titulosPorIdIntRes.data || [];
  const cobrancaEhFaturado = isFamiliaFaturado(pagamento.tipo_cobranca);

  // 3. Três vínculos cobrança↔título, unidos e deduplicados por id:
  const porId = new Map<string, BoletoRow>();

  //    (a) primário — o título aponta para a cobrança.
  for (const row of titulosPorPagamentoRes.data || []) {
    porId.set(row.id, row);
  }

  //    (b) BOLETO — vínculo por código bancário + proposta, o mesmo filtro
  //        composto que `cancelar-externo` já usa (nunca id_int isolado).
  if (codBancario && idInt != null) {
    for (const row of titulosDaProposta) {
      if (row.id_boleto_c6 === codBancario) porId.set(row.id, row);
    }
  }

  //    (c) fallback legado — 266 títulos faturados foram gravados sem
  //        `id_pagamento`, e 255 deles estão PAID. Sem este ramo, o veredito
  //        não veria o título e liberaria o cancelamento de uma cobrança cujo
  //        título já foi pago: é a falha mais grave prevista na spec (§13,
  //        risco 1). Só vale para cobrança da família faturado — um BOLETO não
  //        possui título faturado.
  const orfaosDaProposta = titulosDaProposta.filter(
    (row) => row.is_faturado === true && row.id_pagamento == null
  );
  if (cobrancaEhFaturado) {
    for (const row of orfaosDaProposta) porId.set(row.id, row);
  }

  // 4. Ambiguidade: o fallback casa por proposta, não por cobrança. Se a
  //    proposta tiver mais de uma cobrança faturada, não dá para afirmar de
  //    quem é o título órfão — e o custo de errar é cancelar cobrança com
  //    título pago. Recusa conservadora (1 caso no banco hoje).
  const faturadasDaProposta = (cobrancasDaPropostaRes.data || [])
    .filter((row) => isFamiliaFaturado(row.tipo_cobranca)).length;

  const vinculoAmbiguo = cobrancaEhFaturado && orfaosDaProposta.length > 0 && faturadasDaProposta > 1;

  // Sob ambiguidade os órfãos saem do dossiê: eles não são desta cobrança com
  // certeza, e mantê-los produziria uma recusa por título alheio em vez da
  // recusa correta, que é `VINCULO_AMBIGUO`.
  const titulos: TituloParaElegibilidade[] = Array.from(porId.values())
    .filter((row) => !(vinculoAmbiguo && row.is_faturado === true && row.id_pagamento == null))
    .map(toTitulo);

  const notas: NotaParaElegibilidade[] = [
    ...(nfeRes.data || []).map(
      (row): NotaParaElegibilidade => ({
        tipo: "NFE",
        numero: row.numero_nf,
        status: row.status,
        ambiente: row.ambiente
      })
    ),
    ...(nfseRes.data || []).map(
      (row): NotaParaElegibilidade => ({
        tipo: "NFSE",
        numero: row.numero_nfse,
        status: row.status,
        ambiente: row.ambiente
      })
    )
  ];

  const dossie: DossieCancelamento = {
    cobranca: {
      id: pagamento.id,
      id_int: pagamento.id_int,
      id_pagamento: pagamento.id_pagamento,
      status: pagamento.status,
      confirmado: pagamento.confirmado,
      tipo_cobranca: pagamento.tipo_cobranca,
      paid_at: pagamento.paid_at,
      data_confirmacao: pagamento.data_confirmacao
    },
    proposta: propostaRes.data ?? null,
    titulos,
    notas,
    vinculoAmbiguo
  };

  return { ok: true, veredito: avaliarCancelamento(dossie, aplicaveis), dossie, pagamento };
}
