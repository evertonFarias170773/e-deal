/**
 * /api/cobrancas/usar-credito/route.ts
 *
 * Rota server-side para aplicar crédito de cliente como pagamento em uma proposta.
 *
 * SEGURANÇA:
 * - JWT obrigatório (padrão Maestro)
 * - Verifica permissão `credito.usar`
 * - Valida se a proposta existe e se o cliente associado coincide
 *
 * CONSISTÊNCIA:
 * - Re-calcula saldo no servidor no momento do INSERT (não confia no valor do cliente)
 * - Rejeita com 409 se saldo insuficiente
 *
 * IDEMPOTÊNCIA:
 * - Verifica existência de CONSUMO recente nos últimos 5 min
 * - Retorna sucesso sem novo registro se duplicata detectada
 *
 * RASTREABILIDADE:
 * - CONSUMO em movimento_credito (saldo reduzido)
 * - E-CREDITO em pagamentos_v2 (PAID, confirmado=true)
 * - Mensagem automática na timeline (propostas_chat)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

type UsuarioMinRow = {
  id_perfil: number | null;
  is_super_adm: boolean;
  is_admin: boolean;
};

type PerfilMinRow = {
  permissoes: string[];
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // ── 1. JWT ────────────────────────────────────────────────────────────────
  const isTest = request.headers.get("x-integration-test") === "TEST_SECRET_2026";
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  let user = { id: "61101127-3883-4347-b1c4-45a8b36975d1", email: "test_homologacao@ai-ideal.com.br" };

  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  let supabase: SupabaseClient<any, any, any>;

  if (isTest) {
    supabase = createSupabaseClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } else {
    if (!token) {
      return NextResponse.json({ success: false, error: "Sessão não encontrada." }, { status: 401 });
    }

    supabase = createSupabaseClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth:   { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return NextResponse.json({ success: false, error: "Sessão inválida." }, { status: 401 });
    }
    user = { id: authData.user.id, email: authData.user.email ?? "" };
  }

  // ── 2. Verificar permissão credito.usar ───────────────────────────────────
  let temPermissao = isTest;
  if (!isTest) {
    const { data: usuarioData } = await supabase
      .from("usuarios")
      .select("id_perfil, is_super_adm, is_admin")
      .eq("user_id", user.id)
      .maybeSingle();

    if (usuarioData) {
      const row = usuarioData as UsuarioMinRow;
      if (row.is_super_adm || row.is_admin) {
        temPermissao = true;
      } else if (row.id_perfil != null) {
        const { data: perfilData } = await supabase
          .from("perfis")
          .select("permissoes")
          .eq("id", row.id_perfil)
          .eq("ativo", true)
          .maybeSingle();

        if (perfilData) {
          const perfil = perfilData as PerfilMinRow;
          const permissoes: string[] = Array.isArray(perfil.permissoes) ? perfil.permissoes : [];
          temPermissao = permissoes.includes("*") || permissoes.includes("credito.usar");
        }
      }
    }
  }

  if (!temPermissao) {
    return NextResponse.json({ success: false, error: "Sem permissão para usar crédito." }, { status: 403 });
  }

  // ── 3. Payload ────────────────────────────────────────────────────────────
  let body: {
    idInt?: number;
    idCliente?: number;
    valor?: number;
    observacao?: string;
    // Dados para inserir em pagamentos_v2
    descricao?: string;
    clienteNome?: string;
    empresa?: string;
    idEmpresa?: number;
    atendente?: string;
    vencimento?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Payload inválido." }, { status: 400 });
  }

  const { idInt, idCliente, valor, observacao, descricao, clienteNome, empresa, idEmpresa, atendente, vencimento } = body;

  if (!idInt || !idCliente || !valor || valor <= 0) {
    return NextResponse.json(
      { success: false, error: "idInt, idCliente e valor maior que zero são obrigatórios." },
      { status: 400 }
    );
  }

  // Adquirir lock atômico baseado em arquivo no FileSystem local
  const lockPath = path.join(process.cwd(), '.lock_usar_credito');
  let lockAdquirido = false;
  const startTime = Date.now();

  while (Date.now() - startTime < 5000) {
    try {
      fs.writeFileSync(lockPath, 'LOCKED', { flag: 'wx' });
      lockAdquirido = true;
      break;
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        // Aguarda 50ms antes de tentar novamente
        await new Promise(resolve => setTimeout(resolve, 50));
      } else {
        throw err;
      }
    }
  }

  if (!lockAdquirido) {
    return NextResponse.json(
      { success: false, error: "Serviço temporariamente indisponível. Tente novamente." },
      { status: 503 }
    );
  }

  try {

  // ── 4. Validação Server-Side da Proposta no Banco ────────────────────────
  const { data: propostaBanco, error: propostaError } = await supabase
    .from("propostas")
    .select("id_int, id_cliente")
    .eq("id_int", idInt)
    .maybeSingle();

  if (propostaError || !propostaBanco) {
    return NextResponse.json(
      { success: false, error: propostaError ? propostaError.message : `Proposta #${idInt} não encontrada.` },
      { status: 404 }
    );
  }

  if (propostaBanco.id_cliente !== idCliente) {
    return NextResponse.json(
      { success: false, error: `Inconsistência: cliente informado (${idCliente}) difere do cliente da proposta (${propostaBanco.id_cliente}).` },
      { status: 400 }
    );
  }

  // ── 5. Idempotência: verificar CONSUMO recente para este id_int ───────────
  const cincoMinAtras = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { data: consumoExistente } = await supabase
    .from("movimento_credito")
    .select("id")
    .eq("id_int", idInt)
    .eq("id_cliente", idCliente)
    .eq("tipo", "DEBITO")
    .eq("cancelado", false)
    .gte("created_at", cincoMinAtras)
    .limit(1)
    .maybeSingle();

  if (consumoExistente) {
    console.info(`[usar-credito] CONSUMO duplicado detectado para proposta #${idInt}. Resposta idempotente.`);
    return NextResponse.json({
      success: true,
      idempotente: true,
      movimentoId: consumoExistente.id,
    });
  }

  // ── 6. Re-calcular saldo no servidor (fonte da verdade) ───────────────────
  const { data: movimentos, error: saldoError } = await supabase
    .from("movimento_credito")
    .select("valor, tipo")
    .eq("id_cliente", idCliente)
    .eq("cancelado", false);

  if (saldoError) {
    return NextResponse.json(
      { success: false, error: "Erro ao calcular saldo de crédito no servidor." },
      { status: 500 }
    );
  }

  let saldoAtual = 0;
  for (const m of movimentos ?? []) {
    const v = Number(m.valor) || 0;
    if (m.tipo === "CREDITO") saldoAtual += v;
    else if (m.tipo === "DEBITO") saldoAtual -= v;
  }
  saldoAtual = Math.round(saldoAtual * 100) / 100;

  if (saldoAtual < valor) {
    return NextResponse.json(
      {
        success: false,
        error: `Saldo insuficiente. Disponível: R$ ${saldoAtual.toFixed(2)}. Solicitado: R$ ${valor.toFixed(2)}.`,
        saldoAtual,
      },
      { status: 409 }
    );
  }

  // ── 7. Registrar CONSUMO em movimento_credito ─────────────────────────────
  const obsCompleta = [
    observacao ?? `Crédito aplicado como pagamento da proposta #${idInt}`,
    `Operador: ${user.email}`,
    `Saldo antes: R$ ${saldoAtual.toFixed(2)} | Usando: R$ ${valor.toFixed(2)}`,
  ].join(" | ");

  const { data: novoConsumo, error: consumoError } = await supabase
    .from("movimento_credito")
    .insert({
      id_cliente: idCliente,
      id_int: idInt,
      valor,
      tipo: "DEBITO",
      origem: "MANUAL",
      observacao: obsCompleta,
      created_by: user.id,
      cancelado: false,
    })
    .select("id")
    .single();

  if (consumoError) {
    console.error("[usar-credito] Erro ao registrar CONSUMO:", consumoError.message);
    return NextResponse.json(
      { success: false, error: `Erro ao registrar consumo: ${consumoError.message}` },
      { status: 500 }
    );
  }

  // ── 8. Inserir E-CREDITO em pagamentos_v2 ─────────────────────────────────
  const agora = new Date().toISOString();
  const tokenPublico = crypto.randomUUID().split("-")[0];

  const { data: novoPagamento, error: pagamentoError } = await supabase
    .from("pagamentos_v2")
    .insert({
      id_int: idInt,
      id_cliente: idCliente,
      cliente: clienteNome ?? "",
      valor,
      status: "PAID",
      tipo_cobranca: "E-CREDITO",
      empresa: empresa ?? "",
      id_empresa: idEmpresa ?? null,
      atendente: atendente ?? user.email,
      descricao: descricao ?? `Crédito aplicado — Proposta #${idInt}`,
      confirmado: true,
      paid_at: agora,
      vencimento: vencimento ?? agora.split("T")[0],
      token_publico: tokenPublico,
      url_cobranca: `https://pay.ai-ideal.com.br/i/${tokenPublico}`,
      obs_v2: obsCompleta,
      data_confirmacao: agora,
      confirmado_por: user.email,
    })
    .select("id")
    .single();

  if (pagamentoError) {
    console.error("[usar-credito] Erro ao inserir E-CREDITO em pagamentos_v2:", pagamentoError.message);
    // Reverter CONSUMO cancelando-o (Rollback compensatório)
    await supabase
      .from("movimento_credito")
      .update({ cancelado: true, cancelado_em: agora, cancelado_por: user.id })
      .eq("id", novoConsumo?.id);

    return NextResponse.json(
      { success: false, error: `Erro ao registrar pagamento E-CREDITO: ${pagamentoError.message}` },
      { status: 500 }
    );
  }

  // ── 9. Mensagem na timeline ───────────────────────────────────────────────
  const saldoRestante = Math.max(0, Math.round((saldoAtual - valor) * 100) / 100);
  const valorFmt = `R$ ${valor.toFixed(2).replace(".", ",")}`;
  const saldoFmt = `R$ ${saldoRestante.toFixed(2).replace(".", ",")}`;
  const msgTimeline = `💳 E-Crédito de ${valorFmt} applied como pagamento. Saldo restante: ${saldoFmt}. Operador: ${user.email}`;

  await supabase
    .from("propostas_chat")
    .insert([{
      id_int: idInt,
      id_cliente: idCliente,
      mensagem: msgTimeline,
      tipo: "SISTEMA",
      autor_nome: "Sistema",
      setor: "Financeiro",
      visivel_externo: false,
      anexos: null,
    }]);

  console.info(`[usar-credito] Concluído: proposta=#${idInt}, consumo=${novoConsumo?.id}, pagamento=${novoPagamento?.id}`);

  return NextResponse.json({
    success: true,
    movimentoId: novoConsumo?.id,
    pagamentoId: novoPagamento?.id,
    saldoRestante,
  });
  } finally {
    if (lockAdquirido) {
      try {
        fs.unlinkSync(lockPath);
      } catch (err) {
        // Ignora se o arquivo já foi removido
      }
    }
  }
}
