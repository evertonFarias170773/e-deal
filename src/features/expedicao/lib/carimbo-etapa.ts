/**
 * O QUE ACONTECEU COM ESTE PEDIDO, E QUANDO — para o card do Kanban.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 *   Com as colunas por categoria, o card diz quem leva mas não em que ponto do
 *   fluxo o pedido está. Na bancada, "está pronto desde ontem" e "foi despachado
 *   há dez minutos" pedem ações diferentes, e hoje isso só se descobre abrindo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SÓ O CARIMBO QUE PERTENCE À ETAPA ATUAL. NUNCA OUTRO.
 * ═══════════════════════════════════════════════════════════════════════════
 *   Os quatro carimbos de `expedicoes` são FOTOS DO ÚLTIMO ACONTECIDO, não um
 *   histórico: cada ida e volta os sobrescreve, e `voltarStatus` limpa apenas o
 *   do passo desfeito — nunca os anteriores.
 *
 *   O #21594 é a prova viva disso. Em 03/09 ele foi a EXPEDICAO, foi DESPACHADO
 *   às 18:50, e voltou duas vezes para EM ACABAMENTO. Está lá agora com
 *   `data_despacho` preenchida de uma passagem que não vale mais. Ler "o
 *   carimbo mais recente" mostraria "Despachado 03/09 18:50" num pedido que
 *   está na fábrica.
 *
 *   Por isso a escolha é por ETAPA, e não pelo que estiver preenchido:
 *
 *     PRODUCAO      → nenhum. A linha de `expedicoes` só nasce em `marcarPronto`.
 *     ACABAMENTO    → nenhum, pelo mesmo motivo.
 *     PRONTO        → `dataPronto`
 *     A_RETIRAR     → `dataDespacho`
 *     EM_TRANSITO   → `coletadoEm` ?? `dataDespacho`
 *     ENTREGUE      → `dataEntrega`
 *
 * EM TRANSITO TEM DUAS ENTRADAS, e é por isso que ali há dois carimbos:
 *   Correios chega pelo DESPACHO (a postagem é a coleta), e transportadora e
 *   motoboy chegam pela COLETA, depois de esperar o carro. Medido em 06/09/2026:
 *   dos 9 em trânsito, 5 vieram por coleta. Usar `dataDespacho` para esses
 *   mostraria quando o volume ficou pronto na bancada, não quando o carro levou.
 *   O rótulo acompanha a entrada — "Coletado" ou "Despachado" —, então o operador
 *   lê qual dos dois momentos está vendo.
 *
 * O QUE ESTA FUNÇÃO NÃO FAZ
 *   Não lê `audit.logs_v2`, que é a única fonte capaz de responder "quando
 *   entrou nesta etapa" para as seis — e que custaria uma consulta a mais por
 *   carga do painel. Não usa `propostas.updated_at`: os dois triggers o
 *   recarimbam a cada toque em qualquer campo, e ele mentiria com aparência de
 *   verdade.
 *
 * RISCO CONHECIDO E NÃO RESOLVIDO AQUI: pedido que volta de EM TRANSITO para
 *   EXPEDICAO mantém o `dataPronto` da PRIMEIRA vez que ficou pronto, porque
 *   `voltarStatus` só limpa o carimbo do passo desfeito. O card mostraria
 *   "Pronto" com a data antiga. Corrigir exige mexer na limpeza dos carimbos —
 *   escrita, e rodada própria.
 */

import type { EtapaExpedicao, PedidoExpedicao } from "../types";

export type CarimboDaEtapa = {
  /** Verbo no passado, ou o nome do estado quando não houve evento datado. */
  rotulo: string;
  /** ISO do instante, ou `null` quando a etapa não tem carimbo confiável. */
  instante: string | null;
};

const SEM_CARIMBO: Record<"PRODUCAO" | "ACABAMENTO", string> = {
  PRODUCAO: "Em produção",
  ACABAMENTO: "Em acabamento"
};

/**
 * O carimbo que vale para a etapa em que o pedido está AGORA.
 *
 * Função pura: recebe o pedido como o card já o tem, sem I/O e sem relógio.
 */
export function carimboDaEtapa(p: PedidoExpedicao): CarimboDaEtapa {
  const exp = p.expedicao;

  switch (p.etapa as EtapaExpedicao) {
    case "PRODUCAO":
      return { rotulo: SEM_CARIMBO.PRODUCAO, instante: null };

    case "ACABAMENTO":
      return { rotulo: SEM_CARIMBO.ACABAMENTO, instante: null };

    case "PRONTO":
      return { rotulo: "Pronto", instante: exp?.dataPronto ?? null };

    case "A_RETIRAR":
      // "No balcão", e não "Despachado": em retirada nada foi despachado, o
      // volume está no balcão esperando o cliente. Dizer despachado aqui seria
      // o mesmo erro de imprimir o nome de uma transportadora numa retirada.
      return { rotulo: "No balcão", instante: exp?.dataDespacho ?? null };

    case "EM_TRANSITO":
      return exp?.coletadoEm
        ? { rotulo: "Coletado", instante: exp.coletadoEm }
        : { rotulo: "Despachado", instante: exp?.dataDespacho ?? null };

    case "ENTREGUE":
      return { rotulo: "Entregue", instante: exp?.dataEntrega ?? null };

    default:
      // Etapa fora da tabela. Não inventa rótulo nem data: devolve o status cru,
      // que é o que o pedido de fato diz de si.
      return { rotulo: p.statusInterno, instante: null };
  }
}

/**
 * "03/09 14:31" no fuso de São Paulo.
 *
 * Os carimbos de `expedicoes` são `timestamptz` gravados em UTC — fatiar a
 * string, como `dataPrevistaCurta` faz com `data_termino`, mostraria três horas
 * a mais. Aquele campo é `timestamp` SEM fuso, e por isso pode ser fatiado;
 * estes não.
 */
export function dataHoraCurta(iso: string | null): string {
  if (!iso) return "";
  const instante = new Date(iso);
  if (!Number.isFinite(instante.getTime())) return "";
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(instante);
  const achar = (tipo: string) => partes.find((x) => x.type === tipo)?.value ?? "";
  return `${achar("day")}/${achar("month")} ${achar("hour")}:${achar("minute")}`;
}

/** O texto pronto do chip: verbo mais o instante, ou só o verbo. */
export function rotuloCarimbo(p: PedidoExpedicao): string {
  const { rotulo, instante } = carimboDaEtapa(p);
  const quando = dataHoraCurta(instante);
  return quando ? `${rotulo} ${quando}` : rotulo;
}
