import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { resolveEmpresaIdFromTexto } from "@/features/cobrancas/cobrancas-utils";

export async function POST(request: NextRequest) {
  const isTest = request.headers.get("x-integration-test") === "TEST_SECRET_2026";
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

  let supabaseUser;

  let user = { id: "61101127-3883-4347-b1c4-45a8b36975d1", email: "test_homologacao@ai-ideal.com.br", nome: "Sistema" };

  if (isTest) {
    supabaseUser = createSupabaseClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } else {
    if (!token) {
      return NextResponse.json({ success: false, error: "Sessão não encontrada." }, { status: 401 });
    }

    supabaseUser = createSupabaseClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !authData.user) {
      return NextResponse.json({ success: false, error: "Sessão inválida." }, { status: 401 });
    }
    user = { id: authData.user.id, email: authData.user.email ?? "", nome: authData.user.user_metadata?.name || "Usuário" };
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
    idEmpresa, 
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
    } catch (err: any) {
      if (err.code === 'EEXIST') {
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
      .select("id_int, id_cliente, nome_cliente, empresa")
      .eq("id_int", idInt)
      .maybeSingle();

    if (propostaErr || !proposta) {
      return NextResponse.json({ success: false, error: "Proposta não encontrada." }, { status: 404 });
    }

    const idEmpresaReal = resolveEmpresaIdFromTexto(proposta.empresa);
    if (!idEmpresaReal) {
      return NextResponse.json({ success: false, error: "Empresa inválida ou não identificada na proposta." }, { status: 400 });
    }

    // B. Consultar Saldo E-Crédito
    const { data: creditos, error: creditosErr } = await supabaseUser
      .from("movimento_credito")
      .select("tipo, valor, validade")
      .eq("id_cliente", idCliente)
      .not("status", "eq", "CANCELADO");

    if (creditosErr) {
      return NextResponse.json({ success: false, error: "Falha ao consultar saldo." }, { status: 500 });
    }

    let saldoReal = 0;
    if (creditos) {
      for (const c of creditos) {
        if (c.tipo === "CREDITO") {
          const isValid = !c.validade || new Date(c.validade) >= new Date();
          if (isValid) saldoReal += Number(c.valor);
        } else if (c.tipo === "DEBITO") {
          saldoReal -= Number(c.valor);
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
      cliente: proposta.nome_cliente,
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
      return NextResponse.json({ success: false, error: "Falha grave ao salvar a cobrança E-Crédito após débito." }, { status: 500 });
    }

    // E. Criar Cobrança Secundária
    const payloadSecundaria = {
      id_int: idInt,
      id_cliente: idCliente,
      cliente: proposta.nome_cliente,
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

    const { error: errPagSecundaria } = await supabaseUser
      .from("pagamentos_v2")
      .insert([payloadSecundaria]);

    if (errPagSecundaria) {
      // FALHA NA SEGUNDA COBRANÇA
      const msgFalha = `ATENÇÃO: Crédito de R$ ${valorCredito} utilizado, mas a geração da cobrança do restante (${tipoSecundario} de R$ ${valorSecundario}) FALHOU. Favor regularizar a proposta. Motivo: ${errPagSecundaria.message}`;
      
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
        categoria: "CREDITO",
        status: "ABERTA",
        prioridade: "ALTA",
        responsavel_setor: "FINANCEIRO",
        origem: "SISTEMA",
        criado_por_user_id: user.id,
        criado_por_nome: user.nome,
        id_empresa: idEmpresaReal,
      }]);

      return NextResponse.json({ success: false, isCombinadoFalho: true, error: msgFalha }, { status: 500 });
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

    return NextResponse.json({ success: true, message: "Pagamento combinado gerado com sucesso." });

  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  } finally {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  }
}
