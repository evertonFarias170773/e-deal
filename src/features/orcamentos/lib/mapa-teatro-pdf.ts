/**
 * PDF do Mapa de Teatro completo — o que o vendedor baixa na janela "Mapa
 * Teatro" para enviar ao cliente. Regras puras (sem imports), usadas pela rota
 * `/api/pedidos/mapa-teatro/[mapaId]/pdf` e pela janela.
 *
 * DE ONDE VEM
 *   Da função `mapas-teatro-pdfs` do parceiro de imposição, no mesmo projeto
 *   Supabase do Vibe. Só leitura, sempre da revisão ATUAL do mapa (a consulta
 *   não informa `revisao`). O Vibe não gera nem publica PDF: se o parceiro
 *   ainda não publicou, a resposta é "pendente" e a tela só avisa.
 *
 *   1. GET {base}/mapas/{mapa_id}/exportacao?gerador=<GERADOR>
 *   2. `estado: "pronto"` → em `arquivos[]`, o item `tipo: "mapa"` com
 *      `setor_id: null`; GET no `pdf_recurso` dele.
 *   As duas chamadas levam o `Authorization: Bearer <token da sessão>` de quem
 *   clicou — nenhuma chave do Vibe entra. PDF de setor e revisão de modelo são
 *   outro fluxo e não passam por aqui.
 *
 * POR QUE PELA ROTA DO VIBE E NÃO DIRETO DO NAVEGADOR
 *   A função do parceiro só responde a navegador vindo de origens que ela
 *   lista, e o endereço de produção do Vibe não estava na lista em 04/10/2026
 *   (só `localhost`). A rota repassa o token do usuário de servidor para
 *   servidor, onde essa restrição não existe.
 */

export const GERADOR_DO_PDF_DO_MAPA = "a3-v1-20261003";

export const AVISO_PDF_PENDENTE = "PDF ainda não publicado para este mapa";
export const AVISO_PDF_SEM_PERMISSAO = "Sem permissão para este mapa";
export const AVISO_PDF_INDISPONIVEL = "PDF do mapa indisponível no momento. Tente de novo em instantes.";

type Json = unknown;

function ehObjeto(valor: Json): valor is Record<string, Json> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** Texto para comparar na busca: sem acento, sem caixa, espaços em um só. */
export function normalizarParaBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Os mapas cujo nome contém o termo. Termo vazio devolve todos, na mesma ordem. */
export function filtrarMapasPorNome<T extends { nome: string }>(mapas: readonly T[], termo: string): T[] {
  const alvo = normalizarParaBusca(termo);
  if (!alvo) return [...mapas];
  return mapas.filter((mapa) => normalizarParaBusca(mapa.nome).includes(alvo));
}

/** Nome do arquivo salvo: o nome do mapa, sem o que o sistema de arquivos recusa. */
export function nomeDoArquivoPdf(nomeDoMapa: string): string {
  const limpo = nomeDoMapa
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "");
  return `${limpo || "Mapa de Teatro"}.pdf`;
}

export function ehUuid(valor: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor);
}

/** O arquivo do mapa COMPLETO: `tipo: "mapa"` e `setor_id: null`. Setor não serve. */
export function arquivoDoMapaCompleto(arquivos: Json): { pdfRecurso: string; tamanhoBytes: number | null } | null {
  if (!Array.isArray(arquivos)) return null;
  const item = arquivos.find((a) => ehObjeto(a) && a.tipo === "mapa" && a.setor_id === null);
  if (!ehObjeto(item) || typeof item.pdf_recurso !== "string" || !item.pdf_recurso.trim()) return null;
  const tamanho = item.tamanho_bytes;
  return {
    pdfRecurso: item.pdf_recurso.trim(),
    tamanhoBytes: typeof tamanho === "number" && Number.isSafeInteger(tamanho) && tamanho > 0 ? tamanho : null
  };
}

/**
 * O endereço do `pdf_recurso`, sempre DENTRO da função do parceiro. Aceita o
 * endereço inteiro, o caminho a partir da raiz do servidor ou o caminho
 * relativo à função. Qualquer coisa que caia fora da função devolve `null`: o
 * token do usuário não é enviado a outro lugar (nem ao Storage público).
 */
