/**
 * QUAL endereco de um cliente e o PRINCIPAL, com desempate DETERMINISTICO.
 *
 * POR QUE PRECISA DE DESEMPATE
 *   "Principal e unico por cliente" nao se sustentava em producao: houve
 *   cadastros com dois, e alguns deles eram pagadores da fila de faturamento.
 *   Cada par tinha um `Principal` (base antiga) e um `PRINCIPAL` (importacao da
 *   Receita Federal), em CIDADES E UFS DIFERENTES.
 *
 *   Ordenar por `id` — que e UUID — sorteava entre os dois, e a UF escolhida
 *   decide o CFOP (5101 interno x 6101 interestadual) e o `local_destino`.
 *
 *   Medido em 26/08/2026: NENHUM cadastro tem mais de um principal hoje
 *   (66.233 com exatamente um, 55 sem nenhum). O desempate segue aqui porque o
 *   banco nao tem constraint que impeca o segundo — a duplicata volta na
 *   proxima importacao.
 *
 * A REGRA, na ordem:
 *   1. grafia em CAIXA ALTA `PRINCIPAL` vence — e o endereco oficial do CNPJ,
 *      vindo da Receita. Confirmado num caso concreto: IMPRIMIX tinha
 *      `Principal` em Xangri-La/RS e `PRINCIPAL` em Goiania/GO, e o real era
 *      Goiania.
 *   2. empate na caixa alta: o mais recente (`data_criacao`).
 *   3. ultimo criterio, so para nunca ser nao-deterministico: o `id`.
 *
 * POR QUE E UMA FUNCAO PURA NUM MODULO PROPRIO
 *   Tem TRES chamadores, em features diferentes, e todos precisam concordar:
 *     - `resolverEnderecoPrincipal` (nfe.service), que decide a UF de destino;
 *     - a aba Destinatario da NF, que mostra o endereco na tela;
 *     - a reconsulta de CNPJ do cadastro, que SOBRESCREVE justamente essa linha.
 *   Se o terceiro escolhesse outra linha que os dois primeiros, a reconsulta
 *   corrigiria um endereco e a nota continuaria saindo com o outro.
 *
 *   O mesmo criterio vive tambem na RPC `fn_montar_payload_nfe`
 *   (`lower(trim(tipo_endereco)) = 'principal'`) — se um mudar, o outro tem de
 *   mudar junto.
 *
 * NAO higieniza nada: nenhum endereco e alterado ou apagado aqui, so escolhido.
 */
export function escolherEnderecoPrincipal<
  T extends { id?: string | number | null; tipo_endereco?: string | null; data_criacao?: string | null }
>(enderecos: T[]): T | null {
  const candidatos = enderecos.filter(
    (e) => String(e.tipo_endereco ?? "").trim().toLowerCase() === "principal"
  );
  if (candidatos.length === 0) return null;

  const ordenados = [...candidatos].sort((a, b) => {
    const caixaAltaA = String(a.tipo_endereco ?? "").trim() === "PRINCIPAL" ? 0 : 1;
    const caixaAltaB = String(b.tipo_endereco ?? "").trim() === "PRINCIPAL" ? 0 : 1;
    if (caixaAltaA !== caixaAltaB) return caixaAltaA - caixaAltaB;
    const dataA = a.data_criacao ? Date.parse(a.data_criacao) : Number.NEGATIVE_INFINITY;
    const dataB = b.data_criacao ? Date.parse(b.data_criacao) : Number.NEGATIVE_INFINITY;
    if (dataA !== dataB) return dataB - dataA;
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });

  return ordenados[0];
}

/** O tipo gravado numa linha nova de endereco principal. Caixa alta, como a Receita. */
export const TIPO_ENDERECO_PRINCIPAL = "PRINCIPAL";

/** `true` quando a linha e um endereco principal, em qualquer grafia. */
export function ehEnderecoPrincipal(tipoEndereco: string | null | undefined): boolean {
  return String(tipoEndereco ?? "").trim().toLowerCase() === "principal";
}
