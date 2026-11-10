import { NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { verificarEscopoPropostaServerSide } from "@/lib/auth/verificar-escopo-proposta";
import { avaliarCancelamentoNoServidor } from "@/features/cobrancas/services/cancelamento-elegibilidade.server";
import { cabecalhosWebhookN8n } from "@/lib/n8n/webhook-segredo";
import {
  chamarCancelamentoDePix,
  corpoDoCancelamentoPix,
  decidirCancelamentoDePix,
  mensagemDoDesfechoPix
} from "@/features/cobrancas/services/cancelamento-pix";
import { recusaDoGatilhoNoErro } from "@/features/cobrancas/lib/tipo-x-retrabalho";
import { statusEhEntregue, MENSAGEM_PEDIDO_ENTREGUE, CODIGO_PEDIDO_ENTREGUE } from "@/features/orcamentos/services/pedido-entregue";
import { lerContextoRetrabalhoDoPedido } from "@/features/cobrancas/services/tipo-x-retrabalho.service";
import { lerTodas } from "@/lib/supabase/ler-todas";
import { formatCurrency } from "@/lib/formatters/currency";
import {
  RECUSAS_DA_TROCA,
  destinoDaTroca,
  destinosPermitidosNoPedido,
  fatiasDoConsumo,
  saldoCobreOValor,
  type DestinoDaTroca,
  marcadorEmAndamento,
  mensagemHistoricoDaTroca,
  mensagemHistoricoDaTrocaDesfeita,
  modeloValidoParaTroca,
  montarCobrancaDaTroca,
  motivoCancelaDaAntiga,
  motivoCancelaDaNovaDesfeita,
  recusaDaCobrancaParaTroca,
  registroDaTrocaNaAntiga,
  type ModeloDaTroca,
  type PagamentoDaTroca
} from "@/features/cobrancas/troca-forma-pagamento";

/**
 * Trocar forma de pagamento: PIX não pago (C6, empresas 1 e 3) -> uma forma
 * interna (Faturado, E-Permuta, E-Amostra ou E-Retrabalho; ver
 * DESTINOS_DA_TROCA), mesma proposta, mesmo valor, mesmo pagador. Vale
 * inclusive com NF-e autorizada — a nota não é tocada.
 *
 *   GET  ?id=<cobrança>  — a troca é possível, e para quais formas? (a janela
 *        consulta ao abrir)
 *   POST { id, tipo, id_modelo_cobranca, motivo } — tipo vazio é Faturado;
 *        id_modelo_cobranca só para Faturado e E-Permuta.
 *
 * E-Crédito (10/11/2026, caso 24574): exige também credito.usar e saldo de
 * crédito do pagador que cubra o valor inteiro. A nova nasce PAID e consome o
 * crédito logo depois do insert (pendências mais antigas primeiro, depois o
 * avulso, pelas mesmas funções do banco de usar-credito). Se o consumo falhar
 * ou o banco não confirmar o cancelamento do PIX, `mc_desfazer_credito_da_troca`
 * devolve exatamente o que foi consumido e cancela a nova, numa transação só.
 *
 * Ordem do POST, que garante que a antiga só sai depois que a nova existe:
 *   1. marca a antiga como "troca em andamento" (gravação condicional: é a
 *      trava contra duas trocas ao mesmo tempo; não cancela nada);
 *   2. cria a nova (A_VENCER, não confirmada, nada consumido — nada fora do Vibe);
 *   3. cancela o PIX no banco, pelo mesmo cancelamento de PIX da rota
 *      cancelar-externo (o Vibe só aceita com a confirmação do C6);
 *   4a. banco confirmou: grava CANCELADO na antiga e registra no Histórico;
 *   4b. banco não confirmou: cancela a nova com o motivo, solta a marca da
 *       antiga (que segue ativa) e registra no Histórico.
 *
 * Status da proposta: esta rota não grava em `propostas`. Os gatilhos de
 * `pagamentos_v2` mantêm AGUARDANDO nos três momentos (PIX A_RECEBER e/ou
 * faturado A_VENCER não confirmado contam como pendentes), e nenhum mexe em
 * produção ou em libera_nf. A liberação automática do faturado fica para a
 * tela, depois da troca, pela rota de sempre.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const SELECT_PAGAMENTO =
  "id, id_int, id_cliente, id_pagamento, cliente, documento, valor, status, paid_at, tipo_cobranca, " +
  "cod_solicitacao_inter, id_empresa, empresa, os_ideal, atendente, obs_v2, reserva_estado, id_pendencia, motivo_troca";

type PagamentoRow = PagamentoDaTroca & {
  id_cliente: number | null;
  cliente: string | null;
  documento: string | null;
  valor: number | string | null;
  empresa: string | null;
  os_ideal: number | null;
  atendente: string | null;
  obs_v2: string | null;
};

type Contexto = {
  supabase: SupabaseClient;
  userId: string;
  autor: string;
  permissao: "cobrancas.cancel" | "propostas.cancelar_cobranca_nao_paga";
  pagamento: PagamentoRow;
};

function erro(status: number, message: string, code?: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, ...(code ? { code } : {}), message, ...(extra ?? {}) }, { status });
}

/** Recusa ou falha das etapas de leitura, antes de virar resposta. */
type Falha = { falha: true; status: number; message: string; code?: string };

function falha(status: number, message: string, code?: string): Falha {
  return { falha: true, status, message, ...(code ? { code } : {}) };
}

function ehFalha(valor: unknown): valor is Falha {
  return typeof valor === "object" && valor !== null && (valor as { falha?: unknown }).falha === true;
}

function responderFalha(f: Falha) {
  return erro(f.status, f.message, f.code);
}

/**
 * Sessão, permissão e escopo: as mesmas do cancelamento de cobrança
 * (`cobrancas.cancel`, ou o cancelamento restrito de cobrança não paga, com o
 * escopo de empresa e vendedor da proposta para quem não é super admin).
 */
async function carregarContexto(request: Request, idCobranca: string): Promise<Contexto | Falha> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return falha(500, "Erro interno no servidor de banco de dados.");

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return falha(401, "Sessão não encontrada.");

  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return falha(401, "Sessão inválida.");
  const userId = authData.user.id;

  let permissao: Contexto["permissao"] = "cobrancas.cancel";
  if (!(await verificarPermissaoServerSide(supabase, userId, "cobrancas.cancel"))) {
    if (!(await verificarPermissaoServerSide(supabase, userId, "propostas.cancelar_cobranca_nao_paga"))) {
      return falha(403, "Sem permissão para trocar a forma de pagamento (cobrancas.cancel).");
    }
    permissao = "propostas.cancelar_cobranca_nao_paga";
  }

  const { data: pagamento, error: erroPagamento } = await supabase
    .from("pagamentos_v2")
    .select(SELECT_PAGAMENTO)
    .eq("id", idCobranca)
    .maybeSingle<PagamentoRow>();
  if (erroPagamento) return falha(503, "Não foi possível ler a cobrança no banco.");
  if (!pagamento) return falha(404, "Cobrança não encontrada no banco.");

  const { data: usuarioRow } = await supabase
    .from("usuarios")
    .select("is_super_adm, nome_usuario")
    .eq("user_id", userId)
    .maybeSingle<{ is_super_adm: boolean | null; nome_usuario: string | null }>();
  if (!usuarioRow) return falha(403, "Acesso negado a esta cobrança.");

  if (!usuarioRow.is_super_adm) {
    const { data: proposta } = await supabase
      .from("propostas")
      .select("empresa, vendedor")
      .eq("id_int", pagamento.id_int)
      .maybeSingle<{ empresa: string | null; vendedor: string | null }>();
    const escopoOk = proposta
      ? await verificarEscopoPropostaServerSide(supabase, userId, { empresa: proposta.empresa, vendedor: proposta.vendedor })
      : false;
    if (!escopoOk) return falha(403, "Acesso negado a esta cobrança.");
  }

  return {
    supabase,
    userId,
    autor: usuarioRow.nome_usuario || authData.user.email || "Sistema",
    permissao,
    pagamento
  };
}

