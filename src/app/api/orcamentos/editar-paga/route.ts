/**
 * /api/orcamentos/editar-paga/route.ts
 *
 * Rota server-side para salvar propostas.
 *
 * SEGURANÇA:
 * - Valida JWT via Authorization: Bearer <token> (padrão Maestro)
 * - Identifica soberanamente se a proposta é paga (possui pagamentos confirmados)
 * - Se for paga, exige a permissão `propostas.editar_paga`
 * - Valida server-side se o id_int existe no banco
 * - Valida server-side se o id_cliente coincide com o da proposta no banco
 * - `saveProposta` é executada com o cliente autenticado injetado (sem bypass de RLS)
 *
 * CONSISTÊNCIA FINANCEIRA (Conta Corrente — Pendências Financeiras):
 * - Se diferença financeira ≠ 0 após o salvamento, abre/ajusta uma pendência via
 *   RPC `cc_abrir_pendencia` (public.conta_corrente_pendencias). A pendência NÃO
 *   bloqueia novas edições da proposta: alterações sucessivas reconciliam a
 *   mesma pendência aberta (a RPC ajusta o valor, nunca duplica).
 * - `movimento_credito` permanece a razão imutável (auditoria/reconciliação);
 *   o saldo operacional da pendência vive em `conta_corrente_pendencias.valor_saldo`.
 *
 * IDEMPOTÊNCIA:
 * - `chaveEvento` (UUID por tentativa de salvar) evita duplicar a abertura em
 *   caso de retry/duplo clique — ver `cc_abrir_pendencia`.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { saveProposta } from "@/features/orcamentos/services/orcamentos.service";
import type { PropostaFormState } from "@/features/orcamentos/types";
import { aplicarStatusRecomendadoProposta } from "@/features/orcamentos/services/status-writer.service";

// ---------------------------------------------------------------------------
// Configurações e Tipagens
// ---------------------------------------------------------------------------

const PERMISSOES_FALLBACK_ADMIN: string[] = [
  "propostas.editar_paga", "financeiro.resolver_credito", "financeiro.bonificar",
  "financeiro.devolver", "financeiro.debito_futuro", "credito.usar"
];

type UsuarioMinRow = {
  id_perfil: number | null;
  is_super_adm: boolean;
  is_admin: boolean;
};

type PerfilMinRow = {
  permissoes: string[];
};

/**
 * Verifica se o usuário tem permissão para editar proposta paga
 */
