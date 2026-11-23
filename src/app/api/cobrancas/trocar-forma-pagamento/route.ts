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
import { cancelarBoletoAVistaNoC6 } from "@/features/cobrancas/services/cancelamento-boleto-c6";
import { recusaDoGatilhoNoErro } from "@/features/cobrancas/lib/tipo-x-retrabalho";
import { statusEhEntregue, MENSAGEM_PEDIDO_ENTREGUE, CODIGO_PEDIDO_ENTREGUE } from "@/features/orcamentos/services/pedido-entregue";
import { lerContextoRetrabalhoDoPedido } from "@/features/cobrancas/services/tipo-x-retrabalho.service";
import { lerTodas } from "@/lib/supabase/ler-todas";
import { formatCurrency } from "@/lib/formatters/currency";
import { getLocalDateInSaoPaulo } from "@/features/cobrancas/cobrancas-utils";
import { calcularSituacaoQuitacaoProposta } from "@/features/cobrancas/services/conferencia-financeira.service";
import {
  MENSAGEM_CHAT_COBRANCA_CONFERIDA,
  executarPosConfirmacao,
  montarPayloadConfirmacao
} from "@/features/cobrancas/services/conferencia-nucleo.server";
import { confirmacaoDeveSerRecusada } from "@/features/cobrancas/lib/cancelada-que-consta-paga";
import {
  PERMISSAO_CHAVE_PIX,
  RECUSAS_DA_TROCA,
  descricaoDaChavePix,
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
  nomeDaOrigem,
  origemDaTroca,
  recusaDoTituloDoBoleto,
  rotuloDaOrigem,
  type OrigemDaTroca,
  type TituloDoBoletoParaTroca,
  motivoCancelaDaAntiga,
  motivoCancelaDaNovaDesfeita,
  problemaNaChavePix,
  recusaDaCobrancaParaTroca,
  recusaDaFuncaoChavePix,
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
 * Chave Pix (17/11/2026): o cliente já pagou por PIX na chave da empresa,
 * fora do Vibe. Só aparece para quem confirma pagamento na Conferência
 * (conferencia.confirm, ou administrador). A nova nasce PAID, tipo PIX com
 * forma_pgto CHAVE PIX, pela função do banco `fin_troca_criar_chave_pix`, que
 * grava junto a data do pagamento, o e2eId e o comprovante (opcionais) e o autor, e recusa
 * e2eId/comprovante já usados. Desfazer é cancelá-la, como o Faturado.
 * Depois que o banco confirma o cancelamento do PIX de origem, a Chave Pix é
 * conferida pelo mesmo usuário, pelo caminho do "Confirmar Conferência" (o
 * núcleo comum de conferencia-nucleo.server: trava de quitação, payload,
 * chat, Conta Corrente, status do pedido e prateleira), e o pedido é liberado
 * na hora. Se a conferência não passar, a troca vale e a cobrança fica na
 * Fila de Conferência, com o motivo no Histórico.
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
 * Boleto à vista de origem (23/11/2026, caso 25255): boleto não pago, de
 * título único, emitido no C6 (Ideal, E3 e Birô no C6). Mesma ordem: a nova
 * nasce, o boleto é cancelado no C6 pelo mesmo pedido do cancelar-externo e só
 * vale com `cancelado: true` (`services/cancelamento-boleto-c6`); sem a
 * confirmação, a nova é desfeita e o boleto fica como estava. Confirmado, a
 * cobrança e o título (`boletos`, pelo código do C6 e o pedido) caem.
 * O cancelamento simples (cancelar-externo) não muda: a nota continua barrando.
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
  ehSuperAdm: boolean;
  ehAdmin: boolean;
  email: string;
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
    .select("is_super_adm, is_admin, nome_usuario")
    .eq("user_id", userId)
    .maybeSingle<{ is_super_adm: boolean | null; is_admin: boolean | null; nome_usuario: string | null }>();
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
    pagamento,
    ehSuperAdm: usuarioRow.is_super_adm === true,
    ehAdmin: usuarioRow.is_admin === true,
    email: authData.user.email || ""
  };
}

/**
 * Quem confirma pagamento na Conferência: a mesma regra da rota confirmar e de
 * cc__assert_permissao (super admin, administrador, ou perfil com a permissão).
 */
