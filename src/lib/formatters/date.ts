/**
 * Data que o `Date` não entende (ano de 5 dígitos, texto solto, vazio) devolve
 * o próprio valor como texto, em vez de lançar. `Intl.DateTimeFormat.format`
 * estoura com `RangeError: Invalid time value`, e dentro de um render isso
 * derruba a tela inteira — o boletim do 23380 (data do evento gravada como
 * 20206-11-07) ficou sem abrir em 09/10/2026. O valor cru na tela mostra o
 * erro para quem pode corrigir. Data válida não muda.
 */
function dataOuTextoCru(value: string | Date): Date | string {
  const data = new Date(value);
  return Number.isNaN(data.getTime()) ? String(value ?? "") : data;
}

export function formatDate(value: string | Date) {
  const data = dataOuTextoCru(value);
  if (typeof data === "string") return data;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(data);
}

/**
 * Data CIVIL (coluna `date`: vencimento e afins) em dd/mm/aaaa, sem fuso.
 *
 * `formatDate("2026-10-19")` lê a string como meia-noite em UTC e mostra no
 * fuso de São Paulo: 18/10, um dia a menos. Data civil não tem hora nem fuso
 * a converter — os três números já são a resposta. Valor fora do formato
 * AAAA-MM-DD cai no `formatDate` de sempre.
 */
export function formatDataCivil(value: string) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? "").trim());
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : formatDate(value);
}

/** Hoje em São Paulo, AAAA-MM-DD — para comparar com data civil sem passar por UTC. */
export function hojeEmSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export function formatDateTime(value: string | Date) {
  const data = dataOuTextoCru(value);
  if (typeof data === "string") return data;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(data);
}
