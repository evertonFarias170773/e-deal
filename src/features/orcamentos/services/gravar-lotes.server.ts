/**
 * As ESCRITAS da rota `POST /api/pedidos/lotes-em-massa`: remover lotes, gravar
 * a quantidade do item, alterar e incluir lotes — nesta ordem.
 *
 * Mora fora do arquivo da rota para ser testada com um cliente falso
 * (scripts/testes/lotes-gravacao-ordem.test.mts): arquivo de rota do App Router
 * só pode exportar os handlers.
 *
 * A ORDEM (07/10/2026)
 *   1. REMOÇÕES, num comando só (`DELETE ... WHERE id IN (...)`): o banco apaga
 *      todos ou nenhum. Se falhar, NADA foi gravado — a quantidade do item nem
 *      foi tocada.
 *   2. Quantidade do item, só quando a soma dos lotes mudou.
 *   3. Alterações, lote a lote, e inclusões, num insert só — como sempre.
 *
 *   Antes a quantidade vinha primeiro. No pedido 23063 a remoção falhou depois
 *   dela: o item ficou com a quantidade nova, o valor da proposta mudou (os
 *   gatilhos de `produtos_proposta` recalculam na hora) e o lote continuou lá.
 *   Não existe regra de saldo no banco que peça a quantidade antes: a
 *   validação de saldo é do serviço do card, e remover lote só diminui a soma.
 *
 * QUANDO FALHA DEPOIS DA QUANTIDADE
 *   Não há transação entre as chamadas. Se uma alteração ou inclusão falha com
 *   a quantidade já gravada, a quantidade VOLTA ao valor anterior (segunda
 *   gravação), a proposta é reconsolidada pela mesma regra da rota e o valor é
 *   conferido contra o que estava antes. A resposta diz o que ficou: o que já
 *   tinha sido removido ou alterado continua assim.
 *
 * RESERVA DE QR (controle de acesso de ingresso)
 *   Modelo com reserva de QR do parceiro não pode ser apagado: a chave
 *   estrangeira `producao_acesso_*` recusa (23503). A tela recebe um texto de
 *   gente, com o modelo; o texto do banco vai só para o log. Esta rota não lê
 *   nem escreve nas tabelas do parceiro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anularColunasEscondidas,
  omitirColunasEscondidas,
  type ChecklistVisivel
} from "@/features/orcamentos/lib/checklist-lote";

/** Espelha STATUS_INICIAL_MODELO de orcamento-utils: lote novo nasce pendente. */
const STATUS_INICIAL_MODELO = "PENDENTE";

export type LoteParaGravar = {
  /** `pedidos_modelos.id` quando a linha já existe; ausente = lote novo. */
  id?: number | null;
  nome_modelo: string;
  quantidade: number;
  padrao?: string | null;
  tipo_numeracao?: string | null;
  numeracao_inicio?: number | null;
  numeracao_fim?: number | null;
  verso_tipo?: string | null;
  bloco?: string | null;
  gabarito_operacional?: string | null;
  variacoes_texto?: string | null;
  Q_CAM?: number | null;
  L_CAM?: number | null;
  C_INI?: number | null;
  mapa_teatro_id?: string | null;
  mapa_teatro_setor_id?: string | null;
};

type ErroDoBanco = { code?: string | null; message?: string | null; details?: string | null } | null | undefined;

export type FalhaDaGravacao = {
  ok: false;
  code: string;
  message: string;
  status: number;
  extra?: Record<string, unknown>;
};

export type EntradaDaGravacao<V extends object> = {
  idInt: number;
  idProdutoProposta: number;
  lotes: LoteParaGravar[];
  removerIds: number[];
  /** Vínculo de Mapa de Teatro já resolvido pela rota, por lote novo. */
  vinculos: Map<LoteParaGravar, V>;
  visivel: ChecklistVisivel;
  qtdAtual: number;
  soma: number;
  agora: string;
  /** Regrava `valor` e `valor_total` pela regra da rota; usado ao devolver a quantidade. */
  reconsolidar: () => Promise<unknown>;
  registrar?: (mensagem: string, detalhe?: unknown) => void;
};

/* ------------------------------------------------------------ reserva de QR */

export const TEXTO_RESERVA_DE_QR =
  "Este modelo tem QR de controle de acesso reservado e não pode ser excluído por aqui. Peça a liberação ao parceiro e depois exclua o lote.";

/** O nome da chave estrangeira violada, tirado do texto do banco. */
export function chaveVioladaDoErro(erro: ErroDoBanco): string | null {
  const achado = /foreign key constraint "([^"]+)"/i.exec(String(erro?.message ?? ""));
  return achado ? achado[1] : null;
}

