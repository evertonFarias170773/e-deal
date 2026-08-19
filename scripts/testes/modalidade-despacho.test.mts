/**
 * Precedência da modalidade com que o modal de despacho abre.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/modalidade-despacho.test.mts
 *
 * Existe porque, desde que o orçamento nasce em CIF por padrão (19/08/2026), a
 * inferência de RETIRA a partir de uma cotação de balcão passou a competir com a
 * modalidade do orçamento — e a regra que resolve isso não pode viver só dentro
 * de um .tsx, onde nenhum teste alcança.
 */
import { modalidadeInicialDoDespacho } from "../../src/features/expedicao/lib/tipo-frete.ts";

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

// ── 1. O despacho é soberano, sempre ────────────────────────────────────────
checar("despacho vence a cotacao de balcao",
  modalidadeInicialDoDespacho("CIF", null, "RETIRA_BALCAO"), "CIF");
checar("despacho vence o orcamento",
  modalidadeInicialDoDespacho("FOB", "CIF", "CORREIOS"), "FOB");

// ── 2. Cotação de balcão vence o CIF do orçamento — o caso desta correção ───
checar("cotacao de balcao vence o CIF padrao do orcamento",
  modalidadeInicialDoDespacho(null, "CIF", "RETIRA_BALCAO"), "RETIRA");
checar("cotacao de balcao com orcamento nulo (legado) segue inferindo RETIRA",
  modalidadeInicialDoDespacho(null, null, "RETIRA_BALCAO"), "RETIRA");
checar("cotacao de balcao com orcamento ja em RETIRA nao muda nada",
  modalidadeInicialDoDespacho(null, "RETIRA", "RETIRA_BALCAO"), "RETIRA");

// ── 3. FOB é imune: escolha deliberada, com transportadora obrigatoria junto ─
checar("FOB explicito NAO e sobreposto pela cotacao de balcao",
  modalidadeInicialDoDespacho(null, "FOB", "RETIRA_BALCAO"), "FOB");

// ── 4. Fora do balcão, o orçamento manda ────────────────────────────────────
checar("CIF do orcamento vale quando a cotacao e Correios",
  modalidadeInicialDoDespacho(null, "CIF", "CORREIOS"), "CIF");
checar("CIF do orcamento vale quando a cotacao e transportadora",
  modalidadeInicialDoDespacho(null, "CIF", "TRANSPORTADORA"), "CIF");
checar("orcamento nulo e cotacao indefinida abrem SEM modalidade",
  modalidadeInicialDoDespacho(null, null, "INDEFINIDO"), null);
// "Sem custo" continua sem ganhar chute: o proprio banco e o TypeScript divergem
// ao ler esse texto, entao ele nao infere retirada.
checar("SEM_CUSTO nao infere RETIRA",
  modalidadeInicialDoDespacho(null, null, "SEM_CUSTO"), null);
checar("SEM_CUSTO tambem nao sobrepoe o CIF do orcamento",
  modalidadeInicialDoDespacho(null, "CIF", "SEM_CUSTO"), "CIF");

// ── 5. undefined se comporta como nulo (o modal passa exp?.modalidadeFrete) ──
checar("undefined do despacho cai para o orcamento",
  modalidadeInicialDoDespacho(undefined, "CIF", "CORREIOS"), "CIF");
checar("undefined nos dois abre sem modalidade",
  modalidadeInicialDoDespacho(undefined, undefined, "CORREIOS"), null);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
