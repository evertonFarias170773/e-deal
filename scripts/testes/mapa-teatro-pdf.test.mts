/**
 * PDF do Mapa de Teatro — src/features/orcamentos/lib/mapa-teatro-pdf.ts
 *
 *   node --experimental-strip-types scripts/testes/mapa-teatro-pdf.test.mts
 *
 * O QUE PROVA
 *   1. A busca da janela ignora acento, caixa e espaço sobrando, e não tira
 *      mapa da lista quando o termo está vazio.
 *   2. O arquivo escolhido é o do mapa COMPLETO (tipo "mapa", setor_id null),
 *      nunca o de um setor.
 *   3. O `pdf_recurso` só é aceito dentro da função do parceiro: o token do
 *      usuário não vai para outro servidor nem para o Storage.
 *   4. As duas chamadas levam o Authorization de quem clicou, a consulta não
 *      informa `revisao`, e cada resposta do parceiro vira o resultado certo:
 *      pendente, 401, 403, 404 e indisponível.
 *   5. O arquivo recebido só é salvo se for PDF e tiver o tamanho informado.
 */
import {
  AVISO_PDF_INDISPONIVEL,
  AVISO_PDF_SEM_PERMISSAO,
  arquivoDoMapaCompleto,
  avisoDoStatusDoPdf,
  buscarPdfDoMapa,
  filtrarMapasPorNome,
  nomeDoArquivoPdf,
  normalizarParaBusca,
  pdfRecebidoConfere,
  urlDoRecursoPdf
} from "../../src/features/orcamentos/lib/mapa-teatro-pdf.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : `\n       obtido:   ${JSON.stringify(obtido)}\n       esperado: ${JSON.stringify(esperado)}`}`);
}

// 1. Busca
const mapas = [{ nome: "Laércio Boim" }, { nome: "Master Hall - São Paulo" }, { nome: "Teatro Municipal" }];
const nomes = (termo: string) => filtrarMapasPorNome(mapas, termo).map((m) => m.nome);
checar("busca: termo vazio devolve todos", nomes(""), mapas.map((m) => m.nome));
checar("busca: so espacos devolve todos", nomes("   "), mapas.map((m) => m.nome));
checar("busca: sem acento acha o acentuado", nomes("laercio"), ["Laércio Boim"]);
checar("busca: com acento acha o acentuado", nomes("LAÉRCIO"), ["Laércio Boim"]);
checar("busca: maiuscula e til", nomes("SAO PAULO"), ["Master Hall - São Paulo"]);
checar("busca: pedaco do meio", nomes("hall"), ["Master Hall - São Paulo"]);
checar("busca: espaco sobrando", nomes("  teatro   municipal "), ["Teatro Municipal"]);
checar("busca: sem resultado", nomes("opera"), []);
checar("busca: normalizacao", normalizarParaBusca("  Açaí   da  ÓPERA "), "acai da opera");

// 2. Arquivo do mapa completo
const arquivos = [
  { tipo: "setor", setor_id: "setor_0_1", pdf_recurso: "arquivos/s1", tamanho_bytes: 10 },
  { tipo: "mapa", setor_id: "setor_0_1", pdf_recurso: "arquivos/errado", tamanho_bytes: 11 },
  { tipo: "mapa", setor_id: null, pdf_recurso: "arquivos/mapa", tamanho_bytes: 1234 }
];
checar("arquivo: tipo mapa com setor_id null", arquivoDoMapaCompleto(arquivos), { pdfRecurso: "arquivos/mapa", tamanhoBytes: 1234 });
checar("arquivo: so de setor nao serve", arquivoDoMapaCompleto(arquivos.slice(0, 2)), null);
checar("arquivo: lista vazia", arquivoDoMapaCompleto([]), null);
checar("arquivo: sem pdf_recurso", arquivoDoMapaCompleto([{ tipo: "mapa", setor_id: null }]), null);
checar(
  "arquivo: tamanho ausente vira null",
  arquivoDoMapaCompleto([{ tipo: "mapa", setor_id: null, pdf_recurso: "x" }]),
  { pdfRecurso: "x", tamanhoBytes: null }
);

