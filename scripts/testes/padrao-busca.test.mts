/**
 * Testes do padrão de busca da lista de Pedidos (sem acento, sem caixa).
 *
 *   node --experimental-strip-types scripts/testes/padrao-busca.test.mts
 *
 * O padrão vai para o banco como expressão regular sem diferenciar caixa
 * (`imatch`). Aqui ele é conferido com a RegExp do JavaScript e a flag "i", que
 * para estes casos se comporta como o `~*` do Postgres. Rode depois de mexer em
 * src/features/orcamentos/lib/padrao-busca.ts.
 */
import {
  digitosDeDocumentoParaBusca,
  normalizarTermoDeBusca,
  padraoBuscaSemAcento,
  valorParaOr
} from "../../src/features/orcamentos/lib/padrao-busca.ts";

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

const acha = (termo: string, texto: string) => new RegExp(padraoBuscaSemAcento(termo) ?? "(?!)", "i").test(texto);

// — Caixa e acento, nos dois sentidos —
checar("sem acento acha texto acentuado", acha("grafica rapida", "GRÁFICA RÁPIDA LTDA"), true);
checar("com acento acha texto sem acento", acha("GRÁFICA RÁPIDA", "grafica rapida ltda"), true);
checar("maiuscula acha minuscula", acha("GRAFICA", "grafica do joao"), true);
checar("til e cedilha", acha("joao conceicao", "João Conceição"), true);
checar("texto com til e termo com til", acha("JOÃO", "joao da silva"), true);
checar("enhe", acha("espana", "España Eventos"), true);

// — Espaços —
checar("espaco sobrando nas pontas", acha("   grafica rapida  ", "GRAFICA RAPIDA"), true);
checar("espaco duplo no termo", acha("grafica   rapida", "GRAFICA RAPIDA"), true);
checar("espaco duplo no texto", acha("grafica rapida", "GRAFICA  RAPIDA"), true);

// — Parte da palavra —
checar("parte do meio", acha("afica rap", "GRÁFICA RÁPIDA"), true);
checar("uma letra a mais nao acha", acha("graficas", "GRÁFICA RÁPIDA"), false);
checar("outra palavra nao acha", acha("grafica lenta", "GRÁFICA RÁPIDA"), false);

// — Sinais são comparados ao pé da letra, nunca como sintaxe —
checar("ponto e literal", acha("a.b", "axb"), false);
checar("ponto acha ponto", acha("s.a.", "EMPRESA S.A."), true);
checar("e comercial", acha("silva & filhos", "SILVA & FILHOS"), true);
checar("parenteses", acha("(matriz)", "LOJA (MATRIZ)"), true);
checar("asterisco e literal", acha("a*", "aaa"), false);
checar("barra", acha("me/epp", "FULANO ME/EPP"), true);

// — Termo vazio —
checar("vazio nao gera padrao", padraoBuscaSemAcento("   "), null);
checar("normalizacao", normalizarTermoDeBusca("  GRÁFICA   Rápida "), "grafica rapida");

// — Nada que quebre as aspas do filtro —
const perigoso = padraoBuscaSemAcento('a"b\\c]d^e') ?? "";
checar("sem aspas nem barra invertida no padrao", /["\\]/.test(perigoso), false);
checar("valor do filtro vai entre aspas", valorParaOr("gr[aá]fica, rapida"), '"gr[aá]fica, rapida"');

// — Documento do cliente (CPF/CNPJ) —
checar("documento: com e sem pontuacao dao os mesmos digitos", digitosDeDocumentoParaBusca("123.456"), digitosDeDocumentoParaBusca("123456"));
checar("documento: 123.456 vira 123456", digitosDeDocumentoParaBusca("123.456"), "123456");
checar("documento: CPF completo formatado", digitosDeDocumentoParaBusca("123.456.789-09"), "12345678909");
checar("documento: CNPJ completo formatado", digitosDeDocumentoParaBusca("12.345.678/0001-95"), "12345678000195");
checar("documento: espacos nas pontas", digitosDeDocumentoParaBusca("  123456 "), "123456");
checar("documento: numero de pedido (5 digitos) nao vira busca de documento", digitosDeDocumentoParaBusca("23512"), null);
checar("documento: 5 digitos com ponto ja nao e pedido", digitosDeDocumentoParaBusca("23.512"), "23512");
checar("documento: 3 digitos com ponto e pouco", digitosDeDocumentoParaBusca("12.3"), null);
checar("documento: 4 digitos com ponto entra", digitosDeDocumentoParaBusca("123.4"), "1234");
checar("documento: 6 digitos sem pontuacao entra", digitosDeDocumentoParaBusca("234567"), "234567");
checar("documento: letra no termo e busca por nome", digitosDeDocumentoParaBusca("ltda 123456"), null);
checar("documento: nome nao vira documento", digitosDeDocumentoParaBusca("grafica rapida"), null);
checar("documento: vazio", digitosDeDocumentoParaBusca("   "), null);
checar("documento: mais de 14 digitos nao existe", digitosDeDocumentoParaBusca("123456789012345"), null);
checar("documento: so pontuacao", digitosDeDocumentoParaBusca("..."), null);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
