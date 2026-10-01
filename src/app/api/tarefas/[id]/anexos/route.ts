/**
 * POST /api/tarefas/[id]/anexos — registra um anexo ja enviado ao bucket.
 *
 * Corpo: { caminho, nome, momento }
 *
 * Confere no storage que o arquivo chegou e le dele o tamanho e o tipo reais
 * (nao confia no que o navegador diz). Grava a linha com a SESSAO do usuario:
 * o RLS exige que ele enxergue a tarefa e que ela esteja ativa. Se a linha
 * nao grava, o arquivo e removido — anexo sem linha nao fica no bucket.
 */

import { NextResponse, type NextRequest } from "next/server";
import { abrirContexto, clienteServico, recusa, respostaDoErroBanco } from "@/features/tarefas/lib/rota-tarefas.server";
import { ANEXO_BUCKET, ANEXO_MAX_BYTES, ANEXO_TIPOS, type AnexoMomento } from "@/features/tarefas/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MOMENTOS: AnexoMomento[] = ["CRIACAO", "ANDAMENTO", "CONCLUSAO"];

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
  const caminho = String(body.caminho ?? "");
  const nome = String(body.nome ?? "").trim().slice(0, 200) || "anexo";
  const momento = String(body.momento ?? "ANDAMENTO") as AnexoMomento;
  if (!MOMENTOS.includes(momento)) return recusa("Momento inválido.", 400, "MOMENTO");
  const esperado = new RegExp(`^tarefa/${id}/[0-9a-f-]{36}\\.(pdf|png|jpg|webp|gif)$`);
  if (!esperado.test(caminho)) return recusa("Arquivo inválido.", 400, "CAMINHO");

  const servico = clienteServico();
  if (!servico) return recusa("Anexos indisponíveis no momento.", 500, "ENV");
  const bucket = servico.storage.from(ANEXO_BUCKET);

  const { data: info, error: errInfo } = await bucket.info(caminho);
  if (errInfo || !info) return recusa("O arquivo não chegou. Envie de novo.", 400, "SEM_ARQUIVO");

  const tamanho = Number(info.size ?? 0);
  const tipo = String(info.contentType ?? "");
  if (!ANEXO_TIPOS[tipo] || tamanho <= 0 || tamanho > ANEXO_MAX_BYTES) {
    await bucket.remove([caminho]);
    return recusa("Só PDF ou imagem, até 10 MB.", 400, "TIPO");
  }

  const { data, error } = await aberto.ctx.supabase
    .from("tarefas_equipe_anexos")
    .insert({ tarefa_id: id, momento, nome_arquivo: nome, caminho, tipo_mime: tipo, tamanho_bytes: tamanho })
    .select("id")
    .single();

  if (error || !data) {
    await bucket.remove([caminho]);
    return respostaDoErroBanco(error, "registrar anexo");
  }
  return NextResponse.json({ success: true, id: data.id });
}
