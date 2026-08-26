import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { verificarEscopoPropostaServerSide } from "@/lib/auth/verificar-escopo-proposta";
import { avaliarCancelamentoNoServidor } from "@/features/cobrancas/services/cancelamento-elegibilidade.server";
import { RECUSAS_DE_DINHEIRO } from "@/features/cobrancas/cancelamento-elegibilidade";

// Status de pagamentos_v2 já inativos: nunca reprocessados.
const STATUS_INATIVOS = ["CANCELADO", "CANCELADA", "EXTORNADO", "RECUSADO"];

type PagamentoRow = { id: string; status: string | null; confirmado: boolean | null };
type BoletoRow = { id: string; status: string | null; paid_at: string | null };
type MovimentoRow = { id: string; tipo: string | null; cancelado: boolean | null };

export async function POST(request: Request) {
  let body: { id_int?: number; motivo?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Corpo da requisição inválido." }, { status: 400 });
  }

  const idInt = Number(body.id_int);
  const motivo = String(body.motivo || "").trim();

  if (!body.id_int || Number.isNaN(idInt)) {
    return NextResponse.json({ success: false, message: "id_int é obrigatório." }, { status: 400 });
  }
  if (!motivo) {
    return NextResponse.json({ success: false, message: "Motivo do cancelamento é obrigatório." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[API][CancelarProposta] ENV AUSENTE");
    return NextResponse.json({ success: false, message: "Erro interno no servidor de banco de dados." }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ success: false, message: "Sessão não encontrada." }, { status: 401 });
  }

  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, message: "Sessão inválida." }, { status: 401 });
  }

  // Permissão única, sem fallback para "propostas.cancelar".
  const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, "propostas.cancel");
  if (!temPermissao) {
    return NextResponse.json({ success: false, message: "Sem permissão para cancelar proposta (propostas.cancel)." }, { status: 403 });
  }

  const { data: proposta, error: propostaErr } = await supabase
    .from("propostas")
    .select("id_int, status_interno, empresa, vendedor, id_cliente")
    .eq("id_int", idInt)
    .maybeSingle();

  if (propostaErr || !proposta) {
    return NextResponse.json({ success: false, message: "Proposta não encontrada." }, { status: 404 });
  }

  const escopoOk = await verificarEscopoPropostaServerSide(supabase, authData.user.id, {
    empresa: proposta.empresa,
    vendedor: proposta.vendedor
  });
  if (!escopoOk) {
    return NextResponse.json({ success: false, message: "Acesso negado a esta proposta." }, { status: 403 });
  }

  const statusOriginal = String(proposta.status_interno || "").trim().toUpperCase();

  // Idempotência: proposta já cancelada não reprocessa nada (sem duplicar chat).
  if (statusOriginal === "CANCELADO") {
    return NextResponse.json({ success: true, alreadyCancelled: true, message: "Proposta já estava cancelada." });
  }

  // 1) Reconsulta proposta (já feita acima), pagamentos, boletos e movimentos de crédito.
  const [pagamentosRes, boletosRes, movimentosRes] = await Promise.all([
    supabase.from("pagamentos_v2").select("id, status, confirmado").eq("id_int", idInt),
    supabase.from("boletos").select("id, status, paid_at").eq("id_int", idInt),
    supabase.from("movimento_credito").select("id, tipo, cancelado").eq("id_int", idInt).eq("tipo", "DEBITO").eq("cancelado", false)
  ]);

  const pagamentos = (pagamentosRes.data || []) as PagamentoRow[];
  const boletos = (boletosRes.data || []) as BoletoRow[];
  const movimentosDebitoAtivos = (movimentosRes.data || []) as MovimentoRow[];

  // 1a) REGRA DE NIVEL PROPOSTA: qualquer boleto liquidado no `id_int` bloqueia,
  //     mesmo que a cobranca dele ja esteja cancelada.
  //
  //     Esta checagem NAO pode virar veredito: o veredito raciocina sobre uma
  //     COBRANCA, e nao enxerga dinheiro que entrou por cobranca ja inativa.
  //     Medido em 25/08/2026: 193 propostas tem boleto liquidado sem nenhuma
  //     cobranca ativa paga — todas perderiam a protecao se esta regra saisse.
  const boletoLiquidado = boletos.some((b) => !!b.paid_at);
  if (boletoLiquidado) {
    return NextResponse.json(
      {
        success: false,
        code: "TITULO_LIQUIDADO",
        message:
          "Esta proposta tem título liquidado. Cancelar a proposta não devolve o dinheiro — " +
          "o caso é devolução, e precisa passar pelo financeiro antes."
      },
      { status: 409 }
    );
  }

  // 1b) Cobrancas ativas, pelo VEREDITO compartilhado, com o subconjunto de
  //     dinheiro (RECUSAS_DE_DINHEIRO).
  //
  //     Cancelar a proposta e ENCERRAR O PEDIDO, nao refaturar: nota fiscal
  //     autorizada e producao ativa NAO bloqueiam aqui (decisao 13 da spec).
  //     Elas protegem o refaturamento e valem nas rotas de cancelamento de
  //     cobranca.
  //
  //     MUDANCA DE COMPORTAMENTO: a regra antiga tambem barrava por
  //     `confirmado === true` isolado. Faturado aprovado e recebimento futuro
  //     autorizado, nao dinheiro recebido — mesmo criterio da regra 4. Isso
  //     destrava 268 propostas que hoje nao podem ser canceladas sem ter
  //     recebido nada.
  const cobrancasAtivas = pagamentos.filter(
    (p) => !STATUS_INATIVOS.includes(String(p.status || "").trim().toUpperCase())
  );

  // Uma passada por cobranca. Sao 1 ou 2 na esmagadora maioria das propostas,
  // e isto roda uma vez por acao do usuario.
  for (const cobranca of cobrancasAtivas) {
    const elegibilidade = await avaliarCancelamentoNoServidor(supabase, cobranca.id, RECUSAS_DE_DINHEIRO);

    if (!elegibilidade.ok) {
      return NextResponse.json(
        { success: false, code: elegibilidade.erro, message: elegibilidade.mensagem },
        { status: elegibilidade.erro === "NAO_ENCONTRADA" ? 404 : 503 }
      );
    }

    if (!elegibilidade.veredito.pode) {
      return NextResponse.json(
        { success: false, code: elegibilidade.veredito.code, message: elegibilidade.veredito.message },
        { status: 409 }
      );
    }
  }

  if (movimentosDebitoAtivos.length > 0) {
    return NextResponse.json(
      {
        success: false,
        code: "CREDITO_CONSUMIDO",
        message: "Proposta possui E-Crédito consumido e não estornado. Utilize o fluxo financeiro de estorno de crédito antes de cancelar esta proposta."
      },
      { status: 409 }
    );
  }

  // 2) Identifica exatamente as cobranças locais pendentes e não confirmadas
  // (garantido pelo bloqueio acima: nenhuma está PAID/A_VENCER-confirmada/confirmada).
  const pagamentoIdsParaCancelar = pagamentos
    .filter((p) => !STATUS_INATIVOS.includes(String(p.status || "").trim().toUpperCase()))
    .map((p) => p.id);

  const boletoIdsParaCancelar = boletos
    .filter((b) => !b.paid_at && String(b.status || "").trim().toUpperCase() !== "CANCELADO")
    .map((b) => b.id);

  // 3) Atualiza pagamentos_v2 pendentes para CANCELADO. Se falhar, a proposta
  // NÃO é cancelada.
  if (pagamentoIdsParaCancelar.length > 0) {
    const { error: errPagamentos } = await supabase
      .from("pagamentos_v2")
      .update({ status: "CANCELADO", motivo_cancela: motivo })
      .in("id", pagamentoIdsParaCancelar);

    if (errPagamentos) {
      console.error("[API][CancelarProposta] Falha ao cancelar pagamentos_v2 pendentes:", errPagamentos);
      return NextResponse.json(
        { success: false, code: "FALHA_CANCELAMENTO_COBRANCAS", message: "Não foi possível cancelar as cobranças pendentes vinculadas. A proposta NÃO foi cancelada." },
        { status: 500 }
      );
    }
  }

  // 4) Atualiza boletos pendentes do mesmo id_int para CANCELADO. Se falhar,
  // a proposta NÃO é cancelada.
  if (boletoIdsParaCancelar.length > 0) {
    const { error: errBoletos } = await supabase
      .from("boletos")
      .update({ status: "CANCELADO" })
      .in("id", boletoIdsParaCancelar);

    if (errBoletos) {
      console.error("[API][CancelarProposta] Falha ao cancelar boletos pendentes:", errBoletos);
      return NextResponse.json(
        { success: false, code: "FALHA_CANCELAMENTO_COBRANCAS", message: "Não foi possível cancelar os boletos pendentes vinculados. A proposta NÃO foi cancelada." },
        { status: 500 }
      );
    }
  }

  // 5) Releitura do status IMEDIATAMENTE antes de gravar.
  //
  // O lock otimista precisa travar no status de AGORA, não no que foi lido lá no
  // início da requisição. Entre os dois momentos o passo 3 cancelou as cobranças,
  // e o trigger de pagamentos_v2 (atualizar_status_financeiro_proposta) reage a
  // isso mexendo em status_interno. Travar no valor antigo garantia que o UPDATE
  // desta rota NUNCA batesse quando havia cobrança pendente: quem gravava o
  // CANCELADO era o trigger, e o passo 6 caía no fallback tolerante. A rota
  // precisa cancelar por conta própria — o trigger deixou de gravar CANCELADO.
  //
  // A proteção contra concorrência real continua: se OUTRA sessão mexer no status
  // entre esta releitura e o UPDATE, o lock falha e o fallback decide.
  const { data: propostaPreUpdate } = await supabase
    .from("propostas")
    .select("status_interno")
    .eq("id_int", idInt)
    .maybeSingle();

  const statusParaLock = propostaPreUpdate?.status_interno ?? proposta.status_interno;

  // 6) Somente após sucesso das cobranças, cancela a proposta (optimistic lock).
  const { data: updatedProposta, error: updateErr } = await supabase
    .from("propostas")
    .update({ status_interno: "CANCELADO" })
    .eq("id_int", idInt)
    .eq("status_interno", statusParaLock)
    .select("id_int")
    .maybeSingle();

  if (updateErr) {
    console.error("[API][CancelarProposta] Falha ao atualizar status_interno:", updateErr);
    return NextResponse.json(
      { success: false, code: "FALHA_CANCELAMENTO_PROPOSTA", message: "Cobranças pendentes foram canceladas, mas houve falha ao cancelar a proposta. Verifique manualmente." },
      { status: 500 }
    );
  }

  if (!updatedProposta) {
    // O UPDATE não bateu no lock otimista: reconsulta antes de decidir se é
    // conflito real ou se um trigger (reagindo ao cancelamento das cobranças
    // acima) já levou a proposta a CANCELADO.
    const { data: propostaAtual } = await supabase
      .from("propostas")
      .select("status_interno")
      .eq("id_int", idInt)
      .maybeSingle();

    const statusAtual = String(propostaAtual?.status_interno || "").trim().toUpperCase();
    if (statusAtual !== "CANCELADO") {
      return NextResponse.json(
        { success: false, code: "CONFLITO_CONCORRENCIA", message: "O status da proposta mudou durante o cancelamento. Recarregue e tente novamente." },
        { status: 409 }
      );
    }
    // Já está CANCELADO (trigger ou chamada concorrente idêntica) — segue como sucesso.
  }

  // 7) Registra justificativa e autor em propostas_chat (best-effort).
  const autor = authData.user.email || authData.user.id;
  const { error: chatErr } = await supabase.from("propostas_chat").insert([
    {
      id_int: idInt,
      id_cliente: proposta.id_cliente,
      mensagem: `Proposta cancelada. Motivo: ${motivo}`,
      tipo: "SISTEMA",
      autor_nome: autor,
      setor: "Comercial",
      visivel_externo: false,
      anexos: null
    }
  ]);

  if (chatErr) {
    console.error("[API][CancelarProposta] Falha ao registrar auditoria em propostas_chat:", chatErr);
  }

  return NextResponse.json({
    success: true,
    alreadyCancelled: false,
    cobrancasCanceladas: pagamentoIdsParaCancelar.length,
    boletosCancelados: boletoIdsParaCancelar.length,
    partial: !!chatErr
  });
}
