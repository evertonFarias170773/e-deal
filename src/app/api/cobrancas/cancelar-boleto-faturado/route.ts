import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cancelamento de UM título faturado do Registro de Recebíveis.
 *
 * Cancela apenas a parcela selecionada. Não usa /api/cobrancas/cancelar-externo,
 * que opera sobre a cobrança inteira de pagamentos_v2 — num faturado de N
 * parcelas isso cancelaria todas.
 *
 * Empresa 2 (Ideal Birô) vai para o Inter. Empresas 1 e 3 seguem no fluxo
 * legado: a rota devolve `delegarLegado: true` e o cliente chama
 * `deleteBoletoFromBankViaN8n` exatamente como antes.
 *
 * A regra de banco é do n8n, não daqui — o workflow VIBE-BOLETO-FATURADO-INTER
 * exclui somente o boleto cancelado e só marca pagamentos_v2 como CANCELADO
 * quando não resta parcela ativa. Esta rota NÃO duplica isso.
 */

const WEBHOOK_CANCELA_BIRO_FATURADO = "https://10074.hostoo.net.br/webhook/cancela-boleto-fat-inter";

const EMPRESA_BIRO = 2;

const STATUS_BLOQUEIA = new Set(["PAID", "CANCELADO", "CANCELADA", "EXTORNADO", "RECUSADO"]);

type CancelarRequest = {
  boletoId: string;
  motivo: string;
};

type BoletoRow = {
  id: string;
  id_int: number | null;
  id_empresa: number | null;
  id_pagamento: string | null;
  id_boleto_c6: string | null;
  status: string | null;
  paid_at: string | null;
};

type PagamentoRow = {
  id: string;
  status: string | null;
  paid_at: string | null;
};

export async function POST(request: Request) {
  let body: CancelarRequest;

  try {
    body = (await request.json()) as CancelarRequest;
  } catch {
    return NextResponse.json({ success: false, message: "Corpo da requisicao invalido." }, { status: 400 });
  }

  const { boletoId } = body;
  const motivo = String(body.motivo ?? "").trim();

  if (!boletoId) {
    return NextResponse.json({ success: false, message: "Campo boletoId ausente no body." }, { status: 400 });
  }
  if (!motivo) {
    return NextResponse.json({ success: false, message: "Motivo do cancelamento é obrigatório." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[CancelarBoletoFaturado] ENV AUSENTE");
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

  // 1. Título — fonte da verdade é o banco.
  const { data: boleto, error: fetchErr } = await supabase
    .from("boletos")
    .select("id, id_int, id_empresa, id_pagamento, id_boleto_c6, status, paid_at")
    .eq("id", boletoId)
    .maybeSingle<BoletoRow>();

  if (fetchErr || !boleto) {
    return NextResponse.json(
      { success: false, message: "Título não encontrado ou fora do escopo de acesso do usuário." },
      { status: 404 }
    );
  }

  const idEmpresa = Number(boleto.id_empresa);

  // Empresas 1 e 3: nada muda.
  if (idEmpresa !== EMPRESA_BIRO) {
    return NextResponse.json({ success: true, delegarLegado: true, idEmpresa });
  }

  // 2. Bloqueios de liquidação, no título.
  if (boleto.paid_at != null) {
    return NextResponse.json(
      { success: false, code: "PAGAMENTO_QUITADO", message: "Título já liquidado. Cancelamento não permitido." },
      { status: 409 }
    );
  }

  const statusBoleto = String(boleto.status ?? "").toUpperCase();
  if (STATUS_BLOQUEIA.has(statusBoleto)) {
    return NextResponse.json(
      { success: false, code: "PAGAMENTO_QUITADO", message: `Título com status ${statusBoleto} não pode ser cancelado.` },
      { status: 409 }
    );
  }

  // 3. Bloqueios na cobrança que originou o título.
  if (boleto.id_pagamento) {
    const { data: pagamento } = await supabase
      .from("pagamentos_v2")
      .select("id, status, paid_at")
      .eq("id_pagamento", boleto.id_pagamento)
      .maybeSingle<PagamentoRow>();

    if (pagamento) {
      // O que bloqueia é LIQUIDAÇÃO, não conferência. Num faturado, `confirmado`
      // e `data_confirmacao` são preenchidos quando a cobrança passa pela
      // Conferência — ela segue em aberto, e é exatamente aí que cancelar o
      // boleto faz sentido. Medido em produção: o 20084, pago de verdade, tem
      // `status = PAID` e `paid_at`; o 20200 e o 20101, em aberto, têm
      // `confirmado = true` com `paid_at` nulo. Tratar `confirmado` como quitação
      // travava o cancelamento de todo título já conferido.
      const statusPagamento = String(pagamento.status ?? "").toUpperCase();
      if (statusPagamento === "PAID" || pagamento.paid_at != null) {
        return NextResponse.json(
          { success: false, code: "PAGAMENTO_QUITADO", message: "Cobrança liquidada. Cancelamento não permitido." },
          { status: 409 }
        );
      }
    }
  }

  // 4. Sem identificador bancário não há o que cancelar no Inter.
  const codInter = String(boleto.id_boleto_c6 ?? "").trim();
  if (!codInter) {
    return NextResponse.json(
      { success: false, message: "Título sem identificador bancário. Não foi registrado no Inter." },
      { status: 400 }
    );
  }

  let webhookResponse: Response;
  try {
    webhookResponse = await fetch(WEBHOOK_CANCELA_BIRO_FATURADO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cod_inter: codInter, motivo })
    });
  } catch (erro) {
    console.error("[CancelarBoletoFaturado] Falha de rede ao acionar o webhook:", erro);
    return NextResponse.json(
      { success: false, message: "Não foi possível contatar a integração bancária. Nenhuma alteração foi feita." },
      { status: 502 }
    );
  }

  if (!webhookResponse.ok) {
    const detalhe = await webhookResponse.text().catch(() => "");
    console.error(`[CancelarBoletoFaturado] Webhook retornou ${webhookResponse.status}: ${detalhe.slice(0, 300)}`);
    return NextResponse.json(
      { success: false, message: "O Banco Inter recusou o cancelamento. Nenhuma alteração local foi feita." },
      { status: webhookResponse.status }
    );
  }

  const retorno = await webhookResponse.json().catch(() => null);

  if (!retorno || retorno.success === false) {
    return NextResponse.json(
      { success: false, message: retorno?.message || "A integração bancária não confirmou o cancelamento." },
      { status: 502 }
    );
  }

  // O n8n já excluiu a linha de `boletos` e decidiu sobre pagamentos_v2.
  // Aqui só confirmamos a exclusão — nenhuma escrita é repetida.
  const { data: aindaExiste } = await supabase
    .from("boletos")
    .select("id")
    .eq("id", boletoId)
    .maybeSingle<{ id: string }>();

  return NextResponse.json({
    success: true,
    boletoExcluido: !aindaExiste,
    parcelasAtivasRestantes: retorno.parcelas_ativas_restantes ?? null,
    pagamentoCancelado: retorno.pagamento_cancelado ?? null
  });
}