/** Veredito da troca: recusas de cancelamento (menos a nota) + regras da troca. */
async function avaliarTroca(
  ctx: Contexto
): Promise<{ pode: true; notaAutorizada: boolean; destinos: DestinoDaTroca[]; credito: CreditoDaTroca | null } | Falha> {
  const elegibilidade = await avaliarCancelamentoNoServidor(ctx.supabase, ctx.pagamento.id, RECUSAS_DA_TROCA);
  if (!elegibilidade.ok) {
    return falha(elegibilidade.erro === "NAO_ENCONTRADA" ? 404 : 503, elegibilidade.mensagem, elegibilidade.erro);
  }
  const { veredito } = elegibilidade;
  if (veredito.jaInativa) return falha(409, "Esta cobrança já está cancelada.", "JA_INATIVA");
  if (!veredito.pode) return falha(409, veredito.message, veredito.code);

  const recusa = recusaDaCobrancaParaTroca(ctx.pagamento);
  if (recusa) return falha(recusa.httpStatus, recusa.message, recusa.code);

  const { data: proposta, error: erroProposta } = await ctx.supabase
    .from("propostas")
    .select("status_interno")
    .eq("id_int", ctx.pagamento.id_int)
    .maybeSingle<{ status_interno: string | null }>();
  if (erroProposta) return falha(503, "Não foi possível ler a proposta no banco.");
  if (!proposta) return falha(404, "Proposta não encontrada.");
  if (statusEhEntregue(proposta.status_interno)) return falha(409, MENSAGEM_PEDIDO_ENTREGUE, CODIGO_PEDIDO_ENTREGUE);
  if (String(proposta.status_interno ?? "").trim().toUpperCase() === "CANCELADO") {
    return falha(409, "Proposta cancelada não recebe cobrança nova.", "PROPOSTA_CANCELADA");
  }

  // E-Retrabalho só em retrabalho; retrabalho só com E-Retrabalho (mesma regra do gatilho).
  const contextoRetrabalho = await lerContextoRetrabalhoDoPedido(ctx.supabase, Number(ctx.pagamento.id_int));
  let destinos = destinosPermitidosNoPedido(contextoRetrabalho);

  // E-Crédito só aparece se quem troca pode usar crédito e o saldo cobre tudo.
  let credito: CreditoDaTroca | null = null;
  if (destinos.some((d) => d.consomeCredito)) {
    credito = await avaliarCredito(ctx);
    if (!credito.disponivel) destinos = destinos.filter((d) => !d.consomeCredito);
  }
  if (destinos.length === 0) return falha(409, "Nenhuma forma de pagamento interna vale para este pedido.", "SEM_DESTINO");

  return { pode: true, notaAutorizada: veredito.recusas.some((r) => r.code === "NOTA_AUTORIZADA"), destinos, credito };
}

