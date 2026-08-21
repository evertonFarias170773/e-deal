import { getSupabaseClient } from "@/lib/supabase/client";
import { nomeArquivoOs } from "./os-nome-arquivo";

/**
 * Abre o PDF da OS gerado on-demand pela rota autenticada /api/pedidos/imprimir-os.
 *
 * A aba é aberta SINCRONAMENTE no clique (antes de qualquer await), evitando
 * bloqueio de popup, e navega direto para a rota. A rota autentica pelo cookie
 * de sessão, então nada precisa ser buscado antes.
 *
 * Por que navegar em vez de baixar via fetch + Blob: o visualizador de PDF do
 * navegador nomeia o arquivo pela URL. Num `blob:` isso é o UUID do object URL
 * (`aeb0fc11-97a2-...`), e nem o nome de um `File` nem o título da aba mudam
 * isso. Vindo de uma resposta HTTP, ele usa o `Content-Disposition` da rota —
 * que é exatamente `os_{id_int}_{setor}.pdf`.
 */

export interface AbrirPdfOsResult {
  success: boolean;
  errorMessage?: string;
}

/**
 * Layout do PDF. `completo` e o padrao historico (card por modelo, com a imagem
 * da arte) e continua saindo quando ninguem escolhe nada — inclusive de link
 * antigo, que nao tem o parametro. `resumido` e a lista de conferencia.
 */
export type LayoutPdfOs = "completo" | "resumido";

function urlDoBoletim(idInt: number, idBoletim?: string | null, layout?: LayoutPdfOs): string {
  const params = new URLSearchParams({ id_int: String(idInt) });
  if (idBoletim) params.set("boletim", idBoletim);
  // Só viaja quando é o não-padrão: a URL do caminho de sempre não muda.
  if (layout === "resumido") params.set("layout", "resumido");
  return `/api/pedidos/imprimir-os?${params.toString()}`;
}

/** O resumido baixa com sufixo proprio — a rota manda o mesmo no Content-Disposition. */
function nomeDoArquivo(idInt: number, setor: string | null | undefined, layout?: LayoutPdfOs): string {
  const base = nomeArquivoOs(idInt, setor);
  return layout === "resumido" ? base.replace(/\.pdf$/i, "_resumo.pdf") : base;
}

/**
 * Baixa o PDF de um boletim direto para o disco, sem abrir aba.
 *
 * É o caminho de "baixar todos": N abas seriam bloqueadas pelo navegador depois
 * da primeira, então cada setor vira um download com o seu próprio nome.
 */
export async function baixarPdfOs(
  idInt: number,
  idBoletim?: string | null,
  setor?: string | null
): Promise<AbrirPdfOsResult> {
  const nomeArquivo = nomeArquivoOs(idInt, setor);
  let objectUrl: string | null = null;
  try {
    const client = getSupabaseClient();
    const sessionResult = client ? await client.auth.getSession() : null;
    const token = sessionResult?.data?.session?.access_token;
    if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };

    const response = await fetch(urlDoBoletim(idInt, idBoletim), {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      let message = `Falha ao gerar o PDF (HTTP ${response.status}).`;
      try {
        const body = await response.json();
        if (body?.message) message = String(body.message);
      } catch {
        // resposta sem JSON — mantém a mensagem genérica
      }
      return { success: false, errorMessage: message };
    }

    const blob = await response.blob();
    objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = nomeArquivo;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return { success: true };
  } catch (e) {
    return {
      success: false,
      errorMessage: e instanceof Error ? e.message : "Erro inesperado ao gerar o PDF da OS."
    };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Abre o PDF da OS. `idBoletim` (pedidos_artes.id) seleciona o boletim do setor;
 * sem ele, mantém o comportamento legado do boletim mais recente da proposta.
 * `setor` entra no nome do arquivo (os_{id_int}_{setor}.pdf).
 */
export async function abrirPdfOs(
  idInt: number,
  idBoletim?: string | null,
  setor?: string | null,
  layout?: LayoutPdfOs
): Promise<AbrirPdfOsResult> {
  const nomeArquivo = nomeDoArquivo(idInt, setor, layout);
  const url = urlDoBoletim(idInt, idBoletim, layout);

  // Aberta de forma síncrona no gesto do usuário — não move para depois de um await.
  const win = typeof window !== "undefined" ? window.open(url, "_blank") : null;

  if (!win) {
    // Popup bloqueado: cai no download programático, que também respeita o nome.
    try {
      const client = getSupabaseClient();
      const sessionResult = client ? await client.auth.getSession() : null;
      const token = sessionResult?.data?.session?.access_token;
      if (!token) {
        return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };
      }

      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        let message = `Falha ao gerar o PDF (HTTP ${response.status}).`;
        try {
          const body = await response.json();
          if (body?.message) message = String(body.message);
        } catch {
          // resposta sem JSON — mantém a mensagem genérica
        }
        return { success: false, errorMessage: message };
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = nomeArquivo;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      return { success: true };
    } catch (e) {
      return {
        success: false,
        errorMessage: e instanceof Error ? e.message : "Erro inesperado ao gerar o PDF da OS."
      };
    }
  }

  return { success: true };
}
