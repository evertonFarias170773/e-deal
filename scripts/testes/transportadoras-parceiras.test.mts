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
 *   Não testa a gravação em `propostas.id_transportadora_cliente` — ela vive no
 *   `selectFrete` da tela (clique) e no `saveProposta` (09/11/2026, card
 *   escolhido sem clique). Aqui ficam as REGRAS que os dois aplicam:
 *   `resolverTransportadoraParceira` e `vinculoPeloCardEscolhido`.
 */
import {
  resolverTransportadoraParceira,
  canonizarTransportadora,
  ehCadastroSubstituido,
  ehCadastroCorreios,
  vinculoPeloCardEscolhido,
  pedidoEhDosCorreios,
  transportadoraDoServicoGravado,
  transportadoraPrecisaCorrecao,
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
checar("CORREIOS", IDS.CORREIOS, 39975);
checar("AZUL", IDS.AZUL, 808);
checar("MOTOBOY", IDS.MOTOBOY, 997);
checar("VEPPO", IDS.VEPPO, 120018);
checar("SAO_MIGUEL", IDS.SAO_MIGUEL, 120026);

console.log("\n--- card RECEM-COTADO (transportadora = constante do gerador) ---");
checar("Correios SEDEX", resolverTransportadoraParceira({ transportadora: "Correios SEDEX", servico: "SEDEX" }), 39975);
checar("Correios PAC", resolverTransportadoraParceira({ transportadora: "Correios PAC", servico: "PAC" }), 39975);
checar("Azul Cargo", resolverTransportadoraParceira({ transportadora: "Azul Cargo", servico: "ECOMM" }), 808);
checar("Sao Miguel", resolverTransportadoraParceira({ transportadora: "Transportadora São Miguel", servico: "SÃO MIGUEL" }), 120026);
checar("Motoboy", resolverTransportadoraParceira({ transportadora: "Motoboy", servico: "MOTOBOY" }), 997);
checar("VEPPO", resolverTransportadoraParceira({ transportadora: "VEPPO", servico: "VEPPO" }), 120018);

console.log("\n--- card RELIDO do banco (transportadora reconstruida de servico) ---");
checar("SEDEX", resolverTransportadoraParceira({ transportadora: "Correios SEDEX", servico: "SEDEX" }), 39975);
checar("sedex minusculo", resolverTransportadoraParceira({ transportadora: "sedex", servico: "sedex" }), 39975);
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
// transportador: quem consta e a ECT. Desde 08/10/2026 o cadastro legitimo e o
// 39975 (Superintendencia Estadual RS); 9 despachos ja apontam para o 120001.
checar("120001 (Beluno) -> 39975 (ECT)", canonizarTransportadora(120001), 39975);
checar("120001 e substituido", ehCadastroSubstituido(120001), true);
// 09/11/2026, decisao do financeiro: na nota, Correios e sempre o 39975. O 663
// (sede de Brasilia, sem IE) vira o 39975, mas segue reconhecido como Correios.
checar("663 (Brasilia) -> 39975", canonizarTransportadora(663), 39975);
checar("663 e substituido", ehCadastroSubstituido(663), true);
checar("663 segue sendo Correios", ehCadastroCorreios(663), true);
checar("39975 nao e substituido", ehCadastroSubstituido(39975), false);
checar("120009 (Braspress) intacto", canonizarTransportadora(120009), 120009);
checar("808 intacto", canonizarTransportadora(808), 808);
checar("null continua null", canonizarTransportadora(null), null);
checar("undefined vira null", canonizarTransportadora(undefined), null);
checar("NaN vira null", canonizarTransportadora(Number.NaN), null);
checar("null nao e substituido", ehCadastroSubstituido(null), false);

console.log("\n--- vinculo gravado pelo Salvar a partir do card escolhido (09/11/2026) ---");
const SEDEX = { transportadora: "Correios SEDEX", servico: "SEDEX" };
const AZUL = { transportadora: "Azul Cargo", servico: "ECOMM" };
const MANUAL = { transportadora: "BRASPRESS", servico: "BRASPRESS" };
checar("CIF + SEDEX sem vinculo -> 39975", vinculoPeloCardEscolhido({ modalidade: "CIF", card: SEDEX, idDaTela: null }), 39975);
checar("sem modalidade + SEDEX -> 39975", vinculoPeloCardEscolhido({ modalidade: null, card: SEDEX, idDaTela: null }), 39975);
checar("CIF + SEDEX com 663 na tela -> 39975", vinculoPeloCardEscolhido({ modalidade: "CIF", card: SEDEX, idDaTela: 663 }), 39975);
checar("CIF + card Azul com 39975 velho -> 808", vinculoPeloCardEscolhido({ modalidade: "CIF", card: AZUL, idDaTela: 39975 }), 808);
checar("CIF + card manual mantem o da tela", vinculoPeloCardEscolhido({ modalidade: "CIF", card: MANUAL, idDaTela: 120009 }), 120009);
checar("CIF + card manual sem vinculo fica null", vinculoPeloCardEscolhido({ modalidade: "CIF", card: MANUAL, idDaTela: null }), null);
checar("CIF sem card mantem o da tela", vinculoPeloCardEscolhido({ modalidade: "CIF", card: null, idDaTela: 997 }), 997);
checar("FOB ignora o card", vinculoPeloCardEscolhido({ modalidade: "FOB", card: SEDEX, idDaTela: 796 }), 796);
checar("FOB sem drop fica null", vinculoPeloCardEscolhido({ modalidade: "FOB", card: SEDEX, idDaTela: null }), null);
checar("RETIRA fica com o da tela", vinculoPeloCardEscolhido({ modalidade: "RETIRA", card: SEDEX, idDaTela: null }), null);

console.log("\n--- pedido dos Correios para a NF-e sem vinculo (09/11/2026) ---");
checar("card SEDEX em CIF", pedidoEhDosCorreios({ modalidade: "CIF", card: SEDEX }), true);
checar("card PAC sem modalidade", pedidoEhDosCorreios({ modalidade: null, card: { transportadora: null, servico: "PAC" } }), true);
checar("categoria do transporte CORREIOS", pedidoEhDosCorreios({ modalidade: "CIF", card: null, transporteCategoria: "CORREIOS" }), true);
checar("categoria do painel CORREIOS", pedidoEhDosCorreios({ modalidade: "CIF", categoriaFrete: "CORREIOS" }), true);
checar("categoria da expedicao CORREIOS", pedidoEhDosCorreios({ modalidade: "CIF", categoriaFreteExpedicao: "CORREIOS" }), true);
checar("FOB: SEDEX residuo nao conta", pedidoEhDosCorreios({ modalidade: "FOB", card: SEDEX }), false);
checar("RETIRA nunca", pedidoEhDosCorreios({ modalidade: "RETIRA", transporteCategoria: "CORREIOS" }), false);
checar("Azul nao e Correios", pedidoEhDosCorreios({ modalidade: "CIF", card: AZUL, transporteCategoria: "TRANSPORTADORA" }), false);
checar("sem sinal nenhum", pedidoEhDosCorreios({ modalidade: "CIF" }), false);

console.log("\n--- 11/11/2026: Correios so com frete dos Correios (25052) ---");
const ENTREGA_EXPRESSA_RELIDA = { transportadora: transportadoraDoServicoGravado("Entrega Expressa"), servico: "Entrega Expressa" };
checar("card padrao do SEDEX relido e Correios SEDEX", transportadoraDoServicoGravado("Entrega Expressa"), "Correios SEDEX");
checar("card padrao do PAC relido e Correios PAC", transportadoraDoServicoGravado("Entrega Econômica"), "Correios PAC");
checar("SEDEX relido", transportadoraDoServicoGravado("SEDEX"), "Correios SEDEX");
checar("servico qualquer fica o servico", transportadoraDoServicoGravado("BRASPRESS"), "BRASPRESS");
checar("sem servico", transportadoraDoServicoGravado(null), "Transportadora");
checar("Entrega Expressa relida resolve 39975", resolverTransportadoraParceira(ENTREGA_EXPRESSA_RELIDA), 39975);
checar("CIF + manual com 39975 velho -> null", vinculoPeloCardEscolhido({ modalidade: "CIF", card: MANUAL, idDaTela: 39975 }), null);
checar("CIF + manual com 663 velho -> null", vinculoPeloCardEscolhido({ modalidade: "CIF", card: MANUAL, idDaTela: 663 }), null);
checar("CIF sem card mantem 39975", vinculoPeloCardEscolhido({ modalidade: "CIF", card: null, idDaTela: 39975 }), 39975);
checar("FOB com 39975 declarado fica", vinculoPeloCardEscolhido({ modalidade: "FOB", card: MANUAL, idDaTela: 39975 }), 39975);
checar("NF-e: categoria CORREIOS velha com card manual nao e Correios", pedidoEhDosCorreios({ modalidade: "CIF", card: MANUAL, transporteCategoria: "CORREIOS" }), false);
checar("NF-e: card padrao do SEDEX relido e Correios", pedidoEhDosCorreios({ modalidade: "CIF", card: ENTREGA_EXPRESSA_RELIDA }), true);
checar("NF-e: card sem servico deixa a categoria decidir", pedidoEhDosCorreios({ modalidade: "CIF", card: { transportadora: null, servico: "" }, transporteCategoria: "CORREIOS" }), true);

console.log("\n--- quadro do admin: so com algo a corrigir ---");
checar("SEDEX com 39975: nada", transportadoraPrecisaCorrecao({ modalidade: "CIF", card: SEDEX, idVinculo: 39975 }), false);
checar("SEDEX com 663: nada", transportadoraPrecisaCorrecao({ modalidade: "CIF", card: SEDEX, idVinculo: 663 }), false);
checar("SEDEX sem vinculo: corrigir", transportadoraPrecisaCorrecao({ modalidade: "CIF", card: SEDEX, idVinculo: null }), true);
checar("Azul com 39975: corrigir", transportadoraPrecisaCorrecao({ modalidade: "CIF", card: AZUL, idVinculo: 39975 }), true);
checar("Azul com 808: nada", transportadoraPrecisaCorrecao({ modalidade: "CIF", card: AZUL, idVinculo: 808 }), false);
checar("manual com 39975: corrigir", transportadoraPrecisaCorrecao({ modalidade: "CIF", card: MANUAL, idVinculo: 39975 }), true);
checar("manual com a dele: nada", transportadoraPrecisaCorrecao({ modalidade: "CIF", card: MANUAL, idVinculo: 120009 }), false);
checar("manual sem vinculo: corrigir", transportadoraPrecisaCorrecao({ modalidade: "CIF", card: MANUAL, idVinculo: null }), true);
checar("Entrega Expressa relida com 39975 (25052): nada", transportadoraPrecisaCorrecao({ modalidade: "CIF", card: ENTREGA_EXPRESSA_RELIDA, idVinculo: 39975 }), false);
checar("RETIRA com vinculo: corrigir", transportadoraPrecisaCorrecao({ modalidade: "RETIRA", card: null, idVinculo: 39975 }), true);
checar("RETIRA sem vinculo: nada", transportadoraPrecisaCorrecao({ modalidade: "RETIRA", card: null, idVinculo: null }), false);
checar("FOB sem vinculo: corrigir", transportadoraPrecisaCorrecao({ modalidade: "FOB", card: null, idVinculo: null }), true);
checar("FOB motoboy: nada", transportadoraPrecisaCorrecao({ modalidade: "FOB", card: null, idVinculo: null, motoboyFob: true }), false);
checar("CIF sem card: nada", transportadoraPrecisaCorrecao({ modalidade: "CIF", card: null, idVinculo: null }), false);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
