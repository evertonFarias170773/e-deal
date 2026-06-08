import { getSupabaseClient } from "@/lib/supabase/client";
import { nfeMocks } from "@/lib/mocks/nfe.mock";
import { mapSupabaseNfeRowToReadModel } from "../mappers";
import type { SupabaseNfeRow, NfeReadModel, SupabaseNfeItemRow, SupabaseNfePagamentoRow } from "../types";
import type { SupabaseBoletoRow } from "@/features/contas-a-receber/types.supabase";
import { getPropostaDetailById } from "@/features/orcamentos/services/orcamentos.service";
import type { FaturavelOrigem } from "@/features/fiscal/types";

export const NFE_SELECT_COLUMNS = [
  "id",
  "id_int",
  "id_cliente",
  "ref",
  "ambiente",
  "modelo",
  "status",
  "status_focus",
  "status_sefaz",
  "mensagem_sefaz",
  "codigo_status_sefaz",
  "numero_nf",
  "serie",
  "chave_nfe",
  "protocolo",
  "data_autorizacao",
  "data_cancelamento",
  "natureza_operacao",
  "tipo_documento",
  "finalidade_emissao",
  "consumidor_final",
  "presenca_comprador",
  "tipo_contribuinte",
  "modalidade_frete",
  "id_cotacao_frete",
  "transportadora",
  "valor_frete",
  "peso_liquido",
  "peso_bruto",
  "quantidade_volumes",
  "especie_volumes",
  "marca_volumes",
  "numeracao_volumes",
  "informacoes_complementares",
  "observacoes_internas",
  "endereco_entrega_observacao",
  "valor_produtos",
  "valor_desconto",
  "valor_total_nf",
  "caminho_xml",
  "caminho_danfe",
  "url_xml",
  "url_danfe",
  "payload_envio",
  "payload_retorno",
  "payload_webhook",
  "erro_codigo",
  "erro_mensagem",
  "erros_validacao",
  "tentativas_envio",
  "ultima_tentativa_em",
  "criado_por",
  "criado_por_nome",
  "created_at",
  "updated_at",
  "id_empresa",
  "end_entrega",
  "cond_pgto",
  "forma_pgto",
  "drop_natureza_op",
  "id_transportadora_cliente",
  "pgto_is_configurado"
] as const;

export const NFE_SELECT = NFE_SELECT_COLUMNS.join(", ");

export type NfeReadResult = {
  source: "supabase" | "mock";
  nfeList: NfeReadModel[];
};

function buildMockResult(): NfeReadResult {
  return {
    source: "mock",
    nfeList: nfeMocks.map(item => ({ ...item }))
  };
}

async function fetchNfeRows(): Promise<SupabaseNfeRow[] | null> {
  const client = getSupabaseClient();
  if (!client) {
    console.log("[Nfe][Debug] Supabase client absent - falling back to mocks.");
    return null;
  }

  console.log("[Nfe] Performing select query on public.notas_fiscais.");
  const query = client
    .from("notas_fiscais")
    .select(NFE_SELECT)
    .order("created_at", { ascending: false })
    .limit(2000);

  const { data, error } = await query.returns<SupabaseNfeRow[]>();

  if (error || !data) {
    console.log("[Nfe][Supabase] Select query failed - falling back to mocks.", {
      error: error instanceof Error ? error.message : error,
      hasData: Boolean(data)
    });
    return null;
  }

  return data;
}

export async function getNfeReadOnlyList(): Promise<NfeReadResult> {
  try {
    const rows = await fetchNfeRows();
    if (!rows || rows.length === 0) {
      return buildMockResult();
    }

    const uniqueClientIds = Array.from(new Set(rows.map(r => r.id_cliente).filter(Boolean)));
    const clientMap: Record<number, { nome: string; fantasia: string }> = {};

    if (uniqueClientIds.length > 0) {
      try {
        const client = getSupabaseClient();
        if (client) {
          const { data: clientsData } = await client
            .from("clientes")
            .select("id_cliente, nome, fantasia")
            .in("id_cliente", uniqueClientIds);

          if (clientsData) {
            for (const c of clientsData) {
              clientMap[c.id_cliente] = {
                nome: c.nome || "",
                fantasia: c.fantasia || ""
              };
            }
          }
        }
      } catch (err) {
        console.warn("[NfeService] Failed to fetch client names/fantasias:", err);
      }
    }

    const nfeList = rows.map(row => {
      const model = mapSupabaseNfeRowToReadModel(row);
      const clientInfo = clientMap[row.id_cliente];
      if (clientInfo) {
        model.nome = clientInfo.nome;
        model.fantasia = clientInfo.fantasia;
      }
      return model;
    });

    console.log("[Nfe] Retrieved and mapped real data.", { count: nfeList.length });
    
    return {
      source: "supabase",
      nfeList
    };
  } catch (err) {
    console.log("[Nfe] Catch block error - falling back to mocks.", err);
    return buildMockResult();
  }
}

