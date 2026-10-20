/**
 * Testes de E-RETRABALHO x pedido de retrabalho (20/10/2026): o espelho do gatilho
 * trg_pgv2_tipo_x_motivo_copia e as portas que gravam cobranca.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/tipo-x-retrabalho.test.mts
 *
 * Nada vai ao banco. O gatilho foi provado em transacao revertida.
 */
import { readFileSync } from "node:fs";
import {
  MENSAGEM_E_RETRABALHO_FORA_DE_RETRABALHO as FORA,
  MENSAGEM_OUTRO_TIPO_EM_RETRABALHO as OUTRO,
  recusaDoGatilhoNoErro,
  recusaDoTipoNoPedido,
  tipoApareceNoPedido
} from "../../src/features/cobrancas/lib/tipo-x-retrabalho.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}${ok ? "" : `\n      esperado ${JSON.stringify(esperado)}\n      veio     ${JSON.stringify(real)}`}`);
}
const ler = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

const comum = { motivoCopia: null, jaTeveRetrabalho: false };
const duplicacao = { motivoCopia: "DUPLICACAO", jaTeveRetrabalho: false };
const retrabalho = { motivoCopia: "RETRABALHO", jaTeveRetrabalho: false };
const antigo = { motivoCopia: null, jaTeveRetrabalho: true };

// ---------- a regra (mesmas mensagens do gatilho)
checar("E-RETRABALHO em pedido comum: recusa", recusaDoTipoNoPedido("E-RETRABALHO", comum), FORA);
checar("E-RETRABALHO em duplicacao: recusa", recusaDoTipoNoPedido("e-retrabalho", duplicacao), FORA);
checar("E-RETRABALHO em retrabalho: passa", recusaDoTipoNoPedido("E-RETRABALHO", retrabalho), null);
checar("E-RETRABALHO em antigo que ja teve: passa", recusaDoTipoNoPedido("E-RETRABALHO", antigo), null);
checar("outros tipos em retrabalho: recusa", ["PIX", "BOLETO", "CARD_PARCELADO", "E-FATURADO", "E-CREDITO", "E-AMOSTRA"].map((t) => recusaDoTipoNoPedido(t, retrabalho)), Array(6).fill(OUTRO));
checar("outros tipos em antigo e em comum: passam", [recusaDoTipoNoPedido("PIX", antigo), recusaDoTipoNoPedido("E-FATURADO", comum)], [null, null]);

// ---------- o que a tela mostra
const TODAS = ["PIX", "BOLETO", "CARD_PARCELADO", "E-FATURADO", "E-PERMUTA", "E-AMOSTRA", "E-RETRABALHO", "E-CREDITO"];
checar("tela: retrabalho so mostra E-RETRABALHO", TODAS.filter((t) => tipoApareceNoPedido(t, retrabalho)), ["E-RETRABALHO"]);
checar("tela: comum mostra tudo menos E-RETRABALHO", TODAS.filter((t) => tipoApareceNoPedido(t, comum)), TODAS.filter((t) => t !== "E-RETRABALHO"));
checar("tela: antigo que ja teve mostra tudo", TODAS.filter((t) => tipoApareceNoPedido(t, antigo)), TODAS);
checar("tela: sem contexto ainda, so esconde E-RETRABALHO", TODAS.filter((t) => tipoApareceNoPedido(t, null)), TODAS.filter((t) => t !== "E-RETRABALHO"));

// ---------- a mensagem do gatilho sai limpa
checar("erro do banco vira a mensagem do gatilho", [
  recusaDoGatilhoNoErro(`P0001: ${FORA}`),
  recusaDoGatilhoNoErro(`new row ... ${OUTRO}`),
  recusaDoGatilhoNoErro("duplicate key value"),
  recusaDoGatilhoNoErro(undefined)
], [FORA, OUTRO, null, null]);

// ---------- portas
const painel = ler("src/features/cobrancas/PropostaCobrancaPanel.tsx");
checar("painel: lista filtrada pelo pedido nos dois modais e trava no envio", [
  (painel.match(/\{opcoesDoPedido\.map\(\(opcao\) => \{/g) ?? []).length,
  /\{opcoesPagamento\.map\(/.test(painel),
  painel.includes("recusaDoTipoNoPedido(form.tipoCobranca, contextoRetrabalhoDoPedido)"),
  painel.includes("lerContextoRetrabalhoDoPedido(client, idInt)")
], [2, false, true, true]);

const provider = ler("src/features/cobrancas/CobrancasProvider.tsx");
checar("provider: recusa do gatilho chega limpa", provider.includes("recusaDoGatilhoNoErro(insertError?.message)"), true);

const usar = ler("src/app/api/cobrancas/usar-credito/route.ts");
checar("usar-credito: confere depois da idempotencia e antes do saldo/insert", [
  usar.indexOf("4b. Idempotência") < usar.indexOf("recusaDoTipoNoPedido(\"E-CREDITO\""),
  usar.indexOf("recusaDoTipoNoPedido(\"E-CREDITO\"") < usar.indexOf("── 5. Saldo real"),
  usar.includes("recusaDoGatilhoNoErro(pagamentoError?.message)")
], [true, true, true]);

const comb = ler("src/app/api/cobrancas/pagamento-combinado/route.ts");
checar("pagamento-combinado: confere os dois tipos depois da idempotencia e antes do consumo", [
  comb.indexOf("B2. Idempotência") < comb.indexOf("B2b. E-RETRABALHO"),
  comb.indexOf("B2b. E-RETRABALHO") < comb.indexOf("D. Criar Cobrança E-CREDITO"),
  comb.includes("recusaDoTipoNoPedido(tipoSecundario, contextoRetrabalho)"),
  comb.includes("recusaDoGatilhoNoErro(errPagV2Credito?.message)")
], [true, true, true, true]);

const area = ler("src/features/area-cliente/services/area-cliente.server.ts");
checar("area do cliente: recusa do gatilho vira BLOQUEADO com mensagem", /const recusa = recusaDoGatilhoNoErro\(insertErr\.message\);\s+if \(recusa\) return \{ ok: false, codigo: "BLOQUEADO"/.test(area), true);

// ---------- migration
const mig = ler("supabase/migrations/20261020_pagamentos_v2_tipo_x_motivo_copia.sql");
const ativo = mig.slice(0, mig.indexOf("-- ROLLBACK — tire"));
checar("migration: gatilho certo, nao age sem mudar tipo/pedido, sem definer, sem anon", [
  ativo.includes("BEFORE INSERT OR UPDATE OF tipo_cobranca, id_int ON public.pagamentos_v2"),
  /NEW\.tipo_cobranca IS NOT DISTINCT FROM OLD\.tipo_cobranca\s+AND NEW\.id_int IS NOT DISTINCT FROM OLD\.id_int/.test(ativo),
  /SECURITY DEFINER/.test(ativo.replace(/^--.*$/gm, "")),
  /GRANT [^;]* TO anon/.test(ativo),
  ativo.includes(`'${FORA}'`),
  ativo.includes(`'${OUTRO}'`)
], [true, true, false, false, true, true]);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
