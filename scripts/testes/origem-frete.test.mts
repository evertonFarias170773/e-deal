/**
 * Testes da origem do frete (21/10/2026): card calculado (COTACAO) trava transportadora e
 * "Valor cobrado"; manual e antigo seguem editaveis; o Salvar recusa divergencia so com COTACAO.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/origem-frete.test.mts
 *
 * Nada vai ao banco.
 */
import { readFileSync } from "node:fs";
import {
  MENSAGEM_TRANSPORTADORA_DO_CARD,
  MENSAGEM_VALOR_DO_CARD,
  ehFreteManual,
  freteTravadoPeloCard,
  marcarComoCotacao,
  origemParaGravar,
  recusaDoFreteCalculado
} from "../../src/features/orcamentos/lib/origem-frete.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}${ok ? "" : `\n      esperado ${JSON.stringify(esperado)}\n      veio     ${JSON.stringify(real)}`}`);
}
const ler = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

const [veppo] = marcarComoCotacao([{ id: "veppo_1", valor: 38.9, observacao: "" }]);
const manual = { id: "manual_1", valor: 50, observacao: "Cadastro manual" };
const manualRelido = { id: "901", valor: 50, observacao: "", origem: "MANUAL" as const };
const antigo = { id: "902", valor: 12.45, observacao: "", origem: null };

// ---------- quem trava
checar("card calculado trava", freteTravadoPeloCard(veppo), true);
checar("manual edita (na sessao e relido)", [freteTravadoPeloCard(manual), freteTravadoPeloCard(manualRelido)], [false, false]);
checar("origem vazia (antigo) edita; sem frete edita", [freteTravadoPeloCard(antigo), freteTravadoPeloCard(undefined)], [false, false]);
checar("marcarComoCotacao guarda o valor cotado", [veppo.origem, veppo.valorCotado], ["COTACAO", 38.9]);
checar("ehFreteManual reconhece as tres marcas", [ehFreteManual(manual), ehFreteManual(manualRelido), ehFreteManual(veppo), ehFreteManual(antigo)], [true, true, false, false]);

// ---------- o Salvar recusa so com COTACAO
const veppoEscolhido = { ...veppo, idTransportadoraCotada: 777 };
checar("COTACAO intacto passa", recusaDoFreteCalculado(veppoEscolhido, 777), null);
checar("COTACAO com valor mexido recusa", recusaDoFreteCalculado({ ...veppoEscolhido, valor: 30 }, 777), MENSAGEM_VALOR_DO_CARD);
checar("COTACAO com transportadora trocada recusa", recusaDoFreteCalculado(veppoEscolhido, 123), MENSAGEM_TRANSPORTADORA_DO_CARD);
checar("COTACAO sem carimbo de transportadora so confere o valor", recusaDoFreteCalculado({ ...veppo }, 123), null);
checar("centavo de arredondamento nao recusa", recusaDoFreteCalculado({ ...veppoEscolhido, valor: 38.9000001 }, 777), null);
checar("manual e antigo nunca recusam", [recusaDoFreteCalculado({ ...manual, valor: 1 }, 5), recusaDoFreteCalculado({ ...manualRelido, valor: 1 }, 5), recusaDoFreteCalculado({ ...antigo, valor: 1 }, 5)], [null, null, null]);

// ---------- o que o Salvar grava
checar("origem gravada: COTACAO, MANUAL, antigo", [
  origemParaGravar(veppo, { modalidade: "CIF", isAvulso: false }),
  origemParaGravar(manual, { modalidade: "CIF", isAvulso: false }),
  origemParaGravar(antigo, { modalidade: "CIF", isAvulso: false })
], ["COTACAO", "MANUAL", null]);
checar("fora de CIF, avulsa e sem frete: nulo", [
  origemParaGravar(veppo, { modalidade: "FOB", isAvulso: false }),
  origemParaGravar(veppo, { modalidade: "RETIRA", isAvulso: false }),
  origemParaGravar(veppo, { modalidade: "CIF", isAvulso: true }),
  origemParaGravar(undefined, { modalidade: "CIF", isAvulso: false })
], [null, null, null, null]);
checar("sem modalidade conta como CIF (como o selectFrete)", origemParaGravar(veppo, { modalidade: null, isAvulso: false }), "COTACAO");

// ---------- estrutura: tela e servico usam a mesma regra
const tela = ler("src/features/orcamentos/OrcamentoFormPage.tsx");
checar("tela: cards de cotacao marcados nos dois pontos", (tela.match(/const allResults = marcarComoCotacao\(\[/g) ?? []).length, 2);
checar("tela: dropdown e Valor cobrado travam pelo card", [
  tela.includes("disabled={Boolean(bloqueioTrocaFrete) || freteTravadoNoCard}"),
  tela.includes("disabled={!faseDeOrcamento || !freteEscolhido || Boolean(bloqueioTrocaFrete) || freteTravadoNoCard}"),
  tela.includes("const freteTravadoNoCard = freteTravadoPeloCard(freteEscolhido);")
], [true, true, true]);
checar("tela: funcoes de escrita tambem se recusam", [/function escolherTransportadoraCif\([^)]*\) \{\r?\n\s+if \(freteTravadoNoCard\) return;/.test(tela), /function aplicarValorCobradoCif\([^)]*\) \{\r?\n\s+setValorCobradoCifDraft\(null\);\r?\n\s+if \(freteTravadoNoCard\) return;/.test(tela)], [true, true]);
checar("tela: carimbo no selectFrete e na correcao do admin", [tela.includes("idTransportadoraCotada: vinculoParceira"), tela.includes("idTransportadoraCotada: gravado")], [true, true]);

const srv = ler("src/features/orcamentos/services/orcamentos.service.ts");
checar("saveProposta: recusa antes de escrever e grava a origem", [
  srv.includes("const recusaCard = recusaDoFreteCalculado(chosenFrete, idTransportadoraCliente);"),
  srv.indexOf("const recusaCard = recusaDoFreteCalculado") < srv.indexOf('.from("cotacao_frete")\n          .delete()'),
  srv.includes("origem: origemParaGravar(chosenFrete, { modalidade: modalidadeVigente, isAvulso: formState.isAvulso === true })")
], [true, true, true]);
const freteSrv = ler("src/features/orcamentos/services/frete.service.ts");
checar("releitura le a origem (so os dois valores do CHECK)", freteSrv.includes('row.origem === "COTACAO" || row.origem === "MANUAL" ? row.origem : null'), true);

const mig = ler("supabase/migrations/20261021_cotacao_frete_origem.sql");
const ativo = mig.slice(0, mig.indexOf("-- ROLLBACK —"));
checar("migration: so a coluna com CHECK, sem default nem backfill", [
  /ADD COLUMN origem text\s+CONSTRAINT cotacao_frete_origem_valida CHECK \(origem IS NULL OR origem IN \('COTACAO', 'MANUAL'\)\);/.test(ativo),
  /DEFAULT|UPDATE\s+public\.cotacao_frete|GRANT|POLICY/i.test(ativo.replace(/^--.*$/gm, ""))
], [true, false]);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