// ==========================================
// FASE 2: PERSISTÊNCIA E VALIDAÇÃO DE RASCUNHOS
// ==========================================

export async function getNfeById(id: string): Promise<SupabaseNfeRow | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from("notas_fiscais")
    .select("*")
    .eq("id", id)
    .single();
  if (error) {
    console.error("[NfeService] Error fetching note by id:", error);
    return null;
  }
  return data;
}

export async function getNfeItems(idNotaFiscal: string): Promise<SupabaseNfeItemRow[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from("notas_fiscais_itens")
    .select("*")
    .eq("id_nota_fiscal", idNotaFiscal)
    .order("numero_item", { ascending: true });
  if (error) {
    console.error("[NfeService] Error fetching items:", error);
    return [];
  }
  return data || [];
}

export async function getNfePagamentos(idNotaFiscal: string): Promise<SupabaseNfePagamentoRow[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from("notas_fiscais_pagamentos")
    .select("*")
    .eq("id_nota_fiscal", idNotaFiscal)
    .eq("ativo", true)
    .order("numero_parcela", { ascending: true });
  if (error) {
    console.error("[NfeService] Error fetching payments:", error);
    return [];
  }
  return data || [];
}

export async function getNfeValidationGeral(ref: string) {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from("vw_notas_fiscais_validacao_geral")
    .select("*")
    .eq("ref", ref)
    .maybeSingle();
  if (error) {
    console.error("[NfeService] Error fetching validation view data:", error);
    return null;
  }
  return data;
}

export async function prepararEnvioNfe(ref: string) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client absent");
  const { data, error } = await client.rpc("fn_preparar_envio_nfe", { p_ref: ref });
  if (error) throw error;
  return data;
}

export async function montarPayloadNfe(ref: string) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client absent");
  const { data, error } = await client.rpc("fn_montar_payload_nfe", { p_ref: ref });
  if (error) throw error;
  return data;
}

export async function getAlertasNfe(ref: string) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client absent");
  const { data, error } = await client.rpc("fn_alertas_nfe", { p_ref: ref });
  if (error) throw error;
  return data;
}

