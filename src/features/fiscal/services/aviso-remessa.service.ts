import { getSupabaseClient } from "@/lib/supabase/client";
import {
  avisosDeRemessaPorPedido,
  type AvisoDeRemessa,
  type DadosParaAvisosDeRemessa
} from "@/features/fiscal/lib/aviso-remessa";

/**
 * AVISO DE NOTA DE REMESSA — a leitura (08/10/2026). SÓ `select`.
 *
 * Leitura à parte, em lote, no mesmo padrão da previsão da produção e das
 * NFS-e da Fila: a consulta que monta a Fila (`getFaturaveisPropostas`) é
 * compartilhada e NÃO muda. Aqui se lê, para os pedidos pedidos:
 *   1. `propostas`  — quem paga, a modalidade e o endereço de entrega;
 *   2. `expedicoes` — o endereço do despacho, que vence quando confirmado;
 *   3. `notas_fiscais` — se o pedido já tem nota de remessa;
 *   4. `enderecos`  — o de entrega (por id) e os principais dos pagadores.
 * A regra que transforma isso em aviso é pura (`lib/aviso-remessa.ts`).
 *
 * DEVOLVE `null` QUANDO NÃO DÁ PARA LER (sem cliente ou com erro em qualquer
 * consulta): quem chama esconde o aviso, sem erro na tela. Um aviso pela metade
 * seria pior do que nenhum.
 */
const TAMANHO_DO_LOTE = 200;

const lotes = <T,>(lista: readonly T[]): T[][] => {
  const saida: T[][] = [];
  for (let i = 0; i < lista.length; i += TAMANHO_DO_LOTE) saida.push(lista.slice(i, i + TAMANHO_DO_LOTE));
  return saida;
};

export async function lerAvisosDeRemessa(idsInt: readonly number[]): Promise<Map<number, AvisoDeRemessa> | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const ids = Array.from(new Set(idsInt.filter((id) => Number.isFinite(id) && id > 0)));
  if (ids.length === 0) return new Map();

  const dados: DadosParaAvisosDeRemessa = { propostas: [], expedicoes: [], enderecos: [], remessas: [] };

  for (const fatia of lotes(ids)) {
    const [propostas, expedicoes, remessas] = await Promise.all([
      supabase.from("propostas").select("id_int, id_cliente, id_faturado, id_endereco_ent, modalidade_frete").in("id_int", fatia),
      supabase.from("expedicoes").select("id_int, id_endereco_entrega, data_despacho").in("id_int", fatia),
      supabase.from("notas_fiscais").select("id_int, status").in("id_int", fatia).eq("tipo_nota", "REMESSA")
    ]);
    const erro = propostas.error ?? expedicoes.error ?? remessas.error;
    if (erro) {
      console.warn("[aviso-remessa] Não foi possível ler os pedidos para o aviso de remessa:", erro.message);
      return null;
    }
    dados.propostas.push(...((propostas.data ?? []) as DadosParaAvisosDeRemessa["propostas"]));
    dados.expedicoes.push(...((expedicoes.data ?? []) as DadosParaAvisosDeRemessa["expedicoes"]));
    dados.remessas.push(...((remessas.data ?? []) as DadosParaAvisosDeRemessa["remessas"]));
  }

  // Pedido de retirada não tem aviso: não vale a pena ler endereço para ele.
  const comEntrega = dados.propostas.filter((p) => String(p.modalidade_frete ?? "").trim().toUpperCase() !== "RETIRA");
  const idsEndereco = new Set<string>();
  const pagadores = new Set<number>();
  for (const p of comEntrega) {
    const idEntrega = String(p.id_endereco_ent ?? "").trim();
    if (idEntrega) idsEndereco.add(idEntrega);
    const idCliente = Number(p.id_cliente);
    const idFaturado = Number(p.id_faturado);
    const pagador = Number.isFinite(idFaturado) && idFaturado > 0 && idFaturado !== idCliente ? idFaturado : idCliente;
    if (Number.isFinite(pagador) && pagador > 0) pagadores.add(pagador);
  }
  for (const x of dados.expedicoes) {
    const idDespacho = String(x.id_endereco_entrega ?? "").trim();
    if (x.data_despacho && idDespacho) idsEndereco.add(idDespacho);
  }

  const COLUNAS = "id, id_cliente, tipo_endereco, endereco, numero, cidade, uf, cep, data_criacao";
  const vistos = new Set<string>();
  const guardar = (linhas: unknown) => {
    for (const e of (linhas ?? []) as DadosParaAvisosDeRemessa["enderecos"]) {
      const id = String(e.id ?? "");
      if (vistos.has(id)) continue;
      vistos.add(id);
      dados.enderecos.push(e);
    }
  };
  for (const fatia of lotes(Array.from(idsEndereco))) {
    const { data, error } = await supabase.from("enderecos").select(COLUNAS).in("id", fatia);
    if (error) {
      console.warn("[aviso-remessa] Não foi possível ler os endereços de entrega:", error.message);
      return null;
    }
    guardar(data);
  }
  for (const fatia of lotes(Array.from(pagadores))) {
    const { data, error } = await supabase.from("enderecos").select(COLUNAS).in("id_cliente", fatia).ilike("tipo_endereco", "%principal%");
    if (error) {
      console.warn("[aviso-remessa] Não foi possível ler os endereços de faturamento:", error.message);
      return null;
    }
    guardar(data);
  }

  return avisosDeRemessaPorPedido(dados);
}

/** O aviso de UM pedido — para o rascunho da NF-e e para a conferência antes de faturar. */
export async function lerAvisoDeRemessaDoPedido(idInt: number | null | undefined): Promise<AvisoDeRemessa | null> {
  const id = Number(idInt);
  if (!Number.isFinite(id) || id <= 0) return null;
  const avisos = await lerAvisosDeRemessa([id]);
  return avisos?.get(id) ?? null;
}
