/**
 * Testes da origem do frete (21/10/2026): card calculado (COTACAO) trava o "Valor cobrado"
 * (desde 22/10 a lista de transportadora segue aberta: e a porta do frete manual); manual e
 * antigo seguem editaveis; o Salvar recusa divergencia so com COTACAO.
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
  recusaDoFreteCalculado,
  valorCobradoLivreNaTransportadora,
  valorTravadoPeloCard
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

// ---------- motoboy interno (997, 27/10/2026): valor livre no card calculado
const motoboy = { ...marcarComoCotacao([{ id: "frete_transp_mb", valor: 27, observacao: "Entrega expressa local" }])[0], idTransportadoraCotada: 997 };
const motoboyDigitado = { ...motoboy, valor: 35 };
checar("997: id pelo mapa de parceiras, nunca pelo nome", [valorCobradoLivreNaTransportadora(997), valorCobradoLivreNaTransportadora(808), valorCobradoLivreNaTransportadora(null)], [true, false, false]);
checar("997: card calculado do motoboy NAO trava o valor", valorTravadoPeloCard(motoboy, 997), false);
checar("997: Salvar aceita 35,00 digitado sobre card de 27,00", recusaDoFreteCalculado(motoboyDigitado, 997), null);
checar("997: o que o Salvar grava e o digitado, origem COTACAO", [motoboyDigitado.valor, origemParaGravar(motoboyDigitado, { modalidade: "CIF", isAvulso: false })], [35, "COTACAO"]);
checar("997: proposta com outra transportadora sobre o card do motoboy recusa", recusaDoFreteCalculado(motoboyDigitado, 123) !== null, true);
checar("997: valor intacto e transportadora trocada recusa pela transportadora", recusaDoFreteCalculado(motoboy, 123), MENSAGEM_TRANSPORTADORA_DO_CARD);
checar("997 na proposta, mas card de outra parceira: segue travado e recusa", [
  valorTravadoPeloCard({ ...motoboyDigitado, idTransportadoraCotada: 120018 }, 997),
  recusaDoFreteCalculado({ ...motoboyDigitado, idTransportadoraCotada: 120018 }, 997)
], [true, MENSAGEM_VALOR_DO_CARD]);
checar("997 relido (carimbo vem da proposta): editavel", valorTravadoPeloCard({ ...motoboy, idTransportadoraCotada: undefined }, 997), false);
// Outra transportadora com card calculado: a regra de antes, intacta.
checar("VEPPO (120018): valor travado e Salvar recusa diferente", [
  valorTravadoPeloCard({ ...veppo, idTransportadoraCotada: 120018 }, 120018),
  recusaDoFreteCalculado({ ...veppo, valor: 50, idTransportadoraCotada: 120018 }, 120018)
], [true, MENSAGEM_VALOR_DO_CARD]);
checar("Correios (SEDEX, 39975): valor travado e Salvar recusa diferente", [
  valorTravadoPeloCard({ ...veppo, id: "sedex", idTransportadoraCotada: 39975 }, 39975),
  recusaDoFreteCalculado({ ...veppo, id: "sedex", valor: 99, idTransportadoraCotada: 39975 }, 39975)
], [true, MENSAGEM_VALOR_DO_CARD]);
checar("manual e antigo seguem livres com qualquer transportadora", [valorTravadoPeloCard(manual, 120018), valorTravadoPeloCard(antigo, 39975)], [false, false]);

// ---------- estrutura: tela e servico usam a mesma regra
const tela = ler("src/features/orcamentos/OrcamentoFormPage.tsx");
checar("tela: cards de cotacao marcados nas TRES portas (automatica, Atualizar fretes e a da abertura da aba)", [
  (tela.match(/const allResults = marcarComoCotacao\(\[/g) ?? []).length,
  tela.includes("const novas = marcarComoCotacao([...sedex, ...azul, ...transp, ...veppo])")
], [2, true]);
// Toda chamada de cotacao da tela termina em marcarComoCotacao: tres blocos que cotam, tres marcas.
checar("tela: nenhuma porta de cotacao sem a marca", [(tela.match(/solicitarCotacaoVeppo\(/g) ?? []).length, (tela.match(/marcarComoCotacao\(\[/g) ?? []).length], [3, 3]);
// 22/10/2026: o dropdown de transportadora e a UNICA porta do frete manual CIF. Com card
// calculado escolhido ele segue aberto (so o "Valor cobrado" trava); travar os dois
// impedia lancar frete manual em todo orcamento com card escolhido (24163).
checar("tela: Valor cobrado trava pela regra do valor (com a 997); dropdown de transportadora NAO", [
  tela.includes("disabled={Boolean(bloqueioTrocaFrete) || freteTravadoNoCard}"),
  tela.includes("disabled={!faseDeOrcamento || !freteEscolhido || Boolean(bloqueioTrocaFrete) || valorTravadoNoCard}") &&
    tela.includes("const valorTravadoNoCard = valorTravadoPeloCard(freteEscolhido, form.idTransportadoraCliente);"),
  tela.includes("const freteTravadoNoCard = freteTravadoPeloCard(freteEscolhido);"),
  /<SelectTransportadora\s+value=\{form\.idTransportadoraCliente\}\s+transportadoras=\{transportadoras\}\s+disabled=\{Boolean\(bloqueioTrocaFrete\)\}\s+onChange=\{escolherTransportadoraCif\}/.test(tela)
], [false, true, true, true]);
checar("tela: escolherTransportadoraCif so recusa 'nenhuma' com card; Valor cobrado recusa", [
  /function escolherTransportadoraCif\([^)]*\) \{[\s\S]{0,600}?if \(freteTravadoNoCard && idTransportadora === null\) return;/.test(tela),
  /function escolherTransportadoraCif\([^)]*\) \{\r?\n\s+if \(freteTravadoNoCard\) return;/.test(tela),
  /function aplicarValorCobradoCif\([^)]*\) \{\r?\n\s+setValorCobradoCifDraft\(null\);\r?\n\s+if \(valorTravadoNoCard\) return;/.test(tela)
], [true, false, true]);
checar("tela: ajuda do motoboy interno no lugar de mandar trocar por frete manual", tela.includes("? \"Motoboy interno: o valor cobrado pode ser editado aqui por qualquer usuário"), true);
checar("lib: 997 vem do mapa de parceiras (sem numero solto)", [
  ler("src/features/orcamentos/lib/origem-frete.ts").includes("TRANSPORTADORAS_PARCEIRAS.MOTOBOY"),
  /\b997\b/.test(ler("src/features/orcamentos/lib/origem-frete.ts").replace(/^\s*(\/\/|\*).*$/gm, ""))
], [true, false]);

// ---------- o caso do 24163: card SEDEX COTACAO escolhido -> frete manual de uma transportadora
// O frete que escolherTransportadoraCif cria (mesmo formato) e o que o Salvar recebe.
const sedexEscolhido = { ...marcarComoCotacao([{ id: "18979", valor: 819.74, observacao: "" }])[0], idTransportadoraCotada: null };
const manualNovo = { id: `manual_${Date.now()}`, valor: 819.74, observacao: "Cadastro manual" };
checar("24163: card SEDEX trava o valor (antes da troca)", freteTravadoPeloCard(sedexEscolhido), true);
checar("24163: frete manual criado sobre o card nao trava e aceita valor digitado", [freteTravadoPeloCard(manualNovo), freteTravadoPeloCard({ ...manualNovo, valor: 450 })], [false, false]);
checar("24163: Salvar aceita o manual com a transportadora escolhida e valor digitado", recusaDoFreteCalculado({ ...manualNovo, valor: 450 }, 4321), null);
checar("24163: Salvar grava origem MANUAL", origemParaGravar(manualNovo, { modalidade: "CIF", isAvulso: false }), "MANUAL");
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
