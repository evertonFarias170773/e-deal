/**
 * A NF-e que vai na pré-postagem dos Correios (03/11/2026).
 *
 * Desde 01/11/2026 os Correios exigem NF-e para postar. A nota é a mesma que a
 * Expedição já mostra (`escolherNotaAutorizadaDoPedido`: AUTORIZADA, com
 * número, de produção, fora de remessa, a mais recente). Sem ela, a
 * pré-postagem sai como antes, só com a declaração de conteúdo.
 *
 * `notas_fiscais.chave_nfe` é gravada como "NFe" + 44 dígitos. Os Correios
 * recebem só os 44 dígitos; chave em qualquer outro formato não vai (a
 * pré-postagem segue sem nota, como antes), para não mandar chave errada.
 */
import { escolherNotaAutorizadaDoPedido, type NotaCandidata } from "@/lib/fiscal/nota-do-pedido";

/** Colunas a pedir em `notas_fiscais` para montar a nota da pré-postagem. */
export const COLUNAS_NOTA_DA_PREPOSTAGEM = "status, numero_nf, ambiente, data_autorizacao, created_at, tipo_nota, chave_nfe";

/** Os 44 dígitos da chave, ou null quando a chave não tem esse formato. */
export function chaveNfeParaCorreios(bruta: string | null | undefined): string | null {
  const texto = String(bruta ?? "").trim().replace(/^NFe/i, "");
  return /^\d{44}$/.test(texto) ? texto : null;
}

export function notaParaPrepostagem<T extends NotaCandidata & { chave_nfe?: string | null }>(
  notas: readonly T[] | null | undefined
): { chave: string; numero: string } | null {
  const nota = escolherNotaAutorizadaDoPedido(notas);
  if (!nota) return null;
  const chave = chaveNfeParaCorreios(nota.chave_nfe);
  const numero = String(nota.numero_nf ?? "").trim();
  if (!chave || !numero) return null;
  return { chave, numero };
}
