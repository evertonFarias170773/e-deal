/**
 * Reenvio de pedido devolvido (fase 1, 22/10/2026; fase 2B, 18/11/2026). Uma
 * chamada so a cada RPC: permissao, trava, frete, diferenca e gravacoes moram
 * no banco. Regra da tela em `lib/reenvio.ts`.
 */
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  lerSituacaoDoReenvio,
  lerVereditoRedespacho,
  textoDoErroDeReenvio,
  type SituacaoCicloReenvio,
  type VereditoRedespacho
} from "../lib/reenvio";
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
  | { success: true; ciclo: number; idempotente: boolean; diferenca: number; exigeNota: boolean }
  | { success: false; error: string };

/**
 * Frete do reenvio (fase 2B, 18/11/2026). O banco confere tudo: a consulta tem
 * de ser a mais recente do pedido para o CEP novo e a opcao, do tipo de envio;
 * o valor digitado so passa para `expedicao.admin` e so sem opcao automatica.
 */
export type FreteDoReenvio =
  | { origem: "COTACAO"; idConsulta: number; idOpcao: string }
  | { origem: "DIGITADO_ADM"; valor: number }
  | null;

export async function reenviarPedido(entrada: {
  idInt: number;
  ciclo: number;
  idEnderecoEntrega: string;
  tipoFrete: TipoFreteNormalizado;
  motivo: string;
  modalidade: ModalidadeFrete | null;
  frete?: FreteDoReenvio;
}): Promise<ResultadoReenvio> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase não inicializado." };
  const frete = entrada.frete ?? null;
  const { data, error } = await client.rpc("exp_reenviar_pedido", {
    p_id_int: entrada.idInt,
    p_ciclo: entrada.ciclo,
    p_id_endereco_entrega: entrada.idEnderecoEntrega,
    p_tipo_frete: entrada.tipoFrete,
    p_motivo: entrada.motivo,
    p_modalidade: entrada.modalidade,
    p_id_consulta: frete?.origem === "COTACAO" ? frete.idConsulta : null,
    p_id_opcao: frete?.origem === "COTACAO" ? frete.idOpcao : null,
    p_frete_digitado: frete?.origem === "DIGITADO_ADM" ? frete.valor : null
  });
  if (error) return { success: false, error: textoDoErroDeReenvio(error.message) };
  const r = (data ?? {}) as { ciclo?: number; idempotente?: boolean; diferenca?: number | string; exige_nota?: boolean };
  return {
    success: true,
    ciclo: Number(r.ciclo ?? entrada.ciclo),
    idempotente: r.idempotente === true,
    diferenca: Number(r.diferenca ?? 0) || 0,
    exigeNota: r.exige_nota === true
  };
}

/**
 * Veredito do redespacho do ciclo aberto (`exp_reenvio_redespacho`), a mesma
 * funcao do gatilho `trg_exp_reenvio_redespacho`. Leitura que falha devolve
 * null e nao trava: o gatilho segue recusando no banco.
 */
export async function avaliarRedespacho(entrada: {
  idInt: number;
  cep: string | null | undefined;
  tipoFrete: string | null | undefined;
}): Promise<VereditoRedespacho | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.rpc("exp_reenvio_redespacho", {
    p_id_int: entrada.idInt,
    p_cep: entrada.cep ?? null,
    p_tipo_frete: entrada.tipoFrete ?? null
  });
  if (error) {
    console.warn("[reenvio] Falha ao avaliar o redespacho:", error.message);
    return null;
  }
  return lerVereditoRedespacho(data);
}

/** Diferenca de frete por ciclo (`exp_reenvio_situacao`). Falha: lista vazia. */
export async function lerSituacaoDosReenvios(idInt: number): Promise<SituacaoCicloReenvio[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client.rpc("exp_reenvio_situacao", { p_id_int: idInt });
  if (error) {
    console.warn("[reenvio] Falha ao ler a diferenca de frete dos reenvios:", error.message);
    return [];
  }
  return lerSituacaoDoReenvio(data);
}

export type CobrancaDoReenvio =
  | { success: true; id: string; idPagamento: string | null; valor: number; idEmpresa: number | null; idempotente: boolean }
  | { success: false; error: string };

/** Cria (ou devolve) a cobranca PIX marcada do ciclo. O QR sai depois, por /api/cobrancas/gerar-pix. */
export async function cobrarDiferencaDoReenvio(chave: string): Promise<CobrancaDoReenvio> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase não inicializado." };
  const { data, error } = await client.rpc("exp_reenvio_cobrar_diferenca", { p_chave: chave });
  if (error) {
    if (/^PERM:/.test(error.message)) return { success: false, error: "Você não tem a permissão de criar cobrança (cobrancas.create)." };
    return { success: false, error: textoDoErroDeReenvio(error.message) };
  }
  const r = (data ?? {}) as { id?: string; id_pagamento?: string | null; valor?: number | string; id_empresa?: number | null; idempotente?: boolean };
  if (!r.id) return { success: false, error: "O banco não devolveu a cobrança criada." };
  return {
    success: true,
    id: String(r.id),
    idPagamento: r.id_pagamento ?? null,
    valor: Number(r.valor ?? 0),
    idEmpresa: r.id_empresa === null || r.id_empresa === undefined ? null : Number(r.id_empresa),
    idempotente: r.idempotente === true
  };
}

/** Abono da diferenca do ciclo (so administrador; o banco confere). */
export async function abonarDiferencaDoReenvio(chave: string, motivo: string): Promise<{ success: true } | { success: false; error: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase não inicializado." };
  const { error } = await client.rpc("exp_reenvio_abonar_diferenca", { p_chave: chave, p_motivo: motivo });
  if (error) return { success: false, error: textoDoErroDeReenvio(error.message) };
  return { success: true };
}
