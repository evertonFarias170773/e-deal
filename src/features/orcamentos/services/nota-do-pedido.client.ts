import { fetchComSessao } from "@/lib/supabase/sessao";
import type { NotaViva } from "@/features/orcamentos/lib/nota-x-pedido";

/** NF-e de venda vivas do pedido, lidas do banco pelo servidor. Falha = null (a tela não pergunta e avisa no console). */
export async function consultarNotasVivasDoPedido(idInt: number): Promise<NotaViva[] | null> {
  try {
    const res = await fetchComSessao("/api/orcamentos/nota-do-pedido", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_int: idInt, acao: "consultar" })
    });
    const data = (await res.json().catch(() => null)) as { success?: boolean; notas?: NotaViva[] } | null;
    return res.ok && data?.success ? data.notas ?? [] : null;
  } catch (e) {
    console.warn("[nota-do-pedido] consulta falhou:", e);
    return null;
  }
}

/** Depois do "Salvar mesmo assim": o servidor grava a linha do tempo com o que o banco diz. */
export async function registrarSalvoComNotaDivergente(idInt: number): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetchComSessao("/api/orcamentos/nota-do-pedido", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_int: idInt, acao: "registrar" })
    });
    const data = (await res.json().catch(() => null)) as { success?: boolean; message?: string } | null;
    return res.ok && data?.success ? { ok: true } : { ok: false, message: data?.message || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Erro de rede." };
  }
}