/** Violação de chave estrangeira (23503) de uma chave do módulo de acesso por QR. */
export function ehReservaDeQr(erro: ErroDoBanco): boolean {
  if (String(erro?.code ?? "") !== "23503") return false;
  return (chaveVioladaDoErro(erro) ?? "").toLowerCase().startsWith("producao_acesso_");
}

/** Os ids que o banco cita no detalhe do erro ("Key (id)=(1001950) is still referenced..."). */
export function idsCitadosNoErro(erro: ErroDoBanco): number[] {
  const ids: number[] = [];
  const padrao = /\(id\)=\((\d+)\)/g;
  let achado: RegExpExecArray | null;
  while ((achado = padrao.exec(String(erro?.details ?? ""))) !== null) ids.push(Number(achado[1]));
  return ids;
}

export type ModeloBloqueado = { id: number; nome: string | null };

/**
 * O texto que a tela mostra. `certeza` é falso quando o banco não disse qual
 * modelo: aí a lista é de todos os que estavam sendo removidos.
 */
export function mensagemDeReservaDeQr(modelos: ModeloBloqueado[], certeza: boolean, outrosNaRemocao: number): string {
  const lista = modelos.map((m) => `#${m.id}${m.nome ? ` ${m.nome}` : ""}`).join("; ");
  const quais = !lista
    ? ""
    : certeza
      ? ` ${modelos.length > 1 ? "Modelos bloqueados" : "Modelo bloqueado"}: ${lista}.`
      : ` Um ou mais destes modelos estão bloqueados: ${lista}.`;
  const outros = certeza && outrosNaRemocao > 0 ? " Os outros lotes marcados para remoção também não foram removidos." : "";
  return `${TEXTO_RESERVA_DE_QR}${quais}${outros} Nada foi gravado.`;
}

/* ------------------------------------------------------------------ apoio */

function reais(valor: number | null): string {
  return valor === null ? "valor não lido" : `R$ ${valor.toFixed(2).replace(".", ",")}`;
}

type ValoresDaProposta = { valor: number | null; valorTotal: number | null };

async function lerValoresDaProposta(supabase: SupabaseClient, idInt: number): Promise<ValoresDaProposta | null> {
  const { data, error } = await supabase
    .from("propostas")
    .select("valor, valor_total")
    .eq("id_int", idInt)
    .maybeSingle<{ valor: number | string | null; valor_total: number | string | null }>();
  if (error || !data) return null;
  const numero = (v: number | string | null) => (v === null || v === undefined ? null : Number(v));
  return { valor: numero(data.valor), valorTotal: numero(data.valor_total) };
}

const mesmoValor = (a: number | null, b: number | null) =>
  a !== null && b !== null && Math.round(a * 100) === Math.round(b * 100);

/* --------------------------------------------------------------- a gravação */

