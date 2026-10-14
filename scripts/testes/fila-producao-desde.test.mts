/**
 * Coluna "Em produção desde" da Fila — src/features/fiscal/lib/fila-producao-desde.ts
 *
 *   node --experimental-strip-types scripts/testes/fila-producao-desde.test.mts
 *
 * O QUE PROVA
 *   1. Linha 1: data e hora juntas, "dd/mm/aa hh:mm".
 *   2. Fuso: sempre Brasília, qualquer que seja o fuso da máquina — inclusive
 *      quando o instante em UTC já é o dia seguinte.
 *   3. "Sem previsão" quando a produção não definiu.
 *   4. Os estados do selo: no prazo, hoje e atrasado, com a contagem de dias.
 *   5. Falha ou carga da leitura: a linha 2 não aparece.
 *   6. A ordem da Fila pela previsão: atrasados e hoje, futuros, sem previsão no fim.
 */
import { dataHoraDeBrasilia, diasEntre, hojeEmBrasilia, linhaDaPrevisao, ordenarPelaPrevisao, previsaoPorPedido } from "../../src/features/fiscal/lib/fila-producao-desde.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : `\n       obtido:   ${JSON.stringify(obtido)}\n       esperado: ${JSON.stringify(esperado)}`}`);
}

// 1 e 2. Linha 1, em Brasília (UTC-3)
checar("data e hora juntas, dd/mm/aa hh:mm", dataHoraDeBrasilia("2026-10-07T20:16:00+00:00"), "07/10/26 17:16");
checar("banco em UTC ja no dia seguinte: em Brasilia ainda e o dia anterior", dataHoraDeBrasilia("2026-10-08T01:30:00.000Z"), "07/10/26 22:30");
checar("meia-noite em Brasilia sai 00:00, nao 24:00", dataHoraDeBrasilia("2026-10-08T03:00:00Z"), "08/10/26 00:00");
checar("virada de ano", dataHoraDeBrasilia("2027-01-01T02:59:00Z"), "31/12/26 23:59");
checar("carimbo com outro deslocamento da o mesmo instante", dataHoraDeBrasilia("2026-10-07T17:16:00-03:00"), "07/10/26 17:16");
checar("sem carimbo ou carimbo invalido: nulo (a tela mostra o traco)", [dataHoraDeBrasilia(null), dataHoraDeBrasilia(undefined), dataHoraDeBrasilia(""), dataHoraDeBrasilia("nao e data")], [null, null, null, null]);
{
  // O resultado não depende do fuso da máquina que roda.
  const original = process.env.TZ;
  const vistos = ["UTC", "Asia/Tokyo", "America/Los_Angeles", "America/Sao_Paulo"].map((tz) => {
    process.env.TZ = tz;
    return dataHoraDeBrasilia("2026-10-08T01:30:00.000Z");
  });
  if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  checar("mesmo texto com a maquina em UTC, Toquio, Los Angeles ou Sao Paulo", vistos, ["07/10/26 22:30", "07/10/26 22:30", "07/10/26 22:30", "07/10/26 22:30"]);
}
checar("hoje em Brasilia: 01:30 UTC do dia 8 ainda e dia 7", hojeEmBrasilia(new Date("2026-10-08T01:30:00Z")), "2026-10-07");
checar("hoje em Brasilia: 03:00 UTC do dia 8 ja e dia 8", hojeEmBrasilia(new Date("2026-10-08T03:00:00Z")), "2026-10-08");

// A leitura em lote: linhas espelhadas de propostas_os_setores, em ordem de criação
const mapa = previsaoPorPedido([
  { id_int: 23248, prazo: "2026-10-09" },
  { id_int: 23248, prazo: "2026-10-09" },
  { id_int: 23304, prazo: "2026-10-01" },
  { id_int: 23309, prazo: null },
  { id_int: 23400, prazo: "2026-10-08T00:00:00" },
  { id_int: "23401", prazo: "2026-10-07" },
  { id_int: 0, prazo: "2026-10-07" },
  { id_int: 23402, prazo: "texto" }
]);
checar("uma previsao por pedido; linha sem prazo ou invalida nao entra", [...mapa.entries()], [[23248, "2026-10-09"], [23304, "2026-10-01"], [23400, "2026-10-08"], [23401, "2026-10-07"]]);
checar("setores espelhados: vale a primeira linha com prazo", previsaoPorPedido([{ id_int: 1, prazo: null }, { id_int: 1, prazo: "2026-10-05" }, { id_int: 1, prazo: "2026-10-06" }]).get(1), "2026-10-05");

