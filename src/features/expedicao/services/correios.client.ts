import { getSupabaseClient } from "@/lib/supabase/client";

async function tokenSessao(): Promise<string | null> {
  const client = getSupabaseClient();
  const sessionResult = client ? await client.auth.getSession() : null;
  return sessionResult?.data?.session?.access_token ?? null;
}

export async function correiosStatus(): Promise<{ configurado: boolean }> {
  try {
    const res = await fetch("/api/expedicao/correios/status");
    const data = (await res.json()) as { configurado?: boolean };
    return { configurado: data.configurado === true };
  } catch {
    return { configurado: false };
  }
}

export async function gerarPrepostagem(
  idInt: number,
  servico: "SEDEX" | "PAC"
): Promise<{ success: boolean; codigoObjeto?: string; errorMessage?: string }> {
  const token = await tokenSessao();
  if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };
  try {
    const res = await fetch("/api/expedicao/correios/prepostagem", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id_int: idInt, servico })
    });
    const data = (await res.json().catch(() => null)) as { success?: boolean; codigoObjeto?: string; message?: string } | null;
    if (res.ok && data?.success && data.codigoObjeto) return { success: true, codigoObjeto: data.codigoObjeto };
    return { success: false, errorMessage: data?.message || `Falha (HTTP ${res.status}).` };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro de rede." };
  }
}

/**
 * Marca no ERP que a prepostagem foi cancelada NO PORTAL dos Correios.
 *
 * Nao cancela nada nos Correios — esse ato continua sendo manual e fora do
 * sistema. Aqui so se registra que ja aconteceu, para a tela parar de oferecer
 * rastreio e etiqueta oficial de um objeto morto. Quem marcou vem da sessao do
 * servidor; o cliente manda apenas o id do pedido.
 */
export async function marcarPrepostagemCancelada(
  idInt: number
): Promise<{ success: boolean; jaMarcada?: boolean; errorMessage?: string }> {
  const token = await tokenSessao();
  if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };
  try {
    const res = await fetch("/api/expedicao/correios/prepostagem-cancelada", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id_int: idInt })
    });
    const data = (await res.json().catch(() => null)) as
      | { success?: boolean; jaMarcada?: boolean; message?: string }
      | null;
    if (res.ok && data?.success) return { success: true, jaMarcada: data.jaMarcada === true };
    return { success: false, errorMessage: data?.message || `Falha (HTTP ${res.status}).` };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro de rede." };
  }
}

/** Abre o rótulo oficial (mesmo desenho anti-popup do abrirEtiqueta). */
export async function abrirEtiquetaCorreios(idInt: number): Promise<{ success: boolean; errorMessage?: string }> {
  const url = `/api/expedicao/correios/etiqueta?id_int=${idInt}`;
  const win = typeof window !== "undefined" ? window.open(url, "_blank") : null;
  if (win) return { success: true };
  const token = await tokenSessao();
  if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      let message = `Falha ao gerar o rótulo (HTTP ${response.status}).`;
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
    anchor.download = `correios_${idInt}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    return { success: true };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro inesperado." };
  }
}
