/**
 * Rota /api/propostas/frete-status: complemento de original em RETIRA ou FOB
 * não bloqueia a cobrança; CIF sem frete complementar continua bloqueado
 * (11/11/2026, caso 25107, complemento do 24984 em RETIRA).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/frete-status-complemento-herdado.test.mts
 *
 * SEM banco: cliente Supabase falso com os dados do 25107 lidos do banco em
 * 11/11/2026 (vínculo 24984, modalidade_frete RETIRA, 1 item ativo, sem
 * cotação escolhida, sem linha em complementos_frete).
 */
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const url = (arquivo: string) => pathToFileURL(path.join(AQUI, arquivo)).href;
registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === "@supabase/supabase-js") return { url: url("_supabase-js-falso-com-tipos.mts"), shortCircuit: true };
    if (especificador === "next/server") return { url: url("_next-server-falso-com-tipos.mts"), shortCircuit: true };
    return proximo(especificador, contexto);
  }
});

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const { falso } = await import("./_supabase-falso.mts");
const rota = await import("../../src/app/api/propostas/frete-status/route.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

function prepararComplemento(modalidade: string | null, ledger: Record<string, unknown> | null = null) {
  falso.zerar();
  falso.responder("cotacao_frete:select", { data: null, error: null });
  falso.responder("produtos_proposta:select", { data: [{ peso_total: 120 }], error: null });
  falso.responder("propostas:select", { data: { id_int_pedido_principal: 24984, modalidade_frete: modalidade }, error: null });
  falso.responder("complementos_frete:select", { data: ledger, error: null });
}

async function consultar(idInt = 25107) {
  const resposta = await rota.GET(
    new Request(`http://localhost/api/propostas/frete-status?idInt=${idInt}`, { headers: { authorization: "Bearer token-de-teste" } })
  );
  const json = (await resposta.json()) as { success: boolean; situacao: { bloqueia: boolean; motivo: string }; mensagem: string };
  return { status: resposta.status, json, escritas: falso.chamadas.filter((c) => c.op !== "select") };
}

console.log("== 25107: complemento do 24984, RETIRA");
prepararComplemento("RETIRA");
{
  const r = await consultar();
  confere("rota devolve bloqueia=false", r.status === 200 && r.json.success && r.json.situacao.bloqueia === false, r.json);
  confere("motivo FRETE_COMPLEMENTAR_HERDADO, sem mensagem de bloqueio", r.json.situacao.motivo === "FRETE_COMPLEMENTAR_HERDADO" && r.json.mensagem === "", r.json);
  confere("a rota lê a modalidade do complemento", falso.chamadas.some((c) => c.tabela === "propostas"));
  confere("nada gravado", r.escritas.length === 0, r.escritas);
}

console.log("== FOB");
prepararComplemento("FOB");
{
  const r = await consultar();
  confere("complemento FOB: bloqueia=false", r.json.situacao.bloqueia === false && r.json.situacao.motivo === "FRETE_COMPLEMENTAR_HERDADO", r.json);
}

console.log("== CIF sem frete complementar aplicado");
prepararComplemento("CIF");
{
  const r = await consultar();
  confere("complemento CIF: continua bloqueado (FRETE_COMPLEMENTAR_PENDENTE)", r.json.situacao.bloqueia === true && r.json.situacao.motivo === "FRETE_COMPLEMENTAR_PENDENTE", r.json);
  confere("a mensagem manda aplicar o frete complementar", /frete complementar ainda está pendente/.test(r.json.mensagem), r.json.mensagem);
}

console.log("== CIF com frete complementar aplicado");
prepararComplemento("CIF", { id: 1, desvinculado_em: null });
{
  const r = await consultar();
  confere("complemento CIF com frete aplicado: não bloqueia, como antes", r.json.situacao.bloqueia === false && r.json.situacao.motivo === "SEM_COTACAO", r.json);
}

console.log("== RETIRA desvinculado");
prepararComplemento("RETIRA", { id: 1, desvinculado_em: "2026-11-10T12:00:00Z" });
{
  const r = await consultar();
  confere("desvinculado continua bloqueado (FRETE_COMPLEMENTAR_INVALIDADO)", r.json.situacao.bloqueia === true && r.json.situacao.motivo === "FRETE_COMPLEMENTAR_INVALIDADO", r.json);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
