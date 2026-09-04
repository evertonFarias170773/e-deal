/**
 * Testes do RÓTULO do transporte sob modalidade (camada B do eixo FOB).
 *
 * O projeto não tem runner de testes; este arquivo roda sozinho pelo Node, que
 * remove os tipos na hora. O `--import` resolve o alias `@/` (ver _alias-hook.mjs):
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/modalidade-frete-rotulo.test.mts
 *
 * Sai com código 1 se algo falhar. Rode depois de mexer em
 * src/features/orcamentos/lib/modalidade-frete.ts — três consumidores dependem
 * dele (frete_escolhido, FORMA DE ENVIO da OS e a coluna FRETE da Expedição).
 */
import {
  TRANSPORTADORA_FOB_INDEFINIDA,
  modalidadeCobraFrete,
  nomeTransportadoraCadastro,
  nomeTransporteEfetivo,
  valorFreteEfetivo,
  faltaTransportadoraEmFob,
  aplicarModalidadeNosFretes
} from "../../src/features/orcamentos/lib/modalidade-frete.ts";
import type { PropostaFrete } from "../../src/features/orcamentos/types.ts";

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

// ── nomeTransporteEfetivo ────────────────────────────────────────────────────
// O caso que originou o eixo: proposta FOB com AVI AZUL escolhida, cotação
// registrada como SEDEX. Nenhum consumidor pode imprimir "SEDEX".
checar("FOB usa a transportadora do cadastro, não o serviço cotado",
  nomeTransporteEfetivo("SEDEX", "FOB", "AVI AZUL"), "AVI AZUL");

checar("FOB sem transportadora resolvida NÃO cai de volta no serviço cotado",
  nomeTransporteEfetivo("SEDEX", "FOB", null), TRANSPORTADORA_FOB_INDEFINIDA);

checar("FOB com transportadora só de espaços também não cai no cotado",
  nomeTransporteEfetivo("SEDEX", "FOB", "   "), TRANSPORTADORA_FOB_INDEFINIDA);

checar("CIF mantém o serviço cotado", nomeTransporteEfetivo("SEDEX", "CIF", "AVI AZUL"), "SEDEX");
checar("RETIRA mantém o serviço cotado", nomeTransporteEfetivo("SEDEX", "RETIRA", "AVI AZUL"), "SEDEX");
checar("modalidade nula (proposta anterior a 18/08/2026) mantém o cotado",
  nomeTransporteEfetivo("SEDEX", null, "AVI AZUL"), "SEDEX");
checar("sem cotação e sem modalidade devolve vazio", nomeTransporteEfetivo(null, null, null), "");
checar("espaços do serviço cotado são aparados", nomeTransporteEfetivo("  PAC  ", null, null), "PAC");

// ── nomeTransportadoraCadastro ───────────────────────────────────────────────
checar("fantasia vence razão social",
  nomeTransportadoraCadastro({ id_cliente: 120006, nome: "AVI AZUL TRANSPORTES DE CARGAS LTDA", fantasia: "AVI AZUL" }),
  "AVI AZUL");
checar("sem fantasia usa a razão social",
  nomeTransportadoraCadastro({ id_cliente: 120006, nome: "AVI AZUL TRANSPORTES DE CARGAS LTDA", fantasia: null }),
  "AVI AZUL TRANSPORTES DE CARGAS LTDA");
checar("sem nome nenhum cai no id", nomeTransportadoraCadastro({ id_cliente: 120006 }), "#120006");
checar("cadastro ausente devolve null", nomeTransportadoraCadastro(null), null);

// ── contrato preservado: a cotação continua escolhida, valendo zero ──────────
// A Expedição lê `cotacao_frete` para serviço e peso, e `obterFreteEscolhido`
// filtra por `escolhido = true`. Zerar o valor NÃO pode desmarcar a escolha.
const fretes: PropostaFrete[] = [
  { id: "frete_sedex", id_int: 1, transportadora: "Correios SEDEX", servico: "SEDEX", valor: 28.84, prazo: "1 dia útil", escolhido: true, pesoUsado: 10400 },
  { id: "frete_pac", id_int: 1, transportadora: "Correios PAC", servico: "PAC", valor: 19.5, prazo: "5 dias úteis", escolhido: false, pesoUsado: 10400 }
];
const sobFob = aplicarModalidadeNosFretes(fretes, "FOB");
checar("FOB zera só o valor do escolhido", sobFob.map((f) => f.valor), [0, 19.5]);
checar("FOB mantém escolhido = true", sobFob.map((f) => f.escolhido), [true, false]);
checar("FOB mantém o peso cotado (memória do cálculo)", sobFob.map((f) => f.pesoUsado), [10400, 10400]);
checar("fora de FOB a lista sai intacta", aplicarModalidadeNosFretes(fretes, "CIF"), fretes);
checar("valorFreteEfetivo zera em FOB", valorFreteEfetivo(28.84, "FOB"), 0);
checar("valorFreteEfetivo preserva fora de FOB", valorFreteEfetivo(28.84, "CIF"), 28.84);

