/**
 * /api/orcamentos/editar-paga/route.ts
 *
 * Rota server-side para salvar propostas.
 *
 * SEGURANÇA:
 * - Valida JWT via Authorization: Bearer <token> (padrão Maestro)
 * - Identifica soberanamente se a proposta é paga (possui pagamentos confirmados)
 * - Se for paga, exige a permissão `propostas.editar_paga`
 * - Valida server-side se o id_int existe no banco
 * - Valida server-side se o id_cliente coincide com o da proposta no banco
 * - `saveProposta` é executada com o cliente autenticado injetado (sem bypass de RLS)
 *
 * CONSISTÊNCIA FINANCEIRA (Conta Corrente — Pendências Financeiras):
 * - Se diferença financeira ≠ 0 após o salvamento, abre/ajusta uma pendência via
 *   RPC `cc_abrir_pendencia` (public.conta_corrente_pendencias). A pendência NÃO
 *   bloqueia novas edições da proposta: alterações sucessivas reconciliam a
 *   mesma pendência aberta (a RPC ajusta o valor, nunca duplica).
 * - `movimento_credito` permanece a razão imutável (auditoria/reconciliação);
 *   o saldo operacional da pendência vive em `conta_corrente_pendencias.valor_saldo`.
 *
 * IDEMPOTÊNCIA:
 * - `chaveEvento` (UUID por tentativa de salvar) evita duplicar a abertura em
 *   caso de retry/duplo clique — ver `cc_abrir_pendencia`.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { saveProposta } from "@/features/orcamentos/services/orcamentos.service";
import type { PropostaFormState } from "@/features/orcamentos/types";
import { aplicarStatusRecomendadoProposta } from "@/features/orcamentos/services/status-writer.service";
import {
  avaliarEdicaoFaturado,
  type CobrancaParaFaturado,
  type TituloParaFaturado
} from "@/features/orcamentos/services/faturado-editavel";

// ---------------------------------------------------------------------------
// Configurações e Tipagens
// ---------------------------------------------------------------------------

const PERMISSOES_FALLBACK_ADMIN: string[] = [
  "propostas.editar_paga", "propostas.editar_faturado", "financeiro.resolver_credito",
  "financeiro.bonificar", "financeiro.devolver", "financeiro.debito_futuro", "credito.usar"
];

/**
 * Permissões que abrem a edição, por caminho. `propostas.editar_faturado` vale
 * SÓ no caminho do faturado a vencer (dinheiro ainda não recebido) — quem tem
 * apenas ela continua sem poder editar proposta paga de verdade.
 */
const PERMISSAO_PROPOSTA_PAGA = "propostas.editar_paga";
const PERMISSAO_FATURADO = "propostas.editar_faturado";

type UsuarioMinRow = {
  id_perfil: number | null;
  is_super_adm: boolean;
  is_admin: boolean;
};

type PerfilMinRow = {
  permissoes: string[];
};

/**
 * Verifica se o usuário tem alguma das permissões que abrem a edição.
 * `permissoesAceitas` muda conforme o caminho: paga de verdade aceita só
 * `propostas.editar_paga`; faturado a vencer aceita as duas.
 */