async function podeConfirmarPagamento(ctx: Contexto): Promise<boolean> {
  if (ctx.ehSuperAdm || ctx.ehAdmin) return true;
  return verificarPermissaoServerSide(ctx.supabase, ctx.userId, PERMISSAO_CHAVE_PIX);
}

/** Veredito da troca: recusas de cancelamento (menos a nota) + regras da troca. */
async function avaliarTroca(
  ctx: Contexto
): Promise<{ pode: true; notaAutorizada: boolean; destinos: DestinoDaTroca[]; credito: CreditoDaTroca | null; origem: OrigemDaTroca } | Falha> {
  const elegibilidade = await avaliarCancelamentoNoServidor(ctx.supabase, ctx.pagamento.id, RECUSAS_DA_TROCA);
  if (!elegibilidade.ok) {
    return falha(elegibilidade.erro === "NAO_ENCONTRADA" ? 404 : 503, elegibilidade.mensagem, elegibilidade.erro);
  }
  const { veredito } = elegibilidade;
  if (veredito.jaInativa) return falha(409, "Esta cobrança já está cancelada.", "JA_INATIVA");
  if (!veredito.pode) return falha(409, veredito.message, veredito.code);

  const recusa = recusaDaCobrancaParaTroca(ctx.pagamento);
  if (recusa) return falha(recusa.httpStatus, recusa.message, recusa.code);

  // Boleto de origem: título único no Contas a Receber (23/11/2026).
  if (origemDaTroca(ctx.pagamento.tipo_cobranca) === "BOLETO") {
    const { data: titulos, error: erroTitulos } = await ctx.supabase
      .from("boletos")
      .select("id_boleto_c6, id_pagamento, status, paid_at, parcela, total_parcelas, deposito_conta")
      .eq("id_int", ctx.pagamento.id_int);
    if (erroTitulos) return falha(503, "Não foi possível ler os títulos do boleto no banco.");
    const recusaTitulo = recusaDoTituloDoBoleto((titulos ?? []) as TituloDoBoletoParaTroca[], ctx.pagamento);
    if (recusaTitulo) return falha(recusaTitulo.httpStatus, recusaTitulo.message, recusaTitulo.code);
  }

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

  // Chave Pix: só para quem confirma pagamento na Conferência.
  if (destinos.some((d) => d.recebidoNaChave) && !(await podeConfirmarPagamento(ctx))) {
    destinos = destinos.filter((d) => !d.recebidoNaChave);
  }

  // E-Crédito só aparece se quem troca pode usar crédito e o saldo cobre tudo.
  let credito: CreditoDaTroca | null = null;
  if (destinos.some((d) => d.consomeCredito)) {
    credito = await avaliarCredito(ctx);
    if (!credito.disponivel) destinos = destinos.filter((d) => !d.consomeCredito);
  }
  if (destinos.length === 0) return falha(409, "Nenhuma forma de pagamento interna vale para este pedido.", "SEM_DESTINO");

  return {
    pode: true,
    notaAutorizada: veredito.recusas.some((r) => r.code === "NOTA_AUTORIZADA"),
    destinos,
    credito,
    origem: origemDaTroca(ctx.pagamento.tipo_cobranca) ?? "PIX"
  };
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

type ResultadoDaConferencia = { conferida: true; jaConferida: boolean } | { conferida: false; motivo: string };

/**
 * Confere a Chave Pix recém-criada pelo caminho do "Confirmar Conferência"
 * (rota confirmar e conferência automática): recusa de cancelada que consta
 * paga, trava de quitação, payload do núcleo, gravação só se a linha ainda é
 * PAID e não conferida, aviso no chat e o pós-confirmação (Conta Corrente,
 * status do pedido, prateleira). Nunca desfaz a troca: se não conferir, a
 * cobrança fica na Fila de Conferência.
 */
async function conferirChavePix(ctx: Contexto, idNova: string): Promise<ResultadoDaConferencia> {
  try {
    const { data: cobranca, error } = await ctx.supabase.from("pagamentos_v2").select("*").eq("id", idNova).maybeSingle();
    if (error || !cobranca) return { conferida: false, motivo: "não foi possível reler a cobrança nova" };
    if (confirmacaoDeveSerRecusada(cobranca)) return { conferida: false, motivo: "a cobrança consta cancelada" };
    if (cobranca.confirmado === true) return { conferida: true, jaConferida: true };

    const situacao = await calcularSituacaoQuitacaoProposta(ctx.supabase, cobranca.id_int, idNova);
    if (!situacao.podeConfirmar) return { conferida: false, motivo: "o valor quitado é menor que o total da proposta" };

    const payload = montarPayloadConfirmacao(cobranca, ctx.autor, new Date().toISOString());
    const { data: gravadas, error: erroGravacao } = await ctx.supabase
      .from("pagamentos_v2")
      .update(payload)
      .eq("id", idNova)
      .eq("status", "PAID")
      .eq("confirmado", false)
      .select("id");
    if (erroGravacao) return { conferida: false, motivo: `falha ao gravar a conferência (${erroGravacao.message})` };
    // Outra conferência (a automática, ou um clique) chegou antes: já está conferida.
    if (!Array.isArray(gravadas) || gravadas.length === 0) return { conferida: true, jaConferida: true };

    const { error: erroChat } = await ctx.supabase.from("propostas_chat").insert([
      {
        id_int: cobranca.id_int,
        id_cliente: cobranca.id_cliente ?? null,
        mensagem: MENSAGEM_CHAT_COBRANCA_CONFERIDA,
        tipo: "SISTEMA",
        autor_nome: ctx.autor,
        setor: "Financeiro",
        visivel_externo: false
      }
    ]);
    if (erroChat) console.warn("[trocar-forma-pagamento][CHAVE] aviso de conferência não gravado:", erroChat.message);

    await executarPosConfirmacao(ctx.supabase, cobranca, {
      idCobranca: idNova,
      confirmadoPor: ctx.autor,
      // Engine sem uid, como na rota confirmar (ver o comentário de lá).
      autorReconciliacao: { uid: "", nome: ctx.autor, email: ctx.email },
      usuarioPrateleira: { uid: ctx.userId, email: ctx.email }
    });
    return { conferida: true, jaConferida: false };
  } catch (e) {
    return { conferida: false, motivo: e instanceof Error ? e.message : "erro inesperado" };
  }
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
      credito: avaliacao.credito,
      origem: avaliacao.origem
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
    const camposChave = {
      dataPagamento: String(body.data_pagamento ?? "").trim(),
      e2eId: String(body.e2e_id ?? ""),
      comprovante: String(body.comprovante ?? "")
    };
    if (destino.recebidoNaChave) {
      const problema = problemaNaChavePix(camposChave, getLocalDateInSaoPaulo(new Date()));
      if (problema) return erro(400, problema, "CHAVE_CAMPOS");
    }

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
    const origem = avaliacao.origem;
    const nomeOrigem = nomeDaOrigem(origem);

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
    let nova: { id: string; id_pagamento: string | null } | null = null;
    let erroNova: { message: string } | null = null;
    if (destino.recebidoNaChave) {
      // Chave Pix: a cobrança paga e o registro do recebimento nascem juntos na
      // função do banco, que confere a marca da troca e o e2eId/comprovante.
      const criada = await supabase.rpc("fin_troca_criar_chave_pix", {
        p_id_origem: pagamento.id,
        p_data_pagamento: camposChave.dataPagamento,
        p_e2e_id: camposChave.e2eId.trim() || null,
        p_comprovante: camposChave.comprovante.trim() || null,
        p_motivo: motivo
      });
      const dados = criada.data as { id?: string; id_pagamento?: string | null } | null;
      if (criada.error || !dados?.id) erroNova = { message: criada.error?.message ?? "sem retorno" };
      else nova = { id: dados.id, id_pagamento: dados.id_pagamento ?? null };
    } else {
      const inserida = await supabase
        .from("pagamentos_v2")
        .insert([linhaNova])
        .select("id, id_pagamento")
        .single<{ id: string; id_pagamento: string | null }>();
      nova = inserida.data ?? null;
      erroNova = inserida.error ?? null;
    }
    if (erroNova || !nova) {
      await soltarMarca(ctx, marca);
      const recusaChave = destino.recebidoNaChave ? recusaDaFuncaoChavePix(erroNova?.message, origem) : null;
      if (recusaChave) return erro(recusaChave.status, recusaChave.message, recusaChave.code);
      const recusa = recusaDoGatilhoNoErro(erroNova?.message);
      return erro(recusa ? 409 : 500, recusa || `Não foi possível criar a cobrança ${rotulo}. O ${nomeOrigem} continua ativo e nada foi alterado.`);
    }
    const novaRef = nova.id_pagamento || nova.id;

    // 2b. E-Crédito: o crédito sai do saldo agora. Falhou? Devolve o que saiu,
    // cancela a nova e o PIX nem vai ao banco.
    if (destino.consomeCredito) {
      const consumo = await consumirCredito(
        ctx,
        nova.id,
        Number(linhaNova.valor),
        `Crédito aplicado como pagamento da proposta #${pagamento.id_int} (troca do ${nomeOrigem} ${antigaRef})`
      );
      if (!consumo.ok) {
        const volta = await desfazerCredito(
          ctx,
          nova.id,
          `Troca de forma de pagamento não concluída: falha ao consumir o crédito (${consumo.mensagem}). O ${nomeOrigem} ${antigaRef} continua ativo. Motivo da troca: ${motivo}`
        );
        await soltarMarca(ctx, marca);
        if (!volta.ok) {
          await registrarHistorico(
            ctx,
            `ATENÇÃO: troca para E-Crédito não concluída e o crédito da cobrança ${novaRef} não foi devolvido. Conferência manual do Financeiro na Conta Corrente. ${rotuloDaOrigem(origem)} ${antigaRef} segue ativo.`
          );
          return erro(500, `Falha ao usar o crédito e ao devolvê-lo. A cobrança ${novaRef} precisa de conferência manual. O ${nomeOrigem} continua ativo.`, "DESFAZER_FALHOU");
        }
        return erro(409, `A forma de pagamento não foi trocada: ${consumo.mensagem}. O crédito não foi usado e o ${nomeOrigem} continua ativo.`, "CREDITO_NAO_CONSUMIDO");
      }
    }

    // 3. Cancela a antiga no banco — o mesmo cancelamento de cancelar-externo
    //    (PIX pelo cancelamento de PIX; boleto à vista pelo do C6, com confirmação).
    let decisao: { cancelarNoVibe: boolean; desfecho: string; statusHttp: number; mensagem: string; codigo: string };
    if (origem === "BOLETO") {
      const boleto = await cancelarBoletoAVistaNoC6({
        codigo: String(pagamento.cod_solicitacao_inter),
        idEmpresa: Number(pagamento.id_empresa),
        cabecalhosComSegredo: cabecalhosWebhookN8n()
      });
      decisao = { cancelarNoVibe: boleto.cancelou, desfecho: boleto.desfecho, statusHttp: boleto.statusHttp, mensagem: boleto.mensagem, codigo: "BOLETO_NAO_CANCELADO_NO_BANCO" };
    } else {
      const resposta = await chamarCancelamentoDePix({
        corpo: corpoDoCancelamentoPix({
          codigoDoBanco: String(pagamento.cod_solicitacao_inter),
          idEmpresa: Number(pagamento.id_empresa)
        }),
        cabecalhos: cabecalhosWebhookN8n()
      });
      const pix = decidirCancelamentoDePix(Number(pagamento.id_empresa), resposta, String(pagamento.cod_solicitacao_inter));
      decisao = { cancelarNoVibe: pix.cancelarNoVibe, desfecho: pix.desfecho, statusHttp: pix.statusHttp, mensagem: mensagemDoDesfechoPix(pix.desfecho), codigo: "PIX_NAO_CANCELADO_NO_BANCO" };
    }
    console.log(`[trocar-forma-pagamento][${origem}] banco`, {
      id_empresa: pagamento.id_empresa,
      desfecho: decisao.desfecho,
      cancelaNoVibe: decisao.cancelarNoVibe
    });

    // 4b. Banco não confirmou: desfaz a nova; a antiga segue ativa.
    if (!decisao.cancelarNoVibe) {
      const motivoCancelaNova = motivoCancelaDaNovaDesfeita(antigaRef, decisao.desfecho, motivo, origem);
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
            ? `ATENÇÃO: troca de forma de pagamento não concluída e a cobrança ${novaRef} (E-Crédito) ficou ativa junto com o ${nomeOrigem} ${antigaRef}, com o crédito consumido. Conferência manual do Financeiro.`
            : `ATENÇÃO: troca de forma de pagamento não concluída e a cobrança ${novaRef} (${rotulo}) ficou ativa junto com o ${nomeOrigem} ${antigaRef}. Cancele a ${novaRef}.`
        );
        return erro(
          500,
          `O banco não confirmou o cancelamento do ${nomeOrigem} e não foi possível desfazer a cobrança ${novaRef} (${rotulo}). Cancele a ${novaRef} antes de qualquer outra ação.`,
          "DESFAZER_FALHOU"
        );
      }
      await registrarHistorico(
        ctx,
        mensagemHistoricoDaTrocaDesfeita({ antigaIdPagamento: antigaRef, novaIdPagamento: novaRef, autor: ctx.autor, motivo, rotulo, origem })
      );
      return erro(
        decisao.statusHttp,
        `A forma de pagamento não foi trocada. ${decisao.mensagem}`,
        decisao.codigo,
        { desfecho: decisao.desfecho }
      );
    }

    // 4a. Banco confirmou: a antiga sai.
    const condicao = modelo ? String(modelo.resultado) : destino.recebidoNaChave ? descricaoDaChavePix(camposChave) : null;
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
        `ATENÇÃO: o ${nomeOrigem} ${antigaRef} foi cancelado no banco, mas não no sistema. A cobrança ${novaRef} (${rotulo}) é a que vale. Motivo da troca: ${motivo}`
      );
      return erro(
        500,
        `O ${nomeOrigem} foi cancelado no banco e a cobrança ${novaRef} (${rotulo}) foi criada, mas não foi possível marcar o ${nomeOrigem} como cancelado no sistema. Não tente de novo antes de conferir.`,
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
        rotulo,
        origem
      })
    );

    // Boleto: o título do Contas a Receber cai junto, como no cancelar-externo
    // (filtro composto: código do C6 e pedido, nunca o pedido sozinho).
    let avisoTitulo: string | null = null;
    if (origem === "BOLETO") {
      const { error: erroTitulo } = await supabase
        .from("boletos")
        .update({ status: "CANCELADO" })
        .eq("id_boleto_c6", String(pagamento.cod_solicitacao_inter))
        .eq("id_int", pagamento.id_int);
      if (erroTitulo) {
        avisoTitulo = `O boleto foi cancelado no banco e a troca valeu, mas o título dele continua ativo na Carteira (${erroTitulo.message}). Cancele o título manualmente.`;
        await registrarHistorico(ctx, `ATENÇÃO: ${avisoTitulo}`);
      }
    }

    // Chave Pix: o banco confirmou, a antiga caiu — agora a conferência, pelo
    // mesmo usuário, para liberar o pedido na hora.
    let conferencia: ResultadoDaConferencia | null = null;
    if (destino.recebidoNaChave) {
      conferencia = await conferirChavePix(ctx, nova.id);
      if (!conferencia.conferida) {
        await registrarHistorico(
          ctx,
          `A cobrança ${novaRef} (Chave Pix) foi criada paga, mas não foi conferida na troca: ${conferencia.motivo}. Ela segue na Fila de Conferência.`
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: `Forma de pagamento trocada: ${antigaRef} (${rotuloDaOrigem(origem)}) cancelada e ${novaRef} (${rotulo}) criada.${avisoTitulo ? ` ${avisoTitulo}` : ""}`,
      origem,
      ...(avisoTitulo ? { avisoTitulo } : {}),
      nova: { id: nova.id, id_pagamento: nova.id_pagamento, tipo: destino.tipo },
      ...(conferencia
        ? { conferida: conferencia.conferida, motivoNaoConferida: conferencia.conferida ? null : conferencia.motivo }
        : {})
    });
  } catch (e) {
    console.error("[trocar-forma-pagamento][POST]", e);
    return erro(500, "Erro interno ao trocar a forma de pagamento. Confira as cobranças do pedido antes de tentar de novo.");
  }
}
