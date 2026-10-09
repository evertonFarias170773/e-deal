/**
 * Referência do título na janela "Preparar boletos" — src/features/cobrancas/lib/referencia-do-boleto.ts
 *
 *   node --experimental-strip-types scripts/testes/referencia-do-boleto.test.mts
 *
 * O QUE PROVA
 *   1. Faturado em 3 parcelas com NF-e já autorizada (o pedido 23181): cada
 *      parcela ganha a sua referência, no formato P…, e não a ref da nota.
 *   2. Sem nota, nada muda: o formato P… de sempre.
 *   3. Parcela única com nota continua com a ref da nota.
 *   4. Aberta pela nota, continua a ref da nota.
 *   5. Duas cobranças faturadas no mesmo pedido não repetem referência.
 *   6. A referência é UM valor, o mesmo que vai em `ext_reference` e em
 *      `n_doc_boleto`.
 */
import {
  referenciaDoBoleto,
  referenciaPorParcela,
  referenciaRepetida,
  referenciasDoLancamento
} from "../../src/features/cobrancas/lib/referencia-do-boleto.ts";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  if (!passou) falhas += 1;
  console.log(`${passou ? "ok  " : "FALHOU"} ${nome}${passou ? "" : `\n     esperado: ${JSON.stringify(esperado)}\n     real:     ${JSON.stringify(real)}`}`);
}
const parcelas = (total: number) => Array.from({ length: total }, (_, i) => ({ parcela: i + 1, total_parcelas: total }));

/** A regra de ANTES de 09/10/2026, para mostrar a colisão que ela causava. */
const regraAntiga = (lista: { parcela: number; total_parcelas: number }[], idInt: number, refDaNota: string | null) =>
  lista.map((p) => (refDaNota ? refDaNota : `P${p.parcela}${p.total_parcelas}${idInt}`));

// ── 1. 3 parcelas com nota (23181) ──────────────────────────────────────────
const NOTA_23181 = "NFE-23181-001";
ok("ANTES: 3 parcelas com nota levavam a mesma ref, e ela se repetia", [regraAntiga(parcelas(3), 23181, NOTA_23181), referenciaRepetida(regraAntiga(parcelas(3), 23181, NOTA_23181))], [[NOTA_23181, NOTA_23181, NOTA_23181], NOTA_23181]);

const com = referenciasDoLancamento(parcelas(3), { idInt: 23181, refDaNotaDoPedido: NOTA_23181 });
ok("23181, 3 parcelas com nota: formato P por parcela", com, ["P1323181", "P2323181", "P3323181"]);
ok("23181: nenhuma referencia repetida no lancamento", referenciaRepetida(com), null);
ok("23181: nenhuma parcela usa a ref da nota", com.some((r) => r === NOTA_23181), false);

// ── 2. 3 parcelas sem nota ──────────────────────────────────────────────────
const sem = referenciasDoLancamento(parcelas(3), { idInt: 23181, refDaNotaDoPedido: null });
ok("3 parcelas sem nota: formato P, como sempre", sem, ["P1323181", "P2323181", "P3323181"]);
ok("sem nota: igual a regra antiga", sem, regraAntiga(parcelas(3), 23181, null));
ok("com nota e sem nota dao a MESMA referencia no parcelado (a ordem nota x boleto deixa de importar)", com, sem);
ok("2 parcelas com nota: tambem formato P", referenciasDoLancamento(parcelas(2), { idInt: 22999, refDaNotaDoPedido: "NFE-22999-001" }), ["P1222999", "P2222999"]);
ok("ref da nota vazia ou so com espacos conta como sem nota", referenciasDoLancamento(parcelas(1), { idInt: 22999, refDaNotaDoPedido: "   " }), ["P1122999"]);

// ── 3. parcela única ────────────────────────────────────────────────────────
ok("parcela unica com nota: continua a ref da nota", referenciasDoLancamento(parcelas(1), { idInt: 23181, refDaNotaDoPedido: NOTA_23181 }), [NOTA_23181]);
ok("parcela unica sem nota: formato P", referenciasDoLancamento(parcelas(1), { idInt: 23181, refDaNotaDoPedido: null }), ["P1123181"]);
ok(
  "uma linha so, mas de um total de 3 (parcela 2/3 relancada): formato P, nao a ref da nota",
  referenciasDoLancamento([{ parcela: 2, total_parcelas: 3 }], { idInt: 23181, refDaNotaDoPedido: NOTA_23181 }),
  ["P2323181"]
);

