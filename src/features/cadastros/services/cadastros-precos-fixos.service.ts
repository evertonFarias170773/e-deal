import { getSupabaseClient } from "@/lib/supabase/client";

export interface ClientePrecoFixoRow {
  id: number;
  id_cliente: number;
  id_produto: number;
  preco_fixo: number;
  created_at?: string;
  produto?: {
    descricao: string;
    apelidos?: string | null;
  };
}

export async function fetchPrecosFixosByCliente(idCliente: number): Promise<ClientePrecoFixoRow[]> {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase não inicializado");
  const { data, error } = await client
    .from("clientes_precos_fixos")
    .select(`
      id,
      id_cliente,
      id_produto,
      preco_fixo,
      created_at,
      produto:produtos!fk_produto_preco_fixo (
        descricao,
        apelidos
      )
    `)
    .eq("id_cliente", idCliente)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Erro ao buscar preços fixos:", error);
    throw new Error("Erro ao carregar os preços fixos do cliente.");
  }

  return data as any[];
}

export async function upsertPrecoFixo(idCliente: number, idProduto: number, precoFixo: number) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase não inicializado");
  const { data, error } = await client
    .from("clientes_precos_fixos")
    .upsert(
      {
        id_cliente: idCliente,
        id_produto: idProduto,
        preco_fixo: precoFixo
      },
      { onConflict: "id_cliente, id_produto" }
    )
    .select()
    .single();

  if (error) {
    console.error("Erro ao salvar preço fixo:", error);
    throw new Error("Erro ao salvar o preço fixo.");
  }

  return data;
}

export async function deletePrecoFixo(id: number) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase não inicializado");
  const { error } = await client
    .from("clientes_precos_fixos")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Erro ao deletar preço fixo:", error);
    throw new Error("Erro ao deletar o preço fixo.");
  }
}
