/**
 * Título que o banco recusa cancelar por JÁ NÃO ESTAR ATIVO — saída para o ERP.
 *
 * O PROBLEMA. Quando o banco responde que o título está `EXPIRADO`, `BAIXADO`
 * ou `CANCELADO`, o cancelamento bancário nunca vai acontecer: não há mais
 * título para cancelar. Até aqui o ERP devolvia a recusa e não fazia nada, e o
 * título ficava preso na lista de atrasados — a única via de baixa exigia
 * justamente o cancelamento que o banco recusa.
 *
 * A SAÍDA. O ERP cancela localmente, e o registro diz a verdade: que o banco
 * recusou por título já inativo, qual situação informou, e que NÃO houve
 * cancelamento bancário.
 *
 * POR QUE UMA ROTA. A decisão precisa valer no SERVIDOR. Ela vivia no cliente
 * (`nfe.service.ts`), onde só o caminho legado a alcançava. O webhook do C6
 * continua sendo chamado pelo navegador — trazê-lo para cá é rodada própria —,
 * então o cliente relata a recusa e QUEM DECIDE é esta rota.
 *
 * SÓ C6 (empresas 1 e 3). O Inter fica de fora de propósito: aceitar a recusa
 * como "já inativo" exige confirmar que não houve pagamento, e não existe
 * consulta de pagamento do Inter — só `consulta-paid-c6`. Sem essa confirmação,
 * cancelar localmente poderia matar no ERP um título que foi PAGO, violando a
 * regra 3. Enquanto o webhook de consulta do Inter não existir, os títulos
 * vencidos da Birô seguem para tratamento manual.
 *
 * Spec: docs/superpowers/specs/2026-08-25-cancelamento-cobranca-refaturamento-design.md
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { consultarDetalhesBoletoC6 } from "@/features/cobrancas/services/pagamentos-v2.service";
import { resolverCobrancaDoTitulo } from "@/features/cobrancas/services/cobranca-do-titulo";
import {
  ehRecusaPorTituloInativo,
  motivoCancelamentoLocal,
  provedorDaEmpresa,
  situacaoInformadaPeloBanco
} from "@/features/cobrancas/recusa-bancaria";

type BoletoRow = {
  id: string;
  id_int: number | null;
  id_cliente: number | null;
  id_empresa: number | null;
  id_pagamento: string | null;
  id_boleto_c6: string | null;
  status: string | null;
  paid_at: string | null;
  is_faturado: boolean | null;
};

function erro(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, code, message }, { status });
}

export async function POST(request: Request) {
  let body: { boletoId?: string; motivoRecusa?: string };
  try {
    body = await request.json();
  } catch {
    return erro("PARAMETROS", "Corpo da requisição inválido.", 400);
  }

  const boletoId = String(body.boletoId || "").trim();
  const motivoRecusa = String(body.motivoRecusa || "").trim();

  if (!boletoId) return erro("PARAMETROS", "Campo boletoId ausente.", 400);
  if (!motivoRecusa) return erro("PARAMETROS", "Campo motivoRecusa ausente.", 400);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[titulo-inativo] ENV AUSENTE");
    return erro("INTERNO", "Erro interno no servidor de banco de dados.", 500);
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return erro("NEGADO", "Sessão não encontrada.", 401);

  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return erro("NEGADO", "Sessão inválida.", 401);

  // Mesma cascata de permissão das demais rotas de cancelamento.
  const { data: usuarioRow } = await supabase
    .from("usuarios")
    .select("is_super_adm, nome_usuario")
    .eq("user_id", authData.user.id)
    .maybeSingle<{ is_super_adm: boolean | null; nome_usuario: string | null }>();

  if (!usuarioRow?.is_super_adm) {
    const pleno = await verificarPermissaoServerSide(supabase, authData.user.id, "cobrancas.cancel");
    if (!pleno) {
      const restrito = await verificarPermissaoServerSide(
        supabase,
        authData.user.id,
        "propostas.cancelar_cobranca_nao_paga"
      );
      if (!restrito) {
        return erro("NEGADO", "Sem permissão para cancelar título (cobrancas.cancel).", 403);
      }
    }
  }

  // 1. A recusa é MESMO de título inativo? Decisão no servidor, com o padrão
  //    do provedor. Qualquer outra recusa é ERRO e não vira cancelamento local.
  if (!ehRecusaPorTituloInativo(motivoRecusa)) {
    return erro(
      "NAO_E_INATIVIDADE",
      "A recusa do banco não indica título já inativo. Nada foi alterado.",
      409
    );
  }

  // 2. Título — fonte da verdade é o banco de dados.
  const { data: boleto, error: fetchErr } = await supabase
    .from("boletos")
    .select("id, id_int, id_cliente, id_empresa, id_pagamento, id_boleto_c6, status, paid_at, is_faturado")
    .eq("id", boletoId)
    .maybeSingle<BoletoRow>();

  if (fetchErr || !boleto) return erro("NAO_ENCONTRADO", "Título não encontrado.", 404);

  const statusAtual = String(boleto.status ?? "").toUpperCase();
  if (statusAtual === "CANCELADO") {
    return NextResponse.json({ success: true, alreadyCancelled: true, message: "Título já estava cancelado." });
  }

  // 3. REGRA 3, intacta: título pago não é cancelável, venha o que vier do
  //    banco. Este é o bloqueio local, antes mesmo de consultar.
  if (boleto.paid_at != null || statusAtual === "PAID") {
    return erro("PAGAMENTO_QUITADO", "Título já liquidado. Cancelamento não permitido.", 409);
  }

  // 4. Só C6. Ver o cabeçalho: sem consulta de pagamento do Inter, aceitar a
  //    recusa da Birô seria adivinhação.
  if (provedorDaEmpresa(boleto.id_empresa) !== "C6") {
    return erro(
      "PROVEDOR_SEM_CONSULTA",
      "Título do Banco Inter: não há consulta de pagamento disponível para confirmar que não houve " +
        "recebimento, então o cancelamento local não é liberado. Tratar manualmente.",
      409
    );
  }

  const codBancario = String(boleto.id_boleto_c6 ?? "").trim();
  if (!codBancario) {
    return erro("SEM_COD_BANCARIO", "Título sem identificador bancário. Nada a confirmar no banco.", 400);
  }

  // 5. CONFIRMAÇÃO DE NÃO-PAGAMENTO. É o cuidado que separa "título saiu de
  //    circulação" de "título foi pago e por isso não cancela". Falha ao
  //    confirmar MANTÉM o erro: sem confirmação, o lado seguro é não cancelar.
  let statusNoBanco = "";
  let temPagamento = false;
  try {
    const detalhes = await consultarDetalhesBoletoC6(codBancario, Number(boleto.id_empresa) || 1);
    statusNoBanco = String(detalhes?.status ?? "").toUpperCase();
    temPagamento = Array.isArray(detalhes?.payments) && detalhes.payments.length > 0;
  } catch (erroConsulta) {
    console.error("[titulo-inativo] Falha ao confirmar a situação no C6:", erroConsulta);
    return erro(
      "CONFIRMACAO_INDISPONIVEL",
      "Não foi possível confirmar no banco se o título já foi pago, então nada foi alterado.",
      503
    );
  }

  if (statusNoBanco === "PAID" || temPagamento) {
    return erro(
      "PAGAMENTO_QUITADO",
      "O banco informa este boleto como PAGO. Não é possível cancelar — use 'Consultar pagamento C6' " +
        "para liquidar com a data oficial do banco.",
      409
    );
  }

  // 6. Cancelamento local. A partir daqui está confirmado: o título saiu de
  //    circulação no banco E não houve pagamento.
  const { error: erroCancelar } = await supabase
    .from("boletos")
    .update({ status: "CANCELADO" })
    .eq("id", boleto.id);

  if (erroCancelar) {
    console.error("[titulo-inativo] Falha ao cancelar o título localmente:", erroCancelar.message);
    return erro("FALHA_LOCAL", "Não foi possível cancelar o título no ERP. Nada foi alterado.", 500);
  }

  // 7. Cobrança volta ao Registro de Recebíveis — mesma invariante do passo 1,
  //    e o mesmo vínculo (com o fallback legado).
  let cobrancaVoltouAoRegistro = false;
  const idCobranca = await resolverCobrancaDoTitulo(supabase, boleto);
  if (idCobranca && idCobranca !== "AMBIGUO") {
    const { error: erroRetorno } = await supabase
      .from("pagamentos_v2")
      .update({ boleto_enviadoo: false })
      .eq("id", idCobranca);
    if (erroRetorno) {
      console.error("[titulo-inativo] Título cancelado, mas a cobrança não voltou ao Registro:", erroRetorno.message);
    } else {
      cobrancaVoltouAoRegistro = true;
    }
  }

  // 8. Registro honesto no histórico da proposta. NÃO afirma cancelamento
  //    bancário — diz que o banco recusou, qual situação informou, e que a
  //    baixa foi só no ERP. Best-effort: não derruba o cancelamento.
  const situacao = situacaoInformadaPeloBanco(motivoRecusa);
  if (boleto.id_int != null) {
    const autorNome = usuarioRow?.nome_usuario || authData.user.email || "Sistema";
    const { error: erroChat } = await supabase.from("propostas_chat").insert([
      {
        id_int: boleto.id_int,
        id_cliente: boleto.id_cliente,
        mensagem:
          `Título ${codBancario} cancelado no ERP por ${autorNome}. ` +
          motivoCancelamentoLocal(motivoRecusa) +
          ` Resposta do banco: "${motivoRecusa}"`,
        tipo: "SISTEMA",
        autor_nome: autorNome,
        setor: "Financeiro",
        visivel_externo: false
      }
    ]);
    if (erroChat) {
      console.error("[titulo-inativo] Falha ao registrar o histórico:", erroChat.message);
    }
  }

  return NextResponse.json({
    success: true,
    canceladoLocalmente: true,
    cobrancaVoltouAoRegistro,
    situacaoInformadaPeloBanco: situacao,
    message: motivoCancelamentoLocal(motivoRecusa)
  });
}