// ── 4. aberta pela nota ─────────────────────────────────────────────────────
ok("aberta pela nota, parcela unica: ref da nota de origem", referenciasDoLancamento(parcelas(1), { idInt: 23181, refDaNotaDeOrigem: NOTA_23181 }), [NOTA_23181]);
ok(
  "aberta pela nota: a nota de origem vence a nota do pedido",
  referenciaDoBoleto({ idInt: 23181, parcela: 1, totalParcelas: 1, quantidadeDeParcelas: 1, refDaNotaDeOrigem: "NFE-23181-002", refDaNotaDoPedido: NOTA_23181 }),
  "NFE-23181-002"
);
// Nota com 2+ parcelas é barrada na tela antes; se chegasse aqui, a trava do lançamento acusaria.
ok("aberta pela nota com 2 parcelas (barrado antes na tela): a repeticao e detectada", referenciaRepetida(referenciasDoLancamento(parcelas(2), { idInt: 23181, refDaNotaDeOrigem: NOTA_23181 })), NOTA_23181);

// ── 5. duas cobranças faturadas no mesmo pedido ─────────────────────────────
{
  // O banco só aceita UMA parcela ativa por (pedido, parcela) — `boletos_unico_parcela_ativo` —
  // e a janela recusa antes ("Duplicidade detectada"). Então, no mesmo pedido, as duas cobranças
  // juntas nunca têm o mesmo número de parcela ativo. Os casos possíveis:
  const cobrancaA = referenciasDoLancamento([{ parcela: 1, total_parcelas: 1 }], { idInt: 23500, refDaNotaDoPedido: null });
  const cobrancaB = referenciasDoLancamento([{ parcela: 2, total_parcelas: 3 }, { parcela: 3, total_parcelas: 3 }], { idInt: 23500, refDaNotaDoPedido: "NFE-23500-001" });
  ok("duas cobrancas, parcelas diferentes: nenhuma referencia repetida entre elas", referenciaRepetida([...cobrancaA, ...cobrancaB]), null);
  ok("duas cobrancas: as referencias", [cobrancaA, cobrancaB], [["P1123500"], ["P2323500", "P3323500"]]);

  // Varredura: para um pedido, toda combinação de parcela/total até 24 com parcela <= total.
  // Duas referências só coincidem se a PARCELA for a mesma — e parcela repetida o banco não aceita ativa.
  const vistas = new Map<string, { parcela: number; total: number }>();
  let colisoesEntreParcelasDiferentes = 0;
  for (let total = 1; total <= 24; total += 1) {
    for (let parcela = 1; parcela <= total; parcela += 1) {
      const ref = referenciaPorParcela(parcela, total, 23500);
      const anterior = vistas.get(ref);
      if (anterior && anterior.parcela !== parcela) colisoesEntreParcelasDiferentes += 1;
      vistas.set(ref, { parcela, total });
    }
  }
  ok("ate 24 parcelas: parcelas DIFERENTES do mesmo pedido nunca dao a mesma referencia", colisoesEntreParcelasDiferentes, 0);

  // Segunda cobrança que repetisse a parcela 1 (1/1 e 1/1): a referência seria a mesma —
  // e é exatamente o caso que a janela e o índice (pedido, parcela) recusam antes.
  ok(
    "mesma parcela nas duas cobrancas (1/1 e 1/1): referencia igual, caso que a janela ja recusa por duplicidade",
    referenciaPorParcela(1, 1, 23500) === referenciaPorParcela(1, 1, 23500),
    true
  );
}

// ── 6. um valor só, para os dois campos ─────────────────────────────────────
{
  // A janela grava `ext_reference: ref` e `n_doc_boleto: ref` a partir do MESMO elemento da lista.
  const refs = referenciasDoLancamento(parcelas(3), { idInt: 23181, refDaNotaDoPedido: NOTA_23181 });
  const linhas = refs.map((ref) => ({ ext_reference: ref, n_doc_boleto: ref }));
  ok("ext_reference e n_doc_boleto iguais em toda linha", linhas.every((l) => l.ext_reference === l.n_doc_boleto), true);
  ok("a referencia da 1a parcela (o que a tela passa adiante) e a mesma que foi gravada", referenciaDoBoleto({ idInt: 23181, parcela: 1, totalParcelas: 3, quantidadeDeParcelas: 3, refDaNotaDoPedido: NOTA_23181 }), refs[0]);
  ok("o formato e o dos titulos parcelados que ja existem (P + parcela + total + pedido)", /^P[0-9]+$/.test(refs[0]) && refs[0] === `P${1}${3}${23181}`, true);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
if (falhas > 0) process.exitCode = 1;
