/**
 * Checklist do boletim por produto — leitura e gravacao de
 * `public.produto_boletim_campos`.
 *
 * O QUE E
 *   A tabela decide quais campos OPCIONAIS o card do boletim imprime para cada
 *   produto. A presenca da linha e o "marcado" — nao ha coluna de valor. Nome
 *   do produto, quantidade e nome do modelo sao obrigatorios e nao passam por
 *   aqui.
 *
 * POR QUE ESTE ARQUIVO E NAO O DE VARIACOES
 *   Mesmo padrao, tabela diferente: escrita direto do navegador, com a sessao
 *   do usuario (`getSupabaseClient`), nunca com service_role. A RLS da tabela
 *   ja cobre `authenticated` nos quatro comandos.
 *
 * SOBRE A GRAVACAO
 *   Diff, nao "apaga tudo e reinsere": so o que saiu e apagado e so o que
 *   entrou e inserido. Campo que ja estava marcado nao gera escrita nenhuma,
 *   entao salvar o produto sem mexer no checklist nao toca na tabela.
 */
import { getSupabaseClient } from "@/lib/supabase/client";

/** Os sete campos opcionais, na ordem em que a tela os mostra. */
export const CAMPOS_BOLETIM = [
  {
    campo: "variacoes",
    label: "Variações",
    ajuda: "Uma linha por variação escolhida na venda, no formato GRUPO: opção."
  },
  { campo: "cor", label: "Cor", ajuda: "A cor do lote, definida no PCP." },
  {
    campo: "num_gabarito",
    label: "NUM",
    ajuda: "O gabarito operacional do lote — é o que o card mostra sob o rótulo NUM."
  },
  {
    campo: "numeracao_faixa",
    label: "Número inicial e final",
    ajuda: "A faixa numérica do lote."
  },
  {
    campo: "impressao_fv",
    label: "Impressão (Frente / Frente e Verso)",
    ajuda: "Se a peça é impressa só na frente ou nos dois lados."
  },
  {
    campo: "tipo_numeracao",
    label: "Tipo (Sequencial / Aleatório)",
    ajuda: "Como a numeração corre dentro do lote."
  },
  {
    campo: "imagem",
    label: "Imagem do modelo",
    ajuda: "A arte do lote. Em produto de prateleira, a prévia da cor."
  }
] as const;

export type CampoBoletim = (typeof CAMPOS_BOLETIM)[number]["campo"];

const CAMPOS_VALIDOS = new Set<string>(CAMPOS_BOLETIM.map((c) => c.campo));

/**
 * A MESMA regra que o trigger `trg_produto_boletim_campos_padrao` aplica no
 * banco quando um produto e criado — repetida aqui so para a tela poder MOSTRAR
 * o que o produto novo vai receber antes de ele existir.
 *
 * `variacoes` entra quando o produto tem variacao vinculada (decisao 5 do
 * dono). O trigger nao consegue faze-lo, porque o vinculo em
 * `produto_variacoes` so e gravado depois do insert do produto — quem fecha
 * essa lacuna e esta tela (decisao 7, opcao (a)).
 */
export function checklistPadraoDoProduto(entrada: {
  isEstoque: boolean;
  temVariacao: boolean;
}): CampoBoletim[] {
  const base: CampoBoletim[] = entrada.isEstoque
    ? ["cor", "imagem"]
    : ["cor", "num_gabarito", "numeracao_faixa", "impressao_fv", "tipo_numeracao", "imagem"];

  return entrada.temVariacao ? [...base, "variacoes"] : base;
}

/** Os campos marcados de um produto. Lista vazia = nenhum opcional impresso. */
export async function listProdutoBoletimCampos(idProduto: number): Promise<CampoBoletim[]> {
  const client = getSupabaseClient();
  if (!client || !Number.isInteger(idProduto) || idProduto <= 0) return [];

  const { data, error } = await client
    .from("produto_boletim_campos")
    .select("campo")
    .eq("id_produto", idProduto);

  if (error) {
    console.error("[ProdutoBoletimCampos] Erro ao ler o checklist:", error.message);
    return [];
  }

  return (data ?? [])
    .map((linha) => String((linha as { campo?: unknown }).campo ?? ""))
    .filter((campo): campo is CampoBoletim => CAMPOS_VALIDOS.has(campo));
}

/**
 * O checklist de VÁRIOS produtos de uma vez, para telas que mostram muitos
 * produtos juntos — o formulário do PCP, por exemplo.
 *
 * Produto que não aparecer no mapa é produto SEM registro de checklist, e quem
 * lê deve tratá-lo como "sem regra": formulário completo, como sempre foi.
 */
export async function listChecklistDeProdutos(
  idsProduto: number[]
): Promise<Map<number, CampoBoletim[]>> {
  const mapa = new Map<number, CampoBoletim[]>();
  const client = getSupabaseClient();

  const ids = Array.from(
    new Set(idsProduto.filter((id) => Number.isInteger(id) && id > 0))
  );
  if (!client || ids.length === 0) return mapa;

  const { data, error } = await client
    .from("produto_boletim_campos")
    .select("id_produto, campo")
    .in("id_produto", ids);

  if (error) {
    console.error("[ProdutoBoletimCampos] Erro ao ler o checklist dos produtos:", error.message);
    return mapa;
  }

  for (const linha of data ?? []) {
    const alvo = linha as { id_produto: number; campo: string };
    const campo = String(alvo.campo);
    if (!CAMPOS_VALIDOS.has(campo)) continue;
    const id = Number(alvo.id_produto);
    const lista = mapa.get(id) ?? [];
    lista.push(campo as CampoBoletim);
    mapa.set(id, lista);
  }

  return mapa;
}

/**
 * Sincroniza o checklist do produto com o que a tela marcou.
 *
 * Best-effort na mesma medida que `saveProdutoVariacoes`: devolve o erro para
 * a tela avisar, sem derrubar o salvamento do produto em si.
 */
export async function saveProdutoBoletimCampos(
  idProduto: number,
  campos: string[]
): Promise<{ success: boolean; message: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, message: "Cliente Supabase indisponível." };
  if (!Number.isInteger(idProduto) || idProduto <= 0) {
    return { success: false, message: "Produto inválido para gravar o checklist do boletim." };
  }

  const alvo = Array.from(new Set(campos.filter((campo) => CAMPOS_VALIDOS.has(campo))));

  const { data: atuaisRows, error: leituraErro } = await client
    .from("produto_boletim_campos")
    .select("id, campo")
    .eq("id_produto", idProduto);

  if (leituraErro) {
    return { success: false, message: "Falha ao ler o checklist atual: " + leituraErro.message };
  }

  const atuais = (atuaisRows ?? []) as { id: number; campo: string }[];
  const atuaisSet = new Set(atuais.map((linha) => linha.campo));

  const paraApagar = atuais.filter((linha) => !alvo.includes(linha.campo)).map((linha) => linha.id);
  const paraInserir = alvo
    .filter((campo) => !atuaisSet.has(campo))
    .map((campo) => ({ id_produto: idProduto, campo }));

  if (paraApagar.length > 0) {
    const { error } = await client.from("produto_boletim_campos").delete().in("id", paraApagar);
    if (error) {
      return { success: false, message: "Falha ao desmarcar campos do boletim: " + error.message };
    }
  }

  if (paraInserir.length > 0) {
    const { error } = await client.from("produto_boletim_campos").insert(paraInserir);
    if (error) {
      return { success: false, message: "Falha ao marcar campos do boletim: " + error.message };
    }
  }

  return { success: true, message: "Checklist do boletim sincronizado." };
}
