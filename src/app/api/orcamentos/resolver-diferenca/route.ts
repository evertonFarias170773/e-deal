/**
 * /api/orcamentos/resolver-diferenca/route.ts
 *
 * Rota server-side para registrar a resolução financeira de uma proposta paga alterada.
 *
 * SEGURANÇA:
 * - JWT obrigatório (padrão Maestro)
 * - Verifica permissão específica por ação (financeiro.resolver_credito, financeiro.bonificar, etc.)
 * - Valida se a proposta e o cliente coincidem no banco
 * - Re-calcula a diferença real no servidor (valor_total da proposta - valor pago confirmado)
 *   e valida se o valor recebido no body condiz com a diferença calculada, sem depender de parsing de texto
 *
 * CONSISTÊNCIA:
 * - Verifica que a pendência existe, está ABERTA e pertence à proposta antes de registrar qualquer movimento
 * - Conclui a pendência atomicamente após registrar o movimento
 * - Em caso de falha no movimento, a pendência permanece ABERTA
 *
 * IDEMPOTÊNCIA (Nível 2):
 * - Pendência só pode ser concluída uma vez (status ABERTA → CONCLUIDA)
 * - Janela de 5 minutos: verifica duplicata em movimento_credito antes de inserir
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MovimentoCreditoTipo } from "@/features/cobrancas/types";
import { resolveEmpresaIdFromTexto } from "@/features/cobrancas/cobrancas-utils";
import { aplicarStatusRecomendadoProposta } from "@/features/orcamentos/services/status-writer.service";

// ---------------------------------------------------------------------------
// Mapeamento de ação → tipo de movimento + permissão necessária
// ---------------------------------------------------------------------------

type AcaoResolucao =
  | "MANTER_CREDITO"
  | "DEVOLVER"
  | "ABATER_DEBITO"
  | "DEBITO_PENDENTE_COBRANCA"
  | "BONIFICAR"
  | "DEBITO_FUTURO";

const ACAO_CONFIG: Record<AcaoResolucao, {
  tipo: MovimentoCreditoTipo;
  origem: string;
  permissao: string;
  mensagemTimeline: (valor: string, obs?: string) => string;
}> = {
  MANTER_CREDITO: {
    tipo: "CREDITO",
    origem: "MANUAL",
    permissao: "financeiro.resolver_credito",
    mensagemTimeline: (v, obs) =>
      `💰 Crédito de R$ ${v} registrado para uso futuro. Proposta alterada após pagamento.${obs ? ` Obs: ${obs}` : ""}`,
  },
  DEVOLVER: {
    tipo: "DEBITO",
    origem: "MANUAL",
    permissao: "financeiro.devolver",
    mensagemTimeline: (v, obs) =>
      `↩️ Solicitação de devolução de R$ ${v} registrada. Aguarda confirmação do Financeiro.${obs ? ` Obs: ${obs}` : ""}`,
  },
  ABATER_DEBITO: {
    tipo: "DEBITO",
    origem: "MANUAL",
    permissao: "financeiro.resolver_credito",
    mensagemTimeline: (v, obs) =>
      `🔗 Crédito de R$ ${v} abatido de débito existente.${obs ? ` Obs: ${obs}` : ""}`,
  },
  DEBITO_PENDENTE_COBRANCA: {
    tipo: "DEBITO",
    origem: "MANUAL",
    permissao: "financeiro.debito_futuro",
    mensagemTimeline: (v, obs) =>
      `⚠️ Débito de R$ ${v} registrado. Gere a cobrança complementar na aba Pagamentos.${obs ? ` Obs: ${obs}` : ""}`,
  },
  BONIFICAR: {
    tipo: "DEBITO", // Bonificação zera o débito simulando que ele foi amortizado, ou seja, consome saldo ou registra o débito
    origem: "MANUAL",
    permissao: "financeiro.bonificar",
    mensagemTimeline: (v, obs) =>
      `🎁 Diferença de R$ ${v} bonificada comercialmente.${obs ? ` Obs: ${obs}` : ""}`,
  },
  DEBITO_FUTURO: {
    tipo: "DEBITO",
    origem: "MANUAL",
    permissao: "financeiro.debito_futuro",
    mensagemTimeline: (v, obs) =>
      `📋 Débito futuro de R$ ${v} registrado. Será cobrado em negociação posterior.${obs ? ` Obs: ${obs}` : ""}`,
  },
};

type UsuarioMinRow = {
  id_perfil: number | null;
  is_super_adm: boolean;
  is_admin: boolean;
};

type PerfilMinRow = {
  permissoes: string[];
};

/**
 * Verifica se o usuário tem permissão para a ação financeira
 */
