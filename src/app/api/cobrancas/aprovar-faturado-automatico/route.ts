import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Aprovação automática do E-FATURADO quando o cliente está comprovadamente
 * elegível. Decisão tomada NO SERVIDOR, com dado real — o cliente envia apenas
 * o id da cobrança e não há entrada capaz de forçar a aprovação.
 *
 * Aprovar aqui significa gravar `aprovado_por`, exatamente como faz a aprovação
 * manual (confirmar/route.ts, acao "autorizar_faturamento"). É esse campo que
 * tira a cobrança do card "Pendentes de aprovação" e a coloca na Fila de
 * Conferência. `confirmado` permanece false: a conferência humana continua.
 *
 * Nenhum status novo é criado.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NÃO BASTA `limite_disponivel >= valor`
 * ---------------------------------------------------------------------------
 * A RPC fn_analise_credito_cliente calcula:
 *
 *   limite_disponivel = greatest(limite_credito, 0)
 *                     - utilizado
 *                     + least(saldo_carteira, 0)
 *
 * e `utilizado` só soma cobranças com status A_VENCER **e confirmado = true**.
 * Ou seja: nenhuma faturada pendente consome limite. Com aprovação manual isso
 * era inofensivo (um humano via o conjunto); automatizado, deixa de ser —
 * 10 faturadas de 1.000 para um limite de 9.000 seriam todas aprovadas, cada
 * uma enxergando os 9.000 livres.
 *
 * Por isso somamos aqui o comprometido pendente (A_VENCER + confirmado = false)
 * e exigimos que sobre saldo. Como esta rota roda DEPOIS do INSERT, a cobrança
 * recém-criada já entra nessa soma — é assim que o valor solicitado é
 * considerado, sem desconto duplo.
 *
 * A base do somatório é a mesma da RPC: cobranças das propostas do cliente
 * (`propostas.id_cliente`), NÃO `pagamentos_v2.id_cliente` — que guarda o
 * pagador efetivo e pode divergir quando há id_faturado.
 */

/** Texto gravado em aprovado_por. Distingue a liberação automática da humana. */
const APROVADOR_AUTOMATICO = "Sistema - limite operacional";

type AprovarFaturadoRequest = { cobrancaId: string };

type CobrancaRow = {
  id: string;
  id_int: number | null;
  valor: number | null;
  tipo_cobranca: string | null;
  status: string | null;
  confirmado: boolean | null;
  aprovado_por: string | null;
  confirmado_por: string | null;
};

type AnaliseCreditoRow = {
  limite_credito: number | null;
  utilizado: number | null;
  limite_disponivel: number | null;
  status_credito: string | null;
  qtd_pagamentos_atrasados: number | null;
};

/** Resposta de "não aprovado": a cobrança segue pendente, sem erro para o usuário. */
function pendente(motivo: string) {
  return NextResponse.json({ success: true, aprovadoAutomaticamente: false, motivo });
}

