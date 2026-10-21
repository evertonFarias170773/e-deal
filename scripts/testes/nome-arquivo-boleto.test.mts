/**
 * "Baixar boleto" com nome de gente (21/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/nome-arquivo-boleto.test.mts
 *
 * SEM banco e SEM rede: cliente Supabase falso e `fetch` falso.
 *   A. o nome do arquivo (à vista, parcelado, caracteres inválidos, tamanho);
 *   B. a linha escolhida é a mesma do link público (não cancelada mais recente);
 *   C. o serviço: baixa do Storage, cai para o link de sempre quando não dá.
 */
const { falso, getSupabaseClient } = await import("./_supabase-falso.mts");
const lib = await import("../../src/features/cobrancas/lib/nome-arquivo-boleto.ts");
const { baixarBoletoComNome } = await import("../../src/features/cobrancas/services/baixar-boleto.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

// ── A. o nome ───────────────────────────────────────────────────────────────
console.log("== A. o nome do arquivo");
confere("a vista: '<pedido> - <cliente>.pdf'", lib.nomeArquivoBoleto({ idInt: 23625, idPagamento: "23625-A", cliente: "MB SOLUCOES GRAFICAS LTDA", parcela: 1, totalParcelas: 1 }) === "23625 - MB SOLUCOES GRAFICAS LTDA.pdf");
confere("parcelado: '<id_pagamento> P<n> de <total> - <cliente>.pdf'", lib.nomeArquivoBoleto({ idInt: 23625, idPagamento: "23625-A", cliente: "MB SOLUCOES GRAFICAS LTDA", parcela: 1, totalParcelas: 3 }) === "23625-A P1 de 3 - MB SOLUCOES GRAFICAS LTDA.pdf");
confere("caracteres invalidos viram espaco e espacos se juntam", lib.nomeArquivoBoleto({ idInt: 1, cliente: 'A/B\\C:D*E?F"G<H>I|J  K' }) === "1 - A B C D E F G H I J K.pdf");
confere("ponto e espaco nas pontas saem (Windows nao aceita)", lib.nomeArquivoBoleto({ idInt: 1, cliente: " .EMPRESA LTDA. " }) === "1 - EMPRESA LTDA.pdf");
const longo = lib.nomeArquivoBoleto({ idInt: 23625, cliente: "X".repeat(400) });
confere(`tamanho limitado (${lib.TAMANHO_MAXIMO_NOME} + .pdf)`, longo.length <= lib.TAMANHO_MAXIMO_NOME + 4 && longo.startsWith("23625 - XXX"), longo.length);
confere("sem cliente: so o pedido", lib.nomeArquivoBoleto({ idInt: 23625, cliente: "" }) === "23625.pdf");
confere("acentos ficam (sao validos em nome de arquivo)", lib.nomeArquivoBoleto({ idInt: 9, cliente: "GRÁFICA SÃO JOÃO" }) === "9 - GRÁFICA SÃO JOÃO.pdf");

// ── B. a linha ──────────────────────────────────────────────────────────────
console.log("== B. a linha e o codigo do link");
confere("codigo do link publico", lib.codigoDoLinkPublico("https://pay.ai-ideal.com.br/functions/v1/boleto-publico?codigo=P1122953") === "P1122953");
confere("link do Storage nao e link publico", lib.codigoDoLinkPublico("https://x.supabase.co/storage/v1/object/public/boletos/1/parcela_1.pdf") === null);
confere("texto qualquer nao quebra", lib.codigoDoLinkPublico("00020126...pix") === null);
const linhas = [
  { id_int: 1, parcela: 1, total_parcelas: 1, status: "CANCELADO", created_at: "2026-10-20T10:00:00Z" },
  { id_int: 1, parcela: 1, total_parcelas: 1, status: "A_VENCER", created_at: "2026-10-19T10:00:00Z" },
  { id_int: 1, parcela: 1, total_parcelas: 1, status: "A_VENCER", created_at: "2026-10-21T10:00:00Z" }
];
confere("prefere a nao cancelada mais recente (como a funcao)", lib.escolherLinhaComoOLinkPublico(linhas)?.created_at === "2026-10-21T10:00:00Z");
confere("so cancelada e unica: serve (como a funcao)", lib.escolherLinhaComoOLinkPublico([linhas[0]])?.status === "CANCELADO");
confere("varias canceladas: nenhuma (como a funcao)", lib.escolherLinhaComoOLinkPublico([linhas[0], { ...linhas[0], created_at: "x" }]) === null);
confere("url do Storage", lib.urlStorageDoBoleto("https://x.supabase.co/", 23625, 1) === "https://x.supabase.co/storage/v1/object/public/boletos/23625/parcela_1.pdf");

// ── C. o servico ────────────────────────────────────────────────────────────
console.log("== C. o servico");
const client = getSupabaseClient() as never;
const BASE = "https://x.supabase.co";
let pedidas: string[] = [];
const fetchPdf = (async (url: string) => { pedidas.push(url); return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { "content-type": "application/pdf" } }); }) as typeof fetch;
const fetch404 = (async (url: string) => { pedidas.push(url); return new Response("{}", { status: 400, headers: { "content-type": "application/json" } }); }) as typeof fetch;
function banco(linhasBoleto: unknown[]) { falso.zerar(); pedidas = []; falso.responder("boletos:select", { data: linhasBoleto, error: null }); }

