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
  valorTravadoPeloCard,
  aplicarValorDigitado,
  atualizarCotadoDoDigitado,
  freteValorDigitadoParaGravar,
  limparValorDigitadoForaDe,
  preservadoSemCotacao,
  recotacaoAutomaticaDoEscolhido,
  semValorDigitado,
  valorDigitadoRelido
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

// ---------- valor digitado do 997 sobrevive a recotacao automatica (27/10/2026)
{
  const ctx = { idTransportadora: 997, modalidade: "CIF", isAvulso: false };
  const card27 = { ...marcarComoCotacao([{ id: "frete_transp_mb", valor: 27, observacao: "Entrega expressa local" }])[0], idTransportadoraCotada: 997 };
  // 1. digita 35,00
  const digitado = aplicarValorDigitado(card27, 35, 997);
  checar("fluxo 997: digitar 35,00 acende a marca", [digitado.valor, digitado.valorCotado, digitado.valorDigitado], [35, 27, true]);
  checar("fluxo 997: digitar o proprio cotado nao marca", aplicarValorDigitado(card27, 27, 997).valorDigitado, false);
  // 2. salvar grava true
  checar("fluxo 997: Salvar grava frete_valor_digitado = true e valor 35", [freteValorDigitadoParaGravar(digitado, ctx), recusaDoFreteCalculado(digitado, 997)], [true, null]);
  // 3. recarregar do banco: linha gravada (id do banco, valor 35, origem COTACAO) + marca true
  const relidoBruto = { id: "19999", valor: 35, observacao: "", origem: "COTACAO" as const, valorCotado: 35, idTransportadoraCotada: 997 };
  const relido = valorDigitadoRelido(relidoBruto, true, 997);
  checar("fluxo 997: recarregado reabilita o digitado (cotado so na proxima cotacao)", [relido.valor, relido.valorDigitado, relido.valorCotado], [35, true, undefined]);
  checar("fluxo 997: sem a marca gravada, releitura fica como antes", valorDigitadoRelido(relidoBruto, null, 997).valorDigitado, undefined);
  const abertura = atualizarCotadoDoDigitado(relido, { valor: 27 });
  checar("fluxo 997: cotacao da abertura da aba traz so o cotado", [abertura.valor, abertura.valorCotado, abertura.valorDigitado], [35, 27, true]);
  // 4. altera peso/item -> recotacao automatica com o motoboy agora a 30,00
  const novoCard = marcarComoCotacao([{ id: "frete_transp_mb", valor: 30, observacao: "Entrega expressa local" }])[0];
  const aposRecotar = recotacaoAutomaticaDoEscolhido(abertura, novoCard, 997);
  checar("fluxo 997: alterar peso mantem 35,00 e atualiza o cotado para 30,00", [aposRecotar.valor, aposRecotar.valorCotado, aposRecotar.valorDigitado, aposRecotar.idTransportadoraCotada], [35, 30, true, 997]);
  checar("fluxo 997: e o Salvar seguinte continua gravando true e 35", [freteValorDigitadoParaGravar(aposRecotar, ctx), aposRecotar.valor], [true, 35]);
  // 5. Atualizar fretes (explicito): card novo, sem marca
  const [atualizado] = semValorDigitado([novoCard]);
  checar("fluxo 997: Atualizar fretes volta ao cotado e limpa a marca", [atualizado.valor, atualizado.valorDigitado ?? false, freteValorDigitadoParaGravar(atualizado, ctx)], [30, false, null]);
  // 6. trocar de card limpa
  const sedex = { ...marcarComoCotacao([{ id: "frete_sedex", valor: 50, observacao: "" }])[0], idTransportadoraCotada: 39975 };
  const trocado = limparValorDigitadoForaDe([aposRecotar, sedex], "frete_sedex");
  checar("fluxo 997: trocar de card limpa a marca e o 997 volta ao cotado", [trocado[0].valorDigitado, trocado[0].valor, freteValorDigitadoParaGravar(trocado[1], { ...ctx, idTransportadora: 39975 })], [false, 30, null]);
  checar("fluxo 997: transportadora trocada na proposta grava null", freteValorDigitadoParaGravar(aposRecotar, { ...ctx, idTransportadora: 120018 }), null);
  checar("fluxo 997: FOB, RETIRA e avulsa gravam null", [
    freteValorDigitadoParaGravar(aposRecotar, { ...ctx, modalidade: "FOB" }),
    freteValorDigitadoParaGravar(aposRecotar, { ...ctx, modalidade: "RETIRA" }),
    freteValorDigitadoParaGravar(aposRecotar, { ...ctx, isAvulso: true })
  ], [null, null, null]);
  // 7. motoboy deixou de ser cotado: preservado, mas sem o digitado as cegas
  const semCotacao = preservadoSemCotacao(aposRecotar);
  checar("fluxo 997: motoboy fora da cotacao volta ao ultimo cotado e limpa", [semCotacao.valor, semCotacao.valorDigitado], [30, false]);
  // 8. outra transportadora com card calculado: segue como antes
  const veppoCard = { ...marcarComoCotacao([{ id: "frete_veppo", valor: 38.9, observacao: "" }])[0], idTransportadoraCotada: 120018 };
  const veppoMexido = aplicarValorDigitado(veppoCard, 50, 120018);
  checar("VEPPO: sem marca, travado, Salvar recusa e grava null", [
    veppoMexido.valorDigitado, valorTravadoPeloCard(veppoMexido, 120018), recusaDoFreteCalculado(veppoMexido, 120018), freteValorDigitadoParaGravar(veppoMexido, { ...ctx, idTransportadora: 120018 })
  ], [false, true, MENSAGEM_VALOR_DO_CARD, null]);
  const veppoNovo = marcarComoCotacao([{ id: "frete_veppo", valor: 41, observacao: "" }])[0];
  checar("VEPPO: recotacao automatica traz o valor novo (regra de antes)", recotacaoAutomaticaDoEscolhido({ ...veppoCard, valorDigitado: true }, veppoNovo, 120018).valor, 41);
}