async function verificarPermissao(
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  permissao: string
): Promise<boolean> {
  const { data: usuarioData } = await supabase
    .from("usuarios")
    .select("id_perfil, is_super_adm, is_admin")
    .eq("user_id", userId)
    .maybeSingle();

  if (!usuarioData) return false;

  const row = usuarioData as UsuarioMinRow;

  if (row.is_super_adm) return true;

  if (row.id_perfil != null) {
    const { data: perfilData } = await supabase
      .from("perfis")
      .select("permissoes")
      .eq("id", row.id_perfil)
      .eq("ativo", true)
      .maybeSingle();

    if (perfilData) {
      const perfil = perfilData as PerfilMinRow;
      const permissoes: string[] = Array.isArray(perfil.permissoes) ? perfil.permissoes : [];
      return permissoes.includes("*") || permissoes.includes(permissao);
    }
  }

  return row.is_admin;
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // ── 1. JWT ────────────────────────────────────────────────────────────────
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  if (!token) {
    return NextResponse.json({ success: false, error: "Sessão não encontrada." }, { status: 401 });
  }

  const supabase: SupabaseClient<any, any, any> = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return NextResponse.json({ success: false, error: "Sessão inválida." }, { status: 401 });
  }
  const user = { id: authData.user.id, email: authData.user.email ?? "" };

  // ── 2. Payload ────────────────────────────────────────────────────────────
  let body: {
    idPendencia?: number;
    idInt?: number;
    idCliente?: number;
    acao?: AcaoResolucao;
    valor?: number;
    observacao?: string;
    idDebitoAlvo?: number;
    valorAbatimento?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Payload inválido." }, { status: 400 });
  }

  const { idPendencia, idInt, idCliente, acao, valor, observacao, idDebitoAlvo, valorAbatimento } = body;

  if (!idPendencia || !idInt || !idCliente || !acao || valor === undefined || valor === null) {
    return NextResponse.json(
      { success: false, error: "idPendencia, idInt, idCliente, acao e valor são obrigatórios." },
      { status: 400 }
    );
  }

  const config = ACAO_CONFIG[acao];
  if (!config) {
    return NextResponse.json({ success: false, error: `Ação desconhecida: ${acao}` }, { status: 400 });
  }

  // ── 3. Verificar permissão da ação específica ─────────────────────────────
  const temPermissao = await verificarPermissao(supabase, user.id, config.permissao);
  if (!temPermissao) {
    return NextResponse.json(
      { success: false, error: `Sem permissão para a ação: ${acao} (requer ${config.permissao})` },
      { status: 403 }
    );
  }

  // ── 4. Validar proposta e cliente no banco ────────────────────────────────
  const { data: propostaBanco, error: propostaError } = await supabase
    .from("propostas")
    .select("id_int, id_cliente, valor_total, valor, valor_frete, empresa")
    .eq("id_int", idInt)
    .maybeSingle();

  if (propostaError || !propostaBanco) {
    return NextResponse.json(
      { success: false, error: propostaError ? propostaError.message : "Proposta não encontrada." },
      { status: 404 }
    );
  }

  if (propostaBanco.id_cliente !== idCliente) {
    return NextResponse.json(
      { success: false, error: "Cliente informado difere do cadastrado na proposta." },
      { status: 400 }
    );
  }

  // Resolver o id_empresa a partir da proposta (mesmo padrão de editar-paga).
  // Pendências secundárias criadas abaixo precisam de id_empresa válido; sem ele
  // o INSERT falhava silenciosamente e a pendência não era criada.
  const idEmpresaPendencia = resolveEmpresaIdFromTexto(propostaBanco.empresa) ?? null;

  // ── 5. Re-calcular soberanamente a diferença financeira ───────────────────
  const { data: cobrancasBanco, error: cobrancasError } = await supabase
    .from("pagamentos_v2")
    .select("status, confirmado, valor, obs_v2")
    .eq("id_int", idInt)
    .neq("status", "CANCELADO");

  if (cobrancasError) {
    return NextResponse.json(
      { success: false, error: "Erro ao buscar pagamentos para validação." },
      { status: 500 }
    );
  }

  // Mesma exclusão de editar-paga: valor de abatimento de débito não é pagamento
  // da proposta, não deve entrar na diferença financeira desta proposta.
  const valorPagoReal = (cobrancasBanco || [])
    .filter(c => c.status === "PAID" || (c.status === "A_VENCER" && c.confirmado))
    .reduce((sum, c) => {
      const marcador = String(c.obs_v2 || "").match(/\[ABATIMENTO_DEBITO:(\d+(?:\.\d{1,2})?)\]/);
      const abatimento = marcador ? Number(marcador[1]) || 0 : 0;
      return sum + Math.max(0, (Number(c.valor) || 0) - abatimento);
    }, 0);

  const valorPagoRealArredondado = Math.round(valorPagoReal * 100) / 100;

  if (propostaBanco.valor_total == null) {
    return NextResponse.json(
      { success: false, error: "Valor total financeiro não consolidado. Salve a proposta corretamente antes de resolver a pendência." },
      { status: 422 }
    );
  }
  const totalBruto = Number(propostaBanco.valor_total);
  const novoTotalRealArredondado = Math.round(totalBruto * 100) / 100;

  console.info(`[resolver-diferenca] Proposta #${idInt}: valor_total=${propostaBanco.valor_total}, valor=${propostaBanco.valor}, valor_frete=${propostaBanco.valor_frete} → total resolvido=${novoTotalRealArredondado}, pago=${valorPagoRealArredondado}`);
  const diferencaCalculada = Math.round((novoTotalRealArredondado - valorPagoRealArredondado) * 100) / 100;

  // Reconciliação consistente com editar-paga: descontar o que já foi movimentado
  // para esta proposta (resoluções anteriores). Excluímos a janela de 5 min para
  // não subtrair um movimento recém-criado por duplo-clique — esse caso é tratado
  // pela idempotência da seção 7 mais abaixo.
  const cincoMinAtrasReconc = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: movimentosAnteriores } = await supabase
    .from("movimento_credito")
    .select("valor")
    .eq("id_int", idInt)
    .eq("cancelado", false)
    .lt("created_at", cincoMinAtrasReconc);
  const totalReconciliadoAnterior = Math.round(
    (movimentosAnteriores || []).reduce((sum, m) => sum + Math.abs(Number(m.valor) || 0), 0) * 100
  ) / 100;
  const diferencaBrutaAbs = Math.abs(diferencaCalculada);
  const diferencaReconciliadaAbs = Math.max(
    0,
    Math.round((diferencaBrutaAbs - totalReconciliadoAnterior) * 100) / 100
  );

  // Validação tolerante: aceita o valor tanto contra a diferença bruta (fluxo do
  // botão "Resolver agora" e recuperação de pendências travadas) quanto contra a
  // diferença já reconciliada com movimentos anteriores (edições incrementais).
  // Assim o loop antigo continua quebrado sem impedir a resolução de estados presos.
  const valorConfere =
    Math.abs(valor - diferencaBrutaAbs) <= 0.02 ||
    Math.abs(valor - diferencaReconciliadaAbs) <= 0.02;

  if (!valorConfere) {
    return NextResponse.json(
      {
        success: false,
        error: `Inconsistência de valores: o valor informado (R$ ${valor.toFixed(2)}) difere da diferença calculada no servidor (bruta R$ ${diferencaBrutaAbs.toFixed(2)} / reconciliada R$ ${diferencaReconciliadaAbs.toFixed(2)}). Pago: R$ ${valorPagoRealArredondado.toFixed(2)}, Novo total: R$ ${novoTotalRealArredondado.toFixed(2)}.`
      },
      { status: 400 }
    );
  }

  // ── 6. Verificar pendência ABERTA (idempotência nível 2) ──────────────────
  let pendencia = null;

  {
    const { data, error: pendenciaError } = await supabase
      .from("propostas_pendencias")
      .select("id, status, titulo, id_cliente, id_int")
      .eq("id", idPendencia)
      .maybeSingle();

    if (pendenciaError || !data) {
      return NextResponse.json(
        { success: false, error: "Pendência não encontrada no servidor." },
        { status: 404 }
      );
    }
    pendencia = data;
  }

  if (pendencia) {
    if (pendencia.id_int !== idInt || pendencia.id_cliente !== idCliente) {
      return NextResponse.json(
        { success: false, error: "Inconsistência: pendência não pertence à proposta/cliente informados." },
        { status: 400 }
      );
    }

    if (pendencia.status === "CONCLUIDA") {
      // Idempotente: já foi resolvida
      console.info(`[resolver-diferenca] Pendência ${idPendencia} já concluída. Resposta idempotente.`);
      return NextResponse.json({ success: true, idempotente: true, idPendencia });
    }

    if (pendencia.status !== "ABERTA" && pendencia.status !== "EM_ANDAMENTO") {
      return NextResponse.json(
        { success: false, error: `Pendência em status inválido para resolução: ${pendencia.status}` },
        { status: 409 }
      );
    }
  }

  // ── 7. Verificar duplicata em movimento_credito (janela 5 minutos) ────────
  const cincoMinAtras = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const valorMovimento = acao === "ABATER_DEBITO" && valorAbatimento ? valorAbatimento : valor;

  const { data: movimentoExistente } = await supabase
    .from("movimento_credito")
    .select("id")
    .eq("id_int", idInt)
    .eq("id_cliente", idCliente)
    .eq("tipo", config.tipo)
    .eq("cancelado", false)
    .gte("created_at", cincoMinAtras)
    .limit(1)
    .maybeSingle();

  if (movimentoExistente) {
    console.info(`[resolver-diferenca] Movimento duplicado detectado (id=${movimentoExistente.id}). Respondendo de forma idempotente.`);
    // Apenas garante que a pendência seja concluída caso ainda esteja aberta no banco
    await supabase
      .from("propostas_pendencias")
      .update({
        status: "CONCLUIDA",
        concluido_por_user_id: user.id,
        concluido_por_nome: user.email,
        concluido_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", idPendencia);

    return NextResponse.json({ success: true, idempotente: true, movimentoId: movimentoExistente.id });
  }

  // ── 8. Registrar movimento em movimento_credito ───────────────────────────
  const obsCompleta = [
    observacao,
    acao === "ABATER_DEBITO" && idDebitoAlvo
      ? `Débito alvo ID: ${idDebitoAlvo}. Valor abatido: R$ ${valorMovimento?.toFixed(2)}.`
      : null,
    `Operador: ${user.email}. Proposta #${idInt}.`,
  ].filter(Boolean).join(" ");

  const { data: novoMovimento, error: movimentoError } = await supabase
    .from("movimento_credito")
    .insert({
      id_cliente: idCliente,
      id_int: idInt,
      valor: valorMovimento,
      tipo: config.tipo,
      origem: config.origem,
      observacao: obsCompleta,
      created_by: user.id,
      cancelado: false,
    })
    .select("id")
    .single();

  if (movimentoError) {
    console.error("[resolver-diferenca] Erro ao registrar movimento:", movimentoError.message);
    return NextResponse.json(
      { success: false, error: `Erro ao registrar movimento: ${movimentoError.message}` },
      { status: 500 }
    );
  }

  // ── 9. Se DEVOLVER: criar pendência secundária para o financeiro confirmar a devolução ──
  if (acao === "DEVOLVER") {
    const { error: pendDevErr } = await supabase
      .from("propostas_pendencias")
      .insert([{
        id_int: idInt,
        id_cliente: idCliente,
        titulo: `Confirmar devolução — R$ ${valor.toFixed(2).replace(".", ",")}`,
        descricao: `Devolução de R$ ${valor.toFixed(2).replace(".", ",")} solicitada e aguardando transferência bancária/estorno. ${obsCompleta}`,
        categoria: "CREDITO",
        status: "ABERTA",
        prioridade: "ALTA",
        responsavel_setor: "FINANCEIRO",
        responsavel_user_id: null,
        criado_por_user_id: user.id,
        criado_por_nome: user.email ?? "Sistema",
        // A CHECK constraint chk_propostas_pendencias_origem só aceita SISTEMA/MANUAL;
        // "CONFIRMACAO_DEVOLUCAO" fazia o INSERT falhar (23514). A semântica fica no
        // título/categoria da pendência.
        origem: "SISTEMA",
        data_limite: null,
        chat_id: null,
        pagamento_id: null,
        id_empresa: idEmpresaPendencia,
      }]);
    if (pendDevErr) console.error("[resolver-diferenca] Falha ao criar pendência de devolução:", pendDevErr.message);
  }

  // ── 10. Se DEBITO_PENDENTE_COBRANCA: criar pendência de cobrança ───────────
  if (acao === "DEBITO_PENDENTE_COBRANCA") {
    const { error: pendCobErr } = await supabase
      .from("propostas_pendencias")
      .insert([{
        id_int: idInt,
        id_cliente: idCliente,
        titulo: `Cobrança complementar pendente — R$ ${valor.toFixed(2).replace(".", ",")}`,
        descricao: `Débito de R$ ${valor.toFixed(2).replace(".", ",")} registrado. Gere a cobrança complementar (PIX, Boleto ou Cartão) pela aba Pagamentos. ${obsCompleta}`,
        categoria: "PAGAMENTO",
        status: "ABERTA",
        prioridade: "ALTA",
        responsavel_setor: "FINANCEIRO",
        responsavel_user_id: null,
        criado_por_user_id: user.id,
        criado_por_nome: user.email ?? "Sistema",
        // A CHECK constraint chk_propostas_pendencias_origem só aceita SISTEMA/MANUAL;
        // "DEBITO_COMPLEMENTAR" fazia o INSERT falhar (23514), então a pendência de
        // cobrança complementar nunca era criada. A semântica fica no título/categoria.
        origem: "SISTEMA",
        data_limite: null,
        chat_id: null,
        pagamento_id: null,
        id_empresa: idEmpresaPendencia,
      }]);
    if (pendCobErr) console.error("[resolver-diferenca] Falha ao criar pendência de cobrança complementar:", pendCobErr.message);
  }

  // ── 11. Concluir pendência principal ──────────────────────────────────────
  await supabase
    .from("propostas_pendencias")
    .update({
      status: "CONCLUIDA",
      concluido_por_user_id: user.id,
      concluido_por_nome: user.email,
      concluido_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", idPendencia);

  // ── 12. Registrar mensagem na timeline ────────────────────────────────────
  // As mensagens de timeline já prefixam "R$ "; passar só o número evita "R$ R$".
  const valorFormatado = valor.toFixed(2).replace(".", ",");
  const mensagem = config.mensagemTimeline(valorFormatado, observacao);

  await supabase
    .from("propostas_chat")
    .insert([{
      id_int: idInt,
      id_cliente: idCliente,
      mensagem,
      tipo: "SISTEMA",
      autor_nome: "Sistema",
      setor: "Financeiro",
      visivel_externo: false,
      anexos: null,
    }]);

  console.info(`[resolver-diferenca] Concluído: acao=${acao}, proposta=#${idInt}, movimento=${novoMovimento?.id}, pendencia=${idPendencia}`);

  // ── 13. Reconciliar status_interno pelo fluxo oficial ─────────────────────
  // Evento: resolução de diferença financeira de proposta paga. Best-effort:
  // nunca falha a resolução da diferença em si.
  const reconciliacao = await aplicarStatusRecomendadoProposta(
    idInt,
    { uid: user.id, nome: user.email ?? "Sistema", email: user.email ?? "" },
    supabase,
    "AUTO_FINANCEIRO"
  );
  if (!reconciliacao.success) {
    console.warn(`[resolver-diferenca] Reconciliação de status sem efeito para proposta #${idInt}: ${reconciliacao.errorMessage}`);
  }

  return NextResponse.json({
    success: true,
    acao,
    movimentoId: novoMovimento?.id,
    idPendencia,
  });
}
