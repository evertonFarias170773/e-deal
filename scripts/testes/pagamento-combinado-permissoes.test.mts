/**
 * Pagamento combinado (E-Crédito + restante): a permissão exigida é a da forma
 * do restante (12/11/2026, caso 25197, vendedor com E-Crédito R$ 50 + PIX).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/pagamento-combinado-permissoes.test.mts
 *
 * SEM banco: cliente Supabase falso. O perfil Vendedor é o do banco em
 * 12/11/2026 (id 4: tem credito.usar e cobrancas.create, não tem
 * cobrancas.emitir_boleto). Quando a permissão passa, a leitura da proposta
 * devolve vazio e a rota para em 404 "Proposta não encontrada": prova que a
 * conferência deixou passar, sem chegar a gravar nada.
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
const rota = await import("../../src/app/api/cobrancas/pagamento-combinado/route.ts");
const regra = await import("../../src/features/cobrancas/lib/permissoes-pagamento-combinado.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

const VENDEDOR = [
  "cadastros.view", "propostas.view_own", "propostas.create", "propostas.edit", "credito.usar",
  "cobrancas.cancel", "cobrancas.create", "financeiro.debito_futuro", "propostas.cancelar_cobranca_nao_paga"
];

function preparar(permissoes: string[]) {
  falso.zerar();
  falso.responder("usuarios:select", { data: { id_perfil: 4, is_super_adm: false, is_admin: false }, error: null });
  falso.responder("perfis:select", { data: { permissoes }, error: null });
  falso.responder("propostas:select", { data: null, error: null });
}

async function combinado(tipoSecundario: string) {
  const resposta = await rota.POST(
    new Request("http://localhost/api/cobrancas/pagamento-combinado", {
      method: "POST",
      headers: { authorization: "Bearer token-de-teste", "content-type": "application/json" },
      body: JSON.stringify({
        idInt: 25197, idCliente: 14, valorCredito: 50, valorSecundario: 67.51, tipoSecundario,
        empresa: "Ideal Biro", chaveIdempotencia: "11111111-2222-3333-4444-555555555555"
      })
    }) as never
  );
  const json = (await resposta.json()) as { success: boolean; error?: string };
  return { status: resposta.status, json, escritas: falso.chamadas.filter((c) => c.op !== "select") };
}

console.log("== regra");
confere("PIX: só credito.usar", JSON.stringify(regra.permissoesDoPagamentoCombinado("PIX")) === '["credito.usar"]');
confere("E-PIX: só credito.usar", JSON.stringify(regra.permissoesDoPagamentoCombinado("E-PIX")) === '["credito.usar"]');
for (const tipo of ["BOLETO", "CARD_PARCELADO", "E-FATURADO", "", "QUALQUER"]) {
  confere(`${tipo || "(vazio)"}: credito.usar e cobrancas.emitir_boleto, como antes`,
    JSON.stringify(regra.permissoesDoPagamentoCombinado(tipo)) === '["credito.usar","cobrancas.emitir_boleto"]');
}

console.log("== vendedor, 25197, E-Crédito R$ 50 + PIX");
preparar(VENDEDOR);
{
  const r = await combinado("PIX");
  confere("passa da conferência de permissão (para em Proposta não encontrada do dublê)", r.status === 404 && r.json.error === "Proposta não encontrada.", r);
  confere("nada gravado", r.escritas.length === 0, r.escritas);
}

console.log("== vendedor, E-Crédito + Boleto");
preparar(VENDEDOR);
{
  const r = await combinado("BOLETO");
  confere("recusa 403 pedindo cobrancas.emitir_boleto", r.status === 403 && /\(cobrancas\.emitir_boleto\)/.test(r.json.error ?? ""), r.json);
  confere("nada lido da proposta nem gravado", !falso.chamadas.some((c) => c.tabela === "propostas") && r.escritas.length === 0);
}

console.log("== vendedor, E-Crédito + Cartão e + E-Faturado (sem mudança)");
for (const tipo of ["CARD_PARCELADO", "E-FATURADO"]) {
  preparar(VENDEDOR);
  const r = await combinado(tipo);
  confere(`${tipo}: continua recusado (cobrancas.emitir_boleto)`, r.status === 403 && /cobrancas\.emitir_boleto/.test(r.json.error ?? ""), r.json);
}

console.log("== perfil sem credito.usar");
preparar(VENDEDOR.filter((p) => p !== "credito.usar"));
{
  const r = await combinado("PIX");
  confere("PIX sem credito.usar: recusa pedindo credito.usar", r.status === 403 && /\(credito\.usar\)/.test(r.json.error ?? ""), r.json);
}
preparar(VENDEDOR.filter((p) => p !== "credito.usar"));
{
  const r = await combinado("BOLETO");
  confere("Boleto sem nenhuma das duas: pede as duas", r.status === 403 && /credito\.usar e cobrancas\.emitir_boleto/.test(r.json.error ?? ""), r.json);
}

console.log("== perfil com as duas (financeiro)");
preparar([...VENDEDOR, "cobrancas.emitir_boleto"]);
{
  const r = await combinado("BOLETO");
  confere("Boleto com emitir_boleto: passa da conferência", r.status === 404, r);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
