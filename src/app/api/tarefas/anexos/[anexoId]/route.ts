/**
 * GET /api/tarefas/anexos/[anexoId] — link assinado de 60 segundos para baixar.
 *
 * A SESSAO do usuario le a linha do anexo: o RLS so a devolve para quem
 * enxerga a tarefa (quem criou, destinatarios, responsavel, admin; equipe em
 * tarefa para todos). Sem a linha, 404 — sem dizer se o anexo existe.
 */

import { NextResponse, type NextRequest } from "next/server";
import { abrirContexto, clienteServico, recusa } from "@/features/tarefas/lib/rota-tarefas.server";
import { ANEXO_BUCKET } from "@/features/tarefas/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALIDADE_SEGUNDOS = 60;

export async function GET(request: NextRequest, contexto: { params: Promise<{ anexoId: string }> }) {
  const aberto = await abrirContexto(request);
  if (!aberto.ok) return aberto.resposta;

  const anexoId = Number((await contexto.params).anexoId);
  if (!Number.isInteger(anexoId) || anexoId <= 0) return recusa("Anexo inválido.", 400, "ID");

  const { data: anexo, error } = await aberto.ctx.supabase
    .from("tarefas_equipe_anexos")
    .select("caminho, nome_arquivo")
    .eq("id", anexoId)
    .maybeSingle();
  if (error) console.error("[api/tarefas/anexos] ler:", error.code, error.message);
  if (!anexo) return recusa("Anexo não encontrado ou sem acesso.", 404, "NAO_ENCONTRADO");

  const servico = clienteServico();
  if (!servico) return recusa("Anexos indisponíveis no momento.", 500, "ENV");

  const { data, error: errUrl } = await servico.storage
    .from(ANEXO_BUCKET)
    .createSignedUrl(anexo.caminho, VALIDADE_SEGUNDOS, { download: anexo.nome_arquivo });
  if (errUrl || !data) {
    console.error("[api/tarefas/anexos] assinar:", errUrl?.message);
    return recusa("Não foi possível gerar o link.", 500, "STORAGE");
  }
  return NextResponse.json({ success: true, url: data.signedUrl, validade: VALIDADE_SEGUNDOS });
}
