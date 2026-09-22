/**
 * Snapshot do checklist do boletim no item da proposta — Etapa 4 da reforma
 * (docs/superpowers/plans/2026-09-22-boletim-checklist-por-produto.md).
 *
 * O QUE FAZ
 *   Quando o `saveProposta` CRIA um item, copia para
 *   `produtos_proposta_boletim_campos` os campos que o produto tem marcados hoje
 *   em `produto_boletim_campos` e carimba
 *   `produtos_proposta.boletim_campos_congelado_em`. O boletim passa a imprimir
 *   o que o cadastro mandava NO DIA DA VENDA — mexer no produto amanhã nao muda
 *   o que sai num pedido fechado ontem.
 *
 * OS TRES ESTADOS QUE O CARIMBO SEPARA
 *   carimbo NULO                  -> item sem snapshot: o boletim imprime como
 *                                    sempre imprimiu (todo item anterior a esta
 *                                    etapa fica assim; nao ha backfill)
 *   carimbo PREENCHIDO, 0 linhas  -> o produto nao tem nenhum campo opcional
 *   carimbo PREENCHIDO, N linhas  -> imprime exatamente esses N
 *
 * UMA VEZ SO
 *   Duas travas independentes. A primeira: so o ramo de INSERT do save chama
 *   isto — item que ja existe nunca passa por aqui. A segunda, no banco: o
 *   UPDATE do carimbo leva `.is("boletim_campos_congelado_em", null)`, entao
 *   mesmo que alguem chame isto duas vezes o segundo carimbo nao pega.
 *
 * POR QUE A ORDEM E LINHAS-DEPOIS-CARIMBO, E NUNCA O CONTRARIO
 *   Se as linhas entram e o carimbo falha, o item fica "sem snapshot" e imprime
 *   como hoje — as linhas orfas ficam inertes, ninguem as le. Se o carimbo
 *   entrasse primeiro e as linhas falhassem, o item ficaria "nenhum opcional" e
 *   o boletim sairia vazio de campos, calado. Toda falha parcial tem que cair no
 *   lado que nao muda o que se imprime.
 *
 * NAO E FATAL
 *   Nenhuma funcao daqui lanca. O que importa e a proposta: se o snapshot
 *   falhar, o save segue e o item fica sem carimbo, imprimindo como hoje. O erro
 *   vai para o console do mesmo jeito que o save ja faz com as escritas
 *   secundarias (variacoes_texto dos modelos, por exemplo).
 *
 * SESSAO DO USUARIO
 *   Recebe o mesmo `client` do save — a sessao do usuario, com a RLS valendo.
 *   A tabela tem politica de INSERT para `authenticated`. Nunca service_role.
 */
import { getSupabaseClient } from "@/lib/supabase/client";

type ClienteSupabase = NonNullable<ReturnType<typeof getSupabaseClient>>;

/** Um item recem-criado, pronto para congelar. */
export type ItemNovoParaCongelar = {
  /** `produtos_proposta.id` devolvido pelo INSERT. */
  idItem: number;
  /** `produtos_proposta.id_produto`. 0 ou nulo = linha sem produto de catalogo. */
  idProduto: number | null;
};

export type ResultadoCongelamento = {
  /** Quantos itens receberam carimbo. */
  itensCongelados: number;
  /** Quantas linhas de campo foram gravadas ao todo. */
  linhasGravadas: number;
  /** Itens deixados de fora por nao apontarem para um produto do catalogo. */
  itensSemProduto: number;
  /** Preenchido quando algo falhou; o save NAO e interrompido por isso. */
  falha?: string;
};

/**
 * Congela o checklist dos itens recem-criados de UMA proposta.
 *
 * Tres idas ao banco, independente de quantos itens: le o catalogo dos produtos
 * envolvidos, insere todas as linhas de uma vez e carimba todos os itens de uma
 * vez. Nada e feito quando a lista chega vazia.
 */
