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
  categoriaFreteVigente,
  categoriaPorNomeConhecido,
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

// ── 11. AS ENTRADAS QUE O `saveProposta` PASSA ───────────────────────
// Ele chama com (freteNome, servico, modalidadeVigente) — e em FOB manda o
// servico como null de proposito: o card que sobra ali e residuo, o SEDEX de
// valor zero que ninguem contratou. Sem isso, todo FOB com cotacao velha seria
// classificado como Correios.
checar("FOB: o SEDEX residual NAO entra, entao a transportadora fica sem meio",
  categoriaDoServico("SVT TRANSPORTES", null, "FOB"), null);
checar("FOB com a cotacao residual entrando, viraria CORREIOS — o contraste",
  categoriaDoServico("SVT TRANSPORTES", "SEDEX", "FOB"), "CORREIOS");
checar("FOB por motoboy: o nome ja chega resolvido",
  categoriaDoServico("Motoboy", null, "FOB"), "MOTOBOY");
checar("avulsa com Frete Incluso: o rotulo manual vira EXTRAS",
  categoriaDoServico("Frete Incluso", null, "CIF"), "EXTRAS");
checar("avulsa com frete manual sem meio: fica para o usuario declarar",
  categoriaDoServico("Braspress", "Braspress", "CIF"), null);

// ── 12. PRECEDENCIA DE LEITURA (Etapa 5) ─────────────────────────
// A MESMA de `modalidadeInicialDoDespacho`: rascunho nao vence a proposta.
checar("despachado: a expedicao vence a proposta",
  categoriaFreteVigente("RODOVIARIO", "AEREO", true), "AEREO");
checar("nao despachado: a proposta vence o rascunho",
  categoriaFreteVigente("RODOVIARIO", "AEREO", false), "RODOVIARIO");
checar("nao despachado e proposta sem categoria: o rascunho responde",
  categoriaFreteVigente(null, "AEREO", false), "AEREO");
checar("despachado sem categoria na expedicao: cai na proposta",
  categoriaFreteVigente("CORREIOS", null, true), "CORREIOS");
checar("nada em lugar nenhum e null",
  categoriaFreteVigente(null, null, true), null);
checar("null nas duas exibe EXTRAS",
  categoriaExibida(categoriaFreteVigente(null, null, false)), "EXTRAS");
// A recotacao e o caso concreto: a proposta foi vendida como Correios, o
// expedidor despachou por transportadora aerea, e o painel tem de mostrar AEREO
// sem ninguem reescrever a proposta.
checar("recotacao: despacho aereo vence a venda Correios",
  categoriaFreteVigente("CORREIOS", "AEREO", true), "AEREO");

// ── 13. AS ENTRADAS DAS TRES PORTAS DA ETAPA 5 ────────────────────
// DESPACHO: `tipo_frete` entra como servico, e ja e o vocabulario da derivacao.
checar("despacho CORREIOS", categoriaDoServico("Correios", "CORREIOS", "CIF"), "CORREIOS");
checar("despacho MOTOBOY", categoriaDoServico("Motoboy", "MOTOBOY", "CIF"), "MOTOBOY");
checar("despacho RETIRA_BALCAO", categoriaDoServico("Retira balcao", "RETIRA_BALCAO", "CIF"), "RETIRA");
checar("despacho TRANSPORTADORA com Veppo no nome", categoriaDoServico("VEPPO", "TRANSPORTADORA", "CIF"), "VEPPO");
checar("despacho TRANSPORTADORA sem meio conhecido fica null",
  categoriaDoServico("Braspress", "TRANSPORTADORA", "CIF"), null);

// ROTA ADMIN: so tem o nome do cadastro novo e a modalidade gravada.
checar("admin trocando para os Correios rederiva",
  categoriaDoServico("CORREIOS SEDE", null, "FOB"), "CORREIOS");
checar("admin trocando para transportadora sem meio limpa para null",
  categoriaDoServico("BRASPRESS", null, "FOB"), null);
