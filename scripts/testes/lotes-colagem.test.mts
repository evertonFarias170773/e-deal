/**
 * Testes da leitura da lista de lotes colada pelo vendedor.
 *
 *   node --experimental-strip-types scripts/testes/lotes-colagem.test.mts
 *
 * É aqui que dado se perde em silêncio: uma linha mal interpretada vira lote
 * errado na produção. Rode depois de mexer em
 * src/features/orcamentos/services/lotes-colagem.ts.
 */
import { interpretarColagem, somaQuantidades } from "../../src/features/orcamentos/services/lotes-colagem.ts";

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

const cores = [
  { id: 1, name: "Verde Água" },
  { id: 2, name: "Branco" },
  { id: 3, name: "Rosa Claro" }
];

// — Formato de planilha (TAB) —
const planilha = interpretarColagem("Verde Água\t500\nBranco\t1200\nRosa Claro\t300", cores);
checar("planilha: tres linhas", planilha.length, 3);
checar("planilha: cores casadas", planilha.map((l) => l.padrao), ["Verde Água", "Branco", "Rosa Claro"]);
checar("planilha: quantidades", planilha.map((l) => l.quantidade), [500, 1200, 300]);

// — Digitado à mão —
checar(
  "ponto e virgula funciona",
  interpretarColagem("Branco;250", cores).map((l) => [l.padrao, l.quantidade]),
  [["Branco", 250]]
);
checar(
  "virgula funciona",
  interpretarColagem("Branco,250", cores).map((l) => l.quantidade),
  [250]
);

// — Acento e caixa não podem decidir se o lote entra —
checar(
  "sem acento casa mesmo assim",
  interpretarColagem("verde agua\t100", cores).map((l) => l.padrao),
  ["Verde Água"]
);
checar(
  "caixa alta casa",
  interpretarColagem("BRANCO\t100", cores).map((l) => l.padrao),
  ["Branco"]
);
checar(
  "espaco sobrando casa",
  interpretarColagem("  Rosa   Claro  \t100", cores).map((l) => l.padrao),
  ["Rosa Claro"]
);

// — Cor com espaço no nome: a quantidade é o ÚLTIMO campo, não o segundo —
checar(
  "cor de duas palavras nao vira duas colunas",
  interpretarColagem("Verde Água\t500", cores).map((l) => [l.padrao, l.quantidade]),
  [["Verde Água", 500]]
);

// — Cor desconhecida não pode sumir em silêncio —
const desconhecida = interpretarColagem("Azul Turquesa\t400", cores);
checar("cor desconhecida entra na lista", desconhecida.length, 1);
checar("cor desconhecida fica sem padrao", desconhecida[0].padrao, null);
checar("cor desconhecida guarda o texto colado", desconhecida[0].corNaoReconhecida, "Azul Turquesa");
checar("cor desconhecida preserva a quantidade", desconhecida[0].quantidade, 400);

// — Ruído que deve ser descartado —
checar("cabecalho da planilha e ignorado", interpretarColagem("Cor\tQuantidade\nBranco\t100", cores).length, 1);
checar("linha em branco e ignorada", interpretarColagem("Branco\t100\n\n\nBranco\t200", cores).length, 2);
checar("linha sem numero e ignorada", interpretarColagem("Branco\nBranco\t200", cores).length, 1);
checar("quantidade zero e ignorada", interpretarColagem("Branco\t0", cores).length, 0);
checar("quantidade negativa e ignorada", interpretarColagem("Branco\t-50", cores).length, 0);

// — Números como o brasileiro escreve —
checar("separador de milhar", interpretarColagem("Branco\t1.500", cores)[0].quantidade, 1500);
checar("decimal vira inteiro", interpretarColagem("Branco\t100,4", cores)[0].quantidade, 100);
checar("decimal arredonda para cima", interpretarColagem("Branco\t100,6", cores)[0].quantidade, 101);

// — Soma —
checar("soma ignora campo vazio", somaQuantidades([{ quantidade: 100 }, { quantidade: "" }, { quantidade: 50 }]), 150);
checar("soma de lista vazia", somaQuantidades([]), 0);

// — Caso real: 13 lotes, mesmo produto, cores diferentes —
const treze = Array.from({ length: 13 }, (_, i) => `Branco\t${(i + 1) * 100}`).join("\n");
const lidos = interpretarColagem(treze, cores);
checar("treze linhas de uma vez", lidos.length, 13);
checar("soma dos treze", somaQuantidades(lidos), 9100);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exit(falhas === 0 ? 0 : 1);