async function verificarPermissaoEditarPaga(
  supabase: SupabaseClient<any, any, any>,
  userId: string
): Promise<{ autorizado: boolean; motivo?: string }> {
  const { data: usuarioData, error: usuarioError } = await supabase
    .from("usuarios")
    .select("id_perfil, is_super_adm, is_admin")
    .eq("user_id", userId)
    .maybeSingle();

  if (usuarioError || !usuarioData) {
    return { autorizado: false, motivo: "Usuário não encontrado em public.usuarios." };
  }

  const row = usuarioData as UsuarioMinRow;

  if (row.is_super_adm) {
    return { autorizado: true };
  }

  if (row.id_perfil != null) {
    const { data: perfilData, error: perfilError } = await supabase
      .from("perfis")
      .select("permissoes")
      .eq("id", row.id_perfil)
      .eq("ativo", true)
      .maybeSingle();

    if (!perfilError && perfilData) {
      const perfil = perfilData as PerfilMinRow;
      const permissoes: string[] = Array.isArray(perfil.permissoes) ? perfil.permissoes : [];
      if (permissoes.includes("*") || permissoes.includes("propostas.editar_paga")) {
        return { autorizado: true };
      }
      return { autorizado: false, motivo: "Perfil sem permissão propostas.editar_paga." };
    }
  }

  if (row.is_admin) {
    const temPermissao = PERMISSOES_FALLBACK_ADMIN.includes("propostas.editar_paga");
    return { autorizado: temPermissao };
  }

  return { autorizado: false, motivo: "Sem permissão para editar proposta paga." };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // ── 1. Extrair e validar JWT ──────────────────────────────────────────────
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  // ── Validar variáveis de ambiente ────────────────────────────────────────
  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.error("[editar-paga] ENV AUSENTE:", {
      hasUrl: Boolean(url),
      hasAnonKey: Boolean(anonKey),
    });
    return NextResponse.json(
      { success: false, error: "Configuração de ambiente incompleta. Contate o administrador." },
      { status: 500 }
    );
  }

  if (!token) {
    return NextResponse.json(
      { success: false, error: "Sessão não encontrada. Faça login para continuar." },
      { status: 401 }
    );
  }

  const supabase: SupabaseClient<any, any, any> = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();

  console.info("[editar-paga] Auth:", {
    bearerPresent: Boolean(token),
    authOk: Boolean(authData?.user),
    authErrorCode: authError?.message ?? null,
    userId: authData?.user?.id ?? null,
  });

  if (authError || !authData.user) {
    return NextResponse.json(
      { success: false, error: "Sessão inválida ou expirada. Faça login novamente." },
      { status: 401 }
    );
  }
  const user = { id: authData.user.id, email: authData.user.email ?? "" };

  // ── 3. Ler payload ────────────────────────────────────────────────────────
  const MOTIVOS_VALIDOS = ["FRETE", "PRODUTO_INCLUIDO", "PRODUTO_REMOVIDO", "PRODUTO_TROCADO", "SERVICO_ALTERADO", "OUTRO"];
  let body: {
    formState?: PropostaFormState;
    idInt?: number;
    idCliente?: number;
    valorPagoConfirmado?: number;
    novoTotal?: number;
    userEmail?: string;
    userName?: string;
    motivoPendencia?: string;
    chaveEvento?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Payload inválido." }, { status: 400 });
  }

  const { formState, idInt, idCliente, valorPagoConfirmado, novoTotal, userEmail, userName, motivoPendencia, chaveEvento } = body;
  const motivoFinal = motivoPendencia && MOTIVOS_VALIDOS.includes(motivoPendencia) ? motivoPendencia : "OUTRO";

  if (!formState || !idInt || !idCliente) {
    return NextResponse.json(
      { success: false, error: "formState, idInt e idCliente são obrigatórios." },
      { status: 400 }
    );
  }

  // ── 4. Validação Server-Side da Proposta no Banco ────────────────────────
  const { data: propostaBanco, error: propostaError } = await supabase
    .from("propostas")
    .select("id_int, id_cliente, valor_total, is_avulso")
    .eq("id_int", idInt)
    .maybeSingle();

  if (propostaError) {
    return NextResponse.json(
      { success: false, error: `Falha interna ao buscar proposta #${idInt}. Detalhe: ${propostaError.message}` },
      { status: 500 }
    );
  }

  if (!propostaBanco) {
    return NextResponse.json(
      { success: false, error: `Proposta #${idInt} não encontrada no banco de dados.` },
      { status: 404 }
    );
  }

  // Validar se o cliente coincide
  if (propostaBanco.id_cliente !== idCliente) {
    return NextResponse.json(
      { success: false, error: `Inconsistência: cliente informado (${idCliente}) difere do cliente da proposta (${propostaBanco.id_cliente}).` },
      { status: 400 }
    );
  }

  // ── 5. Buscar cobranças e re-calcular valor pago confirmado (servidor) ───
  const { data: cobrancasBanco, error: cobrancasError } = await supabase
    .from("pagamentos_v2")
    .select("status, confirmado, valor, obs_v2")
    .eq("id_int", idInt)
    .neq("status", "CANCELADO");

  if (cobrancasError) {
    return NextResponse.json(
      { success: false, error: "Erro ao buscar cobranças da proposta no servidor." },
      { status: 500 }
    );
  }

  const cobrancas = cobrancasBanco || [];
  const temCobrancasAtivas = cobrancas.length > 0;

  // Regra oficial de pagamento confirmado. Cobranças que incluem abatimento de
  // débito da conta corrente (marcador [ABATIMENTO_DEBITO:x] em obs_v2) têm essa
  // parcela descontada — aquele valor não é pagamento da PROPOSTA, é quitação de
  // débito antigo do cliente, e não deve virar "crédito" se a proposta for editada.
  const valorPagoReal = cobrancas
    .filter(c => c.status === "PAID" || (c.status === "A_VENCER" && c.confirmado))
    .reduce((sum, c) => {
      const marcador = String(c.obs_v2 || "").match(/\[ABATIMENTO_DEBITO:(\d+(?:\.\d{1,2})?)\]/);
      const abatimento = marcador ? Number(marcador[1]) || 0 : 0;
      return sum + Math.max(0, (Number(c.valor) || 0) - abatimento);
    }, 0);

  const valorPagoRealArredondado = Math.round(valorPagoReal * 100) / 100;

  const ehPropostaPaga = temCobrancasAtivas && valorPagoRealArredondado > 0;

  // ── 5a. Separar os três valores que NÃO podem ser confundidos ────────────
  //  a) valorPagoRealArredondado  → pago confirmado (PAID / A_VENCER confirmado)
  //  b) valorCobradoPendente      → já cobrado mas ainda NÃO pago (PIX/boleto
  //     A_RECEBER, A_VENCER não confirmado). É saldo de uma cobrança em
  //     pagamentos_v2 — resolve-se confirmando OU cancelando a cobrança, e
  //     NUNCA vira pendência de Conta Corrente.
  //  c) diferença de Conta Corrente → só existe quando a proposta já estava
  //     INTEGRALMENTE PAGA e sofreu alteração posterior real (ver gate abaixo).
  const TOLERANCIA_CC = 0.02;
  const valorCobradoPendente = Math.round(
    cobrancas
      .filter(c => !(c.status === "PAID" || (c.status === "A_VENCER" && c.confirmado)))
      .reduce((sum, c) => sum + (Number(c.valor) || 0), 0) * 100
  ) / 100;

  // Total ANTES desta edição (lido no passo 4, antes do saveProposta).
  const valorTotalAntesEdicao = Number(propostaBanco.valor_total) || 0;

  // Conta Corrente só se aplica a diferença pós-pagamento: a proposta precisava
  // já estar quitada (pago confirmado cobre o total anterior) E sem cobrança
  // pendente em aberto. Se ainda há saldo a cobrar (pago < total) ou cobrança
  // pendente (ex.: PIX A_RECEBER de R$ 48 numa proposta de R$ 63 com R$ 15 de
  // E-Crédito), a proposta está no fluxo normal de "aguardando pagamento" — o
  // gap pertence à cobrança em pagamentos_v2, não à Conta Corrente, e NÃO deve
  // abrir pendência FAVOR_EMPRESA nem banner de débito nem modal de diferença.
  const estavaIntegralmentePaga =
    valorTotalAntesEdicao > 0 &&
    valorPagoRealArredondado >= valorTotalAntesEdicao - TOLERANCIA_CC &&
    valorCobradoPendente <= TOLERANCIA_CC;

  // Se houver cobranças mas nenhum pagamento confirmado, impede gravação
  if (temCobrancasAtivas && valorPagoRealArredondado <= 0) {
    return NextResponse.json(
      { success: false, error: "Esta proposta possui cobranças ativas mas não possui pagamento confirmado de fato. Cancele as cobranças antes de editar." },
      { status: 400 }
    );
  }

  // ── 5b. Proposta avulsa ou sem produtos + paga: edição PROIBIDA ──────────
  // A edição autorizada de proposta paga existe para tratar alterações
  // posteriores de PRODUTOS, frete ou serviços. Proposta avulsa (ou sem
  // nenhum produto ativo) não tem o que "alterar" — mudar o valor de uma
  // avulsa já paga quebraria a âncora financeira (caso #19486). Bloqueio
  // vale para TODOS, inclusive admin e superadmin (verificado antes da
  // checagem de permissão, que não pode contornar esta regra).
  if (ehPropostaPaga) {
    let semProdutosAtivos = false;
    if (propostaBanco.is_avulso) {
      semProdutosAtivos = true;
    } else {
      // status_item NULL = legado ativo (equivale a PENDENTE) — .neq puro
      // excluiria NULL e classificaria proposta legada como "sem produtos".
      const { count: qtdProdutosAtivos, error: produtosErr } = await supabase
        .from("produtos_proposta")
        .select("id", { count: "exact", head: true })
        .eq("id_int", idInt)
        .or("status_item.is.null,status_item.neq.CANCELADO");
      if (produtosErr) {
        return NextResponse.json(
          { success: false, error: "Erro ao verificar os produtos da proposta." },
          { status: 500 }
        );
      }
      semProdutosAtivos = (qtdProdutosAtivos ?? 0) === 0;
    }

    if (semProdutosAtivos) {
      return NextResponse.json(
        {
          success: false,
          error: propostaBanco.is_avulso
            ? "Proposta avulsa já paga não pode ser alterada."
            : "Proposta paga sem produtos cadastrados não pode ser alterada.",
        },
        { status: 403 }
      );
    }
  }

  // ── 6. Verificar permissão de edição se for proposta paga ────────────────
  if (ehPropostaPaga) {
    const { autorizado, motivo } = await verificarPermissaoEditarPaga(supabase, user.id);
    if (!autorizado) {
      console.warn(`[editar-paga] Acesso negado para user ${user.id}: ${motivo}`);
      return NextResponse.json(
        { success: false, error: motivo ?? "Sem permissão para editar proposta paga." },
        { status: 403 }
      );
    }
  }

  // ── 8. Salvar proposta ────────────────────────────────────────────────────
  const saveResult = await saveProposta(
    formState,
    supabase as unknown as import("@supabase/supabase-js").SupabaseClient,
    user.id,
    { force: ehPropostaPaga }
  );

  if (!saveResult.success) {
    return NextResponse.json(
      { success: false, error: saveResult.errorMessage ?? "Erro ao salvar proposta." },
      { status: 500 }
    );
  }

  // ── 9. Buscar o total atualizado no servidor após a gravação ──────────────
  const novoTotalReal = saveResult.valor_total ?? 0;
  const novoTotalRealArredondado = Math.round(novoTotalReal * 100) / 100;

  console.info(`[editar-paga] Pós-save: valor_total (retornado pelo saveProposta) = ${novoTotalRealArredondado}`);

  // ── 10. Abrir/ajustar a pendência de Conta Corrente via RPC cc_abrir_pendencia ──
  // A RPC recalcula soberanamente (dentro do banco) e reconcilia com qualquer
  // pendência ABERTA/PARCIALMENTE_RESOLVIDA já existente para esta proposta —
  // não há mais necessidade de recalcular diferença/reconciliação aqui.
  let diferenca = 0;
  let pendenciaCriada: { id: number; descricao: string } | null = null;

  // Só abre/ajusta pendência de Conta Corrente quando a proposta JÁ ESTAVA
  // integralmente paga antes desta edição (gate estavaIntegralmentePaga). Caso
  // contrário — cobrança pendente ou saldo ainda a cobrar — o gap é da própria
  // cobrança em pagamentos_v2, e chamar cc_abrir_pendencia criaria um débito
  // FAVOR_EMPRESA indevido (ex.: proposta #19511: R$ 63 total, R$ 15 pago,
  // R$ 48 PIX pendente → a RPC calcularia 63−15 = 48 de débito).
  //
  // REGRA (2026-07-22): diferença DEVEDORA (novo total > pago) NUNCA entra na
  // Conta Corrente — é saldo ainda devido da própria proposta, resolvido por
  // cobrança complementar na aba Pagamentos, abono do administrador ou
  // E-Crédito. A proposta salva normalmente, sem modal de opções, e o status
  // vai para AGUARDANDO pela reconciliação abaixo (cobertura parcial). A RPC
  // só é chamada no caso devedor quando existe pendência ABERTA a reconciliar
  // (ex.: crédito antigo que a nova edição zerou) — nunca para criar débito.
  const diffPrevisto = Math.round((novoTotalRealArredondado - valorPagoRealArredondado) * 100) / 100;
  const ehDiferencaDevedora = diffPrevisto > TOLERANCIA_CC;
  let temPendenciaAbertaParaReconciliar = false;

  if (estavaIntegralmentePaga && ehDiferencaDevedora) {
    const { data: pendAbertas } = await supabase
      .from("conta_corrente_pendencias")
      .select("id")
      .eq("id_int", idInt)
      .in("status", ["ABERTA", "PARCIALMENTE_RESOLVIDA"])
      .limit(1);
    temPendenciaAbertaParaReconciliar = Boolean(pendAbertas && pendAbertas.length > 0);
  }

  if (estavaIntegralmentePaga && (!ehDiferencaDevedora || temPendenciaAbertaParaReconciliar)) {
    const eventoUuid = chaveEvento && /^[0-9a-f-]{36}$/i.test(chaveEvento) ? chaveEvento : crypto.randomUUID();

    const { data: idPendenciaRpc, error: rpcError } = await supabase.rpc("cc_abrir_pendencia", {
      p_id_int: idInt,
      p_id_cliente: idCliente,
      p_chave_evento: eventoUuid,
      p_motivo: motivoFinal,
      p_total_soberano: novoTotalRealArredondado,
      p_observacao: `Operador: ${userEmail ?? user.email}.`,
    });

    if (rpcError) {
      const msg = rpcError.message || "Erro ao abrir/ajustar pendência de Conta Corrente.";
      const revisaoNecessaria = msg.includes("CC_AJUSTE_ABAIXO_COMPROMETIDO") || msg.includes("CC_FLIP_COM_COMPROMETIDO");
      console.error("[editar-paga] Erro na RPC cc_abrir_pendencia:", msg);
      return NextResponse.json(
        {
          success: false,
          error: revisaoNecessaria
            ? "Esta proposta já teve parte da diferença anterior usada ou reservada. O Financeiro precisa revisar manualmente antes de novas alterações."
            : msg,
        },
        { status: revisaoNecessaria ? 409 : 500 }
      );
    }

    // No caso devedor a RPC foi chamada apenas para reconciliar/encerrar uma
    // pendência antiga — nunca devolvemos diferença/pendência ao front nesse
    // caso (nenhum modal, salvamento normal; o saldo devedor vive na proposta).
    if (idPendenciaRpc != null && !ehDiferencaDevedora) {
      const { data: pendRow } = await supabase
        .from("conta_corrente_pendencias")
        .select("id, direcao, valor_saldo, valor_reservado, motivo")
        .eq("id", idPendenciaRpc)
        .maybeSingle();

      if (pendRow && (Number(pendRow.valor_saldo) > 0 || Number(pendRow.valor_reservado) > 0)) {
        const valorPendente = Math.round((Number(pendRow.valor_saldo) + Number(pendRow.valor_reservado)) * 100) / 100;
        diferenca = pendRow.direcao === "FAVOR_CLIENTE" ? -valorPendente : valorPendente;
        pendenciaCriada = {
          id: pendRow.id,
          descricao: `Proposta #${idInt} alterada após pagamento confirmado. Diferença pendente: R$ ${valorPendente.toFixed(2).replace(".", ",")} (${pendRow.direcao === "FAVOR_CLIENTE" ? "a favor do cliente" : "a favor da empresa"}). Motivo: ${pendRow.motivo}.`,
        };
      }
    }
  }

  // ── Reconciliar status_interno pelo fluxo oficial ──────────────────────────
  // Roda para qualquer proposta com pagamento confirmado (ehPropostaPaga),
  // INCLUSIVE quando não há diferença de Conta Corrente — é o que mantém
  // #19511 em "AGUARDANDO" (pago 15 de 63, PIX 48 pendente) em vez de status
  // congelado. status_interno nunca era recalculado ao salvar, e
  // formState.status (vindo do cliente) era persistido às cegas; nunca confiar
  // nele. Best-effort: nunca falha o salvamento da proposta em si.
  if (ehPropostaPaga) {
    const reconciliacao = await aplicarStatusRecomendadoProposta(
      idInt,
      { uid: user.id, nome: userName ?? user.email ?? "Sistema", email: user.email ?? "" },
      supabase,
      "AUTO_FINANCEIRO"
    );
    if (!reconciliacao.success) {
      console.warn(`[editar-paga] Reconciliação de status sem efeito para proposta #${idInt}: ${reconciliacao.errorMessage}`);
    }
  }

  return NextResponse.json({
    success: true,
    novoTotal: novoTotalRealArredondado,
    diferenca: diferenca,
    ehPropostaPaga,
    valorPagoReal: valorPagoRealArredondado,
    pendenciaAtiva: pendenciaCriada,
  });
}
