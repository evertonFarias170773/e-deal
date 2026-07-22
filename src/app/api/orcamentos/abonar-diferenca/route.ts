/**
 * /api/orcamentos/abonar-diferenca/route.ts
 *
 * Ação exclusiva de ADMINISTRADOR: abona o saldo ainda devido de uma proposta
 * já paga (novo total > pago), registrando um DESCONTO no valor exato da
 * diferença e recalculando a quitação/status.
 *
 * REGRA (2026-07-22): diferença devedora de proposta paga é saldo da própria
 * proposta (nunca Conta Corrente). Caminhos de resolução: cobrança
 * complementar na aba Pagamentos, este abono, ou crédito manual + E-Crédito.
 *
 * SEGURANÇA:
 * - JWT via Authorization: Bearer <token>; cliente autenticado (RLS ativa).
 * - Somente is_admin / is_super_adm (public.usuarios).
 * - Valor do abono é SEMPRE recalculado no servidor (total soberano − cobrado
 *   ativo) — o cliente não informa valor.
 *
 * EFEITOS:
 * - desconto_proposta (DESCONTO_GERAL): desconto efetivo atual + abono, em
 *   valor nominal (mesma linha única considerada por cc__total_soberano_proposta).
 * - propostas.valor_total: recalculado (subtotal + frete − novo desconto).
 * - propostas_chat: registro SISTEMA com autor, valor e data (Histórico).
 * - status_interno: reconciliado pelo fluxo oficial (aplicarStatusRecomendadoProposta).
 *
 * IDEMPOTÊNCIA NATURAL: repetição recalcula o saldo (agora 0) e retorna 400
 * "sem saldo pendente" — nunca abona duas vezes.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { aplicarStatusRecomendadoProposta } from "@/features/orcamentos/services/status-writer.service";

const TOLERANCIA = 0.02;

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.error("[abonar-diferenca] ENV AUSENTE");
    return NextResponse.json({ success: false, error: "Configuração de ambiente incompleta." }, { status: 500 });
  }
  if (!token) {
    return NextResponse.json({ success: false, error: "Sessão não encontrada." }, { status: 401 });
  }

  const supabase: SupabaseClient<any, any, any> = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, error: "Sessão inválida ou expirada." }, { status: 401 });
  }
  const user = {
    id: authData.user.id,
    email: authData.user.email ?? "",
    nome: (authData.user.user_metadata?.name as string) || authData.user.email || "Administrador",
  };

  // ── Permissão: somente administrador ─────────────────────────────────────
  const { data: usuarioRow, error: usuarioErr } = await supabase
    .from("usuarios")
    .select("is_admin, is_super_adm, nome_usuario")
    .eq("user_id", user.id)
    .maybeSingle();

  if (usuarioErr || !usuarioRow) {
    return NextResponse.json({ success: false, error: "Usuário não encontrado em public.usuarios." }, { status: 403 });
  }
  if (!usuarioRow.is_admin && !usuarioRow.is_super_adm) {
    return NextResponse.json({ success: false, error: "Somente administradores podem abonar diferença." }, { status: 403 });
  }
  const nomeAutor = usuarioRow.nome_usuario || user.nome;

  // ── Payload ──────────────────────────────────────────────────────────────
  let body: { idInt?: number; observacao?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Payload inválido." }, { status: 400 });
  }
  const idInt = Number(body.idInt) || 0;
  const observacao = String(body.observacao || "").slice(0, 500);
  if (!idInt) {
    return NextResponse.json({ success: false, error: "idInt é obrigatório." }, { status: 400 });
  }

  try {
    // ── Proposta ───────────────────────────────────────────────────────────
    const { data: proposta, error: propErr } = await supabase
      .from("propostas")
      .select("id_int, id_cliente, is_avulso, valor_total, valor_frete")
      .eq("id_int", idInt)
      .maybeSingle();

    if (propErr || !proposta) {
      return NextResponse.json({ success: false, error: `Proposta #${idInt} não encontrada.` }, { status: 404 });
    }
    if (proposta.is_avulso) {
      return NextResponse.json(
        { success: false, error: "Abono de diferença não disponível para proposta avulsa (sem itens/desconto geral). Ajuste o valor manualmente." },
        { status: 400 }
      );
    }

    // ── Cobranças: pago confirmado e total cobrado ativo ───────────────────
    const { data: cobrancasBanco, error: cobrancasErr } = await supabase
      .from("pagamentos_v2")
      .select("status, confirmado, valor, obs_v2")
      .eq("id_int", idInt)
      .neq("status", "CANCELADO");

    if (cobrancasErr) {
      return NextResponse.json({ success: false, error: "Erro ao buscar cobranças da proposta." }, { status: 500 });
    }
    const cobrancas = cobrancasBanco || [];

    // Mesma regra oficial do editar-paga (desconta marcador de abatimento de débito)
    const valorPago = round2(
      cobrancas
        .filter((c) => c.status === "PAID" || (c.status === "A_VENCER" && c.confirmado))
        .reduce((sum, c) => {
          const marcador = String(c.obs_v2 || "").match(/\[ABATIMENTO_DEBITO:(\d+(?:\.\d{1,2})?)\]/);
          const abatimento = marcador ? Number(marcador[1]) || 0 : 0;
          return sum + Math.max(0, (Number(c.valor) || 0) - abatimento);
        }, 0)
    );

    if (valorPago <= 0) {
      return NextResponse.json(
        { success: false, error: "A proposta não possui pagamento confirmado — abono de diferença só se aplica a proposta paga." },
        { status: 400 }
      );
    }

    const totalCobradoAtivo = round2(cobrancas.reduce((sum, c) => sum + (Number(c.valor) || 0), 0));

    // ── Total soberano recalculado no servidor (mesma fórmula oficial) ─────
    const { data: itensRows, error: itensErr } = await supabase
      .from("produtos_proposta")
      .select("valor_sub_total, status_item")
      .eq("id_int", idInt);

    if (itensErr) {
      return NextResponse.json({ success: false, error: "Erro ao buscar itens da proposta." }, { status: 500 });
    }
    const subtotal = round2(
      (itensRows || [])
        .filter((i) => (i.status_item || "PENDENTE") !== "CANCELADO")
        .reduce((sum, i) => sum + (Number(i.valor_sub_total) || 0), 0)
    );
    const frete = round2(Number(proposta.valor_frete) || 0);

    // Linha única de desconto geral — mesmo critério de cc__total_soberano_proposta
    // (DESCONTO_GERAL ou legado NULL; tipada primeiro, mais recente primeiro).
    const { data: descRows, error: descErr } = await supabase
      .from("desconto_proposta")
      .select("id, tipo_desconto, valor_percentual, valor_nominal, descricao")
      .eq("id_int", idInt)
      .or("tipo_desconto.eq.DESCONTO_GERAL,tipo_desconto.is.null")
      .order("id", { ascending: false });

    if (descErr) {
      return NextResponse.json({ success: false, error: "Erro ao buscar desconto da proposta." }, { status: 500 });
    }
    const descontoRow =
      (descRows || []).find((d) => d.tipo_desconto === "DESCONTO_GERAL") ?? (descRows || [])[0] ?? null;

    const pct = Number(descontoRow?.valor_percentual) || 0;
    const nominal = Number(descontoRow?.valor_nominal) || 0;
    const descontoAtual = Math.min(subtotal, round2(pct > 0 ? (subtotal * pct) / 100 : Math.max(0, nominal)));

    const totalAtual = Math.max(0, round2(subtotal + frete - descontoAtual));

    // ── Saldo a abonar = total soberano − cobrado ativo ────────────────────
    const saldoAbono = round2(totalAtual - totalCobradoAtivo);
    if (saldoAbono < 0.01) {
      return NextResponse.json(
        { success: false, error: "Não há saldo pendente a abonar nesta proposta (diferença já coberta por cobrança, abono anterior ou E-Crédito)." },
        { status: 400 }
      );
    }

    const novoDesconto = round2(descontoAtual + saldoAbono);
    if (novoDesconto > subtotal + TOLERANCIA) {
      return NextResponse.json(
        { success: false, error: `O abono de R$ ${saldoAbono.toFixed(2)} excede o subtotal dos itens (desconto máximo permitido). Revise a proposta manualmente.` },
        { status: 400 }
      );
    }

    // ── Persistir desconto (nominal congela o valor efetivo + abono) ───────
    const descricaoDesconto = `Desconto geral da proposta + abono de diferença (R$ ${saldoAbono.toFixed(2).replace(".", ",")})`;
    if (descontoRow) {
      const { error: updDescErr } = await supabase
        .from("desconto_proposta")
        .update({
          tipo_desconto: "DESCONTO_GERAL",
          valor_nominal: novoDesconto,
          valor_percentual: 0,
          descricao: descricaoDesconto,
        })
        .eq("id", descontoRow.id);
      if (updDescErr) {
        return NextResponse.json({ success: false, error: `Erro ao registrar o desconto do abono: ${updDescErr.message}` }, { status: 500 });
      }
    } else {
      const { error: insDescErr } = await supabase.from("desconto_proposta").insert({
        id_int: idInt,
        tipo_desconto: "DESCONTO_GERAL",
        valor_nominal: novoDesconto,
        valor_percentual: 0,
        descricao: descricaoDesconto,
      });
      if (insDescErr) {
        return NextResponse.json({ success: false, error: `Erro ao registrar o desconto do abono: ${insDescErr.message}` }, { status: 500 });
      }
    }

    // ── Recalcular e persistir o novo total da proposta ────────────────────
    const novoTotal = Math.max(0, round2(subtotal + frete - novoDesconto));
    const { error: updTotalErr } = await supabase
      .from("propostas")
      .update({ valor_total: novoTotal })
      .eq("id_int", idInt);
    if (updTotalErr) {
      return NextResponse.json(
        { success: false, error: `Desconto registrado, mas falha ao atualizar o total da proposta: ${updTotalErr.message}. Reprocesse salvando a proposta.` },
        { status: 500 }
      );
    }

    // ── Histórico (autor, data e valor) ────────────────────────────────────
    const dataStr = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const msgHistorico = [
      `🎁 Abono de diferença: R$ ${saldoAbono.toFixed(2).replace(".", ",")} abonados como desconto pelo administrador ${nomeAutor} (${user.email}) em ${dataStr}.`,
      `Novo total da proposta: R$ ${novoTotal.toFixed(2).replace(".", ",")} (pago confirmado: R$ ${valorPago.toFixed(2).replace(".", ",")}).`,
      observacao ? `Observação: ${observacao}` : null,
    ].filter(Boolean).join(" ");

    const { error: chatErr } = await supabase.from("propostas_chat").insert([{
      id_int: idInt,
      id_cliente: proposta.id_cliente,
      mensagem: msgHistorico,
      tipo: "SISTEMA",
      autor_uid: user.id,
      autor_nome: nomeAutor,
      autor_email: user.email,
      setor: "Financeiro",
      visivel_externo: false,
      anexos: null,
    }]);
    if (chatErr) {
      console.error(`[abonar-diferenca] Abono aplicado, mas falha ao registrar histórico da proposta #${idInt}:`, chatErr.message);
    }

    // ── Reconciliar status pelo fluxo oficial (best-effort) ────────────────
    const reconciliacao = await aplicarStatusRecomendadoProposta(
      idInt,
      { uid: user.id, nome: nomeAutor, email: user.email },
      supabase,
      "AUTO_FINANCEIRO"
    );
    if (!reconciliacao.success) {
      console.warn(`[abonar-diferenca] Reconciliação de status sem efeito para proposta #${idInt}: ${reconciliacao.errorMessage}`);
    }

    return NextResponse.json({
      success: true,
      valorAbonado: saldoAbono,
      novoTotal,
      valorPago,
      message: `Diferença de R$ ${saldoAbono.toFixed(2).replace(".", ",")} abonada com sucesso.`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