async function verificarPermissaoEditarPaga(
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  permissoesAceitas: string[]
): Promise<{ autorizado: boolean; motivo?: string }> {
  const { data: usuarioData, error: usuarioError } = await supabase
    .from("usuarios")
    .select("id_perfil, is_super_adm, is_admin")
    .eq("user_id", userId)
    .maybeSingle();

  if (usuarioError || !usuarioData) {
    return { autorizado: false, motivo: "Usuário não encontrado em public.usuarios." };
  }

  const row = usuarioData as UsuarioMinRow;

  if (row.is_super_adm) {
    return { autorizado: true };
  }

  if (row.id_perfil != null) {
    const { data: perfilData, error: perfilError } = await supabase
      .from("perfis")
      .select("permissoes")
      .eq("id", row.id_perfil)
      .eq("ativo", true)
      .maybeSingle();

    if (!perfilError && perfilData) {
      const perfil = perfilData as PerfilMinRow;
      const permissoes: string[] = Array.isArray(perfil.permissoes) ? perfil.permissoes : [];
      if (permissoes.includes("*") || permissoesAceitas.some((p) => permissoes.includes(p))) {
        return { autorizado: true };
      }
      return { autorizado: false, motivo: `Perfil sem permissão ${permissoesAceitas.join(" ou ")}.` };
    }
  }

  if (row.is_admin) {
    const temPermissao = permissoesAceitas.some((p) => PERMISSOES_FALLBACK_ADMIN.includes(p));
    return { autorizado: temPermissao };
  }

  return { autorizado: false, motivo: "Sem permissão para editar proposta paga." };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // ── 1. Extrair e validar JWT ──────────────────────────────────────────────
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  // ── Validar variáveis de ambiente ────────────────────────────────────────
  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.error("[editar-paga] ENV AUSENTE:", {
      hasUrl: Boolean(url),
      hasAnonKey: Boolean(anonKey),
    });
    return NextResponse.json(
      { success: false, error: "Configuração de ambiente incompleta. Contate o administrador." },
      { status: 500 }
    );
  }

  if (!token) {
    return NextResponse.json(
      { success: false, error: "Sessão não encontrada. Faça login para continuar." },
      { status: 401 }
    );
  }

  const supabase: SupabaseClient<any, any, any> = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();

  console.info("[editar-paga] Auth:", {
    bearerPresent: Boolean(token),
    authOk: Boolean(authData?.user),
    authErrorCode: authError?.message ?? null,
    userId: authData?.user?.id ?? null,
  });

  if (authError || !authData.user) {
    return NextResponse.json(
      { success: false, error: "Sessão inválida ou expirada. Faça login novamente." },
      { status: 401 }
    );
  }
  const user = { id: authData.user.id, email: authData.user.email ?? "" };

  // ── 3. Ler payload ────────────────────────────────────────────────────────
  const MOTIVOS_VALIDOS = ["FRETE", "PRODUTO_INCLUIDO", "PRODUTO_REMOVIDO", "PRODUTO_TROCADO", "SERVICO_ALTERADO", "OUTRO"];
  let body: {
    formState?: PropostaFormState;
    idInt?: number;
    idCliente?: number;
    valorPagoConfirmado?: number;
    novoTotal?: number;
    userEmail?: string;
    userName?: string;
    motivoPendencia?: string;
    chaveEvento?: string;
    /** `pagamentos_v2.id` do faturado que a tela espera ajustar — ver passo 5a1. */
    faturadoEsperadoId?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Payload inválido." }, { status: 400 });
  }

  const { formState, idInt, idCliente, valorPagoConfirmado, novoTotal, userEmail, userName, motivoPendencia, chaveEvento, faturadoEsperadoId } = body;
  const motivoFinal = motivoPendencia && MOTIVOS_VALIDOS.includes(motivoPendencia) ? motivoPendencia : "OUTRO";

  if (!formState || !idInt || !idCliente) {
    return NextResponse.json(
      { success: false, error: "formState, idInt e idCliente são obrigatórios." },
      { status: 400 }
    );
  }

  // ── 4. Validação Server-Side da Proposta no Banco ────────────────────────
  const { data: propostaBanco, error: propostaError } = await supabase
    .from("propostas")
    .select("id_int, id_cliente, valor_total, is_avulso")
    .eq("id_int", idInt)
    .maybeSingle();

  if (propostaError) {
    return NextResponse.json(
      { success: false, error: `Falha interna ao buscar proposta #${idInt}. Detalhe: ${propostaError.message}` },
      { status: 500 }
    );
  }

  if (!propostaBanco) {
    return NextResponse.json(
      { success: false, error: `Proposta #${idInt} não encontrada no banco de dados.` },
      { status: 404 }
    );
  }

  // Validar se o cliente coincide
  if (propostaBanco.id_cliente !== idCliente) {
    return NextResponse.json(
      { success: false, error: `Inconsistência: cliente informado (${idCliente}) difere do cliente da proposta (${propostaBanco.id_cliente}).` },
      { status: 400 }
    );
  }

  // ── 5. Buscar cobranças e re-calcular valor pago confirmado (servidor) ───
  const { data: cobrancasBanco, error: cobrancasError } = await supabase
    .from("pagamentos_v2")
    .select("id, id_pagamento, tipo_cobranca, status, confirmado, paid_at, valor, obs_v2")
    .eq("id_int", idInt)
    .neq("status", "CANCELADO");

  if (cobrancasError) {
    return NextResponse.json(
      { success: false, error: "Erro ao buscar cobranças da proposta no servidor." },
      { status: 500 }
    );
  }

  const cobrancas = cobrancasBanco || [];
  const temCobrancasAtivas = cobrancas.length > 0;

  // ── 5a1. A cobrança que a tela ia ajustar ainda existe? ───────────────────
  // Quando a tela vem do fluxo do faturado, ela informa qual cobrança espera
  // ajustar. Se essa cobrança sumiu da lista de ativas entre a confirmação e
  // este save — o caso real é o n8n cancelar o faturado inteiro ao excluir a
  // última parcela —, seguir adiante seria o pior desfecho possível: sem
  // cobrança ativa, `ehPropostaPaga` e `ehCaminhoFaturado` viram false, o save
  // roda sem `force`, a proposta grava o valor novo e a cobrança fica com o
  // valor velho, fora do faturamento e sem uma linha de histórico. Falhar
  // alto é melhor que gravar torto.
  if (faturadoEsperadoId && !cobrancas.some((c) => String(c.id) === String(faturadoEsperadoId))) {
    console.error(`[editar-paga] Faturado ${faturadoEsperadoId} da proposta #${idInt} nao esta mais ativo; save recusado.`);
    return NextResponse.json(
      {
        success: false,
        code: "FATURADO_SUMIU",
        error: "A cobrança faturada desta proposta deixou de estar ativa durante a operação — provavelmente foi cancelada junto com o título. A proposta NÃO foi alterada. Confira a aba Pagamentos antes de tentar de novo."
      },
      { status: 409 }
    );
  }

  // Regra oficial de pagamento confirmado. Cobranças que incluem abatimento de
  // débito da conta corrente (marcador [ABATIMENTO_DEBITO:x] em obs_v2) têm essa
  // parcela descontada — aquele valor não é pagamento da PROPOSTA, é quitação de
  // débito antigo do cliente, e não deve virar "crédito" se a proposta for editada.
  const valorPagoReal = cobrancas
    .filter(c => c.status === "PAID" || (c.status === "A_VENCER" && c.confirmado))
    .reduce((sum, c) => {
      const marcador = String(c.obs_v2 || "").match(/\[ABATIMENTO_DEBITO:(\d+(?:\.\d{1,2})?)\]/);
      const abatimento = marcador ? Number(marcador[1]) || 0 : 0;
      return sum + Math.max(0, (Number(c.valor) || 0) - abatimento);
    }, 0);

  const valorPagoRealArredondado = Math.round(valorPagoReal * 100) / 100;

  const ehPropostaPaga = temCobrancasAtivas && valorPagoRealArredondado > 0;

  // ── 5a. Separar os três valores que NÃO podem ser confundidos ────────────
  //  a) valorPagoRealArredondado  → pago confirmado (PAID / A_VENCER confirmado)
  //  b) valorCobradoPendente      → já cobrado mas ainda NÃO pago (PIX/boleto
  //     A_RECEBER, A_VENCER não confirmado). É saldo de uma cobrança em
  //     pagamentos_v2 — resolve-se confirmando OU cancelando a cobrança, e
  //     NUNCA vira pendência de Conta Corrente.
  //  c) diferença de Conta Corrente → só existe quando a proposta já estava
  //     INTEGRALMENTE PAGA e sofreu alteração posterior real (ver gate abaixo).
  const TOLERANCIA_CC = 0.02;
  const valorCobradoPendente = Math.round(
    cobrancas
      .filter(c => !(c.status === "PAID" || (c.status === "A_VENCER" && c.confirmado)))
      .reduce((sum, c) => sum + (Number(c.valor) || 0), 0) * 100
  ) / 100;

  // Total ANTES desta edição (lido no passo 4, antes do saveProposta).
  const valorTotalAntesEdicao = Number(propostaBanco.valor_total) || 0;

  // Conta Corrente só se aplica a diferença pós-pagamento: a proposta precisava
  // já estar quitada (pago confirmado cobre o total anterior) E sem cobrança
  // pendente em aberto. Se ainda há saldo a cobrar (pago < total) ou cobrança
  // pendente (ex.: PIX A_RECEBER de R$ 48 numa proposta de R$ 63 com R$ 15 de
  // E-Crédito), a proposta está no fluxo normal de "aguardando pagamento" — o
  // gap pertence à cobrança em pagamentos_v2, não à Conta Corrente, e NÃO deve
  // abrir pendência FAVOR_EMPRESA nem banner de débito nem modal de diferença.
  const estavaIntegralmentePaga =
    valorTotalAntesEdicao > 0 &&
    valorPagoRealArredondado >= valorTotalAntesEdicao - TOLERANCIA_CC &&
    valorCobradoPendente <= TOLERANCIA_CC;

  // ── 5a2. Caminho do faturado a vencer ─────────────────────────────────────
  // Faturado a vencer é receita autorizada, não dinheiro recebido: a proposta
  // ainda pode mudar e o valor da cobrança acompanha. Sem este desvio ela cai
  // no fluxo de proposta paga e abre pendência de Conta Corrente por um
  // dinheiro que nunca entrou. Avaliado ANTES dos bloqueios abaixo porque
  // muda o que cada um deles decide.
  // Ver features/orcamentos/services/faturado-editavel.ts.
  const { data: titulosBanco, error: titulosError } = await supabase
    .from("boletos")
    .select("id, id_pagamento, parcela, total_parcelas, valor, vencimento, status, paid_at, deposito_conta, id_boleto_c6, id_empresa")
    .eq("id_int", idInt);

  if (titulosError) {
    return NextResponse.json(
      { success: false, error: "Erro ao verificar os títulos desta proposta no Contas a Receber." },
      { status: 500 }
    );
  }

  const titulos = (titulosBanco || []) as TituloParaFaturado[];
  // Avaliação preliminar: usa o total que o cliente calculou apenas para
  // decidir o caminho e barrar o que impede a edição (título quitado, título
  // ainda ativo). O valor gravado sai da reavaliação pós-save, soberana.
  const avaliacaoPrevia = avaliarEdicaoFaturado({
    cobrancas: cobrancas as CobrancaParaFaturado[],
    titulos,
    novoTotal: Number(novoTotal) || Number(propostaBanco.valor_total) || 0
  });
  const ehCaminhoFaturado = avaliacaoPrevia.elegivel;

  // Inelegível NÃO bloqueia a rota: significa apenas que este não é o caminho
  // do faturado, e a proposta segue pelo fluxo de sempre (Conta Corrente).
  // Isso importa porque título quitado com cobrança ainda em A_VENCER é a
  // situação MAIS COMUM na base — 181 das 247 propostas faturadas em
  // 13/08/2026. Ali o dinheiro entrou de verdade (o `pagamentos_v2` é que não
  // acompanha), então quem tem `propostas.editar_paga` deve continuar
  // editando pela Conta Corrente, exatamente como antes. Barrar aqui seria
  // tirar da mesa uma edição que hoje funciona.
  //
  // Rede de segurança: a tela exclui os títulos antes de salvar. Se ainda
  // houver algum ativo, o Contas a Receber ficaria com valor velho.
  if (ehCaminhoFaturado && avaliacaoPrevia.titulosParaExcluir.length > 0) {
    return NextResponse.json(
      {
        success: false,
        code: "TITULOS_ATIVOS",
        error: `Esta proposta ainda tem ${avaliacaoPrevia.titulosParaExcluir.length} título(s) ativo(s) no Contas a Receber. Eles precisam ser excluídos antes da alteração.`
      },
      { status: 409 }
    );
  }

  // Se houver cobranças mas nenhum pagamento confirmado, impede gravação.
  // O faturado a vencer é a exceção: ele é justamente a cobrança que ainda não
  // foi paga e que mesmo assim pode ser ajustada — exigir confirmação aqui
  // travaria o caso principal deste fluxo.
  if (temCobrancasAtivas && valorPagoRealArredondado <= 0 && !ehCaminhoFaturado) {
    return NextResponse.json(
      { success: false, error: "Esta proposta possui cobranças ativas mas não possui pagamento confirmado de fato. Cancele as cobranças antes de editar." },
      { status: 400 }
    );
  }

  // ── 5b. Proposta avulsa ou sem produtos + paga: edição PROIBIDA ──────────
  // A edição autorizada de proposta paga existe para tratar alterações
  // posteriores de PRODUTOS, frete ou serviços. Proposta avulsa (ou sem
  // nenhum produto ativo) não tem o que "alterar" — mudar o valor de uma
  // avulsa já paga quebraria a âncora financeira (caso #19486). Bloqueio
  // vale para TODOS, inclusive admin e superadmin (verificado antes da
  // checagem de permissão, que não pode contornar esta regra).
  //
  // Exceção desde 13/08/2026: o faturado a vencer. A âncora que esta regra
  // protege é o dinheiro recebido, e aqui ele não foi — a âncora passa a ser
  // a própria cobrança, cujo valor acompanha o novo total. Avulsa faturada é
  // caso corrente (acrescentar item, mudar frete, renegociar depois de
  // pronto). A avulsa paga de verdade segue bloqueada, e o bloqueio por
  // título quitado continua valendo: se o título foi liquidado, a proposta
  // nem chega a ser caminho do faturado.
  if (ehPropostaPaga && !ehCaminhoFaturado) {
    let semProdutosAtivos = false;
    if (propostaBanco.is_avulso) {
      semProdutosAtivos = true;
    } else {
      // status_item NULL = legado ativo (equivale a PENDENTE) — .neq puro
      // excluiria NULL e classificaria proposta legada como "sem produtos".
      const { count: qtdProdutosAtivos, error: produtosErr } = await supabase
        .from("produtos_proposta")
        .select("id", { count: "exact", head: true })
        .eq("id_int", idInt)
        .or("status_item.is.null,status_item.neq.CANCELADO");
      if (produtosErr) {
        return NextResponse.json(
          { success: false, error: "Erro ao verificar os produtos da proposta." },
          { status: 500 }
        );
      }
      semProdutosAtivos = (qtdProdutosAtivos ?? 0) === 0;
    }

    if (semProdutosAtivos) {
      // Havendo faturado na proposta, o motivo REAL de ela não ter entrado no
      // caminho novo é mais útil que "avulsa já paga" — que soa como se o
      // dinheiro tivesse entrado quando o que houve foi, por exemplo, um valor
      // que não cabe no faturado.
      if (!avaliacaoPrevia.elegivel && avaliacaoPrevia.motivo !== "SEM_FATURADO") {
        return NextResponse.json(
          { success: false, code: avaliacaoPrevia.motivo, error: avaliacaoPrevia.mensagem },
          { status: 409 }
        );
      }
      return NextResponse.json(
        {
          success: false,
          error: propostaBanco.is_avulso
            ? "Proposta avulsa já paga não pode ser alterada."
            : "Proposta paga sem produtos cadastrados não pode ser alterada.",
        },
        { status: 403 }
      );
    }
  }

  // ── 6. Verificar permissão de edição se for proposta paga ────────────────
  // O faturado a vencer entra aqui mesmo quando `ehPropostaPaga` é falso
  // (cobrança ainda não confirmada): existe cobrança ativa, então a edição
  // continua sendo operação com permissão.
  if (ehPropostaPaga || ehCaminhoFaturado) {
    const permissoesAceitas = ehCaminhoFaturado
      ? [PERMISSAO_PROPOSTA_PAGA, PERMISSAO_FATURADO]
      : [PERMISSAO_PROPOSTA_PAGA];
    const { autorizado, motivo } = await verificarPermissaoEditarPaga(supabase, user.id, permissoesAceitas);
    if (!autorizado) {
      console.warn(`[editar-paga] Acesso negado para user ${user.id}: ${motivo}`);
      // Quem só tem a permissão do faturado precisa saber POR QUE esta
      // proposta ficou de fora — "perfil sem permissão" não diz nada quando o
      // motivo real é título quitado ou valor que não cabe.
      const explicacaoFaturado =
        !avaliacaoPrevia.elegivel && avaliacaoPrevia.motivo !== "SEM_FATURADO"
          ? avaliacaoPrevia
          : null;
      if (explicacaoFaturado) {
        return NextResponse.json(
          { success: false, code: explicacaoFaturado.motivo, error: explicacaoFaturado.mensagem },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { success: false, error: motivo ?? "Sem permissão para editar proposta paga." },
        { status: 403 }
      );
    }
  }

  // ── 8. Salvar proposta ────────────────────────────────────────────────────
  // `force` também no caminho do faturado: sem ele o saveProposta cai no
  // "salvamento parcial seguro", que preserva os produtos e ignora as
  // exclusões — exatamente o que o financeiro precisa poder fazer aqui.
  const saveResult = await saveProposta(
    formState,
    supabase as unknown as import("@supabase/supabase-js").SupabaseClient,
    user.id,
    { force: ehPropostaPaga || ehCaminhoFaturado }
  );

  if (!saveResult.success) {
    return NextResponse.json(
      { success: false, error: saveResult.errorMessage ?? "Erro ao salvar proposta." },
      { status: 500 }
    );
  }

  // ── 9. Buscar o total atualizado no servidor após a gravação ──────────────
  const novoTotalReal = saveResult.valor_total ?? 0;
  const novoTotalRealArredondado = Math.round(novoTotalReal * 100) / 100;

  console.info(`[editar-paga] Pós-save: valor_total (retornado pelo saveProposta) = ${novoTotalRealArredondado}`);

  // ── 9b. Caminho do faturado: a cobrança acompanha o novo total ────────────
  // Reavaliação soberana com o total que o banco calculou — o `novoTotal` do
  // cliente serviu só para escolher o caminho. Como o faturamento é lido de
  // `pagamentos_v2`, este UPDATE é o que faz o mês fechar certo; não existe
  // outro lugar para corrigir.
  let faturadoAjustado: { id: string; valorAnterior: number; valorNovo: number } | null = null;

  if (ehCaminhoFaturado) {
    const avaliacao = avaliarEdicaoFaturado({
      cobrancas: cobrancas as CobrancaParaFaturado[],
      titulos,
      novoTotal: novoTotalRealArredondado
    });

    if (!avaliacao.elegivel) {
      // A proposta já foi gravada e a cobrança não pode acompanhar. Nada de
      // silêncio: o financeiro precisa saber que os dois valores divergiram.
      console.error(`[editar-paga] Proposta #${idInt} salva, mas o faturado nao pode ser ajustado: ${avaliacao.motivo}`);
      return NextResponse.json(
        {
          success: false,
          code: avaliacao.motivo,
          error: `A proposta foi salva, mas a cobrança faturada NÃO foi ajustada: ${avaliacao.mensagem} Acerte a cobrança manualmente na aba Pagamentos.`
        },
        { status: 409 }
      );
    }

    const faturadoAtual = (cobrancas as CobrancaParaFaturado[]).find((c) => c.id === avaliacao.faturadoId);
    const valorAnterior = Math.round((Number(faturadoAtual?.valor) || 0) * 100) / 100;

    if (Math.abs(valorAnterior - avaliacao.novoValorFaturado) >= 0.01) {
      // `boleto_enviadoo` volta a false junto com o valor: com valor novo, os
      // títulos anteriores não servem mais e a cobrança precisa reaparecer em
      // Registros de Recebíveis para ser registrada de novo.
      const { error: updateFaturadoError } = await supabase
        .from("pagamentos_v2")
        .update({ valor: avaliacao.novoValorFaturado, boleto_enviadoo: false })
        .eq("id", avaliacao.faturadoId);

      if (updateFaturadoError) {
        console.error("[editar-paga] Falha ao ajustar o valor do faturado:", updateFaturadoError.message);
        return NextResponse.json(
          {
            success: false,
            code: "FALHA_AJUSTE_FATURADO",
            error: "A proposta foi salva, mas o valor da cobrança faturada não pôde ser atualizado. Acerte a cobrança manualmente na aba Pagamentos."
          },
          { status: 500 }
        );
      }

      faturadoAjustado = {
        id: avaliacao.faturadoId,
        valorAnterior,
        valorNovo: avaliacao.novoValorFaturado
      };

      const moeda = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
      await supabase.from("propostas_chat").insert([
        {
          id_int: idInt,
          id_cliente: idCliente,
          mensagem:
            `Proposta alterada com cobrança faturada a vencer. ` +
            `Valor da cobrança ajustado de ${moeda(valorAnterior)} para ${moeda(avaliacao.novoValorFaturado)}` +
            (avaliacao.valorOutrasCobrancas > 0
              ? ` (outras cobranças da proposta: ${moeda(avaliacao.valorOutrasCobrancas)}, sem alteração).`
              : ".") +
            ` A cobrança voltou para Registros de Recebíveis. Responsável: ${userEmail ?? user.email}.`,
          tipo: "SISTEMA",
          autor_nome: "Sistema",
          setor: "Financeiro",
          visivel_externo: false
        }
      ]);
    }
  }

  // ── 10. Abrir/ajustar a pendência de Conta Corrente via RPC cc_abrir_pendencia ──
  // A RPC recalcula soberanamente (dentro do banco) e reconcilia com qualquer
  // pendência ABERTA/PARCIALMENTE_RESOLVIDA já existente para esta proposta —
  // não há mais necessidade de recalcular diferença/reconciliação aqui.
  let diferenca = 0;
  let pendenciaCriada: { id: number; descricao: string } | null = null;

  // Só abre/ajusta pendência de Conta Corrente quando a proposta JÁ ESTAVA
  // integralmente paga antes desta edição (gate estavaIntegralmentePaga). Caso
  // contrário — cobrança pendente ou saldo ainda a cobrar — o gap é da própria
  // cobrança em pagamentos_v2, e chamar cc_abrir_pendencia criaria um débito
  // FAVOR_EMPRESA indevido (ex.: proposta #19511: R$ 63 total, R$ 15 pago,
  // R$ 48 PIX pendente → a RPC calcularia 63−15 = 48 de débito).
  //
  // REGRA (2026-07-22): diferença DEVEDORA (novo total > pago) NUNCA entra na
  // Conta Corrente — é saldo ainda devido da própria proposta, resolvido por
  // cobrança complementar na aba Pagamentos, abono do administrador ou
  // E-Crédito. A proposta salva normalmente, sem modal de opções, e o status
  // vai para AGUARDANDO pela reconciliação abaixo (cobertura parcial). A RPC
  // só é chamada no caso devedor quando existe pendência ABERTA a reconciliar
  // (ex.: crédito antigo que a nova edição zerou) — nunca para criar débito.
  // Classificação DEVEDORA por comparação direta dos dois valores já
  // arredondados a 2 casas: QUALQUER centavo devido (≥ R$ 0,01) segue o fluxo
  // novo. A tolerância (TOLERANCIA_CC) NÃO participa desta classificação — ela
  // serve só à cobertura (estavaIntegralmentePaga); usá-la aqui deixava
  // débitos de R$ 0,01–0,02 no fluxo antigo (RPC → pendência → modal),
  // regressão vista na #19514 (pago R$ 140,44 × total R$ 140,45).
  // No caminho do faturado a Conta Corrente não entra: a diferença foi para o
  // valor da própria cobrança, e não há dinheiro recebido para creditar ou
  // cobrar do cliente.
  const ehDiferencaDevedora = novoTotalRealArredondado > valorPagoRealArredondado;
  let temPendenciaAbertaParaReconciliar = false;

  if (!ehCaminhoFaturado && estavaIntegralmentePaga && ehDiferencaDevedora) {
    const { data: pendAbertas } = await supabase
      .from("conta_corrente_pendencias")
      .select("id")
      .eq("id_int", idInt)
      .in("status", ["ABERTA", "PARCIALMENTE_RESOLVIDA"])
      .limit(1);
    temPendenciaAbertaParaReconciliar = Boolean(pendAbertas && pendAbertas.length > 0);
  }

  if (!ehCaminhoFaturado && estavaIntegralmentePaga && (!ehDiferencaDevedora || temPendenciaAbertaParaReconciliar)) {
    const eventoUuid = chaveEvento && /^[0-9a-f-]{36}$/i.test(chaveEvento) ? chaveEvento : crypto.randomUUID();

    const { data: idPendenciaRpc, error: rpcError } = await supabase.rpc("cc_abrir_pendencia", {
      p_id_int: idInt,
      p_id_cliente: idCliente,
      p_chave_evento: eventoUuid,
      p_motivo: motivoFinal,
      p_total_soberano: novoTotalRealArredondado,
      p_observacao: `Operador: ${userEmail ?? user.email}.`,
    });

    if (rpcError) {
      const msg = rpcError.message || "Erro ao abrir/ajustar pendência de Conta Corrente.";
      const revisaoNecessaria = msg.includes("CC_AJUSTE_ABAIXO_COMPROMETIDO") || msg.includes("CC_FLIP_COM_COMPROMETIDO");
      console.error("[editar-paga] Erro na RPC cc_abrir_pendencia:", msg);
      return NextResponse.json(
        {
          success: false,
          error: revisaoNecessaria
            ? "Esta proposta já teve parte da diferença anterior usada ou reservada. O Financeiro precisa revisar manualmente antes de novas alterações."
            : msg,
        },
        { status: revisaoNecessaria ? 409 : 500 }
      );
    }

    // No caso devedor a RPC foi chamada apenas para reconciliar/encerrar uma
    // pendência antiga — nunca devolvemos diferença/pendência ao front nesse
    // caso (nenhum modal, salvamento normal; o saldo devedor vive na proposta).
    if (idPendenciaRpc != null && !ehDiferencaDevedora) {
      const { data: pendRow } = await supabase
        .from("conta_corrente_pendencias")
        .select("id, direcao, valor_saldo, valor_reservado, motivo")
        .eq("id", idPendenciaRpc)
        .maybeSingle();

      if (pendRow && (Number(pendRow.valor_saldo) > 0 || Number(pendRow.valor_reservado) > 0)) {
        const valorPendente = Math.round((Number(pendRow.valor_saldo) + Number(pendRow.valor_reservado)) * 100) / 100;
        diferenca = pendRow.direcao === "FAVOR_CLIENTE" ? -valorPendente : valorPendente;
        pendenciaCriada = {
          id: pendRow.id,
          descricao: `Proposta #${idInt} alterada após pagamento confirmado. Diferença pendente: R$ ${valorPendente.toFixed(2).replace(".", ",")} (${pendRow.direcao === "FAVOR_CLIENTE" ? "a favor do cliente" : "a favor da empresa"}). Motivo: ${pendRow.motivo}.`,
        };
      }
    }
  }

  // ── Reconciliar status_interno pelo fluxo oficial ──────────────────────────
  // Roda para qualquer proposta com pagamento confirmado (ehPropostaPaga),
  // INCLUSIVE quando não há diferença de Conta Corrente — é o que mantém
  // #19511 em "AGUARDANDO" (pago 15 de 63, PIX 48 pendente) em vez de status
  // congelado. status_interno nunca era recalculado ao salvar, e
  // formState.status (vindo do cliente) era persistido às cegas; nunca confiar
  // nele. Best-effort: nunca falha o salvamento da proposta em si.
  if (ehPropostaPaga) {
    const reconciliacao = await aplicarStatusRecomendadoProposta(
      idInt,
      { uid: user.id, nome: userName ?? user.email ?? "Sistema", email: user.email ?? "" },
      supabase,
      "AUTO_FINANCEIRO"
    );
    if (!reconciliacao.success) {
      console.warn(`[editar-paga] Reconciliação de status sem efeito para proposta #${idInt}: ${reconciliacao.errorMessage}`);
    }
  }

  return NextResponse.json({
    success: true,
    novoTotal: novoTotalRealArredondado,
    diferenca: diferenca,
    ehPropostaPaga,
    valorPagoReal: valorPagoRealArredondado,
    pendenciaAtiva: pendenciaCriada,
    ehCaminhoFaturado,
    faturadoAjustado,
  });
}
