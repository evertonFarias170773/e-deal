/**
 * Testes da regra de variacoes no card do modelo do PDF da OS (27/10/2026).
 *
 *   node --experimental-strip-types scripts/testes/variacoes-no-card-os.test.mts
 *
 * Item com checklist imprime toda variacao gravada, marcada ou nao no
 * checklist. Item sem variacao continua sem. Item anterior ao checklist (sem
 * snapshot) continua como sempre saiu: sem variacoes.
 * Rode depois de mexer em src/features/pedidos/lib/variacao-textil.ts.
 */
import { variacoesQueSaemNoCard, linhaDeVariacaoNoCard } from "../../src/features/pedidos/lib/variacao-textil.ts";

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

// Caso real: OS 24263, produto 3001 Cordao 85cm, checklist so imagem + F/V.
const acabamento24263 = ["Acabamento: Jacaré Metálico", "Acessórios: Chapinha Metálica"];
checar(
  "checklist curto (3001) imprime acabamento e acessorio",
  variacoesQueSaemNoCard(["imagem", "impressao_fv"], acabamento24263),
  acabamento24263
);
checar(
  "checklist so com imagem (23984) tambem imprime",
  variacoesQueSaemNoCard(["imagem"], ["Acessórios: Chapinha Metálica", "Acabamento: Mosquete Metal"]),
  ["Acessórios: Chapinha Metálica", "Acabamento: Mosquete Metal"]
);
checar("checklist vazio ([]) ainda imprime as variacoes do item", variacoesQueSaemNoCard([], ["Fundo triband: Branca"]), ["Fundo triband: Branca"]);

// Item sem variacao: nada aparece.
checar("checklist curto sem variacao gravada: nada", variacoesQueSaemNoCard(["imagem", "impressao_fv"], []), []);
checar("variacoes nulas: nada", variacoesQueSaemNoCard(["imagem"], null), []);
checar("linha vazia nao vira linha no card", variacoesQueSaemNoCard(["imagem"], ["", "  ", "Acabamento: Brilho"]), ["Acabamento: Brilho"]);

// Checklist completo: igual a antes (24247, ColorBand com "variacoes" marcado).
const completo = ["cor", "num_gabarito", "numeracao_faixa", "impressao_fv", "tipo_numeracao", "imagem", "variacoes"];
checar("checklist completo sai igual a antes", variacoesQueSaemNoCard(completo, ["Fundo triband: Branca"]), ["Fundo triband: Branca"]);
checar(
  "checklist completo sem 'variacoes' (TexBand 24247) e sem variacao gravada: nada",
  variacoesQueSaemNoCard(["cor", "impressao_fv", "imagem", "num_gabarito", "numeracao_faixa", "tipo_numeracao"], []),
  []
);

// Item anterior ao checklist (sem snapshot): continua sem variacoes, como sempre.
checar("sem snapshot (null): sem variacoes", variacoesQueSaemNoCard(null, ["Acabamento: Brilho"]), []);
checar("sem snapshot (undefined): sem variacoes", variacoesQueSaemNoCard(undefined, ["Acabamento: Brilho"]), []);

// O destaque do TEXTIL continua valendo para as linhas que agora saem.
checar(
  "TEXTIL: acabamento sai em destaque como Acb:",
  linhaDeVariacaoNoCard("Acabamento: Jacaré Metálico", "TEXTIL"),
  { texto: "Acb: Jacaré Metálico", destaque: true }
);

console.log(falhas ? `\n${falhas} falha(s)` : "\ntodos os testes passaram");
process.exitCode = falhas ? 1 : 0;
