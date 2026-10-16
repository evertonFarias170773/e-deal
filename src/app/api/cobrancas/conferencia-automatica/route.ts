import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { criarClientServiceRole } from "@/features/cadastros/services/cadastro-online.server";
import {
  CABECALHO_SEGREDO_CONFERENCIA_AUTOMATICA,
  VARIAVEL_MODO_CONFERENCIA_AUTOMATICA,
  VARIAVEL_SEGREDO_CONFERENCIA_AUTOMATICA,
  lerModoConferenciaAutomatica,
  varrerConferenciaAutomatica
} from "@/features/cobrancas/services/conferencia-automatica.server";

/**
 * POST /api/cobrancas/conferencia-automatica — uma varredura da conferência
 * automática (Fase 2, 16/10/2026). Ver services/conferencia-automatica.server.
 *
 * Chamada por um fluxo pequeno do n8n, de tempos em tempos. Não recebe
 * parâmetro: o segredo só aciona a varredura, e todas as checagens são feitas
 * aqui. Responde o resumo (contagens e ids), sem dado pessoal.
 *
 * Variáveis:
 *   CONFERENCIA_AUTOMATICA_SEGREDO — segredo próprio desta rota; sem ele, 503;
 *   CONFERENCIA_AUTOMATICA_MODO    — desligado (padrão) | sombra | ligado;
 *   SUPABASE_SERVICE_ROLE_KEY      — a chave de serviço já usada pela área do cliente.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Tempo constante, com SHA-256 antes (mesmo desenho da API do parceiro). */
function segredoConfere(recebido: string, esperado: string): boolean {
  const a = createHash("sha256").update(recebido, "utf8").digest();
  const b = createHash("sha256").update(esperado, "utf8").digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const esperado = String(process.env[VARIAVEL_SEGREDO_CONFERENCIA_AUTOMATICA] ?? "").trim();
  if (!esperado) {
    return NextResponse.json({ success: false, error: "Conferência automática não configurada." }, { status: 503 });
  }
  const recebido = String(request.headers.get(CABECALHO_SEGREDO_CONFERENCIA_AUTOMATICA) ?? "").trim();
  if (!recebido || !segredoConfere(recebido, esperado)) {
    return NextResponse.json({ success: false, error: "Não autorizado." }, { status: 401 });
  }

  const modo = lerModoConferenciaAutomatica(process.env[VARIAVEL_MODO_CONFERENCIA_AUTOMATICA]);
  if (modo === "desligado") {
    return NextResponse.json({ success: true, modo, examinadas: 0 });
  }

  const supabase = criarClientServiceRole();
  if (!supabase) {
    return NextResponse.json({ success: false, error: "Chave de serviço ausente no servidor." }, { status: 503 });
  }

  try {
    const resumo = await varrerConferenciaAutomatica(supabase, modo);
    return NextResponse.json({
      success: true,
      modo: resumo.modo,
      examinadas: resumo.examinadas,
      conferiria: resumo.conferiria,
      conferidas: resumo.conferidas,
      manuais: resumo.manuais,
      falhas: resumo.falhas,
      limiteAtingido: resumo.limiteAtingido,
      itens: resumo.itens.map((i) => ({
        id_pagamento: i.id_pagamento,
        id_int: i.id_int,
        forma: i.forma,
        marca: i.marca,
        decisao: i.decisao,
        motivo: i.motivo ?? null
      }))
    });
  } catch (erro) {
    console.error("[conferencia-automatica] varredura falhou:", erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ success: false, error: "A varredura falhou; nada foi conferido por ela." }, { status: 500 });
  }
}
