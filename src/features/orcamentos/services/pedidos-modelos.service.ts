import { getSupabaseClient } from "@/lib/supabase/client";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PedidoModeloRow {
  id: number;
  id_int: number;
  id_pedido: string | null;
  id_item: string | null;
  id_produto_proposta_origem: number | null;
  nome_modelo: string;
  descricao: string | null;
  padrao: string | null;
  quantidade: number;
  tipo_numeracao: string | null;
  numeracao_inicio: number | null;
  numeracao_fim: number | null;
  frente_verso: boolean | null;
  rfid_nfc: boolean | null;
  gabarito_operacional: string | null;
  especificacao_dados: string | null;
  obs_impressao: string | null;
  status_arte: string;
  status_producao: string;
  ordem: number;
  created_at: string;
  updated_at: string | null;
}

export interface ItemComModelos {
  id: number;              // produtos_proposta.id
  id_int: number;
  id_produto: number;
  nome_produto: string;
  modelo_descri: string;
  qtd: number;
  modelos: PedidoModeloRow[];
  qtd_modelos_do_item: number;
  saldo_a_distribuir: number;
}

export interface ModeloInput {
  id_int: number;
  id_produto_proposta_origem: number;
  nome_modelo: string;
  padrao: string | null;
  quantidade: number;
  tipo_numeracao: string | null;
  numeracao_inicio: number | null;
  numeracao_fim: number | null;
  frente_verso: boolean;
  rfid_nfc: boolean;
  gabarito_operacional: string | null;
  especificacao_dados: string | null;
  obs_impressao: string | null;
}

type ServiceResult<T = unknown> = {
  success: boolean;
  data?: T;
  errorMessage?: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client não disponível.");
  return client;
}

function validarInput(input: ModeloInput): string | null {
  if (!input.nome_modelo?.trim()) {
    return "O nome do modelo é obrigatório.";
  }
  if (!input.quantidade || input.quantidade <= 0) {
    return "A quantidade deve ser maior que zero.";
  }
  if (input.tipo_numeracao === "SEQUENCIAL") {
    if (input.numeracao_inicio === null || input.numeracao_inicio === undefined) {
      return "Numeração inicial é obrigatória para tipo SEQUENCIAL.";
    }
    if (input.numeracao_fim === null || input.numeracao_fim === undefined) {
      return "Numeração final é obrigatória para tipo SEQUENCIAL.";
    }
    if (input.numeracao_fim < input.numeracao_inicio) {
      return "Numeração final não pode ser menor que a inicial.";
    }
  }
  return null;
}

// ─── Functions ───────────────────────────────────────────────────────────────

/**
 * Lista todos os itens (produtos_proposta) da proposta,
 * com os modelos (pedidos_modelos) agrupados por item.
 */
