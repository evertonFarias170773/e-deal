import { fetchComSessao } from "@/lib/supabase/sessao";

/**
 * Cliente de "Liberar nota antecipada" e do desfazer (menu da linha em Pedidos).
 * Quem confere a permissão e a regra é a rota POST /api/orcamentos/nota-antecipada.
 */

export type RespostaNotaAntecipada = {
  success: boolean;
  idempotente?: boolean;
  message: string;
  aviso?: string | null;
};

async function chamar(idInt: number, liberar: boolean): Promise<RespostaNotaAntecipada> {
  try {
    const res = await fetchComSessao("/api/orcamentos/nota-antecipada", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_int: idInt, liberar })
    });
    const data = (await res.json().catch(() => null)) as RespostaNotaAntecipada | null;
    if (res.ok && data?.success) return data;
    return { success: false, message: data?.message || `Falha na operação (HTTP ${res.status}).` };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : "Erro de rede." };
  }
}

export const liberarNotaAntecipada = (idInt: number) => chamar(idInt, true);
export const desfazerNotaAntecipada = (idInt: number) => chamar(idInt, false);
