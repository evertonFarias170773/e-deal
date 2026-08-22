import { getSupabaseClient } from "@/lib/supabase/client";
import { nfeMocks } from "@/lib/mocks/nfe.mock";
import { mapSupabaseNfeRowToReadModel } from "../mappers";
import type { SupabaseNfeRow, NfeReadModel, SupabaseNfeItemRow, SupabaseNfePagamentoRow } from "../types";
import type { SupabaseBoletoRow } from "@/features/contas-a-receber/types.supabase";
import { getPropostaDetailById } from "@/features/orcamentos/services/orcamentos.service";
import { PROPOSTA_STATUS_GROUP_NFE_ELIGIBLE } from "@/features/orcamentos/constants";
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

/**
 * Empresa emitente a partir do texto gravado na proposta.
 * Exportada para a conferência do Faturar julgar exatamente a mesma empresa que
 * o rascunho vai gravar — se as duas divergirem, a conferência mente.
 */
export function resolverEmpresaEmitente(empresaTexto: string | null | undefined): number {
  const texto = (empresaTexto || "").toUpperCase();
  if (texto.includes("BIRO") || texto.includes("BIRÔ")) return 2;
  if (texto.includes("E3")) return 3;
  return 1;
}

/**
 * Código fiscal da forma de pagamento, a partir de `pagamentos_v2.tipo_cobranca`.
 *
 * POR QUE EXISTE
 *   O rascunho lia `propostas.forma_pagamento` — coluna que NÃO existe. O valor
 *   vinha sempre indefinido, virava "A combinar" e caía no default 15 (boleto).
 *   Era por isso que nota de PIX nascia como boleto.
 *
 * A ORDEM IMPORTA
 *   `E-CREDITO` contém "CREDITO", mas é uso de crédito do cliente, não cartão.
 *   Por isso os valores conhecidos são decididos primeiro, e só o que sobra cai
 *   na busca por palavra.
 *
 * SEM CAIXA
 *   `E-Faturado` e `E-FATURADO` convivem na base (173 e 104 registros). A
 *   comparação normaliza; os registros ficam como estão.
 */
export function codigoFiscalDaCobranca(tipoCobranca: string | null | undefined): string {
  const texto = String(tipoCobranca ?? "").trim().toUpperCase();
  if (!texto) return "15";

  // Valores conhecidos de pagamentos_v2.tipo_cobranca, decididos por igualdade.
  const CONHECIDOS: Record<string, string> = {
    PIX: "17",
    BOLETO: "15",
    CARD_PARCELADO: "03",
    CREDIT_CARD: "03",
    "E-FATURADO": "15",
    "E-CREDITO": "15"
  };
  if (CONHECIDOS[texto]) return CONHECIDOS[texto];

  if (texto.includes("PIX") || texto.includes("TRANSFERENCIA") || texto.includes("TED")) return "17";
  if (texto.includes("DINHEIRO")) return "01";
  if (
    texto.includes("CARTAO") ||
    texto.includes("CARTÃO") ||
    texto.includes("CARD") ||
    texto.includes("CREDITO") ||
    texto.includes("CRÉDITO") ||
    texto.includes("DEBITO") ||
    texto.includes("DÉBITO")
  ) {
    return "03";
  }
  return "15";
}

/** Modalidade do frete da NF-e a partir da modalidade declarada na proposta. */
export function codigoModalidadeFrete(
  modalidadeProposta: string | null | undefined,
  valorFrete: number
): number {
  const texto = String(modalidadeProposta ?? "").trim().toUpperCase();
  if (texto === "CIF") return 0; // por conta do emitente
  if (texto === "FOB") return 1; // por conta do destinatário
  if (texto === "RETIRA") return 9; // sem ocorrência de transporte
  // Sem modalidade declarada: mantém o comportamento antigo, derivado do valor.
  // A conferência do Faturar avisa quando há frete e não há modalidade.
  return valorFrete > 0 ? 0 : 9;
}

/**
 * Forma de cobrança negociada de um pedido, lida de pagamentos_v2.
 * Quando há mais de uma cobrança, vale a mais recente — hoje nenhum pedido da
 * fila tem formas divergentes, mas a regra precisa ser determinística.
 */
export async function getTipoCobrancaDoPedido(idInt: number): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from("pagamentos_v2")
    .select("tipo_cobranca, created_at")
    .eq("id_int", idInt)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[NfeService] Nao foi possivel ler a cobranca do pedido:", error.message);
    return null;
  }
  const tipo = String((data as { tipo_cobranca?: string } | null)?.tipo_cobranca ?? "").trim();
  return tipo || null;
}

