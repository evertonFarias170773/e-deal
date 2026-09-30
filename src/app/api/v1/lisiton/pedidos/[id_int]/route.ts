import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { rateLimitCheck } from "@/lib/security/rate-limit-memory";
import { escolherEnderecoPrincipal } from "@/lib/fiscal/endereco-principal";
import { getClienteBonusPercent } from "@/features/orcamentos/orcamento-utils";
import { totaisDaProposta } from "@/features/orcamentos/lib/total-da-proposta";
import {
  TIPO_DESCONTO_TABELA_ESPECIAL,
  bonusDaProposta,
  percentualGravado
} from "@/features/orcamentos/lib/bonus-da-proposta";

/**
 * API da Lisiton — dados de UM pedido, para gerar a etiqueta no Melhor Envio.
 *
 *   GET /api/v1/lisiton/pedidos/{id_int}
 *   cabeçalho x-api-key: <LISITON_API_KEY>
 *
 * Documentação para quem integra: docs/api/lisiton-pedidos.md.
 *
 * SÓ LEITURA. Nenhuma escrita, nenhuma migration, nenhum grant: a leitura é
 * feita no servidor com o service role, e a porta é esta rota — chave,
 * limite por IP e o filtro do cliente.
 *
 * SÓ PEDIDOS DA LISITON (id_cliente 8469). Pedido de outro cliente e pedido que
 * não existe recebem a MESMA resposta 404, com o mesmo corpo: a API não pode
 * servir para descobrir se um número de pedido existe no Vibe.
 *
 * NADA SENSÍVEL NO LOG. A chave nunca é escrita, nem inteira nem em pedaço; o
 * IP não é escrito; nenhum dado do pedido é escrito. O log só diz o que falhou
 * no servidor, com o `id_int` — que é o que a própria Lisiton mandou.
 */

export const dynamic = "force-dynamic";

const ID_CLIENTE_LISITON = 8469;

/** Tentativas por IP: 30 por minuto. Cobre uso normal e trava força bruta na chave. */
const LIMITE_POR_IP = 30;
const JANELA_MS = 60_000;

const CABECALHOS = { "Cache-Control": "no-store" } as const;

const naoAutorizado = () =>
  NextResponse.json({ erro: "nao_autorizado", mensagem: "Chave de API ausente ou inválida." }, { status: 401, headers: CABECALHOS });

/** A MESMA resposta para pedido inexistente e para pedido de outro cliente. */
const naoEncontrado = () =>
  NextResponse.json({ erro: "nao_encontrado", mensagem: "Pedido não encontrado." }, { status: 404, headers: CABECALHOS });

const erroInterno = () =>
  NextResponse.json({ erro: "erro_interno", mensagem: "Não foi possível consultar o pedido agora." }, { status: 500, headers: CABECALHOS });

/**
 * Compara a chave em tempo constante. As duas passam por SHA-256 antes: o
 * `timingSafeEqual` exige tamanhos iguais, e comparar tamanhos direto revelaria
 * o comprimento da chave certa.
 */
