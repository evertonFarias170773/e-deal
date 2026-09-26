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
 * Frete do PEDIDO COMPLEMENTAR — cotação, SOMENTE LEITURA (etapa E5).
 *
 * Regra: docs/business/PEDIDO-COMPLEMENTAR.md (seção 6).
 * Plano: docs/superpowers/plans/2026-09-13-pedido-complementar.md (seção 5.1).
 *
 * O QUE FAZ
 *   Cota o frete do PESO SOMADO — o peso do pedido principal mais o peso dos
 *   itens do complemento — para o endereço de entrega do principal, e devolve
 *   cada opção já comparada com o frete que o principal cobra hoje: a
 *   `diferenca` e o `valorACobrar` (a diferença, nunca negativa — frete somado
 *   menor que o já cobrado cobra zero, decisão 2 do dono).
 *
 * O QUE NÃO FAZ — e é o ponto desta etapa
 *   NADA é gravado. Nem `cotacao_frete` (de ninguém), nem `propostas`, nem o
 *   ledger `complementos_frete`. Quem grava é a rota de aplicar, na E6.
 *
 * O ORIGINAL É SÓ LIDO
 *   `cotacao_frete` do principal entra apenas com o `peso`, e apenas porque a
 *   precedência única de peso (`features/expedicao/lib/peso.ts`, decisão 12 do
 *   dono) tem o peso cotado como terceiro degrau: aferido > bruto da Revisão >
 *   cotado > teórico dos itens. É um SELECT de uma coluna: leitura não dispara
 *   trigger nenhum. O serviço do original sai de `propostas.frete_escolhido`,
 *   que já vem na mesma linha — nenhuma leitura extra por causa do rótulo.
 *
 * MOLDE
 *   `src/app/api/expedicao/recotacao/cotar/route.ts`: auth dual (Bearer para
 *   chamada programática, cookie para navegação), permissão conferida no
 *   servidor e a mesma cascata de endereço. As consultas correm com o cliente
 *   do PRÓPRIO usuário — nunca service role —, então o escopo por empresa e
 *   vendedor continua sendo o do RLS, como no resto do módulo.
 *
 * GATES (todos revalidados aqui; a tela esconde o botão, mas quem decide é o
 * servidor)
 *   401 sessão expirada · 403 sem `propostas.complementar`
 *   404 `NAO_ENCONTRADO` — complemento ou principal fora do alcance de leitura
 *   409 `NAO_E_COMPLEMENTO` — a proposta não tem pedido principal
 *   409 `COMPLEMENTO_AVULSO` — avulsa não tem itens para pesar
 *   409 `SEM_FRETE_A_COTAR` — modalidade diferente de CIF (RETIRA/FOB não
 *       cobram frete)
 *   409 `ORIGINAL_EXPEDIDO` — o principal saiu da faixa de status ou já tem
 *       despacho registrado
 *   409 `ENDERECO_DIVERGENTE` — complemento e principal com endereços
 *       diferentes (a caixa é uma só)
 *   422 `SEM_PESO` — complemento sem itens com peso
 *   422 `SEM_ENDERECO` — principal sem endereço e sem CEP utilizável
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Corpo = { idIntComplemento?: number };

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

function recusa(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, code, message }, { status });
}

