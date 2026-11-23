import { fetchComSessao } from "@/lib/supabase/sessao";

export type ConsultaEntregueAjustavel = { ajustavel: boolean; mensagem: string | null };

/**
 * O pedido ENTREGUE pode ter o valor ajustado? (lido do banco pelo servidor,
 * `/api/orcamentos/entregue-ajustavel`). Falha = `null`: a tela mantém a trava.
 */
export async function consultarEntregueAjustavel(idInt: number): Promise<ConsultaEntregueAjustavel | null> {
  try {
    const res = await fetchComSessao("/api/orcamentos/entregue-ajustavel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_int: idInt })
    });
    const data = (await res.json().catch(() => null)) as
      | { success?: boolean; ajustavel?: boolean; mensagem?: string | null }
      | null;
    if (!res.ok || !data?.success) return null;
    return { ajustavel: data.ajustavel === true, mensagem: data.mensagem ?? null };
  } catch (e) {
    console.warn("[entregue-ajustavel] consulta falhou:", e);
    return null;
  }
}