export async function listarItensComModelos(idInt: number): Promise<ServiceResult<ItemComModelos[]>> {
  try {
    const client = getClient();

    // 1. Buscar itens da proposta
    const { data: itensRows, error: itensError } = await client
      .from("produtos_proposta")
      .select("id, id_int, id_produto, nome_produto, modelo_descri, qtd")
      .eq("id_int", idInt)
      .order("id", { ascending: true });

    if (itensError) {
      return { success: false, errorMessage: `Erro ao buscar itens: ${itensError.message}` };
    }

    const itens = itensRows || [];

    if (itens.length === 0) {
      return { success: true, data: [] };
    }

    // 2. Buscar modelos da proposta
    const { data: modelosRows, error: modelosError } = await client
      .from("pedidos_modelos")
      .select(`
        id, id_int, id_pedido, id_item, id_produto_proposta_origem,
        nome_modelo, descricao, padrao, quantidade,
        tipo_numeracao, numeracao_inicio, numeracao_fim,
        frente_verso, rfid_nfc, gabarito_operacional, especificacao_dados,
        obs_impressao, status_arte, status_producao, ordem,
        created_at, updated_at
      `)
      .eq("id_int", idInt)
      .order("ordem", { ascending: true })
      .order("created_at", { ascending: true });

    if (modelosError) {
      return { success: false, errorMessage: `Erro ao buscar modelos: ${modelosError.message}` };
    }

    const modelos: PedidoModeloRow[] = (modelosRows || []).map((m: Record<string, unknown>) => ({
      id: Number(m.id),
      id_int: Number(m.id_int),
      id_pedido: m.id_pedido as string | null,
      id_item: m.id_item as string | null,
      id_produto_proposta_origem: m.id_produto_proposta_origem !== null ? Number(m.id_produto_proposta_origem) : null,
      nome_modelo: String(m.nome_modelo || ""),
      descricao: m.descricao as string | null,
      padrao: m.padrao as string | null,
      quantidade: Number(m.quantidade || 0),
      tipo_numeracao: m.tipo_numeracao as string | null,
      numeracao_inicio: m.numeracao_inicio !== null ? Number(m.numeracao_inicio) : null,
      numeracao_fim: m.numeracao_fim !== null ? Number(m.numeracao_fim) : null,
      frente_verso: Boolean(m.frente_verso),
      rfid_nfc: Boolean(m.rfid_nfc),
      gabarito_operacional: m.gabarito_operacional as string | null,
      especificacao_dados: m.especificacao_dados as string | null,
      obs_impressao: m.obs_impressao as string | null,
      status_arte: String(m.status_arte || "PENDENTE"),
      status_producao: String(m.status_producao || "PENDENTE"),
      ordem: Number(m.ordem || 0),
      created_at: String(m.created_at || ""),
      updated_at: m.updated_at as string | null,
    }));

    // 3. Agrupar modelos por item
    const result: ItemComModelos[] = itens.map((item: Record<string, unknown>) => {
      const itemId = Number(item.id);
      const itemModelos = modelos.filter((m) => m.id_produto_proposta_origem === itemId);
      const qtdModelos = itemModelos.reduce((acc, m) => acc + m.quantidade, 0);
      const qtdItem = Number(item.qtd || 0);

      return {
        id: itemId,
        id_int: Number(item.id_int),
        id_produto: Number(item.id_produto),
        nome_produto: String(item.nome_produto || "Produto sem nome"),
        modelo_descri: String(item.modelo_descri || ""),
        qtd: qtdItem,
        modelos: itemModelos,
        qtd_modelos_do_item: qtdModelos,
        saldo_a_distribuir: qtdItem - qtdModelos,
      };
    });

    return { success: true, data: result };
  } catch (err) {
    console.error("[PedidosModelosService] listarItensComModelos:", err);
    return { success: false, errorMessage: "Falha interna ao listar itens e modelos." };
  }
}

/**
 * Valida se a quantidade do modelo cabe no saldo do item.
 * Em edição, desconta a quantidade do próprio modelo antes de validar.
 */
export async function validarSaldoModelo(
  idProdutoProposta: number,
  quantidade: number,
  modeloIdExcluir?: number
): Promise<{ valido: boolean; saldoDisponivel: number; errorMessage?: string }> {
  try {
    const client = getClient();

    // Buscar qtd do item
    const { data: itemRow, error: itemError } = await client
      .from("produtos_proposta")
      .select("qtd")
      .eq("id", idProdutoProposta)
      .single();

    if (itemError || !itemRow) {
      return { valido: false, saldoDisponivel: 0, errorMessage: "Item não encontrado." };
    }

    const qtdItem = Number(itemRow.qtd || 0);

    // Buscar modelos existentes
    const { data: modelosRows, error: modelosError } = await client
      .from("pedidos_modelos")
      .select("id, quantidade")
      .eq("id_produto_proposta_origem", idProdutoProposta);

    if (modelosError) {
      return { valido: false, saldoDisponivel: 0, errorMessage: `Erro ao buscar modelos: ${modelosError.message}` };
    }

    let somaExistente = 0;
    for (const m of modelosRows || []) {
      if (modeloIdExcluir && Number(m.id) === modeloIdExcluir) continue;
      somaExistente += Number(m.quantidade || 0);
    }

    const saldoDisponivel = qtdItem - somaExistente;

    if (quantidade > saldoDisponivel) {
      return {
        valido: false,
        saldoDisponivel,
        errorMessage: `Quantidade (${quantidade}) excede o saldo disponível (${saldoDisponivel}) do item.`,
      };
    }

    return { valido: true, saldoDisponivel };
  } catch (err) {
    console.error("[PedidosModelosService] validarSaldoModelo:", err);
    return { valido: false, saldoDisponivel: 0, errorMessage: "Falha interna na validação de saldo." };
  }
}

/**
 * Cria um novo modelo vinculado a um item da proposta.
 */
