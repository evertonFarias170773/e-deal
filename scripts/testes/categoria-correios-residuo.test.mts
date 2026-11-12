/**
 * CORREIOS que sobrou de um SEDEX trocado por transportadora (12/11/2026, caso 24974).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/categoria-correios-residuo.test.mts
 *
 * 1. Salvar: so Rodoviario e Aereo contam como declaracao do usuario; o CORREIOS
 *    relido do banco nao e regravado quando o frete passa a ser de transportadora.
 * 2. Painel: CIF com transportadora fora dos Correios nao cai na coluna Correios,
 *    qualquer que seja o texto da cotacao; o SEDEX de verdade continua la.
 */
import { readFileSync } from "node:fs";
import {
  CATEGORIAS_DECLARAVEIS,
  categoriaDoServico,
  categoriaFreteVigente,
  categoriaPorNomeConhecido,
  ehCategoriaDeclaravel,
  ehCategoriaFrete,
  type CategoriaFrete
} from "../../src/features/orcamentos/lib/categoria-frete.ts";
import {
  cifComTransportadoraForaDosCorreios,
  cifPorTransportadora,
  normalizarTipoFrete
} from "../../src/features/expedicao/lib/tipo-frete.ts";

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

// ── 1. Salvar (a mesma conta de saveProposta) ──
const categoriaGravada = (args: { freteNome: string; servico: string | null; modalidade: "CIF" | "FOB"; declarada: unknown }) => {
  const derivada = categoriaDoServico(args.freteNome, args.modalidade === "FOB" ? null : args.servico, args.modalidade);
  const declarada = ehCategoriaDeclaravel(args.declarada) ? args.declarada : null;
  return derivada ?? declarada ?? categoriaPorNomeConhecido(args.freteNome, args.servico);
};
checar("declaraveis: so Rodoviario e Aereo", CATEGORIAS_DECLARAVEIS, ["RODOVIARIO", "AEREO"]);
checar("CORREIOS, MOTOBOY, VEPPO, RETIRA e EXTRAS nao sao declaracao", ["CORREIOS", "MOTOBOY", "VEPPO", "RETIRA", "EXTRAS"].map(ehCategoriaDeclaravel), [false, false, false, false, false]);
const g24974 = categoriaGravada({ freteNome: "TROCA TRANSPORTES LTDA", servico: "TROCA TRANSPORTES LTDA", modalidade: "CIF", declarada: "CORREIOS" });
checar("24974: SEDEX trocado por TROCA nao grava CORREIOS", g24974 === "CORREIOS", false);
checar("SEDEX de verdade continua CORREIOS", categoriaGravada({ freteNome: "Correios SEDEX", servico: "SEDEX", modalidade: "CIF", declarada: null }), "CORREIOS");
checar("SEDEX relido continua CORREIOS (derivacao forte)", categoriaGravada({ freteNome: "Correios SEDEX", servico: "SEDEX", modalidade: "CIF", declarada: "CORREIOS" }), "CORREIOS");
checar("declaracao de Rodoviario vale para transportadora sem categoria", categoriaGravada({ freteNome: "TROCA TRANSPORTES LTDA", servico: "TROCA TRANSPORTES LTDA", modalidade: "CIF", declarada: "RODOVIARIO" }), "RODOVIARIO");
checar("declaracao de Aereo vale", categoriaGravada({ freteNome: "TROCA TRANSPORTES LTDA", servico: "TROCA TRANSPORTES LTDA", modalidade: "CIF", declarada: "AEREO" }), "AEREO");

