/**
 * POST /api/tarefas/[id]/anexos/preparar — link de envio assinado para um anexo.
 *
 * Corpo: { nome, tipo, tamanho, momento }
 *
 * O arquivo vai do navegador direto para o bucket privado `tarefas-anexos`
 * (a Vercel nao aceita corpo de 10 MB numa rota). Antes de assinar, a SESSAO
 * do usuario precisa enxergar a tarefa, e ela precisa estar aberta ou em
 * andamento. O bucket repete os limites (10 MB, PDF e imagem).
 */

import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { abrirContexto, clienteServico, recusa, tarefaVisivel } from "@/features/tarefas/lib/rota-tarefas.server";
import { ANEXO_BUCKET, ANEXO_MAX_BYTES, ANEXO_TIPOS } from "@/features/tarefas/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, contexto: { params: Promise<{ id: string }> }) {
  const aberto = await abrirContexto(request);
  if (!aberto.ok) return aberto.resposta;

  const id = Number((await contexto.params).id);
  if (!Number.isInteger(id) || id <= 0) return recusa("Tarefa inválida.", 400, "ID");

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return recusa("Dados inválidos.", 400, "PAYLOAD");
  }
  const tipo = String(body.tipo ?? "");
  const tamanho = Number(body.tamanho);
  const extensao = ANEXO_TIPOS[tipo];
  if (!extensao) return recusa("Só PDF ou imagem (PNG, JPG, WEBP, GIF).", 400, "TIPO");
  if (!Number.isFinite(tamanho) || tamanho <= 0 || tamanho > ANEXO_MAX_BYTES) {
    return recusa("Cada arquivo pode ter até 10 MB.", 400, "TAMANHO");
  }

  const tarefa = await tarefaVisivel(aberto.ctx.supabase, id);
  if (!tarefa) return recusa("Tarefa não encontrada ou sem acesso.", 404, "NAO_ENCONTRADA");
  if (tarefa.status !== "ABERTA" && tarefa.status !== "EM_ANDAMENTO") {
    return recusa("Tarefa encerrada não recebe anexo.", 409, "ENCERRADA");
  }

  const servico = clienteServico();
  if (!servico) return recusa("Anexos indisponíveis no momento.", 500, "ENV");

  const caminho = `tarefa/${id}/${randomUUID()}.${extensao}`;
  const { data, error } = await servico.storage.from(ANEXO_BUCKET).createSignedUploadUrl(caminho);
  if (error || !data) {
    console.error("[api/tarefas/anexos/preparar]", error?.message);
    return recusa("Não foi possível preparar o envio.", 500, "STORAGE");
  }
  return NextResponse.json({ success: true, caminho: data.path, token: data.token });
}
