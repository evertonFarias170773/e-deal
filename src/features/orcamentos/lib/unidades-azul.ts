/**
 * Azul Cargo só onde o cliente consegue retirar (02/11/2026).
 *
 * A cotação da Azul é para retirada em unidade da Azul, e a Azul não tem
 * unidade em toda cidade. A lista vem da API da Azul (LocalizarUnidades por
 * UF, 26 UFs, sem RS: 317 unidades extraídas em 28/10/2026) e mora em
 * `public.azul_unidades`, com um flag `elegivel` por unidade: unidade da própria
 * Azul entra; transportadora parceira, ponto dentro de cliente e ponto de venda
 * ficam fora. A lista muda só trocando o flag; a tabela guarda as 317.
 *
 * A REGRA
 *   - Serviços da cidade = união dos serviços das unidades elegíveis da cidade.
 *   - Cidade sem unidade elegível = nenhuma opção da Azul.
 *   - Cidade com unidades só de EXPRESSO e PREMIUM = só esses cards.
 *   - Cidade e UF comparadas pela mesma chave de `ibge_municipios.nome_chave`:
 *     sem acento, minúsculas, só [a-z0-9] (a API devolve a cidade sem acento;
 *     "Sant'Ana" e "Santana" dão a mesma chave).
 *   - Tabela vazia/indisponível ou cidade não resolvida = NÃO filtra: a cotação
 *     segue como hoje, e quem chama registra um aviso no log. Por isso a função
 *     devolve `null` nesses casos, e `[]` quando a cidade não tem unidade.
 *
 * QUEM LIGA A VERIFICAÇÃO
 *   O orçamento (aba Fretes) e o Maestro. A recotação da Expedição e o frete do
 *   pedido complementar NÃO ligam e continuam como hoje: o pedido já existe com
 *   um transporte escolhido, e trocar a lista não pode sumir com a opção dele.
 *   O RS continua fora antes de tudo, pela regra de sempre.
 */

/** Nomes de serviço como a API da Azul devolve em `NomeServico` (e na tabela). */
export type ServicoApiAzul = "ECOMM" | "EXPRESSO" | "PREMIUM" | "STANDARD";

export const SERVICOS_API_AZUL: readonly ServicoApiAzul[] = ["ECOMM", "EXPRESSO", "PREMIUM", "STANDARD"];

/** Linha de `public.azul_unidades` que a verificação usa. */
export type UnidadeAzul = {
  base: string;
  cidade: string;
  uf: string;
  servicos: readonly string[];
  elegivel: boolean;
};

/** Mesma expressão de `ibge_municipios.nome_chave`: sem acento, minúsculas, só [a-z0-9]. */
export function chaveDeCidade(cidade: string | null | undefined): string {
  return String(cidade ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** "UF:chave", a chave de comparação entre endereço e tabela. Vazio quando não dá para resolver. */
export function chaveCidadeAzul(cidade: string | null | undefined, uf: string | null | undefined): string {
  const ufChave = String(uf ?? "").trim().toUpperCase();
  const cidadeChave = chaveDeCidade(cidade);
  if (!/^[A-Z]{2}$/.test(ufChave) || !cidadeChave) return "";
  return `${ufChave}:${cidadeChave}`;
}

/**
 * Serviços da Azul permitidos para a cidade de destino.
 *
 * - `null`  = sem como verificar (lista vazia/ausente ou cidade/UF não resolvida): não filtrar.
 * - `[]`    = cidade sem unidade elegível: nenhuma opção da Azul.
 * - lista   = união dos serviços das unidades elegíveis da cidade, na ordem canônica.
 */
export function servicosAzulDaCidade(
  unidades: readonly UnidadeAzul[] | null | undefined,
  cidade: string | null | undefined,
  uf: string | null | undefined
): ServicoApiAzul[] | null {
  if (!unidades || unidades.length === 0) return null;
  const chave = chaveCidadeAzul(cidade, uf);
  if (!chave) return null;

  const permitidos = new Set<ServicoApiAzul>();
  for (const u of unidades) {
    if (!u.elegivel) continue;
    if (chaveCidadeAzul(u.cidade, u.uf) !== chave) continue;
    for (const s of u.servicos ?? []) {
      const nome = String(s).trim().toUpperCase() as ServicoApiAzul;
      if (SERVICOS_API_AZUL.includes(nome)) permitidos.add(nome);
    }
  }
  return SERVICOS_API_AZUL.filter((s) => permitidos.has(s));
}
