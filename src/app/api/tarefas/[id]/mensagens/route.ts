/**
 * POST /api/tarefas/[id]/mensagens — escreve na conversa da tarefa.
 *
 * Corpo: { mensagem }
 *
 * Nao muda a situacao. Grava com a SESSAO do usuario: o RLS so aceita de quem
 * enxerga a tarefa (quem criou, destinatarios, responsavel, admin; equipe em
 * tarefa para todos) e so com ela aberta ou em andamento. O autor e o horario
 * sao preenchidos pelo banco. A trigger da mensagem marca a novidade, que faz
 * o sinal piscar para os outros participantes.
 */

import { NextResponse, type NextRequest } from "next/server";
import { abrirContexto, recusa, respostaDoErroBanco, tarefaVisivel } from "@/features/tarefas/lib/rota-tarefas.server";
import { MENSAGEM_MAX } from "@/features/tarefas/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const mensagem = String(body.mensagem ?? "").trim();
  if (!mensagem) return recusa("Escreva a mensagem.", 400, "MENSAGEM");
  if (mensagem.length > MENSAGEM_MAX) return recusa(`A mensagem pode ter até ${MENSAGEM_MAX} caracteres.`, 400, "MENSAGEM");

  // Resposta clara antes de bater no RLS: sem acesso ou tarefa encerrada.
  const tarefa = await tarefaVisivel(supabase, id);
  if (!tarefa) return recusa("Tarefa não encontrada ou sem acesso.", 404, "NAO_ENCONTRADA");
  if (tarefa.status !== "ABERTA" && tarefa.status !== "EM_ANDAMENTO") {
    return recusa("Tarefa encerrada: a conversa ficou só para leitura.", 409, "ENCERRADA");
  }

  const { data, error } = await supabase
    .from("tarefas_equipe_mensagens")
    .insert({ tarefa_id: id, mensagem })
    .select("id")
    .single();

  if (error || !data) return respostaDoErroBanco(error, "mensagem");
  return NextResponse.json({ success: true, id: data.id });
}
