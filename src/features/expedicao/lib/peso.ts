/**
 * Precedência ÚNICA do peso de expedição.
 *
 * A regra estava copiada em quatro lugares (painel/modal, etiqueta 10x15,
 * declaração de conteúdo e prepostagem dos Correios) e divergiu: nenhum deles
 * lia `expedicoes.peso_bruto_kg`, gravado pela Revisão do boletim, então um
 * pedido revisado com 32,7 kg saía com o peso da cotação (31,2 kg) na tela, na
 * etiqueta e no payload dos Correios.
 *
 * Ordem, do mais específico para o mais genérico:
 *   1. `expedicoes.peso_kg`       — pesado na bancada, no próprio despacho (kg)
 *   2. `expedicoes.peso_bruto_kg` — bruto com embalagem, da Revisão (kg)
 *   3. `cotacao_frete.peso`       — peso usado para cotar o frete (GRAMAS)
 *   4. Σ `produtos_proposta.peso_total` — teórico dos itens (GRAMAS)
 *
 * Unidades preservadas como estão no banco: `expedicoes` em kg, as outras duas
 * em gramas — a conversão acontece só aqui. Zero/negativo/lixo não conta como
 * peso informado e cai para o próximo da fila.
 */

export type PesoOrigem = "aferido" | "bruto" | "cotado" | "teorico";

export type PesoResolvido = {
  /** Sempre em KG, ou null quando nenhuma fonte tem valor utilizável. */
  pesoKg: number | null;
  origem: PesoOrigem | null;
};

export type PesoEntrada = {
  /** expedicoes.peso_kg — kg */
  pesoAferidoKg?: number | string | null;
  /** expedicoes.peso_bruto_kg — kg */
  pesoBrutoKg?: number | string | null;
  /** cotacao_frete.peso — gramas */
  pesoCotadoGramas?: number | string | null;
  /** Σ produtos_proposta.peso_total — gramas */
  pesoTeoricoGramas?: number | string | null;
};

/** Número > 0 ou null — `numeric` do Postgres chega como string pelo PostgREST. */
function positivo(valor: number | string | null | undefined): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

export function resolverPesoExpedicao(entrada: PesoEntrada): PesoResolvido {
  const aferido = positivo(entrada.pesoAferidoKg);
  if (aferido !== null) return { pesoKg: aferido, origem: "aferido" };

  const bruto = positivo(entrada.pesoBrutoKg);
  if (bruto !== null) return { pesoKg: bruto, origem: "bruto" };

  const cotado = positivo(entrada.pesoCotadoGramas);
  if (cotado !== null) return { pesoKg: cotado / 1000, origem: "cotado" };

  const teorico = positivo(entrada.pesoTeoricoGramas);
  if (teorico !== null) return { pesoKg: teorico / 1000, origem: "teorico" };

  return { pesoKg: null, origem: null };
}
