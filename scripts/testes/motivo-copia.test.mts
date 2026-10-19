/**
 * Testes do motivo da copia (19/10/2026): "Duplicar proposta" pergunta Duplicacao ou
 * Retrabalho. A regra pura, o ponto unico (duplicarProposta) e as tres portas.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/motivo-copia.test.mts
 *
 * Nada vai ao banco. A funcao do banco foi provada em transacao revertida.
 */
import { readFileSync } from "node:fs";
import {
  MOTIVOS_DA_COPIA,
  ehMotivoDaCopia,
  mensagensDaCopia,
  motivosPermitidos
} from "../../src/features/orcamentos/lib/motivo-copia.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}${ok ? "" : `\n      esperado ${JSON.stringify(esperado)}\n      veio     ${JSON.stringify(real)}`}`);
}
const ler = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

// ---------- regra
checar("os dois motivos, na ordem do banco", MOTIVOS_DA_COPIA, ["DUPLICACAO", "RETRABALHO"]);
checar("pedido comum oferece os dois", motivosPermitidos(false), ["DUPLICACAO", "RETRABALHO"]);
checar("pedido que ja e copia so oferece Retrabalho", motivosPermitidos(true), ["RETRABALHO"]);
checar("sem saber, os dois (o banco decide)", motivosPermitidos(null), ["DUPLICACAO", "RETRABALHO"]);
checar("motivo valido", [ehMotivoDaCopia("DUPLICACAO"), ehMotivoDaCopia("RETRABALHO"), ehMotivoDaCopia("retrabalho"), ehMotivoDaCopia(""), ehMotivoDaCopia(null)], [true, true, false, false, false]);
checar("chat da duplicacao, como antes", mensagensDaCopia("DUPLICACAO", 100, 200), {
  naOrigem: "Proposta duplicada. Nova proposta gerada: #200.",
  naNova: "Proposta duplicada a partir da proposta #100."
});
checar("chat do retrabalho", mensagensDaCopia("RETRABALHO", 100, 200), {
  naOrigem: "Retrabalho gerado: pedido #200.",
  naNova: "Retrabalho do pedido #100."
});

// ---------- ponto unico
const servico = ler("src/features/orcamentos/services/orcamentos.service.ts");
checar("duplicarProposta exige o motivo e o passa a copiar_proposta_v2", [
  /export async function duplicarProposta\(\s*idIntOrigem: number,\s*motivo: MotivoDaCopia\s*\)/.test(servico),
  /rpc\("copiar_proposta_v2", \{\s*p_id_int_origem: idIntOrigem,\s*p_motivo: motivo\s*\}\)/.test(servico),
  (servico.match(/rpc\("copiar_proposta_v2"/g) ?? []).length
], [true, true, 1]);
checar("nenhum caminho grava motivo_copia pelo app", /motivo_copia\s*:/.test(servico), false);

// ---------- as tres portas
for (const p of ["OrcamentosListPageReal.tsx", "OrcamentoDetailPage.tsx", "OrcamentoFormPage.tsx"]) {
  const t = ler(`src/features/orcamentos/${p}`);
  checar(`${p}: usa o gancho, mostra o modal e nao chama duplicarProposta direto`, [
    t.includes("useDuplicarProposta()"),
    t.includes("{modalDuplicar}"),
    /pedirDuplicacao\(/.test(t),
    /duplicarProposta\(/.test(t),
    /confirm\([^)]*duplicar/i.test(t)
  ], [true, true, true, false, false]);
}

const gancho = ler("src/features/orcamentos/hooks/useDuplicarProposta.tsx");
checar("gancho: confere se e copia e so cria depois da escolha", [
  gancho.includes("lerSePropostaEhCopia(idInt)"),
  /async function escolher\(motivo: MotivoDaCopia\)[\s\S]*duplicarProposta\(idInt, motivo\)/.test(gancho),
  (gancho.match(/duplicarProposta\(/g) ?? []).length
], [true, true, 1]);

const modal = ler("src/features/orcamentos/components/DuplicarPropostaModal.tsx");
checar("modal: titulo, foco no Cancelar e um botao por motivo permitido", [
  modal.includes("Duplicação ou Retrabalho?"),
  /autoFocus\s+onClick=\{onClose\}/.test(modal),
  modal.includes("motivos.map((motivo)")
], [true, true, true]);

// ---------- migration
const mig = ler("supabase/migrations/20261019_propostas_motivo_copia.sql");
const ativo = mig.slice(0, mig.indexOf("-- ROLLBACK — devolve"));
checar("migration: guard do md5, coluna com CHECK, motivo padrao, retrabalho de copia e linha na orientacao", [
  ativo.includes("IS DISTINCT FROM '1791b6bbbd0396c87ec5888748534021'"),
  /ADD COLUMN motivo_copia text\s+CONSTRAINT propostas_motivo_copia_valido CHECK/.test(ativo),
  ativo.includes("p_motivo text DEFAULT 'DUPLICACAO'"),
  ativo.includes("IF v_motivo = 'DUPLICACAO' AND EXISTS ("),
  ativo.includes("'Retrabalho do pedido #' || p_id_int_origem"),
  /GRANT [^;]* TO anon/.test(ativo),
  /\bUPDATE public\.propostas\s+SET motivo_copia/i.test(ativo)
], [true, true, true, true, true, false, false]);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
