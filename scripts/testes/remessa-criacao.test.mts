/**
 * Criacao do rascunho de REMESSA, simulada SEM GRAVAR.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/remessa-criacao.test.mts
 *
 * O teste chama a funcao REAL (`criarRascunhoRemessa`) com o `fetch` interceptado:
 * leitura passa, escrita e BARRADA — e o corpo que ela tentou gravar fica
 * registrado. Assim da para ver exatamente o que seria escrito, sem escrever.
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
    try { corpo = JSON.parse(String(init?.body ?? "null")); } catch { /* corpo nao-JSON fica cru */ }
    tentativas.push({ metodo, url: url.split("?")[0], corpo });
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

const { criarRascunhoRemessa, enderecoDaRemessa } = await import("../../src/features/nfe/services/remessa.service.ts");
const { getNaturezasOperacaoNfe } = await import("../../src/features/nfe/services/nfe.service.ts");
const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE);

// ── 1. Pedido COM venda autorizada e endereco com recebedor: mostra o que gravaria
const PEDIDO_OK = 21955;
tentativas.length = 0;
const resultado = await criarRascunhoRemessa(PEDIDO_OK);
const escritas = tentativas.filter((t) => t.url.includes("/rest/v1/"));
const insertNota = escritas.find((t) => t.url.endsWith("/notas_fiscais"));

console.log(`\n#${PEDIDO_OK} — o que a criacao tentou gravar em notas_fiscais:`);
console.log(JSON.stringify(insertNota?.corpo, null, 2));
console.log(`resultado devolvido: ${JSON.stringify(resultado)}`);

const cabecalho = (Array.isArray(insertNota?.corpo) ? insertNota?.corpo[0] : insertNota?.corpo) as Record<string, unknown>;
const destino = await enderecoDaRemessa(PEDIDO_OK);
checar("o endereco vigente tem recebedor e CPF", destino.ok, true);
checar("tipo_nota nasce REMESSA", cabecalho?.tipo_nota, "REMESSA");
checar("id_endereco_destinatario e o endereco vigente", cabecalho?.id_endereco_destinatario, destino.ok ? destino.endereco.id : null);
checar("natureza e a de outra saida (6949, MG contra RS)", cabecalho?.drop_natureza_op, "6949 - Outra saída de mercadoria ou prestação de serviço não especificado");
checar("frete e desconto zerados", [cabecalho?.valor_frete, cabecalho?.valor_desconto], [0, 0]);
checar("total = produtos", cabecalho?.valor_total_nf, cabecalho?.valor_produtos);
checar("consumidor final 1, nao contribuinte 9", [cabecalho?.consumidor_final, cabecalho?.tipo_contribuinte], [1, 9]);
checar("status PENDENTE (nada e emitido aqui)", cabecalho?.status, "PENDENTE");
checar("a ref segue o padrao do pedido", String(cabecalho?.ref ?? "").startsWith(`NFE-${PEDIDO_OK}-`), true);
checar("so UMA escrita foi tentada (a nota; o resto nem chegou)", escritas.length, 1);

// O que viria depois do cabecalho: itens da venda com a tributacao do catalogo.
const { data: venda } = await sb.from("notas_fiscais").select("ref, valor_total_nf")
  .eq("id_int", PEDIDO_OK).eq("status", "AUTORIZADA").eq("ambiente", "producao").limit(1).single();
const { data: itens } = await sb.from("notas_fiscais_itens")
  .select("numero_item, descricao, quantidade, valor_unitario, valor_bruto, cfop, icms_situacao_tributaria")
  .eq("ref", (venda as { ref: string }).ref).eq("ativo", true).order("numero_item");
const catalogo = await getNaturezasOperacaoNfe();
const natureza = catalogo.find((n) => n.cfop === "6949");
console.log(`\nitens da venda ${(venda as { ref: string }).ref} que seriam copiados, com a tributacao da remessa:`);
for (const item of (itens ?? []) as Array<Record<string, unknown>>) {
  console.log(`  ${item.numero_item}. ${String(item.descricao).slice(0, 30).padEnd(30)} qtd ${item.quantidade} | unit ${item.valor_unitario} | total ${item.valor_bruto} | CFOP ${item.cfop} -> ${natureza?.cfop} | CSOSN ${item.icms_situacao_tributaria} -> ${natureza?.icmsSituacaoTributaria}`);
}
console.log(`  pagamento: forma 90 (Sem pagamento), valor 0,00 — sem duplicata`);
checar("a venda tributa 102 e a remessa tributaria 400",
  [(itens ?? [])[0]?.icms_situacao_tributaria, natureza?.icmsSituacaoTributaria], ["102", "400"]);
checar("soma dos itens copiados = total da nota de venda",
  Number(((itens ?? []) as Array<{ valor_bruto: number }>).reduce((s, i) => s + Number(i.valor_bruto), 0).toFixed(2)),
  Number(cabecalho?.valor_produtos));

// ── 2. Pedido cujo endereco NAO tem recebedor: bloqueio antes de qualquer escrita
for (const pedido of [20928, 20974]) {
  tentativas.length = 0;
  const bloqueado = await criarRascunhoRemessa(pedido);
  console.log(`\n#${pedido}: ${JSON.stringify(bloqueado)}`);
  checar(`#${pedido}: bloqueia`, bloqueado.ok, false);
  checar(`#${pedido}: a mensagem fala do recebedor`, /recebedor/i.test((bloqueado as { motivo: string }).motivo), true);
  checar(`#${pedido}: NENHUMA escrita tentada`, tentativas.filter((t) => t.url.includes("/rest/v1/")).length, 0);
}

// ── 3. Pedido sem venda autorizada: tambem bloqueia
tentativas.length = 0;
const semVenda = await criarRascunhoRemessa(22066);
console.log(`\n#22066 (so notas canceladas): ${JSON.stringify(semVenda)}`);
checar("#22066: bloqueia por nao ter venda autorizada", semVenda.ok, false);
checar("#22066: NENHUMA escrita tentada", tentativas.filter((t) => t.url.includes("/rest/v1/")).length, 0);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
