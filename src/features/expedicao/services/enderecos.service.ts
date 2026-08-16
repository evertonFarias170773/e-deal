import { getSupabaseClient } from "@/lib/supabase/client";

export type EnderecoCliente = {
  id: string;
  /** "Rua X, 123 - Bairro, Cidade/UF (CEP 90000-000)" — pronto para o select. */
  rotulo: string;
  cep: string | null;
  /** tipo_endereco cru (ex.: "ENTREGA", "COBRANCA") — usado para achar o endereço de entrega. */
  tipo: string | null;
  recebedor: string | null;
};

export async function listarEnderecosCliente(idCliente: number): Promise<EnderecoCliente[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from("enderecos")
    .select("id, endereco, numero, complemento, bairro, cidade, uf, cep, tipo_endereco, recebedor")
    .eq("id_cliente", idCliente)
    .order("data_criacao", { ascending: false });
  if (error || !data) {
    console.warn("[enderecos.service] Erro ao buscar endereços:", error);
    return [];
  }
  return data.map((e) => {
    const linha = [
      [e.endereco, e.numero].filter(Boolean).join(", "),
      e.complemento,
      e.bairro,
      [e.cidade, e.uf].filter(Boolean).join("/")
    ]
      .filter(Boolean)
      .join(" - ");
    const cep = e.cep ? String(e.cep) : null;
    const tipo = e.tipo_endereco ? String(e.tipo_endereco) : null;
    const tipoSufixo = tipo ? ` [${tipo}]` : "";
    return {
      id: String(e.id),
      rotulo: `${linha}${cep ? ` (CEP ${cep})` : ""}${tipoSufixo}`,
      cep,
      tipo,
      recebedor: e.recebedor ? String(e.recebedor) : null
    };
  });
}