const pronta = { porPedido: mapa, pronta: true };
const HOJE = "2026-10-08";

// 3. Sem previsão
checar("pedido sem previsao da producao", linhaDaPrevisao(23309, pronta, HOJE), { tipo: "SEM_PREVISAO", texto: "Sem previsão" });
checar("pedido que nem tem OS", linhaDaPrevisao(99999, pronta, HOJE), { tipo: "SEM_PREVISAO", texto: "Sem previsão" });
checar("id invalido", [linhaDaPrevisao(null, pronta, HOJE).tipo, linhaDaPrevisao(undefined, pronta, HOJE).tipo], ["SEM_PREVISAO", "SEM_PREVISAO"]);

// 4. Os estados do selo: no prazo, hoje, atrasado (com a contagem de dias)
checar("no prazo (a partir de amanha)", linhaDaPrevisao(23248, pronta, HOJE), { tipo: "PREVISAO", estado: "NO_PRAZO", texto: "Previsão: 09/10/26", textoCurto: "Previsão: 09/10/26", diasDeAtraso: 0 });
checar("HOJE: o texto diz hoje", linhaDaPrevisao(23400, pronta, HOJE), { tipo: "PREVISAO", estado: "HOJE", texto: "Previsão: hoje, 08/10/26", textoCurto: "Previsão: hoje", diasDeAtraso: 0 });
checar("atrasado 1 dia: singular", linhaDaPrevisao(23401, pronta, HOJE), { tipo: "PREVISAO", estado: "ATRASADO", texto: "Atrasado: 07/10/26 (1 dia)", textoCurto: "Atrasado: 07/10/26", diasDeAtraso: 1 });
checar("atrasado 7 dias: plural", linhaDaPrevisao(23304, pronta, HOJE), { tipo: "PREVISAO", estado: "ATRASADO", texto: "Atrasado: 01/10/26 (7 dias)", textoCurto: "Atrasado: 01/10/26", diasDeAtraso: 7 });
checar("a data nao perde um dia (DATE sem fuso, sem passar por Date local)", (linhaDaPrevisao(23304, pronta, HOJE) as { texto: string }).texto.includes("01/10/26"), true);
checar("o estado usa o dia de Brasilia: 01:30 UTC do dia 8 ainda e dia 7, entao a previsao do dia 7 e HOJE", linhaDaPrevisao(23401, pronta, hojeEmBrasilia(new Date("2026-10-08T01:30:00Z"))), { tipo: "PREVISAO", estado: "HOJE", texto: "Previsão: hoje, 07/10/26", textoCurto: "Previsão: hoje", diasDeAtraso: 0 });
checar("contagem de dias atravessa mes e ano", [diasEntre("2026-09-30", "2026-10-08"), diasEntre("2025-12-31", "2026-01-01"), diasEntre("2026-10-08", "2026-10-08"), diasEntre("2026-10-09", "2026-10-08")], [8, 1, 0, -1]);
checar("contagem de dias com data invalida e NaN", [Number.isNaN(diasEntre("x", "2026-10-08")), Number.isNaN(diasEntre("2026-10-08", ""))], [true, true]);
checar("sem saber que dia e hoje nao acusa atraso", linhaDaPrevisao(23304, pronta, ""), { tipo: "PREVISAO", estado: "NO_PRAZO", texto: "Previsão: 01/10/26", textoCurto: "Previsão: 01/10/26", diasDeAtraso: 0 });
checar(
  "o texto sempre diz o estado (a cor nao e o unico sinal)",
  [23248, 23400, 23401, 23309].map((id) => { const l = linhaDaPrevisao(id, pronta, HOJE); return l.tipo === "OCULTA" ? "" : l.texto.split(/[:,]/)[0] + (l.tipo === "PREVISAO" && l.estado === "HOJE" ? " hoje" : ""); }),
  ["Previsão", "Previsão hoje", "Atrasado", "Sem previsão"]
);

