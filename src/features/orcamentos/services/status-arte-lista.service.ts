import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Estagio da arte exibido na coluna "Status Arte" da lista de Orcamentos.
 *
 * NAO e `pedidos_artes.status`. Aquela coluna so sabe dizer aprovado, aprovado
 * parcial ou "EM ARTE" — ela achata num balde so tres situacoes que o
 * atendente precisa distinguir: a arte ainda nem saiu, a arte esta com o
 * cliente, e o cliente pediu mudanca. O estagio real esta um nivel abaixo, em
 * `pedidos_modelos.status_arte`, que ja carrega esse vocabulario.
 *
 * "ENVIAR ARTE" (designer terminou, falta mandar ao cliente) NAO entra: nao
 * existe hoje nenhum evento no sistema que registre a entrega do designer, e
 * derivar isso de "tem arquivo anexado" seria adivinhacao.
 */
export type EstagioArte = "AGUARDANDO" | "AGUARDANDO_APROVACAO" | "EM ALTERACAO" | "APROVADO";

/**
 * Modelo com a arte fechada. Mesma lista usada pelo banco em
 * `recalcular_status_arte_briefing` e em `atualiza_flag_arte_proposta` — se as
 * duas divergirem, a coluna passa a discordar do flag `propostas.em_arte` e do
 * card "Em arte", que leem a definicao do banco.
 */
const STATUS_ARTE_APROVADOS = new Set([
  "APROVADO",
  "APROVADA",
  "APROVADA_CLIENTE",
  "LIBERADA",
  "IMPRESSA",
  "NAO_NECESSARIA"
]);

/**
 * Todo valor que `pedidos_modelos.status_arte` sabe assumir hoje: os seis
 * vivos no banco mais os tres declarados em `StatusArteProducao` que ainda nao
 * tem linha. Serve so para o aviso abaixo — a derivacao e total e nao depende
 * desta lista, porque tudo que nao e reprovado, nem com o cliente, nem
 * aprovado, cai em AGUARDANDO.
 */
const STATUS_ARTE_CONHECIDOS = new Set([
  ...STATUS_ARTE_APROVADOS,
  "PENDENTE",
  "AGUARDANDO",
  "AGUARDANDO_CLIENTE",
  "REPROVADA_CLIENTE",
  "EM_CRIACAO",
  "EM_REVISAO_INTERNA"
]);

/**
 * O estagio do PEDIDO a partir dos estagios dos seus modelos: vence o mais
 * atrasado. Um pedido com nove modelos aprovados e um reprovado esta EM
 * ALTERACAO — porque e isso que falta fazer nele.
 *
 * PREDICADO UNICO: a celula e o botao chamam esta funcao, nunca reimplementam
 * a regra. Foi assim que o card "Em arte" e o filtro divergiram em 31/08/2026,
 * cada um com sua propria nocao do mesmo criterio.
 *
 * Devolve `null` para pedido SEM modelo nenhum — nao ha arte para estagiar, e
 * a celula fica vazia. Diferente de AGUARDANDO, que e "tem modelo e ele ainda
 * nao andou".
 */
export function derivarEstagioArte(statusDosModelos: (string | null | undefined)[]): EstagioArte | null {
  const valores = statusDosModelos.map((s) => String(s ?? "").trim().toUpperCase()).filter(Boolean);
  if (valores.length === 0) return null;

  if (valores.some((s) => s === "REPROVADA_CLIENTE")) return "EM ALTERACAO";
  if (valores.some((s) => s === "AGUARDANDO_CLIENTE")) return "AGUARDANDO_APROVACAO";
  if (valores.every((s) => STATUS_ARTE_APROVADOS.has(s))) return "APROVADO";
  return "AGUARDANDO";
}

/**
 * Estagio da arte das propostas exibidas na lista de Orcamentos.
 *
 * POR QUE UMA CONSULTA A PARTE
 *   A lista le `propostas`, e o estagio mora em `pedidos_modelos`. Nao ha FK
 *   entre as duas (`pedidos_modelos.id_int` nao e chave estrangeira de
 *   `propostas.id_int`), entao o embed do PostgREST nao resolve — seria preciso
 *   criar constraint, que esta fora do escopo. Roda depois, UMA VEZ para os
 *   id_int da pagina, no mesmo padrao de `buscarRastreioDasPropostas` e do
 *   enriquecimento de chat que a tela ja faz. Nunca por linha.
 *
 * SOMENTE LEITURA. Nao escreve em `pedidos_modelos`, `pedidos_artes` nem
 * `propostas`, e nao encosta em `propostas.em_arte` nem nos triggers.
 */
export async function buscarEstagioArteDasPropostas(
  idInts: number[]
): Promise<Record<number, EstagioArte>> {
  const client = getSupabaseClient();
  const ids = Array.from(new Set(idInts.filter((n) => Number.isFinite(n) && n > 0)));
  if (!client || ids.length === 0) return {};

  const { data, error } = await client
    .from("pedidos_modelos")
    .select("id_int, status_arte")
    .in("id_int", ids);

  if (error) {
    console.warn("[status-arte-lista] Erro ao ler pedidos_modelos:", error);
    return {};
  }

  const statusPorId = new Map<number, string[]>();
  const desconhecidos = new Set<string>();

  for (const linha of data ?? []) {
    const id = Number(linha.id_int);
    if (!Number.isFinite(id)) continue;
    const status = String(linha.status_arte ?? "").trim().toUpperCase();
    if (status && !STATUS_ARTE_CONHECIDOS.has(status)) desconhecidos.add(status);
    const atual = statusPorId.get(id);
    if (atual) atual.push(status);
    else statusPorId.set(id, [status]);
  }

  // Valor novo em `status_arte` nao quebra a coluna (cai em AGUARDANDO), mas
  // significa que alguem passou a gravar um estagio que esta regra nao conhece
  // — e ai a coluna esta mentindo em silencio. O escritor desses status esta
  // FORA deste repositorio, entao o aviso e a unica forma de perceber.
  if (desconhecidos.size > 0) {
    console.warn(
      "[status-arte-lista] status_arte fora do mapeamento conhecido:",
      Array.from(desconhecidos).join(", ")
    );
  }

  const resultado: Record<number, EstagioArte> = {};
  for (const [id, statusList] of statusPorId) {
    const estagio = derivarEstagioArte(statusList);
    if (estagio) resultado[id] = estagio;
  }
  return resultado;
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
