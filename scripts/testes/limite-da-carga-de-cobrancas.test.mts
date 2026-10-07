/**
 * Teto da carga de cobranças — src/features/cobrancas/lib/limite-da-carga.ts
 *
 *   node --experimental-strip-types scripts/testes/limite-da-carga-de-cobrancas.test.mts
 *
 * O QUE PROVA
 *   1. O limite é 30.000, múltiplo da página de 1.000.
 *   2. Abaixo do limite a leitura é completa; no limite e acima, incompleta.
 *   3. A carga incompleta NÃO sai como "OK": tem status próprio e o aviso.
 *   4. Vazia continua vazia, e OK continua OK, como antes.
 *   5. Uma leitura em páginas, simulada com um limite pequeno, para no limite
 *      e é marcada incompleta quando a tabela tem mais linhas do que ele.
 */
import {
  AVISO_DE_CARGA_INCOMPLETA,
  COBRANCAS_POR_PAGINA,
  LIMITE_DE_COBRANCAS_NA_CARGA,
  leituraBateuNoLimite,
  mensagemDaLeituraDeCobrancas,
  statusDaLeituraDeCobrancas
} from "../../src/features/cobrancas/lib/limite-da-carga.ts";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  if (!passou) falhas += 1;
  console.log(`${passou ? "ok  " : "FALHOU"} ${nome}${passou ? "" : `\n     esperado: ${JSON.stringify(esperado)}\n     real:     ${JSON.stringify(real)}`}`);
}

// ── 1. O limite ─────────────────────────────────────────────────────────────
ok("o limite da carga e 30.000", LIMITE_DE_COBRANCAS_NA_CARGA, 30000);
ok("a pagina continua de 1.000", COBRANCAS_POR_PAGINA, 1000);
ok("o limite e multiplo da pagina", LIMITE_DE_COBRANCAS_NA_CARGA % COBRANCAS_POR_PAGINA, 0);

// ── 2. Abaixo, no limite e acima ────────────────────────────────────────────
ok("9.802 linhas (hoje): completa", leituraBateuNoLimite(9802), false);
ok("29.999 linhas: completa", leituraBateuNoLimite(29999), false);
ok("30.000 linhas, no limite: incompleta", leituraBateuNoLimite(30000), true);
ok("acima do limite: incompleta", leituraBateuNoLimite(30001), true);
ok("nenhuma linha: completa", leituraBateuNoLimite(0), false);
ok("limite informado: abaixo, no limite e acima", [leituraBateuNoLimite(9, 10), leituraBateuNoLimite(10, 10), leituraBateuNoLimite(11, 10)], [false, true, true]);
ok("com o limite antigo, as 9.802 de hoje ainda caberiam; 10.000 nao", [leituraBateuNoLimite(9802, 10000), leituraBateuNoLimite(10000, 10000)], [false, true]);

// ── 3 e 4. O status da leitura ──────────────────────────────────────────────
ok("abaixo do limite: OK", statusDaLeituraDeCobrancas({ total: 9802, incompleta: false }), "OK");
ok("sem a marca de incompleta: OK", statusDaLeituraDeCobrancas({ total: 9802 }), "OK");
ok("no limite: INCOMPLETA, e nao OK", statusDaLeituraDeCobrancas({ total: 30000, incompleta: leituraBateuNoLimite(30000) }), "INCOMPLETA");
ok("leitura sem nenhuma cobranca: VAZIA", statusDaLeituraDeCobrancas({ total: 0, vazia: true }), "VAZIA");
ok("total zero sem a marca: VAZIA", statusDaLeituraDeCobrancas({ total: 0 }), "VAZIA");
ok("vazia vem antes de incompleta", statusDaLeituraDeCobrancas({ total: 0, vazia: true, incompleta: true }), "VAZIA");

ok("o aviso tem o texto pedido", AVISO_DE_CARGA_INCOMPLETA, "Lista incompleta: há mais cobranças do que o limite carregado. Avise o suporte.");
ok("carga incompleta leva o aviso", mensagemDaLeituraDeCobrancas("INCOMPLETA"), AVISO_DE_CARGA_INCOMPLETA);
ok("carga vazia mantem a mensagem de antes", mensagemDaLeituraDeCobrancas("VAZIA"), "A última leitura não trouxe nenhuma cobrança.");
ok("carga OK nao tem mensagem", mensagemDaLeituraDeCobrancas("OK"), undefined);

// ── 5. Leitura em páginas com um limite pequeno ─────────────────────────────
// Mesma forma da leitura real: faixas fixas até o limite, cinco por onda, e a
// onda que traz uma página incompleta encerra.
function lerEmPaginas(linhasNaTabela: number, limite: number, pagina: number, porOnda = 5) {
  const faixas: Array<{ de: number; ate: number }> = [];
  for (let de = 0; de < limite; de += pagina) faixas.push({ de, ate: de + pagina - 1 });
  let lidas = 0;
  let requisicoes = 0;
  for (let i = 0; i < faixas.length; i += porOnda) {
    const onda = faixas.slice(i, i + porOnda);
    const tamanhos = onda.map((f) => Math.max(0, Math.min(f.ate + 1, linhasNaTabela) - f.de));
    requisicoes += onda.length;
    lidas += tamanhos.reduce((a, b) => a + b, 0);
    if (tamanhos.some((t) => t < pagina)) break;
  }
  return { lidas, requisicoes, incompleta: leituraBateuNoLimite(lidas, limite) };
}
ok("limite 30, tabela com 12: le as 12 e a carga e completa", lerEmPaginas(12, 30, 10, 2), { lidas: 12, requisicoes: 2, incompleta: false });
ok("limite 30, tabela com 29: completa", lerEmPaginas(29, 30, 10, 2), { lidas: 29, requisicoes: 3, incompleta: false });
ok("limite 30, tabela com 30: no limite, incompleta", lerEmPaginas(30, 30, 10, 2), { lidas: 30, requisicoes: 3, incompleta: true });
ok("limite 30, tabela com 45: para em 30 e fica incompleta", lerEmPaginas(45, 30, 10, 2), { lidas: 30, requisicoes: 3, incompleta: true });
ok(
  "hoje (9.802 linhas, limite 30.000): as mesmas 10 paginas de antes, completa",
  lerEmPaginas(9802, LIMITE_DE_COBRANCAS_NA_CARGA, COBRANCAS_POR_PAGINA),
  { lidas: 9802, requisicoes: 10, incompleta: false }
);
ok(
  "com o limite antigo e 10.050 linhas: perdia 50 e (pela regra nova) acusaria",
  lerEmPaginas(10050, 10000, 1000),
  { lidas: 10000, requisicoes: 10, incompleta: true }
);
ok(
  "com o limite novo e 10.050 linhas: le todas, em 15 paginas, completa",
  lerEmPaginas(10050, LIMITE_DE_COBRANCAS_NA_CARGA, COBRANCAS_POR_PAGINA),
  { lidas: 10050, requisicoes: 15, incompleta: false }
);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
if (falhas > 0) process.exitCode = 1;
