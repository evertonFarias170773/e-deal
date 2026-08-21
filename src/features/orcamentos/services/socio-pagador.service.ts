import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Nome do SOCIO PAGADOR das propostas exibidas na lista de Orcamentos.
 *
 * QUEM E O SOCIO PAGADOR
 *   `propostas.id_faturado` guarda quem paga a proposta. Na esmagadora maioria
 *   das linhas ele e o PROPRIO cliente (6.531 de 6.604 em 20/08/2026) — nesse
 *   caso nao ha nada a mostrar. Socio pagador de verdade e quando
 *   `id_faturado <> id_cliente`: outro cadastro, ligado ao principal por
 *   `clientes_socios`, que assume a fatura. Sao 73 propostas hoje.
 *
 *   Quem decide se ha socio e a TELA, comparando os dois ids que ja vem na
 *   linha. Esta funcao so resolve NOMES, e por isso recebe a lista de ids ja
 *   filtrada — nao repete a regra de negocio.
 *
 * SOMENTE LEITURA. Nao escreve nada e nao altera a proposta.
 */
export async function buscarNomesDosSocios(
  idsFaturado: number[]
): Promise<Record<number, string>> {
  const client = getSupabaseClient();
  const ids = Array.from(new Set(idsFaturado.filter((n) => Number.isFinite(n) && n > 0)));
  if (!client || ids.length === 0) return {};

  const { data, error } = await client
    .from("clientes")
    .select("id_cliente, nome, fantasia, apelido")
    .in("id_cliente", ids);

  if (error) {
    console.warn("[socio-pagador] Erro ao resolver nomes dos socios:", error);
    return {};
  }

  const resultado: Record<number, string> = {};
  for (const linha of data ?? []) {
    const id = Number(linha.id_cliente);
    // Mesma preferencia de rotulo usada no resto do cadastro: fantasia e o nome
    // pelo qual a empresa e conhecida; o apelido cobre pessoa fisica.
    const nome =
      String(linha.fantasia ?? "").trim() ||
      String(linha.nome ?? "").trim() ||
      String(linha.apelido ?? "").trim();
    if (nome) resultado[id] = nome;
  }
  return resultado;
}
