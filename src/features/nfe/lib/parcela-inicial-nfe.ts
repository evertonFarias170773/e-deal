import { isFamiliaFaturado } from "@/features/cobrancas/cobrancas-utils";
import { parcelasDoModelo, type ParcelasDoModelo } from "@/features/cobrancas/services/modelos-cobranca";
import type { ModeloCobranca } from "@/features/cobrancas/types";

/**
 * A condição com que a parcela do rascunho de NF-e NASCE.
 *
 * POR QUE EXISTE
 *   Até 15/09/2026 todo rascunho nascia com UMA parcela vencendo no dia. Em
 *   cobrança faturada a nota leva duplicata (forma 15), e duplicata vencendo na
 *   data de emissão é pagamento à vista para a SEFAZ: rejeição 853, "Dados de
 *   cobranca nao devem ser informados para pagamento a vista". Aconteceu nas
 *   três empresas no teste do ciclo fiscal da proposta 22066, e só passava se o
 *   operador abrisse a aba Pagamentos e escolhesse a condição.
 *
 * A REGRA
 *   - Cobrança da família faturado COM condição gravada
 *     (`pagamentos_v2.id_modelo_cobranca`): a parcela nasce pela condição —
 *     quantidade, dias até a primeira e intervalo do modelo, pela mesma tradução
 *     que a aba e o modal Preparar Cobrança usam (`parcelasDoModelo`).
 *   - Família faturado SEM condição gravada (as cobranças anteriores à coluna):
 *     uma parcela em `PRAZO_MINIMO_FATURADO_DIAS` dias. Nunca no dia.
 *   - Qualquer outra cobrança: `null` — o rascunho nasce como sempre nasceu.
 *
 *   O operador segue revisando e trocando a condição na aba Pagamentos.
 */

/**
 * Prazo da parcela de cobrança faturada que não tem condição gravada.
 *
 * Sete dias é a menor condição do catálogo (`modelos_cobranca`, "Prazo 7
 * dias"), e foi o prazo com que a NFE-22066-001 e as três notas do teste de
 * 15/09/2026 foram autorizadas. Ficar no mínimo do catálogo evita inventar um
 * prazo que o comercial não oferece.
 */
export const PRAZO_MINIMO_FATURADO_DIAS = 7;

export type CondicaoDaParcelaInicial = ParcelasDoModelo & {
  /** De onde veio: a condição gravada na cobrança, ou o prazo mínimo. */
  origem: "CONDICAO_DA_COBRANCA" | "PRAZO_MINIMO";
  /** `modelos_cobranca.resultado` quando veio da cobrança. */
  condicao: string | null;
};

export function condicaoDaParcelaInicial(
  tipoCobranca: string | null | undefined,
  modelo: ModeloCobranca | null
): CondicaoDaParcelaInicial | null {
  if (!isFamiliaFaturado(tipoCobranca)) return null;

  if (modelo) {
    const parcelas = parcelasDoModelo(modelo);
    // Uma condição que começasse no dia (inicio 0) reabriria o 853. Nenhuma do
    // catálogo começa assim hoje; se um dia existir, vale o prazo mínimo.
    if (parcelas.diasPraInicio >= 1) {
      return { ...parcelas, origem: "CONDICAO_DA_COBRANCA", condicao: modelo.resultado ?? null };
    }
  }

  return {
    qtdParcelas: 1,
    diasPraInicio: PRAZO_MINIMO_FATURADO_DIAS,
    intervalo: 0,
    origem: "PRAZO_MINIMO",
    condicao: null
  };
}

/** `YYYY-MM-DD` + dias, em aritmética de calendário (sem fuso). */
export function somarDiasIso(dataIso: string, dias: number): string {
  const [ano, mes, dia] = dataIso.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia + dias));
  return data.toISOString().slice(0, 10);
}
