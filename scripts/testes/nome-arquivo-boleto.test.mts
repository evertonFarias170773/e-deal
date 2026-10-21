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
  // Desde 21/10/2026: pelo pedido e parcela do caminho (num parcelado, so o
  // id_pagamento acharia a ultima parcela, nao a do link).
  confere("link do Storage: procura pelo pedido e parcela do caminho", filtros.includes('["eq",["id_int",23588]]') && filtros.includes('["eq",["parcela",2]]'), filtros);
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

// ── D. todos os pontos do app (21/10/2026) ──────────────────────────────────
console.log("== D. todos os pontos: mesma funcao, mesmo nome, mesma queda");
const { baixarBoletoOuAbrirLink } = await import("../../src/features/cobrancas/services/baixar-boleto.ts");
const { parcelaDoCaminhoStorage } = lib;
confere("caminho absoluto do Storage -> pedido e parcela", JSON.stringify(parcelaDoCaminhoStorage(`${BASE}/storage/v1/object/public/boletos/23588/parcela_2.pdf`)) === '{"idInt":23588,"parcela":2}');
confere("caminho relativo (pdf_storage) -> pedido e parcela", JSON.stringify(parcelaDoCaminhoStorage("23588/parcela_2.pdf")) === '{"idInt":23588,"parcela":2}');
confere("link publico nao e caminho do Storage", parcelaDoCaminhoStorage("https://pay.ai-ideal.com.br/functions/v1/boleto-publico?codigo=P1") === null);

async function nomePeloPonto(url: string, parcela?: number | null) {
  banco([{ id_int: 23625, parcela: 1, total_parcelas: 1, status: "A_VENCER", created_at: "x" }]);
  let salvo = "";
  const desfecho = await baixarBoletoOuAbrirLink(client, { id_int: 23625, id_pagamento: "23625-A", cliente: "MB SOLUCOES GRAFICAS LTDA", url_pdf: url, parcela }, BASE, url,
    { buscar: fetchPdf, salvar: (_a, nome) => { salvo = nome; }, abrir: () => { throw new Error("nao devia abrir"); } });
  return { desfecho, salvo };
}
{
  const pagamentos = await nomePeloPonto("https://pay.ai-ideal.com.br/functions/v1/boleto-publico?codigo=P1123625");
  const detalhe = await nomePeloPonto("https://pay.ai-ideal.com.br/functions/v1/boleto-publico?codigo=P1123625");
  const carteira = await nomePeloPonto(`${BASE}/storage/v1/object/public/boletos/23625/parcela_1.pdf`, 1);
  const revisao = await nomePeloPonto(`${BASE}/storage/v1/object/public/boletos/23625/parcela_1.pdf`, 1);
  const nomes = [pagamentos, detalhe, carteira, revisao].map((r) => `${r.desfecho}:${r.salvo}`);
  confere("Pagamentos, detalhe, Carteira e revisao: mesmo nome para a mesma cobranca", new Set(nomes).size === 1 && nomes[0] === "BAIXADO:23625 - MB SOLUCOES GRAFICAS LTDA.pdf", nomes);
}
{
  banco([
    { id_int: 23588, parcela: 2, total_parcelas: 3, status: "A_VENCER", created_at: "2026-10-20" }
  ]);
  let salvo = "";
  await baixarBoletoOuAbrirLink(client, { id_int: 23588, id_pagamento: "23588-B", cliente: "CLIENTE TESTE", url_pdf: "23588/parcela_2.pdf", parcela: 2 }, BASE, "23588/parcela_2.pdf",
    { buscar: fetchPdf, salvar: (_a, n) => { salvo = n; }, abrir: () => null });
  const filtros = JSON.stringify(falso.chamadas[0]?.filtros);
  confere("Carteira parcelado: procura pedido E parcela do caminho (nao a ultima parcela da cobranca)", filtros.includes('["eq",["id_int",23588]]') && filtros.includes('["eq",["parcela",2]]') && !filtros.includes("id_pagamento"), filtros);
  confere("Carteira parcelado: nome com a parcela certa", salvo === "23588-B P2 de 3 - CLIENTE TESTE.pdf", salvo);
}
{
  banco([{ id_int: 23625, parcela: 1, total_parcelas: 1, status: "A_VENCER", created_at: "x" }]);
  let aberto = "";
  const d = await baixarBoletoOuAbrirLink(client, { id_int: 23625, id_pagamento: "23625-A", cliente: "X", url_pdf: "https://pay.ai-ideal.com.br/functions/v1/boleto-publico?codigo=P1123625" }, BASE,
    "https://pay.ai-ideal.com.br/functions/v1/boleto-publico?codigo=P1123625",
    { buscar: fetch404, salvar: () => { throw new Error("nao devia salvar"); }, abrir: (u) => { aberto = u; return {}; } });
  confere("falha no download: abre o link de antes", d === "ABERTO" && aberto.endsWith("codigo=P1123625"), { d, aberto });
  const b = await baixarBoletoOuAbrirLink(client, { id_pagamento: "x" }, BASE, "https://link", { buscar: fetch404, abrir: () => null });
  confere("aba barrada pelo navegador: BLOQUEADO (a tela avisa)", b === "BLOQUEADO", b);
  const sem = await baixarBoletoOuAbrirLink(null, { id_pagamento: "x" }, BASE, "https://link", { abrir: (u) => { aberto = u; return {}; } });
  confere("sem cliente Supabase: abre o link de antes", sem === "ABERTO", sem);
}
{
  // Os pontos usam a funcao comum; nenhum abre o PDF de boleto direto; a Carteira
  // so le no clique (nenhuma chamada dentro de render/map).
  const { readFileSync } = await import("node:fs");
  const ler = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
  const detalhe = ler("src/features/cobrancas/CobrancaDetail.tsx");
  const carteira = ler("src/features/contas-a-receber/ContasReceberPage.tsx");
  const revisao = ler("src/features/contas-a-receber/components/RevisarGeracaoBancariaModal.tsx");
  const painel = ler("src/features/cobrancas/PropostaCobrancaPanel.tsx");
  confere("detalhe da cobranca usa baixarBoletoOuAbrirLink e nao tem href de url_pdf", detalhe.includes("baixarBoletoOuAbrirLink(") && !/href=\{cobrancaAtual\.url_pdf\}/.test(detalhe));
  confere("revisao usa baixarBoletoOuAbrirLink e nao abre o PDF direto", revisao.includes("baixarBoletoOuAbrirLink(") && !/window\.open\(getResolvedPdfUrl\(String\(boleto\.url_pdf/.test(revisao));
  confere("aba Pagamentos segue com baixarBoletoComNome (botao do d0107fc, inalterado)", painel.includes("baixarBoletoComNome(client"));
  const chamadas = carteira.split("baixarPdfDoTitulo(").length - 1;
  confere("Carteira: uma definicao e 3 chamadas, todas em acao de clique (PDF salvo, PDF gerado, detalhe)", chamadas === 4, chamadas);
  confere("Carteira: nenhum window.open direto do PDF salvo ou do detalhe", !/window\.open\(pdfSalvo/.test(carteira) && !/window\.open\(getResolvedPdfUrl\(item\.url_pdf/.test(carteira));
  const linhasComChamada = carteira.split(/\r?\n/).filter((l) => l.includes("baixarPdfDoTitulo(") && !l.includes("function baixarPdfDoTitulo"));
  confere("Carteira: nenhuma chamada em JSX de lista (map/render)", linhasComChamada.every((l) => !/\.map\(|=>\s*<|renderCard|<[A-Z]/.test(l)), linhasComChamada);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
if (falhas > 0) process.exitCode = 1;