{
  banco([{ id_int: 23625, parcela: 1, total_parcelas: 1, status: "A_VENCER", created_at: "x" }]);
  const r = await baixarBoletoComNome(client, { id_int: 23625, id_pagamento: "23625-A", cliente: "MB SOLUCOES GRAFICAS LTDA", url_pdf: "https://pay.ai-ideal.com.br/functions/v1/boleto-publico?codigo=P1123625" }, BASE, fetchPdf);
  const filtros = JSON.stringify(falso.chamadas[0]?.filtros);
  confere("link publico: procura a linha pelo n_doc_boleto do link", filtros.includes('["eq",["n_doc_boleto","P1123625"]]'), filtros);
  confere("baixa do Storage, no caminho que a funcao le", pedidas[0] === `${BASE}/storage/v1/object/public/boletos/23625/parcela_1.pdf`, pedidas);
  confere("entrega o arquivo com o nome padrao", r.ok && r.nome === "23625 - MB SOLUCOES GRAFICAS LTDA.pdf" && r.arquivo.size === 4, r);
  confere("so leitura: nenhuma gravacao", falso.chamadas.every((c) => c.op === "select"), falso.chamadas.map((c) => c.op));
}
{
  banco([{ id_int: 23588, parcela: 2, total_parcelas: 3, status: "A_VENCER", created_at: "x" }]);
  const r = await baixarBoletoComNome(client, { id_int: 23588, id_pagamento: "23588-B", cliente: "CLIENTE TESTE", url_pdf: `${BASE}/storage/v1/object/public/boletos/23588/parcela_2.pdf` }, BASE, fetchPdf);
  const filtros = JSON.stringify(falso.chamadas[0]?.filtros);
  confere("link do Storage: procura pela cobranca (id_pagamento)", filtros.includes('["eq",["id_pagamento","23588-B"]]'), filtros);
  confere("parcelado: nome com a parcela", r.ok && r.nome === "23588-B P2 de 3 - CLIENTE TESTE.pdf", r);
}
{
  banco([]);
  const r = await baixarBoletoComNome(client, { id_int: 1, id_pagamento: "1-A", cliente: "X", url_pdf: "https://pay.ai-ideal.com.br/functions/v1/boleto-publico?codigo=P1" }, BASE, fetchPdf);
  confere("linha nao achada: ok=false (a tela abre o link de sempre), sem download", !r.ok && pedidas.length === 0, r);
}
{
  banco([{ id_int: 1, parcela: 1, total_parcelas: 1, status: "A_VENCER", created_at: "x" }]);
  const r = await baixarBoletoComNome(client, { id_int: 1, id_pagamento: "1-A", cliente: "X", url_pdf: null }, BASE, fetch404);
  confere("PDF ausente no Storage: ok=false (nunca entrega erro como PDF)", !r.ok && (r as { motivo: string }).motivo === "PDF_INDISPONIVEL", r);
}
{
  banco([{ id_int: 1, parcela: 1, total_parcelas: 1, status: "A_VENCER", created_at: "x" }]);
  const quebra = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
  const r = await baixarBoletoComNome(client, { id_int: 1, id_pagamento: "1-A", cliente: "X", url_pdf: null }, BASE, quebra);
  confere("rede/CORS falhou: ok=false, nao lanca", !r.ok, r);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
if (falhas > 0) process.exitCode = 1;
