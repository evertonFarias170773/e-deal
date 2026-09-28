/**
 * O link gravado do DANFE/XML aponta o arquivo certo — em TODAS as notas.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/documento-nota.test.mts
 *
 * A reassinatura no clique depende de ler, de dentro da URL gravada, a `ref` e o
 * arquivo. Se alguma nota tiver o link num formato que o leitor nao entende, o
 * clique cairia no link vencido. Este teste passa por todas as notas do banco.
 * Leitura pura.
 */
import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`}`);
}

const { documentoDoLinkGravado } = await import("../../src/lib/fiscal/documento-nota.ts");

// ── 1. Formatos ──────────────────────────────────────────────────────────────
const base = "https://vwbtitjlpelrcnsytzqw.supabase.co/storage/v1/object";
checar("assinada, DANFE", documentoDoLinkGravado(`${base}/sign/nfe-documentos/NFE-21869-001/danfe.pdf?token=abc`),
  { ref: "NFE-21869-001", arquivo: "danfe" });
checar("assinada, XML", documentoDoLinkGravado(`${base}/sign/nfe-documentos/NFE-21869-001/nfe.xml?token=abc`),
  { ref: "NFE-21869-001", arquivo: "xml" });
checar("NFS-e no mesmo bucket", documentoDoLinkGravado(`${base}/sign/nfe-documentos/NFS-16482-001/danfe.pdf?token=x`),
  { ref: "NFS-16482-001", arquivo: "danfe" });
checar("outro bucket nao e reassinado", documentoDoLinkGravado(`${base}/sign/boletos/NFE-1/danfe.pdf?token=x`), null);
checar("link de fora (S3 da Focus) abre como esta",
  documentoDoLinkGravado("https://focusnfe.s3.sa-east-1.amazonaws.com/arquivos/x/danfe.pdf"), null);
checar("vazio", documentoDoLinkGravado(null), null);

// ── 2. Todas as notas do banco ───────────────────────────────────────────────
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.NEXT_PUBLIC_SUPABASE_URL && SERVICE) {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE);
  const { data } = await sb.from("notas_fiscais").select("ref, url_danfe, url_xml").not("url_danfe", "is", null);
  const notas = (data ?? []) as Array<{ ref: string; url_danfe: string; url_xml: string | null }>;

  let danfeCerto = 0;
  let xmlCerto = 0;
  let comXml = 0;
  const errados: string[] = [];
  for (const nota of notas) {
    const d = documentoDoLinkGravado(nota.url_danfe);
    if (d?.ref === nota.ref && d.arquivo === "danfe") danfeCerto += 1;
    else errados.push(`${nota.ref} danfe`);
    if (nota.url_xml) {
      comXml += 1;
      const x = documentoDoLinkGravado(nota.url_xml);
      if (x?.ref === nota.ref && x.arquivo === "xml") xmlCerto += 1;
      else errados.push(`${nota.ref} xml`);
    }
  }
  console.log(`\nnotas com DANFE: ${notas.length} | lidas certo: ${danfeCerto}`);
  console.log(`notas com XML:   ${comXml} | lidas certo: ${xmlCerto}`);
  if (errados.length) console.log(`  nao entendidas: ${errados.join(", ")}`);
  checar("todo DANFE gravado aponta a propria nota", danfeCerto, notas.length);
  checar("todo XML gravado aponta a propria nota", xmlCerto, comXml);
} else {
  console.log("\n(sem .env.local: a parte do banco nao rodou)");
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