// 3. Endereço do recurso
const BASE = "https://projeto.supabase.co/functions/v1/mapas-teatro-pdfs";
checar("recurso: relativo a funcao", urlDoRecursoPdf(BASE, "arquivos/abc"), `${BASE}/arquivos/abc`);
checar("recurso: com barra na frente", urlDoRecursoPdf(BASE, "/arquivos/abc"), `${BASE}/arquivos/abc`);
checar("recurso: caminho desde a raiz", urlDoRecursoPdf(BASE, "/functions/v1/mapas-teatro-pdfs/arquivos/abc"), `${BASE}/arquivos/abc`);
checar("recurso: endereco inteiro na funcao", urlDoRecursoPdf(BASE, `${BASE}/arquivos/abc?v=1`), `${BASE}/arquivos/abc?v=1`);
checar("recurso: outro servidor e recusado", urlDoRecursoPdf(BASE, "https://outro.exemplo/arquivos/abc"), null);
checar("recurso: Storage do mesmo projeto e recusado", urlDoRecursoPdf(BASE, "https://projeto.supabase.co/storage/v1/object/public/x.pdf"), null);
checar("recurso: outra funcao do mesmo projeto e recusada", urlDoRecursoPdf(BASE, "https://projeto.supabase.co/functions/v1/outra/x"), null);
checar("recurso: sem protocolo com duas barras e recusado", urlDoRecursoPdf(BASE, "//outro.exemplo/x"), null);
checar("recurso: subir de pasta e recusado", urlDoRecursoPdf(BASE, "../outra/x"), null);
checar("recurso: http no lugar de https e recusado", urlDoRecursoPdf(BASE, "http://projeto.supabase.co/functions/v1/mapas-teatro-pdfs/a"), null);

// 4. As duas chamadas
const MAPA = "A1184DE9-1DD8-4D1A-A668-BFE124000E6A";
type Chamada = { url: string; autorizacao: string | undefined };
function parceiro(respostas: (Response | Error)[]) {
  const chamadas: Chamada[] = [];
  const buscar = async (url: string, init: RequestInit) => {
    chamadas.push({ url, autorizacao: (init.headers as Record<string, string>).Authorization });
    const proxima = respostas.shift();
    if (!proxima) throw new Error("chamada a mais");
    if (proxima instanceof Error) throw proxima;
    return proxima;
  };
  return { chamadas, buscar };
}
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const pdf = (tipo = "application/pdf") => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { "content-type": tipo } });
const pronto = { estado: "pronto", nome_mapa: "Master Hall", arquivos };
const rodar = async (respostas: (Response | Error)[], mapaId = MAPA) => {
  const p = parceiro(respostas);
  const r = await buscarPdfDoMapa({ base: `${BASE}/`, mapaId, autorizacao: "Bearer token-do-usuario", buscar: p.buscar });
  return { r, chamadas: p.chamadas };
};
const resumo = (r: Awaited<ReturnType<typeof buscarPdfDoMapa>>) =>
  r.tipo === "pdf" ? { tipo: r.tipo, tamanhoBytes: r.tamanhoBytes, nomeDoMapa: r.nomeDoMapa } : r;

