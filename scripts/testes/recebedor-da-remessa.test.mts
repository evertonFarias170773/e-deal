/**
 * Editar nome e CPF do recebedor, na nota de remessa.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/recebedor-da-remessa.test.mts
 *
 * Simulado: o fetch e interceptado, a leitura passa e a ESCRITA e barrada com o
 * corpo registrado — da para ver o que seria gravado em `enderecos` sem gravar.
 */
import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

type Tentativa = { metodo: string; url: string; corpo: unknown };
const tentativas: Tentativa[] = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const metodo = String(init?.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
  const url = String(entrada instanceof Request ? entrada.url : entrada);
  if (!["GET", "HEAD", "OPTIONS"].includes(metodo)) {
    let corpo: unknown = init?.body ?? null;
    try { corpo = JSON.parse(String(init?.body ?? "null")); } catch { /* corpo cru */ }
    tentativas.push({ metodo, url, corpo });
    throw new Error("escrita barrada no teste");
  }
  return fetchOriginal(entrada, init);
}) as typeof fetch;

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`}`);
}

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !SERVICE) {
  console.log("(pulando: .env.local sem chaves)");
  process.exit(0);
}
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;

const { salvarRecebedorDoEndereco, buscarEnderecoDestinatario } = await import("../../src/features/nfe/services/remessa.service.ts");
const { isValidCpf } = await import("../../src/features/cadastros/utils/documento.ts");
const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE);

const REF = "NFE-22192-003";
const { data: nota } = await sb
  .from("notas_fiscais").select("ref, tipo_nota, id_endereco_destinatario").eq("ref", REF).maybeSingle();
const idEndereco = String((nota as { id_endereco_destinatario?: string } | null)?.id_endereco_destinatario ?? "");
console.log(`${REF}: tipo ${(nota as { tipo_nota?: string })?.tipo_nota} | endereco ${idEndereco || "(nenhum)"}`);

const antes = await buscarEnderecoDestinatario(idEndereco);
console.log(`no cadastro hoje: recebedor=${JSON.stringify(antes?.recebedor)} cpf=${JSON.stringify(antes?.cpf_recebedor)}`);

// ── 1. Edição válida: o CPF vai com máscara e deve ser gravado só com dígitos ─
const CPF_DIGITADO = String(antes?.cpf_recebedor ?? "").replace(/\D/g, "");
const COM_MASCARA = CPF_DIGITADO.length === 11
  ? `${CPF_DIGITADO.slice(0, 3)}.${CPF_DIGITADO.slice(3, 6)}.${CPF_DIGITADO.slice(6, 9)}-${CPF_DIGITADO.slice(9)}`
  : CPF_DIGITADO;
console.log(`\ncpf do cadastro passa na validacao do cadastro: ${isValidCpf(CPF_DIGITADO)}`);

tentativas.length = 0;
const valido = await salvarRecebedorDoEndereco({
  idEndereco,
  recebedor: "  MARCIO   ALVES DA SILVA  ",
  cpfRecebedor: COM_MASCARA
});
const patch = tentativas.find((t) => t.metodo === "PATCH");
console.log(`\n=== o que seria gravado ===`);
console.log(`  corpo: ${JSON.stringify(patch?.corpo)}`);
console.log(`  em:    ${patch?.url.split("/rest/v1/")[1]}`);
console.log(`  resultado devolvido a tela: ${JSON.stringify(valido)}`);

checar("grava em enderecos, na linha apontada pela nota",
  String(patch?.url ?? "").includes("/enderecos?id=eq." + idEndereco), true);
checar("grava so recebedor e cpf_recebedor — o endereco nao e tocado",
  Object.keys((patch?.corpo ?? {}) as Record<string, unknown>).sort(), ["cpf_recebedor", "recebedor"]);
checar("o nome vai aparado e com um espaco so",
  (patch?.corpo as { recebedor?: string })?.recebedor, "MARCIO ALVES DA SILVA");
checar("o CPF vai so com digitos, sem a mascara digitada",
  (patch?.corpo as { cpf_recebedor?: string })?.cpf_recebedor, CPF_DIGITADO);
checar("uma escrita so", tentativas.length, 1);

// ── 2. Nome vazio: recusado antes de qualquer escrita ────────────────────────
tentativas.length = 0;
const semNome = await salvarRecebedorDoEndereco({ idEndereco, recebedor: "   ", cpfRecebedor: CPF_DIGITADO });
console.log(`\nnome vazio: ${JSON.stringify(semNome)}`);
checar("nome vazio nao grava", [semNome.ok, tentativas.length], [false, 0]);

// ── 3. CPF inválido: mesma validação do cadastro ─────────────────────────────
tentativas.length = 0;
const cpfRuim = await salvarRecebedorDoEndereco({ idEndereco, recebedor: "MARCIO", cpfRecebedor: "111.111.111-11" });
console.log(`cpf invalido (111...): ${JSON.stringify(cpfRuim)}`);
checar("CPF que o cadastro recusa aqui tambem e recusado", [cpfRuim.ok, tentativas.length], [false, 0]);
checar("a validacao e a MESMA do cadastro", isValidCpf("11111111111"), false);

tentativas.length = 0;
const curto = await salvarRecebedorDoEndereco({ idEndereco, recebedor: "MARCIO", cpfRecebedor: "8170603" });
console.log(`cpf curto: ${JSON.stringify(curto)}`);
checar("CPF com menos de 11 digitos nao grava", [curto.ok, tentativas.length], [false, 0]);

// ── 4. O cadastro continua como estava ──────────────────────────────────────
const depois = await buscarEnderecoDestinatario(idEndereco);
console.log(`\nno cadastro depois do teste: recebedor=${JSON.stringify(depois?.recebedor)} cpf=${JSON.stringify(depois?.cpf_recebedor)}`);
checar("nada foi gravado no endereco",
  [depois?.recebedor, depois?.cpf_recebedor], [antes?.recebedor, antes?.cpf_recebedor]);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
