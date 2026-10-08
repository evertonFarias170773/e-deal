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
 *   4. Previsão vencida (dia anterior a hoje em Brasília); a do próprio dia não.
 *   5. Falha ou carga da leitura: a linha 2 não aparece.
 */
import { dataHoraDeBrasilia, hojeEmBrasilia, linhaDaPrevisao, previsaoPorPedido } from "../../src/features/fiscal/lib/fila-producao-desde.ts";

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

// 4. Previsão, no prazo e vencida
checar("previsao futura: dd/mm/aa, sem destaque", linhaDaPrevisao(23248, pronta, HOJE), { tipo: "PREVISAO", texto: "Previsão: 09/10/26", vencida: false });
checar("previsao de HOJE ainda nao venceu", linhaDaPrevisao(23400, pronta, HOJE), { tipo: "PREVISAO", texto: "Previsão: 08/10/26", vencida: false });
checar("previsao de ontem: vencida", linhaDaPrevisao(23401, pronta, HOJE), { tipo: "PREVISAO", texto: "Previsão: 07/10/26", vencida: true });
checar("previsao antiga: vencida", linhaDaPrevisao(23304, pronta, HOJE), { tipo: "PREVISAO", texto: "Previsão: 01/10/26", vencida: true });
checar("a data da previsao nao perde um dia (DATE sem fuso, sem passar por Date)", linhaDaPrevisao(23304, pronta, HOJE).tipo === "PREVISAO" && (linhaDaPrevisao(23304, pronta, HOJE) as { texto: string }).texto, "Previsão: 01/10/26");
checar("vencida usa o dia de Brasilia: 01:30 UTC do dia 8 ainda e dia 7, entao dia 7 nao venceu", linhaDaPrevisao(23401, pronta, hojeEmBrasilia(new Date("2026-10-08T01:30:00Z"))), { tipo: "PREVISAO", texto: "Previsão: 07/10/26", vencida: false });

// 5. Leitura carregando ou com falha
checar("leitura nao pronta: a linha 2 nao aparece, com ou sem dado", [linhaDaPrevisao(23248, { porPedido: mapa, pronta: false }, HOJE), linhaDaPrevisao(23309, { porPedido: new Map(), pronta: false }, HOJE)], [{ tipo: "OCULTA" }, { tipo: "OCULTA" }]);
checar("leitura pronta e vazia: todos Sem previsao", linhaDaPrevisao(23248, { porPedido: new Map(), pronta: true }, HOJE).tipo, "SEM_PREVISAO");

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