export async function gravarLotesDoItem<V extends object>(
  supabase: SupabaseClient,
  entrada: EntradaDaGravacao<V>
): Promise<{ ok: true } | FalhaDaGravacao> {
  const { idInt, idProdutoProposta, lotes, removerIds, vinculos, visivel, qtdAtual, soma, agora } = entrada;
  const registrar = entrada.registrar ?? ((mensagem: string, detalhe?: unknown) => console.error(mensagem, detalhe));

  // 1. REMOÇÕES primeiro, num comando só: todos ou nenhum.
  if (removerIds.length > 0) {
    const { error: erroRemover } = await supabase
      .from("pedidos_modelos")
      .delete()
      .in("id", removerIds)
      .eq("id_produto_proposta_origem", idProdutoProposta);

    if (erroRemover) {
      registrar(`[lotes-em-massa] remocao recusada na proposta ${idInt}, item ${idProdutoProposta}, ids ${removerIds.join(",")}:`, erroRemover);

      if (ehReservaDeQr(erroRemover)) {
        const citados = idsCitadosNoErro(erroRemover).filter((id) => removerIds.includes(id));
        const certeza = citados.length > 0 || removerIds.length === 1;
        const idsBloqueados = citados.length > 0 ? citados : removerIds;
        const { data: nomes } = await supabase
          .from("pedidos_modelos")
          .select("id, nome_modelo")
          .in("id", idsBloqueados)
          .returns<{ id: number; nome_modelo: string | null }[]>();
        const modelos: ModeloBloqueado[] = idsBloqueados.map((id) => ({
          id,
          nome: (nomes || []).find((n) => Number(n.id) === id)?.nome_modelo ?? null
        }));
        return {
          ok: false,
          code: "RESERVA_QR",
          message: mensagemDeReservaDeQr(modelos, certeza, removerIds.length - modelos.length),
          status: 409,
          extra: { modelosBloqueados: modelos, nadaGravado: true }
        };
      }

      return {
        ok: false,
        code: "REMOCAO_FALHOU",
        message: "Não foi possível remover os lotes. Nada foi gravado.",
        status: 500,
        extra: { nadaGravado: true }
      };
    }
  }
  const removidos = removerIds.length;

  // 2. Quantidade do item — SÓ QUANDO A SOMA MUDOU DE FATO (decisão do dono,
  //    23/09/2026): a lista rápida grava a cada campo, e regravar a mesma
  //    quantidade dispararia os gatilhos de produtos_proposta (status
  //    financeiro, totais) sem nada ter mudado.
  let quantidadeGravada = false;
  let valoresAntes: ValoresDaProposta | null = null;
  if (soma !== qtdAtual) {
    valoresAntes = await lerValoresDaProposta(supabase, idInt);
    const { error: erroQtd } = await supabase
      .from("produtos_proposta")
      .update({ qtd: soma })
      .eq("id", idProdutoProposta)
      .eq("id_int", idInt);

    if (erroQtd) {
      registrar(`[lotes-em-massa] quantidade do item ${idProdutoProposta} nao gravada:`, erroQtd);
      if (removidos > 0) {
        return {
          ok: false,
          code: "PARCIAL",
          message: `${removidos} lote(s) foram removidos, mas a quantidade do item não foi gravada: continua em ${qtdAtual}. Grave de novo para acertar a quantidade.`,
          status: 500,
          extra: { lotesRemovidos: removidos, quantidadeGravada: false }
        };
      }
      return { ok: false, code: "INTERNO", message: "Não foi possível gravar a quantidade do item. Nada foi gravado.", status: 500, extra: { nadaGravado: true } };
    }
    quantidadeGravada = true;
  }

  /** Falha depois da quantidade: devolve a quantidade e diz o que ficou. */
  const desfazer = async (oQueFalhou: string, alterados: number): Promise<FalhaDaGravacao> => {
    const jaFeito =
      removidos > 0 || alterados > 0
        ? ` O que já tinha sido gravado continua: ${removidos} lote(s) removido(s) e ${alterados} alterado(s).`
        : "";
    const extra: Record<string, unknown> = { lotesRemovidos: removidos, lotesAlterados: alterados };

    if (!quantidadeGravada) {
      return {
        ok: false,
        code: "PARCIAL",
        message: `${oQueFalhou} A quantidade do item não mudou (${qtdAtual}).${jaFeito}`,
        status: 500,
        extra: { ...extra, quantidadeDevolvida: null }
      };
    }

    const { error: erroVolta } = await supabase
      .from("produtos_proposta")
      .update({ qtd: qtdAtual })
      .eq("id", idProdutoProposta)
      .eq("id_int", idInt);

    if (erroVolta) {
      registrar(`[lotes-em-massa] quantidade do item ${idProdutoProposta} NAO devolvida a ${qtdAtual}:`, erroVolta);
      return {
        ok: false,
        code: "PARCIAL",
        message: `${oQueFalhou} A quantidade do item ficou em ${soma} e não pôde ser devolvida a ${qtdAtual}: confira a quantidade e o valor da proposta.${jaFeito}`,
        status: 500,
        extra: { ...extra, quantidadeDevolvida: false, valorConferido: false }
      };
    }

    // A quantidade voltou: a proposta é regravada pela regra da rota e conferida.
    await entrada.reconsolidar().catch((erro) => registrar(`[lotes-em-massa] reconsolidacao da proposta ${idInt} falhou:`, erro));
    const valoresDepois = await lerValoresDaProposta(supabase, idInt);
    const voltou =
      valoresAntes !== null &&
      valoresDepois !== null &&
      mesmoValor(valoresAntes.valor, valoresDepois.valor) &&
      mesmoValor(valoresAntes.valorTotal, valoresDepois.valorTotal);
    const sobreOValor = voltou
      ? `o valor da proposta voltou a ${reais(valoresDepois!.valorTotal)}.`
      : `o valor da proposta ficou em ${reais(valoresDepois?.valorTotal ?? null)} (antes era ${reais(valoresAntes?.valorTotal ?? null)}): confira.`;
    if (!voltou) registrar(`[lotes-em-massa] valor da proposta ${idInt} nao voltou apos devolver a quantidade:`, { valoresAntes, valoresDepois });

    return {
      ok: false,
      code: "PARCIAL",
      message: `${oQueFalhou} A quantidade do item voltou para ${qtdAtual} e ${sobreOValor}${jaFeito}`,
      status: 500,
      extra: { ...extra, quantidadeDevolvida: true, valorConferido: voltou }
    };
  };

  // 3. Lotes existentes: UPDATE campo a campo, nunca apagar e recriar — os
  //    status de arte e produção e as amostras vivem nessas linhas.
  let alterados = 0;
  for (const lote of lotes.filter((l) => Number.isFinite(Number(l.id)) && Number(l.id) > 0)) {
    // Coluna que o produto nao imprime SAI do patch: o valor gravado no lote
    // fica como esta. As demais seguem a montagem de sempre.
    const patch = omitirColunasEscondidas(
      {
        nome_modelo: String(lote.nome_modelo).trim(),
        quantidade: Number(lote.quantidade),
        padrao: lote.padrao?.trim() || null,
        tipo_numeracao: lote.tipo_numeracao || "SEM_NUMERACAO",
        numeracao_inicio: lote.numeracao_inicio ?? null,
        numeracao_fim: lote.numeracao_fim ?? null,
        verso_tipo: lote.verso_tipo?.trim() || null,
        bloco: lote.bloco?.trim() || null,
        gabarito_operacional: lote.gabarito_operacional?.trim() || null,
        variacoes_texto: lote.variacoes_texto?.trim() || null,
        Q_CAM: lote.Q_CAM ?? null,
        L_CAM: lote.L_CAM ?? null,
        C_INI: lote.C_INI ?? null,
        updated_at: agora
      },
      visivel
    );

    const { error: erroUpdate } = await supabase
      .from("pedidos_modelos")
      .update(patch)
      .eq("id", Number(lote.id))
      .eq("id_produto_proposta_origem", idProdutoProposta);

    if (erroUpdate) {
      registrar(`[lotes-em-massa] lote ${lote.id} nao alterado:`, erroUpdate);
      return desfazer(`O lote "${lote.nome_modelo}" não foi alterado.`, alterados);
    }
    alterados += 1;
  }

  // 4. Lotes novos, em um insert só.
  const novos = lotes.filter((l) => !Number.isFinite(Number(l.id)) || Number(l.id) <= 0);
  if (novos.length > 0) {
    const { data: maiorOrdem } = await supabase
      .from("pedidos_modelos")
      .select("ordem")
      .eq("id_int", idInt)
      .order("ordem", { ascending: false })
      .limit(1)
      .returns<{ ordem: number | null }[]>();

    let proximaOrdem = (maiorOrdem && maiorOrdem[0] ? Number(maiorOrdem[0].ordem) || 0 : 0) + 1;

    // Coluna que o produto nao imprime nasce NULL — inclusive tipo_numeracao,
    // que nao vira "SEM_NUMERACAO" quando escondido. O valor que a requisicao
    // mandou nessas colunas e descartado.
    const { error: erroInsert } = await supabase.from("pedidos_modelos").insert(
      novos.map((lote) => {
        // Setor de Mapa de Teatro: o vinculo resolvido pela rota, e sem
        // numeracao gerada. Lote comum nao ganha nenhuma dessas chaves.
        const vinculo = vinculos.get(lote);
        return {
          ...anularColunasEscondidas(
            {
              id_int: idInt,
              id_produto_proposta_origem: idProdutoProposta,
              nome_modelo: String(lote.nome_modelo).trim(),
              padrao: lote.padrao?.trim() || null,
              quantidade: Number(lote.quantidade),
              tipo_numeracao: lote.tipo_numeracao || "SEM_NUMERACAO",
              numeracao_inicio: lote.numeracao_inicio ?? null,
              numeracao_fim: lote.numeracao_fim ?? null,
              verso_tipo: lote.verso_tipo?.trim() || null,
              bloco: lote.bloco?.trim() || null,
              gabarito_operacional: lote.gabarito_operacional?.trim() || null,
              variacoes_texto: lote.variacoes_texto?.trim() || null,
              Q_CAM: lote.Q_CAM ?? null,
              L_CAM: lote.L_CAM ?? null,
              C_INI: lote.C_INI ?? null,
              status_arte: STATUS_INICIAL_MODELO,
              status_producao: STATUS_INICIAL_MODELO,
              ordem: proximaOrdem++,
              created_at: agora,
              updated_at: agora
            },
            visivel
          ),
          ...(vinculo ? { ...vinculo, numeracao_inicio: null, numeracao_fim: null } : {})
        };
      })
    );

    if (erroInsert) {
      registrar(`[lotes-em-massa] lotes novos nao incluidos na proposta ${idInt}:`, erroInsert);
      return desfazer(`Os ${novos.length} lote(s) novo(s) não foram incluídos.`, alterados);
    }
  }

  return { ok: true };
}
