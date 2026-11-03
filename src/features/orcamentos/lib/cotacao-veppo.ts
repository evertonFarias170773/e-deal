/**
 * Acréscimo sobre a cotação da VEPPO (03/11/2026, decisão do dono).
 *
 * A fórmula da VEPPO é do n8n (fluxo COORDENADAS - VEPPO) e não muda. O ERP
 * multiplica o valor que o n8n devolve por 1,20 e arredonda ao centavo mais
 * próximo. A conta é feita UMA vez, em `cotarVeppoNoServidor`, quando a resposta
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