// ── 2. Painel (a mesma conta de expedicao.service) ──
const coluna = (args: {
  idTransportadora: number | null;
  nome: string | null;
  servico: string;
  categoriaProposta: CategoriaFrete | null;
  despachado?: boolean;
  categoriaExpedicao?: CategoriaFrete | null;
  prepostagem?: string | null;
  modalidade?: "CIF" | "FOB";
}) => {
  const entrada = {
    modalidade: args.modalidade ?? "CIF",
    despachoConfirmado: Boolean(args.despachado),
    idTransportadora: args.idTransportadora,
    nomeTransportadora: args.nome,
    tipoFreteCotado: normalizarTipoFrete(args.servico),
    correiosIdPrepostagem: args.prepostagem ?? null,
    prepostagemCanceladaEm: null
  } as const;
  const naoVale = cifComTransportadoraForaDosCorreios(entrada);
  const exp = args.categoriaExpedicao ?? null;
  return categoriaFreteVigente(
    ehCategoriaFrete(args.categoriaProposta) && !(naoVale && args.categoriaProposta === "CORREIOS") ? args.categoriaProposta : null,
    naoVale && exp === "CORREIOS" ? null : exp,
    Boolean(args.despachado),
    null
  );
};
checar("24974 antes do despacho: o cotado TROCA nao ligava a regra antiga", cifPorTransportadora({ modalidade: "CIF", despachoConfirmado: false, idTransportadora: 796, nomeTransportadora: "TROCA TRANSPORTES LTDA", tipoFreteCotado: normalizarTipoFrete("TROCA TRANSPORTES LTDA") }), false);
checar("24974 antes do despacho: fora da coluna Correios", coluna({ idTransportadora: 796, nome: "TROCA TRANSPORTES LTDA", servico: "TROCA TRANSPORTES LTDA", categoriaProposta: "CORREIOS" }) === "CORREIOS", false);
checar("24974 despachado: vale o despacho (Rodoviario)", coluna({ idTransportadora: 796, nome: "TROCA TRANSPORTES LTDA", servico: "TROCA TRANSPORTES LTDA", categoriaProposta: "CORREIOS", despachado: true, categoriaExpedicao: "RODOVIARIO" }), "RODOVIARIO");
checar("SEDEX de verdade (39975) continua na coluna Correios", coluna({ idTransportadora: 39975, nome: "SUPERINTENDENCIA ESTADUAL RS", servico: "SEDEX", categoriaProposta: "CORREIOS" }), "CORREIOS");
checar("Correios antigo (663) continua na coluna Correios", coluna({ idTransportadora: 663, nome: "EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS", servico: "SEDEX", categoriaProposta: "CORREIOS" }), "CORREIOS");
checar("SEDEX sem transportadora continua Correios", coluna({ idTransportadora: null, nome: null, servico: "SEDEX", categoriaProposta: "CORREIOS" }), "CORREIOS");
checar("prepostagem viva segura na coluna Correios", coluna({ idTransportadora: 796, nome: "TROCA TRANSPORTES LTDA", servico: "TROCA TRANSPORTES LTDA", categoriaProposta: "CORREIOS", prepostagem: "PRE123" }), "CORREIOS");
checar("FOB fica como antes", coluna({ idTransportadora: 796, nome: "TROCA TRANSPORTES LTDA", servico: "SEDEX", categoriaProposta: "CORREIOS", modalidade: "FOB" }), "CORREIOS");
checar("outra categoria gravada continua valendo (Veppo)", coluna({ idTransportadora: 796, nome: "VEPPO", servico: "VEPPO", categoriaProposta: "VEPPO" }), "VEPPO");

// ── Os dois pontos estao ligados ──
const servico = readFileSync("src/features/orcamentos/services/orcamentos.service.ts", "utf8");
const expedicao = readFileSync("src/features/expedicao/services/expedicao.service.ts", "utf8");
const tela = readFileSync("src/features/orcamentos/OrcamentoFormPage.tsx", "utf8");
checar("Salvar usa ehCategoriaDeclaravel", servico.includes("const categoriaDeclarada = ehCategoriaDeclaravel(formState.categoriaFreteDeclarada)"), true);
checar("painel usa o predicado novo so na coluna", [expedicao.includes("cifComTransportadoraForaDosCorreios(entradaCif)"), (expedicao.match(/colunaCorreiosNaoVale/g) ?? []).length], [true, 3]);
checar("botoes da tela saem da mesma lista", tela.includes("{CATEGORIAS_DECLARAVEIS.map((c) => ("), true);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
