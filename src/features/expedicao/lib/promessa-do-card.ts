/**
 * A comparacao de data dos cards por PROMESSA: "Expedicao do dia" e "Proximos dias".
 *
 * Os dois cards usam a MESMA regra (pedido em aberto, ainda nao saiu, com data de
 * previsao de envio = `propostas_os.data_termino`) e a MESMA referencia de "hoje"
 * (America/Sao_Paulo, ver `hojeSaoPaulo` no service). So muda a comparacao:
 *
 *   IGUAL_A_HOJE      promessa == hoje   (a parte "prometido hoje" do card do dia)
 *   POSTERIOR_A_HOJE  promessa >  hoje   (o card "Proximos dias")
 *
 * A parte "atrasado" do card do dia (promessa ANTES de hoje) nao entra aqui: ela
 * tem regra propria de etapa e nao muda. Datas ISO `AAAA-MM-DD` comparam como
 * texto sem erro.
 */
export type ComparacaoDePromessa = "IGUAL_A_HOJE" | "POSTERIOR_A_HOJE";

export function promessaNoDia(
  entrada: { emAberto: boolean; promessaDia: string | null; hoje: string; jaSaiu: boolean },
  comparacao: ComparacaoDePromessa
): boolean {
  if (!entrada.emAberto || entrada.jaSaiu || !entrada.promessaDia) return false;
  return comparacao === "IGUAL_A_HOJE" ? entrada.promessaDia === entrada.hoje : entrada.promessaDia > entrada.hoje;
}
