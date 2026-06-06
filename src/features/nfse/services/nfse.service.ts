import { getSupabaseClient } from "@/lib/supabase/client";
import { nfseMocks } from "@/lib/mocks/nfse.mock";
import { mapSupabaseNfseRowToReadModel } from "../mappers";
import type { SupabaseNfseRow, NfseReadModel } from "../types";

export const NFSE_SELECT_COLUMNS = [
  "id",
  "id_int",
  "ref",
  "id_empresa",
  "id_cliente",
  "status",
  "status_focus",
  "status_prefeitura",
  "mensagem_prefeitura",
  "ambiente",
  "municipio_prestacao",
  "uf_prestacao",
  "id_servico_padrao",
  "codigo_servico",
  "codigo_tributario_municipio",
  "item_lista_servico",
  "cnae",
  "discriminacao",
  "valor_servicos",
  "valor_deducoes",
  "valor_pis",
  "valor_cofins",
  "valor_inss",
  "valor_ir",
  "valor_csll",
  "aliquota_iss",
  "iss_retido",
  "numero_nfse",
  "codigo_verificacao",
  "caminho_xml",
  "caminho_pdf",
  "url_xml",
  "url_pdf",
  "erro_codigo",
  "erro_mensagem",
  "payload_envio",
  "payload_retorno",
  "criado_por_nome",
  "ultima_tentativa_em",
  "tentativas_envio",
  "numero_dps",
  "serie_dps",
  "id_natureza_operacao",
  "natureza_operacao",
  "codigo_nbs",
  "valor_desconto",
  "base_calculo_iss",
  "valor_iss",
  "valor_liquido",
  "codigo_indicador_operacao",
  "indicador_destinatario",
  "codigo_tributacao_nacional_iss",
  "regime_especial_tributacao",
  "codigo_opcao_simples_nacional",
  "situacao_tributaria_pis_cofins",
  "forma_pagamento",
  "informacoes_complementares",
  "informacoes_fisco",
  "aliquota_pis",
  "aliquota_cofins",
  "aliquota_csll",
  "aliquota_ir",
  "aliquota_inss",
  "ibs_cbs_situacao_tributaria",
  "ibs_cbs_classificacao_tributaria",
  "aliquota_cbs",
  "valor_cbs",
  "aliquota_ibs_estadual",
  "valor_ibs_estadual",
  "aliquota_ibs_municipal",
  "valor_ibs_municipal",
  "created_at",
  "updated_at"
] as const;

export const NFSE_SELECT = NFSE_SELECT_COLUMNS.join(", ");

export type NfseReadResult = {
  source: "supabase" | "mock";
  nfseList: NfseReadModel[];
};

function buildMockResult(): NfseReadResult {
  return {
    source: "mock",
    nfseList: nfseMocks.map(item => ({ ...item }))
  };
}

async function fetchNfseRows(): Promise<SupabaseNfseRow[] | null> {
  const client = getSupabaseClient();
  if (!client) {
    console.log("[Nfse][Debug] Supabase client absent - falling back to mocks.");
    return null;
  }

  console.log("[Nfse] Performing select query on public.notas_servico.");
  const query = client
    .from("notas_servico")
    .select(NFSE_SELECT)
    .order("ultima_tentativa_em", { ascending: false })
    .limit(2000);

  const { data, error } = await query.returns<SupabaseNfseRow[]>();

  if (error || !data) {
    console.log("[Nfse][Supabase] Select query failed - falling back to mocks.", {
      error: error instanceof Error ? error.message : error,
      hasData: Boolean(data)
    });
    return null;
  }

  return data;
}

export async function getNfseReadOnlyList(): Promise<NfseReadResult> {
  try {
    const rows = await fetchNfseRows();
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
        console.warn("[NfseService] Failed to fetch client names/fantasias:", err);
      }
    }

    const nfseList = rows.map(row => {
      const model = mapSupabaseNfseRowToReadModel(row);
      const clientInfo = clientMap[row.id_cliente];
      if (clientInfo) {
        model.nome = clientInfo.nome;
        model.fantasia = clientInfo.fantasia;
      }
      return model;
    });

    console.log("[Nfse] Retrieved and mapped real data.", { count: nfseList.length });
    
    return {
      source: "supabase",
      nfseList
    };
  } catch (err) {
    console.log("[Nfse] Catch block error - falling back to mocks.", err);
    return buildMockResult();
  }
}
