/**
 * As DANFEs que um pedido tem para baixar.
 *
 * PARENTE PRÓXIMO, DE PROPÓSITO SEPARADO: `escolherNotaAutorizadaDoPedido`
 * responde "qual nota REPRESENTA o pedido" — uma só, e nunca a remessa. Esta
 * função responde outra pergunta: "o que dá para BAIXAR". São todas, inclusive a
 * remessa, porque a remessa é documento fiscal que acompanha a mercadoria e o
 * operador precisa dela em mãos. Unificar as duas apagaria a diferença: a nota
 * do pedido é uma escolha, a lista de DANFEs é um inventário.
 *
 * O RECORTE É O MESMO da nota do pedido em tudo o mais: só AUTORIZADA, só de
 * PRODUÇÃO, só com número. Homologação é teste — DANFE de teste na mão do
 * operador é pior que nenhuma.
 *
 * E só com link: `url_danfe` é o arquivo na Focus, e sem ele não há o que
 * baixar. Uma linha sem link no menu seria um item que não faz nada. Em
 * 16/09/2026 nenhuma das 16 autorizadas de produção está nessa situação.
 */

/** O mínimo que uma linha de `notas_fiscais` precisa expor para virar DANFE. */
export type NotaParaDanfe = {
  ref?: string | null;
  numero_nf?: number | string | null;
  tipo_nota?: string | null;
  status?: string | null;
  ambiente?: string | null;
  data_autorizacao?: string | null;
  created_at?: string | null;
  url_danfe?: string | null;
};

/** Uma DANFE pronta para virar item de menu. */
export type DanfeDoPedido = {
  ref: string;
  numero: string;
  /** "NF venda", "NF complementar" ou "NF remessa". */
  rotulo: string;
  url: string;
};

const emMilissegundos = (valor: unknown): number => Date.parse(String(valor ?? "")) || 0;

const ehRemessa = (nota: NotaParaDanfe) =>
  String(nota.tipo_nota ?? "").trim().toUpperCase() === "REMESSA";

/**
 * O que acrescentar ao SELECT, ALÉM de `COLUNAS_NOTA_DO_PEDIDO`.
 *
 * As duas se compõem — `select(\`id_int, ${COLUNAS_NOTA_DO_PEDIDO}, ${COLUNAS_DANFE_DO_PEDIDO}\`)` —
 * em vez de uma repetir a outra: coluna pedida duas vezes no PostgREST é
 * pedra no caminho de quem for ler a consulta depois.
 */
export const COLUNAS_DANFE_DO_PEDIDO = "ref, url_danfe";

/**
 * As DANFEs do pedido, da mais antiga para a mais nova.
 *
 * COMO VENDA E COMPLEMENTAR SE DISTINGUEM
 *   Não existe campo que diga "esta é a complementar" — e não precisa existir. O
 *   pedido tem uma primeira venda e as seguintes; em ordem de autorização, a
 *   primeira venda autorizada é "NF venda" e as outras são "NF complementar".
 *   `data_autorizacao` é o critério, com `created_at` desempatando — o mesmo par,
 *   na mesma ordem, que `escolherNotaAutorizadaDoPedido` usa para achar a mais
 *   recente. Aqui a leitura é ao contrário: a mais ANTIGA é a original.
 *
 *   Consequência que vale saber: se a primeira venda for CANCELADA, ela sai da
 *   lista (não é mais autorizada) e a seguinte passa a ser lida como "NF venda".
 *   É o certo — cancelada não é a nota original de nada.
 */
export function danfesDoPedido(notas: readonly NotaParaDanfe[] | null | undefined): DanfeDoPedido[] {
  const disponiveis = (notas ?? [])
    .filter(
      (nota) =>
        String(nota.status ?? "").toUpperCase() === "AUTORIZADA" &&
        String(nota.ambiente ?? "").trim().toUpperCase() === "PRODUCAO" &&
        String(nota.numero_nf ?? "").trim() !== "" &&
        String(nota.url_danfe ?? "").trim() !== ""
    )
    .sort((a, b) => {
      const autorizacao = emMilissegundos(a.data_autorizacao) - emMilissegundos(b.data_autorizacao);
      if (autorizacao !== 0) return autorizacao;
      const criacao = emMilissegundos(a.created_at) - emMilissegundos(b.created_at);
      if (criacao !== 0) return criacao;
      return String(a.ref ?? "").localeCompare(String(b.ref ?? ""));
    });

  let vendasVistas = 0;
  return disponiveis.map((nota) => {
    let rotulo: string;
    if (ehRemessa(nota)) {
      rotulo = "NF remessa";
    } else {
      vendasVistas += 1;
      rotulo = vendasVistas === 1 ? "NF venda" : "NF complementar";
    }
    return {
      ref: String(nota.ref ?? "").trim(),
      numero: String(nota.numero_nf ?? "").trim(),
      rotulo,
      url: String(nota.url_danfe ?? "").trim()
    };
  });
}

/** O texto de um item do submenu: "NF venda - nº 7501 (NFE-22066-001)". */
export function rotuloDaDanfe(danfe: DanfeDoPedido): string {
  return `${danfe.rotulo} - nº ${danfe.numero}${danfe.ref ? ` (${danfe.ref})` : ""}`;
}
