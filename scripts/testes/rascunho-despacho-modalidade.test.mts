/**
 * Rascunho de expedicoes x troca de modalidade na proposta (25/11/2026, pedido 25793).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/rascunho-despacho-modalidade.test.mts
 */
import { readFileSync } from "node:fs";
import { modalidadeInicialDoDespacho, rascunhoDoDespachoVale } from "../../src/features/expedicao/lib/tipo-frete.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else console.log(`ok      ${nome}`);
}

checar("25793: rascunho RETIRA, proposta CIF, sem despacho -> rascunho nao vale", rascunhoDoDespachoVale("RETIRA", "CIF", false), false);
checar("mesma modalidade -> rascunho vale", rascunhoDoDespachoVale("CIF", "CIF", false), true);
checar("retirada de ADM em CIF (rascunho CIF) -> vale", rascunhoDoDespachoVale("CIF", "CIF", false), true);
checar("despacho confirmado -> a linha e soberana", rascunhoDoDespachoVale("RETIRA", "CIF", true), true);
checar("orcamento sem modalidade -> rascunho vale", rascunhoDoDespachoVale("RETIRA", null, false), true);
checar("rascunho sem modalidade -> vale", rascunhoDoDespachoVale(null, "CIF", false), true);

// O caso inteiro: com o rascunho descartado, o tipo vem da cotacao (SEDEX -> CORREIOS) e a modalidade do orcamento.
const vale = rascunhoDoDespachoVale("RETIRA", "CIF", false);
const tipoInicial = vale ? "RETIRA_BALCAO" : "CORREIOS";
checar("25793 abre em CIF", modalidadeInicialDoDespacho(vale ? "RETIRA" : undefined, "CIF", tipoInicial, false), "CIF");
checar("antes da correcao abria em RETIRA (o defeito)", modalidadeInicialDoDespacho("RETIRA", "CIF", "RETIRA_BALCAO", false), "RETIRA");

const modal = readFileSync("src/features/expedicao/components/DespacharModal.tsx", "utf8");
checar("modal: os campos de envio leem expEnvio",
  [
    modal.includes("envioReenvio?.tipoFrete ?? expEnvio?.tipoFrete ?? pedido.tipoFrete"),
    modal.includes("modalidadeInicialDoDespacho(\n    expEnvio?.modalidadeFrete") || /modalidadeInicialDoDespacho\(\s*expEnvio\?\.modalidadeFrete/.test(modal),
    /origemDaModalidadeInicial\(\s*expEnvio\?\.modalidadeFrete/.test(modal),
    modal.includes("expEnvio?.transportadoraNome ?? (pedido.tipoFrete"),
    modal.includes("expEnvio?.idTransportadoraCliente ?? pedido.idTransportadoraOrcamento"),
    /exp\?\.tipoFrete \?\? pedido\.tipoFrete/.test(modal)
  ],
  [true, true, true, true, true, false]);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else console.log("\nTudo certo.");
