import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Chama `/api/orcamentos/enviar-fila-faturamento` com a sessão do usuário
 * (13/10/2026). Quem grava é a rota, no servidor; nada sai direto do navegador.
 */
export type RespostaEnviarParaFila =
  | { success: true; idempotente: boolean; message: string; aviso: string | null }
  | { success: false; message: string };

export async function enviarPedidoParaFilaPeloServidor(idInt: number): Promise<RespostaEnviarParaFila> {
  const client = getSupabaseClient();
  if (!client) return { success: false, message: "Cliente Supabase indisponível." };

  const sessao = await client.auth.getSession();
  const token = sessao.data.session?.access_token || "";
  if (!token) return { success: false, message: "Sessão não encontrada. Faça login novamente." };

  try {
    const resposta = await fetch("/api/orcamentos/enviar-fila-faturamento", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id_int: idInt })
    });
    const dados = await resposta.json().catch(() => null);
    if (!resposta.ok || !dados?.success) {
      return { success: false, message: dados?.message || "Não foi possível enviar o pedido à Fila de Faturamento." };
    }
    return {
      success: true,
      idempotente: dados.idempotente === true,
      message: String(dados.message ?? ""),
      aviso: typeof dados.aviso === "string" ? dados.aviso : null
    };
  } catch (erro) {
    return { success: false, message: erro instanceof Error ? erro.message : "Falha na comunicação com o servidor." };
  }
}
