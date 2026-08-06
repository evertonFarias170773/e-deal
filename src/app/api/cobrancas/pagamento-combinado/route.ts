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
    // A. Consultar Proposta (id_endereco_ent = endereço de entrega vinculado,
    // usado na emissão do PIX — mesma fonte do enderecoEntrega do front)
    const { data: proposta, error: propostaErr } = await supabaseUser
      .from("propostas")
      .select("id_int, id_cliente, empresa, id_endereco_ent")
      .eq("id_int", idInt)
      .maybeSingle();

    if (propostaErr || !proposta) {
      return NextResponse.json({ success: false, error: "Proposta não encontrada." }, { status: 404 });
    }

    const idEmpresaReal = resolveEmpresaIdFromTexto(proposta.empresa);
    if (!idEmpresaReal) {
      return NextResponse.json({ success: false, error: "Empresa inválida ou não identificada na proposta." }, { status: 400 });
    }

    // B. Consultar Cliente Oficial — colunas REAIS de public.clientes
    // (documento/whatsapp_1/telefone_fixo; NÃO existem cnpj_cpf/telefone/celular
    // nem colunas de endereço em clientes — causa do PIX combinado sair com
    // payload vazio no caso #19514).
    const { data: clienteData, error: clienteErr } = await supabaseUser
      .from("clientes")
      .select("nome, documento, whatsapp_1, telefone_fixo, email_contato, email")
      .eq("id_cliente", idCliente)
      .maybeSingle();

    if (clienteErr || !clienteData) {
      return NextResponse.json({ success: false, error: "Cliente não encontrado no sistema." }, { status: 404 });
    }
    const nomeClienteReal = clienteData.nome;
    const documentoClienteReal = String(clienteData.documento || "").replace(/\D/g, "");
    const telefoneClienteReal = clienteData.whatsapp_1 || clienteData.telefone_fixo || "";
    // Mesma precedência do cadastro oficial (getCadastroCompleto): email_contato > email
    const emailClienteReal = String(clienteData.email_contato || clienteData.email || "").trim();

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

    // B3. Pré-validações do secundário BOLETO/CARTÃO — rodam ANTES de qualquer
    // efeito (consumo de crédito, criação de cobrança): falha aqui devolve 400
    // limpo, sem nada a regularizar. Espelham os gates do fluxo normal
    // (não-combinado) do PropostaCobrancaPanel/CobrancasProvider. Ficam DEPOIS
    // da checagem de idempotência (B2): uma repetição de operação já concluída
    // deve devolver o resultado anterior, nunca um novo 400.
    const isBoletoSecundario = tipoSecundario === "BOLETO";
    const isCartaoSecundario = tipoSecundario === "CARD_PARCELADO";

    if ((isBoletoSecundario || isCartaoSecundario) && idEmpresaReal === 2) {
      return NextResponse.json(
        { success: false, error: `Geração de ${isBoletoSecundario ? "boleto" : "cartão de crédito"} real não disponível para a empresa Ideal Birô.` },
        { status: 400 }
      );
    }
    if ((isBoletoSecundario || isCartaoSecundario) && !documentoClienteReal) {
      return NextResponse.json(
        { success: false, error: "Documento (CPF/CNPJ) do cliente é obrigatório para gerar a cobrança secundária. Complete o cadastro e tente novamente." },
        { status: 400 }
      );
    }
    if (isBoletoSecundario && !emailClienteReal) {
      return NextResponse.json(
        { success: false, error: "Cliente sem e-mail cadastrado para geração do boleto. Complete o cadastro e tente novamente." },
        { status: 400 }
      );
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
      // PAID sim, confirmado NÃO: o crédito já saiu da razão do cliente e
      // abate a proposta, mas conferir é ato do Financeiro — quem aplica é o
      // vendedor. Sem confirmado_por/data_confirmacao pelo mesmo motivo.
      confirmado: false,
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
      // Só é corrida se existir mesmo um pagamento com esta chave. Caso
      // contrário é erro de banco, e gravar "requisição duplicada" no
      // motivo esconde a causa real na auditoria (ver usar-credito).
      const { data: concorrente } = await supabaseUser
        .from("pagamentos_v2")
        .select("id")
        .eq("chave_idempotencia", chaveIdempotencia)
        .maybeSingle();

      console.warn(
        `[pagamento-combinado] Falha ao registrar chave ${chaveIdempotencia} (corrida=${Boolean(concorrente)}): ${chaveError.message}`
      );
      await supabaseUser.from("pagamentos_v2").update({
        status: "CANCELADO",
        motivo_cancela: concorrente
          ? "Requisição duplicada (mesma chave de idempotência já registrada por outro pagamento)."
          : `Falha ao registrar a chave de idempotência: ${chaveError.message}`,
      }).eq("id", insertedCredito.id);

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
      forma_fatu: forma_fatu,
      // Fluxo normal (CobrancasProvider) grava documento na cobrança real de
      // boleto/cartão — espelhado aqui; PIX permanece como está.
      ...(isBoletoSecundario || isCartaoSecundario ? { documento: clienteData.documento || null } : {})
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

    // Geração da integração do secundário (PIX Inter / Boleto C6 / link cartão)
    let pixData = null;
    let interError: string | null = null;
    const isPix = tipoSecundario === "PIX" || tipoSecundario === "E-PIX";

    // Boleto/cartão: fluxo normal (CobrancasProvider) gera token_publico a
    // partir do primeiro bloco do UUID da cobrança e o link público
    // correspondente. Espelhado aqui para a cobrança secundária ter checkout
    // utilizável; PIX permanece com o comportamento atual (usa pix_copia_cola).
    if (isBoletoSecundario || isCartaoSecundario) {
      const tokenPublicoSec = String(insertedSecundaria.id).split("-")[0];
      const { error: tokenErr } = await supabaseUser
        .from("pagamentos_v2")
        .update({
          token_publico: tokenPublicoSec,
          url_cobranca: `https://pay.ai-ideal.com.br/i/${tokenPublicoSec}`
        })
        .eq("id", insertedSecundaria.id);
      if (tokenErr) {
        console.error(`[pagamento-combinado] Falha ao gravar token/link públicos da cobrança secundária ${insertedSecundaria.id}:`, tokenErr.message);
        if (isCartaoSecundario) {
          // Para cartão o link público É a entrega — sem ele a cobrança fica
          // pendente de regularização (fluxo parcial abaixo).
          interError = "Falha ao gerar o link público de pagamento do cartão.";
        }
      }
    }

    // Endereço de entrega (PIX e Boleto): prioriza o endereço VINCULADO À
    // PROPOSTA (propostas.id_endereco_ent → public.enderecos — mesma resolução
    // de getPropostaDetailById); só cai para um endereço do cliente se a
    // proposta não tiver endereço vinculado. Erros dos SELECTs são checados
    // e logados — nunca mais engolir erro e enviar payload vazio ao banco.
    type EnderecoPix = {
      cep: string | null; endereco: string | null; numero: string | null;
      complemento: string | null; bairro: string | null; cidade: string | null;
      uf: string | null; tipo_endereco?: string | null;
    };
    let enderecoRow: EnderecoPix | null = null;

    if (isPix || isBoletoSecundario) {
      if (proposta.id_endereco_ent) {
        const { data: endProposta, error: endPropostaErr } = await supabaseUser
          .from("enderecos")
          .select("cep, endereco, numero, complemento, bairro, cidade, uf")
          .eq("id", proposta.id_endereco_ent)
          .maybeSingle();
        if (endPropostaErr) {
          console.error(`[pagamento-combinado] Erro ao buscar endereço da proposta (enderecos.id=${proposta.id_endereco_ent}):`, endPropostaErr.message);
        }
        enderecoRow = (endProposta as EnderecoPix | null) ?? null;
      }

      if (!enderecoRow) {
        const { data: endsCliente, error: endsClienteErr } = await supabaseUser
          .from("enderecos")
          .select("cep, endereco, numero, complemento, bairro, cidade, uf, tipo_endereco")
          .eq("id_cliente", idCliente)
          .limit(20);
        if (endsClienteErr) {
          console.error(`[pagamento-combinado] Erro ao buscar endereços do cliente ${idCliente}:`, endsClienteErr.message);
        }
        const lista = (endsCliente || []) as EnderecoPix[];
        enderecoRow =
          lista.find((e) => (e.tipo_endereco || "").toUpperCase().includes("ENTREGA")) ??
          lista.find((e) => (e.tipo_endereco || "").toUpperCase().includes("PRINCIPAL")) ??
          lista[0] ?? null;
      }
    }

    // Nunca chamar a integração com documento/endereço obrigatório vazio — o
    // webhook falharia com resposta vazia e sem diagnóstico (caso #19514).
    const camposFaltando: string[] = [];
    if (isPix || isBoletoSecundario) {
      if (!documentoClienteReal) camposFaltando.push("CPF/CNPJ do cliente");
      if (!enderecoRow?.endereco?.trim()) camposFaltando.push("endereço");
      if (!enderecoRow?.cidade?.trim()) camposFaltando.push("cidade");
      if (!enderecoRow?.uf?.trim()) camposFaltando.push("UF");
      if (!enderecoRow?.cep?.trim()) camposFaltando.push("CEP");
    }

    if (isPix) {
      if (camposFaltando.length > 0) {
        // A cobrança já criada permanece pendente (fluxo parcial abaixo) —
        // sem novo pagamento e sem novo consumo de crédito.
        interError = `Dados obrigatórios ausentes para emissão do PIX: ${camposFaltando.join(", ")}. Complete o cadastro/endereço do cliente e tente novamente.`;
      } else {
        const resPix = await gerarPixBancoInter(supabaseUser, {
          cobrancaId: insertedSecundaria.id,
          idEmpresa: idEmpresaReal,
          seuNumero: idEmpresaReal === 2 ? (insertedSecundaria.id_pagamento || String(idInt)) : String(idInt),
          valorNominal: valorSecundario,
          dataVencimento: vencimento || new Date().toISOString().split("T")[0],
          telefone: telefoneClienteReal,
          cpfCnpj: documentoClienteReal,
          nome: nomeClienteReal,
          endereco: `${enderecoRow?.endereco || ""}, ${enderecoRow?.numero || ""} ${enderecoRow?.complemento || ""}`.trim(),
          cidade: enderecoRow?.cidade || "",
          uf: enderecoRow?.uf || "",
          cep: enderecoRow?.cep || ""
        });

        if (resPix.success) {
          pixData = resPix.data;
        } else {
          interError = resPix.error || "Erro desconhecido na emissão do PIX Inter";
        }
      }
    } else if (isBoletoSecundario) {
      if (camposFaltando.length > 0) {
        // A cobrança já criada permanece pendente (fluxo parcial abaixo) —
        // sem novo pagamento e sem novo consumo de crédito.
        interError = `Dados obrigatórios ausentes para emissão do Boleto: ${camposFaltando.join(", ")}. Complete o cadastro/endereço do cliente e tente novamente.`;
      } else {
        // Emissão do boleto à vista na PRIMEIRA tentativa — mesmo webhook e
        // mesmo contrato de payload do fluxo normal (CobrancasProvider →
        // /api/cobrancas/gerar-boleto), com dados reais verificados no servidor.
        const boletoWebhookPayload = {
          external_reference_id: String(idInt),
          valor_total: Math.round(Number(valorSecundario) * 100) / 100,
          name: nomeClienteReal,
          id_pagamento: insertedSecundaria.id_pagamento || String(idInt),
          documento: clienteData.documento,
          email: emailClienteReal,
          logradouro: enderecoRow?.endereco || "",
          numero: enderecoRow?.numero || "S/N",
          complemento: enderecoRow?.complemento || "",
          cidade: enderecoRow?.cidade || "",
          UF: enderecoRow?.uf || "",
          zip_code: enderecoRow?.cep || "",
          qtd_parcelas: 1,
          intervalo: 0,
          inicia_em: 0,
          multa: 0,
          juros: 0,
          descricao: "O Pedido entrará em produção após a confirmação do pagamento.",
          id_cliente: idCliente,
          nf: "",
          status: "A_RECEBER",
          "e-faturado": false,
          contato: telefoneClienteReal,
          whats: telefoneClienteReal,
          enviar_whats: false,
          avulso: false,
          empresa: String(idEmpresaReal),
          is_prorrogado: false
        };

        try {
          const boletoResponse = await fetch("https://10074.hostoo.net.br/webhook/boleto-avista-vibe", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(boletoWebhookPayload)
          });

          // Leitura texto-primeiro (mesmo padrão do gerarPixBancoInter): corpo
          // vazio/não-JSON não derruba o fluxo — o contrato do boleto C6 admite
          // resposta sem corpo (PDF/linha chegam de forma assíncrona via n8n).
          const rawBoleto = await boletoResponse.text();
          const boletoPreview = rawBoleto.slice(0, 300);

          if (!boletoResponse.ok) {
            console.error(`[pagamento-combinado] Webhook Boleto retornou erro HTTP. status=${boletoResponse.status} bodyPreview=${JSON.stringify(boletoPreview)}`);
            interError = `Erro no processamento do Boleto C6 (HTTP ${boletoResponse.status}): ${boletoPreview || "sem corpo"}`;
          } else {
            let parsedBoleto: Record<string, unknown> | Array<Record<string, unknown>> = {};
            try {
              parsedBoleto = rawBoleto.trim() ? JSON.parse(rawBoleto) : {};
            } catch {
              // Mesmo contrato do /api/cobrancas/gerar-boleto: resposta não-JSON é ignorada.
            }
            const boletoResult = Array.isArray(parsedBoleto) ? parsedBoleto[0] : parsedBoleto;

            const updateBoleto: Record<string, unknown> = { boleto_enviadoo: true };
            if (boletoResult && typeof boletoResult.digitable_line === "string") {
              updateBoleto.linha_digitavel = boletoResult.digitable_line;
            }
            const { error: upBoletoErr } = await supabaseUser
              .from("pagamentos_v2")
              .update(updateBoleto)
              .eq("id", insertedSecundaria.id);
            if (upBoletoErr) {
              // Boleto emitido no banco; só o espelho local falhou — loga sem
              // marcar falha (não é recuperável reemitindo, que duplicaria).
              console.error(`[pagamento-combinado] Boleto emitido, mas falha ao atualizar cobrança ${insertedSecundaria.id}:`, upBoletoErr.message);
            }
          }
        } catch (boletoErr: unknown) {
          const msg = boletoErr instanceof Error ? boletoErr.message : String(boletoErr);
          console.error(`[pagamento-combinado] Exceção ao chamar webhook do Boleto:`, msg);
          interError = `Erro de conexão na emissão do Boleto: ${msg}`;
        }
      }
    }

    if (interError) {
      // Crédito e cobrança secundária já foram efetivados/criados acima e NÃO
      // são desfeitos aqui — só a geração da integração externa falhou.
      // A cobrança (insertedSecundaria.id) fica pendente; para PIX, nova
      // tentativa via /api/cobrancas/gerar-pix (idempotente: não rechama o
      // webhook se o PIX já tiver sido gerado).
      const labelIntegracao = isPix ? "PIX Inter" : isBoletoSecundario ? "Boleto" : "link de pagamento";
      const msgFalha = `Crédito de R$ ${valorCredito} utilizado, mas a geração do ${labelIntegracao} de R$ ${valorSecundario} falhou: ${interError}. A cobrança secundária (#${insertedSecundaria.id}) foi criada como pendente de geração — pode ser retentada sem novo consumo de crédito.`;

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
        titulo: `Erro ao gerar ${labelIntegracao} do pagamento combinado`,
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
