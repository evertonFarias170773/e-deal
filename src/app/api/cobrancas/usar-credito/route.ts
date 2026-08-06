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
 * CONSISTÊNCIA (Conta Corrente — Pendências Financeiras):
 * - O saldo disponível é recalculado a partir de TODA a razão do cliente em
 *   `movimento_credito` (mesma fonte de getSaldoCredito/getSaldoContaCorrente,
 *   exibida no banner/modal) — não só das pendências. Isso cobre tanto
 *   pendências (public.conta_corrente_pendencias, direção FAVOR_CLIENTE)
 *   quanto crédito avulso lançado manualmente (origem=AJUSTE, sem pendência).
 * - Consumo em duas etapas: primeiro as pendências utilizáveis mais antigas
 *   (FIFO) via `cc_usar_pendencia` (SECURITY DEFINER, trava de linha); o que
 *   sobrar é coberto pelo crédito avulso via `mc_usar_credito_avulso`
 *   (SECURITY DEFINER, trava o cliente e recalcula o saldo real da razão
 *   antes de gravar). Cada etapa é atômica isoladamente; não há transação
 *   única cobrindo tudo.
 * - Em falha após consumir parte do valor, o pagamento E-CREDITO é
 *   cancelado localmente e um alerta é registrado na timeline para
 *   conferência manual do Financeiro (mesmo padrão já usado em
 *   pagamento-combinado para falhas parciais).
 *
 * IDEMPOTÊNCIA:
 * - `chaveIdempotencia` (UUID) é obrigatória e persistida em
 *   `pagamentos_v2.chave_idempotencia` (índice único parcial). Repetir a
 *   mesma requisição com a mesma chave retorna o resultado da tentativa
 *   anterior (sucesso ou falha) em vez de reprocessar — nunca descarta por
 *   proximidade de tempo, apenas por identidade de operação.
 * - `chave_idempotencia` NÃO é mais gravada no INSERT direto do pagamento:
 *   INSERT/UPDATE diretos nessa coluna são revogados de `authenticated` na
 *   migration (só RPC SECURITY DEFINER escreve). A chave é registrada logo
 *   após o INSERT via RPC `pgv2_registrar_chave_idempotencia`; se outra
 *   requisição concorrente já registrou a mesma chave em outro pagamento,
 *   este pagamento é cancelado e o resultado da vencedora é retornado.
 *
 * RASTREABILIDADE:
 * - Cada slice FIFO grava um lançamento USO_PEDIDO em movimento_credito, com
 *   id_pendencia e id_pagamento_destino.
 * - E-CREDITO em pagamentos_v2 (PAID, confirmado=true)
 * - Mensagens automáticas na timeline (propostas_chat), via cc__timeline (RPC).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { calcularSituacaoQuitacaoProposta } from "@/features/cobrancas/services/conferencia-financeira.service";

type UsuarioMinRow = {
  id_perfil: number | null;
  is_super_adm: boolean;
  is_admin: boolean;
};