// ---------- estrutura: tela e servico usam a mesma regra
const tela = ler("src/features/orcamentos/OrcamentoFormPage.tsx");
checar("tela: cards de cotacao marcados nas TRES portas (automatica, Atualizar fretes e a da abertura da aba)", [
  (tela.match(/const allResults = marcarComoCotacao\(\[/g) ?? []).length,
  tela.includes("const cotadas = marcarComoCotacao([...sedex, ...azul, ...transp, ...veppo]);")
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
  /\b997\b/.test(ler("src/features/orcamentos/lib/origem-frete.ts").replace(/^\s*(\/\/|\/?\*).*$/gm, ""))
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

checar("tela: as portas de cotacao usam a regra do valor digitado", [
  tela.includes("return { ...recotacaoAutomaticaDoEscolhido(currentChosen, newFrete, prev.idTransportadoraCliente), escolhido: true };"),
  tela.includes("const updatedResults = semValorDigitado(allResults).map((newFrete) => {"),
  (tela.match(/preservedFretes\.push\(preservadoSemCotacao\(\{/g) ?? []).length,
  tela.includes("aplicarValorDigitado(f, valor, current.idTransportadoraCliente)"),
  tela.includes("limparValorDigitadoForaDe(form.fretes, freteId)"),
  (tela.match(/limparValorDigitadoForaDe\(current\.fretes, freteManual\.id\)/g) ?? []).length,
  tela.includes("atualizarCotadoDoDigitado(f, equivalente)")
], [true, true, 2, true, true, 2, true]);

const srv = ler("src/features/orcamentos/services/orcamentos.service.ts");
checar("saveProposta: marca so na fase de orcamento, no gate do frete; releitura reabilita", [
  /if \(faseDeOrcamento\) \{\s+propostaData\.frete_valor_digitado = ehComplemento/.test(srv),
  srv.indexOf("propostaData.frete_valor_digitado") > srv.indexOf("propostaData.id_transportadora_cliente = idTransportadoraCliente;"),
  srv.includes("valorDigitadoRelido(f, proposalRow.frete_valor_digitado, idTranspRelida)")
], [true, true, true]);
const migDig = ler("supabase/migrations/20261027_propostas_frete_valor_digitado.sql");
const migDigAtiva = migDig.slice(0, migDig.indexOf("-- ROLLBACK —")) + migDig.slice(migDig.indexOf("ALTER TABLE public.propostas\n") >= 0 ? migDig.indexOf("ALTER TABLE public.propostas\n") : migDig.indexOf("ALTER TABLE public.propostas\r\n"));
checar("migration frete_valor_digitado: so ADD COLUMN boolean e COMMENT, sem default/backfill/trigger/grant", [
  /ADD COLUMN IF NOT EXISTS frete_valor_digitado boolean;/.test(migDig),
  /\bDEFAULT\b|UPDATE\s+public|TRIGGER|GRANT|POLICY|cotacao_frete\s+(ADD|ALTER)/i.test(migDigAtiva.replace(/^--.*$/gm, ""))
], [true, false]);
checar("saveProposta: recusa antes de escrever e grava a origem", [
  srv.includes("const recusaCard = recusaDoFreteCalculado(chosenFrete, idTransportadoraCliente);"),
  // \r?\n: a copia de trabalho pode estar em CRLF (autocrlf do Windows).
  (() => {
    const del = srv.search(/\.from\("cotacao_frete"\)\r?\n\s+\.delete\(\)/);
    return del > 0 && srv.indexOf("const recusaCard = recusaDoFreteCalculado") < del;
  })(),
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
