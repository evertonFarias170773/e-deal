/**
 * Testes do reconhecimento de transportadora parceira a partir da cotação.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/transportadoras-parceiras.test.mts
 *
 * O QUE ESTE ARQUIVO FIXA
 *   Cada card é testado nos DOIS estados em que ele existe na tela, porque a
 *   confiabilidade do critério é diferente em cada um:
 *
 *     RECEM-COTADO  `transportadora` é a constante fixa do nosso gerador em
 *                   `frete.service.ts` ("Azul Cargo", "Transportadora São
 *                   Miguel"...). É o estado forte.
 *     RELIDO        `cotacao_frete` não guarda `transportadora`; o
 *                   `mapCotacaoRowToPropostaFrete` reconstrói o campo a partir
 *                   de `servico`. É o estado fraco — e o único em que a Azul
 *                   depende do rótulo que a API dela devolveu.
 *
 *   Os rótulos usados nos casos RELIDO não são inventados: são valores que
 *   existem hoje em `cotacao_frete` (medido em 26/08/2026).
 *
 * O QUE ELE NÃO COBRE
 *   Não testa a gravação em `propostas.id_transportadora_cliente` — isso vive no
 *   `selectFrete` da tela, que depende de estado de React. Aqui fica a REGRA;
 *   a tela só escolhe quando aplicá-la (CIF sim, FOB não, RETIRA nulo).
 */
import {
  resolverTransportadoraParceira,
  canonizarTransportadora,
  ehCadastroSubstituido,
  TRANSPORTADORAS_PARCEIRAS as IDS
} from "@/features/orcamentos/lib/transportadoras-parceiras";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else {
    console.log(`ok      ${nome}  -> ${JSON.stringify(real)}`);
  }
}

console.log("--- mapa de ids (ponto unico) ---");
checar("CORREIOS", IDS.CORREIOS, 663);
checar("AZUL", IDS.AZUL, 808);
checar("MOTOBOY", IDS.MOTOBOY, 997);
checar("VEPPO", IDS.VEPPO, 120018);
checar("SAO_MIGUEL", IDS.SAO_MIGUEL, 120026);

console.log("\n--- card RECEM-COTADO (transportadora = constante do gerador) ---");
checar("Correios SEDEX", resolverTransportadoraParceira({ transportadora: "Correios SEDEX", servico: "SEDEX" }), 663);
checar("Correios PAC", resolverTransportadoraParceira({ transportadora: "Correios PAC", servico: "PAC" }), 663);
checar("Azul Cargo", resolverTransportadoraParceira({ transportadora: "Azul Cargo", servico: "ECOMM" }), 808);
checar("Sao Miguel", resolverTransportadoraParceira({ transportadora: "Transportadora São Miguel", servico: "SÃO MIGUEL" }), 120026);
checar("Motoboy", resolverTransportadoraParceira({ transportadora: "Motoboy", servico: "MOTOBOY" }), 997);
checar("VEPPO", resolverTransportadoraParceira({ transportadora: "VEPPO", servico: "VEPPO" }), 120018);

console.log("\n--- card RELIDO do banco (transportadora reconstruida de servico) ---");
checar("SEDEX", resolverTransportadoraParceira({ transportadora: "Correios SEDEX", servico: "SEDEX" }), 663);
checar("sedex minusculo", resolverTransportadoraParceira({ transportadora: "sedex", servico: "sedex" }), 663);
checar("SÃO MIGUEL", resolverTransportadoraParceira({ transportadora: "SÃO MIGUEL", servico: "SÃO MIGUEL" }), 120026);
checar("Expresso São Miguel", resolverTransportadoraParceira({ transportadora: "Expresso São Miguel", servico: "Expresso São Miguel" }), 120026);
checar("MOTOBOY com espaco", resolverTransportadoraParceira({ transportadora: "MOTOBOY ", servico: "MOTOBOY " }), 997);
checar("VEPPO-RS", resolverTransportadoraParceira({ transportadora: "VEPPO-RS", servico: "VEPPO-RS" }), 120018);
checar("veppo minusculo", resolverTransportadoraParceira({ transportadora: "veppo", servico: "veppo" }), 120018);

console.log("\n--- Azul: os rotulos que a API dela ja devolveu ---");
for (const rotulo of ["AZUL ECOMM", "ECOMM", "AZUL ECOM", "AZUL EXPRESSO", "Azul Cargo Premium", "AVI AZUL", "EXPRESSO AZUL CARGO", "Azul"]) {
  checar(`Azul: ${rotulo}`, resolverTransportadoraParceira({ transportadora: rotulo, servico: rotulo }), 808);
}

console.log("\n--- NAO e parceira: vinculo fica NULO e o rotulo segue em frete_escolhido ---");
for (const rotulo of ["Retirada Local", "RETIRA BALCÃO", "Retira no Balcão", "Braspress", "BRASPESS", "UNESUL", "Troca Transportes", "Transportadora Parceira", "Transportadora a definir", "Frete Incluso", "Sem custo", "AÉREO EXPRESSO", "Não sei", ""]) {
  checar(`nulo: ${rotulo || "(vazio)"}`, resolverTransportadoraParceira({ transportadora: rotulo, servico: rotulo }), null);
}

console.log("\n--- bordas ---");
checar("card ausente", resolverTransportadoraParceira(null), null);
checar("campos nulos", resolverTransportadoraParceira({ transportadora: null, servico: null }), null);
// "PAC" nao pode casar dentro de outra palavra.
checar("PACOTE nao e PAC", resolverTransportadoraParceira({ transportadora: "PACOTE ECONOMICO", servico: "PACOTE ECONOMICO" }), null);
// Retirada vence qualquer outro token no mesmo rotulo.
checar("RETIRA vence", resolverTransportadoraParceira({ transportadora: "RETIRA BALCÃO", servico: "SEDEX" }), null);

console.log("\n--- canonizacao: cadastro substituido vira o legitimo ---");
// 120001 = AGENCIA DE CORREIOS FRANQUEADA BELUNO. Nao pode constar como
// transportador: quem consta e a ECT (663). 9 despachos ja apontam para ele.
checar("120001 (Beluno) -> 663 (ECT)", canonizarTransportadora(120001), 663);
checar("120001 e substituido", ehCadastroSubstituido(120001), true);
checar("663 permanece 663", canonizarTransportadora(663), 663);
checar("663 nao e substituido", ehCadastroSubstituido(663), false);
checar("120009 (Braspress) intacto", canonizarTransportadora(120009), 120009);
checar("808 intacto", canonizarTransportadora(808), 808);
checar("null continua null", canonizarTransportadora(null), null);
checar("undefined vira null", canonizarTransportadora(undefined), null);
checar("NaN vira null", canonizarTransportadora(Number.NaN), null);
checar("null nao e substituido", ehCadastroSubstituido(null), false);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
