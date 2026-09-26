import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { resolverPesoExpedicao } from "@/features/expedicao/lib/peso";
import { cotarOpcoesFretePorEndereco } from "@/features/maestro/core/agent/maestro-agent-frete.server";
import type { ModalidadeFrete } from "@/features/expedicao/types";

/**
 * Recotação de frete do despacho (Parte C, Etapa 1).
 *
 * DESDE 24/09/2026 cada recotação é REGISTRADA em
 * `expedicao_recotacao_consultas` — ver o bloco antes da resposta. O restante
 * abaixo continua valendo: nada do frete nem do total da proposta é gravado.
 *
 * O QUE FAZ
 *   Cota o frete de novo a partir dos dados reais do pedido (endereço de entrega,
 *   peso resolvido, subtotal dos itens) e devolve as opções com a diferença
 *   contra o que a proposta cobra hoje. É o que o expedidor precisa ver ANTES de
 *   trocar transportadora ou endereço na bancada.
 *
 * O QUE NÃO FAZ — e é o ponto desta etapa
 *   NADA é gravado. Nem `cotacao_frete` (escrever ali dispara
 *   `trg_recalc_after_frete` e `trg_frete_sync_financeiro`, que reescrevem
 *   `propostas.valor_total` e `status_interno` e tirariam o pedido do funil
 *   logístico — seção 2 de EXPEDICAO.md), nem `propostas.valor_frete`/
 *   `valor_total`, nem `expedicoes`, nem Conta Corrente. Gravar o valor e lançar
 *   a diferença são as Etapas 2 a 4.
 *
 * MOLDE
 *   `api/expedicao/correios/prepostagem/route.ts`: auth dual (Bearer para chamada
 *   programática, cookie para navegação), `expedicao.processar`, e a mesma
 *   cascata de endereço.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Unico cliente que escreve em `expedicao_recotacao_consultas` (RLS fecha para authenticated). */
function clienteServiceRole() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createSupabaseClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Alçada do expedidor, medida sobre o VALOR DO FRETE NOVO — não sobre a diferença. */
const ALCADA_EXPEDIDOR = 150;

