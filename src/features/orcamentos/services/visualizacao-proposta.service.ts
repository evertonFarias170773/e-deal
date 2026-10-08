import { getSupabaseClient } from "@/lib/supabase/client";
import { nomeTransportadoraCadastro } from "@/features/orcamentos/lib/modalidade-frete";

/**
 * O que a VISUALIZAÇÃO do pedido precisa saber do frete e o carregamento da
 * proposta não traz: o nome da transportadora vinculada e o estado do despacho.
 *
 * SÓ LEITURA, três consultas pequenas. É o que alimenta `freteDaVisualizacao`
 * (lib/visualizacao-da-proposta): sem o nome não dá para dizer "Cliente
 * contrata: X" nem "Transportadora: X", e sem o despacho e a prepostagem não dá
 * para aplicar o predicado de CIF por transportadora da Expedição.
 *
 * Falha de leitura devolve tudo vazio: a tela cai no texto de sempre (a cotação)
 * em CIF e em "transportadora a definir" em FOB, sem erro.
 */
export type ComplementoDoFrete = {
  nomeTransportadora: string | null;
  despachoConfirmado: boolean;
  correiosIdPrepostagem: string | null;
  prepostagemCanceladaEm: string | null;
  /** O que a Expedição declarou no despacho; só vale com `despachoConfirmado`. */
  despacho: { tipoFrete: string | null; transportadoraNome: string | null; modalidade: "RETIRA" | "FOB" | "CIF" | null } | null;
  /** `propostas.em_arte`: o sufixo " / EM ARTE" do selo de status, como no cabeçalho da edição. */
  emArte: boolean;
};

export const SEM_COMPLEMENTO_DO_FRETE: ComplementoDoFrete = {
  nomeTransportadora: null,
  despachoConfirmado: false,
  correiosIdPrepostagem: null,
  prepostagemCanceladaEm: null,
  despacho: null,
  emArte: false
};

export async function lerComplementoDoFrete(idInt: number, idTransportadora: number | null | undefined): Promise<ComplementoDoFrete> {
  const client = getSupabaseClient();
  if (!client || !Number.isFinite(idInt) || idInt <= 0) return SEM_COMPLEMENTO_DO_FRETE;

  const [transportadora, expedicao, pedido] = await Promise.all([
    idTransportadora
      ? client.from("clientes").select("id_cliente, nome, fantasia").eq("id_cliente", idTransportadora).maybeSingle<{ id_cliente: number; nome: string | null; fantasia: string | null }>()
      : Promise.resolve({ data: null, error: null }),
    client
      .from("expedicoes")
      .select("data_despacho, correios_id_prepostagem, prepostagem_cancelada_em, tipo_frete, transportadora_nome, modalidade_frete")
      .eq("id_int", idInt)
      .maybeSingle<{
        data_despacho: string | null;
        correios_id_prepostagem: string | null;
        prepostagem_cancelada_em: string | null;
        tipo_frete: string | null;
        transportadora_nome: string | null;
        modalidade_frete: "RETIRA" | "FOB" | "CIF" | null;
      }>(),
    client.from("propostas").select("em_arte").eq("id_int", idInt).maybeSingle<{ em_arte: boolean | null }>()
  ]);

  if (transportadora.error) console.warn("[visualizacao-proposta] transportadora não lida:", transportadora.error.message);
  if (expedicao.error) console.warn("[visualizacao-proposta] expedição não lida:", expedicao.error.message);

  return {
    nomeTransportadora: transportadora.data ? nomeTransportadoraCadastro(transportadora.data) : null,
    despachoConfirmado: Boolean(expedicao.data?.data_despacho),
    correiosIdPrepostagem: expedicao.data?.correios_id_prepostagem ?? null,
    prepostagemCanceladaEm: expedicao.data?.prepostagem_cancelada_em ?? null,
    despacho: expedicao.data?.data_despacho
      ? {
          tipoFrete: expedicao.data.tipo_frete ?? null,
          transportadoraNome: expedicao.data.transportadora_nome ?? null,
          modalidade: expedicao.data.modalidade_frete ?? null
        }
      : null,
    emArte: pedido.data?.em_arte === true
  };
}
