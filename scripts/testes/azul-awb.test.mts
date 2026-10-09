/**
 * Regras puras da AWB da Azul (09/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/azul-awb.test.mts
 *
 * O QUE PROVA: natureza generica recusada (com e sem acento/caixa), soma minima
 * de 45 cm por volume, quantidade inteira, peso inicial por volume e a tabela
 * de quando o botao habilita. Sem rede e sem banco.
 */
import {
  estadoBotaoAzul,
  pesoInicialPorVolume,
  validarNaturezaProduto,
  validarVolumes
} from "../../src/features/expedicao/lib/azul-awb.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else console.log(`ok      ${nome}`);
}
const recusa = (v: string | null) => v !== null;

checar("PEÇAS recusado", recusa(validarNaturezaProduto("PEÇAS")), true);
checar("pecas minusculo recusado", recusa(validarNaturezaProduto(" pecas ")), true);
checar("Amostras recusado", recusa(validarNaturezaProduto("Amostras")), true);
checar("BRINDES recusado", recusa(validarNaturezaProduto("BRINDES")), true);
checar("vazio recusado", recusa(validarNaturezaProduto("")), true);
checar("descricao especifica passa", validarNaturezaProduto("Etiquetas adesivas impressas"), null);
checar("peças de reposição passa (nao e so PEÇAS)", validarNaturezaProduto("Peças de reposição de impressora"), null);

const ok = { altura: 15, largura: 15, comprimento: 15, pesoKg: 2, quantidade: 1 };
checar("45 cm exatos passa", validarVolumes([ok]), null);
checar("44 cm recusa", recusa(validarVolumes([{ ...ok, comprimento: 14 }])), true);
checar("segundo volume curto recusa", recusa(validarVolumes([ok, { ...ok, altura: 1, largura: 1, comprimento: 1 }])), true);
checar("dimensao vazia (NaN) recusa", recusa(validarVolumes([{ ...ok, altura: Number("") }])), true);
checar("peso zero recusa", recusa(validarVolumes([{ ...ok, pesoKg: 0 }])), true);
checar("quantidade fracionada recusa", recusa(validarVolumes([{ ...ok, quantidade: 1.5 }])), true);
checar("sem volumes recusa", recusa(validarVolumes([])), true);

checar("peso inicial 51,25 / 4", pesoInicialPorVolume(51.25, 4), 12.813);
checar("peso inicial sem peso", pesoInicialPorVolume(null, 4), null);
checar("peso inicial sem volumes = 1", pesoInicialPorVolume(3, null), 3);

const base = {
  transportadoraAzul: true,
  modalidade: "CIF",
  nfAutorizada: true,
  podeOperar: true,
  azulAwb: null,
  azulStatus: null,
  temExpedicao: true
};
checar("CIF + NF + sem AWB habilita", estadoBotaoAzul(base).habilitado, true);
checar("FOB desabilita com motivo", [estadoBotaoAzul({ ...base, modalidade: "FOB" }).habilitado, recusa(estadoBotaoAzul({ ...base, modalidade: "FOB" }).motivo)], [false, true]);
checar("sem NF-e desabilita", estadoBotaoAzul({ ...base, nfAutorizada: false }).habilitado, false);
checar("com AWB mostra o numero", estadoBotaoAzul({ ...base, azulAwb: "123" }), { visivel: true, habilitado: false, motivo: "AWB Azul 123", awb: "123" });
checar("emitindo desabilita", estadoBotaoAzul({ ...base, azulStatus: "EMITINDO" }).habilitado, false);
checar("incerta desabilita", estadoBotaoAzul({ ...base, azulStatus: "INCERTA" }).habilitado, false);
checar("outra transportadora nao mostra", estadoBotaoAzul({ ...base, transportadoraAzul: false }).visivel, false);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