function chaveConfere(recebida: string, esperada: string): boolean {
  const a = createHash("sha256").update(recebida, "utf8").digest();
  const b = createHash("sha256").update(esperada, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** Texto limpo, ou null. Nenhum campo sai como string vazia. */
const texto = (valor: unknown): string | null => {
  if (valor === null || valor === undefined) return null;
  const limpo = String(valor).trim();
  return limpo === "" || limpo.toLowerCase() === "null" ? null : limpo;
};

/** Número, ou null. `numeric` já chega como número do PostgREST. */
const numeroOuNulo = (valor: unknown): number | null => {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

type LinhaEndereco = {
  id: string;
  id_cliente: number | null;
  cep: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  tipo_endereco: string | null;
  data_criacao: string | null;
  recebedor: string | null;
  cpf_recebedor: string | null;
};

type LinhaCliente = {
  id_cliente: number;
  nome: string | null;
  fantasia: string | null;
  documento: string | null;
  email: string | null;
  email_financeiro: string | null;
  email_contato: string | null;
  whatsapp_1: string | null;
  whatsapp_2: string | null;
  telefone_fixo: string | null;
  is_bonus: boolean | null;
  percentual_bunus: number | null;
  usa_preco_fixo: boolean | null;
};

const COLUNAS_CLIENTE =
  "id_cliente, nome, fantasia, documento, email, email_financeiro, email_contato, whatsapp_1, whatsapp_2, telefone_fixo, is_bonus, percentual_bunus, usa_preco_fixo";
const COLUNAS_ENDERECO =
  "id, id_cliente, cep, endereco, numero, complemento, bairro, cidade, uf, tipo_endereco, data_criacao, recebedor, cpf_recebedor";

/** O endereço no formato da resposta. */
function enderecoDaResposta(e: LinhaEndereco | null) {
  return {
    cep: texto(e?.cep)?.replace(/\D/g, "") || null,
    logradouro: texto(e?.endereco),
    numero: texto(e?.numero),
    complemento: texto(e?.complemento),
    bairro: texto(e?.bairro),
    cidade: texto(e?.cidade),
    uf: texto(e?.uf)?.toUpperCase() ?? null
  };
}

/** E-mail: o principal do cadastro; na falta dele, o financeiro; depois o de contato. */
const emailDo = (c: LinhaCliente | null) => texto(c?.email) ?? texto(c?.email_financeiro) ?? texto(c?.email_contato);

/** Telefone: WhatsApp 1, WhatsApp 2, fixo — nessa ordem. */
const telefoneDo = (c: LinhaCliente | null) => texto(c?.whatsapp_1) ?? texto(c?.whatsapp_2) ?? texto(c?.telefone_fixo);

async function lerCliente(banco: SupabaseClient, idCliente: number | null | undefined): Promise<LinhaCliente | null> {
  if (!idCliente) return null;
  const { data, error } = await banco.from("clientes").select(COLUNAS_CLIENTE).eq("id_cliente", idCliente).maybeSingle();
  if (error) throw new Error(`clientes: ${error.message}`);
  return (data as LinhaCliente | null) ?? null;
}

export async function GET(request: Request, contexto: { params: Promise<{ id_int: string }> }) {
  // 1. Limite por IP — antes de tudo, inclusive da chave.
  const ip = (request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "desconhecido")
    .split(",")[0]
    .trim();
  if (!rateLimitCheck(`lisiton:pedidos:${ip}`, LIMITE_POR_IP, JANELA_MS)) {
    return NextResponse.json(
      { erro: "muitas_tentativas", mensagem: "Limite de consultas atingido. Tente de novo em 1 minuto." },
      { status: 429, headers: { ...CABECALHOS, "Retry-After": "60" } }
    );
  }

  // 2. Chave. Sem chave configurada no servidor, ninguém entra.
  const esperada = process.env.LISITON_API_KEY ?? "";
  const recebida = request.headers.get("x-api-key") ?? "";
  if (!esperada) {
    console.error("[API][Lisiton] LISITON_API_KEY nao configurada no servidor.");
    return naoAutorizado();
  }
  if (!recebida || !chaveConfere(recebida, esperada)) return naoAutorizado();

  // 3. O número do pedido. Número inválido é "não encontrado", como qualquer outro.
  const { id_int: bruto } = await contexto.params;
  if (!/^\d{1,9}$/.test(String(bruto ?? ""))) return naoEncontrado();
  const idInt = Number(bruto);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("[API][Lisiton] Servidor sem acesso ao banco configurado.");
    return erroInterno();
  }
  const banco = createSupabaseClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    // 4. O pedido — só da Lisiton. O filtro está NA consulta: pedido de outro
    //    cliente nem chega a ser lido.
    const { data: proposta, error: erroProposta } = await banco
      .from("propostas")
      .select(
        "id_int, id_cliente, is_avulso, valor, valor_total, valor_frete, modalidade_frete, frete_escolhido, id_transportadora_cliente, id_endereco_ent"
      )
      .eq("id_int", idInt)
      .eq("id_cliente", ID_CLIENTE_LISITON)
      .maybeSingle();
    if (erroProposta) throw new Error(`propostas: ${erroProposta.message}`);
    if (!proposta) return naoEncontrado();

    // 5. O resto, em paralelo.
    const [expedicaoRes, itensRes, descontoRes, pagador, enderecosPagadorRes] = await Promise.all([
      banco
        .from("expedicoes")
        .select(
          "modalidade_frete, tipo_frete, transportadora_nome, id_transportadora_cliente, id_endereco_entrega, id_cliente_destinatario_etiqueta, telefone_etiqueta, peso_kg, qtd_volumes, tipo_volume, pesos_volumes"
        )
        .eq("id_int", idInt)
        .maybeSingle(),
      banco.from("produtos_proposta").select("qtd, valor_unt, fixo, status_item").eq("id_int", idInt),
      banco
        .from("desconto_proposta")
        // Desconto geral e bônus gravado na venda (TABELA_ESPECIAL) numa leitura.
        .select("tipo_desconto, valor_percentual, valor_nominal")
        .eq("id_int", idInt)
        .in("tipo_desconto", ["DESCONTO_GERAL", TIPO_DESCONTO_TABELA_ESPECIAL]),
      lerCliente(banco, ID_CLIENTE_LISITON),
      banco.from("enderecos").select(COLUNAS_ENDERECO).eq("id_cliente", ID_CLIENTE_LISITON)
    ]);
    for (const [nome, res] of [
      ["expedicoes", expedicaoRes],
      ["produtos_proposta", itensRes],
      ["desconto_proposta", descontoRes],
      ["enderecos", enderecosPagadorRes]
    ] as const) {
      if (res.error) throw new Error(`${nome}: ${res.error.message}`);
    }

    const expedicao = expedicaoRes.data as Record<string, unknown> | null;

    // 6. Entrega: o endereço da expedição, senão o da proposta — a mesma
    //    precedência da etiqueta que o Vibe imprime.
    const idEnderecoEntrega = texto(expedicao?.id_endereco_entrega) ?? texto(proposta.id_endereco_ent);
    let enderecoEntrega: LinhaEndereco | null = null;
    if (idEnderecoEntrega) {
      const { data, error } = await banco.from("enderecos").select(COLUNAS_ENDERECO).eq("id", idEnderecoEntrega).maybeSingle();
      if (error) throw new Error(`enderecos (entrega): ${error.message}`);
      enderecoEntrega = (data as LinhaEndereco | null) ?? null;
    }

    // Destinatário: o escolhido no despacho, senão o dono do endereço de entrega.
    const idDestinatario =
      numeroOuNulo(expedicao?.id_cliente_destinatario_etiqueta) ?? numeroOuNulo(enderecoEntrega?.id_cliente);
    const destinatario = idDestinatario === ID_CLIENTE_LISITON ? pagador : await lerCliente(banco, idDestinatario);

    // 7. Transportadora cadastrada, quando há.
    const idTransportadora =
      numeroOuNulo(expedicao?.id_transportadora_cliente) ?? numeroOuNulo(proposta.id_transportadora_cliente);
    const transportadora = idTransportadora ? await lerCliente(banco, idTransportadora) : null;

    // 8. Valor total pela regra única do sistema — a do "Salvar alterações",
    //    que deixa item cancelado de fora.
    const linhasDesconto = (descontoRes.data ?? []) as Array<{
      tipo_desconto: string;
      valor_percentual: number;
      valor_nominal: number;
    }>;
    const { total: valorTotal } = totaisDaProposta({
      isAvulso: proposta.is_avulso === true,
      valorTotalGravado: proposta.valor_total,
      valor: proposta.valor,
      valorFrete: proposta.valor_frete,
      itens: (itensRes.data ?? []) as Array<{ qtd: number; valor_unt: number; fixo: number; status_item: string | null }>,
      // O bônus gravado na venda manda; sem ele, o do cadastro (`bonusDaProposta`).
      bonusPercent: bonusDaProposta(
        percentualGravado(linhasDesconto.find((d) => d.tipo_desconto === TIPO_DESCONTO_TABELA_ESPECIAL)),
        getClienteBonusPercent(
          pagador
            ? ({
                usaPrecoFixo: pagador.usa_preco_fixo === true,
                is_bonus: pagador.is_bonus === true,
                bonusAtivo: pagador.is_bonus === true,
                percentualBonus: Number(pagador.percentual_bunus ?? 0)
              } as unknown as Parameters<typeof getClienteBonusPercent>[0])
            : null
        )
      ),
      descontoGeral: linhasDesconto.find((d) => d.tipo_desconto === "DESCONTO_GERAL") ?? null
    });

    // 9. Volumes: peso de cada um, quando a Revisão gravou; dimensão não existe no Vibe.
    const pesosVolumes = Array.isArray(expedicao?.pesos_volumes) ? (expedicao?.pesos_volumes as unknown[]) : [];
    const quantidadeVolumes = numeroOuNulo(expedicao?.qtd_volumes);
    const totalLinhas = Math.max(quantidadeVolumes ?? 0, pesosVolumes.length);
    const listaVolumes = Array.from({ length: totalLinhas }, (_, i) => ({
      numero: i + 1,
      peso_kg: numeroOuNulo(pesosVolumes[i]),
      altura_cm: null,
      largura_cm: null,
      comprimento_cm: null
    }));

    const enderecoPagador = escolherEnderecoPrincipal((enderecosPagadorRes.data ?? []) as LinhaEndereco[]);

    const resposta = {
      id_int: idInt,
      pagador: {
        nome: texto(pagador?.nome),
        documento: texto(pagador?.documento)?.replace(/\D/g, "") || null,
        email: emailDo(pagador),
        telefone: telefoneDo(pagador),
        endereco: enderecoDaResposta(enderecoPagador ?? null)
      },
      entrega: {
        destinatario: {
          nome: texto(destinatario?.nome),
          documento: texto(destinatario?.documento)?.replace(/\D/g, "") || null,
          email: emailDo(destinatario),
          telefone: texto(expedicao?.telefone_etiqueta) ?? telefoneDo(destinatario)
        },
        recebedor: {
          nome: texto(enderecoEntrega?.recebedor),
          cpf: texto(enderecoEntrega?.cpf_recebedor)?.replace(/\D/g, "") || null
        },
        endereco: enderecoDaResposta(enderecoEntrega)
      },
      valor_total: Math.round(valorTotal * 100) / 100,
      envio: {
        modalidade: texto(expedicao?.modalidade_frete) ?? texto(proposta.modalidade_frete),
        servico: texto(proposta.frete_escolhido),
        transportadora: {
          id: idTransportadora,
          nome: texto(transportadora?.nome) ?? texto(expedicao?.transportadora_nome)
        },
        valor_frete: numeroOuNulo(proposta.valor_frete)
      },
      peso_aferido_kg: numeroOuNulo(expedicao?.peso_kg),
      volumes: {
        quantidade: quantidadeVolumes,
        tipo: texto(expedicao?.tipo_volume),
        lista: listaVolumes
      }
    };

    return NextResponse.json(resposta, { status: 200, headers: CABECALHOS });
  } catch (err) {
    // Só a mensagem técnica do banco e o número do pedido — nenhum dado pessoal.
    console.error(`[API][Lisiton] Falha ao montar o pedido ${idInt}:`, err instanceof Error ? err.message : "erro");
    return erroInterno();
  }
}
