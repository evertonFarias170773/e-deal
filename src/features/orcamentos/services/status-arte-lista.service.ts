import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Status da arte exibido na lista de Orcamentos (coluna "Status Arte") e no
 * cabecalho do pedido.
 *
 * E `public.pedidos_artes.status`, CRU. Desde 13/09/2026 as duas telas leem o
 * valor gravado, e nenhuma deriva nada.
 *
 * O QUE SAIU, E POR QUE ISTO E UMA DECISAO DO DONO
 *   Ate 13/09 o que se exibia era um ESTAGIO derivado de
 *   `pedidos_modelos.status_arte`, com o modelo mais atrasado vencendo. A troca
 *   foi decidida sabendo de um custo concreto: em 13/09 havia 8 pedidos com
 *   `pedidos_artes.status = APROVADO` e modelos que o cliente reprovou ou nunca
 *   aprovou — cinco deles em producao. A derivacao os mostrava como EM ALTERACAO
 *   ou AGUARDANDO_APROVACAO; o valor cru os mostra como APROVADO. Quem precisar
 *   do estagio por modelo le `pedidos_modelos` na aba do pedido.
 *
 * AS DUAS TELAS LEEM A MESMA COLUNA, e por isso nao tem como discordar. Esse era
 *   o motivo de a derivacao morar num lugar so; o motivo continua valendo para a
 *   leitura, e por isso ela tambem mora num lugar so.
 *
 * `pedidos_artes` TEM UMA LINHA POR PEDIDO. Medido em 13/09/2026: 110 linhas,
 *   110 pedidos, nenhum com duas. Se um dia houver mais de uma, vale a mais
 *   recente por `created_at` — o mesmo criterio de `check_and_promote_proposta`,
 *   para a tela nao contradizer a promocao do banco.
 *
 * SOMENTE LEITURA. Nao escreve em `pedidos_artes`, `pedidos_modelos` nem
 * `propostas`, e nao encosta em `check_and_promote_proposta` nem nos triggers.
 */

/**
 * A chave de comparacao: sem caixa e sem acento.
 *
 * A tabela mistura grafias — "EM ARTE" convive com "Em Alteração" e com
 * "Dados Pendentes". Comparar o texto como vem faria "Em Alteração" e
 * "EM ALTERACAO" serem coisas diferentes, e a cor e o botao sumiriam na
 * primeira vez que alguem gravasse com outra caixa.
 */
function chave(status: string | null | undefined): string {
  return String(status ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

type Tom = "verde" | "laranja" | "vermelho" | "azul" | "neutro";

/** O tom de cada status conhecido, pela chave normalizada. Decisao do dono. */
const TOM_POR_STATUS: Record<string, Tom> = {
  APROVADO: "verde",
  "EM APROVACAO": "laranja",
  "APR PARCIAL": "laranja",
  "EM ALTERACAO": "vermelho",
  "CORRIGIR DADOS": "vermelho",
  "EM ARTE": "azul",
  "ENVIAR ARTE": "azul",
  "DADOS PENDENTES": "azul"
};

/** Mesmo formato do `StatusBadge`: borda, fundo e texto. */
const CLASSE_POR_TOM: Record<Tom, string> = {
  verde: "border-teal-200 bg-teal-50 text-teal-700",
  laranja: "border-orange-200 bg-orange-50 text-orange-700",
  vermelho: "border-red-200 bg-red-50 text-red-700",
  azul: "border-sky-200 bg-sky-50 text-sky-800",
  neutro: "border-slate-200 bg-slate-50 text-slate-600"
};

/**
 * A classe do selo. Vazio e valor desconhecido caem em NEUTRO — um status novo
 * gravado por fora aparece, sem cor, em vez de sumir ou de herdar a cor errada.
 */
export function classeDoStatusArte(status: string | null | undefined): string {
  return CLASSE_POR_TOM[TOM_POR_STATUS[chave(status)] ?? "neutro"];
}

/**
 * Os status em que ha algo COM O CLIENTE, e so neles o botao "Abrir o painel do
 * cliente" faz sentido. Decisao do dono. Aprovado, em arte e dados pendentes
 * ficam de fora: nao ha nada para o cliente olhar ou decidir.
 */
const STATUS_COM_LINK_DO_CLIENTE = new Set(["EM APROVACAO", "APR PARCIAL", "EM ALTERACAO", "CORRIGIR DADOS"]);

export function statusArteTemLinkDoCliente(status: string | null | undefined): boolean {
  return STATUS_COM_LINK_DO_CLIENTE.has(chave(status));
}

/** Texto a exibir: o gravado, so aparado. Vazio vira `null` — celula e selo vazios. */
function textoExibido(status: string | null | undefined): string | null {
  const texto = String(status ?? "").trim();
  return texto ? texto : null;
}

/**
 * Status da arte das propostas da PAGINA da lista, numa consulta so.
 *
 * Nunca por linha: roda uma vez com os `id_int` da pagina, no mesmo molde de
 * `buscarLinksClienteDasPropostas` logo abaixo. Pedido sem linha em
 * `pedidos_artes` simplesmente nao aparece no mapa — e a celula fica vazia.
 */
export async function buscarStatusArteDasPropostas(idInts: number[]): Promise<Record<number, string>> {
  const client = getSupabaseClient();
  const ids = Array.from(new Set(idInts.filter((n) => Number.isFinite(n) && n > 0)));
  if (!client || ids.length === 0) return {};

  const { data, error } = await client
    .from("pedidos_artes")
    .select("id_int, status, created_at")
    .in("id_int", ids)
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("[status-arte-lista] Erro ao ler pedidos_artes:", error.message);
    return {};
  }

  // Ordem crescente: a ultima escrita vence, que e a linha mais recente.
  const resultado: Record<number, string> = {};
  for (const linha of data ?? []) {
    const id = Number(linha.id_int);
    const texto = textoExibido(linha.status);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (texto) resultado[id] = texto;
    else delete resultado[id];
  }
  return resultado;
}

/**
 * Status da arte de UM pedido, para o cabecalho. Uma consulta na abertura.
 *
 * `null` quando nao ha linha ou ela esta vazia — e nenhum selo aparece.
 */
export async function buscarStatusArteDaProposta(idInt: number): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client || !Number.isFinite(idInt) || idInt <= 0) return null;

  const { data, error } = await client
    .from("pedidos_artes")
    .select("status")
    .eq("id_int", idInt)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[status-arte-lista] Erro ao ler pedidos_artes do pedido:", error.message);
    return null;
  }
  return textoExibido((data as { status?: string | null } | null)?.status);
}

