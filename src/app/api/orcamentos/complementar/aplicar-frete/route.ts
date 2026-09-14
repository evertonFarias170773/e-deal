import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { resolverPesoExpedicao } from "@/features/expedicao/lib/peso";
import {
  cotarOpcoesFretePorEndereco,
  enderecoFreteDeCep,
  OPCAO_RETIRA_BALCAO
} from "@/features/maestro/core/agent/maestro-agent-frete.server";
import { STATUS_ACEITAM_PEDIDO_COMPLEMENTAR } from "@/features/orcamentos/services/orcamentos.service";

/**
 * Frete do PEDIDO COMPLEMENTAR — aplicação (etapa E6).
 *
 * Regra: docs/business/PEDIDO-COMPLEMENTAR.md (seções 6 e 7).
 * Plano: docs/superpowers/plans/2026-09-13-pedido-complementar.md (seção 5.2).
 *
 * O QUE FAZ
 *   Recebe a opção escolhida na tela, RECOTA no servidor, confere que o preço
 *   ainda é o mesmo e chama `complementar_aplicar_frete`, que grava o ledger, a
 *   cotação DO COMPLEMENTO e o `valor_frete` DO COMPLEMENTO numa transação só.
 *
 * POR QUE RECOTAR AQUI
 *   Frete é preço volátil: aplicar o número que a tela viu há dez minutos
 *   gravaria algo que já não existe. `valorVisto` serve só para comparar —
 *   mesma razão de `api/expedicao/recotacao/aplicar/route.ts`.
 *
 * O QUE NÃO FAZ
 *   Não toca `cotacao_frete` nem `propostas` do PRINCIPAL — quem escreve é a
 *   RPC, e só no complemento. Não mexe em cobrança, Conta Corrente, NF-e nem
 *   Expedição. O chat é best-effort e FORA da transação: falhar ali não desfaz
 *   a aplicação.
 *
 * IDEMPOTÊNCIA
 *   A `chave` nasce por opção na rota de cotar. Repetir a mesma chave devolve o
 *   mesmo `idLedger` sem gravar de novo — a checagem aqui responde rápido, e a
 *   da RPC é a que vale (o `unique(chave)` é a rede para corrida).
 *
 * GATES — os mesmos de cotar, mais o status do complemento; todos revalidados
 * dentro da RPC, sob `FOR UPDATE`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Corpo = {
  idIntComplemento?: number;
  chave?: string;
  opcaoId?: string;
  valorVisto?: number;
};

type LinhaProposta = {
  id_int: number;
  id_cliente: number | string | null;
  id_int_pedido_principal: number | string | null;
  is_avulso: boolean | null;
  status_interno: string | null;
  modalidade_frete: string | null;
  valor_frete: number | string | null;
  frete_escolhido: string | null;
  id_endereco_ent: string | null;
  cep: string | null;
};

const COLUNAS_PROPOSTA =
  "id_int, id_cliente, id_int_pedido_principal, is_avulso, status_interno, modalidade_frete, valor_frete, frete_escolhido, id_endereco_ent, cep";

/** Status do COMPLEMENTO em que o frete complementar pode ser gravado. */
const STATUS_COMPLEMENTO_ACEITAM_FRETE = ["NOVO", "AGUARDANDO"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function recusa(code: string, message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, code, message, ...(extra ?? {}) }, { status });
}