type CreditoDaTroca = { disponivel: boolean; saldo: number | null; motivo: string | null };

/** Saldo de crédito do cliente: toda a razão não cancelada (mesma conta de usar-credito). */
async function saldoDeCredito(supabase: SupabaseClient, idCliente: number): Promise<number | null> {
  const leitura = await lerTodas<{ id: number; valor: number | string; tipo: string }>(
    () => supabase.from("movimento_credito").select("id, valor, tipo").eq("id_cliente", idCliente).eq("cancelado", false) as never,
    { chave: "id" }
  );
  if (leitura.error || !leitura.completo) return null;
  const centavos = leitura.data.reduce((soma, r) => {
    const v = Math.round(Number(r.valor) * 100) || 0;
    return soma + (String(r.tipo).toUpperCase() === "CREDITO" ? v : -v);
  }, 0);
  return centavos / 100;
}

async function avaliarCredito(ctx: Contexto): Promise<CreditoDaTroca> {
  if (!(await verificarPermissaoServerSide(ctx.supabase, ctx.userId, "credito.usar"))) {
    return { disponivel: false, saldo: null, motivo: "E-Crédito exige a permissão de usar crédito (credito.usar)." };
  }
  if (ctx.pagamento.id_cliente == null) {
    return { disponivel: false, saldo: null, motivo: "A cobrança não tem cliente pagador para usar crédito." };
  }
  const saldo = await saldoDeCredito(ctx.supabase, Number(ctx.pagamento.id_cliente));
  if (saldo == null) return { disponivel: false, saldo: null, motivo: "Não foi possível ler o saldo de crédito do cliente." };
  const valor = Number(ctx.pagamento.valor);
  if (!saldoCobreOValor(saldo, valor)) {
    return {
      disponivel: false,
      saldo: Math.max(0, saldo),
      motivo: `Saldo de crédito insuficiente: o cliente tem ${formatCurrency(Math.max(0, saldo))} e a cobrança é de ${formatCurrency(valor)}.`
    };
  }
  return { disponivel: true, saldo, motivo: null };
}

