import { getSupabaseClient } from "@/lib/supabase/client";
import type { EtiquetaViewModel } from "./etiqueta-viewmodel.service";

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
 * Abre o PDF da etiqueta de RETIRA NO BALCAO. Mesmo desenho anti popup-block da
 * 10x15 — o que muda e a rota e o nome do arquivo.
 */
export async function abrirEtiquetaRetirada(
  idInt: number,
  volumes?: number | null
): Promise<AbrirEtiquetaResult> {
  const params = new URLSearchParams({ id_int: String(idInt) });
  if (volumes && volumes > 0) params.set("volumes", String(volumes));
  const url = `/api/expedicao/etiqueta-retirada?${params.toString()}`;

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
    anchor.download = `retirada_${idInt}.pdf`;
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

export type PreviaEtiquetaResult = {
  success: boolean;
  vm?: EtiquetaViewModel;
  qrDataUrl?: string | null;
  errorMessage?: string;
};

/**
 * Carrega o view model da etiqueta 10x15 para a PREVIA do modal Despachar
 * (04/09/2026). Rota `GET /api/expedicao/etiqueta/previa` — o MESMO
 * `montarEtiquetaViewModel` da rota do PDF, em JSON, sem carimbar
 * `etiqueta_impressa_em`.
 *
 * `idDestinatario` e a escolha do drop "Em nome de quem sai a etiqueta" ainda
 * nao gravada; `null` deixa o servidor ler o que esta persistido.
 *
 * Bearer quando ha sessao (mesmo padrao de `gerarPrepostagem`); sem token a
 * rota ainda autentica pelo cookie, como faz na aba do PDF.
 */
export async function carregarPreviaEtiqueta(
  idInt: number,
  idDestinatario: number | null
): Promise<PreviaEtiquetaResult> {
  const params = new URLSearchParams({ id_int: String(idInt) });
  if (idDestinatario !== null && Number.isFinite(idDestinatario) && idDestinatario > 0) {
    params.set("destinatario", String(idDestinatario));
  }
  const url = `/api/expedicao/etiqueta/previa?${params.toString()}`;

  try {
    const client = getSupabaseClient();
    const sessionResult = client ? await client.auth.getSession() : null;
    const token = sessionResult?.data?.session?.access_token;
    const response = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
    const body = (await response.json().catch(() => null)) as
      | { success?: boolean; vm?: EtiquetaViewModel; qrDataUrl?: string | null; message?: string }
      | null;
    if (response.ok && body?.success && body.vm) {
      return { success: true, vm: body.vm, qrDataUrl: body.qrDataUrl ?? null };
    }
    return { success: false, errorMessage: body?.message || `Falha ao montar a prévia (HTTP ${response.status}).` };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro inesperado ao montar a prévia." };
  }
}
