/**
 * Acréscimo sobre a cotação da VEPPO (03/11/2026, decisão do dono).
 *
 * A fórmula da VEPPO é do n8n (fluxo COORDENADAS - VEPPO) e não muda. O ERP
 * multiplica o valor que o n8n devolve por 1,20 e arredonda ao centavo mais
 * próximo, só em cotação nova (ver CORTE abaixo). A conta é feita UMA vez, em `cotarVeppoNoServidor`, quando a resposta
 * do n8n chega: tela do orçamento, Maestro, recotação da Expedição, Aplicar
 * recotação e frete do complementar passam todos por ela.
 *
 * Nunca duas vezes: o que é gravado (`cotacao_frete.valor`, `valor_frete`, o
 * registro da recotação) já é o valor final, e nada relido do banco volta para
 * cá. Cotação gravada antes de 03/11/2026 fica como está.
 *
 * Mesmo desenho da margem do ECOMM da Azul (lib/cotacao-azul): o card leva
 * `valorOriginal` (o do n8n) e `valorMargem` (o final), só em memória; o banco
 * não tem coluna para o original.
 *
 * Sem import de servidor: o card da tela usa o rótulo daqui.
 */

/**
 * CORTE (03/11/2026, decisão do dono): pedido que já tinha a VEPPO escolhida
 * antes do acréscimo continua cotando sem os 20% — recotação da Expedição,
 * Aplicar recotação, frete do complemento e a tela, quando recota. É "antigo"
 * a proposta criada antes do commit def064f7 (09:38 de 03/11/2026, horário de
 * Brasília) que TEM a VEPPO como frete escolhido em `cotacao_frete`.
 *
 * POR QUE A DATA DA PROPOSTA, E NÃO A DA LINHA DE `cotacao_frete`
 *   Na fase de orçamento (NOVO, AGUARDANDO) todo Salvar apaga e regrava a linha
 *   escolhida, e o `created_at` dela renasce. Um pedido antigo salvo de novo
 *   passaria a contar como novo e a recotação na Expedição viria com +20%. A
 *   data da proposta nunca muda. Nenhuma linha VEPPO foi gravada entre o commit
 *   e o deploy (conferido em 03/11/2026).
 *
 * Sem número de pedido (orçamento novo, Maestro) é cotação nova: +20%.
 */
export const CORTE_MARGEM_VEPPO = "2026-11-03T12:38:04Z";

/** O pedido cota a VEPPO sem o acréscimo (regra de corte acima)? */
export function cotacaoVeppoLegada(entrada: {
  propostaCriadaEm: string | null | undefined;
  servicosEscolhidos: ReadonlyArray<string | null | undefined>;
}): boolean {
  const criada = Date.parse(String(entrada.propostaCriadaEm ?? ""));
  if (!Number.isFinite(criada) || criada >= Date.parse(CORTE_MARGEM_VEPPO)) return false;
  return entrada.servicosEscolhidos.some((s) => String(s ?? "").toUpperCase().includes("VEPPO"));
}

/** Número do pedido que a tela manda para o corte: proposta ainda não gravada ("NOVO") não manda. */
export function idIntParaCorteVeppo(idIntDoFormulario: string | number | null | undefined): number | undefined {
  const n = Number(idIntDoFormulario);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Multiplicador do frete da VEPPO. 1,20 = +20%. */
export const MARGEM_VEPPO = 1.2;

/** Rótulo do acréscimo para o card ("+20%"). */
export function rotuloMargemVeppo(): string {
  return `+${Math.round((MARGEM_VEPPO - 1) * 100)}%`;
}

/**
 * O valor que o n8n devolveu vale como cotação? Só número finito maior que zero.
 * Zero, negativo, texto ou ausente: sem card.
 */
export function valorVeppoValido(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0;
}

/**
 * Valor do card a partir do valor do n8n: × 1,20, arredondado ao centavo mais
 * próximo. A conta é em centavos inteiros para 42,45 dar 50,94 e não 50,939999.
 */
export function aplicarMargemVeppo(valorN8n: number): { valorOriginal: number; valorFinal: number } {
  const centavosOriginal = Math.round(valorN8n * 100);
  const centavosFinal = Math.round((centavosOriginal * Math.round(MARGEM_VEPPO * 100)) / 100);
  return { valorOriginal: centavosOriginal / 100, valorFinal: centavosFinal / 100 };
}
