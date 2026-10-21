/**
 * Baixar o PDF do boleto com nome de gente (21/10/2026, pedido da Emily Boeira).
 *
 * O link público do boleto (`pay.ai-ideal.com.br/functions/v1/boleto-publico?codigo=X`)
 * devolve o PDF com `Content-Disposition: inline`, sem nome: o navegador salva
 * como "boleto-publico", e o vendedor manda isso no WhatsApp. O nome passa a ser
 *
 *   à vista ......... "<n° do pedido> - <cliente>.pdf"           (23625 - MB SOLUCOES GRAFICAS LTDA.pdf)
 *   parcelado ....... "<id_pagamento> P<n> de <total> - <cliente>.pdf" (23625-A P1 de 3 - ...pdf)
 *
 * POR QUE O DOWNLOAD SAI DO STORAGE, E NÃO DO LINK PÚBLICO
 *   A resposta de sucesso de `boleto-publico` não traz `Access-Control-Allow-Origin`:
 *   o navegador bloqueia o `fetch` feito pelo app. A função só lê o arquivo em
 *   `boletos/<id_int>/parcela_<parcela>.pdf` do Storage público, que responde com
 *   `Access-Control-Allow-Origin: *` — o mesmo arquivo, byte a byte (conferido
 *   em 21/10/2026 no P1122953). A linha é escolhida com a MESMA regra da
 *   função: pelo `n_doc_boleto` do link, preferindo a não cancelada mais recente.
 *   O conteúdo do boleto não muda.
 */

/** Tamanho máximo do nome, sem a extensão. */
export const TAMANHO_MAXIMO_NOME = 120;

const INVALIDOS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/** Tira o que nenhum sistema aceita em nome de arquivo e junta os espaços. */
export function limparParaNomeDeArquivo(texto: string): string {
  return String(texto ?? "")
    .replace(INVALIDOS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "");
}

export type DadosNomeBoleto = {
  idInt: number | string | null | undefined;
  idPagamento?: string | null;
  cliente?: string | null;
  parcela?: number | null;
  totalParcelas?: number | null;
};

export function nomeArquivoBoleto(d: DadosNomeBoleto): string {
  const parcelado = Number(d.totalParcelas) > 1 && Number(d.parcela) >= 1;
  const prefixo = parcelado
    ? `${limparParaNomeDeArquivo(d.idPagamento || String(d.idInt ?? ""))} P${Number(d.parcela)} de ${Number(d.totalParcelas)}`
    : limparParaNomeDeArquivo(String(d.idInt ?? d.idPagamento ?? ""));
  const cliente = limparParaNomeDeArquivo(d.cliente ?? "");
  let nome = [prefixo || "boleto", cliente].filter(Boolean).join(" - ");
  if (nome.length > TAMANHO_MAXIMO_NOME) nome = nome.slice(0, TAMANHO_MAXIMO_NOME).replace(/[.\s-]+$/, "");
  return `${nome}.pdf`;
}

/** O `codigo` do link público do boleto, ou null quando a URL é de outro tipo. */
export function codigoDoLinkPublico(url: string | null | undefined): string | null {
  try {
    const u = new URL(String(url ?? ""));
    if (!/\/functions\/v1\/boleto-publico\/?$/.test(u.pathname)) return null;
    const codigo = u.searchParams.get("codigo");
    return codigo && codigo.trim() ? codigo.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Pedido e parcela do caminho do PDF no Storage (`boletos/<id_int>/parcela_<n>.pdf`,
 * absoluto ou relativo ao bucket). Serve para achar a PARCELA certa: num
 * parcelado, todas as parcelas têm o mesmo `id_pagamento`.
 */
export function parcelaDoCaminhoStorage(url: string | null | undefined): { idInt: number; parcela: number } | null {
  const texto = String(url ?? "").split("?")[0];
  const m = texto.match(/(?:\/boletos\/|^)(\d+)\/parcela_(\d+)\.pdf$/);
  return m ? { idInt: Number(m[1]), parcela: Number(m[2]) } : null;
}

export type LinhaBoleto = {
  id_int: number | null;
  parcela: number | null;
  total_parcelas: number | null;
  status: string | null;
  created_at: string | null;
};

/** A linha que o link público serviria: a não cancelada mais recente, ou a única. */
export function escolherLinhaComoOLinkPublico(linhas: LinhaBoleto[]): LinhaBoleto | null {
  const ativas = linhas
    .filter((l) => String(l.status ?? "").toUpperCase() !== "CANCELADO")
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  return ativas[0] ?? (linhas.length === 1 ? linhas[0] : null);
}

/** URL pública do PDF no Storage, o mesmo arquivo que o link público lê. */
export function urlStorageDoBoleto(baseSupabase: string, idInt: number, parcela: number): string {
  return `${baseSupabase.replace(/\/$/, "")}/storage/v1/object/public/boletos/${idInt}/parcela_${parcela}.pdf`;
}