export async function POST(request: Request) {
  let body: AprovarFaturadoRequest;

  try {
    body = (await request.json()) as AprovarFaturadoRequest;
  } catch {
    return NextResponse.json({ success: false, message: "Corpo da requisicao invalido." }, { status: 400 });
  }

  const { cobrancaId } = body;
  if (!cobrancaId) {
    return NextResponse.json({ success: false, message: "Campo cobrancaId ausente no body." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[AprovarFaturado] ENV AUSENTE");
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

  // 1. Fonte da verdade é o banco. Nada do payload é usado como dado.
  const { data: cobranca, error: fetchErr } = await supabase
    .from("pagamentos_v2")
    .select("id, id_int, valor, tipo_cobranca, status, confirmado, aprovado_por, confirmado_por")
    .eq("id", cobrancaId)
    .maybeSingle<CobrancaRow>();

  if (fetchErr || !cobranca) {
    return NextResponse.json(
      { success: false, message: "Cobrança não encontrada ou fora do escopo de acesso do usuário." },
      { status: 404 }
    );
  }

  // 2. Escopo estrito: só E-FATURADO. E-RETRABALHO, E-PERMUTA e E-AMOSTRA
  //    seguem em análise, como sempre.
  if (String(cobranca.tipo_cobranca ?? "").toUpperCase() !== "E-FATURADO") {
    return pendente("Tipo de cobrança fora do escopo da aprovação automática.");
  }

  if (String(cobranca.status ?? "").toUpperCase() !== "A_VENCER" || cobranca.confirmado === true) {
    return pendente("Cobrança não está no estado inicial de faturamento.");
  }

  // Já aprovada (automática ou manualmente): no-op idempotente.
  if (cobranca.aprovado_por || cobranca.confirmado_por) {
    return NextResponse.json({ success: true, aprovadoAutomaticamente: false, jaAprovada: true });
  }

  const valor = Number(cobranca.valor ?? 0);
  if (!Number.isFinite(valor) || valor <= 0) {
    return pendente("Valor da cobrança ausente ou inválido.");
  }

  if (cobranca.id_int == null) {
    return pendente("Cobrança sem proposta vinculada.");
  }

  // 3. Cliente da PROPOSTA — mesma chave que a RPC usa.
  const { data: proposta } = await supabase
    .from("propostas")
    .select("id_cliente")
    .eq("id_int", cobranca.id_int)
    .maybeSingle<{ id_cliente: number | null }>();

  const idCliente = Number(proposta?.id_cliente ?? 0);
  if (!Number.isFinite(idCliente) || idCliente <= 0) {
    return pendente("Proposta sem cliente vinculado.");
  }

  // 4. Análise de crédito oficial, executada no servidor.
  const { data: analiseData, error: analiseErr } = await supabase.rpc("fn_analise_credito_cliente", {
    p_id_cliente: idCliente
  });

  if (analiseErr || !Array.isArray(analiseData) || analiseData.length === 0) {
    console.error("[AprovarFaturado] Analise de credito indisponivel:", analiseErr?.message);
    return pendente("Análise de crédito indisponível.");
  }

  const analise = analiseData[0] as AnaliseCreditoRow;

  // Dado ausente ou inconsistente nunca vira aprovação.
  // O teste de null vem ANTES de Number(): `Number(null)` é 0 e passaria por
  // Number.isFinite, fazendo um `qtd_pagamentos_atrasados` nulo ser lido como
  // "nenhum vencido" — exatamente o inverso do seguro.
  if (analise.limite_disponivel == null || analise.qtd_pagamentos_atrasados == null) {
    return pendente("Dados de crédito ausentes ou inconsistentes.");
  }

  const limiteDisponivel = Number(analise.limite_disponivel);
  const qtdAtrasados = Number(analise.qtd_pagamentos_atrasados);

  if (!Number.isFinite(limiteDisponivel) || !Number.isFinite(qtdAtrasados)) {
    return pendente("Dados de crédito ausentes ou inconsistentes.");
  }

  // Cliente com restrição financeira (clientes.restricao) nunca é liberado
  // automaticamente, mesmo que o limite pareça sobrar.
  if (String(analise.status_credito ?? "").toUpperCase() === "BLOQUEADO") {
    return pendente("Cliente com restrição financeira.");
  }

  if (qtdAtrasados > 0) {
    return pendente("Cliente possui faturamento vencido em aberto.");
  }

  // 5. Comprometido pendente: A_VENCER ainda não confirmado, na mesma base da
  //    RPC. Inclui a cobrança recém-criada.
  const { data: propostasCliente, error: propErr } = await supabase
    .from("propostas")
    .select("id_int")
    .eq("id_cliente", idCliente)
    .returns<Array<{ id_int: number | null }>>();

  if (propErr) {
    console.error("[AprovarFaturado] Falha ao listar propostas do cliente:", propErr.message);
    return pendente("Não foi possível apurar o comprometido pendente.");
  }

  const idsInt = Array.from(
    new Set((propostasCliente || []).map((p) => Number(p.id_int)).filter((n) => Number.isFinite(n)))
  );

  if (!idsInt.length) {
    return pendente("Não foi possível apurar as propostas do cliente.");
  }

  const { data: pendentes, error: pendErr } = await supabase
    .from("pagamentos_v2")
    .select("id, valor")
    .in("id_int", idsInt)
    .eq("status", "A_VENCER")
    .or("confirmado.is.null,confirmado.eq.false")
    .returns<Array<{ id: string; valor: number | null }>>();

  if (pendErr) {
    console.error("[AprovarFaturado] Falha ao somar comprometido pendente:", pendErr.message);
    return pendente("Não foi possível apurar o comprometido pendente.");
  }

  const comprometidoPendente = (pendentes || []).reduce((total, item) => total + Number(item.valor ?? 0), 0);

  if (!Number.isFinite(comprometidoPendente)) {
    return pendente("Comprometido pendente inconsistente.");
  }

  // Segurança: a cobrança recém-criada tem de estar no somatório. Se não
  // estiver (replicação atrasada, filtro divergente), não aprova.
  if (!(pendentes || []).some((item) => item.id === cobrancaId)) {
    return pendente("Cobrança ainda não visível no cálculo de crédito.");
  }

  const saldo = limiteDisponivel - comprometidoPendente;

  console.info("[AprovarFaturado] avaliacao", {
    cobrancaId,
    idCliente,
    valor,
    limiteDisponivel,
    comprometidoPendente,
    saldo,
    qtdAtrasados
  });

  if (saldo < 0) {
    return pendente("Limite de crédito insuficiente considerando os faturamentos pendentes.");
  }

  // 6. Gravação condicional: a mesma corrida não aprova duas vezes, e não
  //    atropela uma aprovação manual que tenha ocorrido no meio.
  const { data: atualizada, error: updateErr } = await supabase
    .from("pagamentos_v2")
    .update({ aprovado_por: APROVADOR_AUTOMATICO })
    .eq("id", cobrancaId)
    .eq("status", "A_VENCER")
    .eq("confirmado", false)
    .is("aprovado_por", null)
    .select("id")
    .returns<Array<{ id: string }>>();

  if (updateErr) {
    console.error("[AprovarFaturado] Falha ao gravar aprovado_por:", updateErr.message);
    return pendente("Não foi possível registrar a liberação automática.");
  }

  if (!atualizada || atualizada.length === 0) {
    return NextResponse.json({ success: true, aprovadoAutomaticamente: false, jaAprovada: true });
  }

  return NextResponse.json({
    success: true,
    aprovadoAutomaticamente: true,
    aprovadoPor: APROVADOR_AUTOMATICO,
    credito: { limiteDisponivel, comprometidoPendente, saldo }
  });
}
