import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { resolverPesoExpedicao } from "@/features/expedicao/lib/peso";
import { cotarOpcoesFretePorEndereco } from "@/features/maestro/core/agent/maestro-agent-frete.server";
import type { ModalidadeFrete } from "@/features/expedicao/types";

/**
 * Aplicar uma opção da recotação — Parte C, Etapa 2.
 *
 * O QUE FAZ
 *   Grava o frete recotado em `propostas.valor_frete`, move `propostas.valor_total`
 *   pelo delta do frete e registra a decisão inteira em `expedicao_recotacoes`.
 *   As três escritas acontecem dentro da RPC `exp_aplicar_recotacao`, numa
 *   transação só — o PostgREST não tem transação multi-statement, e três
 *   chamadas soltas deixariam janelas com frete novo e total velho.
 *
 * O QUE NÃO FAZ
 *   Nada em `cotacao_frete` (os três triggers dela reescrevem `valor_total` e
 *   `status_interno` — seção 2 de EXPEDICAO.md) e NADA na Conta Corrente: a
 *   diferença é registrada, não lançada. Isso é Etapa 3 em diante.
 *
 * POR QUE `valor_total` ANDA PELO DELTA, E NÃO PELO TOTAL SOBERANO
 *   `cc__total_soberano_proposta` ignora o desconto de tabela especial do
 *   cliente (ver CONTA-CORRENTE-CREDITO.md §4.2, item 13): gravar o retorno dela
 *   mudaria o total por muito mais que o frete em 21 das 28 propostas
 *   divergentes. Escrever pelo delta é seguro porque a função é LINEAR no frete,
 *   com coeficiente 1 — o frete entra como parcela aditiva e não interage com
 *   desconto nenhum. A linha exata é o `RETURN GREATEST(0, round(v_subtotal +
 *   v_frete - v_desconto, 2))` no corpo de `cc__total_soberano_proposta`; quem
 *   editar aquela função precisa saber que esta rota depende disso.
 *   A RPC mede o total soberano antes e depois e ABORTA se a linearidade cair
 *   (`EXP_RECOT_NAO_LINEAR`), para a premissa nunca falhar em silêncio.
 *
 * IDEMPOTÊNCIA
 *   `chave` (uuid) nasce na tela, uma por opção, quando o resultado da cotação
 *   chega — nunca no clique. Quem decide é o banco: `unique(chave)` no ledger,
 *   verificado no começo da RPC. Repetir a mesma chave devolve o registro
 *   anterior sem gravar nada.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Corpo = {
  id_int?: number;
  chave?: string;
  opcao_id?: string;
  valor_visto?: number;
  id_endereco_entrega?: string | null;
};

function erro(message: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, message, ...extra }, { status });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Corpo | null;
  const idInt = Number(body?.id_int);
  const chave = (body?.chave || "").trim();
  const opcaoId = (body?.opcao_id || "").trim();
  const valorVisto = Number(body?.valor_visto);

  if (!Number.isInteger(idInt) || idInt <= 0) return erro("id_int inválido.", 400);
  if (!UUID_RE.test(chave)) return erro("chave de idempotência inválida.", 400);
  if (!opcaoId) return erro("opcao_id é obrigatório.", 400);
  if (!Number.isFinite(valorVisto) || valorVisto < 0) return erro("valor_visto inválido.", 400);

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
  if (authError || !authData.user) return erro("Sessão expirada.", 401);

  const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, "expedicao.processar");
  if (!temPermissao) return erro("Sem permissão (expedicao.processar).", 403);

  // ── Idempotência antes de qualquer gate de negócio ────────────────────────
  // Mesma ordem de `usar-credito`: a operação já aconteceu, e o estado atual
  // pode reprovar num gate que ela mesma mudou. A RPC repete a checagem sob
  // transação; esta aqui evita recotar à toa.
  const { data: jaAplicado } = await supabase
    .from("expedicao_recotacoes")
    .select("id, frete_anterior, frete_novo, diferenca, total_anterior, total_novo, transportadora, servico, prazo")
    .eq("chave", chave)
    .maybeSingle();
  if (jaAplicado) {
    return NextResponse.json({ success: true, idempotente: true, aplicacao: jaAplicado });
  }

  const { data: proposta } = await supabase
    .from("propostas")
    .select("id_int, id_cliente, status_interno, valor_frete, valor_total, modalidade_frete, is_avulso, cep")
    .eq("id_int", idInt)
    .maybeSingle();
  if (!proposta) return erro("Pedido não encontrado.", 404);

  const [{ data: exp }, { data: frete }, { data: itens }, { data: notas }] = await Promise.all([
    supabase
      .from("expedicoes")
      .select("peso_kg, peso_bruto_kg, id_endereco_entrega, modalidade_frete, data_despacho, data_entrega, codigo_rastreamento, correios_id_prepostagem")
      .eq("id_int", idInt)
      .maybeSingle(),
    // `cotacao_frete` é LIDA e só — peso cotado e CEP. Nenhuma escrita, nunca.
    supabase.from("cotacao_frete").select("peso, cep").eq("id_int", idInt).eq("escolhido", true).limit(1).maybeSingle(),
    supabase.from("produtos_proposta").select("valor_sub_total, peso_total, status_item").eq("id_int", idInt),
    supabase.from("notas_fiscais").select("id").eq("id_int", idInt).eq("status", "AUTORIZADA").limit(1)
  ]);

  // ── Gates. A RPC revalida todos contra o banco, sob transação; aqui eles
  // existem para o expedidor receber uma mensagem que se lê, e para não gastar
  // uma cotação de rede num pedido que já vai ser recusado.
  if (proposta.is_avulso) {
    return erro("Proposta avulsa não entra na recotação.", 409);
  }
  if (String(proposta.status_interno ?? "").trim() !== "EXPEDICAO") {
    return erro(`Recotação só no despacho: o pedido está em "${proposta.status_interno}", não em EXPEDICAO.`, 409);
  }

  const modalidadeEfetiva =
    ((exp?.modalidade_frete as ModalidadeFrete | null) ?? (proposta.modalidade_frete as ModalidadeFrete | null)) ?? null;
  if (modalidadeEfetiva !== "CIF") {
    return erro(
      modalidadeEfetiva === null
        ? "Pedido sem modalidade declarada — a recotação só vale em CIF."
        : `Recotação só em CIF; este pedido está em ${modalidadeEfetiva}.`,
      409
    );
  }

  const { data: pagoRpc, error: pagoError } = await supabase.rpc("cc__valor_pago", { p_id_int: idInt });
  if (pagoError) return erro("Não foi possível confirmar o pagamento do pedido.", 500);
  const valorPago = Number(pagoRpc ?? 0);
  if (!(valorPago > 0)) {
    return erro("Pedido sem pagamento confirmado — a recotação só se aplica depois de pago.", 409);
  }

  // Entregue não recota, e despachado só recota se nada foi emitido: com
  // rastreio ou prepostagem o frete já foi contratado (nos Correios a
  // prepostagem já consumiu o cartão da empresa), e recotar passaria a oferecer
  // transportadora que não vai levar nada.
  if (exp?.data_entrega) return erro("Pedido já entregue — não há frete a recotar.", 409);
  const emitido = exp?.codigo_rastreamento || exp?.correios_id_prepostagem || null;
  if (exp?.data_despacho && emitido) {
    return erro(`Pedido já despachado com rastreio/prepostagem emitidos (${emitido}) — o frete já foi contratado.`, 409);
  }

  // Liberação: pré-checada aqui para responder 403 com mensagem que se lê, e
  // CONSUMIDA dentro da RPC, na mesma transação das escritas. A pré-checagem
  // não é a tranca — duas aplicações simultâneas passariam por ela; quem as
  // separa é o `UPDATE ... WHERE consumida_em IS NULL RETURNING` lá dentro.
  const { data: liberacao } = await supabase
    .from("expedicao_recotacao_liberacoes")
    .select("id")
    .eq("id_int", idInt)
    .is("consumida_em", null)
    .is("revogada_em", null)
    .maybeSingle();
  if (!liberacao) {
    return erro(
      "Recotação bloqueada: peça a um administrador para liberar este pedido no menu Ações da Expedição.",
      403
    );
  }

  const temNfeAutorizada = (notas ?? []).length > 0;

  // ── Endereço: override da tela > escolhido no despacho > mesmo CEP da
  // cotação > mais recente do cliente. Mesma cascata da Etapa 1.
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
      (cepAlvo && (lista ?? []).find((e) => String(e.cep ?? "").replace(/\D/g, "") === cepAlvo)) || (lista ?? [])[0] || null;
  }
  if (!endereco || !endereco.cep) {
    return erro("Pedido sem endereço de entrega com CEP — selecione o endereço no modal Despachar.", 422);
  }

  const ativos = (itens ?? []).filter((i) => String(i.status_item ?? "PENDENTE") !== "CANCELADO");
  const pesoTeoricoGramas = ativos.reduce((soma, i) => soma + (Number(i.peso_total) || 0), 0);
  const { pesoKg, origem: pesoOrigem } = resolverPesoExpedicao({
    pesoAferidoKg: exp?.peso_kg,
    pesoBrutoKg: exp?.peso_bruto_kg,
    pesoCotadoGramas: frete?.peso,
    pesoTeoricoGramas
  });
  const pesoGramas = pesoKg !== null ? Math.round(pesoKg * 1000) : 0;

  // SUBTOTAL DOS ITENS, nunca `valor_total`: o total já embute o frete antigo, e
  // `cotarOpcoesFretePorEndereco` soma `valorTotal + opcao.valor`. Passar o
  // total inflaria o valor declarado do seguro na Azul Cargo e na VEPPO.
  const subtotalItens = Number(ativos.reduce((soma, i) => soma + (Number(i.valor_sub_total) || 0), 0).toFixed(2));

  // ── Recota no servidor. O valor que a tela mostrou não é confiável: frete é
  // preço volátil, e aplicar o número de dez minutos atrás gravaria algo que já
  // não existe. `valor_visto` serve só para comparar.
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
    { pesoGramas, valorTotal: subtotalItens }
  );

  const opcao = cotacao.opcoes.find((o) => o.id === opcaoId);
  if (!opcao) {
    return erro("A opção escolhida não apareceu na cotação de agora — recote e escolha de novo.", 409);
  }
  if (Math.abs(opcao.valor - valorVisto) > 0.01) {
    return erro(
      `O preço mudou desde a consulta: R$ ${opcao.valor.toFixed(2)} agora, R$ ${valorVisto.toFixed(2)} na sua tela. Recote para confirmar.`,
      409,
      { valorAgora: opcao.valor, valorVisto }
    );
  }

  const freteAnterior = Number(proposta.valor_frete ?? 0);
  const totalAnterior = Number(proposta.valor_total ?? 0);
  const diferenca = Number((opcao.valor - freteAnterior).toFixed(2));

  if (diferenca > 0) {
    return erro(
      `Esta opção encarece o frete em R$ ${diferenca.toFixed(2)}. Nesta fase só é possível aplicar o que barateia ou empata.`,
      409
    );
  }
  if (temNfeAutorizada && diferenca >= 0) {
    return erro("Com NF-e autorizada só é possível aplicar recotação que barateia o frete.", 409);
  }

  // Autoria para o ledger e para a timeline.
  const { data: usuarioRow } = await supabase
    .from("usuarios")
    .select("nome_usuario")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  const autorNome = usuarioRow?.nome_usuario || authData.user.email || "Expedição";
  const autorEmail = authData.user.email ?? null;

  const { data: idLedger, error: rpcError } = await supabase.rpc("exp_aplicar_recotacao", {
    p_id_int: idInt,
    p_chave: chave,
    p_frete_anterior: freteAnterior,
    p_frete_novo: opcao.valor,
    p_total_anterior: totalAnterior,
    p_transportadora: opcao.transportadora,
    p_servico: opcao.servico,
    p_prazo: opcao.prazo,
    p_peso_gramas: pesoGramas,
    p_peso_origem: pesoOrigem,
    p_subtotal_itens: subtotalItens,
    p_id_endereco_entrega: String(endereco.id ?? "") || null,
    p_cep: String(endereco.cep),
    p_modalidade: modalidadeEfetiva,
    p_opcoes_cotadas: cotacao.opcoes,
    p_autor_nome: autorNome,
    p_autor_email: autorEmail,
    p_observacao: null
  });

  if (rpcError) {
    // As mensagens da RPC já são escritas para serem lidas por gente.
    const msg = rpcError.message || "Não foi possível aplicar a recotação.";
    const limpo = msg.replace(/^.*?EXP_RECOT_[A-Z_]+:\s*/, "");
    // Falta de liberação é autorização, não conflito de estado — e pode ter
    // sido revogada entre a pré-checagem e a RPC.
    if (/EXP_RECOT_SEM_LIBERACAO/.test(msg)) return erro(limpo, 403);
    return erro(limpo, /EXP_RECOT_/.test(msg) ? 409 : 500);
  }

  const totalNovo = Number((totalAnterior + diferenca).toFixed(2));

  // Timeline: best-effort e FORA da transação. Falhar aqui não desfaz a
  // aplicação — mesmo tratamento de `pagamentos-v2.service.ts`.
  try {
    const sinal = diferenca < 0 ? "−" : "";
    const { error: chatError } = await supabase.from("propostas_chat").insert([
      {
        id_int: idInt,
        id_cliente: idCliente,
        tipo: "SISTEMA",
        setor: "EXPEDICAO",
        autor_uid: authData.user.id,
        autor_nome: autorNome,
        autor_email: autorEmail,
        mensagem:
          `🚚 Frete recotado na Expedição: ${opcao.transportadora}${opcao.servico ? ` · ${opcao.servico}` : ""} ` +
          `por R$ ${opcao.valor.toFixed(2)} no lugar de R$ ${freteAnterior.toFixed(2)} ` +
          `(${sinal}R$ ${Math.abs(diferenca).toFixed(2)}). ` +
          `Total do pedido: R$ ${totalAnterior.toFixed(2)} → R$ ${totalNovo.toFixed(2)}. ` +
          `A diferença ainda NÃO foi lançada na conta do cliente. ` +
          `A liberação de recotação deste pedido foi consumida.`
      }
    ]);
    if (chatError) console.warn("[recotacao/aplicar] Erro ao gravar na timeline:", chatError);
  } catch (e) {
    console.warn("[recotacao/aplicar] Exceção ao gravar na timeline:", e);
  }

  return NextResponse.json({
    success: true,
    idempotente: false,
    idLedger,
    freteAnterior,
    freteNovo: opcao.valor,
    diferenca,
    totalAnterior,
    totalNovo,
    transportadora: opcao.transportadora,
    servico: opcao.servico,
    prazo: opcao.prazo,
    // Passam a ser a referência de peso/CEP do despacho: `cotacao_frete` não
    // muda quando uma recotação é aplicada, então sem isto o bloqueio de
    // divergência nunca limparia.
    pesoGramas,
    cep: String(endereco.cep)
  });
}
