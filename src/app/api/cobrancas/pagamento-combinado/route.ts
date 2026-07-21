import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { resolveEmpresaIdFromTexto } from "@/features/cobrancas/cobrancas-utils";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { calcularSituacaoQuitacaoProposta } from "@/features/cobrancas/services/conferencia-financeira.service";
import { gerarPixBancoInter } from "@/features/cobrancas/services/banco-inter.service";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.error("[pagamento-combinado] ENV AUSENTE:", { hasUrl: Boolean(url), hasAnonKey: Boolean(anonKey) });
    return NextResponse.json(
      { success: false, error: "Configuração de ambiente incompleta." },
      { status: 500 }
    );
  }

  if (!token) {
    return NextResponse.json({ success: false, error: "Sessão não encontrada." }, { status: 401 });
  }

  const supabaseUser = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabaseUser.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, error: "Sessão inválida." }, { status: 401 });
  }
  const user = { id: authData.user.id, email: authData.user.email ?? "", nome: authData.user.user_metadata?.name || "Usuário" };

  const temPermissaoCredito = await verificarPermissaoServerSide(supabaseUser, user.id, "credito.usar");
  const temPermissaoEmitir = await verificarPermissaoServerSide(supabaseUser, user.id, "cobrancas.emitir_boleto");

  if (!temPermissaoCredito || !temPermissaoEmitir) {
    return NextResponse.json(
      { success: false, error: "Você não tem permissões suficientes para realizar o pagamento combinado (credito.usar e cobrancas.emitir_boleto)." },
      { status: 403 }
    );
  }

  // 3. Payload
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Payload inválido." }, { status: 400 });
  }

  const {
    idInt,
    idCliente,
    valorCredito,
    valorSecundario,
    tipoSecundario,
    empresa,
    atendente,
    vencimento,
    forma_pgto,
    forma_fatu,
    observacao,
    chaveIdempotencia
  } = body;

  if (!idInt || !idCliente || !valorCredito || !valorSecundario || !tipoSecundario) {
    return NextResponse.json(
      { success: false, error: "Parâmetros obrigatórios ausentes." },
      { status: 400 }
    );
  }
  if (!chaveIdempotencia || typeof chaveIdempotencia !== "string" || !/^[0-9a-f-]{36}$/i.test(chaveIdempotencia)) {
    return NextResponse.json(
      { success: false, error: "chaveIdempotencia (UUID) é obrigatória." },
      { status: 400 }
    );
  }
  const valorCreditoArredondado = Math.round(Number(valorCredito) * 100) / 100;

  try {
    // A. Consultar Proposta
    const { data: proposta, error: propostaErr } = await supabaseUser
      .from("propostas")
      .select("id_int, id_cliente, empresa")
      .eq("id_int", idInt)
      .maybeSingle();

    if (propostaErr || !proposta) {
      return NextResponse.json({ success: false, error: "Proposta não encontrada." }, { status: 404 });
    }

    const idEmpresaReal = resolveEmpresaIdFromTexto(proposta.empresa);
    if (!idEmpresaReal) {
      return NextResponse.json({ success: false, error: "Empresa inválida ou não identificada na proposta." }, { status: 400 });
    }

    // B. Consultar Cliente Oficial
    const { data: clienteData, error: clienteErr } = await supabaseUser
      .from("clientes")
      .select("nome")
      .eq("id_cliente", idCliente)
      .maybeSingle();

    if (clienteErr || !clienteData) {
      return NextResponse.json({ success: false, error: "Cliente não encontrado no sistema." }, { status: 404 });
    }
    const nomeClienteReal = clienteData.nome;

    // B2. Idempotência: chave persistida por tentativa (não por janela de
    // tempo) — repetir a mesma requisição retorna o resultado anterior;
    // operações legítimas próximas no tempo (com chave diferente) nunca são
    // descartadas. Verificada ANTES do saldo disponível: se o crédito já foi
    // todo consumido pela tentativa anterior (bem-sucedida), o saldo atual
    // pode não cobrir mais o valor — mas a operação já foi feita, então a
    // resposta idempotente deve prevalecer sobre um novo "saldo insuficiente".
    const { data: pagamentoExistente } = await supabaseUser
      .from("pagamentos_v2")
      .select("id, status, motivo_cancela")
      .eq("chave_idempotencia", chaveIdempotencia)
      .maybeSingle();

    if (pagamentoExistente) {
      if (pagamentoExistente.status === "CANCELADO") {
        return NextResponse.json(
          { success: false, idempotente: true, error: pagamentoExistente.motivo_cancela || "Tentativa anterior falhou." },
          { status: 409 }
        );
      }
      const situacaoIdempotente = await calcularSituacaoQuitacaoProposta(supabaseUser, idInt);
      return NextResponse.json({
        success: true,
        idempotente: true,
        message: "Pagamento combinado já foi processado (repetição idempotente).",
        totalPagoAtivo: situacaoIdempotente.novoValorQuitado,
        totalProposta: situacaoIdempotente.valorTotalProposta,
        quitada: situacaoIdempotente.novoValorQuitado >= (situacaoIdempotente.valorTotalProposta - 0.02) && situacaoIdempotente.valorTotalProposta > 0,
      });
    }

    // C. Saldo real disponível — MESMA fonte usada no banner/modal
    // (getSaldoCredito/getSaldoContaCorrente): soma de toda a razão não
    // cancelada do cliente em movimento_credito, nunca o payload do cliente.
    // Cobre tanto pendências FAVOR_CLIENTE quanto crédito avulso manual
    // (origem=AJUSTE, sem pendência) — ver mc_usar_credito_avulso.
    const { data: ledgerBanco, error: ledgerErr } = await supabaseUser
      .from("movimento_credito")
      .select("valor, tipo")
      .eq("id_cliente", idCliente)
      .eq("cancelado", false);

    if (ledgerErr) {
      return NextResponse.json({ success: false, error: "Falha ao consultar saldo." }, { status: 500 });
    }

    const saldoReal = Math.round(
      (ledgerBanco || []).reduce((sum, r) => sum + (r.tipo === "CREDITO" ? Number(r.valor) || 0 : -(Number(r.valor) || 0)), 0) * 100
    ) / 100;

    if (saldoReal < valorCreditoArredondado - 0.01) {
      return NextResponse.json({ success: false, error: "Saldo de E-Crédito insuficiente." }, { status: 400 });
    }

    // C2. Pendências FAVOR_CLIENTE utilizáveis, mais antigas primeiro (FIFO) —
    // pode vir vazio quando o crédito é 100% avulso; nesse caso o passo
    // seguinte (após o loop) cobre o valor inteiro pelo crédito avulso.
    const { data: pendenciasBanco, error: pendenciasErr } = await supabaseUser
      .from("conta_corrente_pendencias")
      .select("id, valor_saldo")
      .eq("id_cliente", idCliente)
      .eq("direcao", "FAVOR_CLIENTE")
      .in("status", ["ABERTA", "PARCIALMENTE_RESOLVIDA"])
      .order("created_at", { ascending: true });

    if (pendenciasErr) {
      return NextResponse.json({ success: false, error: "Falha ao consultar saldo." }, { status: 500 });
    }

    const pendencias = pendenciasBanco || [];

    // D. Criar Cobrança E-CREDITO (antes do consumo — cada slice FIFO referencia este id)
    const payloadCobrancaCredito = {
      id_int: idInt,
      id_cliente: idCliente,
      cliente: nomeClienteReal,
      valor: valorCreditoArredondado,
      status: "PAID",
      tipo_cobranca: "E-CREDITO",
      confirmado: true,
      confirmado_por: atendente || "Sistema",
      data_confirmacao: new Date().toISOString(),
      paid_at: new Date().toISOString(),
      descricao: `Uso parcial de crédito via pagamento combinado`,
      empresa: empresa || "IDEAL",
      id_empresa: idEmpresaReal,
      atendente: atendente || user.nome,
      vencimento: vencimento || new Date().toISOString().split("T")[0],
      token_publico: crypto.randomBytes(16).toString("hex")
    };

    const { data: insertedCredito, error: errPagV2Credito } = await supabaseUser
      .from("pagamentos_v2")
      .insert([payloadCobrancaCredito])
      .select("id")
      .single();

    if (errPagV2Credito || !insertedCredito) {
      return NextResponse.json({ success: false, error: "Falha ao salvar a cobrança E-Crédito." }, { status: 500 });
    }

    // Registrar a chave de idempotência via RPC — único caminho permitido
    // para gravar pagamentos_v2.chave_idempotencia (INSERT/UPDATE diretos
    // nessa coluna são revogados de authenticated na migration; SECURITY
    // DEFINER é a exceção). Corrida rara: duas requisições concorrentes com
    // a mesma chave criam cada uma seu próprio pagamento (chave_idempotencia
    // começa NULL nas duas); só uma consegue registrar a chave (índice
    // único). A perdedora cancela o próprio pagamento e devolve o resultado
    // da vencedora.
    const { error: chaveError } = await supabaseUser.rpc("pgv2_registrar_chave_idempotencia", {
      p_id_pagamento: insertedCredito.id,
      p_chave_idempotencia: chaveIdempotencia,
    });

    if (chaveError) {
      console.warn(`[pagamento-combinado] Corrida de idempotência detectada (chave=${chaveIdempotencia}): ${chaveError.message}`);
      await supabaseUser.from("pagamentos_v2").update({
        status: "CANCELADO",
        motivo_cancela: "Requisição duplicada (mesma chave de idempotência já registrada por outro pagamento).",
      }).eq("id", insertedCredito.id);

      const { data: concorrente } = await supabaseUser
        .from("pagamentos_v2")
        .select("id")
        .eq("chave_idempotencia", chaveIdempotencia)
        .maybeSingle();
      if (concorrente) {
        return NextResponse.json({ success: true, idempotente: true, message: "Pagamento combinado já foi processado (repetição idempotente)." });
      }
      return NextResponse.json({ success: false, error: `Falha ao registrar chave de idempotência: ${chaveError.message}` }, { status: 500 });
    }

    // C. Consumir crédito FIFO via cc_usar_pendencia (trava de linha; sem lock de
    // filesystem). Em falha após consumir ao menos uma pendência, cancela a
    // cobrança E-CREDITO local e alerta o Financeiro (não tenta ESTORNO — é
    // exclusivo de admin/superadmin na v1 e este endpoint pode ser chamado por vendedor).
    let restante = valorCreditoArredondado;
    for (const p of pendencias) {
      if (restante <= 0) break;
      const slice = Math.min(restante, Number(p.valor_saldo));
      if (slice < 0.01) continue;

      const { error: rpcError } = await supabaseUser.rpc("cc_usar_pendencia", {
        p_id_pendencia: p.id,
        p_valor: slice,
        p_modo: "CREDITO_IMEDIATO",
        p_id_int_destino: idInt,
        p_id_pagamento: insertedCredito.id,
        p_chave_reserva: null,
        p_observacao: observacao || `Uso parcial em pagamento combinado. Proposta #${idInt}`,
      });

      if (rpcError) {
        console.error(`[pagamento-combinado] Falha ao consumir pendência ${p.id}:`, rpcError.message);
        await supabaseUser.from("pagamentos_v2").update({ status: "CANCELADO", motivo_cancela: "Falha ao consumir crédito da conta corrente." }).eq("id", insertedCredito.id);
        const msgFalha = `ATENÇÃO: falha ao aplicar crédito (pagamento combinado) na proposta #${idInt} após consumir R$ ${(valorCreditoArredondado - restante).toFixed(2)}. Cobrança E-Crédito cancelada. Erro: ${rpcError.message}. Requer conferência manual do Financeiro.`;
        await supabaseUser.from("propostas_chat").insert([{
          id_int: idInt, id_cliente: idCliente, mensagem: msgFalha, tipo: "SISTEMA",
          autor_nome: "Sistema", setor: "Financeiro", visivel_externo: false, anexos: null,
        }]);
        return NextResponse.json({ success: false, error: msgFalha }, { status: 500 });
      }
      restante = Math.round((restante - slice) * 100) / 100;
    }

    // Restante após esgotar as pendências FIFO: cobre pelo crédito avulso
    // (origem=AJUSTE, sem pendência) via mc_usar_credito_avulso. RPC recalcula
    // o saldo real sob trava do cliente antes de gravar, então só falha aqui
    // numa corrida genuína de saldo.
    if (restante > 0.01) {
      const { error: avulsoError } = await supabaseUser.rpc("mc_usar_credito_avulso", {
        p_id_cliente: idCliente,
        p_valor: restante,
        p_id_int_destino: idInt,
        p_id_pagamento: insertedCredito.id,
        p_observacao: observacao || `Uso parcial em pagamento combinado. Proposta #${idInt}`,
      });

      if (avulsoError) {
        console.error(`[pagamento-combinado] Falha ao consumir crédito avulso (R$ ${restante.toFixed(2)}):`, avulsoError.message);
        await supabaseUser.from("pagamentos_v2").update({ status: "CANCELADO", motivo_cancela: "Falha ao consumir crédito avulso da conta corrente." }).eq("id", insertedCredito.id);
        const msgFalha = `ATENÇÃO: falha ao aplicar crédito (pagamento combinado) na proposta #${idInt} após consumir R$ ${(valorCreditoArredondado - restante).toFixed(2)} em pendências. Cobrança E-Crédito cancelada. Erro: ${avulsoError.message}. Requer conferência manual do Financeiro.`;
        await supabaseUser.from("propostas_chat").insert([{
          id_int: idInt, id_cliente: idCliente, mensagem: msgFalha, tipo: "SISTEMA",
          autor_nome: "Sistema", setor: "Financeiro", visivel_externo: false, anexos: null,
        }]);
        return NextResponse.json({ success: false, error: msgFalha }, { status: 500 });
      }

      restante = 0;
    }

    if (restante > 0.01) {
      await supabaseUser.from("pagamentos_v2").update({ status: "CANCELADO", motivo_cancela: "Saldo insuficiente no momento do consumo." }).eq("id", insertedCredito.id);
      return NextResponse.json({ success: false, error: `Saldo insuficiente no momento do processamento (restante não coberto: R$ ${restante.toFixed(2)}). Tente novamente.` }, { status: 409 });
    }

    // E. Criar Cobrança Secundária
    const payloadSecundaria = {
      id_int: idInt,
      id_cliente: idCliente,
      cliente: nomeClienteReal,
      valor: valorSecundario,
      status: tipoSecundario === "E-FATURADO" ? "A_VENCER" : "A_RECEBER",
      tipo_cobranca: tipoSecundario,
      confirmado: false,
      descricao: `Pagamento combinado (Restante)`,
      empresa: empresa || "IDEAL",
      id_empresa: idEmpresaReal,
      atendente: atendente || user.nome,
      vencimento: vencimento || new Date().toISOString().split("T")[0],
      token_publico: crypto.randomBytes(16).toString("hex"),
      forma_pgto: forma_pgto,
      forma_fatu: forma_fatu
    };

    const { data: insertedSecundaria, error: errPagSecundaria } = await supabaseUser
      .from("pagamentos_v2")
      .insert([payloadSecundaria])
      .select()
      .single();

    if (errPagSecundaria || !insertedSecundaria) {
      // FALHA NA SEGUNDA COBRANÇA
      const msgFalha = `ATENÇÃO: Crédito de R$ ${valorCredito} utilizado, mas a geração da cobrança do restante (${tipoSecundario} de R$ ${valorSecundario}) FALHOU. Favor regularizar a proposta. Motivo: ${errPagSecundaria?.message || "Erro desconhecido"}`;
      
      await supabaseUser.from("propostas_chat").insert([{
        id_int: idInt,
        id_cliente: idCliente,
        mensagem: msgFalha,
        tipo: "SISTEMA",
        autor_nome: "Sistema",
        setor: "Financeiro",
        visivel_externo: false
      }]);

      await supabaseUser.from("propostas_pendencias").insert([{
        id_int: idInt,
        id_cliente: idCliente,
        titulo: "Erro no pagamento combinado",
        descricao: msgFalha,
        categoria: "PAGAMENTO",
        status: "ABERTA",
        prioridade: "ALTA",
        responsavel_setor: "FINANCEIRO",
        origem: "SISTEMA",
        criado_por_user_id: user.id,
        criado_por_nome: user.nome,
        id_empresa: idEmpresaReal,
      }]);

      return NextResponse.json({ success: false, isCombinadoParcial: true, error: msgFalha }, { status: 200 });
    }

    // Geração do PIX Banco Inter
    let pixData = null;
    let interError: string | null = null;
    const isPix = tipoSecundario === "PIX" || tipoSecundario === "E-PIX";

    if (isPix) {
      // Buscar dados de faturamento do cliente
      const { data: clienteFatu } = await supabaseUser
        .from("clientes")
        .select("cnpj_cpf, telefone, celular, endereco, numero, complemento, bairro, cidade, uf, cep")
        .eq("id_cliente", idCliente)
        .maybeSingle();

      const { data: propostaFatu } = await supabaseUser
        .from("propostas")
        .select("contato")
        .eq("id_int", idInt)
        .maybeSingle();

      const telefoneCli = propostaFatu?.contato?.whatsapp || clienteFatu?.celular || clienteFatu?.telefone || "";

      const resPix = await gerarPixBancoInter(supabaseUser, {
        cobrancaId: insertedSecundaria.id,
        idEmpresa: idEmpresaReal,
        seuNumero: idEmpresaReal === 2 ? (insertedSecundaria.id_pagamento || String(idInt)) : String(idInt),
        valorNominal: valorSecundario,
        dataVencimento: vencimento || new Date().toISOString().split("T")[0],
        telefone: telefoneCli,
        cpfCnpj: clienteFatu?.cnpj_cpf || "",
        nome: nomeClienteReal,
        endereco: `${clienteFatu?.endereco || ""}, ${clienteFatu?.numero || ""} ${clienteFatu?.complemento || ""}`.trim(),
        cidade: clienteFatu?.cidade || "",
        uf: clienteFatu?.uf || "",
        cep: clienteFatu?.cep || ""
      });

      if (resPix.success) {
        pixData = resPix.data;
      } else {
        interError = resPix.error || "Erro desconhecido na emissão do PIX Inter";
      }
    }

    if (interError) {
      // Crédito e cobrança secundária já foram efetivados/criados acima e NÃO
      // são desfeitos aqui — só a geração do PIX (integração externa) falhou.
      // A cobrança (insertedSecundaria.id) fica pendente, sem pix_copia_cola,
      // pronta para nova tentativa via /api/cobrancas/gerar-pix (idempotente:
      // não rechama o webhook se o PIX já tiver sido gerado).
      const msgFalha = `Crédito de R$ ${valorCredito} utilizado, mas a geração do PIX Inter de R$ ${valorSecundario} falhou: ${interError}. A cobrança secundária (#${insertedSecundaria.id}) foi criada como pendente de geração — pode ser retentada sem novo consumo de crédito.`;

      await supabaseUser.from("propostas_chat").insert([{
        id_int: idInt,
        id_cliente: idCliente,
        mensagem: msgFalha,
        tipo: "SISTEMA",
        autor_nome: "Sistema",
        setor: "Financeiro",
        visivel_externo: false
      }]);

      await supabaseUser.from("propostas_pendencias").insert([{
        id_int: idInt,
        id_cliente: idCliente,
        titulo: "Erro ao gerar PIX combinado",
        descricao: msgFalha,
        categoria: "PAGAMENTO",
        status: "ABERTA",
        prioridade: "ALTA",
        responsavel_setor: "FINANCEIRO",
        origem: "SISTEMA",
        criado_por_user_id: user.id,
        criado_por_nome: user.nome,
        id_empresa: idEmpresaReal,
      }]);

      return NextResponse.json({
        success: false,
        isCombinadoParcial: true,
        error: msgFalha,
        cobrancaPendenteId: insertedSecundaria.id,
        cobrancaPendenteIdPagamento: insertedSecundaria.id_pagamento,
        tipoCobrancaPendente: tipoSecundario
      }, { status: 200 });
    }

    // SUCESSO
    const msgSucesso = `Pagamento combinado definido: E-Crédito (R$ ${valorCredito}) + ${tipoSecundario} (R$ ${valorSecundario}).`;
    await supabaseUser.from("propostas_chat").insert([{
      id_int: idInt,
      id_cliente: idCliente,
      mensagem: msgSucesso,
      tipo: "SISTEMA",
      autor_nome: user.nome,
      setor: "Financeiro",
      visivel_externo: false
    }]);

    // F. Calcular quitação oficial
    const situacao = await calcularSituacaoQuitacaoProposta(supabaseUser, idInt);
    const quitada = situacao.novoValorQuitado >= (situacao.valorTotalProposta - 0.02) && situacao.valorTotalProposta > 0;
    
    return NextResponse.json({ 
      success: true, 
      message: "Pagamento combinado gerado com sucesso.",
      totalPagoAtivo: situacao.novoValorQuitado,
      totalProposta: situacao.valorTotalProposta,
      quitada,
      possuiPagamentoPendente: situacao.saldoPendente > 0.02,
      pixData
    });

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
  }
}
