/**
 * Chave de acesso da nota, para o "Copiar chave de acesso" da lista de Notas
 * fiscais (pedido da Edina, 16/11/2026).
 *
 * NF-e: 44 dígitos. A coluna `notas_fiscais.chave_nfe` guarda quase sempre com
 * o prefixo "NFe" que a Focus devolve (1.580 de 1.587 notas em 16/11/2026);
 * aqui sai só o número, que é o que a SEFAZ, o cliente e o contador colam.
 *
 * NFS-e Nacional: a chave tem 50 dígitos (não 44) e não tem coluna própria. Ela
 * vem da Focus dentro da `url` da consulta pública (`...&chave=<50 dígitos>`),
 * gravada em `notas_servico.payload_retorno`.
 *
 * Só AUTORIZADA e CANCELADA têm chave que vale: rascunho, erro e denegada não
 * oferecem a ação. Sem chave no formato certo, também não.
 */

const STATUS_COM_CHAVE = ["AUTORIZADA", "CANCELADA"] as const;

function statusComChave(status: string | null | undefined): boolean {
  return (STATUS_COM_CHAVE as readonly string[]).includes(String(status ?? "").trim().toUpperCase());
}

/** Os 44 dígitos da chave da NF-e, sem o prefixo "NFe". Fora do formato, `null`. */
export function chaveDaNfe(chave: string | null | undefined): string | null {
  const texto = String(chave ?? "").trim().replace(/^NFe/i, "").replace(/\s+/g, "");
  return /^\d{44}$/.test(texto) ? texto : null;
}

/** A chave de 50 dígitos da NFS-e Nacional, lida do retorno da Focus. */
export function chaveDaNfse(payloadRetorno: Record<string, unknown> | null | undefined): string | null {
  if (!payloadRetorno) return null;
  const direta = String(payloadRetorno.chave ?? payloadRetorno.chave_nfse ?? payloadRetorno.chave_acesso ?? "").trim();
  if (/^\d{50}$/.test(direta)) return direta;
  const achado = String(payloadRetorno.url ?? "").match(/[?&]chave=(\d{50})(?:&|$)/);
  return achado ? achado[1] : null;
}

/** A chave que a lista copia, ou `null` quando a ação não aparece. */
export function chaveParaCopiar(
  nota:
    | { modelo: "nfe"; status: string | null | undefined; chave_nfe: string | null | undefined }
    | { modelo: "nfse"; status: string | null | undefined; payload_retorno: Record<string, unknown> | null | undefined }
): string | null {
  if (!statusComChave(nota.status)) return null;
  return nota.modelo === "nfe" ? chaveDaNfe(nota.chave_nfe) : chaveDaNfse(nota.payload_retorno);
}

export const MENSAGEM_CHAVE_COPIADA = "Chave copiada";