function somar(linhas: Array<Record<string, unknown>> | null, coluna: string) {
  return (linhas ?? [])
    .filter((linha) => String(linha.status_item ?? "PENDENTE") !== "CANCELADO")
    .reduce((soma, linha) => soma + (Number(linha[coluna]) || 0), 0);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Corpo | null;
  const idIntComplemento = Number(body?.idIntComplemento);
  const chave = String(body?.chave ?? "").trim();
  const opcaoId = String(body?.opcaoId ?? "").trim();
  const valorVisto = Number(body?.valorVisto);

  if (!Number.isInteger(idIntComplemento) || idIntComplemento <= 0) {
    return recusa("PAYLOAD_INVALIDO", "idIntComplemento inválido.", 400);
  }
  if (!UUID_RE.test(chave)) {
    return recusa("PAYLOAD_INVALIDO", "chave de idempotência inválida.", 400);
  }
  if (!opcaoId) {
    return recusa("PAYLOAD_INVALIDO", "opcaoId é obrigatório.", 400);
  }
  if (!Number.isFinite(valorVisto) || valorVisto < 0) {
    return recusa("PAYLOAD_INVALIDO", "valorVisto inválido.", 400);
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
    return recusa("SESSAO", "Sessão expirada.", 401);
  }
  const temPermissao = await verificarPermissaoServerSide(
    supabase,
    authData.user.id,
    "propostas.complementar"
  );
  if (!temPermissao) {
    return recusa("PERM", "Sem permissão para aplicar frete complementar (propostas.complementar).", 403);
  }

  // ── Idempotência: a chave já aplicada devolve o que já existe ─────────────
  const { data: jaAplicado } = await supabase
    .from("complementos_frete")
    .select("id, frete_cobrado_complemento, diferenca, frete_total_cotado, transportadora, servico, prazo")
    .eq("chave", chave)
    .maybeSingle();
  if (jaAplicado) {
    return NextResponse.json({
      success: true,
      idempotente: true,
      idLedger: jaAplicado.id,
      valorACobrar: Number(jaAplicado.frete_cobrado_complemento),
      diferenca: Number(jaAplicado.diferenca),
      valorTotalCotado: Number(jaAplicado.frete_total_cotado),
      transportadora: jaAplicado.transportadora,
      servico: jaAplicado.servico,
      prazo: jaAplicado.prazo
    });
  }

  // ── Complemento ───────────────────────────────────────────────────────────
  const { data: complementoRow } = await supabase
    .from("propostas")
    .select(COLUNAS_PROPOSTA)
    .eq("id_int", idIntComplemento)
    .maybeSingle();
  const complemento = complementoRow as LinhaProposta | null;
  if (!complemento) {
    return recusa("NAO_ENCONTRADO", `Proposta #${idIntComplemento} não encontrada.`, 404);
  }

  const idIntPrincipal =
    complemento.id_int_pedido_principal !== null && complemento.id_int_pedido_principal !== undefined
      ? Number(complemento.id_int_pedido_principal)
      : null;
  if (idIntPrincipal === null || !Number.isFinite(idIntPrincipal)) {
    return recusa(
      "NAO_E_COMPLEMENTO",
      `A proposta #${idIntComplemento} não é um pedido complementar.`,
      409
    );
  }
  if (complemento.is_avulso === true) {
    return recusa("COMPLEMENTO_AVULSO", `A proposta #${idIntComplemento} é avulsa.`, 409);
  }
  if (String(complemento.modalidade_frete ?? "").trim().toUpperCase() !== "CIF") {
    return recusa(
      "SEM_FRETE_A_COTAR",
      `O pedido #${idIntComplemento} está em ${complemento.modalidade_frete ?? "modalidade não declarada"} — só CIF cobra frete.`,
      409
    );
  }
  if (
    !STATUS_COMPLEMENTO_ACEITAM_FRETE.includes(
      String(complemento.status_interno ?? "").trim().toUpperCase()
    )
  ) {
    return recusa(
      "COMPLEMENTO_STATUS",
      `O frete complementar só entra em NOVO ou AGUARDANDO; o pedido #${idIntComplemento} está em "${complemento.status_interno ?? "(sem status)"}".`,
      409
    );
  }

  // ── Principal ─────────────────────────────────────────────────────────────
  const { data: principalRow } = await supabase
    .from("propostas")
    .select(COLUNAS_PROPOSTA)
    .eq("id_int", idIntPrincipal)
    .maybeSingle();
  const principal = principalRow as LinhaProposta | null;
  if (!principal) {
    return recusa("NAO_ENCONTRADO", `Pedido principal #${idIntPrincipal} não encontrado.`, 404);
  }
  const statusPrincipal = String(principal.status_interno ?? "").trim().toUpperCase();
  if (!STATUS_ACEITAM_PEDIDO_COMPLEMENTAR.includes(statusPrincipal)) {
    return recusa(
      "ORIGINAL_EXPEDIDO",
      `O pedido #${idIntPrincipal} está em "${principal.status_interno ?? "(sem status)"}" — o frete complementar só vale entre LIBERADO e EXPEDICAO.`,
      409
    );
  }

  const { data: expedicaoPrincipal } = await supabase
    .from("expedicoes")
    .select("peso_kg, peso_bruto_kg, data_despacho")
    .eq("id_int", idIntPrincipal)
    .maybeSingle();
  if (expedicaoPrincipal?.data_despacho) {
    return recusa(
      "ORIGINAL_EXPEDIDO",
      `O pedido #${idIntPrincipal} já tem despacho registrado.`,
      409
    );
  }
  if ((complemento.id_endereco_ent ?? null) !== (principal.id_endereco_ent ?? null)) {
    return recusa(
      "ENDERECO_DIVERGENTE",
      `O endereço de entrega do #${idIntComplemento} não é o do #${idIntPrincipal}.`,
      409
    );
  }

  // ── Pesos e subtotais ─────────────────────────────────────────────────────
  const [{ data: itensPrincipal }, { data: itensComplemento }, { data: cotacaoPrincipal }] = await Promise.all([
    supabase
      .from("produtos_proposta")
      .select("valor_sub_total, peso_total, status_item")
      .eq("id_int", idIntPrincipal),
    supabase
      .from("produtos_proposta")
      .select("valor_sub_total, peso_total, status_item")
      .eq("id_int", idIntComplemento),
    // SÓ O PESO, e só de leitura: terceiro degrau da precedência única.
    supabase
      .from("cotacao_frete")
      .select("peso")
      .eq("id_int", idIntPrincipal)
      .eq("escolhido", true)
      .limit(1)
      .maybeSingle()
  ]);

  const { pesoKg: pesoPrincipalKg, origem: pesoOrigemOriginal } = resolverPesoExpedicao({
    pesoAferidoKg: expedicaoPrincipal?.peso_kg,
    pesoBrutoKg: expedicaoPrincipal?.peso_bruto_kg,
    pesoCotadoGramas: cotacaoPrincipal?.peso,
    pesoTeoricoGramas: somar(itensPrincipal, "peso_total")
  });
  const pesoOriginalGramas = pesoPrincipalKg !== null ? Math.round(pesoPrincipalKg * 1000) : 0;
  if (pesoOriginalGramas <= 0) {
    return recusa("SEM_PESO", `O pedido #${idIntPrincipal} não tem peso utilizável.`, 422);
  }

  const pesoComplementoGramas = Math.round(somar(itensComplemento, "peso_total"));
  if (pesoComplementoGramas <= 0) {
    return recusa(
      "SEM_PESO",
      `O pedido #${idIntComplemento} não tem item com peso — inclua os produtos antes.`,
      422
    );
  }
  const pesoSomadoGramas = pesoOriginalGramas + pesoComplementoGramas;

  const subtotalOriginal = Number(somar(itensPrincipal, "valor_sub_total").toFixed(2));
  const subtotalComplemento = Number(somar(itensComplemento, "valor_sub_total").toFixed(2));
  const valorDeclarado = Number((subtotalOriginal + subtotalComplemento).toFixed(2));

  // ── Endereço do principal ─────────────────────────────────────────────────
  const colunasEndereco = "id, endereco, numero, complemento, bairro, cidade, uf, cep";
  let endereco: {
    id: string;
    cep: string;
    cidade: string;
    uf: string;
    bairro: string;
    enderecoFull: string;
  } | null = null;

  if (principal.id_endereco_ent) {
    const { data: linhaEndereco } = await supabase
      .from("enderecos")
      .select(colunasEndereco)
      .eq("id", principal.id_endereco_ent)
      .maybeSingle();
    if (linhaEndereco?.cep) {
      endereco = {
        id: String(linhaEndereco.id ?? ""),
        cep: String(linhaEndereco.cep),
        cidade: String(linhaEndereco.cidade ?? ""),
        uf: String(linhaEndereco.uf ?? ""),
        bairro: String(linhaEndereco.bairro ?? ""),
        enderecoFull: [
          linhaEndereco.endereco,
          linhaEndereco.numero,
          linhaEndereco.bairro,
          linhaEndereco.cidade,
          linhaEndereco.uf
        ]
          .filter(Boolean)
          .join(", ")
      };
    }
  }
  if (!endereco) {
    const cepProposta = String(principal.cep ?? "").replace(/\D/g, "");
    if (cepProposta.length === 8) {
      const resolvido = await enderecoFreteDeCep(cepProposta);
      if (resolvido.endereco) endereco = resolvido.endereco;
    }
  }
  if (!endereco) {
    return recusa(
      "SEM_ENDERECO",
      `O pedido #${idIntPrincipal} não tem endereço de entrega com CEP utilizável.`,
      422
    );
  }

  // ── Recotação no servidor, e a conferência do preço ───────────────────────
  const cotacao = await cotarOpcoesFretePorEndereco(endereco, {
    pesoGramas: pesoSomadoGramas,
    valorTotal: valorDeclarado
  });
  const opcao = cotacao.opcoes.find((o) => o.id === opcaoId && o.id !== OPCAO_RETIRA_BALCAO.id);
  if (!opcao) {
    return recusa(
      "OPCAO_SUMIU",
      "A opção escolhida não apareceu na cotação de agora — cote e escolha de novo.",
      409
    );
  }
  if (Math.abs(opcao.valor - valorVisto) > 0.01) {
    return recusa(
      "PRECO_MUDOU",
      `O preço mudou desde a consulta: R$ ${opcao.valor.toFixed(2)} agora, R$ ${valorVisto.toFixed(2)} na sua tela. Cote de novo para confirmar.`,
      409,
      { valorAgora: Number(opcao.valor.toFixed(2)), valorVisto }
    );
  }

  const freteCobradoOriginal = Number(Number(principal.valor_frete ?? 0).toFixed(2));
  const valorTotalCotado = Number(opcao.valor.toFixed(2));
  const diferenca = Number((valorTotalCotado - freteCobradoOriginal).toFixed(2));
  const valorACobrar = Number(Math.max(0, diferenca).toFixed(2));

  // Autoria para o ledger e para a timeline.
  const { data: usuarioRow } = await supabase
    .from("usuarios")
    .select("nome_usuario")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  const autorNome = usuarioRow?.nome_usuario || authData.user.email || "Comercial";
  const autorEmail = authData.user.email ?? null;

  const { data: idLedger, error: rpcError } = await supabase.rpc("complementar_aplicar_frete", {
    p_id_int_complemento: idIntComplemento,
    p_chave: chave,
    p_peso_original_gramas: pesoOriginalGramas,
    p_peso_origem_original: pesoOrigemOriginal,
    p_peso_complemento_gramas: pesoComplementoGramas,
    p_frete_total_cotado: valorTotalCotado,
    p_frete_cobrado_original: freteCobradoOriginal,
    p_transportadora: opcao.transportadora,
    p_servico: opcao.servico || opcao.transportadora,
    p_prazo: opcao.prazo,
    p_cep: endereco.cep,
    p_id_endereco_entrega: endereco.id || null,
    p_subtotal_original: subtotalOriginal,
    p_subtotal_complemento: subtotalComplemento,
    p_opcoes_cotadas: cotacao.opcoes,
    p_autor_nome: autorNome,
    p_autor_email: autorEmail
  });

  if (rpcError) {
    // As mensagens da função já são escritas para serem lidas por gente.
    const bruto = rpcError.message || "Não foi possível aplicar o frete complementar.";
    const casamento = bruto.match(/^([A-Z_]+):\s*([\s\S]*)$/);
    const code = casamento ? casamento[1] : "ERRO";
    const message = casamento ? casamento[2] : bruto;
    if (code === "PERM") return recusa(code, message, 403);
    return recusa(code, message, /^COMPL_FRETE_/.test(code) ? 409 : 500);
  }

  // ── Chat nos dois lados: best-effort, fora da transação ───────────────────
  const idCliente = complemento.id_cliente !== null ? Number(complemento.id_cliente) : null;
  const rotuloOpcao = `${opcao.transportadora}${opcao.servico ? ` · ${opcao.servico}` : ""}`;
  const mensagemComplemento =
    `🚚 Frete complementar aplicado: ${rotuloOpcao} por R$ ${valorTotalCotado.toFixed(2)} no peso somado ` +
    `(${pesoOriginalGramas} g do #${idIntPrincipal} + ${pesoComplementoGramas} g deste pedido). ` +
    `O #${idIntPrincipal} já cobra R$ ${freteCobradoOriginal.toFixed(2)}, então aqui entra a diferença: ` +
    `R$ ${valorACobrar.toFixed(2)}.` +
    (diferenca < 0
      ? ` O frete somado ficou R$ ${Math.abs(diferenca).toFixed(2)} MAIS BARATO que o já cobrado: este pedido cobra zero e nada é creditado.`
      : "");
  const mensagemPrincipal =
    `🚚 Frete complementar do #${idIntComplemento} aplicado: ${rotuloOpcao} por R$ ${valorTotalCotado.toFixed(2)} ` +
    `no peso somado dos dois pedidos. Este pedido NÃO foi alterado — a diferença de R$ ${valorACobrar.toFixed(2)} ` +
    `está no #${idIntComplemento}.`;

  try {
    const { error: chatError } = await supabase.from("propostas_chat").insert([
      {
        id_int: idIntComplemento,
        id_cliente: idCliente,
        tipo: "SISTEMA",
        setor: "Comercial",
        autor_uid: authData.user.id,
        autor_nome: autorNome,
        autor_email: autorEmail,
        mensagem: mensagemComplemento
      },
      {
        id_int: idIntPrincipal,
        id_cliente: idCliente,
        tipo: "SISTEMA",
        setor: "Comercial",
        autor_uid: authData.user.id,
        autor_nome: autorNome,
        autor_email: autorEmail,
        mensagem: mensagemPrincipal
      }
    ]);
    if (chatError) console.warn("[complementar/aplicar-frete] Erro ao gravar na timeline:", chatError);
  } catch (e) {
    console.warn("[complementar/aplicar-frete] Exceção ao gravar na timeline:", e);
  }

  return NextResponse.json({
    success: true,
    idempotente: false,
    idLedger,
    idIntPrincipal,
    pesoOriginalGramas,
    pesoOrigemOriginal,
    pesoComplementoGramas,
    pesoSomadoGramas,
    freteCobradoOriginal,
    valorTotalCotado,
    diferenca,
    valorACobrar,
    transportadora: opcao.transportadora,
    servico: opcao.servico,
    prazo: opcao.prazo
  });
}
