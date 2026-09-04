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
import {
  modalidadeInicialDoDespacho,
  origemDaModalidadeInicial
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

// ── 1. O despacho CONFIRMADO é soberano ─────────────────────────────────────
checar("despacho confirmado vence a cotacao de balcao",
  modalidadeInicialDoDespacho("CIF", null, "RETIRA_BALCAO", true), "CIF");
checar("despacho confirmado vence o orcamento",
  modalidadeInicialDoDespacho("FOB", "CIF", "CORREIOS", true), "FOB");

// ── 1b. RASCUNHO NÃO é soberano (04/09/2026) ────────────────────────────────
// A linha de `expedicoes` nasce em `marcarPronto`, muito antes do despacho.
// Enquanto `data_despacho` é nula ela é pré-seleção, e a proposta prevalece —
// senão uma correção de frete feita no orçamento fica presa atrás do rascunho,
// como no pedido 21000 (rascunho RETIRA, proposta corrigida para FOB).
checar("rascunho NAO vence o orcamento corrigido — caso 21000",
  modalidadeInicialDoDespacho("RETIRA", "FOB", "RETIRA_BALCAO", false), "FOB");
checar("rascunho NAO vence o orcamento fora do balcao",
  modalidadeInicialDoDespacho("RETIRA", "CIF", "CORREIOS", false), "CIF");
checar("o mesmo par, ja despachado, segue mostrando o despacho",
  modalidadeInicialDoDespacho("RETIRA", "FOB", "RETIRA_BALCAO", true), "RETIRA");

// ── 1c. O rascunho não é descartado: vira o ÚLTIMO degrau ───────────────────
// Sem modalidade na proposta e sem cotação de balcão, quem responde é ele — a
// alternativa seria devolver `null` e fazer o modal exigir escolha onde hoje
// não exige, reabrindo um campo que é somente leitura.
checar("sem orcamento e sem balcao, o rascunho responde",
  modalidadeInicialDoDespacho("CIF", null, "CORREIOS", false), "CIF");
checar("sem orcamento e sem balcao, a origem exibida e o despacho",
  origemDaModalidadeInicial("CIF", null, "CORREIOS", false), "DESPACHO");
checar("com orcamento, a origem exibida e o orcamento mesmo havendo rascunho",
  origemDaModalidadeInicial("RETIRA", "FOB", "CORREIOS", false), "ORCAMENTO");
checar("despachado, a origem exibida volta a ser o despacho",
  origemDaModalidadeInicial("RETIRA", "FOB", "CORREIOS", true), "DESPACHO");

// ── 2. Cotação de balcão vence o CIF do orçamento — o caso desta correção ───
checar("cotacao de balcao vence o CIF padrao do orcamento",
  modalidadeInicialDoDespacho(null, "CIF", "RETIRA_BALCAO", false), "RETIRA");
checar("cotacao de balcao com orcamento nulo (legado) segue inferindo RETIRA",
  modalidadeInicialDoDespacho(null, null, "RETIRA_BALCAO", false), "RETIRA");
checar("cotacao de balcao com orcamento ja em RETIRA nao muda nada",
  modalidadeInicialDoDespacho(null, "RETIRA", "RETIRA_BALCAO", false), "RETIRA");

// ── 3. FOB é imune: escolha deliberada, com transportadora obrigatoria junto ─
checar("FOB explicito NAO e sobreposto pela cotacao de balcao",
  modalidadeInicialDoDespacho(null, "FOB", "RETIRA_BALCAO", false), "FOB");

// ── 4. Fora do balcão, o orçamento manda ────────────────────────────────────
checar("CIF do orcamento vale quando a cotacao e Correios",
  modalidadeInicialDoDespacho(null, "CIF", "CORREIOS", false), "CIF");
checar("CIF do orcamento vale quando a cotacao e transportadora",
  modalidadeInicialDoDespacho(null, "CIF", "TRANSPORTADORA", false), "CIF");
checar("orcamento nulo e cotacao indefinida abrem SEM modalidade",
  modalidadeInicialDoDespacho(null, null, "INDEFINIDO", false), null);
// "Sem custo" continua sem ganhar chute: o proprio banco e o TypeScript divergem
// ao ler esse texto, entao ele nao infere retirada.
checar("SEM_CUSTO nao infere RETIRA",
  modalidadeInicialDoDespacho(null, null, "SEM_CUSTO", false), null);
checar("SEM_CUSTO tambem nao sobrepoe o CIF do orcamento",
  modalidadeInicialDoDespacho(null, "CIF", "SEM_CUSTO", false), "CIF");

// ── 5. undefined se comporta como nulo (o modal passa exp?.modalidadeFrete) ──
checar("undefined do despacho cai para o orcamento",
  modalidadeInicialDoDespacho(undefined, "CIF", "CORREIOS", false), "CIF");
checar("undefined nos dois abre sem modalidade",
  modalidadeInicialDoDespacho(undefined, undefined, "CORREIOS", false), null);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
