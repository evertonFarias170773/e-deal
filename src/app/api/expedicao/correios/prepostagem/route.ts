import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { resolverIdDestinatarioEtiqueta } from "@/features/expedicao/lib/destinatario-etiqueta";
import { criarPrepostagem, correiosConfigurado } from "@/lib/correios/cws";
import { resolverEmpresaRemetente } from "@/lib/correios/empresa-remetente";
import { resolverPesoExpedicao } from "@/features/expedicao/lib/peso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!correiosConfigurado()) {
    return NextResponse.json({ success: false, message: "Correios não configurados no servidor." }, { status: 503 });
  }
  const body = (await request.json().catch(() => null)) as { id_int?: number; servico?: string } | null;
  const idInt = Number(body?.id_int);
  const servico = body?.servico === "PAC" ? "PAC" : "SEDEX";
  if (!Number.isInteger(idInt) || idInt <= 0) {
    return NextResponse.json({ success: false, message: "id_int inválido." }, { status: 400 });
  }

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
  // Catálogo real de permissões usa "expedicao.processar" (não "expedicao.operar").
  const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, "expedicao.processar");
  if (!temPermissao) {
    return NextResponse.json({ success: false, message: "Sem permissão (expedicao.processar)." }, { status: 403 });
  }

  // Dados do pedido: mesmas fontes da etiqueta interna.
  const { data: proposta } = await supabase
    .from("propostas")
    .select("id_int, cliente, id_cliente, id_faturado, empresa, cep")
    .eq("id_int", idInt)
    .maybeSingle();
  if (!proposta) return NextResponse.json({ success: false, message: "Pedido não encontrado." }, { status: 404 });

  const [{ data: exp }, { data: frete }, { data: itensPedido }] = await Promise.all([
    supabase
      .from("expedicoes")
      .select(
        "peso_kg, peso_bruto_kg, id_endereco_entrega, id_cliente_destinatario_etiqueta, correios_id_prepostagem, correios_codigo_objeto, correios_id_prepostagem_anterior, prepostagem_cancelada_em"
      )
      .eq("id_int", idInt)
      .maybeSingle(),
    supabase
      .from("cotacao_frete")
      .select("peso, altura, largura, comprimento, cep")
      .eq("id_int", idInt)
      .eq("escolhido", true)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("produtos_proposta")
      .select("nome_produto, modelo_descri, qtd, valor_unt, valor_sub_total")
      .eq("id_int", idInt)
  ]);

  // Endereço do destinatário (o escolhido no despacho; senão por CEP; senão o mais novo)
  const idCliente = proposta.id_cliente !== null ? Number(proposta.id_cliente) : null;
  let endereco: Record<string, unknown> | null = null;
  if (exp?.id_endereco_entrega) {
    const { data } = await supabase
      .from("enderecos")
      .select("endereco, numero, complemento, bairro, cidade, uf, cep")
      .eq("id", exp.id_endereco_entrega)
      .maybeSingle();
    endereco = data;
  }
  if (!endereco && idCliente !== null) {
    const { data: lista } = await supabase
      .from("enderecos")
      .select("endereco, numero, complemento, bairro, cidade, uf, cep, data_criacao")
      .eq("id_cliente", idCliente)
      .order("data_criacao", { ascending: false });
    const cepAlvo = String(frete?.cep ?? proposta.cep ?? "").replace(/\D/g, "");
    endereco =
      (cepAlvo && (lista ?? []).find((e) => String(e.cep ?? "").replace(/\D/g, "") === cepAlvo)) ||
      (lista ?? [])[0] ||
      null;
  }
  // TERCEIRA GERACAO E BLOQUEADA, e a checagem vem ANTES de falar com os
  // Correios — barrar depois criaria um objeto de verdade que nao teriamos onde
  // guardar. So ha espaco para UMA geracao anterior: sobrescreve-la apagaria o
  // rastro de um objeto emitido, que e pior que travar e exigir decisao humana.
  if (exp?.correios_id_prepostagem_anterior && exp?.correios_id_prepostagem) {
    return NextResponse.json(
      {
        success: false,
        message:
          `Este pedido ja teve duas prepostagens (${exp.correios_id_prepostagem_anterior} e ${exp.correios_id_prepostagem}). ` +
          "Uma terceira apagaria o registro da anterior — resolva o caso com a Expedicao antes de gerar outra."
      },
      { status: 409 }
    );
  }

  if (!endereco || !endereco.cep) {
    return NextResponse.json(
      { success: false, message: "Pedido sem endereço de entrega com CEP — selecione o endereço no modal Despachar." },
      { status: 422 }
    );
  }

  /**
   * Destinatario escolhido no despacho (24/08/2026). Mesma resolucao da etiqueta
   * 10x15, pela mesma funcao: id que nao seja o cliente nem o pagador cai no
   * cliente da proposta.
   *
   * SO VALE ANTES DA PREPOSTAGEM. Depois que o objeto e criado, o nome congela do
   * lado dos Correios — trocar a escolha aqui nao altera objeto ja emitido.
   */
  const idDestinatario = resolverIdDestinatarioEtiqueta(
    idCliente,
    proposta.id_faturado !== null && proposta.id_faturado !== undefined ? Number(proposta.id_faturado) : null,
    exp?.id_cliente_destinatario_etiqueta as number | null | undefined
  );

  // O cadastro lido e o do DESTINATARIO — nome e telefone tem de sair do mesmo
  // lugar. Buscar pelo cliente e usar o nome do pagador misturaria os dois.
  const { data: cliente } = idDestinatario !== null
    ? await supabase
        .from("clientes")
        .select("nome, fantasia, whatsapp_1, telefone_fixo")
        .eq("id_cliente", idDestinatario)
        .maybeSingle()
    : { data: null };

  // Remetente: empresa do pedido em public.empresas (fallback: primeira linha).
  const nomeEmpresa = String(proposta.empresa ?? "").trim();
  const empresaRow = await resolverEmpresaRemetente(supabase, nomeEmpresa);
  if (!empresaRow?.cnpj || !empresaRow?.cep) {
    return NextResponse.json(
      { success: false, message: "Cadastro da empresa remetente sem CNPJ/CEP em public.empresas." },
      { status: 422 }
    );
  }
  // Cada empresa posta no próprio contrato: sem credencial cadastrada, recusa
  // aqui em vez de emitir no cartão de outra e faturar no CNPJ errado.
  if (!correiosConfigurado(empresaRow.id)) {
    return NextResponse.json(
      {
        success: false,
        message: `Empresa "${empresaRow.nome_fantasia || empresaRow.razao_social || nomeEmpresa}" sem credencial dos Correios configurada (CORREIOS_${empresaRow.id}_*).`
      },
      { status: 503 }
    );
  }

  // Precedência única (lib/peso.ts): aferido > bruto da revisão > cotado.
  // Fallback final de 300 g preservado: os Correios recusam peso ausente.
  const { pesoKg: pesoResolvidoKg } = resolverPesoExpedicao({
    pesoAferidoKg: exp?.peso_kg,
    pesoBrutoKg: exp?.peso_bruto_kg,
    pesoCotadoGramas: frete?.peso
  });
  const pesoGramas = pesoResolvidoKg !== null ? pesoResolvidoKg * 1000 : 300;

  // Declaração de conteúdo com os itens reais do pedido. É o que substitui a
  // nota quando a remessa vai sem NF-e autorizada — caso comum aqui, o próprio
  // modal avisa e pede confirmação. Proposta avulsa não tem itens em
  // produtos_proposta; nesse caso o cws.ts cai no genérico.
  const itensDeclaracao = (itensPedido ?? [])
    .map((item) => {
      const nome = String(item.nome_produto ?? item.modelo_descri ?? "").trim();
      if (!nome) return null;
      const quantidade = Math.max(1, Number(item.qtd) || 1);
      const unitario = Number(item.valor_unt) || (Number(item.valor_sub_total) || 0) / quantidade;
      return {
        // Campo curto no rótulo dos Correios: nome longo truncado.
        conteudo: nome.slice(0, 60),
        quantidade: String(quantidade),
        valor: (Number.isFinite(unitario) ? unitario : 0).toFixed(2)
      };
    })
    .filter((item): item is { conteudo: string; quantidade: string; valor: string } => item !== null);

  try {
    const resultado = await criarPrepostagem({
      servico,
      idEmpresa: empresaRow.id,
      pesoGramas,
      // cotacao_frete.altura/largura/comprimento estão NULL em 100% das cotações
      // reais (nenhum fluxo grava); estas dimensões-padrão de caixa são o
      // comportamento efetivo. Ajuste consciente do dono se a cubagem passar a
      // importar.
      alturaCm: Number(frete?.altura) || 10,
      larguraCm: Number(frete?.largura) || 20,
      comprimentoCm: Number(frete?.comprimento) || 25,
      remetente: {
        nome: empresaRow.nome_fantasia || empresaRow.razao_social || nomeEmpresa,
        cnpj: empresaRow.cnpj,
        cep: empresaRow.cep,
        logradouro: empresaRow.logradouro || "",
        numero: empresaRow.numero || "S/N",
        complemento: empresaRow.complemento || "",
        bairro: empresaRow.bairro || "",
        cidade: empresaRow.municipio || "",
        uf: empresaRow.uf || "",
        telefone: empresaRow.telefone_nfe || ""
      },
      destinatario: {
        // Escolhido o pagador, o nome vem do cadastro dele: `proposta.cliente` e
        // o nome do cliente e imprimiria o destinatario errado na etiqueta.
        nome: String(
          idDestinatario === idCliente
            ? proposta.cliente || cliente?.nome || cliente?.fantasia || `Pedido ${idInt}`
            : cliente?.nome || cliente?.fantasia || `Pedido ${idInt}`
        ),
        cep: String(endereco.cep),
        logradouro: String(endereco.endereco ?? ""),
        numero: String(endereco.numero ?? "S/N"),
        complemento: String(endereco.complemento ?? ""),
        bairro: String(endereco.bairro ?? ""),
        cidade: String(endereco.cidade ?? ""),
        uf: String(endereco.uf ?? ""),
        telefone: String(cliente?.whatsapp_1 ?? cliente?.telefone_fixo ?? "")
      },
      itensDeclaracao
    });

    // Grava na expedição e espelha o rastreio na OS (tolerante a falha no espelho).
    // REGERACAO: a prepostagem que estava viva desce para as colunas _anterior
    // no MESMO upsert que grava a nova. Antes disto, gerar de novo sobrescrevia
    // `correios_id_prepostagem` e o objeto antigo sumia do banco sem deixar
    // rastro. `regerando` so e verdadeiro quando ja havia uma — a primeira
    // geracao de um pedido nao mexe nas colunas _anterior.
    const regerando = Boolean(exp?.correios_id_prepostagem);
    const { error: upErr } = await supabase.from("expedicoes").upsert(
      {
        id_int: idInt,
        correios_id_prepostagem: resultado.id,
        correios_codigo_objeto: resultado.codigoObjeto,
        codigo_rastreamento: resultado.codigoObjeto,
        ...(regerando
          ? {
              correios_id_prepostagem_anterior: exp?.correios_id_prepostagem ?? null,
              correios_codigo_objeto_anterior: exp?.correios_codigo_objeto ?? null,
              // A marcacao de cancelamento era sobre a prepostagem que acabou de
              // virar "anterior"; mante-la apontaria para a nova, que esta viva.
              prepostagem_cancelada_em: null,
              prepostagem_cancelada_por: null,
              prepostagem_cancelada_por_nome: null
            }
          : {}),
        tipo_frete: "CORREIOS",
        updated_at: new Date().toISOString()
      },
      { onConflict: "id_int" }
    );
    if (upErr) {
      return NextResponse.json(
        { success: false, message: `Prepostagem criada (${resultado.codigoObjeto}), mas falhou ao gravar no pedido: ${upErr.message}` },
        { status: 500 }
      );
    }
    const { error: osErr } = await supabase
      .from("propostas_os")
      .update({ codigo_rastreamento: resultado.codigoObjeto })
      .eq("id_int", idInt);
    if (osErr) console.warn("[correios/prepostagem] Falha ao espelhar rastreio na OS:", osErr);

    return NextResponse.json({ success: true, codigoObjeto: resultado.codigoObjeto });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro desconhecido nos Correios.";
    return NextResponse.json({ success: false, message }, { status: 502 });
  }
}
