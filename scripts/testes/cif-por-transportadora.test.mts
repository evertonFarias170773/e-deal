/**
 * CIF com transportadora declarada — o predicado único da Expedição (07/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/cif-por-transportadora.test.mts
 *
 * O "Corrigir frete" grava a transportadora em `propostas.id_transportadora_cliente`
 * também em CIF, mas a lista, o modal Despachar, a prévia da etiqueta e a rota de
 * prepostagem decidiam "por onde vai" só pelo texto de `cotacao_frete.servico`.
 * O pedido 23083 (CIF, cotado SEDEX, transportadora escolhida) seguia como
 * Correios, com os botões de prepostagem.
 *
 * O QUE PROVA
 *   1. CIF com transportadora que não é os Correios: vale.
 *   2. CIF com o cadastro dos próprios Correios como "transportadora": não vale
 *      (os pedidos 23068, 23084, 23114, 23141, 23183 e 23229 não mudam).
 *   3. CIF sem transportadora: não vale (tirar a transportadora desfaz).
 *   4. FOB e RETIRA: não vale (cada uma tem a sua regra).
 *   5. Prepostagem viva: não vale, e o aviso vale; cancelada, volta a valer.
 *   6. Despacho confirmado: não vale (manda `expedicoes`).
 *   7. Motoboy e transportadora já cotados não são alcançados.
 */
