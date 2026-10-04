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
 * O endereço do `pdf_recurso`, sempre DENTRO da função do parceiro, sempre em
 * https e sempre no servidor da `base`. Qualquer coisa que caia fora da função
 * devolve `null`: o token do usuário não é enviado a outro lugar (nem ao
 * Storage público).
 *
 * Formas aceitas — todas viram `{base}/<resto>`:
 *   - endereço inteiro do mesmo servidor, com o caminho público da função
 *     (`/functions/v1/mapas-teatro-pdfs/...`);
 *   - endereço inteiro do mesmo servidor com o caminho INTERNO da função
 *     (`/mapas-teatro-pdfs/...`, sem `/functions/v1`) e em `http`. É o que o
 *     parceiro devolve de fato (medido em 04/10/2026): a função monta o
 *     endereço a partir da requisição como ela a enxerga por dentro. Só o
 *     caminho e a consulta são aproveitados; protocolo e servidor são os da base;
 *   - os mesmos dois caminhos sem o servidor, ou o caminho relativo à função.
 */
export function urlDoRecursoPdf(base: string, recurso: string): string | null {
  let origem: string;
  let servidor: string;
  let caminhoDaFuncao: string;
  try {
    const u = new URL(base.replace(/\/+$/, ""));
    origem = u.origin;
    servidor = u.hostname.toLowerCase();
    caminhoDaFuncao = u.pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
  const nomeDaFuncao = caminhoDaFuncao.split("/").pop() || "";
  if (!nomeDaFuncao) return null;

  // Subir de pasta não tem uso legítimo aqui: recusado antes de normalizar.
  if (/(^|[/\\])(\.|%2e){1,2}([/\\?#]|$)/i.test(recurso)) return null;

  let caminho: string;
  let consulta: string;
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(recurso)) {
      const u = new URL(recurso);
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      if (u.hostname.toLowerCase() !== servidor || u.username || u.password) return null;
      // Porta: só a padrão do protocolo (a função interna responde em http na 80).
      if (u.port) return null;
      caminho = u.pathname;
      consulta = u.search;
    } else if (recurso.startsWith("//")) {
      return null;
    } else {
      const u = new URL(recurso.startsWith("/") ? recurso : `/${recurso}`, "https://relativo.invalid");
      // Relativo à função, a não ser que já traga um dos dois caminhos dela.
      const jaTrazAFuncao =
        recurso.startsWith(`${caminhoDaFuncao}/`) || recurso.startsWith(`/${nomeDaFuncao}/`);
      caminho = jaTrazAFuncao ? u.pathname : `${caminhoDaFuncao}${u.pathname}`;
      consulta = u.search;
    }
  } catch {
    return null;
  }

  let resto: string;
  if (caminho.startsWith(`${caminhoDaFuncao}/`)) resto = caminho.slice(caminhoDaFuncao.length);
  else if (caminho.startsWith(`/${nomeDaFuncao}/`)) resto = caminho.slice(nomeDaFuncao.length + 1);
  else return null;
  if (resto.length <= 1 || resto.split("/").some((parte) => parte === ".." || parte === ".")) return null;

  return `${origem}${caminhoDaFuncao}${resto}${consulta}`;
}

export type ResultadoDoPdfDoMapa =
  | { tipo: "pdf"; resposta: Response; tamanhoBytes: number | null; nomeDoMapa: string }
  | { tipo: "pendente" }
  /** 401, 403, 404 (repassados) ou 503 (parceiro fora do ar ou resposta que não é a combinada). */
  | { tipo: "erro"; status: 401 | 403 | 404 | 503 };

/** O passo que falhou, para o log. Nunca leva token, endereço nem corpo de resposta. */
export type FalhaDoPdfDoMapa = {
  passo: "consulta" | "manifesto" | "selecao" | "recurso" | "download";
  motivo: string;
  statusDoParceiro?: number;
};

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
  /** Para o log do servidor: o passo que falhou e o motivo, sem token nem endereço. */
  registrar?: (falha: FalhaDoPdfDoMapa) => void;
}): Promise<ResultadoDoPdfDoMapa> {
  const { base, mapaId, autorizacao, buscar } = entrada;
  const falhou = (falha: FalhaDoPdfDoMapa, status: 401 | 403 | 404 | 503): ResultadoDoPdfDoMapa => {
    entrada.registrar?.(falha);
    return { tipo: "erro", status };
  };
  if (!ehUuid(mapaId)) return falhou({ passo: "consulta", motivo: "id do mapa não é uuid" }, 404);
  const raiz = base.replace(/\/+$/, "");
  const cabecalhos = { Authorization: autorizacao };

  let exportacao: Response;
  try {
    exportacao = await buscar(
      `${raiz}/mapas/${mapaId.toLowerCase()}/exportacao?gerador=${encodeURIComponent(GERADOR_DO_PDF_DO_MAPA)}`,
      { method: "GET", headers: cabecalhos, cache: "no-store" }
    );
  } catch {
    return falhou({ passo: "consulta", motivo: "sem resposta do parceiro" }, 503);
  }
  if (exportacao.status !== 200) {
    return falhou(
      { passo: "consulta", motivo: "status do parceiro", statusDoParceiro: exportacao.status },
      statusRepassado(exportacao.status)
    );
  }

  let corpo: Json;
  try {
    corpo = await exportacao.json();
  } catch {
    return falhou({ passo: "manifesto", motivo: "resposta não é JSON" }, 503);
  }
  if (!ehObjeto(corpo)) return falhou({ passo: "manifesto", motivo: "resposta não é objeto" }, 503);
  if (corpo.estado === "pendente") return { tipo: "pendente" };
  if (corpo.estado !== "pronto") {
    return falhou({ passo: "manifesto", motivo: `estado desconhecido: ${String(corpo.estado).slice(0, 40)}` }, 503);
  }

  const arquivo = arquivoDoMapaCompleto(corpo.arquivos);
  if (!arquivo) return falhou({ passo: "selecao", motivo: "sem arquivo tipo mapa com setor_id null" }, 503);
  const alvo = urlDoRecursoPdf(raiz, arquivo.pdfRecurso);
  if (!alvo) return falhou({ passo: "recurso", motivo: "pdf_recurso fora da função do parceiro" }, 503);

  let pdf: Response;
  try {
    pdf = await buscar(alvo, { method: "GET", headers: cabecalhos, cache: "no-store" });
  } catch {
    return falhou({ passo: "download", motivo: "sem resposta do parceiro" }, 503);
  }
  if (pdf.status !== 200) {
    return falhou(
      { passo: "download", motivo: "status do parceiro", statusDoParceiro: pdf.status },
      statusRepassado(pdf.status)
    );
  }
  const tipoDoConteudo = (pdf.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (tipoDoConteudo !== "application/pdf" || !pdf.body) {
    return falhou({ passo: "download", motivo: `conteúdo não é PDF: ${tipoDoConteudo.slice(0, 40) || "sem tipo"}` }, 503);
  }

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
