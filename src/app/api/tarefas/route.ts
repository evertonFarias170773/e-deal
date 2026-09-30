/**
 * POST /api/tarefas — cria uma tarefa (ou melhoria).
 *
 * Grava com a sessao do usuario: quem pode criar o que, o autor e a situacao
 * inicial sao decididos pelo RLS e pela trigger `tarefas_equipe__guarda`.
 * Aqui so se valida o formato. Spec: 2026-09-30-tarefas-equipe-design.md
 */

import { NextResponse, type NextRequest } from "next/server";
import { abrirContexto, recusa, respostaDoErroBanco } from "@/features/tarefas/lib/rota-tarefas.server";
import { DESCRICAO_MAX, TITULO_MAX, type TarefaTipo } from "@/features/tarefas/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function inteiroPositivoOuNulo(valor: unknown): number | null | "invalido" {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(String(valor).trim());
  return Number.isInteger(n) && n > 0 ? n : "invalido";
}

export async function POST(request: NextRequest) {
  const aberto = await abrirContexto(request);
  if (!aberto.ok) return aberto.resposta;
  const { supabase } = aberto.ctx;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return recusa("Dados inválidos.", 400, "PAYLOAD");
  }

  const tipo: TarefaTipo = body.tipo === "MELHORIA" ? "MELHORIA" : "TAREFA";
  const titulo = String(body.titulo ?? "").trim();
  const descricao = String(body.descricao ?? "").trim();
  const responsavel = body.responsavel_user_id ? String(body.responsavel_user_id) : null;
  const idInt = inteiroPositivoOuNulo(body.id_int);
  const idCliente = inteiroPositivoOuNulo(body.id_cliente);
  const dataLimite = body.data_limite ? String(body.data_limite) : null;

  if (!titulo) return recusa("Escreva o título da tarefa.", 400, "TITULO");
  if (titulo.length > TITULO_MAX) return recusa(`O título pode ter até ${TITULO_MAX} caracteres.`, 400, "TITULO");
  if (descricao.length > DESCRICAO_MAX) return recusa(`A descrição pode ter até ${DESCRICAO_MAX} caracteres.`, 400, "DESCRICAO");
  if (tipo === "TAREFA" && !responsavel) return recusa("Escolha para quem é a tarefa.", 400, "SEM_RESPONSAVEL");
  if (responsavel && !UUID_RE.test(responsavel)) return recusa("Pessoa inválida.", 400, "RESPONSAVEL");
  if (idInt === "invalido") return recusa("Número do pedido inválido.", 400, "PEDIDO");
  if (idCliente === "invalido") return recusa("Código do cliente inválido.", 400, "CLIENTE");
  if (dataLimite && (!DATA_ISO.test(dataLimite) || Number.isNaN(Date.parse(dataLimite)))) {
    return recusa("Prazo inválido.", 400, "PRAZO");
  }

  const { data, error } = await supabase
    .from("tarefas_equipe")
    .insert({
      tipo,
      titulo,
      descricao: descricao || null,
      responsavel_user_id: responsavel,
      id_int: idInt,
      id_cliente: idCliente,
      data_limite: dataLimite
    })
    .select("id")
    .single();

  if (error || !data) return respostaDoErroBanco(error, "criar");
  return NextResponse.json({ success: true, id: data.id });
}
