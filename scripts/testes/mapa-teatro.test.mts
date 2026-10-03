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
