/**
 * Faturado com entrada — regras puras (sem I/O e sem React).
 *
 * Uma operação, duas cobranças (06/11/2026, caso 24253, que foi criado uma a uma):
 *   A — a ENTRADA, por PIX ou boleto, no valor digitado;
 *   B — o RESTANTE, Faturado, = total da proposta − entrada.
 *
 * Em centavos exatos: o total é o da tela (regra publicada em 06/11/2026,
 * `resumoNoCentavo`), e A + B = total, sem sobra nem falta de centavo.
 *
 * A rota `POST /api/cobrancas/faturado-com-entrada` grava as duas linhas num
 * ÚNICO insert: ou nascem as duas, ou nenhuma.
 */

export type FormaDaEntrada = "PIX" | "BOLETO";

export const FORMAS_DA_ENTRADA: readonly FormaDaEntrada[] = ["PIX", "BOLETO"];

export type DivisaoFaturadoComEntrada =
  | { ok: true; entradaCentavos: number; restanteCentavos: number }
  | { ok: false; code: string; message: string };

/**
 * Divide o total em entrada + restante.
 * - entrada > 0 e < total;
 * - restante = total − entrada (então A + B = total por construção).
 */
export function dividirFaturadoComEntrada(totalCentavos: number, entradaCentavos: number): DivisaoFaturadoComEntrada {
  if (!Number.isInteger(totalCentavos) || totalCentavos <= 0) {
    return { ok: false, code: "TOTAL_INVALIDO", message: "O total da proposta precisa ser maior que zero." };
  }
  if (!Number.isInteger(entradaCentavos) || entradaCentavos <= 0) {
    return { ok: false, code: "ENTRADA_ZERO", message: "Informe um valor de entrada maior que zero." };
  }
  if (entradaCentavos >= totalCentavos) {
    return {
      ok: false,
      code: "ENTRADA_TOTAL",
      message: "A entrada precisa ser menor que o total da proposta. Para cobrar tudo de uma vez, use PIX ou Boleto."
    };
  }
  return { ok: true, entradaCentavos, restanteCentavos: totalCentavos - entradaCentavos };
}

export type CondicaoDoFaturado = {
  id: string;
  resultado: string;
  qtd_parcela: number;
  inicio: number;
  intervalo: number;
  entrada_porcento: number;
};

export type DadosComunsDaCobranca = {
  idInt: number;
  pagador: { idCliente: number; nome: string; documento: string | null };
  empresa: string;
  idEmpresa: number;
  osIdeal: number | null;
  atendente: string;
  observacao: string | null;
};

/** As duas linhas de `pagamentos_v2`, prontas para UM insert. */
export function montarLinhasFaturadoComEntrada(entrada: {
  comuns: DadosComunsDaCobranca;
  divisao: { entradaCentavos: number; restanteCentavos: number };
  formaEntrada: FormaDaEntrada;
  vencimentoEntrada: string;
  vencimentoFaturado: string;
  condicao: CondicaoDoFaturado;
  ids: { entrada: string; faturado: string };
  urlEntrada: string | null;
}): [Record<string, unknown>, Record<string, unknown>] {
  const { comuns, divisao, condicao } = entrada;
  const restante = divisao.restanteCentavos / 100;
  const base = {
    id_int: comuns.idInt,
    id_cliente: comuns.pagador.idCliente,
    cliente: comuns.pagador.nome,
    documento: comuns.pagador.documento,
    empresa: comuns.empresa,
    id_empresa: comuns.idEmpresa,
    os_ideal: comuns.osIdeal,
    atendente: comuns.atendente,
    obs_v2: comuns.observacao,
    confirmado: false,
    paid_at: null
  };
  const rotuloEntrada = entrada.formaEntrada === "PIX" ? "PIX" : "Boleto";
  const linhaEntrada = {
    ...base,
    id: entrada.ids.entrada,
    valor: divisao.entradaCentavos / 100,
    status: "A_RECEBER",
    tipo_cobranca: entrada.formaEntrada,
    descricao: `Entrada (${rotuloEntrada}) do Faturado com entrada da proposta #${comuns.idInt}`,
    vencimento: entrada.vencimentoEntrada,
    token_publico: entrada.ids.entrada.split("-")[0],
    url_cobranca: entrada.urlEntrada,
    forma_fatu: null,
    forma_pgto: null,
    id_modelo_cobranca: null,
    p_valor_entrada: null,
    p_qtd_parcelas: null,
    p_dias_pra_inicio: null,
    p_intervalo: null
  };
  const entradaPct = Number(condicao.entrada_porcento) || 0;
  const linhaFaturado = {
    ...base,
    id: entrada.ids.faturado,
    valor: restante,
    status: "A_VENCER",
    tipo_cobranca: "E-FATURADO",
    descricao: `Restante (Faturado) do Faturado com entrada da proposta #${comuns.idInt}`,
    vencimento: entrada.vencimentoFaturado,
    token_publico: entrada.ids.faturado.split("-")[0],
    url_cobranca: null,
    forma_fatu: condicao.resultado,
    forma_pgto: condicao.resultado,
    id_modelo_cobranca: condicao.id,
    p_valor_entrada: entradaPct > 0 ? Math.round(divisao.restanteCentavos * entradaPct) / 10000 : 0,
    p_qtd_parcelas: condicao.qtd_parcela,
    p_dias_pra_inicio: condicao.inicio,
    p_intervalo: condicao.intervalo
  };
  return [linhaEntrada, linhaFaturado];
}

/** A linha do Histórico da operação. */
export function mensagemHistoricoFaturadoComEntrada(entrada: {
  idPagamentoEntrada: string;
  idPagamentoFaturado: string;
  formaEntrada: FormaDaEntrada;
  entradaCentavos: number;
  restanteCentavos: number;
  condicao: string;
  autor: string;
}): string {
  const reais = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
  return (
    `Faturado com entrada gerado por ${entrada.autor}: entrada ${entrada.idPagamentoEntrada} ` +
    `(${entrada.formaEntrada === "PIX" ? "PIX" : "Boleto"}, ${reais(entrada.entradaCentavos)}) e restante ` +
    `${entrada.idPagamentoFaturado} (Faturado, ${entrada.condicao}, ${reais(entrada.restanteCentavos)}).`
  );
}