type ResultadoDoConsumo = { ok: true } | { ok: false; mensagem: string };

/**
 * Consome o crédito na E-Crédito nova: pendências a favor do cliente, mais
 * antigas primeiro, e o resto no avulso — as funções do banco de usar-credito.
 */
async function consumirCredito(ctx: Contexto, idNova: string, valor: number, observacao: string): Promise<ResultadoDoConsumo> {
  const idCliente = Number(ctx.pagamento.id_cliente);
  const idInt = Number(ctx.pagamento.id_int);
  const { data: pendencias, error: erroPendencias } = await ctx.supabase
    .from("conta_corrente_pendencias")
    .select("id, valor_saldo")
    .eq("id_cliente", idCliente)
    .eq("direcao", "FAVOR_CLIENTE")
    .in("status", ["ABERTA", "PARCIALMENTE_RESOLVIDA"])
    .order("created_at", { ascending: true });
  if (erroPendencias) return { ok: false, mensagem: "Não foi possível ler as pendências de crédito do cliente." };

  const fatias = fatiasDoConsumo(Math.round(valor * 100), (pendencias ?? []) as { id: number; valor_saldo: number }[]);
  for (const fatia of fatias) {
    const { error } =
      fatia.idPendencia != null
        ? await ctx.supabase.rpc("cc_usar_pendencia", {
            p_id_pendencia: fatia.idPendencia,
            p_valor: fatia.centavos / 100,
            p_modo: "CREDITO_IMEDIATO",
            p_id_int_destino: idInt,
            p_id_pagamento: idNova,
            p_chave_reserva: null,
            p_observacao: observacao
          })
        : await ctx.supabase.rpc("mc_usar_credito_avulso", {
            p_id_cliente: idCliente,
            p_valor: fatia.centavos / 100,
            p_id_pagamento: idNova,
            p_id_int_destino: idInt,
            p_observacao: observacao
          });
    if (error) {
      console.error("[trocar-forma-pagamento][CREDITO] falha ao consumir:", error.message);
      return { ok: false, mensagem: error.message.replace(/^[A-Z_]+:\s*/, "") };
    }
  }
  return { ok: true };
}

/** Devolve o crédito da E-Crédito da troca e a cancela (função do banco, transação única). */
async function desfazerCredito(ctx: Contexto, idNova: string, motivoCancela: string): Promise<{ ok: boolean; mensagem?: string }> {
  const { error } = await ctx.supabase.rpc("mc_desfazer_credito_da_troca", {
    p_id_pagamento: idNova,
    p_id_pagamento_antiga: ctx.pagamento.id,
    p_motivo: motivoCancela
  });
  if (error) {
    console.error("[trocar-forma-pagamento][CREDITO] falha ao devolver o crédito:", error.message);
    return { ok: false, mensagem: error.message };
  }
  return { ok: true };
}

async function registrarHistorico(ctx: Contexto, mensagem: string) {
  const { error } = await ctx.supabase.from("propostas_chat").insert([
    {
      id_int: ctx.pagamento.id_int,
      id_cliente: ctx.pagamento.id_cliente,
      mensagem,
      tipo: "SISTEMA",
      autor_nome: ctx.autor,
      setor: "Financeiro",
      visivel_externo: false
    }
  ]);
  if (error) console.warn("[trocar-forma-pagamento] Falha ao registrar o Histórico:", error.message);
}