checar("admin em pedido RETIRA preserva RETIRA pela propria modalidade",
  categoriaDoServico("BRASPRESS", null, "RETIRA"), "RETIRA");
checar("admin removendo o vinculo em pedido FOB fica null",
  categoriaDoServico(null, null, "FOB"), null);

// ── 14. DEGRAU 4: derivacao na leitura (Etapa 7) ────────────────────
// Nada e gravado: o parametro existe para o historico nao cair inteiro em
// EXTRAS enquanto ninguem salva as propostas de novo.
checar("degrau 4 responde quando as duas colunas estao nulas",
  categoriaFreteVigente(null, null, false, "CORREIOS"), "CORREIOS");
checar("degrau 4 responde tambem em pedido despachado sem categoria gravada",
  categoriaFreteVigente(null, null, true, "VEPPO"), "VEPPO");

// E A ORDEM QUE IMPORTA: o degrau 4 nunca passa na frente dos outros tres.
checar("proposta gravada VENCE a derivacao",
  categoriaFreteVigente("RODOVIARIO", null, false, "CORREIOS"), "RODOVIARIO");
checar("expedicao despachada VENCE a derivacao",
  categoriaFreteVigente(null, "AEREO", true, "CORREIOS"), "AEREO");
checar("expedicao despachada VENCE proposta E derivacao",
  categoriaFreteVigente("RETIRA", "AEREO", true, "CORREIOS"), "AEREO");
checar("rascunho de expedicao ainda vence a derivacao",
  categoriaFreteVigente(null, "AEREO", false, "CORREIOS"), "AEREO");
checar("sem nada e sem derivacao continua null",
  categoriaFreteVigente(null, null, true, null), null);

// COMPATIBILIDADE: chamador que nao passa o quarto argumento se comporta como
// antes de 05/09/2026. E o que torna o degrau reversivel.
checar("omitir o degrau 4 devolve o comportamento anterior",
  categoriaFreteVigente(null, null, false), null);
checar("omitir o degrau 4 nao afeta os degraus 1 a 3",
  categoriaFreteVigente("RETIRA", "AEREO", true), "AEREO");

// O degrau 4 recebe lixo? Ignora, como as outras fontes.
checar("derivacao invalida e tratada como ausente",
  categoriaFreteVigente(null, null, false, "TRANSPORTADORA" as never), null);

// ── 15. A TABELA DE NOMES (Etapa 8) ───────────────────────────
// Nove nomes decididos pelo dono em 05/09/2026. Nao e regra: e lista.
checar("Braspress e RODOVIARIO", categoriaPorNomeConhecido("Braspress", ""), "RODOVIARIO");
checar("BRASPRESS maiusculo", categoriaPorNomeConhecido("BRASPRESS", ""), "RODOVIARIO");
checar("BRAS PRESS separado", categoriaPorNomeConhecido("BRAS PRESS", ""), "RODOVIARIO");
checar("BRASPESS, a grafia errada que existe na base",
  categoriaPorNomeConhecido("BRASPESS", ""), "RODOVIARIO");
checar("TW TRANSPORTES e RODOVIARIO", categoriaPorNomeConhecido("TW TRANSPORTES", ""), "RODOVIARIO");
checar("Troca Transportes e RODOVIARIO", categoriaPorNomeConhecido("Troca Transportes", ""), "RODOVIARIO");
checar("TROCA sozinho tambem", categoriaPorNomeConhecido("TROCA", ""), "RODOVIARIO");
checar("TROCA TRANSPORTES LTDA, como esta gravado",
  categoriaPorNomeConhecido("TROCA TRANSPORTES LTDA", ""), "RODOVIARIO");

checar("SVT TRANSPORTES e AEREO", categoriaPorNomeConhecido("SVT TRANSPORTES", ""), "AEREO");
checar("Unesul e AEREO", categoriaPorNomeConhecido("Transportadora Unesul", ""), "AEREO");
checar("Transportadora Parceira e AEREO",
  categoriaPorNomeConhecido("Transportadora Parceira", ""), "AEREO");