{
  const { r, chamadas } = await rodar([json(pronto), pdf()]);
  checar("pronto: devolve o PDF com o tamanho informado", resumo(r), { tipo: "pdf", tamanhoBytes: 1234, nomeDoMapa: "Master Hall" });
  checar(
    "pronto: consulta sem revisao, id em minuscula, depois o pdf_recurso do mapa completo",
    chamadas.map((c) => c.url),
    [`${BASE}/mapas/${MAPA.toLowerCase()}/exportacao?gerador=a3-v1-20261003`, `${BASE}/arquivos/mapa`]
  );
  checar("pronto: as duas chamadas levam o Authorization do usuario", chamadas.map((c) => c.autorizacao), ["Bearer token-do-usuario", "Bearer token-do-usuario"]);
  checar("pronto: o token nao aparece em nenhuma URL", chamadas.some((c) => c.url.includes("token")), false);
}
{
  const { r, chamadas } = await rodar([json({ estado: "pendente", arquivos: [] })]);
  checar("pendente: so avisa, sem segunda chamada", [r, chamadas.length], [{ tipo: "pendente" }, 1]);
}
for (const status of [401, 403, 404] as const) {
  const { r } = await rodar([json({ detail: "x" }, status)]);
  checar(`consulta ${status}: repassado`, r, { tipo: "erro", status });
}
for (const status of [500, 502, 503]) {
  const { r } = await rodar([json({ detail: "x" }, status)]);
  checar(`consulta ${status}: indisponivel`, r, { tipo: "erro", status: 503 });
}
checar("consulta: rede caiu", (await rodar([new Error("rede")])).r, { tipo: "erro", status: 503 });
checar("consulta: resposta que nao e JSON", (await rodar([new Response("<html>", { status: 200 })])).r, { tipo: "erro", status: 503 });
checar("consulta: estado desconhecido", (await rodar([json({ estado: "gerando" })])).r, { tipo: "erro", status: 503 });
checar("pronto sem arquivo do mapa completo: indisponivel", (await rodar([json({ estado: "pronto", arquivos: arquivos.slice(0, 2) })])).r, { tipo: "erro", status: 503 });
{
  const fora = { estado: "pronto", arquivos: [{ tipo: "mapa", setor_id: null, pdf_recurso: "https://outro.exemplo/x.pdf", tamanho_bytes: 4 }] };
  const { r, chamadas } = await rodar([json(fora)]);
  checar("pronto com recurso fora da funcao: nao chama e nao envia o token", [r, chamadas.length], [{ tipo: "erro", status: 503 }, 1]);
}
checar("pdf 403: repassado", (await rodar([json(pronto), json({}, 403)])).r, { tipo: "erro", status: 403 });
checar("pdf 502: indisponivel", (await rodar([json(pronto), json({}, 502)])).r, { tipo: "erro", status: 503 });
checar("pdf com outro tipo de conteudo: indisponivel", (await rodar([json(pronto), pdf("text/html")])).r, { tipo: "erro", status: 503 });
checar("pdf: rede caiu", (await rodar([json(pronto), new Error("rede")])).r, { tipo: "erro", status: 503 });
{
  const { r, chamadas } = await rodar([], "nao-e-uuid/../x");
  checar("id que nao e uuid: 404 sem chamar o parceiro", [r, chamadas.length], [{ tipo: "erro", status: 404 }, 0]);
}

// 5. Avisos, conferência e nome do arquivo
checar("aviso: 403", avisoDoStatusDoPdf(403), AVISO_PDF_SEM_PERMISSAO);
checar("aviso: 404, 502 e 503", [404, 502, 503].map(avisoDoStatusDoPdf), [AVISO_PDF_INDISPONIVEL, AVISO_PDF_INDISPONIVEL, AVISO_PDF_INDISPONIVEL]);
const confere = (tipoDoConteudo: string | null, tamanho: number, tamanhoEsperado: string | null) => pdfRecebidoConfere({ tipoDoConteudo, tamanho, tamanhoEsperado });
checar("confere: pdf do tamanho informado", confere("application/pdf", 1234, "1234"), true);
checar("confere: tipo com parametro", confere("application/pdf; charset=binary", 1234, "1234"), true);
checar("confere: tamanho diferente", confere("application/pdf", 1200, "1234"), false);
checar("confere: nao e pdf", confere("text/html", 1234, "1234"), false);
checar("confere: vazio", confere("application/pdf", 0, null), false);
checar("confere: parceiro nao informou tamanho", confere("application/pdf", 1234, null), true);
checar("confere: tamanho informado invalido", confere("application/pdf", 1234, "abc"), false);
checar("nome: o do mapa, com acento", nomeDoArquivoPdf("Master Hall - São Paulo"), "Master Hall - São Paulo.pdf");
checar("nome: sem o que o sistema de arquivos recusa", nomeDoArquivoPdf('Teatro: "A/B" <1>?'), "Teatro A B 1.pdf");
checar("nome: vazio", nomeDoArquivoPdf("  "), "Mapa de Teatro.pdf");

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