type Corpo = { id_int?: number; id_endereco_entrega?: string | null };

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Corpo | null;
  const idInt = Number(body?.id_int);
  if (!Number.isInteger(idInt) || idInt <= 0) {
    return NextResponse.json({ success: false, message: "id_int inválido." }, { status: 400 });
  }
  const overrideEndereco = (body?.id_endereco_entrega || "").trim() || null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const supabase = token
    ? createSupabaseClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : await createServerSupabaseClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, message: "Sessão expirada." }, { status: 401 });
  }
  const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, "expedicao.processar");
  if (!temPermissao) {
    return NextResponse.json({ success: false, message: "Sem permissão (expedicao.processar)." }, { status: 403 });
  }

  const { data: proposta } = await supabase
    .from("propostas")
    .select("id_int, id_cliente, status_interno, valor_frete, modalidade_frete, cep")
    .eq("id_int", idInt)
    .maybeSingle();
  if (!proposta) {
    return NextResponse.json({ success: false, message: "Pedido não encontrado." }, { status: 404 });
  }

  const [{ data: exp }, { data: frete }, { data: itens }] = await Promise.all([
    supabase
      .from("expedicoes")
      .select("peso_kg, peso_bruto_kg, id_endereco_entrega, modalidade_frete")
      .eq("id_int", idInt)
      .maybeSingle(),
    // `cotacao_frete` é LIDA e só — peso cotado e CEP. Nenhuma escrita, nunca.
    supabase
      .from("cotacao_frete")
      .select("peso, cep")
      .eq("id_int", idInt)
      .eq("escolhido", true)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("produtos_proposta")
      .select("valor_sub_total, peso_total, status_item")
      .eq("id_int", idInt)
  ]);

  // Gates revalidados no servidor: a UI esconde o botão, mas quem decide é aqui.
  if (String(proposta.status_interno ?? "").trim() !== "EXPEDICAO") {
    return NextResponse.json(
      {
        success: false,
        message: `Recotação só no despacho: o pedido está em "${proposta.status_interno}", não em EXPEDICAO.`
      },
      { status: 409 }
    );
  }

  // Precedência da modalidade: despacho > orçamento. FOB não recota — o cliente
  // contrata e paga o transporte, e o frete da proposta já vale zero (decisão de
  // 18/08/2026). Sem modalidade declarada também não recota: não se inventa quem
  // paga a diferença.
  const modalidadeEfetiva =
    ((exp?.modalidade_frete as ModalidadeFrete | null) ??
      (proposta.modalidade_frete as ModalidadeFrete | null)) ?? null;
  if (modalidadeEfetiva !== "CIF") {
    return NextResponse.json(
      {
        success: false,
        message:
          modalidadeEfetiva === null
            ? "Pedido sem modalidade declarada — a recotação só vale em CIF."
            : `Recotação só em CIF; este pedido está em ${modalidadeEfetiva}.`
      },
      { status: 409 }
    );
  }

  // SEM LIBERACAO PARA RECOTAR (24/09/2026, decisao do dono). De 20/08 a
  // 24/09/2026 recotar exigia liberacao de admin. Com a trava do despacho
  // medindo a diferenca pela recotacao (ate R$ 4,00 so avisa), isso fazia todo
  // despacho com CEP ou transporte trocado passar por um admin. Agora o
  // expedidor recota sozinho; APLICAR a recotacao na proposta continua exigindo
  // a liberacao — conferida na rota `aplicar` e consumida em
  // `exp_aplicar_recotacao`, que nao mudaram.

  // Endereço: override da tela > escolhido no despacho > mesmo CEP da cotação >
  // mais recente do cliente. Mesma cascata da prepostagem.
  const idCliente = proposta.id_cliente !== null ? Number(proposta.id_cliente) : null;
  const colunas = "id, endereco, numero, complemento, bairro, cidade, uf, cep, data_criacao";
  let endereco: Record<string, unknown> | null = null;
  const idEnderecoAlvo = overrideEndereco ?? exp?.id_endereco_entrega ?? null;
  if (idEnderecoAlvo) {
    const { data } = await supabase.from("enderecos").select(colunas).eq("id", idEnderecoAlvo).maybeSingle();
    endereco = data;
  }
  if (!endereco && idCliente !== null) {
    const { data: lista } = await supabase
      .from("enderecos")
      .select(colunas)
      .eq("id_cliente", idCliente)
      .order("data_criacao", { ascending: false });
    const cepAlvo = String(frete?.cep ?? proposta.cep ?? "").replace(/\D/g, "");
    endereco =
      (cepAlvo && (lista ?? []).find((e) => String(e.cep ?? "").replace(/\D/g, "") === cepAlvo)) ||
      (lista ?? [])[0] ||
      null;
  }
  if (!endereco || !endereco.cep) {
    return NextResponse.json(
      { success: false, message: "Pedido sem endereço de entrega com CEP — selecione o endereço no modal Despachar." },
      { status: 422 }
    );
  }

  const ativos = (itens ?? []).filter((i) => String(i.status_item ?? "PENDENTE") !== "CANCELADO");

  // Precedência única de peso (lib/peso.ts): aferido > bruto da revisão > cotado
  // > teórico. SEM o fallback de 300 g da prepostagem: lá ele existe porque os
  // Correios recusam peso ausente; aqui, peso ausente virando cotação inventada é
  // pior que aviso — `cotarOpcoesFretePorEndereco` já devolve o aviso certo.
  const pesoTeoricoGramas = ativos.reduce((soma, i) => soma + (Number(i.peso_total) || 0), 0);
  const { pesoKg, origem: pesoOrigem } = resolverPesoExpedicao({
    pesoAferidoKg: exp?.peso_kg,
    pesoBrutoKg: exp?.peso_bruto_kg,
    pesoCotadoGramas: frete?.peso,
    pesoTeoricoGramas
  });
  const pesoGramas = pesoKg !== null ? Math.round(pesoKg * 1000) : 0;

  // SUBTOTAL DOS ITENS, nunca `propostas.valor_total`: o total já embute o frete
  // antigo, e `cotarOpcoesFretePorEndereco` soma `valorTotal + opcao.valor` para
  // montar o total com frete. Passar o total inflaria o valor declarado do seguro
  // e contaminaria a Azul Cargo e a VEPPO, que recebem esse número.
  const subtotalItens = Number(
    ativos.reduce((soma, i) => soma + (Number(i.valor_sub_total) || 0), 0).toFixed(2)
  );

  const cotacao = await cotarOpcoesFretePorEndereco(
    {
      id: String(endereco.id ?? ""),
      cep: String(endereco.cep),
      cidade: String(endereco.cidade ?? ""),
      uf: String(endereco.uf ?? ""),
      bairro: String(endereco.bairro ?? ""),
      enderecoFull: [endereco.endereco, endereco.numero, endereco.bairro, endereco.cidade, endereco.uf]
        .filter(Boolean)
        .join(", ")
    },
    { pesoGramas, valorTotal: subtotalItens, supabase }
  );

  const freteAtual = Number(proposta.valor_frete ?? 0);
  const opcoes = cotacao.opcoes.map((o) => ({
    id: o.id,
    transportadora: o.transportadora,
    servico: o.servico,
    valor: o.valor,
    prazo: o.prazo,
    diferenca: Number((o.valor - freteAtual).toFixed(2)),
    // Rótulo informativo nesta etapa — nada é gravado, então nada é bloqueado.
    // Vira gate de verdade quando a diferença passar a ir para a Conta Corrente.
    dentroDaAlcada: o.valor <= ALCADA_EXPEDIDOR
  }));

  // REGISTRO DA RECOTACAO (24/09/2026). E a fonte da trava do despacho: com CEP
  // ou transporte diferentes do cotado, o banco compara a opcao do transporte
  // escolhido com o frete da proposta (ate R$ 4,00 acima so avisa). Gravado com
  // service role porque authenticated NAO insere nessa tabela — senao qualquer
  // um forjaria uma recotacao barata para passar pela trava. Sem registro, a
  // recotacao nao vale para o despacho, e o expedidor precisa saber disso.
  const service = clienteServiceRole();
  const cepDigitos = String(endereco.cep).replace(/\D/g, "");
  const { data: usuarioRow } = await supabase
    .from("usuarios")
    .select("nome_usuario")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  const registro = service
    ? await service
        .from("expedicao_recotacao_consultas")
        .insert({
          id_int: idInt,
          autor_uid: authData.user.id,
          autor_nome: usuarioRow?.nome_usuario ?? authData.user.email ?? null,
          frete_proposta: Number(freteAtual.toFixed(2)),
          cep: cepDigitos,
          id_endereco_entrega: endereco.id ? String(endereco.id) : null,
          peso_gramas: pesoGramas,
          opcoes: opcoes.map((o) => ({
            id: o.id,
            transportadora: o.transportadora,
            servico: o.servico,
            valor: o.valor,
            prazo: o.prazo
          }))
        })
        .select("id")
        .single()
    : null;
  if (!registro || registro.error || !registro.data) {
    console.error("[recotacao/cotar] Falha ao registrar a recotacao:", registro?.error?.message ?? "service role ausente");
    return NextResponse.json(
      {
        success: false,
        message: "A recotação foi feita, mas não pôde ser registrada — e o despacho depende do registro. Tente de novo."
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    idConsulta: Number(registro.data.id),
    freteAtual,
    subtotalItens,
    pesoGramas,
    pesoOrigem,
    endereco: {
      rotulo: [endereco.endereco, endereco.numero, endereco.bairro].filter(Boolean).join(", "),
      cep: String(endereco.cep),
      cidade: String(endereco.cidade ?? ""),
      uf: String(endereco.uf ?? "")
    },
    opcoes,
    avisos: cotacao.avisos
  });
}
