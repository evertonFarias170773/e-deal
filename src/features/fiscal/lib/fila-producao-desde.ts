/**
 * Coluna "Em produção desde" da Fila de Faturamento — as duas linhas da célula.
 *
 * Módulo puro, sem import: testado em scripts/testes/fila-producao-desde.test.mts.
 *
 * LINHA 1 — quando o pedido entrou em produção (`propostas.liberado_producao_em`)
 *   Data e hora juntas, "07/10/26 17:16", SEMPRE no horário de Brasília. O banco
 *   guarda o instante em UTC; formatar com o fuso do navegador mostrava outra
 *   hora (e às vezes outro dia) para quem abre a tela fora de Brasília.
 *
 * LINHA 2 — a previsão de entrega que a PRODUÇÃO definiu
 *   É a "data prevista de entrega" do boletim. O boletim grava a mesma data em
 *   `propostas_os.data_termino` e em `propostas_os_setores.prazo`, espelhada em
 *   todas as linhas de setor do pedido; a Fila lê a dos setores, como a lista
 *   de Pedidos (services/prazo-envio-lista). `prazo` é DATE, sem fuso: é o dia
 *   como foi digitado, então a string é fatiada — passar por `Date` tiraria um dia.
 *
 * FAIL-SAFE
 *   Enquanto a leitura das previsões não chegou, ou se ela falhou, a linha 2
 *   não aparece: a coluna mostra só data e hora, sem erro.
 */

const FUSO_DE_BRASILIA = "America/Sao_Paulo";

function partesEmBrasilia(instante: Date): Record<string, string> | null {
  if (Number.isNaN(instante.getTime())) return null;
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO_DE_BRASILIA,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(instante);
  const mapa: Record<string, string> = {};
  for (const parte of partes) mapa[parte.type] = parte.value;
  return mapa;
}

/** "07/10/26 17:16" no horário de Brasília; `null` quando o carimbo não é uma data. */
export function dataHoraDeBrasilia(carimbo: string | null | undefined): string | null {
  if (!carimbo) return null;
  const p = partesEmBrasilia(new Date(carimbo));
  if (!p) return null;
  return `${p.day}/${p.month}/${p.year.slice(-2)} ${p.hour}:${p.minute}`;
}

/** O dia de hoje em Brasília, "2026-10-08" — para comparar com o `prazo`, que é data sem fuso. */
export function hojeEmBrasilia(agora: Date = new Date()): string {
  const p = partesEmBrasilia(agora);
  return p ? `${p.year}-${p.month}-${p.day}` : "";
}

const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * A previsão de cada pedido, a partir das linhas de `propostas_os_setores`
 * (já em ordem de criação). As linhas de um pedido são espelhadas: vale a
 * primeira que tiver prazo — a mesma escolha da lista de Pedidos.
 */
export function previsaoPorPedido(linhas: readonly { id_int: unknown; prazo: unknown }[]): Map<number, string> {
  const mapa = new Map<number, string>();
  for (const linha of linhas) {
    const id = Number(linha.id_int);
    const prazo = String(linha.prazo ?? "").slice(0, 10);
    if (!Number.isFinite(id) || id <= 0 || !DATA_ISO.test(prazo)) continue;
    if (!mapa.has(id)) mapa.set(id, prazo);
  }
  return mapa;
}

export type LeituraDasPrevisoes = {
  porPedido: ReadonlyMap<number, string>;
  /** A leitura chegou inteira? `false` enquanto carrega ou se falhou. */
  pronta: boolean;
};

export type LinhaDaPrevisao =
  /** Leitura não pronta: a linha 2 não aparece. */
  | { tipo: "OCULTA" }
  | { tipo: "SEM_PREVISAO"; texto: "Sem previsão" }
  | { tipo: "PREVISAO"; texto: string; vencida: boolean };

/**
 * A segunda linha da célula. `hoje` é o dia em Brasília ("2026-10-08").
 * Vencida = a previsão é de um dia ANTERIOR a hoje; a do próprio dia ainda vale.
 */
export function linhaDaPrevisao(idInt: number | null | undefined, leitura: LeituraDasPrevisoes, hoje: string): LinhaDaPrevisao {
  if (!leitura.pronta) return { tipo: "OCULTA" };
  const prazo = leitura.porPedido.get(Number(idInt));
  const achado = prazo ? DATA_ISO.exec(prazo) : null;
  if (!achado) return { tipo: "SEM_PREVISAO", texto: "Sem previsão" };
  const [, ano, mes, dia] = achado;
  const diaIso = `${ano}-${mes}-${dia}`;
  return { tipo: "PREVISAO", texto: `Previsão: ${dia}/${mes}/${ano.slice(-2)}`, vencida: Boolean(hoje) && diaIso < hoje };
}