/**
 * Link do painel do cliente das propostas exibidas na lista de Orcamentos.
 *
 * A URL e ABSOLUTA e mora pronta em `pedidos_links_cliente.link` (todas as 77
 * linhas apontam para https://ideal-imposition.vercel.app/cliente/<numero>-<token>).
 * Nada de montar dominio aqui: o link e gerado por outro sistema, e remontar a
 * URL neste lado significaria duplicar uma regra que nao e nossa.
 *
 * `ativo = false` E REVOGACAO. A coluna existe com default true e hoje as 77
 * linhas estao true, mas o filtro fica: no dia em que alguem revogar um link, o
 * botao tem de sumir junto — sem o filtro, a lista continuaria oferecendo um
 * acesso que o negocio ja cortou. Nao ha coluna de validade/expiracao.
 *
 * `id_int` E TEXT nesta tabela (nas outras e integer), por isso o `.in` recebe
 * os ids convertidos para string. Passar numero aqui devolve zero linhas em
 * silencio.
 *
 * ACESSO: `authenticated` tem SELECT (relacl `authenticated=arw`) e a policy
 * "painel logado usa a tabela" e `USING (true)`. `anon` NAO tem grant nenhum —
 * e dai o 401 da requisicao anonima. Sem sessao a consulta falha, o mapa volta
 * vazio e os botoes apenas nao aparecem; nenhuma linha quebra.
 *
 * SOMENTE LEITURA. Nao escreve, nao gera link e nao mexe em policy ou grant.
 */
export async function buscarLinksClienteDasPropostas(
  idInts: number[]
): Promise<Record<number, string>> {
  const client = getSupabaseClient();
  const ids = Array.from(new Set(idInts.filter((n) => Number.isFinite(n) && n > 0)));
  if (!client || ids.length === 0) return {};

  const { data, error } = await client
    .from("pedidos_links_cliente")
    .select("id_int, link")
    .eq("ativo", true)
    .in("id_int", ids.map(String));

  if (error) {
    // So a mensagem do erro. O payload nunca entra no log: ele carrega as URLs
    // com token, e o console do navegador e um lugar por onde link vaza.
    console.warn("[status-arte-lista] Erro ao ler pedidos_links_cliente:", error.message);
    return {};
  }

  const resultado: Record<number, string> = {};
  for (const linha of data ?? []) {
    const id = Number(linha.id_int);
    const link = String(linha.link ?? "").trim();
    if (!Number.isFinite(id) || id <= 0 || !link) continue;
    resultado[id] = link;
  }
  return resultado;
}
