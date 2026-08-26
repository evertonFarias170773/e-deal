import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { canonizarTransportadora } from "@/features/orcamentos/lib/transportadoras-parceiras";

/**
 * Corrigir QUEM TRANSPORTA numa proposta já fora da fase de orçamento.
 *
 * POR QUE EXISTE — a Peça A da Etapa 3
 *   `podeEditarModalidade` só libera modalidade e transportadora em NOVO e
 *   AGUARDANDO, e a trava é do banco: salvar o orçamento faz DELETE + INSERT em
 *   `cotacao_frete`, e os TRÊS triggers de lá (`trg_frete_sync_financeiro`,
 *   `tg_recalc_frete_v4`, `trg_recalc_after_frete`) reescrevem `status_interno`
 *   a partir de `pagamentos_v2` — com zero pagamentos, forçam NOVO. Editar o
 *   frete de um pedido em produção o rebaixaria e o tiraria do fluxo.
 *
 *   Consequência medida em 26/08/2026: os 22 pedidos hoje em EXPEDICAO,
 *   A RETIRAR e EM TRANSITO estão TODOS com a transportadora nula na proposta, e
 *   não havia como preenchê-la. Sem esta rota, mandar a Expedição "corrigir na
 *   proposta" é mandá-la para uma tela que recusa a edição.
 *
 * COMO ELA ESCAPA DA TRAVA SEM DESLIGÁ-LA
 *   Não passa pelo salvamento do orçamento e NÃO TOCA `cotacao_frete`. É um
 *   UPDATE mirado numa coluna só de `propostas`. Os seis triggers de `propostas`
 *   foram conferidos um a um e NENHUM escreve `status_interno`:
 *
 *     propostas_set_timestamp ............ só updated_at
 *     trg_set_updated_at ................. só updated_at
 *     tg_propostas_valor_total_avulsa .... só is_avulso com valor_total nulo/zero
 *     tg_registrar_paid_at ............... LÊ status_interno, escreve paid_at
 *     trg_sync_cliente_idcliente_pagamentos  UPDATE OF cliente, id_cliente — nem dispara
 *     trg_audit_propostas ................ auditoria, não altera dado
 *
 *   `podeEditarModalidade` e o gate do salvamento continuam exatamente como
 *   estavam. Esta é uma porta nova e estreita, não um afrouxamento da existente.
 *
 * O QUE ELA NÃO FAZ, DE PROPÓSITO
 *   Não altera modalidade, valor do frete, `frete_escolhido` nem
 *   `transporte_categoria`. Responde uma pergunta só: quem transporta.
 *
 * AUTOR, DATA E HISTÓRICO saem de graça: `propostas` está em `audit.config_v2`
 *   (enabled, ignorando só `updated_at`), e `trg_audit_propostas` grava
 *   `actor_uid`, `actor_email`, `occurred_at`, `old_data`, `new_data` e
 *   `changed_fields`. Por isso esta rota usa o JWT DO USUÁRIO e não service
 *   role: com service role o `auth.uid()` seria nulo e a auditoria ficaria sem
 *   autor.
 */

export const maxDuration = 30;

/** Quem pode corrigir. A mesma permissão que libera a recotação no despacho. */
const PERMISSAO = "expedicao.admin";

