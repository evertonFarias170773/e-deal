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
import {
  divergenciasFinanceiras,
  type SnapshotFinanceiro
} from "@/features/orcamentos/lib/edicao-financeira";
import type { CobrancaParaFaturado } from "@/features/orcamentos/services/faturado-editavel";
import { aplicarDiferencaFinanceira } from "@/features/cobrancas/services/diferenca-financeira-proposta";
import { avaliarCoberturaFinanceira } from "@/features/cobrancas/services/cobertura-financeira-proposta";

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

/** R$ 1.234,56 — para a mensagem dizer o valor que o cliente tem em mãos. */
function formatarBRL(valor: number): string {
  return (Number(valor) || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

/**
 * Estado financeiro da proposta no banco AGORA, para comparar campo a campo com
 * o formulário que chegou. Ver `lib/edicao-financeira.ts`.
 *
 * Devolve `null` em erro de leitura: sem o snapshot não dá para afirmar que a
 * edição é inofensiva, e o chamador recusa em vez de adivinhar.
 */
async function lerSnapshotFinanceiro(
  supabase: SupabaseClient,
  idInt: number,
  propostaBanco: { is_avulso?: boolean | null; modalidade_frete?: string | null; valor_frete?: number | null }
): Promise<SnapshotFinanceiro | null> {
  const [{ data: itens, error: itensErro }, { data: desconto, error: descontoErro }] = await Promise.all([
    supabase
      .from("produtos_proposta")
      .select("id, id_produto, qtd, valor_unt, fixo, valor_sub_total, status_item")
      .eq("id_int", idInt),
    supabase
      .from("desconto_proposta")
      .select("valor_percentual, valor_nominal")
      .eq("id_int", idInt)
      .eq("tipo_desconto", "DESCONTO_GERAL")
      .maybeSingle()
  ]);

  if (itensErro) {
    console.error(`[editar-paga] Falha ao ler itens da proposta #${idInt}:`, itensErro.message);
    return null;
  }
  // `desconto_proposta` ausente é normal (proposta sem desconto); erro de LEITURA
  // não é — sem ele, um desconto existente passaria despercebido.
  if (descontoErro) {
    console.error(`[editar-paga] Falha ao ler desconto da proposta #${idInt}:`, descontoErro.message);
    return null;
  }

  const percentual = Number(desconto?.valor_percentual ?? 0);
  const nominal = Number(desconto?.valor_nominal ?? 0);

  return {
    isAvulso: Boolean(propostaBanco.is_avulso),
    modalidadeFrete: propostaBanco.modalidade_frete ?? null,
    valorFrete: Number(propostaBanco.valor_frete) || 0,
    // Mesma leitura que `saveProposta` faz ao abrir a proposta: percentual > 0
    // manda; senão vale o nominal.
    descontoGeralTipo: percentual > 0 ? "PERCENTUAL" : "VALOR",
    descontoGeralValor: percentual > 0 ? percentual : nominal,
    itens: (itens ?? []).map((i) => ({
      id: Number(i.id),
      idProduto: Number(i.id_produto),
      quantidade: Number(i.qtd) || 0,
      valorUnitario: Number(i.valor_unt) || 0,
      valorFixo: Number(i.fixo) || 0,
      subtotal: Number(i.valor_sub_total) || 0,
      statusItem: String(i.status_item ?? "PENDENTE")
    }))
  };
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
    .select("id_int, id_cliente, valor_total, is_avulso, modalidade_frete, valor_frete")
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

  // ── 5a e 5a2. Cobertura financeira ────────────────────────────────────────
  // O gate da Conta Corrente e o caminho do faturado vivem em
  // `avaliarCoberturaFinanceira`, na MESMA ordem em que rodavam aqui — a
  // leitura de `boletos` inclusive. Saíram deste handler para que a correção de
  // frete pós-liberação use os mesmos três valores em vez de recalculá-los.
  const cobertura = await avaliarCoberturaFinanceira(supabase, {
    idInt,
    cobrancas: cobrancas as CobrancaParaFaturado[],
    valorPagoRealArredondado,
    valorTotalAntesEdicao: Number(propostaBanco.valor_total) || 0,
    novoTotalPrevisto: Number(novoTotal) || Number(propostaBanco.valor_total) || 0
  });

  if (!cobertura.ok) {
    return NextResponse.json({ success: false, error: cobertura.error }, { status: cobertura.status });
  }

  const { estavaIntegralmentePaga, titulos, avaliacaoPrevia, ehCaminhoFaturado } = cobertura;

  //
  // Rede de segurança: a tela exclui os títulos antes de salvar. Se ainda
  // houver algum ativo, o Contas a Receber ficaria com valor velho.
  // Testa `avaliacaoPrevia.elegivel`, e não o atalho `ehCaminhoFaturado`: os dois
  // têm sempre o mesmo valor, mas só o primeiro estreita a união e deixa
  // `titulosParaExcluir` visível. Comportamento idêntico ao de antes.
  if (avaliacaoPrevia.elegivel && avaliacaoPrevia.titulosParaExcluir.length > 0) {
    return NextResponse.json(
      {
        success: false,
        code: "TITULOS_ATIVOS",
        error: `Esta proposta ainda tem ${avaliacaoPrevia.titulosParaExcluir.length} título(s) ativo(s) no Contas a Receber. Eles precisam ser excluídos antes da alteração.`
      },
      { status: 409 }
    );
  }

  // Se houver cobranças mas nenhum pagamento confirmado, impede gravação —
  // MAS só quando a edição mexe em dinheiro (26/08/2026).
  //
  // O faturado a vencer é a exceção de sempre: ele é justamente a cobrança que
  // ainda não foi paga e que mesmo assim pode ser ajustada — exigir confirmação
  // aqui travaria o caso principal daquele fluxo. Intocado.
  //
  // O que mudou: a recusa cobria QUALQUER edição, inclusive trocar contato,
  // endereço ou observação. O que a proteção defende é o link de pagamento que
  // já está com o cliente — ele tem valor fixo no provedor e pode ser pago a
  // qualquer momento, então proposta e cobrança não podem divergir de valor.
  // Edição que não toca nenhuma entrada do cálculo não ameaça isso.
  //
  // A comparação é CAMPO A CAMPO contra o banco, nunca pelo total: o `novoTotal`
  // que chega aqui é o cálculo do client, e esta mesma rota documenta mais
  // abaixo que ele "serviu só para escolher o caminho" — quem decide o valor
  // gravado é o banco, depois dos triggers. Ver `lib/edicao-financeira.ts`,
  // inclusive a dívida técnica da checagem transacional que falta.
  if (temCobrancasAtivas && valorPagoRealArredondado <= 0 && !ehCaminhoFaturado) {
    const snapshot = await lerSnapshotFinanceiro(supabase, idInt, propostaBanco);
    if (!snapshot) {
      return NextResponse.json(
        { success: false, error: "Não foi possível conferir os valores desta proposta no servidor. Tente de novo." },
        { status: 500 }
      );
    }

    const divergencias = divergenciasFinanceiras(formState, snapshot);
    if (divergencias.length > 0) {
      const valorCobranca = cobrancas.reduce((s, c) => s + (Number(c.valor) || 0), 0);
      const plural = cobrancas.length > 1;
      console.info(
        `[editar-paga] Proposta #${idInt}: edicao recusada por mexer em dinheiro — ${divergencias
          .map((d) => `${d.campo} (${d.antes} -> ${d.depois})`)
          .join("; ")}`
      );
      return NextResponse.json(
        {
          success: false,
          code: "EDICAO_ALTERA_VALOR",
          error:
            `Esta proposta tem ${plural ? "cobranças enviadas" : "uma cobrança enviada"} ao cliente no valor de ` +
            `${formatarBRL(valorCobranca)}. Alterar o valor exige cancelar ${plural ? "essas cobranças" : "essa cobrança"} ` +
            `primeiro — o link deixa de funcionar e será preciso gerar ${plural ? "novas" : "uma nova"}. ` +
            `O que mudou: ${divergencias.map((d) => d.campo).join(", ")}.`
        },
        { status: 400 }
      );
    }

    console.info(`[editar-paga] Proposta #${idInt}: edicao sem efeito financeiro — liberada com cobranca ativa.`);
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
    /**
     * 400, e nao 500: o que chega aqui e a RECUSA do `saveProposta` — cliente
     * ausente, proposta sem produto, quantidade zerada. Sao validacoes, nao
     * falha do servidor.
     *
     * O 500 antigo custou caro: em 03/09/2026 a tela mostrava "Cliente e
     * obrigatorio" com 500 no Network, e a investigacao foi duas vezes para o
     * lado errado — procurando erro interno, quando a rota so estava repassando
     * uma mensagem de validacao.
     *
     * O corpo nao muda: `success: false` e o mesmo `error`. A tela trata por
     * `!apiResponse.ok || !apiResult.success` e so distingue 403 e 409, entao
     * este caso segue caindo no mesmo ramo de antes.
     *
     * As demais saidas 500 desta rota continuam 500 — aquelas sao falha de
     * leitura ou de gravacao de verdade, nao recusa.
     */
    return NextResponse.json(
      { success: false, error: saveResult.errorMessage ?? "Erro ao salvar proposta." },
      { status: 400 }
    );
  }

  // ── 9. Buscar o total atualizado no servidor após a gravação ──────────────
  const novoTotalReal = saveResult.valor_total ?? 0;
  const novoTotalRealArredondado = Math.round(novoTotalReal * 100) / 100;

  console.info(`[editar-paga] Pós-save: valor_total (retornado pelo saveProposta) = ${novoTotalRealArredondado}`);

  // ── 9b a 11. Diferença financeira ─────────────────────────────────────────
  // Ajuste do faturado, pendência de Conta Corrente e reconciliação de status
  // vivem em `aplicarDiferencaFinanceira`, na MESMA ordem em que rodavam aqui.
  // Saíram deste handler para que a correção de frete pós-liberação use a mesma
  // decisão em vez de uma segunda cópia — ver o cabeçalho do módulo.
  const resultadoFinanceiro = await aplicarDiferencaFinanceira(supabase, {
    idInt,
    idCliente,
    novoTotalRealArredondado,
    valorPagoRealArredondado,
    ehPropostaPaga,
    estavaIntegralmentePaga,
    ehCaminhoFaturado,
    cobrancas: cobrancas as CobrancaParaFaturado[],
    titulos,
    motivoFinal,
    chaveEvento,
    ator: { uid: user.id, nome: userName ?? user.email ?? "Sistema", email: user.email ?? "" },
    emailExibicao: userEmail ?? user.email ?? ""
  });

  // Os mesmos status e as mesmas mensagens de antes — o que mudou é que a
  // tradução para HTTP acontece aqui, e não dentro da regra.
  if (!resultadoFinanceiro.ok) {
    return NextResponse.json(
      resultadoFinanceiro.code
        ? { success: false, code: resultadoFinanceiro.code, error: resultadoFinanceiro.error }
        : { success: false, error: resultadoFinanceiro.error },
      { status: resultadoFinanceiro.status }
    );
  }

  const { diferenca, pendenciaCriada, faturadoAjustado } = resultadoFinanceiro;


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
