/**
 * POST /api/tarefas — cria uma tarefa (ou melhoria) com seus destinatarios.
 *
 * Chama `tarefas_equipe_criar` com a sessao do usuario: tarefa e destinatarios
 * na mesma transacao; quem pode criar o que e decidido no banco (funcao +
 * trigger). Aqui so se valida o formato. Spec: 2026-09-30-tarefas-equipe-design.md
 */

import { NextResponse, type NextRequest } from "next/server";
import { abrirContexto, recusa, respostaDoErroBanco } from "@/features/tarefas/lib/rota-tarefas.server";
import { DESCRICAO_MAX, PRIORIDADES, TITULO_MAX, type TarefaPrioridade, type TarefaTipo } from "@/features/tarefas/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DESTINATARIOS = 100;

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
  const prioridade = String(body.prioridade ?? "NORMAL") as TarefaPrioridade;
  const paraTodos = body.para_todos === true;
  const destinatarios = Array.isArray(body.destinatarios) ? body.destinatarios.map(String) : [];
  const idInt = inteiroPositivoOuNulo(body.id_int);
  const idCliente = inteiroPositivoOuNulo(body.id_cliente);
  const dataLimite = body.data_limite ? String(body.data_limite) : null;

  if (!titulo) return recusa("Escreva o título da tarefa.", 400, "TITULO");
  if (titulo.length > TITULO_MAX) return recusa(`O título pode ter até ${TITULO_MAX} caracteres.`, 400, "TITULO");
  if (descricao.length > DESCRICAO_MAX) return recusa(`A descrição pode ter até ${DESCRICAO_MAX} caracteres.`, 400, "DESCRICAO");
  if (!PRIORIDADES.includes(prioridade)) return recusa("Prioridade inválida.", 400, "PRIORIDADE");
  if (destinatarios.length > MAX_DESTINATARIOS) return recusa("Pessoas demais. Use Todos.", 400, "DESTINATARIOS");
  if (destinatarios.some((d) => !UUID_RE.test(d))) return recusa("Pessoa inválida.", 400, "DESTINATARIOS");
  if (tipo === "TAREFA" && !paraTodos && destinatarios.length === 0) {
    return recusa("Escolha para quem é a tarefa: uma ou mais pessoas, ou todos.", 400, "SEM_DESTINATARIO");
  }
  if (idInt === "invalido") return recusa("Número do pedido inválido.", 400, "PEDIDO");
  if (idCliente === "invalido") return recusa("Código do cliente inválido.", 400, "CLIENTE");
  if (dataLimite && (!DATA_ISO.test(dataLimite) || Number.isNaN(Date.parse(dataLimite)))) {
    return recusa("Prazo inválido.", 400, "PRAZO");
  }

  const { data, error } = await supabase.rpc("tarefas_equipe_criar", {
    p_tipo: tipo,
    p_titulo: titulo,
    p_descricao: descricao || null,
    p_prioridade: prioridade,
    p_destinatarios: tipo === "TAREFA" && !paraTodos ? destinatarios : [],
    p_para_todos: tipo === "TAREFA" && paraTodos,
    p_id_int: idInt,
    p_id_cliente: idCliente,
    p_data_limite: dataLimite
  });

  if (error || typeof data !== "number") return respostaDoErroBanco(error, "criar");
  return NextResponse.json({ success: true, id: data });
}
