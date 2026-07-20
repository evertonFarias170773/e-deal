import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
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
    observacao
  } = body;

  if (!idInt || !idCliente || !valorCredito || !valorSecundario || !tipoSecundario) {
    return NextResponse.json(
      { success: false, error: "Parâmetros obrigatórios ausentes." },
      { status: 400 }
    );
  }

  // Lock
  const lockPath = path.join(process.cwd(), `.lock_pagamento_combinado_${idInt}`);
  let lockAdquirido = false;
  const startTime = Date.now();

  while (Date.now() - startTime < 5000) {
    try {
      fs.writeFileSync(lockPath, 'LOCKED', { flag: 'wx' });
      lockAdquirido = true;
      break;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'EEXIST') {
        await new Promise(resolve => setTimeout(resolve, 50));
      } else {
        throw err;
      }
    }
  }

  if (!lockAdquirido) {
    return NextResponse.json({ success: false, error: "Serviço temporariamente indisponível. Tente novamente." }, { status: 503 });
  }

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

    // C. Consultar Saldo E-Crédito (recalculado no servidor, nunca aceito do cliente)
    const { data: creditos, error: creditosErr } = await supabaseUser
      .from("movimento_credito")
      .select("tipo, valor")
      .eq("id_cliente", idCliente)
      .eq("cancelado", false);

    if (creditosErr) {
      return NextResponse.json({ success: false, error: "Falha ao consultar saldo." }, { status: 500 });
    }

    let saldoReal = 0;
    if (creditos) {
      for (const c of creditos) {
        const v = Number(c.valor) || 0;
        if (c.tipo === "CREDITO") {
          saldoReal += v;
        } else if (c.tipo === "DEBITO") {
          saldoReal -= v;
        }
      }
    }

    if (saldoReal < valorCredito - 0.01) {
      return NextResponse.json({ success: false, error: "Saldo de E-Crédito insuficiente." }, { status: 400 });
    }

    // Idempotência
    const cincoMinAtras = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: consumoRecente } = await supabaseUser
      .from("movimento_credito")
      .select("id")
      .eq("id_int", idInt)
      .eq("tipo", "DEBITO")
      .eq("valor", valorCredito)
      .gte("created_at", cincoMinAtras)
      .maybeSingle();

    if (consumoRecente) {
      return NextResponse.json({ success: true, message: "Pagamento combinado já foi processado recentemente." });
    }

    // C. Consumir Crédito
    const payloadMovimento = {
      id_cliente: idCliente,
      tipo: "DEBITO",
      valor: valorCredito,
      origem: "SISTEMA",
      observacao: observacao || `Uso parcial em pagamento combinado. Proposta #${idInt}`,
      id_int: idInt,
      created_by: user.id
    };

    const { data: insertedMovimento, error: erroMovimento } = await supabaseUser
      .from("movimento_credito")
      .insert([payloadMovimento])
      .select()
      .single();

    if (erroMovimento || !insertedMovimento) {
      return NextResponse.json({ success: false, error: "Falha ao descontar saldo de E-Crédito." }, { status: 500 });
    }

    // D. Criar Cobrança E-CREDITO
    const payloadCobrancaCredito = {
      id_int: idInt,
      id_cliente: idCliente,
      cliente: nomeClienteReal,
      valor: valorCredito,
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

    const { error: errPagV2Credito } = await supabaseUser
      .from("pagamentos_v2")
      .insert([payloadCobrancaCredito]);

    if (errPagV2Credito) {
      // Rollback compensatório: cancela logicamente o débito já gravado (nunca DELETE físico).
      await supabaseUser
        .from("movimento_credito")
        .update({
          cancelado: true,
          cancelado_em: new Date().toISOString(),
          cancelado_por: user.id,
        })
        .eq("id", insertedMovimento.id);

      return NextResponse.json({ success: false, error: "Falha grave ao salvar a cobrança E-Crédito após débito. Débito estornado automaticamente." }, { status: 500 });
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
      const msgFalha = `Crédito de R$ ${valorCredito} utilizado, mas a geração do PIX Inter de R$ ${valorSecundario} falhou: ${interError}. A cobrança secundária foi criada como pendente de geração.`;
      
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
        error: msgFalha
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
  } finally {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  }
}
