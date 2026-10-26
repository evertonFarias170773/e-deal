/**
 * POST /api/orcamentos/reativar-cancelado — tira o pedido de CANCELADO e o
 * devolve a NOVO, mantendo número, itens e arte (26/10/2026, caso 23259).
 *
 * Por que existe: CANCELADO é status protegido na engine (nenhum gatilho tira o
 * pedido de lá, decisão de 08/09/2026) e a reativação "por ato deliberado" nunca
 * ganhou porta. A única saída era duplicar, que perde a arte e a cotação de frete.
 *
 * Grava SÓ `status_interno` = NOVO e uma mensagem na conversa do pedido, com
 * autor e motivo. Não mexe em cobranças (as canceladas continuam canceladas; o
 * vendedor gera outra), crédito, arte nem itens.
 *
 * Destino é sempre NOVO, a mesma regra da engine quando todas as cobranças estão
 * canceladas (atualizar_status_financeiro_proposta). A arte em andamento fica
 * pela marcação `em_arte`, como nos demais pedidos; "NOVO / EM ARTE" não é mais
 * gravado por ninguém.
 *
 * Travas (por condição; o UPDATE é guardado pelo que foi lido):
 *   - só ADM (is_super_adm ou is_admin), motivo obrigatório;
 *   - status atual CANCELADO e is_prd_aprovado = false;
 *   - não é complemento de outro pedido (id_int_pedido_principal vazio);
 *   - nenhuma cobrança fora de CANCELADO;
 *   - sem NF-e/NFS-e autorizada de produção (helper único recusaPorNotaEmitida);
 *   - sem produção, volume nem expedição (nenhuma linha).
 * Já em NOVO: responde sucesso sem gravar.
 *
 * Corpo: { id_int: number, motivo: string }.
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { recusaPorNotaEmitida } from "@/features/orcamentos/services/nota-impede-devolucao.server";

const STATUS_ORIGEM = "CANCELADO";
const STATUS_DESTINO = "NOVO";

function erro(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, code, message }, { status });
}

type PropostaRow = {
  id_int: number;
  id_cliente: number | null;
  status_interno: string | null;
  is_prd_aprovado: boolean | null;
  id_int_pedido_principal: number | null;
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
    console.error("[reativar-cancelado] ENV AUSENTE");
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
    return erro("NEGADO", "Somente administrador pode reativar um pedido cancelado.", 403);
  }
  const autorNome = String(usuario.nome_usuario ?? "").trim() || authData.user.email || "Usuário";

  // 1. Pedido.
  const { data: proposta, error: erroProposta } = await supabase
    .from("propostas")
    .select("id_int, id_cliente, status_interno, is_prd_aprovado, id_int_pedido_principal")
    .eq("id_int", idInt)
    .maybeSingle<PropostaRow>();
  if (erroProposta) return erro("FALHA", "Não foi possível ler o pedido. Nada foi alterado.", 500);
  if (!proposta) return erro("NAO_ENCONTRADA", "Pedido não encontrado.", 404);

  const statusAtual = String(proposta.status_interno ?? "").trim().toUpperCase();
  if (statusAtual === STATUS_DESTINO) {
    return NextResponse.json({ success: true, idempotente: true, message: `O pedido #${idInt} já está em ${STATUS_DESTINO}. Nada foi gravado.` });
  }
  if (statusAtual !== STATUS_ORIGEM) {
    return erro("STATUS_INVALIDO", `O pedido #${idInt} está ${statusAtual || "sem status"}; esta reativação só vale a partir de ${STATUS_ORIGEM}.`, 409);
  }
  if (proposta.is_prd_aprovado !== false) {
    return erro("PRODUCAO_ATIVA", `O pedido #${idInt} consta liberado para a produção.`, 409);
  }
  if (proposta.id_int_pedido_principal != null) {
    return erro("COMPLEMENTO", `O pedido #${idInt} é complemento do pedido #${proposta.id_int_pedido_principal}. Complemento cancelado não é reativado por aqui.`, 409);
  }

  // 2. Cobranças: nenhuma fora de CANCELADO (status nulo conta como ativa).
  const { count: ativas, error: erroCobrancas } = await supabase
    .from("pagamentos_v2")
    .select("id", { count: "exact", head: true })
    .eq("id_int", idInt)
    .or("status.is.null,status.neq.CANCELADO");
  if (erroCobrancas || ativas === null) return erro("FALHA", "Não foi possível conferir as cobranças. Nada foi alterado.", 500);
  if (ativas > 0) {
    return erro("COBRANCA_ATIVA", `O pedido #${idInt} tem ${ativas} cobrança(s) fora de CANCELADO. Confira com o financeiro antes.`, 409);
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
  if (setores.count > 0 || volumes.count > 0) {
    return erro("PRODUCAO_ATIVA", `O pedido #${idInt} tem produção registrada.`, 409);
  }
  if (expedicoes.count > 0) {
    return erro("EXPEDICAO_REGISTRADA", `O pedido #${idInt} tem expedição registrada.`, 409);
  }

  // 5. Gravação guardada pelo que foi lido: se o status, a flag ou o vínculo mudaram, não grava.
  const { data: gravadas, error: erroUpdate } = await supabase
    .from("propostas")
    .update({ status_interno: STATUS_DESTINO })
    .eq("id_int", idInt)
    .eq("status_interno", proposta.status_interno as string)
    .eq("is_prd_aprovado", false)
    .is("id_int_pedido_principal", null)
    .select("id_int");
  if (erroUpdate) {
    console.error("[reativar-cancelado] falha no UPDATE:", erroUpdate.message);
    return erro("FALHA", "Falha ao reativar o pedido. Nada foi alterado.", 500);
  }
  if (!gravadas || gravadas.length === 0) {
    return erro("MUDOU", `O pedido #${idInt} mudou durante a operação. Recarregue e confira.`, 409);
  }

  // 6. Conversa do pedido, com o autor real. Falha aqui não desfaz a reativação, mas é informada.
  const { error: erroChat } = await supabase.from("propostas_chat").insert({
    id_int: idInt,
    id_cliente: proposta.id_cliente,
    mensagem: `Pedido reativado de ${STATUS_ORIGEM} para ${STATUS_DESTINO} por ${autorNome}. Motivo: ${motivo}`,
    tipo: "SISTEMA",
    autor_uid: authData.user.id,
    autor_nome: autorNome,
    setor: "Comercial",
    visivel_externo: false
  });
  if (erroChat) console.error("[reativar-cancelado] falha ao gravar a conversa:", erroChat.message);

  return NextResponse.json({
    success: true,
    idempotente: false,
    status_anterior: proposta.status_interno,
    status_novo: STATUS_DESTINO,
    conversa_gravada: !erroChat
  });
}
