/**
 * POST /api/orcamentos/voltar-para-novo — devolve o pedido de REVISAO ATENDENTE
 * para NOVO (23/10/2026, caso 24191).
 *
 * Por que existe: REVISAO ATENDENTE é status protegido na engine
 * (atualizar_status_financeiro_proposta não o rebaixa), então cancelar a última
 * cobrança não devolve o pedido a NOVO. Para o vendedor gerar cobrança nova, a
 * volta tem de ser ato próprio, com autor.
 *
 * Grava SÓ `status_interno` e uma mensagem na conversa do pedido.
 *
 * Travas (por condição, conferidas aqui; o UPDATE é guardado pelo status e pela
 * flag lidos, então quem mexer no meio derruba a gravação):
 *   - só ADM (is_super_adm ou is_admin — mesmo critério da RPC de estorno);
 *   - status atual REVISAO ATENDENTE e is_prd_aprovado = false;
 *   - nenhuma cobrança fora de CANCELADO;
 *   - sem NF-e/NFS-e autorizada de produção (helper único recusaPorNotaEmitida);
 *   - sem produção nem expedição: nenhuma linha em propostas_os_setores,
 *     producao_volumes ou expedicoes.
 * Destino: sempre NOVO (26/10/2026), a mesma regra da engine quando todas as
 * cobranças estão canceladas. A arte em andamento fica pela marcação `em_arte`;
 * "NOVO / EM ARTE" não é mais gravado por ninguém (nenhum pedido está nele).
 * Já em NOVO (ou no legado NOVO / EM ARTE): responde sucesso sem gravar.
 *
 * Corpo: { id_int: number, motivo: string }.
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { recusaPorNotaEmitida } from "@/features/orcamentos/services/nota-impede-devolucao.server";

const STATUS_ORIGEM = "REVISAO ATENDENTE";

function erro(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, code, message }, { status });
}

type PropostaRow = {
  id_int: number;
  id_cliente: number | null;
  status_interno: string | null;
  is_prd_aprovado: boolean | null;
  em_arte: boolean | null;
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const idInt = Number(body?.id_int);
  const motivo = typeof body?.motivo === "string" ? body.motivo.trim() : "";

  if (!Number.isInteger(idInt) || idInt <= 0) return erro("PARAMETRO_INVALIDO", "id_int é obrigatório.", 400);
  if (motivo.length < 5) return erro("PARAMETRO_INVALIDO", "Descreva o motivo (mínimo 5 caracteres).", 400);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[voltar-para-novo] ENV AUSENTE");
    return erro("FALHA", "Erro interno no servidor.", 500);
  }

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return erro("NEGADO", "Sessão inválida.", 401);

  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return erro("NEGADO", "Sessão inválida.", 401);

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("is_super_adm, is_admin, nome_usuario")
    .eq("user_id", authData.user.id)
    .maybeSingle<{ is_super_adm: boolean | null; is_admin: boolean | null; nome_usuario: string | null }>();
  if (!usuario?.is_super_adm && !usuario?.is_admin) {
    return erro("NEGADO", "Somente administrador pode devolver o pedido para NOVO.", 403);
  }
  const autorNome = String(usuario.nome_usuario ?? "").trim() || authData.user.email || "Usuário";

  // 1. Pedido.
  const { data: proposta, error: erroProposta } = await supabase
    .from("propostas")
    .select("id_int, id_cliente, status_interno, is_prd_aprovado, em_arte")
    .eq("id_int", idInt)
    .maybeSingle<PropostaRow>();
  if (erroProposta) return erro("FALHA", "Não foi possível ler o pedido. Nada foi alterado.", 500);
  if (!proposta) return erro("NAO_ENCONTRADA", "Pedido não encontrado.", 404);

  const statusAtual = String(proposta.status_interno ?? "").trim().toUpperCase();
  const destino = "NOVO";

  if (statusAtual === "NOVO" || statusAtual === "NOVO / EM ARTE") {
    return NextResponse.json({ success: true, idempotente: true, message: `O pedido #${idInt} já está em ${statusAtual}. Nada foi gravado.` });
  }
  if (statusAtual !== STATUS_ORIGEM) {
    return erro("STATUS_INVALIDO", `O pedido #${idInt} está ${statusAtual || "sem status"}; esta volta só vale a partir de ${STATUS_ORIGEM}.`, 409);
  }
  if (proposta.is_prd_aprovado !== false) {
    return erro("PRODUCAO_ATIVA", `O pedido #${idInt} consta liberado para a produção. Retire-o da produção antes.`, 409);
  }

  // 2. Cobranças: nenhuma fora de CANCELADO (status nulo conta como ativa).
  const { count: ativas, error: erroCobrancas } = await supabase
    .from("pagamentos_v2")
    .select("id", { count: "exact", head: true })
    .eq("id_int", idInt)
    .or("status.is.null,status.neq.CANCELADO");
  if (erroCobrancas || ativas === null) return erro("FALHA", "Não foi possível conferir as cobranças. Nada foi alterado.", 500);
  if (ativas > 0) {
    return erro("COBRANCA_ATIVA", `O pedido #${idInt} tem ${ativas} cobrança(s) fora de CANCELADO. Cancele ou estorne antes.`, 409);
  }

  // 3. Nota fiscal autorizada de produção (mesma regra das rotas de devolução).
  const recusaNota = await recusaPorNotaEmitida(supabase, idInt);
  if (recusaNota) return erro(recusaNota.code, recusaNota.message, recusaNota.httpStatus);

  // 4. Produção e expedição: qualquer linha já recusa.
  const [setores, volumes, expedicoes] = await Promise.all([
    supabase.from("propostas_os_setores").select("id", { count: "exact", head: true }).eq("id_int", idInt),
    supabase.from("producao_volumes").select("id", { count: "exact", head: true }).eq("id_int", idInt),
    supabase.from("expedicoes").select("id", { count: "exact", head: true }).eq("id_int", idInt)
  ]);
  if (setores.error || volumes.error || expedicoes.error || setores.count === null || volumes.count === null || expedicoes.count === null) {
    return erro("FALHA", "Não foi possível conferir produção e expedição. Nada foi alterado.", 500);
  }
  if ((setores.count ?? 0) > 0 || (volumes.count ?? 0) > 0) {
    return erro("PRODUCAO_ATIVA", `O pedido #${idInt} já tem produção registrada.`, 409);
  }
  if ((expedicoes.count ?? 0) > 0) {
    return erro("EXPEDICAO_REGISTRADA", `O pedido #${idInt} tem expedição registrada.`, 409);
  }

  // 5. Gravação guardada pelo que foi lido: se o status ou a flag mudaram, não grava.
  const { data: gravadas, error: erroUpdate } = await supabase
    .from("propostas")
    .update({ status_interno: destino })
    .eq("id_int", idInt)
    .eq("status_interno", proposta.status_interno as string)
    .eq("is_prd_aprovado", false)
    .select("id_int");
  if (erroUpdate) {
    console.error("[voltar-para-novo] falha no UPDATE:", erroUpdate.message);
    return erro("FALHA", "Falha ao devolver o pedido. Nada foi alterado.", 500);
  }
  if (!gravadas || gravadas.length === 0) {
    return erro("MUDOU", `O pedido #${idInt} mudou durante a operação. Recarregue e confira.`, 409);
  }

  // 6. Conversa do pedido, com o autor real. Falha aqui não desfaz a volta, mas é informada.
  const { error: erroChat } = await supabase.from("propostas_chat").insert({
    id_int: idInt,
    id_cliente: proposta.id_cliente,
    mensagem: `Pedido devolvido de ${STATUS_ORIGEM} para ${destino} por ${autorNome}. Motivo: ${motivo}`,
    tipo: "SISTEMA",
    autor_uid: authData.user.id,
    autor_nome: autorNome,
    setor: "Financeiro",
    visivel_externo: false
  });
  if (erroChat) console.error("[voltar-para-novo] falha ao gravar a conversa:", erroChat.message);

  return NextResponse.json({
    success: true,
    idempotente: false,
    status_anterior: proposta.status_interno,
    status_novo: destino,
    conversa_gravada: !erroChat
  });
}