/** `entrega`, `ENTREGA`, `Entrega` — a base guarda as três. */
export function ehEnderecoDeEntrega(tipoEndereco: string | null | undefined): boolean {
  return String(tipoEndereco ?? "").trim().toLowerCase().startsWith("entrega");
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
  const idEmpresa = resolverEmpresaEmitente(proposta.empresa);

  // 4b. O que a origem diz sobre cobrança e endereço de entrega.
  //     A cobrança vem de pagamentos_v2 — `propostas` não tem forma de pagamento.
  //     O endereço de entrega só é "de entrega" quando `id_endereco_ent` aponta
  //     para um endereço marcado como tal; caso contrário a nota usa o principal.
  const tipoCobranca = await getTipoCobrancaDoPedido(idInt);

  let entregaEmEnderecoProprio = false;
  const { data: propostaEndereco } = await client
    .from("propostas")
    .select("id_endereco_ent")
    .eq("id_int", idInt)
    .maybeSingle();

  const idEnderecoEnt = String(
    (propostaEndereco as { id_endereco_ent?: string | null } | null)?.id_endereco_ent ?? ""
  ).trim();

  if (idEnderecoEnt) {
    const { data: enderecoRow } = await client
      .from("enderecos")
      .select("tipo_endereco")
      .eq("id", idEnderecoEnt)
      .maybeSingle();
    entregaEmEnderecoProprio = ehEnderecoDeEntrega(
      (enderecoRow as { tipo_endereco?: string | null } | null)?.tipo_endereco
    );
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
  const modalidadeFrete = codigoModalidadeFrete(proposta.modalidadeFrete, valorFrete);

  let totalPeso = 0;
  if (proposta.itens) {
    proposta.itens.forEach(it => {
      totalPeso += it.pesoTotal || 0;
    });
  }

  const pgtoConfigurado = Boolean(tipoCobranca);
  // A nota usa o endereço principal por padrão. O bloco de entrega só entra
  // quando a proposta aponta um endereço marcado como de entrega — antes disso
  // `end_entrega` era sempre true, porque a resolução nunca devolve vazio.
  const hasEndereco = entregaEmEnderecoProprio && Boolean(proposta.enderecoEntrega);
  const enderecoStr = hasEndereco ? JSON.stringify(proposta.enderecoEntrega) : null;

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
    forma_pgto: tipoCobranca || "A Vista",
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
  const formaPgtoFocus = codigoFiscalDaCobranca(tipoCobranca);

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
  libera_nf?: boolean | null;
}

/**
 * Status de nota que NÃO tiram a proposta da fila de faturamento.
 * `RASCUNHO` acompanha `PENDENTE` porque é o mesmo estágio — é assim que
 * `getNfeActions` já os trata na tela.
 */
const STATUS_QUE_NAO_TIRAM_DA_FILA = ["CANCELADA", "DENEGADA", "PENDENTE", "RASCUNHO"];

export async function getFaturaveisPropostas(): Promise<FaturavelOrigem[]> {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("[NfeService] Supabase client absent for getFaturaveisPropostas");
    return [];
  }

  try {
    const { data, error } = await client
      .from("propostas")
      .select("id,id_int,id_cliente,cliente,valor,valor_total,vendedor,status_interno,empresa,created_at,libera_nf")
      .eq("libera_nf", true)
      .order("id_int", { ascending: false });

    if (error) {
      console.error("[NfeService] Error fetching faturaveis propostas:", error);
      return [];
    }

    if (!data) return [];

    const propostas = data as SupabasePropostaSimple[];

    // Quantas notas cada proposta já tem ADIANTE do rascunho. Não contam:
    //   - CANCELADA e DENEGADA, porque a proposta volta a ser faturável quando
    //     a nota morre;
    //   - PENDENTE e RASCUNHO, porque rascunho aberto é trabalho não terminado,
    //     e a fila é a lista de trabalho do Financeiro.
    // Serve para a fila esconder, por padrão, o que já saiu das mãos de quem
    // fatura — sem apagar o caminho, porque faturamento parcial é legítimo
    // (a 15720 tem 5 autorizadas).
    const idsInt = Array.from(
      new Set(propostas.map((row) => Number(row.id_int)).filter((id) => Number.isFinite(id) && id > 0))
    );

    // A forma de cobrança negociada de cada pedido, para a fila mostrar o que é
    // faturado sem abrir nada. Uma consulta para toda a fila — a paginação não
    // muda, porque a lista continua vindo inteira de `propostas`.
    const cobrancaPorProposta = new Map<number, string>();
    if (idsInt.length > 0) {
      const { data: cobrancas, error: cobrancasError } = await client
        .from("pagamentos_v2")
        .select("id_int,tipo_cobranca,created_at")
        .in("id_int", idsInt)
        .order("created_at", { ascending: true });

      if (cobrancasError) {
        console.warn("[NfeService] Nao foi possivel ler as cobrancas da fila:", cobrancasError.message);
      } else {
        // Ordem crescente: a última escrita vence, que é a cobrança mais recente.
        (cobrancas ?? []).forEach((linha: { id_int: number | null; tipo_cobranca: string | null }) => {
          const idInt = Number(linha.id_int);
          const tipo = String(linha.tipo_cobranca ?? "").trim();
          if (!Number.isFinite(idInt) || !tipo) return;
          cobrancaPorProposta.set(idInt, tipo);
        });
      }
    }

    const notasVivasPorProposta = new Map<number, number>();
    if (idsInt.length > 0) {
      const { data: notas, error: notasError } = await client
        .from("notas_fiscais")
        .select("id_int,status")
        .in("id_int", idsInt);

      if (notasError) {
        // Sem a contagem, a fila mostra tudo — o estado de hoje. Errar exibindo
        // demais é melhor do que esconder um pedido que ainda precisa de nota.
        console.warn("[NfeService] Nao foi possivel contar notas por proposta:", notasError.message);
      } else {
        (notas ?? []).forEach((nota: { id_int: number | null; status: string | null }) => {
          const status = String(nota.status ?? "").toUpperCase();
          if (STATUS_QUE_NAO_TIRAM_DA_FILA.includes(status)) return;
          const idInt = Number(nota.id_int);
          if (!Number.isFinite(idInt)) return;
          notasVivasPorProposta.set(idInt, (notasVivasPorProposta.get(idInt) ?? 0) + 1);
        });
      }
    }

    return propostas.map((row) => {
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
        created_at: row.created_at || new Date().toISOString(),
        notas_vivas: notasVivasPorProposta.get(Number(row.id_int)) ?? 0,
        tipo_cobranca: cobrancaPorProposta.get(Number(row.id_int))
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
      // Encargos sempre explícitos: omitir estas colunas fazia o título herdar o
      // DEFAULT antigo da tabela (multa 2% / mora 0,033% ao dia) e acumular
      // encargo no vencimento, sem ninguém ter pedido.
      multa: 0,
      juros_dia: 0,
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

/**
 * Chama uma rota server-side de título faturado. O servidor relê `id_empresa`
 * no banco e decide o provedor — o cliente não escolhe.
 *
 * `delegarLegado: true` significa empresa 1 ou 3: o chamador segue no fluxo
 * antigo, sem nenhuma alteração de comportamento.
 */
async function chamarRotaBoletoFaturado(rota: string, corpo: Record<string, unknown>) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client not initialized");

  const sessao = await client.auth.getSession();
  const token = sessao.data.session?.access_token || "";

  const resposta = await fetch(rota, {
    method: "POST",
    headers: { "content-type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify(corpo)
  });

  const resultado = await resposta.json().catch(() => null);

  if (!resposta.ok || !resultado?.success) {
    throw new Error(resultado?.message || "Falha na operação bancária do título faturado.");
  }

  return resultado as { success: true; delegarLegado?: boolean; data?: Record<string, unknown> };
}

export async function registerBoletoViaN8n(boleto: SupabaseBoletoRow, overrideEmail?: string) {
  // Roteamento por empresa, decidido no servidor com o id_empresa do banco.
  // Empresa 2 (Ideal Birô) emite pelo Inter e retorna aqui; 1 e 3 caem no
  // `delegarLegado` e seguem exatamente o fluxo abaixo, inalterado.
  const roteamento = await chamarRotaBoletoFaturado("/api/cobrancas/registrar-boleto-faturado", {
    boletoId: boleto.id,
    overrideEmail
  });

  if (!roteamento.delegarLegado) {
    return { success: true, data: roteamento.data || {} };
  }

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

  // Fallback de E-mail do ERP se override não foi passado
  if (!email || !isValidEmail(email)) {
    if (overrideEmail && isValidEmail(overrideEmail)) {
      email = overrideEmail;
    } else {
      if (boleto.id_empresa === 1) {
        email = "financeiro@ingressoideal.com.br";
      } else if (boleto.id_empresa === 3) {
        email = "financeiro@e3brindes.com.br";
      } else {
        email = "financeiro@pay-ideal.com.br";
      }
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
    throw new Error(
      mensagemDoRetornoBancario(resData.error ?? resData.message, "Erro retornado pelo webhook.")
    );
  }

  return { success: true, data: resData };
}

/**
 * Mensagem legível a partir do que o webhook devolveu.
 *
 * O n8n responde ora `{ message }`, ora o objeto de erro cru do banco
 * (`{ error: { message } }`). No segundo caso `new Error(objeto)` vira
 * "[object Object]" na tela — foi o que o usuário viu quando o C6 recusou o
 * cancelamento do título 323976692 por situação do título: erro na tela, sem
 * uma palavra sobre o motivo.
 *
 * Os bancos ainda embutem o motivo real num JSON escapado dentro da própria
 * mensagem (`400 - "{...\"detail\":\"...\"}"`), então o `detail` é extraído
 * quando existe.
 */
function mensagemDoRetornoBancario(valor: unknown, padrao: string): string {
  if (typeof valor === "string" && valor.trim()) return valor.trim();

  if (valor && typeof valor === "object") {
    const obj = valor as { message?: unknown; detail?: unknown; description?: unknown };
    const texto = String(obj.detail ?? obj.message ?? obj.description ?? "").trim();
    if (texto) {
      const limpo = texto.split("\\").join("");
      const detalhe = limpo.match(/"detail"\s*:\s*"([^"]+)"/);
      const titulo = limpo.match(/"title"\s*:\s*"([^"]+)"/);
      return String(detalhe?.[1] ?? titulo?.[1] ?? texto).trim().slice(0, 400);
    }
  }

  return padrao;
}

export async function deleteBoletoFromBankViaN8n(
  boletoId: string,
  idBoletoC6: string,
  idEmpresa: number,
  motivo?: string
) {
  // Mesmo roteamento server-side do registro. O `idEmpresa` recebido aqui é
  // apenas informativo: quem decide é o servidor, relendo do banco.
  const roteamento = await chamarRotaBoletoFaturado("/api/cobrancas/cancelar-boleto-faturado", {
    boletoId,
    motivo: String(motivo || "").trim() || "Cancelamento solicitado no Registro de Recebiveis."
  });

  if (!roteamento.delegarLegado) {
    return { success: true, data: roteamento as Record<string, unknown> };
  }

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
    let legivel = "";
    try {
      legivel = mensagemDoRetornoBancario(JSON.parse(errorText), "");
    } catch {
      legivel = "";
    }
    return await resolverRecusaDoBanco(
      legivel || errorText || `Erro no processamento da exclusão do boleto: ${response.statusText}`,
      idBoletoC6,
      Number(idEmpresa) || 1
    );
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
    return await resolverRecusaDoBanco(
      mensagemDoRetornoBancario(resData.error ?? resData.message, "Erro retornado pelo webhook."),
      idBoletoC6,
      Number(idEmpresa) || 1
    );
  }

  return { success: true, data: resData };
}

/**
 * O C6 dá baixa automática no boleto alguns dias depois do vencimento. A partir
 * daí ele recusa o cancelamento — não existe mais título ativo para cancelar.
 *
 * Isso NÃO é falha: o objetivo, tirar o boleto de circulação, já está cumprido.
 * Tratar como erro deixava o financeiro sem saída no caso mais comum (cliente
 * não paga no vencimento e depois quer pagar por PIX) e obrigava a corrigir o
 * banco de dados na mão.
 *
 * A recusa só é aceita como "já inativo" depois de confirmar no C6 que NÃO há
 * pagamento. Se o cliente pagou o boleto, registrar outro recebimento contaria o
 * mesmo dinheiro duas vezes — aí o erro continua de pé. Falha ao consultar
 * também mantém o erro: sem confirmação, o lado seguro é não seguir.
 *
 * O reconhecimento depende do texto do banco porque o `GET /v1/bank_slips` não
 * distingue ativo de baixado — medido em produção: 689 consultas devolveram
 * apenas `CREATED` e `PAID`. Recusa fora do padrão é registrada em log, para uma
 * mudança de redação do C6 aparecer em vez de voltar a travar em silêncio.
 */
function ehRecusaPorTituloInativo(motivo: string): boolean {
  // O C6 manda a recusa sem acentos ("Titulo esta em situacao que nao permite"),
  // entao basta comparar em minusculas — sem normalizacao, sem classe de
  // caracteres combinantes. A variante acentuada entra ao lado por seguranca,
  // caso o banco reescreva a mensagem.
  const texto = motivo.toLowerCase();
  return (
    texto.includes("situacao que nao permite") ||
    texto.includes("situação que não permite")
  );
}

async function resolverRecusaDoBanco(motivo: string, idBoletoC6: string, idEmpresa: number) {
  if (!ehRecusaPorTituloInativo(motivo)) {
    throw new Error(motivo);
  }

  let status = "";
  let temPagamento = false;
  try {
    const { consultarDetalhesBoletoC6 } = await import("@/features/cobrancas/services/pagamentos-v2.service");
    const detalhes = await consultarDetalhesBoletoC6(idBoletoC6, idEmpresa);
    status = String(detalhes?.status ?? "").toUpperCase();
    temPagamento = Array.isArray(detalhes?.payments) && detalhes.payments.length > 0;
  } catch (erroConsulta) {
    console.error("[deleteBoletoFromBankViaN8n] Falha ao confirmar a situacao no C6:", erroConsulta);
    throw new Error(
      `${motivo} Não foi possível confirmar no banco se o título já foi pago, então nada foi alterado.`
    );
  }

  if (status === "PAID" || temPagamento) {
    throw new Error(
      "O banco informa este boleto como PAGO. Não é possível cancelar nem registrar outro recebimento — " +
        "use 'Consultar pagamento C6' para liquidar com a data oficial do banco."
    );
  }

  console.warn(
    `[deleteBoletoFromBankViaN8n] ${idBoletoC6}: o C6 ja havia baixado o titulo e nao ha pagamento; seguindo sem cancelamento.`
  );
  return { success: true, jaInativoNoBanco: true, data: { motivo } };
}

export function getNfeDisplayStatus(note: {
  status?: string | null;
  erro_codigo?: string | null;
  status_focus?: string | null;
  status_sefaz?: string | null;
}) {
  if (
    (note.status || "").toUpperCase() === "RETORNO_FOCUS" &&
    note.erro_codigo &&
    !note.status_focus &&
    !note.status_sefaz
  ) {
    return "FALHA_INTEGRACAO";
  }
  return note.status || "PENDENTE";
}

export interface SupabaseNotaEventoRow {
  id?: string;
  tipo_documento: "NFE" | "NFSE";
  ref: string;
  tipo_evento: "AUTORIZACAO" | "REJEICAO" | "CONSULTA" | "WEBHOOK" | "CARTA_CORRECAO" | "CANCELAMENTO" | "INUTILIZACAO";
  sequencia_evento?: number | null;
  status_evento?: string | null;
  status_sefaz?: string | null;
  mensagem_sefaz?: string | null;
  caminho_xml?: string | null;
  caminho_pdf?: string | null;
  url_xml?: string | null;
  url_pdf?: string | null;
  justificativa?: string | null;
  correcao?: string | null;
  payload_envio?: Record<string, unknown> | null;
  payload_retorno?: Record<string, unknown> | null;
  origem?: string | null;
  criado_por?: string | null;
  criado_por_nome?: string | null;
  created_at?: string;
}

export async function insertNotaEvento(
  payload: Partial<SupabaseNotaEventoRow>
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    const { error } = await client
      .from("notas_eventos")
      .insert(payload);

    if (error) {
      console.error("[NfeService] insertNotaEvento failed:", error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[NfeService] insertNotaEvento exception:", err);
    return false;
  }
}

export async function getNotaEventos(tipoDocumento: "NFE" | "NFSE", ref: string): Promise<SupabaseNotaEventoRow[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from("notas_eventos")
      .select("*")
      .eq("tipo_documento", tipoDocumento)
      .eq("ref", ref)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("[NfeService] getNotaEventos failed:", err);
    return [];
  }
}

export async function getNotaEventosForRefs(
  tipoDocumento: "NFE" | "NFSE",
  refs: string[]
): Promise<SupabaseNotaEventoRow[]> {
  const client = getSupabaseClient();
  if (!client || refs.length === 0) return [];

  try {
    const { data, error } = await client
      .from("notas_eventos")
      .select("*")
      .eq("tipo_documento", tipoDocumento)
      .in("ref", refs)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("[NfeService] getNotaEventosForRefs failed:", err);
    return [];
  }
}






