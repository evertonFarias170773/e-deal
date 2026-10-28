/**
 * Relatorio "Frete cobrado por transportadora": grupos de transportadora na leitura (28/10/2026).
 *
 *   node --experimental-strip-types --no-warnings --import ./scripts/testes/_alias-hook.mjs scripts/testes/relatorio-frete-grupos.test.mts
 *
 * Nada vai ao banco: `normalizar` recebe despachos montados aqui.
 */
import { fretePorTransportadora, grupoDaTransportadora } from "@/features/relatorios/definicoes/frete-por-transportadora";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok" : "FALHOU"} - ${nome}${ok ? "" : `\n   esperado ${JSON.stringify(esperado)}\n   veio     ${JSON.stringify(real)}`}`);
}
const g = (transportadora_nome: string | null, tipo_frete: string | null = null, id_transportadora_cliente: number | null = null) =>
  grupoDaTransportadora({ transportadora_nome, tipo_frete, id_transportadora_cliente });

checar("tipo CORREIOS vence o nome", g("SVT TRANSPORTES", "CORREIOS", 808), "Correios");
checar("tipo MOTOBOY", g("Motoboy", "MOTOBOY"), "Motoboy");
checar("cadastro 663 e 39975: Correios", [g("CORREIOS SEDE", "TRANSPORTADORA", 663), g("x", "TRANSPORTADORA", 39975)], ["Correios", "Correios"]);
checar("cadastro 997: Motoboy", g("B M EXPRESS", "TRANSPORTADORA", 997), "Motoboy");
checar("cadastro 120018: VEPPO", g("ESTACAO RODOVIARIA CENTRAL DE PORTO ALEGRE", "TRANSPORTADORA", 120018), "VEPPO");
checar("apelido sem tipo nem cadastro, sem maiusculas/acento/espacos", [g("  sedex "), g("pac"), g("Estação  Rodoviária Central de Porto Alegre"), g("veppo"), g("b m express")], ["Correios", "Correios", "VEPPO", "VEPPO", "Motoboy"]);
checar("transportadora fora da lista: nenhum grupo", [g("EXPRESSO SAO MIGUEL S/A", "TRANSPORTADORA", 120026), g("SEDEX 10"), g(null)], [null, null, null]);

const despachos = [
  { id_int: 1, transportadora_nome: "SEDEX", tipo_frete: "CORREIOS", id_transportadora_cliente: null, modalidade_frete: "CIF", data_despacho: "x" },
  { id_int: 2, transportadora_nome: "CORREIOS SEDE", tipo_frete: "CORREIOS", id_transportadora_cliente: 663, modalidade_frete: "CIF", data_despacho: "x" },
  { id_int: 3, transportadora_nome: "Correios", tipo_frete: "CORREIOS", id_transportadora_cliente: 663, modalidade_frete: "FOB", data_despacho: "x" },
  { id_int: 4, transportadora_nome: "B M EXPRESS", tipo_frete: "TRANSPORTADORA", id_transportadora_cliente: 997, modalidade_frete: "CIF", data_despacho: "x" },
  { id_int: 5, transportadora_nome: "Motoboy", tipo_frete: "MOTOBOY", id_transportadora_cliente: null, modalidade_frete: "CIF", data_despacho: "x" },
  { id_int: 6, transportadora_nome: "NOVA TRANSP", tipo_frete: "TRANSPORTADORA", id_transportadora_cliente: 5, modalidade_frete: "CIF", data_despacho: "x" }
];
const fretes = { "1": 10, "2": 20.1, "3": 0, "4": 95, "5": 5, "6": 7 };
const r = fretePorTransportadora.normalizar({ despachos, fretes });
checar("linhas por grupo e modalidade; nome novo aparece como esta",
  r.linhas.map((l) => `${l.transportadora}|${l.modalidade}|${l.pedidos}|${l.frete}`),
  ["Motoboy|CIF|2|100", "Correios|CIF|2|30.1", "NOVA TRANSP|CIF|1|7", "Correios|FOB|1|0"]);
checar("total igual a soma dos despachos", [r.total.pedidos, r.total.frete], [6, 137.1]);
checar("aviso com os nomes juntados por grupo", r.avisos.filter((a) => a.startsWith("Grupo")), [
  "Grupo Correios juntou os nomes gravados: Correios (1 despacho), CORREIOS SEDE (1 despacho), SEDEX (1 despacho).",
  "Grupo Motoboy juntou os nomes gravados: B M EXPRESS (1 despacho), Motoboy (1 despacho)."
]);

if (falhas > 0) { console.log(`\n${falhas} falha(s).`); process.exitCode = 1; } else console.log("\nTudo certo.");
