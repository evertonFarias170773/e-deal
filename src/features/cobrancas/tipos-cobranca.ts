/**
 * TIPOS DE COBRANÇA — fonte única (12/11/2026).
 *
 * Cada tipo gravado em `pagamentos_v2.tipo_cobranca`, com o nome de exibição e
 * a opção do filtro "Cobrança" da lista de Propostas em que ele entra. O tipo
 * `CobrancaTipo` (types.ts) sai daqui.
 *
 * `grafias` são as formas como o tipo está GRAVADO no banco (a consulta do
 * filtro usa `.in` com elas): o E-Faturado tem 173 propostas gravadas como
 * "E-Faturado", até 28/07/2026. `aliases` são as formas que a lista já
 * normalizada traz (mappers: E-AMOSTRA vira "E-AMOSTRAS", e cartão escrito por
 * extenso vira "CARTAO").
 *
 * Ainda usam listas próprias, de propósito (decisão de 12/11/2026): o formulário
 * de cobrança, `getTipoCobrancaLabel`, o filtro da Conferência, a troca de forma
 * de pagamento e o Maestro.
 */

export const TIPOS_COBRANCA = [
  { tipo: "PIX", rotulo: "PIX", filtro: "PIX", grafias: ["PIX"], aliases: [] },
  { tipo: "BOLETO", rotulo: "Boleto", filtro: "BOLETO", grafias: ["BOLETO"], aliases: [] },
  { tipo: "CARD_PARCELADO", rotulo: "Cartão de crédito", filtro: "CARTAO", grafias: ["CARD_PARCELADO"], aliases: ["CARTAO", "CARTÃO"] },
  // Cartão antigo (até 23/04/2026): nada cria mais, e no filtro entra junto do cartão de hoje.
  { tipo: "CREDIT_CARD", rotulo: "Cartão de crédito (antigo)", filtro: "CARTAO", grafias: ["CREDIT_CARD"], aliases: [] },
  { tipo: "E-FATURADO", rotulo: "E-Faturado", filtro: "E-FATURADO", grafias: ["E-FATURADO", "E-Faturado"], aliases: [] },
  { tipo: "E-CREDITO", rotulo: "E-Crédito", filtro: "E-CREDITO", grafias: ["E-CREDITO"], aliases: [] },
  { tipo: "E-RETRABALHO", rotulo: "E-Retrabalho", filtro: "E-RETRABALHO", grafias: ["E-RETRABALHO"], aliases: [] },
  { tipo: "E-AMOSTRA", rotulo: "E-Amostra", filtro: "E-AMOSTRA", grafias: ["E-AMOSTRA"], aliases: ["E-AMOSTRAS"] },
  { tipo: "E-PERMUTA", rotulo: "E-Permuta", filtro: "E-PERMUTA", grafias: ["E-PERMUTA"], aliases: [] }
] as const;

export type CobrancaTipo = (typeof TIPOS_COBRANCA)[number]["tipo"];

/** Valor de uma opção do filtro "Cobrança" (o "TODOS" fica fora: é a ausência de filtro). */
export type FiltroTipoCobranca = (typeof TIPOS_COBRANCA)[number]["filtro"];

export type OpcaoFiltroCobranca = {
  valor: FiltroTipoCobranca;
  rotulo: string;
  /** Tipos de `TIPOS_COBRANCA` que a opção junta. */
  tipos: CobrancaTipo[];
  /** Formas gravadas no banco, para `.in("tipo_cobranca", ...)`. */
  grafias: string[];
};

/**
 * As opções do filtro, na ordem da constante. Tipos com o mesmo `filtro` viram
 * uma opção só, com o rótulo do primeiro (o cartão antigo entra em "Cartão de crédito").
 */
export function opcoesDoFiltroCobranca(): OpcaoFiltroCobranca[] {
  const opcoes: OpcaoFiltroCobranca[] = [];
  for (const t of TIPOS_COBRANCA) {
    const existente = opcoes.find((o) => o.valor === t.filtro);
    if (existente) {
      existente.tipos.push(t.tipo);
      existente.grafias.push(...t.grafias);
    } else {
      opcoes.push({ valor: t.filtro, rotulo: t.rotulo, tipos: [t.tipo], grafias: [...t.grafias] });
    }
  }
  return opcoes;
}

/** Valores aceitos na URL (`cob=`), com o "TODOS" na frente. */
export const VALORES_FILTRO_COBRANCA: readonly ("TODOS" | FiltroTipoCobranca)[] = [
  "TODOS",
  ...Array.from(new Set(TIPOS_COBRANCA.map((t) => t.filtro)))
];

const normalizar = (valor: unknown) => String(valor ?? "").trim().toUpperCase();

/**
 * Um tipo como a lista o traz (gravado ou já normalizado pelo mapper) entra na
 * opção do filtro? Sem diferenciar maiúsculas: "E-Faturado" entra em E-Faturado.
 */
export function tipoEntraNoFiltroCobranca(tipo: unknown, filtro: string): boolean {
  const alvo = normalizar(tipo);
  if (!alvo) return false;
  return TIPOS_COBRANCA.some(
    (t) =>
      t.filtro === filtro &&
      [t.tipo, ...t.grafias, ...t.aliases].some((forma) => normalizar(forma) === alvo)
  );
}

/** Grafias gravadas da opção, para a consulta no banco. Vazio = opção desconhecida. */
export function grafiasDoFiltroCobranca(filtro: string): string[] {
  return opcoesDoFiltroCobranca().find((o) => o.valor === filtro)?.grafias ?? [];
}
