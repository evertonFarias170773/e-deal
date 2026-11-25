/**
 * Testes do agrupamento dos enderecos de ENTREGA iguais no cadastro (25/11/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/agrupar-enderecos-entrega.test.mts
 */
import {
  agruparEnderecosDeEntrega,
  ehObsTecnicaDoPortal,
  pedidosDoGrupo,
  textoUsadoEmPedidos
} from "../../src/features/cadastros/lib/agrupar-enderecos-entrega.ts";
import type { CadastroEndereco } from "../../src/features/cadastros/types.ts";

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

const entrega = (id: string, obs: string, extra: Partial<CadastroEndereco> = {}): CadastroEndereco => ({
  id, tipo: "entrega", cep: "01001000", endereco: "Rua Exemplo", numero: "100",
  bairro: "Centro", cidade: "Cidade Teste", uf: "SP", obs,
  recebedor: "RECEBEDOR TESTE", cpfRecebedor: "52998224725", ...extra
});
const principal: CadastroEndereco = {
  id: "p", tipo: "principal", cep: "01001000", endereco: "RUA EXEMPLO", numero: "100",
  complemento: "SALA 1", bairro: "CENTRO", cidade: "Cidade Teste", uf: "SP"
};

// Caso do cliente com tres pedidos: principal + tres ENTREGA identicas (obs diferente) = principal + 1 grupo.
const caso = [principal, entrega("a", "portal-entrega-pedido:24054"), entrega("b", "portal-entrega-pedido:24235"), entrega("c", "portal-entrega-pedido:24058")];
checar("principal sozinho e um grupo das 3 iguais", agruparEnderecosDeEntrega(caso).map((i) => (i.tipo === "linha" ? i.id : i.ids)), ["p", ["a", "b", "c"]]);

// Obs nao conta; complemento vazio = ausente.
checar("complemento '' igual a ausente", agruparEnderecosDeEntrega([entrega("a", "x"), entrega("b", "y", { complemento: "" })]).length, 1);

// Qualquer campo diferente separa (comparacao exata, como na funcao do portal).
checar("recebedor diferente separa", agruparEnderecosDeEntrega([entrega("a", ""), entrega("b", "", { recebedor: "OUTRO RECEBEDOR" })]).map((i) => i.tipo), ["linha", "linha"]);
checar("grafia diferente separa", agruparEnderecosDeEntrega([entrega("a", ""), entrega("b", "", { bairro: "CENTRO" })]).map((i) => i.tipo), ["linha", "linha"]);

// Tipos que nao sao ENTREGA nunca agrupam.
checar("dois principais iguais nao agrupam", agruparEnderecosDeEntrega([principal, { ...principal, id: "p2" }]).map((i) => i.tipo), ["linha", "linha"]);
checar("cobranca igual nao agrupa", agruparEnderecosDeEntrega([entrega("a", "", { tipo: "cobranca" }), entrega("b", "", { tipo: "cobranca" })]).map((i) => i.tipo), ["linha", "linha"]);

// Cliente sem duplicados: a lista sai igual, na mesma ordem.
const semDuplicado = [principal, entrega("a", ""), entrega("b", "", { numero: "200" })];
checar("sem duplicados: lista igual a antes", agruparEnderecosDeEntrega(semDuplicado), semDuplicado.map((e) => ({ tipo: "linha", id: e.id })));

// O grupo ocupa o lugar da primeira linha.
checar("grupo no lugar da 1a linha", agruparEnderecosDeEntrega([entrega("a", ""), principal, entrega("b", "")]).map((i) => i.tipo), ["grupo", "linha"]);

checar("pedidos do grupo sem repeticao e em ordem", pedidosDoGrupo(["a", "b", "c"], { a: [24054, 25746], b: [24235], c: [24058, 24054] }), [24054, 24058, 24235, 25746]);
checar("texto usado em", [0, 1, 3].map(textoUsadoEmPedidos), ["sem pedido", "usado em 1 pedido", "usado em 3 pedidos"]);
checar("obs tecnica do portal", [ehObsTecnicaDoPortal("portal-entrega-pedido:24054"), ehObsTecnicaDoPortal("portao azul")], [true, false]);

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log("\ntodos ok");
