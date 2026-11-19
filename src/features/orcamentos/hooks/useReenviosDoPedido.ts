"use client";

/**
 * REENVIOS DO PEDIDO, para a aba Fretes (19/11/2026). So leitura.
 *
 * O reenvio de pedido devolvido NAO muda o frete da proposta (o da venda, que
 * esta no total e na NF). A aba Fretes usa isto para dizer qual e o envio
 * atual: o card do frete da proposta vira "Envio original" e o do ultimo
 * reenvio aparece em destaque (e marcado, se o card existir na lista).
 *
 * Le `expedicao_reenvios` direto (RLS libera SELECT a authenticated). Falha de
 * leitura: lista vazia, e a aba fica como sem reenvio.
 */
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { normalizarModoCobranca, type ModoCobrancaReenvio } from "@/features/expedicao/lib/reenvio";

export interface ReenvioDaAbaFretes {
  ciclo: number;
  motivo: string;
  tipoFreteNovo: string | null;
  /** A opcao cotada no reenvio (id do card, servico, transportadora), quando houve. */
  opcao: { id: string | null; servico: string | null; transportadora: string | null } | null;
  freteNovo: number | null;
  modoCobranca: ModoCobrancaReenvio;
  valorCobrar: number;
}

const ROTULO_TIPO: Record<string, string> = {
  CORREIOS: "Correios",
  TRANSPORTADORA: "Transportadora",
  MOTOBOY: "Motoboy"
};

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function lerReenviosDaAbaFretes(linhas: unknown[]): ReenvioDaAbaFretes[] {
  return linhas
    .map((item) => {
      const r = (item ?? {}) as Record<string, unknown>;
      const o = r.opcao_frete && typeof r.opcao_frete === "object" ? (r.opcao_frete as Record<string, unknown>) : null;
      return {
        ciclo: Number(r.ciclo),
        motivo: String(r.motivo ?? ""),
        tipoFreteNovo: texto(r.tipo_frete_novo),
        opcao: o ? { id: texto(o.id), servico: texto(o.servico), transportadora: texto(o.transportadora) } : null,
        freteNovo: numero(r.frete_novo),
        modoCobranca: normalizarModoCobranca(r.modo_cobranca),
        valorCobrar: numero(r.valor_cobrar) ?? numero(r.diferenca) ?? 0
      };
    })
    .filter((r) => Number.isFinite(r.ciclo))
    .sort((a, b) => a.ciclo - b.ciclo);
}

/** "Transportadora São Miguel", ou o tipo de envio quando o reenvio nao cotou. */
export function envioDoReenvio(r: Pick<ReenvioDaAbaFretes, "opcao" | "tipoFreteNovo">): string {
  if (r.opcao?.transportadora) return r.opcao.transportadora;
  if (r.opcao?.servico) return r.opcao.servico;
  const tipo = String(r.tipoFreteNovo ?? "").toUpperCase();
  return ROTULO_TIPO[tipo] ?? (tipo || "envio");
}

/** Algum reenvio diz que o pedido voltou devolvido (motivo com "devolv"). */
export function foiDevolvido(reenvios: Pick<ReenvioDaAbaFretes, "motivo">[]): boolean {
  return reenvios.some((r) => /devolv/i.test(r.motivo));
}

const normal = (s: string | null | undefined) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();

/**
 * O card da lista que e o envio do reenvio: o mesmo id da opcao cotada ou, sem
 * id igual, o mesmo servico e a mesma transportadora. Reenvio sem opcao cotada
 * nao marca card nenhum.
 */
export function cardEhDoReenvio(
  card: { id: string; servico?: string | null; transportadora?: string | null },
  reenvio: Pick<ReenvioDaAbaFretes, "opcao"> | null
): boolean {
  const o = reenvio?.opcao;
  if (!o) return false;
  if (o.id && card.id === o.id) return true;
  return Boolean(o.servico) && normal(card.servico) === normal(o.servico) && normal(card.transportadora) === normal(o.transportadora);
}

/** Os reenvios do pedido (ordem do ciclo). `null` = sem pedido para ler. */
export function useReenviosDoPedido(idInt: number | null): ReenvioDaAbaFretes[] {
  const [estado, setEstado] = useState<{ idInt: number; lista: ReenvioDaAbaFretes[] } | null>(null);

  useEffect(() => {
    if (idInt === null) return;
    let vivo = true;
    void (async () => {
      const client = getSupabaseClient();
      if (!client) return;
      const { data, error } = await client
        .from("expedicao_reenvios")
        .select("ciclo, motivo, tipo_frete_novo, opcao_frete, frete_novo, modo_cobranca, valor_cobrar, diferenca")
        .eq("id_int", idInt)
        .order("ciclo", { ascending: true });
      if (error) console.warn("[fretes] Falha ao ler os reenvios do pedido:", error.message);
      if (vivo) setEstado({ idInt, lista: error ? [] : lerReenviosDaAbaFretes(data ?? []) });
    })();
    return () => {
      vivo = false;
    };
  }, [idInt]);

  return idInt !== null && estado?.idInt === idInt ? estado.lista : [];
}
