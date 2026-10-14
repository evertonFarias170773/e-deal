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
 * OS QUATRO ESTADOS DA LINHA 2 (08/10/2026) — o selo de components/SeloDaPrevisao
 *   NO_PRAZO  a partir de amanhã   "Previsão: dd/mm/aa"
 *   HOJE      o dia de hoje        "Previsão: hoje, dd/mm/aa" — na tabela, "Previsão: hoje"
 *   ATRASADO  dia anterior ou antes "Atrasado: dd/mm/aa (N dias)" — na tabela,
 *             onde não cabe, sai sem os dias (`textoCurto`) e os dias vão na dica
 *   sem previsão                   "Sem previsão"
 *   O texto diz o estado; a cor do selo só reforça.
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

export type EstadoDaPrevisao = "NO_PRAZO" | "HOJE" | "ATRASADO";

export type LinhaDaPrevisao =
  /** Leitura não pronta: a linha 2 não aparece. */
  | { tipo: "OCULTA" }
  | { tipo: "SEM_PREVISAO"; texto: "Sem previsão" }
  | { tipo: "PREVISAO"; estado: EstadoDaPrevisao; texto: string; /** Para onde o espaço é curto (a tabela): sem a contagem de dias do atraso e sem repetir a data de hoje. */ textoCurto: string; diasDeAtraso: number };

/** Dias inteiros entre dois dias civis "aaaa-mm-dd" (de → até); NaN se algum não for data. */
export function diasEntre(de: string, ate: string): number {
  const a = DATA_ISO.exec(de);
  const b = DATA_ISO.exec(ate);
  if (!a || !b) return NaN;
  // Meio-dia UTC dos dois lados: dia civil não tem fuso nem horário de verão.
  const ms = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]), 12) - Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]), 12);
  return Math.round(ms / 86_400_000);
}

/**
 * A segunda linha da célula. `hoje` é o dia em Brasília ("2026-10-08").
 * Atrasado = a previsão é de um dia ANTERIOR a hoje; a do próprio dia é "hoje".
 * Sem saber que dia é hoje, não há como dizer atraso: fica "no prazo".
 */
export function linhaDaPrevisao(idInt: number | null | undefined, leitura: LeituraDasPrevisoes, hoje: string): LinhaDaPrevisao {
  if (!leitura.pronta) return { tipo: "OCULTA" };
  const prazo = leitura.porPedido.get(Number(idInt));
  const achado = prazo ? DATA_ISO.exec(prazo) : null;
  if (!achado) return { tipo: "SEM_PREVISAO", texto: "Sem previsão" };
  const [, ano, mes, dia] = achado;
  const diaIso = `${ano}-${mes}-${dia}`;
  const data = `${dia}/${mes}/${ano.slice(-2)}`;
  const atraso = diasEntre(diaIso, hoje);
  if (Number.isFinite(atraso) && atraso > 0) {
    return { tipo: "PREVISAO", estado: "ATRASADO", texto: `Atrasado: ${data} (${atraso} ${atraso === 1 ? "dia" : "dias"})`, textoCurto: `Atrasado: ${data}`, diasDeAtraso: atraso };
  }
  if (atraso === 0) return { tipo: "PREVISAO", estado: "HOJE", texto: `Previsão: hoje, ${data}`, textoCurto: "Previsão: hoje", diasDeAtraso: 0 };
  return { tipo: "PREVISAO", estado: "NO_PRAZO", texto: `Previsão: ${data}`, textoCurto: `Previsão: ${data}`, diasDeAtraso: 0 };
}

/**
 * A ORDEM DA FILA PELA PREVISÃO DE ENTREGA (14/10/2026, pedido da Edina).
 *
 *   1. atrasados e os do dia (previsão até hoje, em Brasília), o mais atrasado no topo;
 *   2. depois os de data futura, do mais próximo ao mais distante;
 *   3. no fim, os pedidos sem previsão ainda (ex.: REVISAO ATENDENTE, sem boletim).
 *
 * A data é a de AGORA, lida de `propostas_os_setores.prazo` (a mesma do selo da
 * coluna), e nada é gravado: o pedido sobe sozinho quando a produção define a data.
 * Empate (mesma data, ou os dois sem previsão) mantém a ordem que veio — a sort é
 * estável. Enquanto a leitura das previsões não chegou, a ordem que veio é mantida,
 * para a lista não pular de "todos sem previsão" para a ordem certa.
 */
export function ordenarPelaPrevisao<T extends { id_int?: number | null }>(
  itens: readonly T[],
  leitura: LeituraDasPrevisoes,
  hoje: string
): T[] {
  if (!leitura.pronta) return [...itens];
  const chave = (item: T): { grupo: number; dia: string } => {
    const prazo = leitura.porPedido.get(Number(item.id_int));
    const achado = prazo ? DATA_ISO.exec(prazo) : null;
    if (!achado) return { grupo: 2, dia: "" };
    const dia = `${achado[1]}-${achado[2]}-${achado[3]}`;
    // Sem saber que dia é hoje, toda data conta como futura; a ordem pela data continua certa.
    return { grupo: hoje && dia <= hoje ? 0 : 1, dia };
  };
  return itens
    .map((item, posicao) => ({ item, posicao, ...chave(item) }))
    .sort((a, b) => a.grupo - b.grupo || (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0) || a.posicao - b.posicao)
    .map((x) => x.item);
}
