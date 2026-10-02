/**
 * POST /api/tarefas/[id]/prazo-prioridade — muda o prazo e/ou a prioridade.
 *
 * Corpo: { data_limite?: "AAAA-MM-DD" | null, prioridade?: "NORMAL" | "ALTA" | "URGENTE" }
 * So o campo presente no corpo e alterado; `data_limite: null` tira o prazo.
 *
 * Grava com a sessao do usuario. Quem pode (quem criou, quem recebeu e o
 * responsavel), e em qual situacao (aberta ou em andamento), e decidido pela
 * trigger `tarefas_equipe__guarda`, que tambem escreve a linha do historico
 * (`alteracoes`) e marca a novidade para os outros participantes. O RLS esconde
 * a tarefa de quem nao participa dela: nesse caso o UPDATE afeta zero linhas e
 * a rota responde "nao encontrada".
 */

import { NextResponse, type NextRequest } from "next/server";
import { abrirContexto, recusa, respostaDoErroBanco } from "@/features/tarefas/lib/rota-tarefas.server";
import { PRIORIDADES, type TarefaPrioridade } from "@/features/tarefas/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "AAAA-MM-DD" que existe no calendario. */
function dataValida(valor: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const d = new Date(`${valor}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

export async function POST(request: NextRequest, contexto: { params: Promise<{ id: string }> }) {
  const aberto = await abrirContexto(request);
  if (!aberto.ok) return aberto.resposta;
  const { supabase } = aberto.ctx;

  const id = Number((await contexto.params).id);
  if (!Number.isInteger(id) || id <= 0) return recusa("Tarefa inválida.", 400, "ID");

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return recusa("Dados inválidos.", 400, "PAYLOAD");
  }

  const mudanca: Record<string, unknown> = {};

  if ("data_limite" in body) {
    const bruto = body.data_limite === null ? "" : String(body.data_limite ?? "").trim();
    if (bruto && !dataValida(bruto)) return recusa("Prazo inválido.", 400, "PRAZO");
    mudanca.data_limite = bruto || null;
  }

  if ("prioridade" in body) {
    const prioridade = String(body.prioridade ?? "") as TarefaPrioridade;
    if (!PRIORIDADES.includes(prioridade)) return recusa("Prioridade inválida.", 400, "PRIORIDADE");
    mudanca.prioridade = prioridade;
  }

  if (Object.keys(mudanca).length === 0) return recusa("Nada para alterar.", 400, "VAZIO");

  const { data, error } = await supabase
    .from("tarefas_equipe")
    .update(mudanca)
    .eq("id", id)
    .select("id, data_limite, prioridade")
    .maybeSingle();

  if (error) return respostaDoErroBanco(error, "prazo-prioridade");
  if (!data) return recusa("Tarefa não encontrada ou sem acesso.", 404, "NAO_ENCONTRADA");
  return NextResponse.json({ success: true, id: data.id, data_limite: data.data_limite, prioridade: data.prioridade });
}
