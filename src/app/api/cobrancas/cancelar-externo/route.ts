import { NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { verificarEscopoPropostaServerSide } from "@/lib/auth/verificar-escopo-proposta";
import { isPropostaStatusProtegido } from "@/features/orcamentos/services/status-protegidos";
import { aplicarStatusRecomendadoProposta } from "@/features/orcamentos/services/status-writer.service";
import { avaliarCancelamentoNoServidor } from "@/features/cobrancas/services/cancelamento-elegibilidade.server";

/**
 * Não existe coluna de provedor em pagamentos_v2. O cartão Asaas é reconhecido
 * pelo prefixo que o próprio provedor usa no id da cobrança (ex.:
 * `pay_zxchmwnbg9yhxcra`), gravado em `cod_solicitacao_inter` pelo n8n. O C6
 * grava UUID nessa mesma coluna — os formatos não colidem.
 */
const PREFIXO_ID_ASAAS = "pay_";

/**
 * Marcador gravado em `pagamentos_v2.descricao` pelo fluxo do Cartão Asaas
 * (espelha MARCADOR_CARTAO_ASAS em CobrancasProvider.tsx — não importado aqui
 * para não puxar módulo de client para dentro da rota). Serve apenas como
 * CONFIRMAÇÃO: é texto livre, nunca critério isolado de roteamento.
 */
const MARCADOR_CARTAO_ASAAS = "Cartão Asas";

/**
 * Webhook de cancelamento de boleto, por empresa recebedora.
 *
 * A empresa 2 (Ideal Birô) emite pelo Banco Inter e tem fluxo de cancelamento
 * próprio. As empresas 1 e 3 seguem no C6, com o mesmo endpoint e o mesmo
 * comportamento de antes — inclusive quando `id_empresa` vier nulo.
 */
export function resolverWebhookCancelamentoBoleto(idEmpresa: number | null | undefined): string {
  return Number(idEmpresa) === 2
    ? "https://10074.hostoo.net.br/webhook/cancela-boleto-inter-biro"
    : "https://10074.hostoo.net.br/webhook/del-boleto-av-vibe";
}

type PagamentoRow = {
  id: string;
  id_int: number | null;
  id_cliente: number | null;
  id_pagamento: string | null;
  descricao: string | null;
  status: string | null;
  confirmado: boolean | null;
  paid_at: string | null;
  data_confirmacao: string | null;
  tipo_cobranca: string | null;
  cod_solicitacao_inter: string | null;
  id_empresa: number | null;
  reserva_estado: string | null;
  id_pendencia: number | null;
  chave_reserva: string | null;
};

/** Libera a reserva de débito (Conta Corrente) de uma cobrança cancelada, se houver. */
async function liberarReservaSeHouver(supabase: SupabaseClient, userId: string, pagamento: PagamentoRow): Promise<void> {
  if (pagamento.reserva_estado !== "RESERVA_ATIVA" || !pagamento.id_pendencia || !pagamento.chave_reserva) return;
  const { error } = await supabase.rpc("cc_encerrar_pendencia", {
    p_id_pendencia: pagamento.id_pendencia,
    p_modo: "LIBERAR_RESERVA",
    p_valor: null,
    p_id_movimento_ref: null,
    p_chave_reserva: pagamento.chave_reserva,
    p_motivo: null,
    p_observacao: `Cobrança ${pagamento.id} cancelada. Operador: ${userId}.`,
  });
  if (error) {
    console.error("[cancelar-externo] Falha ao liberar reserva de débito:", error.message);
  }
}

async function reverterStatusPropostaSeSemCobranca(supabase: SupabaseClient, idInt: number): Promise<string> {
  const { count, error: countError } = await supabase
    .from("pagamentos_v2")
    .select("*", { count: "exact", head: true })
    .eq("id_int", idInt)
    .neq("status", "CANCELADO");

  if (countError) {
    console.error("[API][CancelarExterno] Falha ao contar pagamentos ativos:", countError);
    return "erro_ao_verificar";
  }
  if (count !== 0) return "mantida (ha cobrancas ativas)";

  const { data: propData } = await supabase
    .from("propostas")
    .select("status_interno")
    .eq("id_int", idInt)
    .maybeSingle();

  if (!propData) return "proposta_nao_encontrada";

  const currentStatus = String(propData.status_interno || "NOVO").trim().toUpperCase();
  if (isPropostaStatusProtegido(currentStatus)) {
    console.log(`[API][CancelarExterno] Reversão ignorada pois status ${currentStatus} é protegido.`);
    return `mantida (status protegido: ${currentStatus})`;
  }

  let nextStatus = "NOVO";
  if (currentStatus === "AGUARDANDO / EM ARTE" || currentStatus === "NOVO / EM ARTE") {
    nextStatus = "NOVO / EM ARTE";
  }
  const { error: updatePropError } = await supabase
    .from("propostas")
    .update({ status_interno: nextStatus, tipo_cobranca: null })
    .eq("id_int", idInt);

  if (updatePropError) {
    console.error("[API][CancelarExterno] Falha ao voltar status_interno:", updatePropError);
    return "erro_ao_reverter";
  }
  console.log(`[API][CancelarExterno] Proposta ${idInt} revertida para ${nextStatus} com sucesso.`);
  return `revertida para ${nextStatus}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, id_int, tipo_cobranca, acao_local, cod_c6, id_empresa, motivo } = body;

    if (!id || !tipo_cobranca || !acao_local) {
      return NextResponse.json(
        { success: false, message: "Parâmetros inválidos. Necessário id, tipo_cobranca e acao_local." },
        { status: 400 }
      );
    }

    // acao_local DELETE é aceito por compatibilidade de contrato, mas a ação
    // local é SEMPRE cancelamento lógico (Matriz de Segurança bloqueia DELETE
    // físico em pagamentos_v2 e boletos).
    if (acao_local !== "DELETE" && acao_local !== "CANCEL") {
      return NextResponse.json(
        { success: false, message: "Ação local inválida. Use DELETE ou CANCEL." },
        { status: 400 }
      );
    }

    const motivoFinal = String(motivo || "").trim();
    if (!motivoFinal) {
      return NextResponse.json(
        { success: false, message: "Motivo do cancelamento é obrigatório." },
        { status: 400 }
      );
    }

    // 1. Autenticação JWT (mesmo padrão de gerar-pix; sem service role)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      console.error("[API][CancelarExterno] ENV AUSENTE");
      return NextResponse.json(
        { success: false, message: "Erro interno no servidor de banco de dados." },
        { status: 500 }
      );
    }

    const authHeader = request.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      return NextResponse.json({ success: false, message: "Sessão não encontrada." }, { status: 401 });
    }

    const supabase = createSupabaseClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return NextResponse.json({ success: false, message: "Sessão inválida." }, { status: 401 });
    }

    // 2. Permissão granular — cascata.
    // `cobrancas.cancel` = poder financeiro pleno (comportamento histórico, intacto).
    // Sem ela, `propostas.cancelar_cobranca_nao_paga` habilita o MODO RESTRITO:
    // apenas cobrança comprovadamente não paga, de proposta do próprio usuário.
    const temCancelamentoFinanceiro = await verificarPermissaoServerSide(
      supabase,
      authData.user.id,
      "cobrancas.cancel"
    );
    let modoRestrito = false;
    if (!temCancelamentoFinanceiro) {
      const temCancelamentoRestrito = await verificarPermissaoServerSide(
        supabase,
        authData.user.id,
        "propostas.cancelar_cobranca_nao_paga"
      );
      if (!temCancelamentoRestrito) {
        return NextResponse.json(
          { success: false, message: "Sem permissão para cancelar cobrança (cobrancas.cancel)." },
          { status: 403 }
        );
      }
      modoRestrito = true;
    }

    // 3. Reconsulta o estado financeiro atual (fonte da verdade é o banco)
    const { data: pagamento, error: fetchError } = await supabase
      .from("pagamentos_v2")
      .select("id, id_int, id_cliente, id_pagamento, descricao, status, confirmado, paid_at, data_confirmacao, tipo_cobranca, cod_solicitacao_inter, id_empresa, reserva_estado, id_pendencia, chave_reserva")
      .eq("id", id)
      .single<PagamentoRow>();

    if (fetchError || !pagamento) {
      return NextResponse.json(
        { success: false, message: "Cobrança não encontrada no banco." },
        { status: 404 }
      );
    }

    // 4. Escopo de empresa do usuário ANTES de expor qualquer detalhe da cobrança.
    // Sem fallback: super admin passa; qualquer outro usuário precisa ter
    // usuarios.id_empresa igual ao id_empresa da cobrança. Resposta genérica
    // para não revelar dados da cobrança a quem está fora do escopo.
    const { data: usuarioRow } = await supabase
      .from("usuarios")
      .select("id_empresa, is_super_adm, nome_usuario")
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (!usuarioRow) {
      return NextResponse.json(
        { success: false, message: "Acesso negado a esta cobrança." },
        { status: 403 }
      );
    }

    const tipoNormalized = String(pagamento.tipo_cobranca || "").trim().toUpperCase().replace(/_/g, "-");

    // Escopo de acesso pela PROPOSTA, não pela empresa recebedora da cobrança.
    //
    // A regra anterior comparava `usuarios.id_empresa` com `pagamentos_v2.id_empresa`.
    // Só que a empresa recebedora é uma escolha comercial feita no modal de
    // criação — qualquer usuário pode emitir para a empresa 1, 2 ou 3. O efeito
    // era um vendedor conseguir CRIAR a cobrança e não conseguir cancelá-la:
    // caso 20242-B, vendedor da empresa 1 emitindo para a empresa 3, com
    // `cobrancas.cancel` no perfil e ainda assim recebendo "Acesso negado".
    //
    // Passa a valer o mesmo escopo já usado no modo restrito abaixo e em
    // /api/orcamentos/cancelar-proposta: super admin e `propostas.view_all`
    // passam; `view_company` exige mesma empresa da PROPOSTA; `view_own` exige
    // ser o vendedor responsável. Continua negando cobrança de terceiros.
    if (!usuarioRow.is_super_adm) {
      const { data: propostaDoPagamento } = await supabase
        .from("propostas")
        .select("empresa, vendedor")
        .eq("id_int", pagamento.id_int)
        .maybeSingle();

      const escopoOk = propostaDoPagamento
        ? await verificarEscopoPropostaServerSide(supabase, authData.user.id, {
            empresa: propostaDoPagamento.empresa,
            vendedor: propostaDoPagamento.vendedor
          })
        : false;

      if (!escopoOk) {
        console.warn("[API][CancelarExterno] Escopo de proposta negado", {
          userId: authData.user.id, idInt: pagamento.id_int
        });
        return NextResponse.json(
          { success: false, message: "Acesso negado a esta cobrança." },
          { status: 403 }
        );
      }
    }

    // 5. Vínculo cobrança ↔ proposta (id_int) e cross-check do payload
    if (id_int != null && Number(pagamento.id_int) !== Number(id_int)) {
      return NextResponse.json(
        { success: false, message: "Cobrança não pertence à proposta informada." },
        { status: 400 }
      );
    }

    if (id_empresa != null && pagamento.id_empresa != null && Number(pagamento.id_empresa) !== Number(id_empresa)) {
      return NextResponse.json(
        { success: false, code: "EMPRESA_DIVERGENTE", message: "Empresa emissora divergente do registro local." },
        { status: 409 }
      );
    }

    const statusNormalized = String(pagamento.status || "").trim().toUpperCase();

    // 6 e 7. PONTO ÚNICO DE DECISÃO.
    //
    // Aqui existiam três blocos próprios: idempotência, "bloqueio financeiro"
    // (PAID / A_VENCER / confirmado) e baixa registrada. Os três saíram e o
    // critério passou a ser o veredito compartilhado, o mesmo que a tela
    // consulta em `GET /api/cobrancas/pode-cancelar`. É isso que garante que a
    // recusa exibida ao usuário seja a recusa que esta rota aplicaria.
    //
    // MUDANÇA DE COMPORTAMENTO DESTA ETAPA: `A_VENCER` com `confirmado` deixa
    // de ser impeditivo por si só (regra 4 da spec). Em produção todo faturado
    // aprovado está nesse estado — era essa condição que impedia o
    // refaturamento. O que passa a impedir é nota fiscal autorizada, produção
    // ativa, dinheiro recebido ou título em aberto.
    const elegibilidade = await avaliarCancelamentoNoServidor(supabase, id);

    if (!elegibilidade.ok) {
      return NextResponse.json(
        { success: false, code: elegibilidade.erro, message: elegibilidade.mensagem },
        { status: elegibilidade.erro === "NAO_ENCONTRADA" ? 404 : 503 }
      );
    }

    const { veredito } = elegibilidade;

    // Idempotência (protege contra duplo clique): cobrança já inativa é no-op
    // de SUCESSO, não recusa. Mesmo contrato de resposta de antes.
    if (veredito.jaInativa) {
      return NextResponse.json({
        success: true,
        alreadyCancelled: true,
        message: "Cobrança já estava cancelada/inativa. Nenhuma ação executada."
      });
    }

    if (!veredito.pode) {
      // Nenhuma escrita aconteceu até aqui: a recusa sai antes do provedor e
      // antes de qualquer UPDATE.
      return NextResponse.json(
        {
          success: false,
          code: veredito.code,
          message: veredito.message,
          ...(veredito.acao ? { acao: veredito.acao } : {}),
          ...(veredito.titulosEmAberto.length > 0
            ? { titulosEmAberto: veredito.titulosEmAberto }
            : {})
        },
        { status: 409 }
      );
    }

    // 7c. MODO RESTRITO (propostas.cancelar_cobranca_nao_paga): allowlist estrita.
    // Tudo que não for comprovadamente "emitida e não paga" é negado.
    if (modoRestrito) {
      if (pagamento.id_int == null) {
        return NextResponse.json(
          { success: false, message: "Esta permissão só cancela cobrança vinculada a uma proposta." },
          { status: 403 }
        );
      }

      if (statusNormalized !== "A_RECEBER") {
        return NextResponse.json(
          { success: false, code: "PAGAMENTO_QUITADO", message: "Esta permissão só cancela cobrança emitida e não paga (A_RECEBER)." },
          { status: 409 }
        );
      }

      // Conta Corrente: cobrança que reservou crédito/débito do cliente segue
      // exclusiva de quem tem cobrancas.cancel.
      if (pagamento.reserva_estado === "RESERVA_ATIVA" || pagamento.id_pendencia != null) {
        return NextResponse.json(
          { success: false, message: "Cobrança vinculada à Conta Corrente. Cancelamento restrito ao financeiro." },
          { status: 403 }
        );
      }

      // Boleto liquidado no registro vinculado a esta cobrança.
      if (pagamento.cod_solicitacao_inter) {
        const { data: boletosVinculados } = await supabase
          .from("boletos")
          .select("id, status, paid_at")
          .eq("id_boleto_c6", pagamento.cod_solicitacao_inter)
          .eq("id_int", pagamento.id_int);

        const temBoletoPago = (boletosVinculados || []).some(
          (b: { status: string | null; paid_at: string | null }) =>
            b.paid_at != null || String(b.status || "").trim().toUpperCase() === "PAID"
        );
        if (temBoletoPago) {
          return NextResponse.json(
            { success: false, code: "PAGAMENTO_QUITADO", message: "Boleto pago vinculado a esta cobrança. Cancelamento não permitido." },
            { status: 409 }
          );
        }
      }

      // Escopo: só age sobre proposta da qual o usuário é responsável.
      const { data: propostaEscopo } = await supabase
        .from("propostas")
        .select("id_int, empresa, vendedor")
        .eq("id_int", pagamento.id_int)
        .maybeSingle();

      if (!propostaEscopo) {
        return NextResponse.json({ success: false, message: "Proposta não encontrada." }, { status: 404 });
      }

      const escopoOk = await verificarEscopoPropostaServerSide(supabase, authData.user.id, {
        empresa: propostaEscopo.empresa,
        vendedor: propostaEscopo.vendedor
      });
      if (!escopoOk) {
        return NextResponse.json({ success: false, message: "Acesso negado a esta proposta." }, { status: 403 });
      }
    }

    // Código bancário: fonte da verdade é o registro local; payload apenas cross-check.
    const codC6Final = pagamento.cod_solicitacao_inter || cod_c6 || null;
    if (cod_c6 && pagamento.cod_solicitacao_inter && pagamento.cod_solicitacao_inter !== cod_c6) {
      return NextResponse.json(
        { success: false, code: "COD_BANCARIO_DIVERGENTE", message: "Código bancário divergente do registro local." },
        { status: 409 }
      );
    }

    // Empresa usada na integração: exclusivamente a do registro (sem fallback do payload).
    const idEmpresaCobranca = pagamento.id_empresa != null ? Number(pagamento.id_empresa) : null;

    let provedorResultado = "nao_aplicavel";

    // 8. Cancelamento no provedor ANTES de qualquer alteração local.
    // Falha externa (não-2xx/timeout) aborta sem tocar o banco.
    // Cobranças sem integração externa emitida (sem cod_solicitacao_inter,
    // ou tipos locais como E-FATURADO) seguem direto para o cancelamento lógico.
    if (tipoNormalized === "BOLETO" && codC6Final) {
      if (idEmpresaCobranca == null) {
        return NextResponse.json(
          { success: false, message: "Cobrança sem empresa associada. Cancelamento externo não é possível." },
          { status: 409 }
        );
      }

      // O bloqueio de boleto liquidado que existia aqui saiu: o veredito já o
      // aplica (`TITULO_LIQUIDADO`), com o MESMO filtro composto
      // `id_boleto_c6 + id_int`, e antes de qualquer chamada ao provedor.
      // Mantê-lo duplicaria a regra nos dois lugares que esta spec existe para
      // unificar.

      const webhookUrl = resolverWebhookCancelamentoBoleto(idEmpresaCobranca);
      console.log("[cancelar-externo][BOLETO] chamando n8n", {
        cod_C6: codC6Final,
        id_empresa: idEmpresaCobranca,
        provedor: Number(idEmpresaCobranca) === 2 ? "Inter (Biro)" : "C6",
        webhookUrl
      });

      const webhookResponse = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cod_C6: codC6Final, id_empresa: idEmpresaCobranca })
      });

      const responseStatus = webhookResponse.status;
      const responseBody = await webhookResponse.text();
      console.log("[cancelar-externo][BOLETO] status n8n", responseStatus);
      console.log("[cancelar-externo][BOLETO] body n8n", responseBody);

      if (!webhookResponse.ok) {
        console.error("[API][CancelarExterno] Erro HTTP no n8n:", responseStatus, responseBody);
        return NextResponse.json(
          { success: false, message: "A API bancária recusou o cancelamento do Boleto. Nenhuma alteração local foi feita." },
          { status: responseStatus }
        );
      }
      provedorResultado = "ok";

    } else if (tipoNormalized === "CARD-PARCELADO") {
      // Provedor do cartão: Asaas grava id com prefixo `pay_`; C6 grava UUID.
      // Os formatos são disjuntos — um UUID nunca começa com `pay_`. A fonte é
      // exclusivamente o registro local (nunca o payload), para que o cliente
      // não consiga forçar um provedor.
      const idAsaas = String(pagamento.cod_solicitacao_inter || "").trim();
      const ehAsaas = idAsaas.startsWith(PREFIXO_ID_ASAAS);
      const marcadorAsaasNaDescricao = String(pagamento.descricao || "").includes(MARCADOR_CARTAO_ASAAS);

      // Marcador aponta Asaas mas o id ainda não chegou (o n8n grava depois de
      // responder) ou veio inválido. Cancelar só localmente deixaria o título
      // vivo no provedor — bloqueia e manda tentar de novo.
      if (marcadorAsaasNaDescricao && !ehAsaas) {
        console.warn("[cancelar-externo][ASAAS] descrição marca Asaas mas cod_solicitacao_inter não sincronizou:", {
          id: pagamento.id,
          cod_solicitacao_inter: idAsaas || null
        });
        return NextResponse.json(
          {
            success: false,
            code: "ASAAS_SEM_ID",
            message: "Cobrança do Cartão Asaas ainda sem identificador sincronizado. Aguarde alguns instantes e tente cancelar novamente. Nenhuma alteração foi feita."
          },
          { status: 409 }
        );
      }

      if (ehAsaas) {
        const webhookUrl = "https://10074.hostoo.net.br/webhook/asaas-del-vibe";
        console.log("[cancelar-externo][ASAAS] chamando n8n", { id_fatura: idAsaas });

        const webhookResponse = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_fatura: idAsaas })
        });

        const responseStatus = webhookResponse.status;
        const responseBody = await webhookResponse.text();
        console.log("[cancelar-externo][ASAAS] status n8n", responseStatus);
        console.log("[cancelar-externo][ASAAS] body n8n", responseBody);

        if (!webhookResponse.ok) {
          console.error("[API][CancelarExterno] Erro HTTP no n8n (Asaas):", responseStatus, responseBody);
          return NextResponse.json(
            { success: false, message: "A API do Asaas recusou o cancelamento do Cartão. Nenhuma alteração local foi feita." },
            { status: responseStatus }
          );
        }
        provedorResultado = "ok";

      } else if (codC6Final) {
        if (idEmpresaCobranca == null) {
          return NextResponse.json(
            { success: false, message: "Cobrança sem empresa associada. Cancelamento externo não é possível." },
            { status: 409 }
          );
        }

        const webhookUrl = "https://10074.hostoo.net.br/webhook/cancela-cartao-c6-vibe";
        console.log("[cancelar-externo][CARD-PARCELADO] chamando n8n", { cod_C6: codC6Final, id_empresa: idEmpresaCobranca });

        const webhookResponse = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cod_C6: codC6Final, id_empresa: String(idEmpresaCobranca) })
        });

        const responseStatus = webhookResponse.status;
        const responseBody = await webhookResponse.text();
        console.log("[cancelar-externo][CARD-PARCELADO] status n8n", responseStatus);
        console.log("[cancelar-externo][CARD-PARCELADO] body n8n", responseBody);

        if (!webhookResponse.ok) {
          console.error("[API][CancelarExterno] Erro HTTP no n8n:", responseStatus, responseBody);
          return NextResponse.json(
            { success: false, message: "A API externa recusou o cancelamento do Cartão. Nenhuma alteração local foi feita." },
            { status: responseStatus }
          );
        }
        provedorResultado = "ok";
      } else {
        console.log("[cancelar-externo][CARD-PARCELADO] Sem cod_solicitacao_inter. Cobrança apenas local; seguindo para cancelamento lógico.");
      }

    } else if (tipoNormalized === "PIX" && codC6Final) {
      if (idEmpresaCobranca == null) {
        return NextResponse.json(
          { success: false, message: "Cobrança sem empresa associada. Cancelamento externo não é possível." },
          { status: 409 }
        );
      }

      const webhookUrl = "https://10074.hostoo.net.br/webhook/del-pix-vibe";
      console.log("[cancelar-externo][PIX] chamando n8n", { cod_validador: codC6Final, id_empresa: idEmpresaCobranca });

      const webhookResponse = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cod_validador: codC6Final, id_empresa: String(idEmpresaCobranca) })
      });

      const responseStatus = webhookResponse.status;
      const responseBody = await webhookResponse.text();
      console.log("[cancelar-externo][PIX] status n8n", responseStatus);
      console.log("[cancelar-externo][PIX] body n8n", responseBody);

      if (!webhookResponse.ok) {
        console.error("[API][CancelarExterno] Erro HTTP no n8n:", responseStatus, responseBody);
        return NextResponse.json(
          { success: false, message: "A API externa recusou o cancelamento do PIX. Nenhuma alteração local foi feita." },
          { status: responseStatus }
        );
      }
      provedorResultado = "ok";

    } else {
      // Sem integração externa emitida: cancelamento local puro.
      console.log(`[cancelar-externo][${tipoNormalized}] Sem integração externa emitida. Seguindo para cancelamento lógico local.`);
    }

    // 9. Ação local: SEMPRE cancelamento lógico, preservando o registro original.
    const resultados: Record<string, string> = { provedor: provedorResultado };

    const { error: errorCancel } = await supabase
      .from("pagamentos_v2")
      .update({ status: "CANCELADO", motivo_cancela: motivoFinal })
      .eq("id", id);

    if (errorCancel) {
      console.error("[API][CancelarExterno] Falha ao atualizar pagamentos_v2 para CANCELADO:", errorCancel);
      return NextResponse.json(
        { success: false, message: "Cobrança cancelada no parceiro, mas erro ao atualizar status local para CANCELADO. Não tente novamente antes de conferir o registro." },
        { status: 500 }
      );
    }
    resultados.pagamentos_v2 = "CANCELADO (logico)";

    // Conta Corrente: se esta cobrança tinha uma reserva de débito ativa,
    // libera-a (o débito volta a ficar disponível na pendência de origem).
    await liberarReservaSeHouver(supabase, authData.user.id, pagamento);

    // Boletos vinculados: cancelamento lógico com filtro composto (nunca id_int isolado).
    if (tipoNormalized === "BOLETO" && codC6Final && pagamento.id_int != null) {
      const { error: errorBoletos } = await supabase
        .from("boletos")
        .update({ status: "CANCELADO" })
        .eq("id_boleto_c6", codC6Final)
        .eq("id_int", pagamento.id_int);

      if (errorBoletos) {
        console.error("[API][CancelarExterno] Falha ao cancelar logicamente em public.boletos:", errorBoletos);
        resultados.boletos = `falha: ${errorBoletos.message}`;
      } else {
        resultados.boletos = "CANCELADO (logico)";
      }
    } else {
      resultados.boletos = "nao_aplicavel";
    }

    // 10. Reversão do status da proposta quando não resta cobrança ativa.
    if (pagamento.id_int != null) {
      resultados.proposta = await reverterStatusPropostaSeSemCobranca(supabase, pagamento.id_int);

      // 11. Reconciliar pelo fluxo oficial (cobre o caso de cancelar UMA entre
      // várias cobranças ativas — a reversão acima só age quando zero restam).
      // Best-effort: nunca falha o cancelamento em si.
      const reconciliacao = await aplicarStatusRecomendadoProposta(
        pagamento.id_int,
        { uid: authData.user.id, nome: authData.user.email || "Sistema", email: authData.user.email || "" },
        supabase,
        "AUTO_FINANCEIRO"
      );
      if (!reconciliacao.success) {
        console.warn(`[cancelar-externo] Reconciliação de status sem efeito para proposta #${pagamento.id_int}: ${reconciliacao.errorMessage}`);
      }

      // 12. Histórico da proposta com AUTOR REAL. Gravado aqui (e não no cliente)
      // porque só o servidor conhece o usuário autenticado de forma confiável.
      // Best-effort: nunca derruba um cancelamento já efetivado.
      const autorNome = usuarioRow.nome_usuario || authData.user.email || "Sistema";
      const referenciaCobranca = pagamento.id_pagamento || pagamento.id;
      const origemPermissao = modoRestrito ? "propostas.cancelar_cobranca_nao_paga" : "cobrancas.cancel";
      const { error: errorChat } = await supabase.from("propostas_chat").insert([
        {
          id_int: pagamento.id_int,
          id_cliente: pagamento.id_cliente,
          mensagem: `Cobrança ${referenciaCobranca} cancelada por ${autorNome} (${origemPermissao}). Motivo: ${motivoFinal}`,
          tipo: "SISTEMA",
          autor_nome: autorNome,
          setor: "Financeiro",
          visivel_externo: false
        }
      ]);
      if (errorChat) {
        console.warn("[cancelar-externo] Falha ao registrar histórico do cancelamento:", errorChat.message);
      }
    }

    const partial = resultados.boletos?.startsWith("falha") === true;
    return NextResponse.json({
      success: true,
      partial,
      resultados,
      message: partial
        ? "Cobrança cancelada no parceiro e em pagamentos_v2, mas houve falha ao cancelar o registro em boletos. Verifique manualmente."
        : "Cobrança cancelada externamente e registros locais cancelados logicamente."
    });

  } catch (error: unknown) {
    console.error("[API][CancelarExterno] Exceção na API route:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, message: `Erro interno ao processar o cancelamento externo: ${errorMessage}` },
      { status: 500 }
    );
  }
}