/** Solta a marca de "troca em andamento" da antiga (só se ainda for a nossa). */
async function soltarMarca(ctx: Contexto, marca: string) {
  const { error } = await ctx.supabase
    .from("pagamentos_v2")
    .update({ motivo_troca: null })
    .eq("id", ctx.pagamento.id)
    .eq("motivo_troca", marca);
  if (error) console.error("[trocar-forma-pagamento] Falha ao soltar a marca da troca:", error.message);
}

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!id) return erro(400, "Informe a cobrança.");
    const ctx = await carregarContexto(request, id);
    if (ehFalha(ctx)) return responderFalha(ctx);
    const avaliacao = await avaliarTroca(ctx);
    if (ehFalha(avaliacao)) {
      // Recusa não é falha da consulta: a janela mostra o motivo.
      if (avaliacao.status === 409) {
        return NextResponse.json({ success: true, pode: false, code: avaliacao.code, message: avaliacao.message });
      }
      return responderFalha(avaliacao);
    }
    return NextResponse.json({
      success: true,
      pode: true,
      notaAutorizada: avaliacao.notaAutorizada,
      idPagamento: ctx.pagamento.id_pagamento,
      valor: Number(ctx.pagamento.valor),
      destinos: avaliacao.destinos,
      credito: avaliacao.credito
    });
  } catch (e) {
    console.error("[trocar-forma-pagamento][GET]", e);
    return erro(500, "Erro interno ao verificar a troca de forma de pagamento.");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(body.id ?? "").trim();
    const idModelo = String(body.id_modelo_cobranca ?? "").trim();
    const motivo = String(body.motivo ?? "").trim();
    const destino = destinoDaTroca(body.tipo);
    if (!id) return erro(400, "Informe a cobrança.");
    if (!destino) return erro(400, "Forma de pagamento não aceita na troca.", "DESTINO_NAO_ACEITO");
    if (destino.exigeCondicao && !idModelo) return erro(400, "Selecione uma condição de pagamento.");
    if (!motivo) return erro(400, "Motivo da troca é obrigatório.");

    const ctx = await carregarContexto(request, id);
    if (ehFalha(ctx)) return responderFalha(ctx);
    const avaliacao = await avaliarTroca(ctx);
    if (ehFalha(avaliacao)) return responderFalha(avaliacao);
    if (destino.consomeCredito && avaliacao.credito && !avaliacao.credito.disponivel) {
      return erro(409, avaliacao.credito.motivo || "E-Crédito indisponível.", "CREDITO_INDISPONIVEL", {
        saldoCredito: avaliacao.credito.saldo
      });
    }
    if (!avaliacao.destinos.some((d) => d.tipo === destino.tipo)) {
      return erro(409, `${destino.rotulo} não vale para este pedido.`, "DESTINO_NAO_PERMITIDO");
    }

    const { pagamento, supabase } = ctx;
    const antigaRef = pagamento.id_pagamento || pagamento.id;
    const rotulo = destino.rotulo;

    let modelo: ModeloDaTroca | null = null;
    if (destino.exigeCondicao) {
      const { data: lido, error: erroModelo } = await supabase
        .from("modelos_cobranca")
        .select("id, resultado, qtd_parcela, inicio, intervalo, entrada_porcento")
        .eq("id", idModelo)
        .maybeSingle<ModeloDaTroca>();
      if (erroModelo) return erro(503, "Não foi possível ler a condição de pagamento.");
      if (!modeloValidoParaTroca(lido)) return erro(400, "Selecione uma condição de pagamento válida.");
      modelo = lido;
    }

    // 1. Trava: só uma troca por cobrança. Não cancela nada.
    const marca = marcadorEmAndamento(ctx.autor, motivo);
    const { data: marcadas, error: erroMarca } = await supabase
      .from("pagamentos_v2")
      .update({ motivo_troca: marca })
      .eq("id", pagamento.id)
      .eq("status", "A_RECEBER")
      .is("motivo_troca", null)
      .select("id");
    if (erroMarca) return erro(503, "Não foi possível iniciar a troca. Nada foi alterado.");
    if (!Array.isArray(marcadas) || marcadas.length === 0) {
      return erro(409, "A cobrança mudou ou já está em troca. Atualize a tela. Nada foi alterado.", "TROCA_EM_ANDAMENTO");
    }

    // 2. A nova nasce primeiro.
    const linhaNova = montarCobrancaDaTroca(
      {
        id_int: pagamento.id_int as number,
        id: pagamento.id,
        id_pagamento: pagamento.id_pagamento,
        id_cliente: pagamento.id_cliente,
        cliente: pagamento.cliente,
        documento: pagamento.documento,
        valor: pagamento.valor,
        empresa: pagamento.empresa,
        id_empresa: pagamento.id_empresa != null ? Number(pagamento.id_empresa) : null,
        os_ideal: pagamento.os_ideal,
        atendente: pagamento.atendente,
        obs_v2: pagamento.obs_v2
      },
      modelo,
      new Date(),
      destino
    );
    const { data: nova, error: erroNova } = await supabase
      .from("pagamentos_v2")
      .insert([linhaNova])
      .select("id, id_pagamento")
      .single<{ id: string; id_pagamento: string | null }>();
    if (erroNova || !nova) {
      await soltarMarca(ctx, marca);
      const recusa = recusaDoGatilhoNoErro(erroNova?.message);
      return erro(recusa ? 409 : 500, recusa || `Não foi possível criar a cobrança ${rotulo}. O PIX continua ativo e nada foi alterado.`);
    }
    const novaRef = nova.id_pagamento || nova.id;

    // 2b. E-Crédito: o crédito sai do saldo agora. Falhou? Devolve o que saiu,
    // cancela a nova e o PIX nem vai ao banco.
    if (destino.consomeCredito) {
      const consumo = await consumirCredito(
        ctx,
        nova.id,
        Number(linhaNova.valor),
        `Crédito aplicado como pagamento da proposta #${pagamento.id_int} (troca do PIX ${antigaRef})`
      );
      if (!consumo.ok) {
        const volta = await desfazerCredito(
          ctx,
          nova.id,
          `Troca de forma de pagamento não concluída: falha ao consumir o crédito (${consumo.mensagem}). O PIX ${antigaRef} continua ativo. Motivo da troca: ${motivo}`
        );
        await soltarMarca(ctx, marca);
        if (!volta.ok) {
          await registrarHistorico(
            ctx,
            `ATENÇÃO: troca para E-Crédito não concluída e o crédito da cobrança ${novaRef} não foi devolvido. Conferência manual do Financeiro na Conta Corrente. PIX ${antigaRef} segue ativo.`
          );
          return erro(500, `Falha ao usar o crédito e ao devolvê-lo. A cobrança ${novaRef} precisa de conferência manual. O PIX continua ativo.`, "DESFAZER_FALHOU");
        }
        return erro(409, `A forma de pagamento não foi trocada: ${consumo.mensagem}. O crédito não foi usado e o PIX continua ativo.`, "CREDITO_NAO_CONSUMIDO");
      }
    }

    // 3. Cancela o PIX no banco — o mesmo cancelamento de cancelar-externo.
    const resposta = await chamarCancelamentoDePix({
      corpo: corpoDoCancelamentoPix({
        codigoDoBanco: String(pagamento.cod_solicitacao_inter),
        idEmpresa: Number(pagamento.id_empresa)
      }),
      cabecalhos: cabecalhosWebhookN8n()
    });
    const decisao = decidirCancelamentoDePix(Number(pagamento.id_empresa), resposta);
    console.log("[trocar-forma-pagamento][PIX] banco", {
      id_empresa: pagamento.id_empresa,
      desfecho: decisao.desfecho,
      cancelaNoVibe: decisao.cancelarNoVibe
    });

    // 4b. Banco não confirmou: desfaz a nova; a antiga segue ativa.
    if (!decisao.cancelarNoVibe) {
      const motivoCancelaNova = motivoCancelaDaNovaDesfeita(antigaRef, decisao.desfecho, motivo);
      let erroDesfaz: unknown = null;
      if (destino.consomeCredito) {
        // Devolve o crédito e cancela a nova juntos. Precisa da marca: vem antes de soltá-la.
        const volta = await desfazerCredito(ctx, nova.id, motivoCancelaNova);
        if (!volta.ok) erroDesfaz = volta.mensagem;
      } else {
        const { error } = await supabase
          .from("pagamentos_v2")
          .update({ status: "CANCELADO", motivo_cancela: motivoCancelaNova })
          .eq("id", nova.id);
        erroDesfaz = error;
      }
      await soltarMarca(ctx, marca);
      if (erroDesfaz) {
        await registrarHistorico(
          ctx,
          destino.consomeCredito
            ? `ATENÇÃO: troca de forma de pagamento não concluída e a cobrança ${novaRef} (E-Crédito) ficou ativa junto com o PIX ${antigaRef}, com o crédito consumido. Conferência manual do Financeiro.`
            : `ATENÇÃO: troca de forma de pagamento não concluída e a cobrança ${novaRef} (${rotulo}) ficou ativa junto com o PIX ${antigaRef}. Cancele a ${novaRef}.`
        );
        return erro(
          500,
          `O banco não confirmou o cancelamento do PIX e não foi possível desfazer a cobrança ${novaRef} (${rotulo}). Cancele a ${novaRef} antes de qualquer outra ação.`,
          "DESFAZER_FALHOU"
        );
      }
      await registrarHistorico(
        ctx,
        mensagemHistoricoDaTrocaDesfeita({ antigaIdPagamento: antigaRef, novaIdPagamento: novaRef, autor: ctx.autor, motivo, rotulo })
      );
      return erro(
        decisao.statusHttp,
        `A forma de pagamento não foi trocada. ${mensagemDoDesfechoPix(decisao.desfecho)}`,
        "PIX_NAO_CANCELADO_NO_BANCO",
        { desfecho: decisao.desfecho }
      );
    }

    // 4a. Banco confirmou: a antiga sai.
    const condicao = modelo ? String(modelo.resultado) : null;
    const { error: erroAntiga } = await supabase
      .from("pagamentos_v2")
      .update({
        status: "CANCELADO",
        motivo_cancela: motivoCancelaDaAntiga(novaRef, motivo, rotulo),
        motivo_troca: registroDaTrocaNaAntiga({ autor: ctx.autor, motivo, novaIdPagamento: novaRef, condicao, rotulo })
      })
      .eq("id", pagamento.id);
    if (erroAntiga) {
      await registrarHistorico(
        ctx,
        `ATENÇÃO: o PIX ${antigaRef} foi cancelado no banco, mas não no sistema. A cobrança ${novaRef} (${rotulo}) é a que vale. Motivo da troca: ${motivo}`
      );
      return erro(
        500,
        `O PIX foi cancelado no banco e a cobrança ${novaRef} (${rotulo}) foi criada, mas não foi possível marcar o PIX como cancelado no sistema. Não tente de novo antes de conferir.`,
        "ANTIGA_NAO_GRAVADA"
      );
    }

    await registrarHistorico(
      ctx,
      mensagemHistoricoDaTroca({
        antigaIdPagamento: antigaRef,
        novaIdPagamento: novaRef,
        autor: ctx.autor,
        permissao: ctx.permissao,
        condicao,
        valor: Number(linhaNova.valor),
        motivo,
        rotulo
      })
    );

    return NextResponse.json({
      success: true,
      message: `Forma de pagamento trocada: ${antigaRef} (PIX) cancelada e ${novaRef} (${rotulo}) criada.`,
      nova: { id: nova.id, id_pagamento: nova.id_pagamento, tipo: destino.tipo }
    });
  } catch (e) {
    console.error("[trocar-forma-pagamento][POST]", e);
    return erro(500, "Erro interno ao trocar a forma de pagamento. Confira as cobranças do pedido antes de tentar de novo.");
  }
}