checar("AEREO EXPRESSO e AEREO", categoriaPorNomeConhecido("AEREO EXPRESSO", ""), "AEREO");
checar("AEREO EXPRESSO com acento", categoriaPorNomeConhecido("AÉREO EXPRESSO", ""), "AEREO");

checar("Melhor Envio e EXTRAS", categoriaPorNomeConhecido("MELHOR ENVIO", ""), "EXTRAS");
checar("ECCOM e EXTRAS", categoriaPorNomeConhecido("ECCOM", ""), "EXTRAS");

// PALAVRA INTEIRA, nunca substring solta — a mesma disciplina da etapa 2.
checar("BRASPRESSAO nao casa com BRASPRESS", categoriaPorNomeConhecido("BRASPRESSAO", ""), null);
checar("TROCAR nao casa com TROCA", categoriaPorNomeConhecido("TROCAR DE ENDERECO", ""), null);
checar("SVTX nao casa com SVT", categoriaPorNomeConhecido("SVTX LOGISTICA", ""), null);
// Pontuacao colada nao impede o casamento: ela e separador.
checar("BRASPRESS/RS casa", categoriaPorNomeConhecido("BRASPRESS/RS", ""), "RODOVIARIO");

// ECCOM e ECOMM sao coisas diferentes, e uma nao pode virar a outra.
checar("ECOMM (Azul) NAO cai na tabela de nomes", categoriaPorNomeConhecido("ECOMM", ""), null);
checar("ECOMM continua sendo AEREO pela parceira, nao pela lista",
  categoriaDoServico("Azul Cargo", "ECOMM", "CIF"), "AEREO");

// Nome fora da lista continua null. Nao se inventa entrada.
checar("nome desconhecido continua null", categoriaPorNomeConhecido("EXPRESSO GAUCHO", ""), null);
checar("vazio continua null", categoriaPorNomeConhecido("", ""), null);
checar("nulo continua null", categoriaPorNomeConhecido(null, null), null);

// A TABELA NAO ENTRA EM `categoriaDoServico`: as duas seguem separadas, e e isso
// que impede a lista de passar na frente da declaracao do usuario.
checar("categoriaDoServico NAO conhece Braspress",
  categoriaDoServico("Braspress", "", "FOB"), null);
checar("categoriaDoServico NAO conhece SVT",
  categoriaDoServico("SVT TRANSPORTES", null, "FOB"), null);

// E a derivacao FORTE continua vencendo a lista quando as duas responderiam.
checar("retirada vence a tabela de nomes",
  categoriaDoServico("BRASPRESS", "RETIRA BALCAO", null), "RETIRA");

// ── 16. A ORDEM DOS TRES, como os chamadores a montam ────────────────
// `saveProposta` e a correcao de frete fazem exatamente esta conta:
//   derivacao forte ?? declaracao do usuario ?? tabela de nomes
const comoOsChamadoresMontam = (
  nome: string,
  servico: string | null,
  modalidade: "RETIRA" | "FOB" | "CIF" | null,
  declarada: "RODOVIARIO" | "AEREO" | null
) =>
  categoriaDoServico(nome, servico, modalidade) ?? declarada ?? categoriaPorNomeConhecido(nome, servico);

// O caso real dos pedidos 21752 e 21757: SVT esta na tabela como AEREO, e o
// operador declarou RODOVIARIO olhando a carga. Vence quem viu o pedido.
checar("declaracao do usuario VENCE a tabela de nomes",
  comoOsChamadoresMontam("SVT TRANSPORTES", null, "FOB", "RODOVIARIO"), "RODOVIARIO");
checar("sem declaracao, a tabela responde",
  comoOsChamadoresMontam("SVT TRANSPORTES", null, "FOB", null), "AEREO");
checar("derivacao forte vence a declaracao E a tabela",
  comoOsChamadoresMontam("Correios SEDEX", "SEDEX", "CIF", "AEREO"), "CORREIOS");
checar("nome fora da lista e sem declaracao continua null",
  comoOsChamadoresMontam("EXPRESSO GAUCHO", null, "FOB", null), null);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
