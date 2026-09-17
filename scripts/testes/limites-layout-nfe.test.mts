/**
 * A conferencia de tamanho do payload antes de emitir.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/limites-layout-nfe.test.mts
 *
 * Parte com payloads montados (e o unico jeito de exercitar varios estouros ao
 * mesmo tempo) e parte com o payload REAL de notas do banco, lido pela mesma
 * funcao que o modal usa. Somente leitura.
 */
import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`}`);
}

const { estourosDeLayoutNfe, CAMPOS_COM_LIMITE_NFE } = await import("../../src/features/fiscal/lib/limites-layout-nfe.ts");

// ── 1. A lista ───────────────────────────────────────────────────────────────
checar("confere os 10 campos decididos",
  CAMPOS_COM_LIMITE_NFE.map((c) => c.chave),
  ["nome_destinatario", "logradouro_destinatario", "numero_destinatario", "complemento_destinatario",
    "bairro_destinatario", "municipio_destinatario", "nome_transportador", "endereco_transportador",
    "municipio_transportador", "natureza_operacao"]);
checar("o e-mail NAO e conferido (a chave `email` nao chega ao XML)",
  CAMPOS_COM_LIMITE_NFE.some((c) => /email/.test(c.chave)), false);
checar("todos com limite 60", CAMPOS_COM_LIMITE_NFE.every((c) => c.limite === 60), true);

// ── 2. Varios estouros de uma vez ────────────────────────────────────────────
const varios = estourosDeLayoutNfe({
  nome_destinatario: "N".repeat(72),
  complemento_destinatario: "C".repeat(63),
  logradouro_destinatario: "L".repeat(60),
  nome_transportador: "T".repeat(61),
  natureza_operacao: "Venda",
  email: "E".repeat(200)
});
console.log("\n=== mensagens com varios estouros ===");
for (const e of varios) console.log(`  - ${e.mensagem}`);
checar("lista TODOS de uma vez, na ordem da lista", varios.map((e) => e.chave),
  ["nome_destinatario", "complemento_destinatario", "nome_transportador"]);
checar("exatamente 60 nao estoura", varios.some((e) => e.chave === "logradouro_destinatario"), false);
checar("o e-mail gigante e ignorado", varios.some((e) => /email/.test(e.chave)), false);
checar("mensagem do destinatario", varios[0].mensagem,
  "Nome do destinatário com 72 caracteres; o máximo da NF-e é 60. Corrija no cadastro do cliente.");
checar("mensagem da transportadora aponta o cadastro dela", varios[2].mensagem,
  "Nome da transportadora com 61 caracteres; o máximo da NF-e é 60. Corrija no cadastro da transportadora.");
checar("mensagem da natureza aponta a nota",
  estourosDeLayoutNfe({ natureza_operacao: "X".repeat(61) })[0].mensagem,
  "Natureza da operação com 61 caracteres; o máximo da NF-e é 60. Corrija no campo Natureza da operação, na nota.");

// ── 3. Bordas ────────────────────────────────────────────────────────────────
checar("payload nulo nao quebra", estourosDeLayoutNfe(null), []);
checar("campo nulo e ignorado", estourosDeLayoutNfe({ complemento_destinatario: null }), []);
checar("conta caracteres, nao unidades UTF-16: 60 emojis nao estouram",
  estourosDeLayoutNfe({ complemento_destinatario: "😀".repeat(60) }).length, 0);
checar("o tamanho e o do texto como sai, sem aparar espacos",
  estourosDeLayoutNfe({ complemento_destinatario: " ".repeat(58) + "abc" })[0]?.tamanho, 61);

// ── 4. Payload real ──────────────────────────────────────────────────────────
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.NEXT_PUBLIC_SUPABASE_URL && SERVICE) {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;
  const { montarPayloadNfe } = await import("../../src/features/nfe/services/nfe.service.ts");

  // Sem esperar tamanho fixo: o cadastro muda (o complemento da NFE-21518-001 foi
  // abreviado de 63 para 42 no meio desta tarefa). O que se confere e a REGRA —
  // reportar exatamente os campos acima de 60, nem mais nem menos.
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE);
  const { data: abertas } = await sb
    .from("notas_fiscais").select("ref")
    .in("status", ["PENDENTE", "PRONTA_PARA_ENVIO", "ERRO_ENVIO", "ERRO_VALIDACAO", "NAO_ENCONTRADA_FOCUS"]);

  let conferidas = 0;
  let comEstouro = 0;
  let divergencias = 0;
  for (const linha of (abertas ?? []) as Array<{ ref: string }>) {
    const payload = (await montarPayloadNfe(linha.ref)) as Record<string, unknown> | null;
    if (!payload) continue;
    conferidas += 1;
    const achados = estourosDeLayoutNfe(payload);
    if (achados.length > 0) {
      comEstouro += 1;
      console.log(`  ${linha.ref}: ${achados.map((e) => `${e.chave} ${e.tamanho}`).join(", ")}`);
    }
    // A verdade independente: quais campos da lista realmente passam de 60.
    const esperados = CAMPOS_COM_LIMITE_NFE
      .filter((c) => payload[c.chave] != null && Array.from(String(payload[c.chave])).length > c.limite)
      .map((c) => c.chave);
    if (JSON.stringify(achados.map((e) => e.chave)) !== JSON.stringify(esperados)) divergencias += 1;
  }
  console.log(`\nnotas abertas conferidas: ${conferidas} | com estouro: ${comEstouro}`);
  checar("em toda nota aberta, a conferencia acusa exatamente os campos acima de 60", divergencias, 0);
  checar("houve nota conferida", conferidas > 0, true);
} else {
  console.log("\n(sem .env.local: a parte do banco nao rodou)");
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
