/**
 * Data inválida não derruba a tela nem é gravada (09/10/2026, pedido 23380).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/data-invalida.test.mts
 *
 * O QUE PROVA
 *   1. O valor do 23380 (`pedidos_artes.data_evento` = 20206-11-07) passa pelos
 *      formatadores sem lançar e volta como texto cru. Antes: RangeError no
 *      render do boletim, e a página inteira caía.
 *   2. Nulo, vazio e undefined não lançam.
 *   3. Data válida sai exatamente como sempre saiu.
 *   4. A data do evento só é aceita entre 1900 e 9999, no campo e na gravação:
 *      `salvarBriefingArtes` recusa antes de chegar ao banco.
 *
 * Sem banco: nenhuma requisição sai daqui.
 */
import { formatDataCivil, formatDate, formatDateTime } from "../../src/lib/formatters/date.ts";
import {
  DATA_EVENTO_MAX,
  DATA_EVENTO_MIN,
  MENSAGEM_DATA_EVENTO_FORA,
  dataDoEventoNoIntervalo
} from "../../src/features/orcamentos/lib/data-do-evento.ts";
import { salvarBriefingArtes } from "../../src/features/pedidos/services/pedidos-artes.service.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else {
    console.log(`ok      ${nome}`);
  }
}

/** Devolve o resultado ou a mensagem do erro, para o teste enxergar o lançamento. */
function semLancar(fn: () => unknown): unknown {
  try {
    return fn();
  } catch (e) {
    return `LANCOU: ${(e as Error).message}`;
  }
}

// ── 1. O valor do 23380 ─────────────────────────────────────────────────────
const DO_23380 = "20206-11-07T00:00:00+00:00";
checar("23380: formatDataCivil devolve o texto cru", semLancar(() => formatDataCivil(DO_23380)), DO_23380);
checar("23380: formatDate devolve o texto cru", semLancar(() => formatDate(DO_23380)), DO_23380);
checar("23380: formatDateTime devolve o texto cru", semLancar(() => formatDateTime(DO_23380)), DO_23380);
checar("texto solto volta como veio", semLancar(() => formatDate("amanha")), "amanha");

// ── 2. Nulo, vazio e undefined ──────────────────────────────────────────────
checar("vazio: formatDate", semLancar(() => formatDate("")), "");
checar("vazio: formatDateTime", semLancar(() => formatDateTime("")), "");
checar("vazio: formatDataCivil", semLancar(() => formatDataCivil("")), "");
checar("undefined: formatDate", semLancar(() => formatDate(undefined as never)), "");
checar("undefined: formatDateTime", semLancar(() => formatDateTime(undefined as never)), "");
// `new Date(null)` é uma data VÁLIDA (01/01/1970 UTC): sai como sempre saiu.
checar("nulo: formatDataCivil segue como era", semLancar(() => formatDataCivil(null as never)), "31/12/1969");
checar("nulo: formatDate segue como era", semLancar(() => formatDate(null as never)), "31/12/1969");
checar("Date inválido: formatDate", semLancar(() => formatDate(new Date("x"))), "Invalid Date");

// ── 3. Data válida não muda ─────────────────────────────────────────────────
checar("formatDate com hora", formatDate("2026-11-07T15:00:00+00:00"), "07/11/2026");
checar("formatDate vira o dia no fuso de São Paulo", formatDate("2026-11-07T00:00:00+00:00"), "06/11/2026");
checar("formatDate com Date", formatDate(new Date("2026-11-07T15:00:00Z")), "07/11/2026");
checar("formatDataCivil", formatDataCivil("2026-11-07"), "07/11/2026");
checar("formatDataCivil com hora", formatDataCivil("2026-11-07T00:00:00+00:00"), "07/11/2026");
checar(
  "formatDateTime",
  formatDateTime("2026-11-07T15:30:00+00:00").replace(",", ""),
  "07/11/2026 12:30"
);

// ── 4. Intervalo da data do evento ──────────────────────────────────────────
checar("limites do campo", [DATA_EVENTO_MIN, DATA_EVENTO_MAX], ["1900-01-01", "9999-12-31"]);
checar("vazio é aceito (data opcional)", [dataDoEventoNoIntervalo(""), dataDoEventoNoIntervalo(null), dataDoEventoNoIntervalo(undefined)], [true, true, true]);
checar("data normal", dataDoEventoNoIntervalo("2026-11-07"), true);
checar("data normal com hora (como a aba grava)", dataDoEventoNoIntervalo("2026-11-07T00:00:00"), true);
checar("bordas", [dataDoEventoNoIntervalo("1900-01-01"), dataDoEventoNoIntervalo("9999-12-31")], [true, true]);
checar("ano de 5 dígitos (23380)", dataDoEventoNoIntervalo("20206-11-07"), false);
checar("ano de 5 dígitos com hora (23380)", dataDoEventoNoIntervalo("20206-11-07T00:00:00"), false);
checar("antes de 1900", dataDoEventoNoIntervalo("1899-12-31"), false);
checar("ano 0202 (digitação pela metade)", dataDoEventoNoIntervalo("0202-11-07"), false);
checar("mês inexistente", dataDoEventoNoIntervalo("2026-13-07"), false);
checar("texto solto", dataDoEventoNoIntervalo("amanha"), false);

// Gravacao: recusa antes de procurar o cliente do banco. Neste teste nao ha
// cliente (sem .env no Node), entao nada sai daqui em nenhum dos casos.
async function tentarSalvar(payload: Record<string, unknown>): Promise<string> {
  try {
    await salvarBriefingArtes(23380, payload as never);
    return "passou";
  } catch (e) {
    return (e as Error).message;
  }
}
checar("salvarBriefingArtes recusa o ano do 23380", await tentarSalvar({ nome_evento: "Jantar", data_evento: "20206-11-07T00:00:00" }), MENSAGEM_DATA_EVENTO_FORA);
checar("salvarBriefingArtes aceita data normal", await tentarSalvar({ nome_evento: "Jantar", data_evento: "2026-11-07T00:00:00" }), "passou");
checar("salvarBriefingArtes aceita payload sem data", await tentarSalvar({ status: "AGUARDANDO" }), "passou");
checar("salvarBriefingArtes aceita data nula", await tentarSalvar({ data_evento: null }), "passou");

if (falhas > 0) {
  console.log(`\n${falhas} verificacao(oes) falharam.`);
  process.exit(1);
}
console.log("\nTudo certo.");
