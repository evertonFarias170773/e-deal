import { getSupabaseClient } from "@/lib/supabase/client";

export type EnderecoCliente = {
  id: string;
  /** "Rua X, 123 - Bairro, Cidade/UF (CEP 90000-000)" — pronto para o select. */
  rotulo: string;
  cep: string | null;
  /** tipo_endereco cru (ex.: "ENTREGA", "COBRANCA") — usado para achar o endereço de entrega. */
  tipo: string | null;
  recebedor: string | null;
  /**
   * Cadastro dono do endereço. Existe desde 24/08/2026, quando a lista passou a
   * poder misturar cliente e pagador: é por ele que a tela sabe de quem é cada
   * opção, e é por ele que o default se mantém restrito ao cliente.
   */
  idCliente: number;
};

/**
 * Endereços de UM ou DOIS cadastros, numa consulta só.
 *
 * POR QUE ACEITA O PAGADOR (24/08/2026)
 *   O modal Despachar listava apenas os endereços do cliente da proposta. Quando
 *   o pagador é outro cadastro e a entrega vai para um endereço DELE, esse
 *   endereço não aparecia — e o expedidor não tinha como escolhê-lo. Foi o caso
 *   da proposta 21055 (cliente 8469, pagador 342): o endereço gravado era do
 *   342, e abrir o modal mostrava um valor selecionado que não existia na lista.
 *
 *   O `.in()` mantém UMA consulta para os dois cadastros — a razão de o pagador
 *   ter vindo pelo pipeline do `PedidoExpedicao`, e não por uma busca extra na
 *   abertura do modal.
 *
 *   `idPagador` igual ao cliente, nulo ou indefinido não muda nada: a lista sai
 *   idêntica à de antes, sem duplicata.
 */
export async function listarEnderecosCliente(
  idCliente: number,
  idPagador?: number | null
): Promise<EnderecoCliente[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const ids = Array.from(
    new Set([idCliente, ...(Number.isInteger(idPagador) && idPagador !== idCliente ? [idPagador as number] : [])])
  );
  const { data, error } = await client
    .from("enderecos")
    .select("id, id_cliente, endereco, numero, complemento, bairro, cidade, uf, cep, tipo_endereco, recebedor")
    .in("id_cliente", ids)
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
      recebedor: e.recebedor ? String(e.recebedor) : null,
      idCliente: Number(e.id_cliente)
    };
  });
}