function normalizar(texto: string) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Soma de uma coluna de `produtos_proposta`, ignorando item cancelado. */
function somar(linhas: Array<Record<string, unknown>> | null, coluna: string) {
  return (linhas ?? [])
    .filter((linha) => String(linha.status_item ?? "PENDENTE") !== "CANCELADO")
    .reduce((soma, linha) => soma + (Number(linha[coluna]) || 0), 0);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Corpo | null;
  const idIntComplemento = Number(body?.idIntComplemento);
  if (!Number.isInteger(idIntComplemento) || idIntComplemento <= 0) {
    return recusa("PAYLOAD_INVALIDO", "idIntComplemento inválido.", 400);
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
    return recusa("PERM", "Sem permissão para cotar frete complementar (propostas.complementar).", 403);
  }

  // ── 1. O complemento ──────────────────────────────────────────────────────
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
      `A proposta #${idIntComplemento} não é um pedido complementar: só complemento tem frete cobrado pela diferença.`,
      409
    );
  }
  if (complemento.is_avulso === true) {
    return recusa(
      "COMPLEMENTO_AVULSO",
      `A proposta #${idIntComplemento} é avulsa e não tem itens para pesar.`,
      409
    );
  }
  if (String(complemento.modalidade_frete ?? "").trim().toUpperCase() !== "CIF") {
    return recusa(
      "SEM_FRETE_A_COTAR",
      `O pedido #${idIntComplemento} está em ${complemento.modalidade_frete ?? "modalidade não declarada"} — só CIF cobra frete.`,
      409
    );
  }

  // ── 2. O principal ────────────────────────────────────────────────────────
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
      `O pedido #${idIntPrincipal} já tem despacho registrado — a caixa saiu, não há frete somado a cotar.`,
      409
    );
  }

  // A caixa é uma só: endereços diferentes não somam peso.
  if ((complemento.id_endereco_ent ?? null) !== (principal.id_endereco_ent ?? null)) {
    return recusa(
      "ENDERECO_DIVERGENTE",
      `O endereço de entrega do #${idIntComplemento} não é o do #${idIntPrincipal}: os dois precisam sair juntos, no mesmo endereço.`,
      409
    );
  }

  // ── 3. Pesos e subtotais ──────────────────────────────────────────────────
  const [{ data: itensPrincipal }, { data: itensComplemento }, { data: cotacaoPrincipal }] = await Promise.all([
    supabase
      .from("produtos_proposta")
      .select("valor_sub_total, peso_total, status_item")
      .eq("id_int", idIntPrincipal),
    supabase
      .from("produtos_proposta")
      .select("valor_sub_total, peso_total, status_item")
      .eq("id_int", idIntComplemento),
    // SÓ O PESO, e só de leitura: terceiro degrau da precedência de peso.
    supabase
      .from("cotacao_frete")
      .select("peso")
      .eq("id_int", idIntPrincipal)
      .eq("escolhido", true)
      .limit(1)
      .maybeSingle()
  ]);

  const pesoTeoricoPrincipal = somar(itensPrincipal, "peso_total");
  const { pesoKg: pesoPrincipalKg, origem: pesoOrigemOriginal } = resolverPesoExpedicao({
    pesoAferidoKg: expedicaoPrincipal?.peso_kg,
    pesoBrutoKg: expedicaoPrincipal?.peso_bruto_kg,
    pesoCotadoGramas: cotacaoPrincipal?.peso,
    pesoTeoricoGramas: pesoTeoricoPrincipal
  });
  const pesoOriginalGramas = pesoPrincipalKg !== null ? Math.round(pesoPrincipalKg * 1000) : 0;

  const pesoComplementoGramas = Math.round(somar(itensComplemento, "peso_total"));
  if (pesoComplementoGramas <= 0) {
    return recusa(
      "SEM_PESO",
      `O pedido #${idIntComplemento} não tem item com peso — inclua os produtos antes de cotar o frete complementar.`,
      422
    );
  }
  const pesoSomadoGramas = pesoOriginalGramas + pesoComplementoGramas;

  // Valor declarado do seguro: subtotal dos DOIS pedidos, nunca `valor_total`,
  // que já embute frete.
  const subtotalOriginal = Number(somar(itensPrincipal, "valor_sub_total").toFixed(2));
  const subtotalComplemento = Number(somar(itensComplemento, "valor_sub_total").toFixed(2));
  const valorDeclarado = Number((subtotalOriginal + subtotalComplemento).toFixed(2));

  // ── 4. Endereço de entrega do principal ───────────────────────────────────
  const colunasEndereco = "id, endereco, numero, complemento, bairro, cidade, uf, cep";
  let endereco: {
    id: string;
    cep: string;
    cidade: string;
    uf: string;
    bairro: string;
    enderecoFull: string;
  } | null = null;
  let rotuloEndereco = "";
  const avisosEndereco: string[] = [];

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
      rotuloEndereco = [linhaEndereco.endereco, linhaEndereco.numero, linhaEndereco.bairro]
        .filter(Boolean)
        .join(", ");
    }
  }

  if (!endereco) {
    // Sem endereço vinculado: o CEP gravado na proposta ainda cota SEDEX e Azul.
    const cepProposta = String(principal.cep ?? "").replace(/\D/g, "");
    if (cepProposta.length === 8) {
      const resolvido = await enderecoFreteDeCep(cepProposta);
      if (resolvido.endereco) {
        endereco = resolvido.endereco;
        rotuloEndereco = resolvido.endereco.enderecoFull;
        if (resolvido.mensagem) avisosEndereco.push(resolvido.mensagem);
      } else if (resolvido.mensagem) {
        avisosEndereco.push(resolvido.mensagem);
      }
    }
  }

  if (!endereco) {
    return recusa(
      "SEM_ENDERECO",
      `O pedido #${idIntPrincipal} não tem endereço de entrega com CEP utilizável.`,
      422
    );
  }

  // ── 5. Cotação do peso somado ─────────────────────────────────────────────
  const cotacao = await cotarOpcoesFretePorEndereco(endereco, {
    pesoGramas: pesoSomadoGramas,
    valorTotal: valorDeclarado,
    supabase
  });

  const freteCobradoOriginal = Number(Number(principal.valor_frete ?? 0).toFixed(2));
  const servicoOriginal = principal.frete_escolhido ?? null;
  const servicoOriginalNormalizado = normalizar(String(servicoOriginal ?? ""));

  // "Retira no Balcão" é opção de balcão, não de entrega: a caixa dos dois sai
  // pela mesma transportadora do principal, então ela não entra aqui.
  const opcoes = cotacao.opcoes
    .filter((opcao) => opcao.id !== OPCAO_RETIRA_BALCAO.id)
    .map((opcao) => {
      const valorTotalCotado = Number(opcao.valor.toFixed(2));
      const diferenca = Number((valorTotalCotado - freteCobradoOriginal).toFixed(2));
      const rotuloOpcao = normalizar(`${opcao.transportadora} ${opcao.servico}`);
      return {
        id: opcao.id,
        transportadora: opcao.transportadora,
        servico: opcao.servico,
        prazo: opcao.prazo,
        valorTotalCotado,
        freteCobradoOriginal,
        diferenca,
        // Frete somado MENOR que o já cobrado cobra zero: a diferença negativa
        // fica só no registro, e nada é creditado (decisão 2 do dono).
        valorACobrar: Number(Math.max(0, diferenca).toFixed(2)),
        mesmoServicoDoOriginal: Boolean(
          servicoOriginalNormalizado &&
            (rotuloOpcao.includes(servicoOriginalNormalizado) ||
              servicoOriginalNormalizado.includes(normalizar(opcao.transportadora)))
        ),
        // A chave nasce AQUI, uma por opção, quando a cotação chega — nunca no
        // clique. É ela que torna o aplicar idempotente na E6.
        chaveIdempotencia: crypto.randomUUID()
      };
    });

  return NextResponse.json({
    success: true,
    idIntComplemento,
    idIntPrincipal,
    pesoOriginalGramas,
    pesoOrigemOriginal,
    pesoComplementoGramas,
    pesoSomadoGramas,
    subtotalOriginal,
    subtotalComplemento,
    freteCobradoOriginal,
    servicoOriginal,
    endereco: {
      rotulo: rotuloEndereco,
      cep: endereco.cep,
      cidade: endereco.cidade,
      uf: endereco.uf
    },
    opcoes,
    avisos: [...avisosEndereco, ...cotacao.avisos]
  });
}