import {
  AVISO_PREPOSTAGEM_VIVA_COM_TRANSPORTADORA,
  cifComTransportadoraDeclarada,
  cifPorTransportadora,
  cifTransportadoraBarradaPorPrepostagem,
  normalizarTipoFrete,
  prepostagemViva,
  transportadoraEhOsCorreios,
  type EntradaCifPorTransportadora
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

/** O 23083 como estava em 07/10/2026: CIF, cotado SEDEX, transportadora escolhida. */
const base: EntradaCifPorTransportadora = {
  modalidade: "CIF",
  despachoConfirmado: false,
  idTransportadora: 796,
  nomeTransportadora: "TROCA TRANSPORTES LTDA",
  tipoFreteCotado: normalizarTipoFrete("SEDEX"),
  correiosIdPrepostagem: null,
  prepostagemCanceladaEm: null
};
const com = (mudanca: Partial<EntradaCifPorTransportadora>) => ({ ...base, ...mudanca });

// ── 1. CIF com transportadora ───────────────────────────────────────────────
checar("CIF cotado SEDEX com transportadora: vai por transportadora", cifPorTransportadora(base), true);
checar("CIF cotado PAC com transportadora", cifPorTransportadora(com({ tipoFreteCotado: normalizarTipoFrete("PAC") })), true);
checar("CIF com texto cotado nao reconhecido (caso do 23180)",
  cifPorTransportadora(com({ tipoFreteCotado: normalizarTipoFrete("ESTACAO RODOVIARIA CENTRAL DE PORTO ALEGRE") })), true);
checar("CIF 'sem custo' com transportadora", cifPorTransportadora(com({ tipoFreteCotado: normalizarTipoFrete("SEM CUSTO") })), true);
checar("sem aviso de prepostagem quando nao ha prepostagem", cifTransportadoraBarradaPorPrepostagem(base), false);

// ── 2. O cadastro dos proprios Correios nao conta ───────────────────────────
// Desde 08/10/2026 o predicado recebe (id, nome): o id decide primeiro, e o
// nome fica como fallback para quem nao tem vinculo.
checar("nomes que sao os Correios (sem id, pelo nome)",
  ["CORREIOS SEDE", "Correios", "EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS", "SEDEX", "correios - agência centro"].map((n) =>
    transportadoraEhOsCorreios(null, n)),
  [true, true, true, true, true]);
checar("nomes que nao sao os Correios (sem id)",
  ["TROCA TRANSPORTES LTDA", "SVT TRANSPORTES", "EXPRESSO SAO MIGUEL S/A", "BRASPRESS", "", null].map((n) =>
    transportadoraEhOsCorreios(null, n)),
  [false, false, false, false, false, false]);
// O cadastro novo dos Correios tem fantasia "SUPERINTENDENCIA ESTADUAL RS", que
// nao tem a palavra Correios: so o id o reconhece.
checar("os dois cadastros dos Correios, pelo id",
  [transportadoraEhOsCorreios(39975, "SUPERINTENDENCIA ESTADUAL RS"), transportadoraEhOsCorreios(663, "CORREIOS SEDE")],
  [true, true]);
checar("transportadora de verdade, com id, nao e os Correios",
  transportadoraEhOsCorreios(808, "SVT TRANSPORTES"), false);
checar("CIF com o cadastro dos Correios: segue Correios", cifPorTransportadora(com({ nomeTransportadora: "CORREIOS SEDE" })), false);
checar("CIF com o cadastro dos Correios: sem aviso", cifTransportadoraBarradaPorPrepostagem(com({ nomeTransportadora: "CORREIOS SEDE", correiosIdPrepostagem: "PR1" })), false);

// ── 3. Sem transportadora ───────────────────────────────────────────────────
checar("CIF sem transportadora: segue o servico cotado", cifPorTransportadora(com({ idTransportadora: null, nomeTransportadora: null })), false);
checar("vinculo sem nome resolvido nao decide nada", cifPorTransportadora(com({ nomeTransportadora: "   " })), false);
checar("vinculo indefinido", cifPorTransportadora(com({ idTransportadora: undefined })), false);

// ── 4. FOB e RETIRA ─────────────────────────────────────────────────────────
checar("FOB nao e alcancado (tem a regra propria)", cifPorTransportadora(com({ modalidade: "FOB" })), false);
checar("RETIRA nao e alcancada", cifPorTransportadora(com({ modalidade: "RETIRA" })), false);
checar("modalidade nula nao e alcancada", cifPorTransportadora(com({ modalidade: null })), false);

// ── 5. Prepostagem ──────────────────────────────────────────────────────────
checar("prepostagem viva", [prepostagemViva("PR123", null), prepostagemViva("PR123", "2026-10-07T12:00:00Z"), prepostagemViva(null, null), prepostagemViva("  ", null)], [true, false, false, false]);
const comPrepostagem = com({ correiosIdPrepostagem: "PR123" });
checar("prepostagem viva: mantem Correios", cifPorTransportadora(comPrepostagem), false);
checar("prepostagem viva: mostra o aviso", cifTransportadoraBarradaPorPrepostagem(comPrepostagem), true);
checar("prepostagem viva: a transportadora continua declarada", cifComTransportadoraDeclarada(comPrepostagem), true);
const cancelada = com({ correiosIdPrepostagem: "PR123", prepostagemCanceladaEm: "2026-10-07T12:00:00Z" });
checar("prepostagem cancelada: volta a ir por transportadora", [cifPorTransportadora(cancelada), cifTransportadoraBarradaPorPrepostagem(cancelada)], [true, false]);
checar("o texto do aviso", AVISO_PREPOSTAGEM_VIVA_COM_TRANSPORTADORA, "Já há prepostagem dos Correios gerada; cancele-a para despachar por transportadora");

// ── 6. Despacho confirmado ──────────────────────────────────────────────────
checar("despacho confirmado: manda expedicoes, nao o predicado",
  [cifPorTransportadora(com({ despachoConfirmado: true })), cifTransportadoraBarradaPorPrepostagem(com({ despachoConfirmado: true, correiosIdPrepostagem: "PR1" }))], [false, false]);

// ── 7. O que ja nao era Correios fica como esta ─────────────────────────────
checar("motoboy cotado com transportadora vinculada segue motoboy", cifPorTransportadora(com({ tipoFreteCotado: normalizarTipoFrete("MOTOBOY") })), false);
checar("cotacao que ja e de transportadora nao muda", cifPorTransportadora(com({ tipoFreteCotado: normalizarTipoFrete("SÃO MIGUEL") })), false);
checar("cotacao de balcao nao muda", cifPorTransportadora(com({ tipoFreteCotado: normalizarTipoFrete("RETIRA BALCAO") })), false);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