export function urlDoRecursoPdf(base: string, recurso: string): string | null {
  const raiz = base.replace(/\/+$/, "");
  let origem: string;
  let caminhoDaFuncao: string;
  try {
    const u = new URL(raiz);
    origem = u.origin;
    caminhoDaFuncao = u.pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }

  let alvo: URL;
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(recurso)) alvo = new URL(recurso);
    else if (recurso.startsWith("//")) return null;
    else if (recurso.startsWith(`${caminhoDaFuncao}/`)) alvo = new URL(origem + recurso);
    else alvo = new URL(`${raiz}/${recurso.replace(/^\/+/, "")}`);
  } catch {
    return null;
  }
  if (alvo.origin !== origem) return null;
  if (!alvo.pathname.startsWith(`${caminhoDaFuncao}/`)) return null;
  if (alvo.pathname.split("/").includes("..")) return null;
  return alvo.toString();
}

export type ResultadoDoPdfDoMapa =
  | { tipo: "pdf"; resposta: Response; tamanhoBytes: number | null; nomeDoMapa: string }
  | { tipo: "pendente" }
  /** 401, 403, 404 (repassados) ou 503 (parceiro fora do ar ou resposta que não é a combinada). */
  | { tipo: "erro"; status: 401 | 403 | 404 | 503 };

function statusRepassado(status: number): 401 | 403 | 404 | 503 {
  return status === 401 || status === 403 || status === 404 ? status : 503;
}

/**
 * As duas chamadas ao parceiro, com o `Authorization` de quem clicou. Não lê o
 * corpo do PDF: devolve a resposta para ser repassada em fluxo.
 */
export async function buscarPdfDoMapa(entrada: {
  base: string;
  mapaId: string;
  autorizacao: string;
  buscar: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<ResultadoDoPdfDoMapa> {
  const { base, mapaId, autorizacao, buscar } = entrada;
  if (!ehUuid(mapaId)) return { tipo: "erro", status: 404 };
  const raiz = base.replace(/\/+$/, "");
  const cabecalhos = { Authorization: autorizacao };

  let exportacao: Response;
  try {
    exportacao = await buscar(
      `${raiz}/mapas/${mapaId.toLowerCase()}/exportacao?gerador=${encodeURIComponent(GERADOR_DO_PDF_DO_MAPA)}`,
      { method: "GET", headers: cabecalhos, cache: "no-store" }
    );
  } catch {
    return { tipo: "erro", status: 503 };
  }
  if (exportacao.status !== 200) return { tipo: "erro", status: statusRepassado(exportacao.status) };

  let corpo: Json;
  try {
    corpo = await exportacao.json();
  } catch {
    return { tipo: "erro", status: 503 };
  }
  if (!ehObjeto(corpo)) return { tipo: "erro", status: 503 };
  if (corpo.estado === "pendente") return { tipo: "pendente" };
  if (corpo.estado !== "pronto") return { tipo: "erro", status: 503 };

  const arquivo = arquivoDoMapaCompleto(corpo.arquivos);
  const alvo = arquivo ? urlDoRecursoPdf(raiz, arquivo.pdfRecurso) : null;
  if (!arquivo || !alvo) return { tipo: "erro", status: 503 };

  let pdf: Response;
  try {
    pdf = await buscar(alvo, { method: "GET", headers: cabecalhos, cache: "no-store" });
  } catch {
    return { tipo: "erro", status: 503 };
  }
  if (pdf.status !== 200) return { tipo: "erro", status: statusRepassado(pdf.status) };
  const tipoDoConteudo = (pdf.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (tipoDoConteudo !== "application/pdf" || !pdf.body) return { tipo: "erro", status: 503 };

  return {
    tipo: "pdf",
    resposta: pdf,
    tamanhoBytes: arquivo.tamanhoBytes,
    nomeDoMapa: typeof corpo.nome_mapa === "string" ? corpo.nome_mapa : ""
  };
}

/** O aviso da janela para cada status que a rota do Vibe devolve. */
export function avisoDoStatusDoPdf(status: number): string {
  return status === 403 ? AVISO_PDF_SEM_PERMISSAO : AVISO_PDF_INDISPONIVEL;
}

/** Confere o arquivo recebido: é PDF e tem o tamanho que o parceiro informou. */
export function pdfRecebidoConfere(entrada: { tipoDoConteudo: string | null; tamanho: number; tamanhoEsperado: string | null }): boolean {
  const tipo = (entrada.tipoDoConteudo || "").split(";")[0].trim().toLowerCase();
  if (tipo !== "application/pdf" || entrada.tamanho <= 0) return false;
  if (entrada.tamanhoEsperado === null || entrada.tamanhoEsperado === "") return true;
  return /^\d+$/.test(entrada.tamanhoEsperado) && Number(entrada.tamanhoEsperado) === entrada.tamanho;
}
