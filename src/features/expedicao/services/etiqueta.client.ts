import { getSupabaseClient } from "@/lib/supabase/client";

export interface AbrirEtiquetaResult {
  success: boolean;
  errorMessage?: string;
}

/**
 * Abre o PDF da etiqueta 10x15. A aba abre SINCRONAMENTE no clique (anti
 * popup-block); a rota autentica pelo cookie. Popup bloqueado => download via
 * fetch com Bearer (mesmo padrão de abrirPdfOs).
 */
export async function abrirEtiqueta(idInt: number, volumes?: number | null): Promise<AbrirEtiquetaResult> {
  const params = new URLSearchParams({ id_int: String(idInt) });
  if (volumes && volumes > 0) params.set("volumes", String(volumes));
  const url = `/api/expedicao/etiqueta?${params.toString()}`;

  const win = typeof window !== "undefined" ? window.open(url, "_blank") : null;
  if (win) return { success: true };

  try {
    const client = getSupabaseClient();
    const sessionResult = client ? await client.auth.getSession() : null;
    const token = sessionResult?.data?.session?.access_token;
    if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };

    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      let message = `Falha ao gerar a etiqueta (HTTP ${response.status}).`;
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
    anchor.download = `etiqueta_${idInt}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    return { success: true };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro inesperado ao gerar a etiqueta." };
  }
}

/**
 * Abre a declaração de conteúdo (A4). Documento que acompanha a remessa quando
 * não há NF-e autorizada — o rótulo dos Correios traz só a etiqueta, conferido
 * num rótulo real: PDF de 1 página.
 * Mesmo desenho anti-popup de `abrirEtiqueta`.
 */
export async function abrirDeclaracaoConteudo(idInt: number): Promise<AbrirEtiquetaResult> {
  const url = `/api/expedicao/declaracao-conteudo?id_int=${idInt}`;

  const win = typeof window !== "undefined" ? window.open(url, "_blank") : null;
  if (win) return { success: true };

  try {
    const client = getSupabaseClient();
    const sessionResult = client ? await client.auth.getSession() : null;
    const token = sessionResult?.data?.session?.access_token;
    if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };

    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      let message = `Falha ao gerar a declaração (HTTP ${response.status}).`;
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
    anchor.download = `declaracao_conteudo_${idInt}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    return { success: true };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro inesperado ao gerar a declaração." };
  }
}