export async function createOrReuseNfeDraft(idInt: number): Promise<SupabaseNfeRow> {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client not initialized");

  // 1. Verificar se já existe rascunho PENDENTE
  const { data: existing } = await client
    .from("notas_fiscais")
    .select("*")
    .eq("id_int", idInt)
    .eq("status", "PENDENTE")
    .limit(1)
    .maybeSingle();

  if (existing) {
    console.log(`[NfeService] Reusing existing draft for id_int=${idInt}, ref=${existing.ref}`);
    return existing;
  }

  // 2. Carregar detalhes da proposta comercial
  const proposta = await getPropostaDetailById(idInt);
  if (!proposta) {
    throw new Error(`Proposta #${idInt} não encontrada para faturamento.`);
  }

  // 3. Determinar próximo sufixo incremental da referência
  const { data: siblingNotes } = await client
    .from("notas_fiscais")
    .select("ref")
    .eq("id_int", idInt);

  let nextSuffix = 1;
  if (siblingNotes && siblingNotes.length > 0) {
    siblingNotes.forEach(note => {
      const parts = note.ref.split("-");
      const suffix = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(suffix) && suffix >= nextSuffix) {
        nextSuffix = suffix + 1;
      }
    });
  }
  const ref = `NFE-${idInt}-${String(nextSuffix).padStart(3, "0")}`;

  // 4. Mapear empresa emitente
  let idEmpresa = 1;
  const empresaStr = proposta.empresa?.toUpperCase() || "";
  if (empresaStr.includes("BIRO") || empresaStr.includes("BIRÔ")) {
    idEmpresa = 2;
  } else if (empresaStr.includes("E3")) {
    idEmpresa = 3;
  }

  // 5. Determinar parametrização fiscal básica e CFOP
  const ufDest = proposta.enderecoEntrega?.uf?.toUpperCase() || proposta.cliente?.cidadeUf?.split("/")?.[1]?.trim()?.toUpperCase() || "RS";
  const isRS = ufDest === "RS";
  const cfopDefault = isRS ? "5101" : "6101";
  const naturezaDefault = isRS ? "VENDA DE PRODUCAO PROPRIA" : "VENDA DE PRODUCAO PROPRIA DEST. OUTRO ESTADO";

  const isCNPJ = (proposta.cliente?.documento || "").replace(/\D/g, "").length > 11;
  const consumidorFinal = isCNPJ ? 0 : 1;
  const tipoContribuinte = isCNPJ ? 1 : 9;

  const valorFrete = proposta.resumo?.frete || 0;
  const modalidadeFrete = valorFrete > 0 ? 0 : 9;

  let totalPeso = 0;
  if (proposta.itens) {
    proposta.itens.forEach(it => {
      totalPeso += it.pesoTotal || 0;
    });
  }

  const pgtoConfigurado = proposta.formaPagamento ? (proposta.formaPagamento !== "A combinar" && proposta.formaPagamento !== "") : false;
  const hasEndereco = proposta.enderecoEntrega ? true : false;
  const enderecoStr = proposta.enderecoEntrega ? JSON.stringify(proposta.enderecoEntrega) : null;

  const nfeInsert = {
    id_int: idInt,
    id_cliente: proposta.cliente?.idCliente || null,
    id_empresa: idEmpresa,
    ref,
    ambiente: "homologacao",
    modelo: "55",
    status: "PENDENTE",
    valor_produtos: proposta.resumo?.subtotalProdutos || 0,
    valor_desconto: proposta.resumo?.descontoGeral || 0,
    valor_frete: valorFrete,
    valor_total_nf: proposta.resumo?.valorTotal || 0,
    cond_pgto: pgtoConfigurado,
    forma_pgto: proposta.formaPagamento || "A Vista",
    end_entrega: hasEndereco,
    endereco_entrega_observacao: enderecoStr,
    natureza_operacao: naturezaDefault,
    tipo_documento: 1, // Saída
    finalidade_emissao: 1, // Normal
    consumidor_final: consumidorFinal,
    presenca_comprador: 2, // Internet
    tipo_contribuinte: tipoContribuinte,
    modalidade_frete: modalidadeFrete,
    quantidade_volumes: 1,
    especie_volumes: "CAIXA",
    peso_liquido: totalPeso / 1000,
    peso_bruto: totalPeso / 1000,
    pgto_is_configurado: pgtoConfigurado
  };

  console.log("[NfeService] Inserting new notas_fiscais draft:", JSON.stringify(nfeInsert, null, 2));

  const { data: newNfe, error: insertError } = await client
    .from("notas_fiscais")
    .insert(nfeInsert)
    .select("*")
    .single();

  if (insertError || !newNfe) {
    console.error("[NfeService] Error inserting notas_fiscais row:", insertError);
    throw new Error(`Falha ao salvar cabeçalho da nota fiscal: ${insertError?.message}`);
  }

  // 6. Inserir itens da nota
  if (proposta.itens && proposta.itens.length > 0) {
    const itemsInsert = proposta.itens.map((item, idx) => {
      const valorBruto = item.quantidade * item.valorUnitario;
      const pesoTotal = item.pesoTotal || 0;
      const pesoUnitario = item.pesoUnitario || 0;

      return {
        id_nota_fiscal: newNfe.id,
        ref: newNfe.ref,
        id_int: idInt,
        id_produtos_proposta: typeof item.id === "number" ? item.id : null,
        id_produto: item.id_produto,
        numero_item: idx + 1,
        codigo_produto: String(item.produto?.id_produto || item.id_produto),
        descricao: item.nome || "Item sem descrição",
        ncm: item.produto?.ncm || "49119900",
        cfop: cfopDefault,
        unidade_comercial: "UN",
        unidade_tributavel: "UN",
        quantidade: item.quantidade,
        valor_unitario: item.valorUnitario,
        valor_bruto: valorBruto,
        quantidade_tributavel: item.quantidade,
        valor_unitario_tributavel: item.valorUnitario,
        icms_origem: 0,
        icms_situacao_tributaria: "102",
        pis_situacao_tributaria: "99",
        cofins_situacao_tributaria: "99",
        ativo: true,
        peso_unitario_gramas: pesoUnitario,
        peso_total_gramas: pesoTotal
      };
    });

    const { error: itemsError } = await client
      .from("notas_fiscais_itens")
      .insert(itemsInsert);

    if (itemsError) {
      console.error("[NfeService] Error inserting items:", itemsError);
    }
  }

  // 7. Inserir pagamentos da nota
  const formaPgtoText = proposta.formaPagamento?.toUpperCase() || "";
  let formaPgtoFocus = "15"; // Boleto
  if (formaPgtoText.includes("PIX") || formaPgtoText.includes("TRANSFERENCIA") || formaPgtoText.includes("TED")) {
    formaPgtoFocus = "17"; // PIX
  } else if (formaPgtoText.includes("DINHEIRO")) {
    formaPgtoFocus = "01";
  } else if (formaPgtoText.includes("CARTAO") || formaPgtoText.includes("CRÉDITO") || formaPgtoText.includes("DEBITO")) {
    formaPgtoFocus = "03"; // Cartão
  }

  const paymentInsert = {
    id_int: idInt,
    ref: newNfe.ref,
    id_nota_fiscal: newNfe.id,
    numero_parcela: 1,
    total_parcelas: 1,
    data_vencimento: new Date().toISOString().split("T")[0],
    valor: newNfe.valor_total_nf,
    forma_pagamento: formaPgtoFocus,
    ativo: true
  };

  const { error: paymentError } = await client
    .from("notas_fiscais_pagamentos")
    .insert(paymentInsert);

  if (paymentError) {
    console.error("[NfeService] Error inserting payment row:", paymentError);
  }

  // 8. Recalcular totais no banco
  try {
    await client.rpc("fn_recalcular_totais_nfe", { p_ref: newNfe.ref });
  } catch (err) {
    console.warn("[NfeService] fn_recalcular_totais_nfe call failed:", err);
  }

  // 9. Buscar cópia atualizada
  const freshNote = await getNfeById(newNfe.id);
  return freshNote || newNfe;
}