// 5. Leitura carregando ou com falha
checar("leitura nao pronta: a linha 2 nao aparece, com ou sem dado", [linhaDaPrevisao(23248, { porPedido: mapa, pronta: false }, HOJE), linhaDaPrevisao(23309, { porPedido: new Map(), pronta: false }, HOJE)], [{ tipo: "OCULTA" }, { tipo: "OCULTA" }]);
checar("leitura pronta e vazia: todos Sem previsao", linhaDaPrevisao(23248, { porPedido: new Map(), pronta: true }, HOJE).tipo, "SEM_PREVISAO");

// 6. A ORDEM DA FILA pela previsao (14/10/2026): atrasados e hoje (mais atrasado no topo), futuros (mais proximo primeiro), sem previsao no fim
{
  const H = "2026-10-14";
  const prazos = new Map<number, string>([
    [1, "2026-10-20"], // futuro, mais distante
    [2, "2026-10-10"], // atrasado 4 dias
    [3, "2026-10-14"], // hoje
    [4, "2026-10-01"], // atrasado 13 dias: o mais atrasado
    [5, "2026-10-15"], // futuro, amanha
    [7, "2026-10-10"] // atrasado 4 dias, empata com o 2
  ]);
  const leitura = { porPedido: prazos, pronta: true };
  // A ordem que vem da consulta e por id_int decrescente; 6 e 8 nao tem previsao.
  const fila = [8, 7, 6, 5, 4, 3, 2, 1].map((id) => ({ id_int: id }));
  const ids = (l: { id_int?: number | null }[]) => l.map((i) => i.id_int);
  checar("ordem: atrasados (mais atrasado no topo), hoje, futuros (mais proximo primeiro), sem previsao no fim", ids(ordenarPelaPrevisao(fila, leitura, H)), [4, 7, 2, 3, 5, 1, 8, 6]);
  checar("ordem: empate de data e os sem previsao mantem a ordem que veio", ids(ordenarPelaPrevisao(fila, leitura, H)).filter((id) => [7, 2, 8, 6].includes(Number(id))), [7, 2, 8, 6]);
  checar("ordem: o do dia vem depois dos atrasados e antes do de amanha", ids(ordenarPelaPrevisao([{ id_int: 5 }, { id_int: 3 }, { id_int: 2 }], leitura, H)), [2, 3, 5]);
  checar("ordem: no dia seguinte a ordem segue certa sem gravar nada", ids(ordenarPelaPrevisao([{ id_int: 5 }, { id_int: 1 }, { id_int: 3 }], leitura, "2026-10-16")), [3, 5, 1]);
  checar("ordem: pedido que ganha data sobe sozinho (mesma lista, leitura nova)", ids(ordenarPelaPrevisao([{ id_int: 5 }, { id_int: 8 }], { porPedido: new Map([...prazos, [8, "2026-10-12"]]), pronta: true }, H)), [8, 5]);
  checar("ordem: leitura nao pronta mantem a ordem que veio", ids(ordenarPelaPrevisao(fila, { porPedido: prazos, pronta: false }, H)), [8, 7, 6, 5, 4, 3, 2, 1]);
  checar("ordem: leitura pronta e vazia mantem a ordem que veio", ids(ordenarPelaPrevisao(fila, { porPedido: new Map(), pronta: true }, H)), [8, 7, 6, 5, 4, 3, 2, 1]);
  checar("ordem: nao altera a lista recebida nem perde item", [ids(fila), ordenarPelaPrevisao(fila, leitura, H).length], [[8, 7, 6, 5, 4, 3, 2, 1], 8]);
  checar("ordem: sem saber que dia e hoje, ainda ordena pela data", ids(ordenarPelaPrevisao([{ id_int: 1 }, { id_int: 6 }, { id_int: 4 }], leitura, "")), [4, 1, 6]);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
