/**
 * maestro-simple-tempo.ts
 *
 * Funções puras de calendário no fuso America/Sao_Paulo, usadas pelos
 * períodos "hoje"/"ontem" das tools do Maestro e pela saudação do dia.
 *
 * O Brasil não adota horário de verão desde 2019, então o fuso é fixo em
 * UTC-3 o ano inteiro — o dia-calendário local é extraído via Intl (fonte
 * da verdade do "que dia é hoje em SP") e ancorado no offset fixo -03:00
 * para converter o início do dia local em UTC.
 */

const TZ_SAO_PAULO = 'America/Sao_Paulo';
const DIA_MS = 24 * 60 * 60 * 1000;

/** Data local de São Paulo no formato YYYY-MM-DD. */
export function ymdSaoPaulo(agora: Date = new Date()): string {
  // en-CA garante o formato YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ_SAO_PAULO }).format(agora);
}

/**
 * Início do dia-calendário de São Paulo (00:00 local) em ISO UTC.
 * offsetDias: 0 = hoje, -1 = ontem, +1 = amanhã.
 */
export function inicioDiaSaoPauloUtcIso(offsetDias = 0, agora: Date = new Date()): string {
  const inicioHoje = new Date(`${ymdSaoPaulo(agora)}T00:00:00-03:00`);
  return new Date(inicioHoje.getTime() + offsetDias * DIA_MS).toISOString();
}

/** Intervalo [desde, ate) em UTC do dia-calendário de SP com offset. */
export function intervaloDiaSaoPaulo(
  offsetDias: number,
  agora: Date = new Date(),
): { desde: string; ate: string } {
  const desde = inicioDiaSaoPauloUtcIso(offsetDias, agora);
  return { desde, ate: new Date(new Date(desde).getTime() + DIA_MS).toISOString() };
}

/** Hora local de São Paulo (0-23) — para "Bom dia/Boa tarde/Boa noite". */
export function horaSaoPaulo(agora: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ_SAO_PAULO,
      hour: 'numeric',
      hour12: false,
    }).format(agora),
  ) % 24;
}