export async function updateNfeDraft(
  id: string,
  updates: Partial<SupabaseNfeRow>,
  items: Partial<SupabaseNfeItemRow>[],
  pagamentos: Partial<SupabaseNfePagamentoRow>[]
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase client not initialized" };

  try {
    // 1. Atualizar cabeçalho
    if (Object.keys(updates).length > 0) {
      const { error: headerError } = await client
        .from("notas_fiscais")
        .update(updates)
        .eq("id", id);

      if (headerError) throw headerError;
    }

    // 2. Atualizar itens
    for (const it of items) {
      if (!it.id) continue;
      const itClone = { ...it };
      delete itClone.id;
      delete itClone.id_nota_fiscal;
      delete itClone.ref;
      delete itClone.id_int;

      const { error: itemError } = await client
        .from("notas_fiscais_itens")
        .update(itClone)
        .eq("id", it.id);

      if (itemError) throw itemError;
    }

    // 3. Atualizar pagamentos
    for (const pg of pagamentos) {
      if (!pg.id) continue;
      const pgClone = { ...pg };
      delete pgClone.id;
      delete pgClone.id_nota_fiscal;
      delete pgClone.ref;
      delete pgClone.id_int;

      const { error: pgError } = await client
        .from("notas_fiscais_pagamentos")
        .update(pgClone)
        .eq("id", pg.id);

      if (pgError) throw pgError;
    }

    // 4. Recalcular totais
    if (updates.ref) {
      try {
        await client.rpc("fn_recalcular_totais_nfe", { p_ref: updates.ref });
      } catch (err) {
        console.warn("[NfeService] recalcular totals failed:", err);
      }
    }

    return { success: true };
  } catch (err) {
    console.error("[NfeService] updateNfeDraft failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

interface SupabasePropostaSimple {
  id: string;
  id_int: number;
  id_cliente: number;
  cliente: string;
  valor: number;
  valor_total: number;
  vendedor: string;
  status_interno: string;
  empresa: string;
  created_at: string;
}

export async function getFaturaveisPropostas(): Promise<FaturavelOrigem[]> {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("[NfeService] Supabase client absent for getFaturaveisPropostas");
    return [];
  }

  try {
    const { data, error } = await client
      .from("propostas")
      .select("id,id_int,id_cliente,cliente,valor,valor_total,vendedor,status_interno,empresa,created_at")
      .eq("status_interno", "APROVADO")
      .order("id_int", { ascending: false });

    if (error) {
      console.error("[NfeService] Error fetching faturaveis propostas:", error);
      return [];
    }

    if (!data) return [];

    return (data as SupabasePropostaSimple[]).map((row) => {
      let idEmpresa = 1;
      const empresaStr = (row.empresa || "").toUpperCase();
      if (empresaStr.includes("BIRO") || empresaStr.includes("BIRÔ")) {
        idEmpresa = 2;
      } else if (empresaStr.includes("E3")) {
        idEmpresa = 3;
      }

      const valorTotal = Number(row.valor_total) || Number(row.valor) || 0;

      return {
        id: `prop-${row.id}`,
        tipo: "PEDIDO",
        ref_origem: `#${row.id_int}`,
        id_cliente: Number(row.id_cliente),
        cliente_nome: String(row.cliente || "").trim(),
        cliente_fantasia: String(row.cliente || "").trim(),
        id_empresa: idEmpresa,
        status: "PENDENTE",
        valor_total: valorTotal,
        itens: [],
        created_at: row.created_at || new Date().toISOString()
      };
    });
  } catch (err) {
    console.error("[NfeService] Exception in getFaturaveisPropostas:", err);
    return [];
  }
}

export async function trocarEmpresaNfe(
  ref: string,
  idEmpresa: number,
  usuario: string
): Promise<{ ok: boolean; mensagem?: string; error?: string }> {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client not initialized");
  const { data, error } = await client.rpc("fn_trocar_empresa_nfe", {
    p_ref: ref,
    p_id_empresa: idEmpresa,
    p_usuario: usuario
  });
  if (error) throw error;
  return data;
}

export async function gerarPagamentosNfe(
  ref: string,
  valorEntrada: number,
  qtdParcelas: number,
  diasPraInicio: number,
  intervalo: number,
  formaPagamento: string
): Promise<{ ok: boolean; mensagem?: string; error?: string }> {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client not initialized");
  const { data, error } = await client.rpc("fn_gerar_pagamentos_nfe", {
    p_ref: ref,
    p_valor_entrada: valorEntrada,
    p_qtd_parcelas: qtdParcelas,
    p_dias_pra_inicio: diasPraInicio,
    p_intervalo: intervalo,
    p_forma_pagamento: formaPagamento
  });
  if (error) throw error;
  return data;
}

export async function getTransportadoras() {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from("clientes")
    .select("id_cliente, nome, fantasia, documento, cidade_uf")
    .eq("categoria", "TRANSPORTADORA")
    .eq("ativo", true);
  if (error) {
    console.error("[NfeService] Error fetching transportadoras:", error);
    return [];
  }
  return data || [];
}

export async function insertNfeItem(
  item: Omit<SupabaseNfeItemRow, "id" | "editado_manualmente">
): Promise<SupabaseNfeItemRow | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from("notas_fiscais_itens")
    .insert({
      ...item,
      ativo: true
    })
    .select("*")
    .single();
  if (error) {
    console.error("[NfeService] Error inserting item:", error);
    return null;
  }
  return data;
}

export async function deleteNfeItem(id: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;
  const { error } = await client
    .from("notas_fiscais_itens")
    .delete()
    .eq("id", id);
  if (error) {
    console.error("[NfeService] Error deleting item:", error);
    return false;
  }
  return true;
}

export async function recalcularTotaisNfe(ref: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;
  const { error } = await client.rpc("fn_recalcular_totais_nfe", { p_ref: ref });
  if (error) {
    console.error("[NfeService] Error calling fn_recalcular_totais_nfe:", error);
    return false;
  }
  return true;
}

export interface SimpleProduct {
  id_produto: number;
  nomeReal: string;
  ncm: string | null;
  und_medida: string | null;
  unidade_comercial: string | null;
  valorUnt: number | null;
  peso: number | null;
  ativo: boolean;
}

export async function searchActiveProducts(): Promise<SimpleProduct[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from("produtos")
    .select("id_produto, nomeReal, ncm, und_medida, unidade_comercial, valorUnt, peso, ativo")
    .eq("ativo", true)
    .order("id_produto", { ascending: true });
  if (error) {
    console.error("[NfeService] Error searching active products:", error);
    return [];
  }
  return data || [];
}

export async function updateNfeItem(
  itemId: string,
  ref: string,
  itemUpdates: Partial<SupabaseNfeItemRow>
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase client not initialized" };

  try {
    const { error } = await client
      .from("notas_fiscais_itens")
      .update(itemUpdates)
      .eq("id", itemId);

    if (error) throw error;

    // Recalcular totais no banco
    await recalcularTotaisNfe(ref);
    return { success: true };
  } catch (err) {
    console.error("[NfeService] updateNfeItem failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function recreateSinglePayment(
  idNotaFiscal: string,
  ref: string,
  idInt: number,
  valorTotal: number,
  formaPagamento: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase client not initialized" };

  try {
    // 1. Soft-delete (set ativo = false) existing payments for the note
    const { error: updateError } = await client
      .from("notas_fiscais_pagamentos")
      .update({ ativo: false })
      .eq("id_nota_fiscal", idNotaFiscal);

    if (updateError) throw updateError;

    // 2. Insert new single à vista payment
    const paymentInsert = {
      id_int: idInt,
      ref: ref,
      id_nota_fiscal: idNotaFiscal,
      numero_parcela: 1,
      total_parcelas: 1,
      data_vencimento: new Date().toISOString().split("T")[0],
      valor: valorTotal,
      forma_pagamento: formaPagamento,
      ativo: true
    };

    const { error: insertError } = await client
      .from("notas_fiscais_pagamentos")
      .insert(paymentInsert);

    if (insertError) throw insertError;

    return { success: true };
  } catch (err) {
    console.error("[NfeService] recreateSinglePayment failed:", err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function previewNfeRascunho(ref: string): Promise<{ success: boolean; url?: string; blob?: Blob; error?: string }> {
  try {
    const response = await fetch("/api/nfe/preview", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ref })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { success: false, error: errorData.error || `Erro HTTP: ${response.status}` };
    }

    const data = await response.json();
    if (data && (data.url_pdf || data.url || data.ok)) {
      return { success: true, url: data.url_pdf || data.url };
    } else {
      return { success: false, error: data.mensagem || data.error || "A resposta da função não conteve uma URL de preview." };
    }
  } catch (err) {
    console.error("[NfeService] previewNfeRascunho proxy failed:", err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function invalidateNfePayments(idNotaFiscal: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;
  
  try {
    const { error } = await client
      .from("notas_fiscais_pagamentos")
      .update({ ativo: false })
      .eq("id_nota_fiscal", idNotaFiscal);
      
    if (error) {
      console.error("[NfeService] Invalidate payments failed:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[NfeService] Invalidate payments failed:", err);
    return false;
  }
}

export async function getNfeFinanceiroStatus(refs: string[]) {
  const client = getSupabaseClient();
  if (!client || refs.length === 0) {
    return { paymentsCountMap: {}, boletosMap: {} };
  }

  try {
    // Buscar contagem de vencimentos ativos por ref
    const { data: paymentsData, error: paymentsError } = await client
      .from("notas_fiscais_pagamentos")
      .select("ref, id")
      .in("ref", refs)
      .eq("ativo", true);

    if (paymentsError) {
      console.error("[NfeService] Error fetching payments count:", paymentsError);
    }

    // Buscar boletos correspondentes com todos os campos necessários para a revisão
    const { data: boletosData, error: boletosError } = await client
      .from("boletos")
      .select("id, id_int, ext_reference, valor, parcela, total_parcelas, vencimento, status, deposito_conta, id_boleto_c6, nosso_numero, linha_digitavel, multa, juros_dia, descricao, nome_cliente, documento, id_cliente, id_empresa, n_nf, is_faturado")
      .in("ext_reference", refs);

    if (boletosError) {
      console.error("[NfeService] Error fetching boletos:", boletosError);
    }

    const paymentsCountMap: Record<string, number> = {};
    paymentsData?.forEach((p) => {
      if (p.ref) {
        paymentsCountMap[p.ref] = (paymentsCountMap[p.ref] || 0) + 1;
      }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const boletosMap: Record<string, any[]> = {};
    boletosData?.forEach((b) => {
      const ref = b.ext_reference as string;
      if (ref) {
        if (!boletosMap[ref]) {
          boletosMap[ref] = [];
        }
        boletosMap[ref].push(b);
      }
    });

    return { paymentsCountMap, boletosMap };
  } catch (err) {
    console.error("[NfeService] getNfeFinanceiroStatus failed:", err);
    return { paymentsCountMap: {}, boletosMap: {} };
  }
}

export async function launchBoletosForNfe(
  nfe: SupabaseNfeRow | NfeReadModel,
  pagamentos: SupabaseNfePagamentoRow[],
  clienteNome: string,
  clienteDocumento: string
) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client not initialized");

  const records = pagamentos.map((pg) => {
    return {
      id_int: nfe.id_int,
      parcela: pg.numero_parcela,
      total_parcelas: pg.total_parcelas,
      valor: pg.valor,
      vencimento: pg.data_vencimento,
      status: "A_VENCER",
      nome_cliente: clienteNome || null,
      documento: clienteDocumento || null,
      id_cliente: nfe.id_cliente,
      id_empresa: nfe.id_empresa,
      n_nf: nfe.numero_nf ? String(nfe.numero_nf) : null,
      ext_reference: nfe.ref,
      descricao: `Vencimento fiscal ${pg.numero_parcela}/${pg.total_parcelas} - Ref: ${nfe.ref}`,
      is_faturado: true,
      id_pagamento: null // Sempre nulo neste fluxo, conforme ressalva obrigatória
    };
  });

  const { data, error } = await client.from("boletos").insert(records);
  if (error) throw error;
  return data;
}

export async function updateBoletoInDb(
  id: string,
  updates: {
    vencimento?: string;
    valor?: number;
    descricao?: string;
    deposito_conta?: boolean;
    multa?: number | null;
    juros_dia?: number | null;
  }
) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client not initialized");

  // Whitelist rígida dos campos editáveis para impedir alterações acidentais de campos bancários
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cleanUpdates: Record<string, any> = {};
  const allowed = ["vencimento", "valor", "descricao", "deposito_conta", "multa", "juros_dia"];
  for (const key of allowed) {
    if (key in updates) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cleanUpdates[key] = (updates as any)[key];
    }
  }

  const { data, error } = await client
    .from("boletos")
    .update(cleanUpdates)
    .eq("id", id)
    .select("*");

  if (error) throw error;
  return data;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export async function registerBoletoViaN8n(boleto: SupabaseBoletoRow) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client not initialized");

  // 1. Fetch Client email and details
  let email = "";
  if (boleto.id_cliente) {
    const { data: cliData } = await client
      .from("clientes")
      .select("email, email_financeiro, email_contato")
      .eq("id_cliente", boleto.id_cliente)
      .maybeSingle();

    if (cliData) {
      email = (String(cliData.email_financeiro || cliData.email || cliData.email_contato || "")).trim();
    }
  }

  // Fallback de E-mail do ERP
  if (!email || !isValidEmail(email)) {
    if (boleto.id_empresa === 1) {
      email = "financeiro@ingressoideal.com.br";
    } else if (boleto.id_empresa === 3) {
      email = "financeiro@e3brindes.com.br";
    } else {
      email = "financeiro@pay-ideal.com.br";
    }
  }

  // Validação do email
  if (!email || !isValidEmail(email)) {
    throw new Error("O e-mail do cliente é inválido e nenhum e-mail de fallback pôde ser determinado.");
  }

  // 2. Fetch Client address
  let address = {
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: "",
    cep: ""
  };

  if (boleto.id_cliente) {
    // Try principal first
    let { data: addrData } = await client
      .from("enderecos")
      .select("endereco, numero, complemento, bairro, cidade, uf, cep")
      .eq("id_cliente", boleto.id_cliente)
      .eq("tipo_endereco", "Principal")
      .maybeSingle();

    if (!addrData) {
      // Fallback to any address
      const { data: fallbackAddr } = await client
        .from("enderecos")
        .select("endereco, numero, complemento, bairro, cidade, uf, cep")
        .eq("id_cliente", boleto.id_cliente)
        .limit(1);

      if (fallbackAddr && fallbackAddr.length > 0) {
        addrData = fallbackAddr[0];
      }
    }

    if (addrData) {
      address = {
        logradouro: addrData.endereco || "",
        numero: addrData.numero || "",
        complemento: addrData.complemento || "",
        bairro: addrData.bairro || "",
        cidade: addrData.cidade || "",
        uf: addrData.uf || "",
        cep: addrData.cep ? String(addrData.cep).replace(/\D/g, "") : ""
      };
    }
  }

  // Validação dos campos obrigatórios de endereço
  if (!address.logradouro) {
    throw new Error("Logradouro do cliente está pendente.");
  }
  if (!address.numero) {
    throw new Error("Número do endereço do cliente está pendente.");
  }
  if (!address.cidade) {
    throw new Error("Cidade do cliente está pendente.");
  }
  if (!address.uf) {
    throw new Error("UF do cliente está pendente.");
  }
  if (!address.cep) {
    throw new Error("CEP do cliente está pendente.");
  }
  if (address.cep.length !== 8) {
    throw new Error("CEP do cliente é inválido (deve conter exatamente 8 dígitos).");
  }

  // 3. Prepare payload
  if (!boleto.documento) {
    throw new Error("Documento do cliente está pendente.");
  }
  const documentoDigits = String(boleto.documento).replace(/\D/g, "");
  if (!documentoDigits) {
    throw new Error("Documento do cliente é inválido ou vazio (deve conter apenas dígitos).");
  }
  if (documentoDigits.length !== 11 && documentoDigits.length !== 14) {
    throw new Error("Documento do cliente é inválido (deve conter 11 dígitos para CPF ou 14 dígitos para CNPJ).");
  }

  const n_nfStr = boleto.n_nf ? String(boleto.n_nf) : "";
  const extReference = boleto.ext_reference || "";

  const payload = {
    boleto_id: boleto.id,
    ext_reference: extReference,
    id_empresa: boleto.id_empresa ? Number(boleto.id_empresa) : 0,
    id_cliente: boleto.id_cliente ? Number(boleto.id_cliente) : 0,
    id_int: boleto.id_int ? Number(boleto.id_int) : 0,
    n_nf: n_nfStr,
    parcela: boleto.parcela ? Number(boleto.parcela) : 1,
    total_parcelas: boleto.total_parcelas ? Number(boleto.total_parcelas) : 1,
    valor: boleto.valor ? Number(boleto.valor) : 0,
    vencimento: boleto.vencimento ? String(boleto.vencimento).slice(0, 10) : "",
    nome_cliente: boleto.nome_cliente || "",
    documento: documentoDigits,
    email: email,
    endereco: address,
    multa_percentual: boleto.multa ? Number(boleto.multa) : 0,
    juros_dia_percentual: boleto.juros_dia ? Number(boleto.juros_dia) : 0,
    instrucoes: [
      `Parcela ${boleto.parcela || 1}/${boleto.total_parcelas || 1} - NF ${n_nfStr || "S/N"} - Ref ${extReference}`
    ]
  };

  // 4. Send request
  const response = await fetch("https://10074.hostoo.net.br/webhook/boletos-vibe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Erro no processamento do registro do boleto: ${response.statusText}`);
  }

  // Check response
  let resData;
  try {
    resData = await response.json();
  } catch {
    throw new Error("A resposta do servidor não é um JSON válido.");
  }

  if (!resData) {
    throw new Error("Resposta do banco vazia ou inválida.");
  }

  if (resData.error || resData.message || resData.status === "error" || resData.success === false) {
    throw new Error(resData.error || resData.message || "Erro retornado pelo webhook.");
  }

  return { success: true, data: resData };
}

export async function deleteBoletoFromBankViaN8n(boletoId: string, idBoletoC6: string, idEmpresa: number) {
  const response = await fetch("https://10074.hostoo.net.br/webhook/del-boleto-vibe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      boleto_id: boletoId,
      cod_C6: idBoletoC6,
      id_empresa: idEmpresa
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Erro no processamento da exclusão do boleto: ${response.statusText}`);
  }

  let resData;
  try {
    resData = await response.json();
  } catch {
    throw new Error("A resposta do servidor não é um JSON válido.");
  }

  if (!resData) {
    throw new Error("Resposta do banco vazia ou inválida.");
  }

  if (resData.error || resData.message || resData.status === "error" || resData.success === false) {
    throw new Error(resData.error || resData.message || "Erro retornado pelo webhook.");
  }

  return { success: true, data: resData };
}