export async function POST(request: Request) {
  try {
    let idInt = 0;
    let idTransportadoraBruto: number | null = null;
    try {
      const body = (await request.json()) as {
        idInt?: unknown;
        idTransportadoraCliente?: unknown;
      };
      idInt = Number(body?.idInt ?? 0);
      const bruto = body?.idTransportadoraCliente;
      idTransportadoraBruto =
        bruto === null || bruto === undefined || bruto === "" ? null : Number(bruto);
    } catch {
      return NextResponse.json(
        { success: false, message: "Corpo da requisição inválido." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(idInt) || idInt <= 0) {
      return NextResponse.json({ success: false, message: "Pedido não informado." }, { status: 400 });
    }
    if (idTransportadoraBruto !== null && !Number.isFinite(idTransportadoraBruto)) {
      return NextResponse.json({ success: false, message: "Transportadora inválida." }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      console.error("[API][PropostaTransportadora] ENV AUSENTE");
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
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return NextResponse.json({ success: false, message: "Sessão inválida." }, { status: 401 });
    }

    // A permissão vale AQUI, no servidor. A tela apenas esconde o controle.
    const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, PERMISSAO);
    if (!temPermissao) {
      return NextResponse.json(
        {
          success: false,
          message: `Sem permissão para corrigir a transportadora da proposta (${PERMISSAO}).`
        },
        { status: 403 }
      );
    }

    // Mesma canonização da Etapa 2: cadastro substituído vira o legítimo antes
    // de ser gravado, para a proposta e a nota nunca discordarem de quem é.
    const idTransportadora = canonizarTransportadora(idTransportadoraBruto);

    // Transportadora tem de existir, ser TRANSPORTADORA e estar ativa. Sem isto
    // a proposta poderia apontar para um cadastro desativado — que é justamente
    // o que a desativação da agência franqueada quis impedir.
    let nomeTransportadora: string | null = null;
    if (idTransportadora !== null) {
      const { data: cadastroRow } = await supabase
        .from("clientes")
        .select("id_cliente, nome, fantasia, categoria, ativo")
        .eq("id_cliente", idTransportadora)
        .maybeSingle();

      const cadastro = cadastroRow as {
        nome?: string | null;
        fantasia?: string | null;
        categoria?: string | null;
        ativo?: boolean | null;
      } | null;

      if (!cadastro) {
        return NextResponse.json(
          { success: false, message: `Transportadora #${idTransportadora} não encontrada.` },
          { status: 404 }
        );
      }
      if (String(cadastro.categoria ?? "").toUpperCase() !== "TRANSPORTADORA" || cadastro.ativo !== true) {
        return NextResponse.json(
          {
            success: false,
            message: "Esse cadastro não é uma transportadora ativa. Escolha outro."
          },
          { status: 409 }
        );
      }
      nomeTransportadora = String(cadastro.nome ?? cadastro.fantasia ?? "").trim() || null;
    }

    // Status ANTES, para provar que o UPDATE mirado não rebaixa.
    const { data: antesRow, error: antesError } = await supabase
      .from("propostas")
      .select("id_int, status_interno, id_transportadora_cliente")
      .eq("id_int", idInt)
      .maybeSingle();

    if (antesError) {
      console.error("[API][PropostaTransportadora] Falha ao ler a proposta:", antesError.message);
      return NextResponse.json(
        { success: false, message: "Não foi possível ler a proposta." },
        { status: 500 }
      );
    }
    if (!antesRow) {
      return NextResponse.json({ success: false, message: `Pedido #${idInt} não encontrado.` }, { status: 404 });
    }

    const statusAntes = String((antesRow as { status_interno?: string | null }).status_interno ?? "");

    // UMA coluna. Nada de cotacao_frete, modalidade ou valor.
    const { data: depoisRows, error: updateError } = await supabase
      .from("propostas")
      .update({ id_transportadora_cliente: idTransportadora })
      .eq("id_int", idInt)
      .select("id_int, status_interno, id_transportadora_cliente");

    if (updateError) {
      console.error("[API][PropostaTransportadora] Falha ao gravar:", updateError.message);
      return NextResponse.json(
        { success: false, message: `Não foi possível gravar a transportadora: ${updateError.message}` },
        { status: 500 }
      );
    }

    const depois = (depoisRows ?? [])[0] as
      | { status_interno?: string | null; id_transportadora_cliente?: number | null }
      | undefined;

    if (!depois) {
      return NextResponse.json(
        {
          success: false,
          message: "A gravação não afetou nenhuma linha. Confira suas permissões de escrita na proposta."
        },
        { status: 409 }
      );
    }

    const statusDepois = String(depois.status_interno ?? "");

    // Cinto e suspensório: a análise diz que nenhum trigger de `propostas`
    // escreve `status_interno`, mas quem garante é a medida, não a análise. Se
    // um dia algum passar a escrever, isto aparece na hora em vez de virar
    // pedido sumido do funil.
    if (statusAntes !== statusDepois) {
      console.error(
        `[API][PropostaTransportadora] REBAIXAMENTO DETECTADO no pedido ${idInt}: ` +
          `"${statusAntes}" -> "${statusDepois}". Algum trigger de propostas passou a escrever status_interno.`
      );
      return NextResponse.json(
        {
          success: false,
          code: "STATUS_ALTERADO",
          message:
            `A transportadora foi gravada, mas o status do pedido mudou de "${statusAntes}" para ` +
            `"${statusDepois}". Avise o time técnico antes de continuar.`,
          statusAntes,
          statusDepois
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      idInt,
      idTransportadoraCliente: depois.id_transportadora_cliente ?? null,
      transportadora: nomeTransportadora,
      statusInterno: statusDepois,
      canonizada: idTransportadoraBruto !== null && idTransportadoraBruto !== idTransportadora
    });
  } catch (err) {
    console.error("[API][PropostaTransportadora] Erro inesperado:", err);
    return NextResponse.json(
      { success: false, message: "Erro inesperado ao gravar a transportadora." },
      { status: 500 }
    );
  }
}
