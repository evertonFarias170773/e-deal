import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Abre o PDF da OS gerado on-demand pela rota autenticada /api/pedidos/imprimir-os.
 *
 * Popup-safe: a janela é aberta SINCRONAMENTE no clique (antes de qualquer await),
 * evitando bloqueio de popup. Em erro, a janela placeholder é fechada e o Blob URL
 * revogado — nenhum caminho deixa janela órfã.
 */

export interface AbrirPdfOsResult {
  success: boolean;
  errorMessage?: string;
}

export async function abrirPdfOs(idInt: number): Promise<AbrirPdfOsResult> {
  // Aberta de forma síncrona no gesto do usuário — não move para depois de um await.
  const win = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
  if (win) {
    try {
      win.document.title = `OS #${idInt} - gerando PDF...`;
      win.document.body.innerHTML =
        '<p style="font-family:sans-serif;color:#334155;padding:24px">Gerando PDF da OS...</p>';
    } catch {
      // Sem acesso ao documento do popup — segue sem placeholder.
    }
  }

  let objectUrl: string | null = null;

  try {
    const client = getSupabaseClient();
    const sessionResult = client ? await client.auth.getSession() : null;
    const token = sessionResult?.data?.session?.access_token;
    if (!token) {
      if (win && !win.closed) win.close();
      return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };
    }

    const response = await fetch(`/api/pedidos/imprimir-os?id_int=${idInt}`, {
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
      if (win && !win.closed) win.close();
      return { success: false, errorMessage: message };
    }

    const blob = await response.blob();
    objectUrl = URL.createObjectURL(blob);

    if (win && !win.closed) {
      win.location.href = objectUrl;
      // Revogação adiada: revogar imediatamente quebraria o carregamento no popup.
      const urlParaRevogar = objectUrl;
      window.setTimeout(() => URL.revokeObjectURL(urlParaRevogar), 60_000);
    } else {
      // Popup bloqueado → fallback de download programático.
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `OS-${idInt}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    }

    return { success: true };
  } catch (e) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (win && !win.closed) win.close();
    return {
      success: false,
      errorMessage: e instanceof Error ? e.message : "Erro inesperado ao gerar o PDF da OS."
    };
  }
}
