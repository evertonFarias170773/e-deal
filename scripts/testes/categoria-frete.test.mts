/**
 * Derivação da categoria de frete — o que o painel usa para escolher a coluna.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/categoria-frete.test.mts
 *
 * Existe porque a derivação é o ÚNICO ponto que traduz cotação em coluna, e
 * porque metade do valor dela está no que ela se recusa a adivinhar: as seis
 * transportadoras sem meio declarado precisam cair em NULL, e isso só fica
 * garantido se alguém testar.
 */
import {
  categoriaDoServico,
  categoriaExibida,
  ehCategoriaFrete,
  CATEGORIAS_FRETE
} from "../../src/features/orcamentos/lib/categoria-frete.ts";

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

// ── 1. Vocabulário ──────────────────────────────────────────────────────────
checar("sao sete categorias", CATEGORIAS_FRETE.length, 7);
checar("VEPPO e categoria propria, nao rodoviario",
  CATEGORIAS_FRETE.includes("VEPPO") && CATEGORIAS_FRETE.includes("RODOVIARIO"), true);
checar("TRANSPORTADORA nao e categoria daqui (e da outra dimensao)",
  ehCategoriaFrete("TRANSPORTADORA"), false);
checar("nulo exibe em EXTRAS", categoriaExibida(null), "EXTRAS");
checar("indefinido exibe em EXTRAS", categoriaExibida(undefined), "EXTRAS");
checar("categoria valida exibe ela mesma", categoriaExibida("VEPPO"), "VEPPO");

// ── 2. Correios ─────────────────────────────────────────────────────────────
checar("SEDEX e CORREIOS",
  categoriaDoServico("Correios SEDEX", "SEDEX", "CIF"), "CORREIOS");
checar("PAC e CORREIOS",
  categoriaDoServico("Correios PAC", "PAC", "CIF"), "CORREIOS");
// A fronteira de palavra vem de `resolverTransportadoraParceira`: sem ela,
// qualquer rotulo com "PACOTE" viraria Correios.
checar("PACOTE nao vira CORREIOS",
  categoriaDoServico("Entrega", "PACOTE FECHADO", "CIF"), null);

// ── 3. Azul -> AEREO, com as duas palavras que a API dela devolve ───────────
checar("Azul Cargo e AEREO",
  categoriaDoServico("Azul Cargo", "ECOMM", "CIF"), "AEREO");
checar("AZUL no nome basta",
  categoriaDoServico("AZUL CARGO EXPRESS", "", "CIF"), "AEREO");

// ── 4. Sao Miguel -> RODOVIARIO ─────────────────────────────────────────────
checar("Sao Miguel e RODOVIARIO",
  categoriaDoServico("Transportadora São Miguel", "SÃO MIGUEL", "CIF"), "RODOVIARIO");
checar("acento nao importa",
  categoriaDoServico("EXPRESSO SAO MIGUEL", "", "CIF"), "RODOVIARIO");

// ── 5. Motoboy e Veppo ──────────────────────────────────────────────────────
checar("Motoboy e MOTOBOY",
  categoriaDoServico("Motoboy", "MOTOBOY", "FOB"), "MOTOBOY");
checar("Veppo e VEPPO, e nao RODOVIARIO",
  categoriaDoServico("VEPPO", "VEPPO", "CIF"), "VEPPO");

// ── 6. RETIRA: modalidade vence o servico cotado ────────────────────────────
// O caso real: proposta que cotou SEDEX e depois virou retirada de balcao. A
// cotacao sobra na tela e nao pode reivindicar a coluna.
checar("modalidade RETIRA vence um SEDEX cotado",
  categoriaDoServico("Correios SEDEX", "SEDEX", "RETIRA"), "RETIRA");
checar("modalidade RETIRA vence a Veppo cotada",
  categoriaDoServico("VEPPO", "VEPPO", "RETIRA"), "RETIRA");
checar("modalidade RETIRA vence ate um rotulo de EXTRAS",
  categoriaDoServico("Frete Incluso", "Frete Incluso", "RETIRA"), "RETIRA");
// 100 das 138 retiradas da base sao anteriores a `modalidade_frete` existir.
checar("texto de retirada sem modalidade ainda e RETIRA",
  categoriaDoServico("Retirada Local", "RETIRA BALCAO", null), "RETIRA");
checar("BALCAO tambem conta",
  categoriaDoServico("", "Retirar no balcão", null), "RETIRA");

// ── 7. EXTRAS: o vocabulario de "nao ha meio a declarar" ────────────────────
checar("Frete Incluso e EXTRAS",
  categoriaDoServico("Frete Incluso", "Frete Incluso", "CIF"), "EXTRAS");
checar("A definir e EXTRAS",
  categoriaDoServico("", "À definir", "CIF"), "EXTRAS");
checar("Transportadora a definir e EXTRAS",
  categoriaDoServico("Transportadora a definir", "", "FOB"), "EXTRAS");

// ── 8. NULL: sem sinal ──────────────────────────────────────────────────────
checar("tudo vazio e NULL", categoriaDoServico(null, null, null), null);
checar("string vazia e NULL", categoriaDoServico("", "", "CIF"), null);
checar("Sem custo NAO vira EXTRAS — e ausencia de preco, nao de meio",
  categoriaDoServico("Sem custo", "Sem custo", "CIF"), null);

// ── 9. OS SEIS NOMES REAIS CAEM EM NULL, DE PROPOSITO ───────────────────────
// Nesta etapa nenhuma regra por nome de transportadora e inventada. A resposta
// certa para "qual o meio da Braspress" e PERGUNTAR, e a pergunta e o proximo
// passo do plano — nao uma tabela de nomes que envelhece calada.
for (const grafia of ["Braspress", "BRASPRESS", "BRAS PRESS", "BRASPESS"]) {
  checar(`${grafia} cai em NULL (sem regra por nome)`,
    categoriaDoServico(grafia, "", "FOB"), null);
}
checar("Transportadora Parceira cai em NULL",
  categoriaDoServico("Transportadora Parceira", "", "CIF"), null);
checar("Unesul cai em NULL",
  categoriaDoServico("Transportadora Unesul", "", "CIF"), null);
checar("Troca Transportes cai em NULL",
  categoriaDoServico("Troca Transportes", "", "FOB"), null);
checar("SVT TRANSPORTES cai em NULL — o mesmo cadastro da Azul, sem a cotacao dela",
  categoriaDoServico("SVT TRANSPORTES", "", "FOB"), null);
checar("AEREO EXPRESSO cai em NULL — autodeclarar nao basta",
  categoriaDoServico("AEREO EXPRESSO", "", "CIF"), null);

// ── 10. Lixo digitado a mao tambem e NULL ───────────────────────────────────
for (const lixo of ["dd", "tt", "ede", "Não sei"]) {
  checar(`"${lixo}" cai em NULL`, categoriaDoServico(lixo, "", "CIF"), null);
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