type PerfilMinRow = {
  permissoes: string[];
};

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

  // ── 2. Verificar permissão credito.usar ───────────────────────────────────
  let temPermissao = false;
  {
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
    descricao?: string;
    clienteNome?: string;
    empresa?: string;
    idEmpresa?: number;
    atendente?: string;
    vencimento?: string;
    chaveIdempotencia?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Payload inválido." }, { status: 400 });
  }

  const { idInt, idCliente, valor, observacao, descricao, clienteNome, empresa, idEmpresa, atendente, vencimento, chaveIdempotencia } = body;

  if (!idInt || !idCliente || !valor || valor <= 0) {
    return NextResponse.json(
      { success: false, error: "idInt, idCliente e valor maior que zero são obrigatórios." },
      { status: 400 }
    );
  }
  if (!chaveIdempotencia || !/^[0-9a-f-]{36}$/i.test(chaveIdempotencia)) {
    return NextResponse.json(
      { success: false, error: "chaveIdempotencia (UUID) é obrigatória." },
      { status: 400 }
    );
  }
  const valorArredondado = Math.round(valor * 100) / 100;

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

  const { data: clienteData, error: clienteErr } = await supabase
    .from("clientes")
    .select("nome")
    .eq("id_cliente", idCliente)
    .maybeSingle();

  if (clienteErr || !clienteData) {
    return NextResponse.json({ success: false, error: "Cliente não encontrado no sistema." }, { status: 404 });
  }
  const nomeClienteReal = clienteData.nome;

  // ── 4b. Idempotência: chave persistida por tentativa (não por janela de
  // tempo) — repetir a mesma requisição retorna o resultado da tentativa
  // anterior; operações legítimas próximas no tempo (com chave diferente)
  // nunca são descartadas. Verificada ANTES do saldo disponível: se o
  // crédito já foi todo consumido pela tentativa anterior (bem-sucedida), o
  // saldo atual pode não cobrir mais o valor — mas a operação já foi feita,
  // então a resposta idempotente deve prevalecer sobre um novo "saldo
  // insuficiente", nunca o contrário.
  const { data: pagamentoExistente } = await supabase
    .from("pagamentos_v2")
    .select("id, status, motivo_cancela")
    .eq("chave_idempotencia", chaveIdempotencia)
    .maybeSingle();

  if (pagamentoExistente) {
    if (pagamentoExistente.status === "CANCELADO") {
      console.info(`[usar-credito] Repetição de tentativa que já falhou anteriormente (chave=${chaveIdempotencia}).`);
      return NextResponse.json(
        { success: false, idempotente: true, error: pagamentoExistente.motivo_cancela || "Tentativa anterior falhou." },
        { status: 409 }
      );
    }
    console.info(`[usar-credito] Repetição idempotente detectada (chave=${chaveIdempotencia}, pagamento=${pagamentoExistente.id}).`);
    const situacaoIdempotente = await calcularSituacaoQuitacaoProposta(supabase, idInt);
    return NextResponse.json({
      success: true,
      idempotente: true,
      pagamentoId: pagamentoExistente.id,
      totalPagoAtivo: situacaoIdempotente.novoValorQuitado,
      totalProposta: situacaoIdempotente.valorTotalProposta,
      quitada: situacaoIdempotente.novoValorQuitado >= (situacaoIdempotente.valorTotalProposta - 0.02) && situacaoIdempotente.valorTotalProposta > 0,
    });
  }

  // ── 5. Saldo real disponível — MESMA fonte usada no banner/modal
  // (getSaldoCredito/getSaldoContaCorrente): soma de toda a razão não
  // cancelada do cliente em movimento_credito. Cobre tanto pendências
  // FAVOR_CLIENTE (cada evento de pendência é espelhado em movimento_credito
  // por cc_abrir_pendencia/cc_usar_pendencia) quanto crédito avulso manual
  // (origem=AJUSTE, sem pendência) — corrige a divergência em que o backend
  // via somava apenas conta_corrente_pendencias.valor_saldo e ignorava
  // crédito avulso, calculando R$ 0,00 quando o cliente só tinha ajuste
  // manual (ver mc_usar_credito_avulso).
  const { data: ledgerBanco, error: ledgerError } = await supabase
    .from("movimento_credito")
    .select("valor, tipo")
    .eq("id_cliente", idCliente)
    .eq("cancelado", false);

  if (ledgerError) {
    return NextResponse.json({ success: false, error: "Erro ao consultar saldo de crédito no servidor." }, { status: 500 });
  }

  const saldoDisponivel = Math.round(
    (ledgerBanco || []).reduce((sum, r) => sum + (r.tipo === "CREDITO" ? Number(r.valor) || 0 : -(Number(r.valor) || 0)), 0) * 100
  ) / 100;

  if (saldoDisponivel < valorArredondado - 0.01) {
    return NextResponse.json(
      {
        success: false,
        error: `Saldo insuficiente. Disponível: R$ ${Math.max(0, saldoDisponivel).toFixed(2)}. Solicitado: R$ ${valorArredondado.toFixed(2)}.`,
        saldoAtual: Math.max(0, saldoDisponivel),
      },
      { status: 409 }
    );
  }

  // ── 5a. Pendências FAVOR_CLIENTE utilizáveis, mais antigas primeiro (FIFO) —
  // pode vir vazio quando o crédito do cliente é 100% avulso (sem nenhuma
  // pendência aberta); nesse caso o passo 7b abaixo cobre o valor inteiro
  // pelo crédito avulso.
  const { data: pendenciasBanco, error: pendenciasError } = await supabase
    .from("conta_corrente_pendencias")
    .select("id, valor_saldo")
    .eq("id_cliente", idCliente)
    .eq("direcao", "FAVOR_CLIENTE")
    .in("status", ["ABERTA", "PARCIALMENTE_RESOLVIDA"])
    .order("created_at", { ascending: true });

  if (pendenciasError) {
    return NextResponse.json({ success: false, error: "Erro ao consultar pendências de crédito no servidor." }, { status: 500 });
  }

  const pendencias = pendenciasBanco || [];

  // ── 6. Inserir E-CREDITO em pagamentos_v2 (definido antes da FIFO — cada
  // slice referencia este pagamento em id_pagamento_destino) ────────────────
  const agora = new Date().toISOString();
  const tokenPublico = crypto.randomUUID().split("-")[0];
  const obsBase = observacao ?? `Crédito aplicado como pagamento da proposta #${idInt}`;

  const { data: novoPagamento, error: pagamentoError } = await supabase
    .from("pagamentos_v2")
    .insert({
      id_int: idInt,
      id_cliente: idCliente,
      cliente: nomeClienteReal,
      valor: valorArredondado,
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
      obs_v2: obsBase,
      data_confirmacao: agora,
      confirmado_por: user.email,
    })
    .select("id")
    .single();

  if (pagamentoError || !novoPagamento) {
    return NextResponse.json(
      { success: false, error: `Erro ao registrar pagamento E-CREDITO: ${pagamentoError?.message}` },
      { status: 500 }
    );
  }

  // ── 6b. Registrar a chave de idempotência via RPC — único caminho
  // permitido para gravar pagamentos_v2.chave_idempotencia (INSERT/UPDATE
  // diretos nessa coluna são revogados de authenticated na migration;
  // SECURITY DEFINER é a exceção). Corrida rara: duas requisições
  // concorrentes com a mesma chave criam cada uma seu próprio pagamento
  // (chave_idempotencia começa NULL nas duas); só uma consegue registrar a
  // chave (índice único). A perdedora cancela o próprio pagamento e devolve
  // o resultado da vencedora.
  const { error: chaveError } = await supabase.rpc("pgv2_registrar_chave_idempotencia", {
    p_id_pagamento: novoPagamento.id,
    p_chave_idempotencia: chaveIdempotencia,
  });

  if (chaveError) {
    // A RPC falha por dois motivos bem diferentes: corrida real (outro
    // pagamento já registrou esta chave — índice único) ou erro de banco.
    // Descobrir QUAL antes de escrever o motivo do cancelamento: gravar
    // "requisição duplicada" num erro que não é duplicidade planta pista
    // falsa na auditoria. Aconteceu em 06/08/2026 — o pagamento 658fdabf
    // ficou marcado como duplicado, quando o erro real era o cast quebrado
    // de perfis.permissoes em cc__assert_permissao.
    const { data: pagamentoVencedor } = await supabase
      .from("pagamentos_v2")
      .select("id")
      .eq("chave_idempotencia", chaveIdempotencia)
      .maybeSingle();

    console.warn(
      `[usar-credito] Falha ao registrar chave ${chaveIdempotencia} (corrida=${Boolean(pagamentoVencedor)}): ${chaveError.message}`
    );
    await supabase.from("pagamentos_v2").update({
      status: "CANCELADO",
      motivo_cancela: pagamentoVencedor
        ? "Requisição duplicada (mesma chave de idempotência já registrada por outro pagamento)."
        : `Falha ao registrar a chave de idempotência: ${chaveError.message}`,
    }).eq("id", novoPagamento.id);

    if (pagamentoVencedor) {
      const situacaoConcorrente = await calcularSituacaoQuitacaoProposta(supabase, idInt);
      return NextResponse.json({
        success: true,
        idempotente: true,
        pagamentoId: pagamentoVencedor.id,
        totalPagoAtivo: situacaoConcorrente.novoValorQuitado,
        totalProposta: situacaoConcorrente.valorTotalProposta,
        quitada: situacaoConcorrente.novoValorQuitado >= (situacaoConcorrente.valorTotalProposta - 0.02) && situacaoConcorrente.valorTotalProposta > 0,
      });
    }
    return NextResponse.json(
      { success: false, error: `Falha ao registrar chave de idempotência: ${chaveError.message}` },
      { status: 500 }
    );
  }

  // ── 7. Consumir pendências FIFO até cobrir o valor solicitado ─────────────
  let restante = valorArredondado;
  const slicesConsumidos: Array<{ idPendencia: number | null; valor: number }> = [];

  for (const p of pendencias) {
    if (restante <= 0) break;
    const slice = Math.min(restante, Number(p.valor_saldo));
    if (slice < 0.01) continue;

    const { error: rpcError } = await supabase.rpc("cc_usar_pendencia", {
      p_id_pendencia: p.id,
      p_valor: slice,
      p_modo: "CREDITO_IMEDIATO",
      p_id_int_destino: idInt,
      p_id_pagamento: novoPagamento.id,
      p_chave_reserva: null,
      p_observacao: obsBase,
    });

    if (rpcError) {
      console.error(`[usar-credito] Falha ao consumir pendência ${p.id}:`, rpcError.message);
      // Falha parcial: reverte o pagamento localmente e alerta para conferência
      // manual (mesmo padrão de pagamento-combinado). Não tenta estornar as
      // pendências já consumidas via RPC (ESTORNO é exclusivo de admin/superadmin
      // na v1 — este endpoint pode ser chamado por vendedor).
      await supabase.from("pagamentos_v2").update({ status: "CANCELADO", motivo_cancela: "Falha ao consumir crédito da conta corrente." }).eq("id", novoPagamento.id);
      const msgFalha = `ATENÇÃO: falha ao aplicar crédito na proposta #${idInt} após consumir R$ ${(valorArredondado - restante).toFixed(2)}. Pagamento E-Crédito cancelado. Erro: ${rpcError.message}. Requer conferência manual do Financeiro.`;
      await supabase.from("propostas_chat").insert([{
        id_int: idInt, id_cliente: idCliente, mensagem: msgFalha, tipo: "SISTEMA",
        autor_nome: "Sistema", setor: "Financeiro", visivel_externo: false, anexos: null,
      }]);
      return NextResponse.json({ success: false, error: msgFalha }, { status: 500 });
    }

    slicesConsumidos.push({ idPendencia: p.id, valor: slice });
    restante = Math.round((restante - slice) * 100) / 100;
  }

  // ── 7b. Restante após esgotar as pendências FIFO: cobre pelo crédito
  // avulso (origem=AJUSTE, sem pendência) via mc_usar_credito_avulso — é
  // exatamente o caso do cliente cujo crédito é só ajuste manual (pendências
  // vem vazio, restante = valor total solicitado). RPC recalcula o saldo real
  // (soma de toda a razão) sob trava do cliente antes de gravar, então só
  // falha aqui numa corrida genuína de saldo.
  if (restante > 0.01) {
    const { error: avulsoError } = await supabase.rpc("mc_usar_credito_avulso", {
      p_id_cliente: idCliente,
      p_valor: restante,
      p_id_int_destino: idInt,
      p_id_pagamento: novoPagamento.id,
      p_observacao: obsBase,
    });

    if (avulsoError) {
      console.error(`[usar-credito] Falha ao consumir crédito avulso (R$ ${restante.toFixed(2)}):`, avulsoError.message);
      await supabase.from("pagamentos_v2").update({ status: "CANCELADO", motivo_cancela: "Falha ao consumir crédito avulso da conta corrente." }).eq("id", novoPagamento.id);
      const msgFalha = `ATENÇÃO: falha ao aplicar crédito na proposta #${idInt} após consumir R$ ${(valorArredondado - restante).toFixed(2)} em pendências. Pagamento E-Crédito cancelado. Erro: ${avulsoError.message}. Requer conferência manual do Financeiro.`;
      await supabase.from("propostas_chat").insert([{
        id_int: idInt, id_cliente: idCliente, mensagem: msgFalha, tipo: "SISTEMA",
        autor_nome: "Sistema", setor: "Financeiro", visivel_externo: false, anexos: null,
      }]);
      return NextResponse.json({ success: false, error: msgFalha }, { status: 500 });
    }

    slicesConsumidos.push({ idPendencia: null, valor: restante });
    restante = 0;
  }

  if (restante > 0.01) {
    // Corrida rara: saldo mudou entre a leitura (passo 5) e o consumo (passos 7/7b).
    await supabase.from("pagamentos_v2").update({ status: "CANCELADO", motivo_cancela: "Saldo insuficiente no momento do consumo." }).eq("id", novoPagamento.id);
    return NextResponse.json(
      { success: false, error: `Saldo insuficiente no momento do processamento (restante não coberto: R$ ${restante.toFixed(2)}). Tente novamente.` },
      { status: 409 }
    );
  }

  console.info(`[usar-credito] Concluído: proposta=#${idInt}, pagamento=${novoPagamento.id}, pendencias=${JSON.stringify(slicesConsumidos)}`);

  // ── 8. Calcular quitação oficial ───────────────────────────────────────────
  const situacao = await calcularSituacaoQuitacaoProposta(supabase, idInt);
  const quitada = situacao.novoValorQuitado >= (situacao.valorTotalProposta - 0.02) && situacao.valorTotalProposta > 0;

  return NextResponse.json({
    success: true,
    pagamentoId: novoPagamento.id,
    pendenciasConsumidas: slicesConsumidos,
    totalPagoAtivo: situacao.novoValorQuitado,
    totalProposta: situacao.valorTotalProposta,
    quitada,
    possuiPagamentoPendente: situacao.saldoPendente > 0.02,
  });
}
