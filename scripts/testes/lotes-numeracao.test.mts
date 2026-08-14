/**
 * Testes da sequência de numeração dos lotes da grade ("Lista rápida").
 *
 *   node --experimental-strip-types scripts/testes/lotes-numeracao.test.mts
 *
 * Numeração errada só aparece na produção, com o material já impresso. Rode
 * depois de mexer em src/features/orcamentos/services/lotes-numeracao.ts.
 */
import { aplicarNumeracao, rotuloFaixa } from "../../src/features/orcamentos/services/lotes-numeracao.ts";

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

/** Numerador comum: uma numeração por unidade. */
const fimSimples = (inicio: number, qtd: number) => inicio + qtd - 1;
/** Numerador TICKET com ticket_qtd = 2: duas numerações por unidade. */
const fimTicket2 = (inicio: number, qtd: number) => inicio + qtd * 2 - 1;
/** TICKET sem ticket_qtd cadastrado: não dá para calcular. */
const fimIndefinido = () => null;

const faixas = (linhas: { numeracao_inicio?: number | null; numeracao_fim?: number | null }[]) =>
  linhas.map((l) => [l.numeracao_inicio ?? null, l.numeracao_fim ?? null]);

const tresLotes = [
  { nome_modelo: "Pista", quantidade: 300 as number | "" },
  { nome_modelo: "Camarote", quantidade: 150 as number | "" },
  { nome_modelo: "Vip", quantidade: 80 as number | "" }
];

// — Sem modo escolhido: a grade não encosta na numeração —
const jaGravados = [
  { quantidade: 300 as number | "", numeracao_inicio: 5001, numeracao_fim: 5300 }
];
checar("sem modo: devolve a mesma lista", aplicarNumeracao(jaGravados, null, fimSimples) === jaGravados, true);
checar("sem modo: numeracao do banco intacta", faixas(aplicarNumeracao(jaGravados, null, fimSimples)), [[5001, 5300]]);

// — Cada modelo do 1 —
checar(
  "cada do 1: todos comecam em 1",
  faixas(aplicarNumeracao(tresLotes, "CADA_DO_1", fimSimples)),
  [[1, 300], [1, 150], [1, 80]]
);

// — Sequencial: o exemplo do dono (300 -> proximo comeca em 301) —
checar(
  "sequencial: um continua o anterior",
  faixas(aplicarNumeracao(tresLotes, "SEQUENCIAL", fimSimples)),
  [[1, 300], [301, 450], [451, 530]]
);

// — Numerador TICKET consome ticket_qtd por unidade —
checar(
  "sequencial + ticket x2: a faixa dobra e a sequencia acompanha",
  faixas(aplicarNumeracao(tresLotes, "SEQUENCIAL", fimTicket2)),
  [[1, 600], [601, 900], [901, 1060]]
);
checar(
  "cada do 1 + ticket x2",
  faixas(aplicarNumeracao(tresLotes, "CADA_DO_1", fimTicket2)),
  [[1, 600], [1, 300], [1, 160]]
);

// — Lote sem quantidade: nao numera e nao move a sequencia —
const comVazia = [
  { quantidade: 300 as number | "" },
  { quantidade: "" as number | "" },
  { quantidade: 150 as number | "" }
];
checar(
  "linha em branco no meio nao quebra a sequencia",
  faixas(aplicarNumeracao(comVazia, "SEQUENCIAL", fimSimples)),
  [[1, 300], [null, null], [301, 450]]
);
checar(
  "linha em branco tambem nao numera no modo cada-do-1",
  faixas(aplicarNumeracao(comVazia, "CADA_DO_1", fimSimples)),
  [[1, 300], [null, null], [1, 150]]
);

// — Quantidade invalida —
checar(
  "quantidade zero nao numera",
  faixas(aplicarNumeracao([{ quantidade: 0 as number | "" }], "SEQUENCIAL", fimSimples)),
  [[null, null]]
);
checar(
  "quantidade negativa nao numera",
  faixas(aplicarNumeracao([{ quantidade: -5 as number | "" }], "SEQUENCIAL", fimSimples)),
  [[null, null]]
);
checar(
  "numeracao anterior e apagada quando a linha fica sem quantidade",
  faixas(aplicarNumeracao([{ quantidade: "" as number | "", numeracao_inicio: 10, numeracao_fim: 20 }], "SEQUENCIAL", fimSimples)),
  [[null, null]]
);

// — Multiplicador desconhecido (TICKET sem ticket_qtd) —
checar(
  "fim indefinido: faixa aberta e sequencia segue pela quantidade",
  faixas(aplicarNumeracao(tresLotes, "SEQUENCIAL", fimIndefinido)),
  [[1, null], [301, null], [451, null]]
);

// — O resto da linha nao pode ser perdido —
const preservado = aplicarNumeracao(
  [{ nome_modelo: "Pista", padrao: "Branco", quantidade: 300 as number | "", id: 77 }],
  "SEQUENCIAL",
  fimSimples
);
checar("campos da linha preservados", [preservado[0].nome_modelo, preservado[0].padrao, preservado[0].id], ["Pista", "Branco", 77]);
checar("lista de entrada nao e mutada", tresLotes[0].numeracao_inicio === undefined, true);
checar("quantidade de linhas preservada", aplicarNumeracao(tresLotes, "SEQUENCIAL", fimSimples).length, 3);

// — Lista vazia —
checar("lista vazia", aplicarNumeracao([], "SEQUENCIAL", fimSimples), []);

// — Rotulo da faixa —
checar("rotulo: faixa completa", rotuloFaixa(1, 300), "1–300");
checar("rotulo: milhar com separador", rotuloFaixa(1301, 12450), "1.301–12.450");
checar("rotulo: sem inicio", rotuloFaixa(null, null), "—");
checar("rotulo: sem fim", rotuloFaixa(451, null), "451–?");
checar("rotulo: indefinido", rotuloFaixa(undefined, undefined), "—");

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exit(falhas === 0 ? 0 : 1);