// ── CIF como PADRÃO de proposta nova (19/08/2026) ───────────────────────────
// O default só é seguro porque CIF e "sem modalidade" produzem exatamente o
// mesmo dinheiro e o mesmo rótulo. Quem zera o frete é FOB, nunca CIF. Se algum
// dia CIF passar a ter regra própria, estes testes quebram ANTES da tela.
checar("CIF e nulo dão o mesmo valor de frete",
  valorFreteEfetivo(28.84, "CIF"), valorFreteEfetivo(28.84, null));
checar("CIF e nulo dão o mesmo rótulo de transporte",
  nomeTransporteEfetivo("SEDEX", "CIF", "AVI AZUL"), nomeTransporteEfetivo("SEDEX", null, "AVI AZUL"));
checar("CIF e nulo deixam a lista de fretes igualmente intacta",
  aplicarModalidadeNosFretes(fretes, "CIF"), aplicarModalidadeNosFretes(fretes, null));
checar("CIF NÃO zera o frete", valorFreteEfetivo(28.84, "CIF"), 28.84);
checar("CIF sem transportadora é válido — só FOB exige",
  faltaTransportadoraEmFob("CIF", null), false);
checar("FOB sem transportadora continua bloqueando",
  faltaTransportadoraEmFob("FOB", null), true);

// -- RETIRA tambem NAO cobra frete (04/09/2026 -- proposta 21699) ------------
// O caso real: proposta cotada em CIF/SEDEX (R$ 17,43) que o vendedor trocou
// para RETIRA. A aba Fretes esconde os cards, mas NAO desmarca o que ja estava
// escolhido -- a cotacao seguia viva por baixo, e o total saiu R$ 212,43 sobre
// R$ 195,00 de produtos. Retirada no balcao nao tem transporte: vale zero.
const sobRetira = aplicarModalidadeNosFretes(fretes, "RETIRA");
checar("valorFreteEfetivo zera em RETIRA", valorFreteEfetivo(17.43, "RETIRA"), 0);
checar("RETIRA zera so o valor do escolhido", sobRetira.map((f) => f.valor), [0, 19.5]);
checar("RETIRA mantem escolhido = true", sobRetira.map((f) => f.escolhido), [true, false]);
checar("RETIRA mantem o peso cotado (memoria do calculo)", sobRetira.map((f) => f.pesoUsado), [10400, 10400]);
checar("RETIRA e FOB produzem o mesmo dinheiro",
  valorFreteEfetivo(17.43, "RETIRA"), valorFreteEfetivo(17.43, "FOB"));
// O total do 21699, comparado em centavos: 195,00 de produtos + frete efetivo.
checar("total do 21699 fecha em 195,00",
  Math.round((195 + valorFreteEfetivo(17.43, "RETIRA")) * 100), 19500);

// O predicado que as duas funcoes compartilham -- mudou ele, mudam as duas
// juntas, que e o motivo de ele existir.
checar("modalidadeCobraFrete: CIF cobra", modalidadeCobraFrete("CIF"), true);
checar("modalidadeCobraFrete: nulo cobra", modalidadeCobraFrete(null), true);
checar("modalidadeCobraFrete: FOB nao cobra", modalidadeCobraFrete("FOB"), false);
checar("modalidadeCobraFrete: RETIRA nao cobra", modalidadeCobraFrete("RETIRA"), false);

// A exigencia de transportadora continua sendo SO de FOB: zerar o frete em
// RETIRA nao pode arrastar a regra de quem leva.
checar("RETIRA nao exige transportadora", faltaTransportadoraEmFob("RETIRA", null), false);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
