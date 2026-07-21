/**
 * /api/orcamentos/resolver-diferenca/route.ts
 *
 * Rota server-side para resolver a pendência de Conta Corrente aberta por
 * `cc_abrir_pendencia` (chamada em /api/orcamentos/editar-paga) quando uma
 * proposta paga é alterada.
 *
 * SEGURANÇA:
 * - JWT obrigatório
 * - Verifica permissão específica por ação (financeiro.resolver_credito,
 *   financeiro.bonificar, financeiro.devolver, financeiro.debito_futuro) —
 *   a checagem final e definitiva ocorre dentro da RPC `cc_encerrar_pendencia`
 *   (SECURITY DEFINER), esta rota só valida cedo para dar erro claro.
 *
 * MODELO (Conta Corrente — Pendências Financeiras):
 * - `idPendencia` refere-se a `public.conta_corrente_pendencias.id` (não mais
 *   `propostas_pendencias`). `movimento_credito` é a razão imutável; o saldo
 *   operacional vive em `conta_corrente_pendencias.valor_saldo`.
 * - MANTER_CREDITO / DEBITO_FUTURO / DEBITO_PENDENTE_COBRANCA: a pendência já
 *   nasceu ABERTA com o valor correto (via cc_abrir_pendencia) — nenhuma RPC
 *   de estado é necessária; apenas confirma a decisão na timeline.
 * - DEVOLVER → cc_encerrar_pendencia(DEVOLUCAO)
 * - BONIFICAR → cc_encerrar_pendencia(BONIFICACAO)
 * - ABATER_DEBITO → cc_encerrar_pendencia(ABATER_DEBITO), UMA ÚNICA chamada de
 *   RPC que consome a pendência de crédito e baixa a pendência de débito alvo
 *   dentro da MESMA transação de banco (ver Seção D.3/ABATER_DEBITO em
 *   20260721_conta_corrente_fase1a_aditiva.sql). Nunca fica em estado
 *   parcialmente concluído: se qualquer validação falhar, a RPC inteira sofre
 *   ROLLBACK e nenhuma das duas pendências é alterada.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { aplicarStatusRecomendadoProposta } from "@/features/orcamentos/services/status-writer.service";

type AcaoResolucao =
  | "MANTER_CREDITO" | "DEVOLVER" | "ABATER_DEBITO"
  | "DEBITO_PENDENTE_COBRANCA" | "BONIFICAR" | "DEBITO_FUTURO";

const ACAO_CONFIG: Record<AcaoResolucao, {
  permissao: string;
  requerDirecao: "FAVOR_CLIENTE" | "FAVOR_EMPRESA";
  mensagemTimeline: (valor: string, obs?: string) => string;
}> = {
  MANTER_CREDITO: {
    permissao: "financeiro.resolver_credito",
    requerDirecao: "FAVOR_CLIENTE",
    mensagemTimeline: (v, obs) =>
      `💰 Crédito de R$ ${v} mantido para uso futuro. Proposta alterada após pagamento.${obs ? ` Obs: ${obs}` : ""}`,
  },
  DEVOLVER: {
    permissao: "financeiro.devolver",
    requerDirecao: "FAVOR_CLIENTE",
    mensagemTimeline: (v, obs) =>
      `↩️ Solicitação de devolução de R$ ${v} registrada. Aguarda confirmação do Financeiro.${obs ? ` Obs: ${obs}` : ""}`,
  },
  ABATER_DEBITO: {
    permissao: "financeiro.resolver_credito",
    requerDirecao: "FAVOR_CLIENTE",
    mensagemTimeline: (v, obs) =>
      `🔗 Crédito de R$ ${v} abatido de débito existente.${obs ? ` Obs: ${obs}` : ""}`,
  },
  DEBITO_PENDENTE_COBRANCA: {
    permissao: "financeiro.debito_futuro",
    requerDirecao: "FAVOR_EMPRESA",
    mensagemTimeline: (v, obs) =>
      `⚠️ Débito de R$ ${v} mantido em aberto. Gere a cobrança complementar na aba Pagamentos (opção "Incluir débito").${obs ? ` Obs: ${obs}` : ""}`,
  },
  BONIFICAR: {
    permissao: "financeiro.bonificar",
    requerDirecao: "FAVOR_EMPRESA",
    mensagemTimeline: (v, obs) =>
      `🎁 Diferença de R$ ${v} bonificada comercialmente.${obs ? ` Obs: ${obs}` : ""}`,
  },
  DEBITO_FUTURO: {
    permissao: "financeiro.debito_futuro",
    requerDirecao: "FAVOR_EMPRESA",
    mensagemTimeline: (v, obs) =>
      `📋 Débito futuro de R$ ${v} mantido em aberto. Será cobrado em negociação posterior.${obs ? ` Obs: ${obs}` : ""}`,
  },
};

type UsuarioMinRow = { id_perfil: number | null; is_super_adm: boolean; is_admin: boolean };
type PerfilMinRow = { permissoes: string[] };

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

  if (acao === "ABATER_DEBITO" && (!idDebitoAlvo || !valorAbatimento || valorAbatimento <= 0)) {
    return NextResponse.json(
      { success: false, error: "idDebitoAlvo e valorAbatimento são obrigatórios para ABATER_DEBITO." },
      { status: 400 }
    );
  }

  // ── 3. Permissão da ação principal ────────────────────────────────────────
  const temPermissao = await verificarPermissao(supabase, user.id, config.permissao);
  if (!temPermissao) {
    return NextResponse.json(
      { success: false, error: `Sem permissão para a ação: ${acao} (requer ${config.permissao})` },
      { status: 403 }
    );
  }

  // ── 4. Buscar e validar a pendência (conta_corrente_pendencias) ───────────
  const { data: pendencia, error: pendenciaError } = await supabase
    .from("conta_corrente_pendencias")
    .select("id, id_int, id_cliente, direcao, status, valor_saldo, valor_reservado")
    .eq("id", idPendencia)
    .maybeSingle();

  if (pendenciaError || !pendencia) {
    return NextResponse.json({ success: false, error: "Pendência não encontrada no servidor." }, { status: 404 });
  }

  if (pendencia.id_int !== idInt || pendencia.id_cliente !== idCliente) {
    return NextResponse.json(
      { success: false, error: "Inconsistência: pendência não pertence à proposta/cliente informados." },
      { status: 400 }
    );
  }

  if (pendencia.status === "RESOLVIDA" || pendencia.status === "CANCELADA") {
    console.info(`[resolver-diferenca] Pendência ${idPendencia} já ${pendencia.status}. Resposta idempotente.`);
    return NextResponse.json({ success: true, idempotente: true, idPendencia });
  }

  if (pendencia.status !== "ABERTA" && pendencia.status !== "PARCIALMENTE_RESOLVIDA") {
    return NextResponse.json(
      { success: false, error: `Pendência em status inválido para resolução: ${pendencia.status}` },
      { status: 409 }
    );
  }

  if (pendencia.direcao !== config.requerDirecao) {
    return NextResponse.json(
      { success: false, error: `Ação ${acao} não é válida para uma pendência ${pendencia.direcao === "FAVOR_CLIENTE" ? "a favor do cliente" : "a favor da empresa"}.` },
      { status: 400 }
    );
  }

  // Tolerância de R$ 0,02 contra o total pendente (saldo + eventual reserva) —
  // proteção contra estado de UI desatualizado, mas o valor efetivamente
  // aplicado é sempre o saldo/servidor, nunca o valor bruto enviado pelo cliente.
  const totalPendente = Math.round((Number(pendencia.valor_saldo) + Number(pendencia.valor_reservado)) * 100) / 100;
  if (Math.abs(valor - totalPendente) > 0.02) {
    return NextResponse.json(
      {
        success: false,
        error: `Inconsistência de valores: o valor informado (R$ ${valor.toFixed(2)}) difere do saldo pendente no servidor (R$ ${totalPendente.toFixed(2)}). Recarregue a proposta e tente novamente.`,
      },
      { status: 400 }
    );
  }

  const valorMovimento = acao === "ABATER_DEBITO" && valorAbatimento ? valorAbatimento : pendencia.valor_saldo;
  const obsCompleta = [
    observacao,
    acao === "ABATER_DEBITO" && idDebitoAlvo ? `Débito alvo (pendência #${idDebitoAlvo}).` : null,
    `Operador: ${user.email}. Proposta #${idInt}.`,
  ].filter(Boolean).join(" ");

  // ── 5. Executar a ação ─────────────────────────────────────────────────────
  if (acao === "MANTER_CREDITO" || acao === "DEBITO_FUTURO" || acao === "DEBITO_PENDENTE_COBRANCA") {
    // A pendência já nasceu ABERTA com o valor correto (cc_abrir_pendencia).
    // Nenhuma RPC de estado é necessária — apenas confirma a decisão na timeline.
    await supabase.from("propostas_chat").insert([{
      id_int: idInt,
      id_cliente: idCliente,
      mensagem: config.mensagemTimeline(valorMovimento.toFixed(2).replace(".", ","), observacao),
      tipo: "SISTEMA",
      autor_nome: "Sistema",
      setor: "Financeiro",
      visivel_externo: false,
      anexos: null,
    }]);
  } else if (acao === "DEVOLVER") {
    const { error: rpcError } = await supabase.rpc("cc_encerrar_pendencia", {
      p_id_pendencia: idPendencia,
      p_modo: "DEVOLUCAO",
      p_valor: valorMovimento,
      p_id_movimento_ref: null,
      p_chave_reserva: null,
      p_motivo: "DEVOLVER",
      p_observacao: obsCompleta,
    });
    if (rpcError) {
      return NextResponse.json({ success: false, error: rpcError.message }, { status: 400 });
    }
  } else if (acao === "BONIFICAR") {
    const { error: rpcError } = await supabase.rpc("cc_encerrar_pendencia", {
      p_id_pendencia: idPendencia,
      p_modo: "BONIFICACAO",
      p_valor: valorMovimento,
      p_id_movimento_ref: null,
      p_chave_reserva: null,
      p_motivo: "BONIFICAR",
      p_observacao: obsCompleta,
    });
    if (rpcError) {
      return NextResponse.json({ success: false, error: rpcError.message }, { status: 400 });
    }
  } else if (acao === "ABATER_DEBITO") {
    // Operação ATÔMICA: uma única chamada de RPC consome a pendência de
    // crédito desta proposta (idPendencia) e baixa a pendência de débito alvo
    // (idDebitoAlvo) na MESMA transação de banco. Não existe estado
    // parcialmente concluído — se qualquer validação falhar, nenhuma das
    // duas pendências é alterada (ROLLBACK implícito da função).
    const { error: rpcError } = await supabase.rpc("cc_encerrar_pendencia", {
      p_id_pendencia: idDebitoAlvo,
      p_modo: "ABATER_DEBITO",
      p_valor: valorAbatimento,
      p_id_movimento_ref: null,
      p_chave_reserva: null,
      p_motivo: "ABATER_DEBITO",
      p_observacao: `Abatido com crédito da proposta #${idInt} (pendência #${idPendencia}). ${obsCompleta}`,
      p_id_pendencia_credito: idPendencia,
    });
    if (rpcError) {
      return NextResponse.json({ success: false, error: rpcError.message }, { status: 400 });
    }
  }

  console.info(`[resolver-diferenca] Concluído: acao=${acao}, proposta=#${idInt}, pendencia=${idPendencia}`);

  // ── 6. Reconciliar status_interno pelo fluxo oficial ───────────────────────
  const reconciliacao = await aplicarStatusRecomendadoProposta(
    idInt,
    { uid: user.id, nome: user.email ?? "Sistema", email: user.email ?? "" },
    supabase,
    "AUTO_FINANCEIRO"
  );
  if (!reconciliacao.success) {
    console.warn(`[resolver-diferenca] Reconciliação de status sem efeito para proposta #${idInt}: ${reconciliacao.errorMessage}`);
  }

  return NextResponse.json({ success: true, acao, idPendencia });
}
