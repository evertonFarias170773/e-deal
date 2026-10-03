/**
 * Mapa de Teatro — src/features/orcamentos/lib/mapa-teatro.ts
 *
 *   node --experimental-strip-types scripts/testes/mapa-teatro.test.mts
 *
 * O QUE PROVA
 *   1. A REVISÃO bate com um cálculo independente: o valor esperado do mapa de
 *      exemplo (fixtures/mapa-teatro-config.json) saiu de um script Python
 *      (`json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)`
 *      + SHA-256), não desta função. É o mesmo cálculo que o outro sistema faz.
 *   2. O JSON canônico: chaves ordenadas, sem espaço, acento e emoji literais,
 *      ordem das chaves na entrada sem efeito.
 *   3. A quantidade do setor não conta cadeira apagada (tipo "Apagado" ou
 *      isErased), e setor sem cadeira volta com zero.
 *   4. O que NÃO vira vínculo: cadeiras em config.cadeiras (legado), setor sem
 *      id, id repetido, cadeiras em formato desconhecido.
 *   5. O retrato do setor guarda chave, prefixo, num e tipo como estão, e só os
 *      tipos de assento usados.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  cadeiraApagada,
  jsonCanonico,
  lerSetoresDoMapaTeatro,
  montarRetratoDoSetor,
  revisaoDoMapaTeatro,
  totalDeLugares
} from "../../src/features/orcamentos/lib/mapa-teatro.ts";

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

const config = JSON.parse(readFileSync(new URL("./fixtures/mapa-teatro-config.json", import.meta.url), "utf8"));

// — 1. Revisão: contra o cálculo independente (Python) e contra o node:crypto —
const REVISAO_PYTHON = "7d125f62896baa24e5bae3784d57f1b732783ae1e826c7f16e5ae07242931b77";
checar("revisao: igual a do calculo independente em Python", await revisaoDoMapaTeatro(config), REVISAO_PYTHON);
checar(
  "revisao: igual ao SHA-256 do node:crypto sobre o mesmo JSON canonico",
  await revisaoDoMapaTeatro(config),
  createHash("sha256").update(Buffer.from(jsonCanonico(config), "utf8")).digest("hex")
);
checar("revisao: 64 hexadecimais minusculos", /^[0-9a-f]{64}$/.test(await revisaoDoMapaTeatro(config)), true);
const embaralhada = Object.fromEntries(Object.entries(config).reverse());
checar("revisao: a ordem das chaves na entrada nao muda nada", await revisaoDoMapaTeatro(embaralhada), REVISAO_PYTHON);
const alterada = structuredClone(config);
alterada.setores[1].cadeiras["1,2"].num = 20;
checar("revisao: um numero de assento trocado muda a revisao", (await revisaoDoMapaTeatro(alterada)) === REVISAO_PYTHON, false);

// — 2. JSON canônico —
checar(
  "canonico: chaves ordenadas, sem espaco, acento literal",
  jsonCanonico({ b: 1, a: [1.5, 'é\n"x"', null, true], "ç": { z: 0, A: -2 } }),
  '{"a":[1.5,"é\\n\\"x\\"",null,true],"b":1,"ç":{"A":-2,"z":0}}'
);
checar("canonico: emoji literal, nao escapado", jsonCanonico({ icone: "💺" }), '{"icone":"💺"}');
checar("canonico: 1.0 e escrito como 1", jsonCanonico({ n: 1.0, m: 1.5 }), '{"m":1.5,"n":1}');
checar("canonico: maiuscula vem antes de minuscula", jsonCanonico({ a: 1, B: 2 }), '{"B":2,"a":1}');
checar("canonico: objeto e array vazios", jsonCanonico({ o: {}, l: [] }), '{"l":[],"o":{}}');
checar("canonico: comeca pelas chaves em ordem", jsonCanonico(config).startsWith('{"cadeiras":{},"setores":[{"cadeiras":{"-14,0":'), true);

// — 2b. JCS FIEL (RFC 8785): os casos em que "ordenar e chamar JSON.stringify" erraria —
// Chave puramente inteira: o JavaScript ENUMERA "2" antes de "10" (ordem
// numérica), qualquer que seja a ordem de entrada. O canônico não usa a
// enumeração: ordena as chaves por unidade UTF-16, e aí "10" vem antes de "2".
const inteiras = JSON.parse('{"2":"dois","10":"dez","1":"um","b":{"20":true,"3":false,"100":null}}');
checar("jcs: o motor enumera as chaves inteiras em ordem numerica", Object.keys(inteiras), ["1", "2", "10", "b"]);
checar(
  "jcs: chaves inteiras ordenadas como texto, em qualquer nivel",
  jsonCanonico(inteiras),
  '{"1":"um","10":"dez","2":"dois","b":{"100":null,"20":true,"3":false}}'
);
checar(
  "jcs: chave inteira misturada com chave de posicao e com letra",
  jsonCanonico(JSON.parse('{"a":1,"9":1,"10,2":1,"-1,0":1,"10":1}')),
  '{"-1,0":1,"10":1,"10,2":1,"9":1,"a":1}'
);
checar(
  "jcs: objeto dentro de array tambem e ordenado",
  jsonCanonico(JSON.parse('[{"2":0,"10":0},{"z":0,"A":0}]')),
  '[{"10":0,"2":0},{"A":0,"z":0}]'
);
// Ordenação da RFC 8785, seção 3.2.3: por unidade UTF-16, não por code point —
// o emoji (par substituto, D83D DE00) vem ANTES de U+FB33. As chaves são
// montadas por código, sem escape no fonte. A ordem é lida no TEXTO canônico:
// reler com JSON.parse devolveria as chaves inteiras na frente.
const chavesDaRfc = [0x20ac, 0x0d, 0xfb33, 0x31, 0x1f600, 0x80, 0xf6].map((c) => String.fromCodePoint(c));
const canonicoDaRfc = jsonCanonico(Object.fromEntries(chavesDaRfc.map((chave) => [chave, 1])));
checar(
  "jcs: ordem das chaves do exemplo da RFC 8785 (3.2.3)",
  [...chavesDaRfc]
    .sort((a, b) => canonicoDaRfc.indexOf(JSON.stringify(a) + ":") - canonicoDaRfc.indexOf(JSON.stringify(b) + ":"))
    .map((chave) => chave.codePointAt(0)!.toString(16)),
  ["d", "31", "80", "f6", "20ac", "1f600", "fb33"]
);
// Números e strings do exemplo da RFC 8785 (3.2.2 e 3.2.4): escritos como o
// JSON.stringify do ECMAScript escreve. BARRA e ASPAS montadas por código.
const BARRA = String.fromCharCode(92);
const ASPAS = String.fromCharCode(34);
const textoDaRfc =
  String.fromCodePoint(0x20ac) + "$" + String.fromCharCode(15) + String.fromCharCode(10) + "A'B" + ASPAS + BARRA + BARRA + ASPAS + "/";
checar(
  "jcs: numeros do exemplo da RFC 8785",
  jsonCanonico([333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001]),
  "[333333333.3333333,1e+30,4.5,0.002,1e-27]"
);
checar(
  "jcs: string do exemplo da RFC 8785 (so aspas, barra e controles escapados)",
  jsonCanonico(textoDaRfc),
  ASPAS + String.fromCodePoint(0x20ac) + "$" + BARRA + "u000f" + BARRA + "n" + "A'B" + BARRA + ASPAS + BARRA + BARRA + BARRA + BARRA + BARRA + ASPAS + "/" + ASPAS
);
checar("jcs: zero negativo e escrito como 0", jsonCanonico([-0, 0]), "[0,0]");
checar("jcs: inteiro no limite seguro", jsonCanonico([9007199254740991, -9007199254740991]), "[9007199254740991,-9007199254740991]");
checar("jcs: numero grande em notacao do ECMAScript", jsonCanonico([1e21, 123456789012345680000]), "[1e+21,123456789012345680000]");
const recusa = (v: unknown) => {
  try {
    jsonCanonico(v);
    return "ACEITOU";
  } catch {
    return "RECUSOU";
  }
};
checar("jcs: NaN e infinito nao tem forma canonica", [recusa([NaN]), recusa({ n: Infinity })], ["RECUSOU", "RECUSOU"]);
const ALTO = String.fromCharCode(0xd83d);
const BAIXO = String.fromCharCode(0xde00);
checar(
  "jcs: substituto solto nao e texto valido, em valor ou em chave",
  [recusa(ALTO), recusa("a" + BAIXO), recusa({ [BAIXO]: 1 }), recusa(BAIXO + ALTO)],
  ["RECUSOU", "RECUSOU", "RECUSOU", "RECUSOU"]
);
checar("jcs: par substituto completo e aceito, literal", jsonCanonico(ALTO + BAIXO), ASPAS + String.fromCodePoint(0x1f600) + ASPAS);
// A revisão é só da config: renomear o mapa (ou trocar o id dele) não muda nada,
// porque nome e id nem entram na função.
checar(
  "revisao: e funcao so da config (o mesmo valor para qualquer nome de mapa)",
  await revisaoDoMapaTeatro(JSON.parse(JSON.stringify(config))),
  REVISAO_PYTHON
);

// — 3. Setores e quantidades —
const leitura = lerSetoresDoMapaTeatro(config);
checar("setores: leitura aceita o mapa de exemplo", leitura.ok, true);
if (leitura.ok) {
  checar(
    "setores: id, nome, lugares sem as apagadas",
    leitura.setores,
    [
      { id: "setor_0_1", nome: "Mesas 01 a 02", lugares: 3, apagadas: 0 },
      { id: "setor_1_2", nome: "Platéia", lugares: 2, apagadas: 2 },
      { id: "setor_2_3", nome: "Vazio", lugares: 0, apagadas: 0 }
    ]
  );
  checar("setores: total de lugares", totalDeLugares(leitura.setores), 5);
}
checar("apagada: tipo Apagado", cadeiraApagada({ tipo: "Apagado" }), true);
checar("apagada: tipo com caixa diferente", cadeiraApagada({ tipo: " apagado " }), true);
checar("apagada: isErased verdadeiro", cadeiraApagada({ tipo: "Normal", isErased: true }), true);
checar("apagada: isErased falso nao apaga", cadeiraApagada({ tipo: "Normal", isErased: false }), false);
checar("apagada: cadeira normal", cadeiraApagada({ tipo: "Normal" }), false);

// — 4. O que não vira vínculo —
const motivo = (c: unknown) => {
  const r = lerSetoresDoMapaTeatro(c);
  return r.ok ? "ACEITOU" : r.motivo;
};
checar("recusa: config vazia", motivo(null), "O mapa não tem configuração.");
checar("recusa: sem setores", motivo({ setores: [] }), "O mapa não tem nenhum setor.");
checar(
  "recusa: cadeiras legadas em config.cadeiras (objeto)",
  motivo({ ...config, cadeiras: { "0,0": { num: 1, tipo: "Normal" } } }).startsWith("Este mapa guarda cadeiras fora dos setores"),
  true
);
checar(
  "recusa: cadeiras legadas em config.cadeiras (lista)",
  motivo({ ...config, cadeiras: [{ num: 1 }] }).startsWith("Este mapa guarda cadeiras fora dos setores"),
  true
);
checar("aceita: config.cadeiras vazio nao e legado", lerSetoresDoMapaTeatro({ ...config, cadeiras: [] }).ok, true);
checar(
  "recusa: setor sem id",
  motivo({ setores: [{ nome: "Plateia", cadeiras: {} }] }),
  'O setor "Plateia" não tem identificador. O vínculo é feito pelo id do setor.'
);
checar(
  "recusa: setor com id em branco",
  motivo({ setores: [{ id: "  ", nome: "Plateia", cadeiras: {} }] }).includes("não tem identificador"),
  true
);
checar(
  "recusa: dois setores com o mesmo id",
  motivo({ setores: [{ id: "s1", nome: "A", cadeiras: {} }, { id: "s1", nome: "B", cadeiras: {} }] }),
  "O mapa tem dois setores com o mesmo identificador (s1)."
);
checar(
  "recusa: cadeiras do setor em lista (formato desconhecido)",
  motivo({ setores: [{ id: "s1", nome: "A", cadeiras: [{ num: 1 }] }] }),
  'As cadeiras do setor "A" estão em formato não reconhecido.'
);

// — 5. Retrato do setor —
const mapa = { id: "a1184de9-1dd8-4d1a-a668-bfe124000e6a", name: "Teatro de Exemplo", config };
const retrato = montarRetratoDoSetor(mapa, "setor_1_2");
checar("retrato: mapa e setor por id e nome", [retrato?.versao, retrato?.mapa, retrato?.setor], [
  1,
  { id: "a1184de9-1dd8-4d1a-a668-bfe124000e6a", nome: "Teatro de Exemplo" },
  { id: "setor_1_2", nome: "Platéia" }
]);
checar(
  "retrato: cadeiras com chave, prefixo, num e tipo, sem renumerar; apagada marcada",
  retrato?.cadeiras,
  [
    { chave: "0,0", prefixo: "D", num: 16, tipo: "Normal" },
    { chave: "0,2", prefixo: "D", num: 17, tipo: "Apagado", apagada: true },
    { chave: "1,0", prefixo: "D", num: 18, tipo: "Normal", apagada: true },
    { chave: "1,2", prefixo: "E", num: 19, tipo: "Normal" }
  ]
);
checar("retrato: so os tipos de assento usados no setor", retrato?.tiposAssento.map((t) => t.id), ["Normal", "Apagado"]);
checar(
  "retrato: outro setor, outros tipos",
  montarRetratoDoSetor(mapa, "setor_0_1")?.tiposAssento.map((t) => t.id),
  ["Normal", "tipo_pne"]
);
checar("retrato: setor que nao e do mapa nao tem retrato", montarRetratoDoSetor(mapa, "setor_de_outro_mapa"), null);
checar("retrato: nome parecido nao e id", montarRetratoDoSetor(mapa, "Platéia"), null);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
