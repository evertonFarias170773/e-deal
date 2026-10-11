/**
 * Testes das opcoes do filtro Vendedor da lista de Pedidos.
 *
 *   node --experimental-strip-types scripts/testes/opcoes-vendedor.test.mts
 */
import { montarOpcoesDeVendedor } from "../../src/features/orcamentos/lib/opcoes-vendedor.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { falhas += 1; console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`); }
  else console.log(`ok      ${nome}`);
}
const base = { nomesDoCadastro: null as string[] | null, nomesDasLinhas: [] as string[], leituraFalhou: false, escopoRestrito: false, meuNome: "", selecionado: "TODOS" };
const cadastro = ["Lisiane Colbeich", "André Toniazzo", "Alexandre Almeida", "Fábio Almeida", "Emily Boeira", "Edina Farias"];

checar("ordem alfabetica pt-BR, com acento", montarOpcoesDeVendedor({ ...base, nomesDoCadastro: cadastro }),
  ["Alexandre Almeida", "André Toniazzo", "Edina Farias", "Emily Boeira", "Fábio Almeida", "Lisiane Colbeich"]);
checar("independe das linhas carregadas", montarOpcoesDeVendedor({ ...base, nomesDoCadastro: cadastro, nomesDasLinhas: ["Fulano Qualquer"] }),
  montarOpcoesDeVendedor({ ...base, nomesDoCadastro: cadastro, nomesDasLinhas: [] }));
checar("mesma ordem se o cadastro vier embaralhado", montarOpcoesDeVendedor({ ...base, nomesDoCadastro: [...cadastro].reverse() }),
  montarOpcoesDeVendedor({ ...base, nomesDoCadastro: cadastro }));
checar("sem repeticao e sem espaco sobrando", montarOpcoesDeVendedor({ ...base, nomesDoCadastro: ["  Emily Boeira ", "Emily Boeira", ""] }), ["Emily Boeira"]);

// valor selecionado
checar("valor selecionado fora do cadastro continua como opcao", montarOpcoesDeVendedor({ ...base, nomesDoCadastro: cadastro, selecionado: "Edison Jr" }).includes("Edison Jr"), true);
checar("valor selecionado fica em ordem", montarOpcoesDeVendedor({ ...base, nomesDoCadastro: ["Bruno", "Zeca"], selecionado: "Carlos" }), ["Bruno", "Carlos", "Zeca"]);
checar("valor selecionado que ja esta no cadastro nao duplica", montarOpcoesDeVendedor({ ...base, nomesDoCadastro: cadastro, selecionado: "Emily Boeira" }).filter((n) => n === "Emily Boeira").length, 1);
checar("TODOS nao vira opcao", montarOpcoesDeVendedor({ ...base, nomesDoCadastro: cadastro }).includes("TODOS"), false);

// escopo restrito
checar("escopo restrito: so o proprio nome", montarOpcoesDeVendedor({ ...base, nomesDoCadastro: cadastro, escopoRestrito: true, meuNome: "Emily Boeira" }), ["Emily Boeira"]);
checar("escopo restrito: nao mostra o cadastro nem as linhas", montarOpcoesDeVendedor({ ...base, nomesDoCadastro: cadastro, nomesDasLinhas: ["Outro"], leituraFalhou: true, escopoRestrito: true, meuNome: "Emily Boeira" }), ["Emily Boeira"]);
checar("escopo restrito + valor da URL", montarOpcoesDeVendedor({ ...base, escopoRestrito: true, meuNome: "Emily Boeira", selecionado: "Edison Jr" }), ["Edison Jr", "Emily Boeira"]);

// carregando e falha
checar("carregando: lista vazia", montarOpcoesDeVendedor({ ...base, nomesDoCadastro: null }), []);
checar("carregando com valor da URL: so ele", montarOpcoesDeVendedor({ ...base, selecionado: "Emily Boeira" }), ["Emily Boeira"]);
checar("leitura falhou: usa as linhas carregadas", montarOpcoesDeVendedor({ ...base, leituraFalhou: true, nomesDasLinhas: ["B", "A", "B"] }), ["A", "B"]);
checar("cadastro vazio e valido (ninguem e vendedor)", montarOpcoesDeVendedor({ ...base, nomesDoCadastro: [] }), []);

if (falhas > 0) { console.log(`\n${falhas} falha(s).`); process.exitCode = 1; } else console.log("\nTudo certo.");
