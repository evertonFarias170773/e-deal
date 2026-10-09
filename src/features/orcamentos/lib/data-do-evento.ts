/**
 * Intervalo aceito para a data do evento (`pedidos_artes.data_evento`).
 *
 * O campo de data do navegador aceita ano de até 6 dígitos, e a coluna
 * `timestamptz` também: em 08/10/2026 o 23380 foi gravado com 20206-11-07
 * (2026 com um dígito a mais) e o boletim deixou de abrir. O limite vale no
 * campo (`min`/`max`) e de novo na gravação, que é quem de fato protege.
 *
 * Sem imports de propósito: roda na tela, no serviço e no teste do Node.
 */
export const DATA_EVENTO_MIN = "1900-01-01";
export const DATA_EVENTO_MAX = "9999-12-31";

export const MENSAGEM_DATA_EVENTO_FORA =
  "Data do evento inválida: confira o ano (aceito de 1900 a 9999).";

/**
 * A data do evento pode ser gravada? Vazio pode — a data é opcional. Aceita
 * "AAAA-MM-DD" e o mesmo com hora depois ("AAAA-MM-DDT00:00:00").
 */
export function dataDoEventoNoIntervalo(valor: string | null | undefined): boolean {
  const texto = String(valor ?? "").trim();
  if (texto === "") return true;
  const partes = /^(\d{4})-(\d{2})-(\d{2})(T|$)/.exec(texto);
  if (!partes) return false;
  const dia = `${partes[1]}-${partes[2]}-${partes[3]}`;
  if (dia < DATA_EVENTO_MIN || dia > DATA_EVENTO_MAX) return false;
  return !Number.isNaN(new Date(`${dia}T00:00:00Z`).getTime());
}