export async function congelarChecklistDosItensNovos(
  client: ClienteSupabase,
  itens: ItemNovoParaCongelar[]
): Promise<ResultadoCongelamento> {
  const vazio: ResultadoCongelamento = { itensCongelados: 0, linhasGravadas: 0, itensSemProduto: 0 };
  if (!client || itens.length === 0) return vazio;

  const idsProduto = Array.from(
    new Set(
      itens
        .map((item) => item.idProduto)
        .filter((id): id is number => Number.isInteger(id) && (id as number) > 0)
    )
  );

  if (idsProduto.length === 0) {
    // Nenhum item aponta para produto de catalogo: nada a congelar, e nada a
    // carimbar — linha sem produto continua imprimindo como hoje.
    return { ...vazio, itensSemProduto: itens.length };
  }

  // 1. Quais desses ids sao produto de verdade. Um item com id_produto = 0 (o
  //    default da coluna) ou apontando para produto sumido nao pode ser
  //    carimbado: carimbo com zero linhas significaria "nenhum opcional", e o
  //    certo para ele e continuar como hoje.
  const { data: produtosRows, error: produtosErro } = await client
    .from("produtos")
    .select("id_produto")
    .in("id_produto", idsProduto);

  if (produtosErro) {
    return { ...vazio, falha: "Falha ao conferir os produtos do snapshot: " + produtosErro.message };
  }

  const produtosExistentes = new Set(
    (produtosRows ?? []).map((linha) => Number((linha as { id_produto: number }).id_produto))
  );

  const congelaveis = itens.filter(
    (item) => item.idProduto != null && produtosExistentes.has(Number(item.idProduto))
  );

  if (congelaveis.length === 0) {
    return { ...vazio, itensSemProduto: itens.length };
  }

  // 2. O checklist vivo de cada produto envolvido.
  const { data: campoRows, error: campoErro } = await client
    .from("produto_boletim_campos")
    .select("id_produto, campo")
    .in("id_produto", Array.from(produtosExistentes));

  if (campoErro) {
    return { ...vazio, falha: "Falha ao ler o checklist dos produtos: " + campoErro.message };
  }

  const camposPorProduto = new Map<number, string[]>();
  for (const linha of campoRows ?? []) {
    const alvo = linha as { id_produto: number; campo: string };
    const lista = camposPorProduto.get(Number(alvo.id_produto)) ?? [];
    lista.push(String(alvo.campo));
    camposPorProduto.set(Number(alvo.id_produto), lista);
  }

  // 3. As linhas do snapshot, de todos os itens, num INSERT so.
  const linhas = congelaveis.flatMap((item) =>
    (camposPorProduto.get(Number(item.idProduto)) ?? []).map((campo) => ({
      id_produto_proposta: item.idItem,
      campo
    }))
  );

  if (linhas.length > 0) {
    const { error: insertErro } = await client
      .from("produtos_proposta_boletim_campos")
      .insert(linhas);

    if (insertErro) {
      // Sem carimbo: os itens ficam "sem snapshot" e imprimem como hoje.
      return { ...vazio, falha: "Falha ao gravar o snapshot do boletim: " + insertErro.message };
    }
  }

  // 4. O carimbo, por ultimo e so onde ainda esta nulo.
  const { data: carimbados, error: carimboErro } = await client
    .from("produtos_proposta")
    .update({ boletim_campos_congelado_em: new Date().toISOString() })
    .in("id", congelaveis.map((item) => item.idItem))
    .is("boletim_campos_congelado_em", null)
    .select("id");

  if (carimboErro) {
    return {
      itensCongelados: 0,
      linhasGravadas: linhas.length,
      itensSemProduto: itens.length - congelaveis.length,
      falha: "Falha ao carimbar o congelamento do boletim: " + carimboErro.message
    };
  }

  return {
    itensCongelados: (carimbados ?? []).length,
    linhasGravadas: linhas.length,
    itensSemProduto: itens.length - congelaveis.length
  };
}
