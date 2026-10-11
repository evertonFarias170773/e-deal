import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Nomes dos vendedores para o filtro "Vendedor" da lista de Pedidos (11/10/2026):
 * `usuarios.nome_usuario` de quem tem `is_vendedor = true`. SOMENTE LEITURA, e o
 * mesmo recorte que Meu Desempenho e o formulário da proposta já leem do navegador
 * (política `usuarios_sel` liberada a todo usuário logado).
 *
 * `null` quando a leitura falha — quem chama decide o que mostrar.
 */
export async function listarNomesDeVendedores(): Promise<string[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("usuarios")
    .select("nome_usuario")
    .eq("is_vendedor", true);

  if (error) {
    console.warn("[vendedores-do-filtro] Falha ao ler os vendedores:", error.message);
    return null;
  }
  return (data ?? []).map((linha) => String(linha.nome_usuario ?? "").trim()).filter(Boolean);
}