export async function criarModelo(input: ModeloInput): Promise<ServiceResult<PedidoModeloRow>> {
  try {
    const validationError = validarInput(input);
    if (validationError) {
      return { success: false, errorMessage: validationError };
    }

    const saldoResult = await validarSaldoModelo(input.id_produto_proposta_origem, input.quantidade);
    if (!saldoResult.valido) {
      return { success: false, errorMessage: saldoResult.errorMessage };
    }

    const client = getClient();

    // Descobrir próxima ordem
    const { data: maxOrdemRows } = await client
      .from("pedidos_modelos")
      .select("ordem")
      .eq("id_int", input.id_int)
      .order("ordem", { ascending: false })
      .limit(1);

    const nextOrdem = (maxOrdemRows && maxOrdemRows.length > 0 ? Number(maxOrdemRows[0].ordem) : 0) + 1;

    const payload = {
      id_int: input.id_int,
      id_produto_proposta_origem: input.id_produto_proposta_origem,
      nome_modelo: input.nome_modelo.trim(),
      padrao: input.padrao?.trim() || null,
      quantidade: input.quantidade,
      tipo_numeracao: input.tipo_numeracao || "SEM_NUMERACAO",
      numeracao_inicio: input.numeracao_inicio,
      numeracao_fim: input.numeracao_fim,
      frente_verso: input.frente_verso,
      rfid_nfc: input.rfid_nfc,
      gabarito_operacional: input.gabarito_operacional?.trim() || null,
      especificacao_dados: input.especificacao_dados?.trim() || null,
      obs_impressao: input.obs_impressao?.trim() || null,
      status_arte: "PENDENTE",
      status_producao: "PENDENTE",
      ordem: nextOrdem,
    };

    const { data, error } = await client
      .from("pedidos_modelos")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      console.error("[PedidosModelosService] criarModelo:", error);
      return { success: false, errorMessage: error.message || "Falha ao criar modelo." };
    }

    return { success: true, data: data as PedidoModeloRow };
  } catch (err) {
    console.error("[PedidosModelosService] criarModelo:", err);
    return { success: false, errorMessage: "Falha interna ao criar modelo." };
  }
}

/**
 * Atualiza um modelo existente.
 */
export async function atualizarModelo(id: number, input: ModeloInput): Promise<ServiceResult<PedidoModeloRow>> {
  try {
    const validationError = validarInput(input);
    if (validationError) {
      return { success: false, errorMessage: validationError };
    }

    // Em edição, desconta a quantidade do próprio modelo
    const saldoResult = await validarSaldoModelo(input.id_produto_proposta_origem, input.quantidade, id);
    if (!saldoResult.valido) {
      return { success: false, errorMessage: saldoResult.errorMessage };
    }

    const client = getClient();

    const payload = {
      nome_modelo: input.nome_modelo.trim(),
      padrao: input.padrao?.trim() || null,
      quantidade: input.quantidade,
      tipo_numeracao: input.tipo_numeracao || "SEM_NUMERACAO",
      numeracao_inicio: input.numeracao_inicio,
      numeracao_fim: input.numeracao_fim,
      frente_verso: input.frente_verso,
      rfid_nfc: input.rfid_nfc,
      gabarito_operacional: input.gabarito_operacional?.trim() || null,
      especificacao_dados: input.especificacao_dados?.trim() || null,
      obs_impressao: input.obs_impressao?.trim() || null,
    };

    const { data, error } = await client
      .from("pedidos_modelos")
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      console.error("[PedidosModelosService] atualizarModelo:", error);
      return { success: false, errorMessage: error.message || "Falha ao atualizar modelo." };
    }

    return { success: true, data: data as PedidoModeloRow };
  } catch (err) {
    console.error("[PedidosModelosService] atualizarModelo:", err);
    return { success: false, errorMessage: "Falha interna ao atualizar modelo." };
  }
}

/**
 * Exclui um modelo pelo id.
 */
export async function excluirModelo(id: number): Promise<ServiceResult> {
  try {
    const client = getClient();

    const { error } = await client
      .from("pedidos_modelos")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("[PedidosModelosService] excluirModelo:", error);
      return { success: false, errorMessage: error.message || "Falha ao excluir modelo." };
    }

    return { success: true };
  } catch (err) {
    console.error("[PedidosModelosService] excluirModelo:", err);
    return { success: false, errorMessage: "Falha interna ao excluir modelo." };
  }
}
