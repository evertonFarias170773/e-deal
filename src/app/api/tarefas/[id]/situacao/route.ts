/**
 * POST /api/tarefas/[id]/situacao — assumir, concluir ou cancelar.
 *
 * Corpo: { acao: "assumir" | "concluir" | "cancelar", observacao?: string }
 *
 * Grava com a sessao do usuario. Quem pode cada acao, e em qual situacao, e
 * decidido pela trigger `tarefas_equipe__guarda`; o RLS esconde a tarefa de
 * quem nao participa dela (nesse caso o UPDATE afeta zero linhas e a rota
 * responde "nao encontrada").
 */

import { NextResponse, type NextRequest } from "next/server";
import { abrirContexto, recusa, respostaDoErroBanco } from "@/features/tarefas/lib/rota-tarefas.server";
import { OBSERVACAO_MAX, type TarefaAcao, type TarefaStatus } from "@/features/tarefas/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_DA_ACAO: Record<TarefaAcao, TarefaStatus> = {
  assumir: "EM_ANDAMENTO",
  concluir: "CONCLUIDA",
  cancelar: "CANCELADA"
};

export async function POST(request: NextRequest, contexto: { params: Promise<{ id: string }> }) {
  const aberto = await abrirContexto(request);
  if (!aberto.ok) return aberto.resposta;
  const { supabase } = aberto.ctx;

  const { id: bruto } = await contexto.params;
  const id = Number(bruto);
  if (!Number.isInteger(id) || id <= 0) return recusa("Tarefa inválida.", 400, "ID");

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return recusa("Dados inválidos.", 400, "PAYLOAD");
  }

  const acao = String(body.acao ?? "") as TarefaAcao;
  if (!(acao in STATUS_DA_ACAO)) return recusa("Ação inválida.", 400, "ACAO");

  const observacao = String(body.observacao ?? "").trim();
  if (observacao.length > OBSERVACAO_MAX) {
    return recusa(`A observação pode ter até ${OBSERVACAO_MAX} caracteres.`, 400, "OBSERVACAO");
  }

  const mudanca: Record<string, unknown> = { status: STATUS_DA_ACAO[acao] };
  if (acao === "concluir") mudanca.observacao_conclusao = observacao || null;

  const { data, error } = await supabase
    .from("tarefas_equipe")
    .update(mudanca)
    .eq("id", id)
    .select("id, status")
    .maybeSingle();

  if (error) return respostaDoErroBanco(error, acao);
  if (!data) return recusa("Tarefa não encontrada ou sem acesso.", 404, "NAO_ENCONTRADA");
  return NextResponse.json({ success: true, id: data.id, status: data.status });
}
