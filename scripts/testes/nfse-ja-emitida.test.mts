/**
 * A segunda trava da porta de NFS-e: o PAYLOAD barra o reenvio.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/nfse-ja-emitida.test.mts
 *
 * As colunas `numero_nfse` e `codigo_verificacao` ficam vazias quando o retorno
 * e lido errado — e e exatamente nesse caso que a trava precisa enxergar. Este
 * teste usa os retornos REAIS das notas de maio, lidos do banco, e nao uma
 * imitacao do que a Focus devolve: se o formato dela mudar, o teste cai.
 *
 * Leitura pura: o fetch e interceptado e qualquer escrita e barrada.
 */
import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

const fetchOriginal = globalThis.fetch;
const escritas: string[] = [];
globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const metodo = String(init?.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(metodo)) {
    escritas.push(`${metodo} ${String(entrada instanceof Request ? entrada.url : entrada).split("?")[0]}`);
    throw new Error("escrita barrada no teste");
  }
  return fetchOriginal(entrada, init);
}) as typeof fetch;

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(
    `${ok ? "ok    " : "FALHOU"}  ${nome}` +
      (ok ? "" : `\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`)
  );
}

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !SERVICE) {
  console.log("(pulando: .env.local sem chaves)");
  process.exit(0);
}

const { detectarNfseJaEmitida, mensagemNfseJaEmitida } = await import(
  "../../src/features/fiscal/services/nfse-ja-emitida.ts"
);
const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE);

// ── 1. Os retornos REAIS, do banco ───────────────────────────────────────────
const { data: notas } = await sb
  .from("notas_servico")
  .select("ref, status, payload_retorno")
  .not("payload_retorno", "is", null)
  .order("ref");

const linhas = (notas ?? []) as { ref: string; status: string; payload_retorno: unknown }[];
console.log(`notas com retorno guardado no banco: ${linhas.length}`);
checar("ha retorno real para testar", linhas.length > 0, true);

for (const nota of linhas) {
  const evidencia = detectarNfseJaEmitida(nota.payload_retorno);
  console.log(`  ${nota.ref} (${nota.status}) -> ${evidencia ? `${evidencia.regra}, numero ${evidencia.numero}` : "PASSARIA"}`);
  checar(`${nota.ref}: o payload barra o reenvio`, Boolean(evidencia), true);
  checar(`${nota.ref}: pela regra do status da Focus`, evidencia?.regra, "STATUS_FOCUS");
  checar(`${nota.ref}: com o numero da NFS-e na evidencia`, Boolean(evidencia?.numero), true);
}

// ── 2. O que NAO pode barrar ─────────────────────────────────────────────────
checar("rascunho sem retorno passa", detectarNfseJaEmitida(null), null);
checar("objeto vazio passa", detectarNfseJaEmitida({}), null);
checar("erro de validacao da Focus passa", detectarNfseJaEmitida({ codigo: "erro_validacao_schema", mensagem: "x" }), null);
checar("nota em processamento passa", detectarNfseJaEmitida({ status: "processando_autorizacao" }), null);
checar("numero nulo em texto passa", detectarNfseJaEmitida({ numero: "null", codigo_verificacao: "  " }), null);
checar("texto solto passa", detectarNfseJaEmitida("autorizado"), null);
checar("lista passa", detectarNfseJaEmitida([{ status: "autorizado" }]), null);

// ── 3. O que PRECISA barrar, alem do caso real ───────────────────────────────
checar("cancelada barra (foi autorizada antes)", detectarNfseJaEmitida({ status: "cancelado" })?.regra, "STATUS_FOCUS");
checar("AUTORIZADO em caixa alta barra", detectarNfseJaEmitida({ status: "AUTORIZADO" })?.regra, "STATUS_FOCUS");
checar(
  "numero sem status barra — a coluna pode ter ficado vazia",
  detectarNfseJaEmitida({ numero: "7" })?.regra,
  "NUMERO_NO_PAYLOAD"
);
checar(
  "so o codigo de verificacao ja barra",
  detectarNfseJaEmitida({ codigo_verificacao: "43149022" })?.regra,
  "NUMERO_NO_PAYLOAD"
);

// ── 4. A mensagem que o operador le ──────────────────────────────────────────
const mensagem = mensagemNfseJaEmitida({ regra: "STATUS_FOCUS", numero: "10", codigoVerificacao: "431490" });
console.log(`  mensagem: ${mensagem}`);
checar("a mensagem traz o numero", mensagem.includes("número 10"), true);
checar("a mensagem traz o codigo de verificacao", mensagem.includes("431490"), true);
checar("a mensagem diz o que fazer", mensagem.includes("Consultar status"), true);

checar("nenhuma escrita foi tentada", escritas, []);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
