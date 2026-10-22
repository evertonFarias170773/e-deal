/**
 * Reenvio de pedido devolvido (fase 1, 22/10/2026). Uma chamada so a RPC
 * `exp_reenviar_pedido`: permissao, trava, frete e gravacoes moram no banco.
 * Regra da tela em `lib/reenvio.ts`.
 */
import { getSupabaseClient } from "@/lib/supabase/client";
import { textoDoErroDeReenvio } from "../lib/reenvio";
import type { ModalidadeFrete, TipoFreteNormalizado } from "../types";

export type EnderecoParaReenvio = {
  id: string;
  idCliente: number | null;
  rotulo: string;
  cep: string | null;
};

/** Enderecos do cliente e do pagador — os unicos que a RPC aceita. */
export async function listarEnderecosParaReenvio(idsCliente: number[]): Promise<EnderecoParaReenvio[]> {
  const client = getSupabaseClient();
  const ids = Array.from(new Set(idsCliente.filter((n) => Number.isFinite(n) && n > 0)));
  if (!client || ids.length === 0) return [];
  const { data, error } = await client
    .from("enderecos")
    .select("id, id_cliente, endereco, numero, complemento, bairro, cidade, uf, cep, data_criacao")
    .in("id_cliente", ids)
    .order("data_criacao", { ascending: false });
  if (error) {
    console.warn("[reenvio] Falha ao ler os enderecos:", error.message);
    return [];
  }
  return (data ?? []).map((e) => ({
    id: String(e.id),
    idCliente: e.id_cliente !== null && e.id_cliente !== undefined ? Number(e.id_cliente) : null,
    cep: (e.cep as string | null) ?? null,
    rotulo: [
      [e.endereco, e.numero].filter(Boolean).join(", "),
      e.complemento,
      e.bairro,
      [e.cidade, e.uf].filter(Boolean).join("/"),
      e.cep ? `CEP ${e.cep}` : null
    ]
      .filter(Boolean)
      .join(" · ")
  }));
}

export type ResultadoReenvio =
  | { success: true; ciclo: number; idempotente: boolean }
  | { success: false; error: string };

export async function reenviarPedido(entrada: {
  idInt: number;
  ciclo: number;
  idEnderecoEntrega: string;
  tipoFrete: TipoFreteNormalizado;
  motivo: string;
  modalidade: ModalidadeFrete | null;
}): Promise<ResultadoReenvio> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase não inicializado." };
  const { data, error } = await client.rpc("exp_reenviar_pedido", {
    p_id_int: entrada.idInt,
    p_ciclo: entrada.ciclo,
    p_id_endereco_entrega: entrada.idEnderecoEntrega,
    p_tipo_frete: entrada.tipoFrete,
    p_motivo: entrada.motivo,
    p_modalidade: entrada.modalidade
  });
  if (error) return { success: false, error: textoDoErroDeReenvio(error.message) };
  const r = (data ?? {}) as { ciclo?: number; idempotente?: boolean };
  return { success: true, ciclo: Number(r.ciclo ?? entrada.ciclo), idempotente: r.idempotente === true };
}
