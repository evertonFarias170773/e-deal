import { getSupabaseClient } from "@/lib/supabase/client";
import { nfeMocks } from "@/lib/mocks/nfe.mock";
import { mapSupabaseNfeRowToReadModel } from "../mappers";
import type { SupabaseNfeRow, NfeReadModel, SupabaseNfeItemRow, SupabaseNfePagamentoRow } from "../types";
import type { SupabaseBoletoRow } from "@/features/contas-a-receber/types.supabase";
import { getPropostaDetailById } from "@/features/orcamentos/services/orcamentos.service";
import { PROPOSTA_STATUS_GROUP_NFE_ELIGIBLE } from "@/features/orcamentos/constants";
import { resolverPesoExpedicao } from "@/features/expedicao/lib/peso";
import { canonizarTransportadora, ehCadastroSubstituido } from "@/features/orcamentos/lib/transportadoras-parceiras";
import type { FaturavelOrigem } from "@/features/fiscal/types";
import {
  normalizarTipoContribuinte,
  tipoContribuintePorDocumento
} from "@/lib/fiscal/tipo-contribuinte";
import { escolherEnderecoPrincipal } from "@/lib/fiscal/endereco-principal";

export const NFE_SELECT_COLUMNS = [
  "id",
  "id_int",
  "id_cliente",
  "ref",
  "ambiente",
  "modelo",
  "status",
  "status_focus",
  "status_sefaz",
  "mensagem_sefaz",
  "codigo_status_sefaz",
  "numero_nf",
  "serie",
  "chave_nfe",
  "protocolo",
  "data_autorizacao",
  "data_cancelamento",
  "natureza_operacao",
  "tipo_documento",
  "finalidade_emissao",
  "consumidor_final",
  "presenca_comprador",
  "tipo_contribuinte",
  "modalidade_frete",
  "id_cotacao_frete",
  "transportadora",
  "valor_frete",
  "peso_liquido",
  "peso_bruto",
  "quantidade_volumes",
  "especie_volumes",
  "marca_volumes",
  "numeracao_volumes",
  "informacoes_complementares",
  "observacoes_internas",
  "endereco_entrega_observacao",
  "valor_produtos",
  "valor_desconto",
  "valor_total_nf",
  "caminho_xml",
  "caminho_danfe",
  "url_xml",
  "url_danfe",
  "payload_envio",
  "payload_retorno",
  "payload_webhook",
  "erro_codigo",
  "erro_mensagem",
  "erros_validacao",
  "tentativas_envio",
  "ultima_tentativa_em",
  "criado_por",
  "criado_por_nome",
  "created_at",
  "updated_at",
  "id_empresa",
  "end_entrega",
  "cond_pgto",
  "forma_pgto",
  "drop_natureza_op",
  "id_transportadora_cliente",
  "pgto_is_configurado"
] as const;

export const NFE_SELECT = NFE_SELECT_COLUMNS.join(", ");

export type NfeReadResult = {
  source: "supabase" | "mock";
  nfeList: NfeReadModel[];
};

function buildMockResult(): NfeReadResult {
  return {
    source: "mock",
    nfeList: nfeMocks.map(item => ({ ...item }))
  };
}

async function fetchNfeRows(): Promise<SupabaseNfeRow[] | null> {
  const client = getSupabaseClient();
  if (!client) {
    console.log("[Nfe][Debug] Supabase client absent - falling back to mocks.");
    return null;
  }

  console.log("[Nfe] Performing select query on public.notas_fiscais.");
  const query = client
    .from("notas_fiscais")
    .select(NFE_SELECT)
    .order("created_at", { ascending: false })
    .limit(2000);

  const { data, error } = await query.returns<SupabaseNfeRow[]>();

  if (error || !data) {
    console.log("[Nfe][Supabase] Select query failed - falling back to mocks.", {
      error: error instanceof Error ? error.message : error,
      hasData: Boolean(data)
    });
    return null;
  }

  return data;
}

export async function getNfeReadOnlyList(): Promise<NfeReadResult> {
  try {
    const rows = await fetchNfeRows();
    if (!rows || rows.length === 0) {
      return buildMockResult();
    }

    const uniqueClientIds = Array.from(new Set(rows.map(r => r.id_cliente).filter(Boolean)));
    const clientMap: Record<number, { nome: string; fantasia: string }> = {};

    if (uniqueClientIds.length > 0) {
      try {
        const client = getSupabaseClient();
        if (client) {
          const { data: clientsData } = await client
            .from("clientes")
            .select("id_cliente, nome, fantasia")
            .in("id_cliente", uniqueClientIds);

          if (clientsData) {
            for (const c of clientsData) {
              clientMap[c.id_cliente] = {
                nome: c.nome || "",
                fantasia: c.fantasia || ""
              };
            }
          }
        }
      } catch (err) {
        console.warn("[NfeService] Failed to fetch client names/fantasias:", err);
      }
    }

    // O que a lista mostra sem abrir a nota vem da proposta de origem e da
    // cobrança. Duas consultas para o lote inteiro — a paginação não muda,
    // porque a lista de notas continua vindo de uma consulta só.
    const idsInt = Array.from(new Set(rows.map((r) => Number(r.id_int)).filter((n) => Number.isFinite(n) && n > 0)));
    const propostaPorId = new Map<number, {
      cliente: string | null; id_cliente: number | null; id_faturado: number | null;
      vendedor: string | null; status_interno: string | null;
    }>();
    let socioPorProposta = new Map<number, string>();
    const cobrancaPorProposta = new Map<number, string>();

    const client = getSupabaseClient();
    if (client && idsInt.length > 0) {
      const [propostasRes, cobrancasRes] = await Promise.all([
        client.from("propostas")
          .select("id_int,cliente,id_cliente,id_faturado,vendedor,status_interno")
          .in("id_int", idsInt),
        client.from("pagamentos_v2")
          .select("id_int,tipo_cobranca,created_at")
          .in("id_int", idsInt)
          .order("created_at", { ascending: true })
      ]);

      if (propostasRes.error) {
        console.warn("[NfeService] Nao foi possivel ler as propostas do historico:", propostasRes.error.message);
      } else {
        (propostasRes.data ?? []).forEach((p) => propostaPorId.set(Number(p.id_int), {
          cliente: p.cliente, id_cliente: p.id_cliente, id_faturado: p.id_faturado,
          vendedor: p.vendedor, status_interno: p.status_interno
        }));
        socioPorProposta = await buscarSociosPagadores(
          client,
          [...propostaPorId.entries()].map(([idInt, p]) => ({
            id_int: idInt,
            id_cliente: p.id_cliente != null ? Number(p.id_cliente) : null,
            id_faturado: p.id_faturado != null ? Number(p.id_faturado) : null
          }))
        );
      }

      if (cobrancasRes.error) {
        console.warn("[NfeService] Nao foi possivel ler as cobrancas do historico:", cobrancasRes.error.message);
      } else {
        // Ordem crescente: a última escrita vence, que é a cobrança mais recente.
        (cobrancasRes.data ?? []).forEach((c: { id_int: number | null; tipo_cobranca: string | null }) => {
          const idInt = Number(c.id_int);
          const tipo = String(c.tipo_cobranca ?? "").trim();
          if (Number.isFinite(idInt) && tipo) cobrancaPorProposta.set(idInt, tipo);
        });
      }
    }

    const nfeList = rows.map(row => {
      const model = mapSupabaseNfeRowToReadModel(row);
      const clientInfo = clientMap[row.id_cliente];
      if (clientInfo) {
        model.nome = clientInfo.nome;
        model.fantasia = clientInfo.fantasia;
      }

      const daProposta = propostaPorId.get(Number(row.id_int));
      model.vendedor_pedido = daProposta?.vendedor ?? null;
      model.status_pedido = daProposta?.status_interno ?? null;
      model.socio_pagador_nome = socioPorProposta.get(Number(row.id_int)) ?? null;
      model.cliente_principal_nome = daProposta?.cliente ?? null;
      model.cliente_principal_id = daProposta?.id_cliente ?? null;
      model.tipo_cobranca = cobrancaPorProposta.get(Number(row.id_int)) ?? null;

      return model;
    });

    console.log("[Nfe] Retrieved and mapped real data.", { count: nfeList.length });
    
    return {
      source: "supabase",
      nfeList
    };
  } catch (err) {
    console.log("[Nfe] Catch block error - falling back to mocks.", err);
    return buildMockResult();
  }
}

// ==========================================
// FASE 2: PERSISTÊNCIA E VALIDAÇÃO DE RASCUNHOS
// ==========================================

export async function getNfeById(id: string): Promise<SupabaseNfeRow | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from("notas_fiscais")
    .select("*")
    .eq("id", id)
    .single();
  if (error) {
    console.error("[NfeService] Error fetching note by id:", error);
    return null;
  }
  return data;
}

export async function getNfeItems(idNotaFiscal: string): Promise<SupabaseNfeItemRow[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from("notas_fiscais_itens")
    .select("*")
    .eq("id_nota_fiscal", idNotaFiscal)
    .order("numero_item", { ascending: true });
  if (error) {
    console.error("[NfeService] Error fetching items:", error);
    return [];
  }
  return data || [];
}

export async function getNfePagamentos(idNotaFiscal: string): Promise<SupabaseNfePagamentoRow[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from("notas_fiscais_pagamentos")
    .select("*")
    .eq("id_nota_fiscal", idNotaFiscal)
    .eq("ativo", true)
    .order("numero_parcela", { ascending: true });
  if (error) {
    console.error("[NfeService] Error fetching payments:", error);
    return [];
  }
  return data || [];
}

export async function getNfeValidationGeral(ref: string) {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from("vw_notas_fiscais_validacao_geral")
    .select("*")
    .eq("ref", ref)
    .maybeSingle();
  if (error) {
    console.error("[NfeService] Error fetching validation view data:", error);
    return null;
  }
  return data;
}

export async function prepararEnvioNfe(ref: string) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client absent");
  const { data, error } = await client.rpc("fn_preparar_envio_nfe", { p_ref: ref });
  if (error) throw error;
  return data;
}

export async function montarPayloadNfe(ref: string) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client absent");
  const { data, error } = await client.rpc("fn_montar_payload_nfe", { p_ref: ref });
  if (error) throw error;
  return data;
}

export async function getAlertasNfe(ref: string) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client absent");
  const { data, error } = await client.rpc("fn_alertas_nfe", { p_ref: ref });
  if (error) throw error;
  return data;
}

/**
 * Empresa emitente a partir do texto gravado na proposta.
 * Exportada para a conferência do Faturar julgar exatamente a mesma empresa que
 * o rascunho vai gravar — se as duas divergirem, a conferência mente.
 */
export function resolverEmpresaEmitente(empresaTexto: string | null | undefined): number {
  const texto = (empresaTexto || "").toUpperCase();
  if (texto.includes("BIRO") || texto.includes("BIRÔ")) return 2;
  if (texto.includes("E3")) return 3;
  return 1;
}

/**
 * Código fiscal da forma de pagamento, a partir de `pagamentos_v2.tipo_cobranca`.
 *
 * POR QUE EXISTE
 *   O rascunho lia `propostas.forma_pagamento` — coluna que NÃO existe. O valor
 *   vinha sempre indefinido, virava "A combinar" e caía no default 15 (boleto).
 *   Era por isso que nota de PIX nascia como boleto.
 *
 * A ORDEM IMPORTA
 *   `E-CREDITO` contém "CREDITO", mas é uso de crédito do cliente, não cartão.
 *   Por isso os valores conhecidos são decididos primeiro, e só o que sobra cai
 *   na busca por palavra.
 *
 * SEM CAIXA
 *   `E-Faturado` e `E-FATURADO` convivem na base (173 e 104 registros). A
 *   comparação normaliza; os registros ficam como estão.
 */
export function codigoFiscalDaCobranca(tipoCobranca: string | null | undefined): string {
  const texto = String(tipoCobranca ?? "").trim().toUpperCase();
  if (!texto) return "15";

  // Valores conhecidos de pagamentos_v2.tipo_cobranca, decididos por igualdade.
  const CONHECIDOS: Record<string, string> = {
    PIX: "17",
    BOLETO: "15",
    CARD_PARCELADO: "03",
    CREDIT_CARD: "03",
    "E-FATURADO": "15",
    "E-CREDITO": "15"
  };
  if (CONHECIDOS[texto]) return CONHECIDOS[texto];

  if (texto.includes("PIX") || texto.includes("TRANSFERENCIA") || texto.includes("TED")) return "17";
  if (texto.includes("DINHEIRO")) return "01";
  if (
    texto.includes("CARTAO") ||
    texto.includes("CARTÃO") ||
    texto.includes("CARD") ||
    texto.includes("CREDITO") ||
    texto.includes("CRÉDITO") ||
    texto.includes("DEBITO") ||
    texto.includes("DÉBITO")
  ) {
    return "03";
  }
  return "15";
}

/** Modalidade do frete da NF-e a partir da modalidade declarada na proposta. */
export function codigoModalidadeFrete(
  modalidadeProposta: string | null | undefined,
  valorFrete: number
): number {
  const texto = String(modalidadeProposta ?? "").trim().toUpperCase();
  if (texto === "CIF") return 0; // por conta do emitente
  if (texto === "FOB") return 1; // por conta do destinatário
  if (texto === "RETIRA") return 9; // sem ocorrência de transporte
  // Sem modalidade declarada: mantém o comportamento antigo, derivado do valor.
  // A conferência do Faturar avisa quando há frete e não há modalidade.
  return valorFrete > 0 ? 0 : 9;
}

/**
 * Forma de cobrança negociada de um pedido, lida de pagamentos_v2.
 * Quando há mais de uma cobrança, vale a mais recente — hoje nenhum pedido da
 * fila tem formas divergentes, mas a regra precisa ser determinística.
 */
export async function getTipoCobrancaDoPedido(idInt: number): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from("pagamentos_v2")
    .select("tipo_cobranca, created_at")
    .eq("id_int", idInt)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[NfeService] Nao foi possivel ler a cobranca do pedido:", error.message);
    return null;
  }
  const tipo = String((data as { tipo_cobranca?: string } | null)?.tipo_cobranca ?? "").trim();
  return tipo || null;
}

/** `entrega`, `ENTREGA`, `Entrega` — a base guarda as três. */
export function ehEnderecoDeEntrega(tipoEndereco: string | null | undefined): boolean {
  return String(tipoEndereco ?? "").trim().toLowerCase().startsWith("entrega");
}

/**
 * Para onde a mercadoria vai, segundo o que a proposta decidiu.
 *
 * POR QUE EXISTE
 *   A UF de destino era decidida em três lugares que discordavam: aqui, pelo
 *   endereço apontado no pedido; na tela de detalhe, pelo `uf` do cadastro do
 *   cliente; e na RPC do payload, pelo endereço marcado como principal. Quando o
 *   cliente tem sede num estado e recebe em outro, o CFOP saía interestadual e o
 *   `local_destino` saía interno — a rejeição 732 da NFE-20872-001.
 *
 *   Manda `propostas.id_endereco_ent`: é onde a mercadoria vai, e é a escolha do
 *   pedido. CFOP e idDest passam a nascer da mesma UF.
 *
 * NÃO CHUTA
 *   Sem endereço apontado, devolve null. Quem chama decide o que fazer — e a
 *   conferência do Faturar já barra esse caso antes de chegar aqui.
 */
export interface DestinoFiscal {
  /** UF do endereço escolhido no pedido, em maiúsculas. */
  uf: string;
  idEndereco: string;
  /** O endereço apontado é de entrega (e não o principal do cliente). */
  ehEntrega: boolean;
}

/**
 * Quem PAGA a proposta — e portanto quem recebe o documento fiscal.
 *
 * `propostas.id_faturado` quando difere de `id_cliente`; quando nao difere, sao
 * a mesma pessoa. Sem excecao: a nota nunca sai contra o cliente da proposta
 * quando ha um pagador distinto (o cliente e quem encomenda; o pagador e quem a
 * SEFAZ tem de ver).
 */
export async function resolverPagador(idInt: number): Promise<number | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data } = await client
    .from("propostas")
    .select("id_cliente,id_faturado")
    .eq("id_int", idInt)
    .maybeSingle();
  const linha = data as { id_cliente: number | null; id_faturado: number | null } | null;
  if (!linha) return null;
  return linha.id_faturado && linha.id_faturado !== linha.id_cliente
    ? linha.id_faturado
    : linha.id_cliente;
}

/**
 * O endereco PRINCIPAL de um cliente, lido do banco.
 *
 * A REGRA de escolha (e o porque do desempate) vive em
 * `@/lib/fiscal/endereco-principal` — modulo proprio porque tres features
 * dependem dela: esta, a aba Destinatario da NF e a reconsulta de CNPJ do
 * cadastro, que sobrescreve exatamente a linha que esta funcao elege.
 */
export async function resolverEnderecoPrincipal(
  idCliente: number
): Promise<{ id: string; uf: string; tipoEndereco: string | null } | null> {
  const client = getSupabaseClient();
  if (!client || !idCliente) return null;

  const { data } = await client
    .from("enderecos")
    .select("id,uf,tipo_endereco,data_criacao")
    .eq("id_cliente", idCliente);

  const escolhido = escolherEnderecoPrincipal(
    (data ?? []) as Array<{
      id: string;
      uf: string | null;
      tipo_endereco: string | null;
      data_criacao: string | null;
    }>
  );
  if (!escolhido) return null;

  const uf = String(escolhido.uf ?? "").trim().toUpperCase();
  if (!uf) return null;
  return { id: String(escolhido.id), uf, tipoEndereco: escolhido.tipo_endereco };
}

/**
 * Destino fiscal da nota: sai do endereco PRINCIPAL do PAGADOR.
 *
 * Antes saia do endereco apontado no pedido (`id_endereco_ent`), que e o de
 * ENTREGA e pode ser o do agenciador. Destinatario e destino tem de ser a mesma
 * pessoa, senao a nota sai no nome de um e no endereco de outro — a rejeicao 732.
 *
 * `ehEntrega` NAO virou "o principal e de entrega": continua sendo a pergunta do
 * PEDIDO, porque e ela que decide se a nota leva o bloco de entrega em endereco
 * distinto do destinatario. Isso preserva o comportamento atual do
 * `end_entrega`, que nao esta nesta etapa.
 */
export async function resolverDestinoFiscal(idInt: number): Promise<DestinoFiscal | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data: propostaRow } = await client
    .from("propostas")
    .select("id_cliente,id_faturado,id_endereco_ent")
    .eq("id_int", idInt)
    .maybeSingle();

  const linha = propostaRow as {
    id_cliente: number | null;
    id_faturado: number | null;
    id_endereco_ent: string | null;
  } | null;
  if (!linha) return null;

  const idPagador =
    linha.id_faturado && linha.id_faturado !== linha.id_cliente
      ? linha.id_faturado
      : linha.id_cliente;
  if (!idPagador) return null;

  const principal = await resolverEnderecoPrincipal(idPagador);
  if (!principal) return null;

  // O bloco de entrega continua olhando o endereco do PEDIDO — ver o comentario
  // acima. Sem endereco no pedido, nao ha entrega em endereco proprio.
  const idEnderecoDoPedido = String(linha.id_endereco_ent ?? "").trim();
  let ehEntrega = false;
  if (idEnderecoDoPedido && idEnderecoDoPedido !== principal.id) {
    const { data: enderecoRow } = await client
      .from("enderecos")
      .select("tipo_endereco")
      .eq("id", idEnderecoDoPedido)
      .maybeSingle();
    ehEntrega = ehEnderecoDeEntrega(
      (enderecoRow as { tipo_endereco?: string | null } | null)?.tipo_endereco
    );
  }

  return { uf: principal.uf, idEndereco: principal.id, ehEntrega };
}

/**
 * CFOP de venda conforme a operação seja interna ou interestadual.
 *
 * SOBREVIVE como fallback: vale quando a nota tem natureza que não casa com o
 * catálogo — o caso das notas antigas — e como default do rascunho novo. Quem
 * tem natureza reconhecida usa `cfopDaNatureza`.
 */
export function cfopDeVenda(ufDestino: string, ufEmitente: string): string {
  return ufDestino.trim().toUpperCase() === ufEmitente.trim().toUpperCase() ? "5101" : "6101";
}

/**
 * `INTERNA` ou `INTERESTADUAL`, na grafia que o catálogo usa em
 * `destino_operacao`. `null` quando falta UF dos dois lados — sem as duas não há
 * como saber se a operação cruza fronteira, e chutar seria escolher imposto.
 */
export function destinoDaOperacao(
  ufDestino: string,
  ufEmitente: string
): "INTERNA" | "INTERESTADUAL" | null {
  const destino = String(ufDestino ?? "").trim().toUpperCase();
  const emitente = String(ufEmitente ?? "").trim().toUpperCase();
  if (!destino || !emitente) return null;
  return destino === emitente ? "INTERNA" : "INTERESTADUAL";
}

/**
 * O CFOP que os itens da nota devem carregar, dado a natureza escolhida.
 *
 * O PAR INTERNO/INTERESTADUAL NÃO ESTÁ MODELADO NO CATÁLOGO, e a chave que
 * pareceria natural não serve: `(tipo_operacao, destino_operacao)` não é única,
 * porque VENDA tem duas linhas INTERNA (5101 e 5108) e duas INTERESTADUAL
 * (6101 e 6108). Casar por ela devolveria 6108 como par de 5101 — outra
 * operação.
 *
 * Então a convenção numérica da SEFAZ entra só para MONTAR A CHAVE, nunca para
 * produzir o código: o primeiro dígito muda (5↔6 nas saídas, 1↔2 nas entradas) e
 * os três últimos permanecem. A busca é por
 * `(tipo_operacao, três últimos dígitos, destino_operacao)` — combinação única
 * nas 8 linhas de NF-e — e o CFOP devolvido é sempre um que EXISTE na tabela.
 *
 * Nunca inventa código. Devolve `null` — e quem chama mantém o que já tem —
 * quando a natureza não está no catálogo, quando falta UF, ou quando o par não
 * foi cadastrado.
 */
export function cfopDaNatureza(
  descricaoNatureza: string | null | undefined,
  ufDestino: string,
  ufEmitente: string,
  catalogo: readonly NaturezaOperacaoNfe[]
): string | null {
  const descricao = String(descricaoNatureza ?? "").trim();
  if (!descricao) return null;

  const escolhida = (catalogo ?? []).find((linha) => linha.descricao === descricao);
  if (!escolhida) return null; // natureza fora do catálogo: nada a derivar

  const destino = destinoDaOperacao(ufDestino, ufEmitente);
  if (!destino) return null;

  const sufixo = escolhida.cfop.slice(-3);
  const par = (catalogo ?? []).find(
    (linha) =>
      linha.tipoOperacao === escolhida.tipoOperacao &&
      linha.cfop.slice(-3) === sufixo &&
      linha.destinoOperacao === destino
  );

  return par ? par.cfop : null;
}

/**
 * UF da empresa emitente, lida de `empresas`. Não é constante no código de
 * propósito: um mapa fixo aqui viraria uma quarta fonte, livre para divergir do
 * cadastro — que é exatamente o problema que esta rodada resolve.
 */
export async function ufDaEmpresaEmitente(idEmpresa: number): Promise<string> {
  const client = getSupabaseClient();
  if (!client) return "";
  const { data } = await client.from("empresas").select("uf").eq("id", idEmpresa).maybeSingle();
  return String((data as { uf?: string | null } | null)?.uf ?? "").trim().toUpperCase();
}

/**
 * Distribui o peso resolvido da expedicao entre os itens da nota, devolvendo o
 * peso UNITARIO em gramas de cada um, na ordem recebida.
 *
 * POR QUE O RATEIO EXISTE
 *   O cabecalho da nota nao e escrito por nos: o trigger
 *   `fn_recalcular_peso_nfe_por_itens` reescreve `peso_liquido` e `peso_bruto`
 *   como a soma de `peso_total_gramas` dos itens, a cada INSERT/UPDATE/DELETE.
 *   Gravar o peso aferido direto no cabecalho duraria ate o primeiro save do
 *   rascunho, que regrava os itens e dispara o trigger de novo. Entao o peso
 *   tem de entrar PELOS ITENS: o rateio e o veiculo, nao o objetivo.
 *
 *   O outro trigger colabora sem precisar mudar: `fn_preencher_peso_unitario_nfe_item`
 *   so busca `produtos.peso` quando `peso_unitario_gramas` chega ZERO — valor
 *   nao-zero e preservado — e ele mesmo refaz `peso_total = round(qtd * unitario, 4)`.
 *
 *   Nada disso chega a SEFAZ: o bloco de itens do payload nao tem campo de peso
 *   (conferido: 18 chaves, nenhuma delas de peso). Ela ve o cabecalho e os volumes.
 *
 * A REGRA
 *   Proporcional ao peso teorico do item. Quando TODOS os teoricos sao zero —
 *   produtos sem peso cadastrado — cai para rateio por quantidade; sem esse
 *   desvio a divisao seria por zero e a nota sairia sem peso nenhum.
 *
 * PRECISAO
 *   `peso_unitario_gramas` e `numeric(14,4)` e o cabecalho arredonda em 3 casas.
 *   Simulado o caminho completo pelos dois triggers nas 25 expedicoes com peso
 *   aferido, as de varios itens inclusive: 25 de 25 reproduzem o peso resolvido,
 *   erro maximo 0,000 kg.
 */
export function ratearPesoNosItens(
  itens: Array<{ quantidade?: number | null; pesoTotal?: number | null }>,
  pesoTotalGramas: number
): number[] {
  const somaTeorica = itens.reduce((soma, item) => soma + (item.pesoTotal || 0), 0);
  const somaQuantidade = itens.reduce((soma, item) => soma + (item.quantidade || 0), 0);

  return itens.map((item) => {
    const quantidade = item.quantidade || 0;
    if (quantidade <= 0 || pesoTotalGramas <= 0) return 0;

    const proporcao =
      somaTeorica > 0
        ? (item.pesoTotal || 0) / somaTeorica
        : somaQuantidade > 0
          ? quantidade / somaQuantidade
          : 0;

    return Number(((pesoTotalGramas * proporcao) / quantidade).toFixed(4));
  });
}

export async function createOrReuseNfeDraft(idInt: number): Promise<SupabaseNfeRow> {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client not initialized");

  // 1. Verificar se já existe rascunho PENDENTE
  const { data: existing } = await client
    .from("notas_fiscais")
    .select("*")
    .eq("id_int", idInt)
    .eq("status", "PENDENTE")
    .limit(1)
    .maybeSingle();

  if (existing) {
    console.log(`[NfeService] Reusing existing draft for id_int=${idInt}, ref=${existing.ref}`);
    return existing;
  }

  // 2. Carregar detalhes da proposta comercial
  const proposta = await getPropostaDetailById(idInt);
  if (!proposta) {
    throw new Error(`Proposta #${idInt} não encontrada para faturamento.`);
  }

  // 3. Determinar próximo sufixo incremental da referência
  const { data: siblingNotes } = await client
    .from("notas_fiscais")
    .select("ref")
    .eq("id_int", idInt);

  let nextSuffix = 1;
  if (siblingNotes && siblingNotes.length > 0) {
    siblingNotes.forEach(note => {
      const parts = note.ref.split("-");
      const suffix = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(suffix) && suffix >= nextSuffix) {
        nextSuffix = suffix + 1;
      }
    });
  }
  const ref = `NFE-${idInt}-${String(nextSuffix).padStart(3, "0")}`;

  // 4. Mapear empresa emitente
  const idEmpresa = resolverEmpresaEmitente(proposta.empresa);

  // 4b. O que a origem diz sobre cobrança e endereço de entrega.
  //     A cobrança vem de pagamentos_v2 — `propostas` não tem forma de pagamento.
  //     O endereço de entrega só é "de entrega" quando `id_endereco_ent` aponta
  //     para um endereço marcado como tal; caso contrário a nota usa o principal.
  const tipoCobranca = await getTipoCobrancaDoPedido(idInt);

  // O destino sai de uma fonte só: o endereço apontado no pedido. Dele nascem a
  //  UF, o CFOP e — depois de a RPC ser alinhada — o local_destino.
  const destino = await resolverDestinoFiscal(idInt);
  if (!destino) {
    throw new Error(
      "O pedido não aponta um endereço de destino válido. Escolha o endereço no orçamento antes de faturar."
    );
  }
  const entregaEmEnderecoProprio = destino.ehEntrega;

  // 5. Determinar parametrização fiscal básica e CFOP
  const ufEmitente = await ufDaEmpresaEmitente(idEmpresa);
  if (!ufEmitente) {
    throw new Error("A empresa emitente está sem UF cadastrada. Corrija em Empresas antes de faturar.");
  }
  const ufDest = destino.uf;
  const operacaoInterna = ufDest === ufEmitente;
  const cfopDefault = cfopDeVenda(ufDest, ufEmitente);

  // A NATUREZA DO RASCUNHO NOVO SAI DO CATÁLOGO, e os DOIS campos são gravados.
  //
  // Antes daqui saía um literal — `VENDA DE PRODUCAO PROPRIA` — e
  // `drop_natureza_op` não era mandado. Isso funcionava enquanto a trigger
  // `fn_defaults_rascunho_nfe` reescrevia os dois incondicionalmente. Ela deixou
  // de reescrever em 28/08 (virou rede de segurança, só age com os dois vazios),
  // e como o literal chega preenchido a trigger não age: o rascunho nasceria com
  // `drop_natureza_op` NULO e uma quarta grafia de "venda de produção própria".
  //
  // Nota sem `drop_natureza_op` não casa com o catálogo — e sem casar não há
  // CFOP a derivar, que é justamente o que esta rodada existe para fazer.
  //
  // O default de CFOP não muda: 5101 dentro do estado, 6101 fora.
  const catalogoNaturezas = await getNaturezasOperacaoNfe();
  const naturezaDoCatalogo = catalogoNaturezas.find((linha) => linha.cfop === cfopDefault) ?? null;
  const naturezaDefault =
    naturezaDoCatalogo?.natureza ??
    (operacaoInterna ? "VENDA DE PRODUCAO PROPRIA" : "VENDA DE PRODUCAO PROPRIA DEST. OUTRO ESTADO");
  const dropNaturezaDefault = naturezaDoCatalogo?.descricao ?? null;

  // O CFOP dos itens deriva da natureza da nota. Catálogo fora do ar ou linha
  // ausente cai no cálculo por UF, que é o comportamento de sempre.
  const cfopDosItens =
    cfopDaNatureza(dropNaturezaDefault, ufDest, ufEmitente, catalogoNaturezas) ?? cfopDefault;

  // ETAPA C — o destinatario da nota e o PAGADOR, nao o cliente da proposta.
  // O cliente encomenda; em parte dos casos e um agenciador com procuracao para
  // comprar em nome de outra empresa, e e essa outra que a SEFAZ tem de ver.
  // Boleto e cobranca ja saiam assim; a nota era a ultima que faltava.
  //
  // Vale so para rascunho NOVO: nada existente e reescrito. Rascunho em erro nao
  // e reaproveitado (a busca acima exige status PENDENTE), entao refaturar um
  // pedido antigo cria um rascunho novo, ja com o pagador.
  const idPagador = (await resolverPagador(idInt)) ?? proposta.cliente?.idCliente ?? null;
  let documentoPagador = proposta.cliente?.documento || "";
  let tipoContribuinteDoCadastro: string | null = null;
  if (idPagador) {
    // Uma consulta so, sempre — antes ela so acontecia quando o pagador era um
    // terceiro, porque o documento do proprio cliente ja vinha da proposta. O
    // `tipo_contribuinte` nao vem: a proposta nao carrega esse campo.
    const { data: pagadorRow } = await client
      .from("clientes")
      .select("documento,tipo_contribuinte")
      .eq("id_cliente", idPagador)
      .maybeSingle();
    const cadastroPagador = pagadorRow as {
      documento?: string | null;
      tipo_contribuinte?: string | null;
    } | null;
    if (idPagador !== proposta.cliente?.idCliente) {
      documentoPagador = String(cadastroPagador?.documento ?? "");
    }
    tipoContribuinteDoCadastro = cadastroPagador?.tipo_contribuinte ?? null;
  }

  const isCNPJ = documentoPagador.replace(/\D/g, "").length > 11;

  // `consumidor_final` continua saindo do documento: CPF e sempre consumidor
  // final, e isso a RPC do payload reafirma na emissao.
  const consumidorFinal = isCNPJ ? 0 : 1;

  // O TIPO DE CONTRIBUINTE AGORA SAI DO CADASTRO DO PAGADOR.
  //
  // Ate 25/08/2026 ele era puro palpite por documento: CNPJ virava 1
  // (Contribuinte ICMS) e CPF virava 9. O palpite acerta o CPF e erra o CNPJ com
  // frequencia — a maioria dos clientes PJ da base nao e contribuinte de ICMS, e
  // declarar 1 para quem nao tem inscricao estadual e o caminho da rejeicao.
  //
  // O cadastro passa na frente; o palpite fica como rede, para quando o cadastro
  // nao tem valor traduzivel (vazio, NULL ou grafia nao reconhecida). Nenhum
  // rascunho existente e reescrito: isto roda so na criacao.
  const tipoContribuinte = Number(
    normalizarTipoContribuinte(tipoContribuinteDoCadastro) ??
      tipoContribuintePorDocumento(documentoPagador)
  );

  const valorFrete = proposta.resumo?.frete || 0;
  const modalidadeFrete = codigoModalidadeFrete(proposta.modalidadeFrete, valorFrete);

  let totalPeso = 0;
  if (proposta.itens) {
    proposta.itens.forEach(it => {
      totalPeso += it.pesoTotal || 0;
    });
  }

  // O PESO DA NOTA PASSA A SER O DA EXPEDICAO, NAO O DO CATALOGO.
  //
  // Ate aqui a nota copiava `produtos_proposta.peso_total` — o peso teorico do
  // cadastro do produto — e ignorava a balanca, mesmo com o pedido pesado no
  // banco ha dias. Das 4 notas autorizadas comparaveis, as 4 divergiam do
  // aferido; uma delas em 28%.
  //
  // A precedencia NAO e escrita aqui: e a de `resolverPesoExpedicao`
  // (features/expedicao/lib/peso.ts), a mesma que a etiqueta, a declaracao de
  // conteudo, a prepostagem dos Correios e a recotacao ja usam. A NF-e era o
  // quinto consumidor e o unico fora da regra; passa a ser o quinto DENTRO
  // dela. Nivel 4 da precedencia e exatamente o teorico de antes, entao pedido
  // sem expedicao pesada continua saindo como sempre saiu.
  const { data: expedicaoRow } = await client
    .from("expedicoes")
    .select("peso_kg, peso_bruto_kg, id_transportadora_cliente, transportadora_nome, qtd_volumes, tipo_volume")
    .eq("id_int", idInt)
    .maybeSingle();

  const expedicao = expedicaoRow as {
    peso_kg?: number | null;
    peso_bruto_kg?: number | null;
    id_transportadora_cliente?: number | null;
    transportadora_nome?: string | null;
    qtd_volumes?: number | null;
    tipo_volume?: string | null;
  } | null;
  const freteEscolhido = proposta.fretes?.find(f => f.id === proposta.freteEscolhidoId);

  const { pesoKg: pesoResolvidoKg, origem: pesoOrigem } = resolverPesoExpedicao({
    pesoAferidoKg: expedicao?.peso_kg,
    pesoBrutoKg: expedicao?.peso_bruto_kg,
    pesoCotadoGramas: freteEscolhido?.pesoUsado,
    pesoTeoricoGramas: totalPeso
  });

  // Sem nenhuma fonte utilizavel o resolvedor devolve null; ai vale o teorico,
  // que e o que a nota ja fazia.
  const pesoNotaGramas = pesoResolvidoKg !== null ? pesoResolvidoKg * 1000 : totalPeso;

  console.log(
    `[NfeService] Peso da nota #${idInt}: ${(pesoNotaGramas / 1000).toFixed(3)} kg ` +
      `(origem: ${pesoOrigem ?? "nenhuma"}; teorico do catalogo era ${(totalPeso / 1000).toFixed(3)} kg)`
  );

  const pesoPorItem = ratearPesoNosItens(proposta.itens ?? [], pesoNotaGramas);

  // TRANSPORTADORA E VOLUMES NASCEM PREENCHIDOS — Etapa 2.
  //
  // O `nfeInsert` nao semeava transportadora nenhuma: toda nota nascia com
  // `transportadora` e `id_transportadora_cliente` nulos, e alguem escolhia a
  // mao na aba Transporte/Frete. Media em 26/08/2026: 1 de 19 notas com o dado.
  // Volumes era pior — `1` e "CAIXA" FIXOS no codigo, ignorando o que o
  // expedidor contou e classificou na bancada.
  //
  // PRECEDENCIA: expedicao primeiro, proposta como fallback.
  //   A expedicao vem depois no fluxo e ja passou pela conferencia do despacho,
  //   entao quando ela existe e a fonte mais forte. A proposta cobre o resto —
  //   e o resto e grande: 10 das 19 notas de hoje foram criadas ANTES de haver
  //   expedicao (5 sem expedicao ate agora, 5 com expedicao criada depois).
  //
  // O ID E O NOME SAO RESOLVIDOS SEPARADAMENTE, de proposito: 16 das 27
  // expedicoes com nome de transportadora estao SEM o id. Exigir os dois juntos
  // jogaria fora o nome nesses casos.
  const idTransportadoraBruto =
    expedicao?.id_transportadora_cliente ?? proposta.idTransportadoraCliente ?? null;

  // Um cadastro pode ter sido substituido por outro — os Correios chegaram em
  // dois, e a Expedicao vinculou 9 despachos a agencia franqueada. Quem vale na
  // nota e o cadastro canonico (ver `transportadoras-parceiras.ts`).
  const idTransportadoraNota = canonizarTransportadora(idTransportadoraBruto);
  const transportadoraFoiTraduzida = ehCadastroSubstituido(idTransportadoraBruto);

  // Nome vindo da expedicao NAO serve quando o id foi traduzido: ele descreve o
  // cadastro antigo, e o payload manda nome e CNPJ juntos. Nome de um, documento
  // de outro seria pior que campo vazio.
  let transportadoraNota = transportadoraFoiTraduzida
    ? ""
    : String(expedicao?.transportadora_nome ?? "").trim();
  if (!transportadoraNota && idTransportadoraNota) {
    // Tem vinculo mas ninguem escreveu o nome: busca no cadastro em vez de
    // deixar o campo vazio numa nota que ja sabe quem e o transportador.
    const { data: transpRow } = await client
      .from("clientes")
      .select("nome, fantasia")
      .eq("id_cliente", idTransportadoraNota)
      .maybeSingle();
    const transp = transpRow as { nome?: string | null; fantasia?: string | null } | null;
    transportadoraNota = String(transp?.nome ?? transp?.fantasia ?? "").trim();
  }

  // Volumes: o que a bancada contou. Sem expedicao, os mesmos valores de antes.
  // `> 0` e nao `??` porque zero volume nao e informacao, e um `0` gravado aqui
  // sairia no bloco de volumes do payload como carga inexistente.
  const qtdVolumesExpedicao = Number(expedicao?.qtd_volumes ?? 0);
  const qtdVolumesNota = qtdVolumesExpedicao > 0 ? qtdVolumesExpedicao : 1;
  const especieVolumesNota = String(expedicao?.tipo_volume ?? "").trim() || "CAIXA";

  console.log(
    `[NfeService] Transporte da nota #${idInt}: transportadora="${transportadoraNota || "(vazia)"}" ` +
      `id=${idTransportadoraNota ?? "null"} volumes=${qtdVolumesNota} especie="${especieVolumesNota}" ` +
      `(expedicao ${expedicao ? "existe" : "AINDA NAO EXISTE"}${transportadoraFoiTraduzida ? `; cadastro ${idTransportadoraBruto} traduzido para ${idTransportadoraNota}` : ""})`
  );

  const pgtoConfigurado = Boolean(tipoCobranca);
  // A nota usa o endereço principal por padrão. O bloco de entrega só entra
  // quando a proposta aponta um endereço marcado como de entrega — antes disso
  // `end_entrega` era sempre true, porque a resolução nunca devolve vazio.
  const hasEndereco = entregaEmEnderecoProprio && Boolean(proposta.enderecoEntrega);
  const enderecoStr = hasEndereco ? JSON.stringify(proposta.enderecoEntrega) : null;

  const nfeInsert = {
    id_int: idInt,
    // Destinatario = pagador (Etapa C). Todo o resto do cadastro — nome, CNPJ,
    // IE, indicador de IE — acompanha sozinho pelo join da RPC, que casa por
    // `nf.id_cliente`.
    id_cliente: idPagador,
    id_empresa: idEmpresa,
    ref,
    ambiente: "homologacao",
    modelo: "55",
    status: "PENDENTE",
    valor_produtos: proposta.resumo?.subtotalProdutos || 0,
    valor_desconto: proposta.resumo?.descontoGeral || 0,
    valor_frete: valorFrete,
    valor_total_nf: proposta.resumo?.valorTotal || 0,
    cond_pgto: pgtoConfigurado,
    forma_pgto: tipoCobranca || "A Vista",
    end_entrega: hasEndereco,
    endereco_entrega_observacao: enderecoStr,
    natureza_operacao: naturezaDefault,
    drop_natureza_op: dropNaturezaDefault,
    tipo_documento: 1, // Saída
    finalidade_emissao: 1, // Normal
    consumidor_final: consumidorFinal,
    presenca_comprador: 2, // Internet
    tipo_contribuinte: tipoContribuinte,
    modalidade_frete: modalidadeFrete,
    id_transportadora_cliente: idTransportadoraNota,
    transportadora: transportadoraNota || null,
    quantidade_volumes: qtdVolumesNota,
    especie_volumes: especieVolumesNota,
    // Os dois triggers de peso reescrevem estas duas colunas a partir da soma
    // dos itens assim que eles entram. Gravamos aqui o MESMO numero que eles vao
    // impor, para que a linha nunca exista com um peso que ninguem mais defende.
    peso_liquido: pesoNotaGramas / 1000,
    peso_bruto: pesoNotaGramas / 1000,
    pgto_is_configurado: pgtoConfigurado
  };

  console.log("[NfeService] Inserting new notas_fiscais draft:", JSON.stringify(nfeInsert, null, 2));

  const { data: newNfe, error: insertError } = await client
    .from("notas_fiscais")
    .insert(nfeInsert)
    .select("*")
    .single();

  if (insertError || !newNfe) {
    console.error("[NfeService] Error inserting notas_fiscais row:", insertError);
    throw new Error(`Falha ao salvar cabeçalho da nota fiscal: ${insertError?.message}`);
  }

  // 6. Inserir itens da nota
  if (proposta.itens && proposta.itens.length > 0) {
    const itemsInsert = proposta.itens.map((item, idx) => {
      // O TOTAL DO ITEM NA NOTA E O SUBTOTAL DA PROPOSTA — nao `qtd x unitario`.
      //
      // `produtos_proposta.valor_sub_total` ja e mantido correto pelo trigger
      // `calcular_valor_sub_total`, que faz `qtd * (valor_base + valor_extra) + fixo`.
      // Montar o item da nota por `quantidade * valorUnitario` lia so o `valor_base`
      // e jogava fora DUAS parcelas do preco:
      //
      //   - `fixo`, o custo por LOTE (nao por unidade), presente em 1.129 dos 1.223
      //     itens da base — no pedido 20928 sao os 40,00 que faziam a nota sair
      //     160,00 onde a proposta diz 200,00;
      //   - `valor_extra`, o acrescimo unitario das variacoes escolhidas.
      //
      // Partir do subtotal corrige as duas de uma vez, porque as duas ja estao nele.
      //
      // POR QUE `subtotalBruto` E NAO `subtotal`
      //   Os dois nascem de `valor_sub_total`, mas `subtotal` e rebaixado pelo bonus
      //   do cliente quando ele existe (5 cadastros em 65.929). O bonus NAO entra em
      //   `produtos_proposta.valor_sub_total` nem em `propostas.valor_total` — que e
      //   justamente o total com que a nota precisa fechar. `subtotalBruto` e o
      //   espelho fiel da coluna: mesma formula do trigger, sem o bonus.
      const quantidade = item.quantidade || 0;
      const subtotalItem = Number(
        item.subtotalBruto ?? item.subtotal ?? quantidade * item.valorUnitario
      );

      // O unitario da nota e esse total diluido na quantidade. Quatro casas porque
      // `notas_fiscais_itens.valor_unitario` e `numeric(14,4)`: mais precisao seria
      // truncada pela propria coluna.
      const valorUnitario =
        quantidade > 0 ? Number((subtotalItem / quantidade).toFixed(4)) : 0;

      // `valor_bruto` E O SUBTOTAL, mas quem da a palavra final e o banco: o trigger
      // `fn_calcular_valor_bruto_nfe_item` reescreve esta coluna como
      // `round(quantidade * valor_unitario, 2)` em todo INSERT/UPDATE. Nos 795 itens
      // em que a divisao fecha em 4 casas os dois numeros sao o mesmo. Nos outros 426
      // o trigger vence e o item fica deslocado do subtotal em ate R$ 1,60 — sempre
      // MUITO menos que o fixo inteiro que se perdia antes, mas nao zero.
      const valorBruto = subtotalItem;

      // Peso vindo do rateio do peso da expedicao, nao mais o teorico do item.
      // `peso_total_gramas` acompanha a formula do trigger — que vai refaze-lo
      // de qualquer jeito — para a linha nascer coerente.
      const pesoUnitario = pesoPorItem[idx] ?? 0;
      const pesoTotal = Number((quantidade * pesoUnitario).toFixed(4));

      return {
        id_nota_fiscal: newNfe.id,
        ref: newNfe.ref,
        id_int: idInt,
        id_produtos_proposta: typeof item.id === "number" ? item.id : null,
        id_produto: item.id_produto,
        numero_item: idx + 1,
        codigo_produto: String(item.produto?.id_produto || item.id_produto),
        descricao: item.nome || "Item sem descrição",
        ncm: item.produto?.ncm || "49119900",
        cfop: cfopDosItens,
        unidade_comercial: "UN",
        unidade_tributavel: "UN",
        quantidade: item.quantidade,
        valor_unitario: valorUnitario,
        valor_bruto: valorBruto,
        quantidade_tributavel: item.quantidade,
        valor_unitario_tributavel: valorUnitario,
        icms_origem: 0,
        icms_situacao_tributaria: "102",
        pis_situacao_tributaria: "99",
        cofins_situacao_tributaria: "99",
        ativo: true,
        peso_unitario_gramas: pesoUnitario,
        peso_total_gramas: pesoTotal
      };
    });

    const { error: itemsError } = await client
      .from("notas_fiscais_itens")
      .insert(itemsInsert);

    if (itemsError) {
      console.error("[NfeService] Error inserting items:", itemsError);
    }
  }

  // 7. Inserir pagamentos da nota
  const formaPgtoFocus = codigoFiscalDaCobranca(tipoCobranca);

  const paymentInsert = {
    id_int: idInt,
    ref: newNfe.ref,
    id_nota_fiscal: newNfe.id,
    numero_parcela: 1,
    total_parcelas: 1,
    data_vencimento: new Date().toISOString().split("T")[0],
    valor: newNfe.valor_total_nf,
    forma_pagamento: formaPgtoFocus,
    ativo: true
  };

  const { error: paymentError } = await client
    .from("notas_fiscais_pagamentos")
    .insert(paymentInsert);

  if (paymentError) {
    console.error("[NfeService] Error inserting payment row:", paymentError);
  }

  // 8. Recalcular totais no banco
  try {
    await client.rpc("fn_recalcular_totais_nfe", { p_ref: newNfe.ref });
  } catch (err) {
    console.warn("[NfeService] fn_recalcular_totais_nfe call failed:", err);
  }

  // 9. Buscar cópia atualizada
  const freshNote = await getNfeById(newNfe.id);
  return freshNote || newNfe;
}

export async function updateNfeDraft(
  id: string,
  updates: Partial<SupabaseNfeRow>,
  items: Partial<SupabaseNfeItemRow>[],
  pagamentos: Partial<SupabaseNfePagamentoRow>[],
  /**
   * CFOP derivado da natureza da nota, ou `null` quando não há o que derivar.
   * Não vem item a item de propósito: ver o bloco no passo 2b.
   */
  cfopDosItens?: string | null
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase client not initialized" };

  try {
    // 1. Atualizar cabeçalho
    if (Object.keys(updates).length > 0) {
      const { error: headerError } = await client
        .from("notas_fiscais")
        .update(updates)
        .eq("id", id);

      if (headerError) throw headerError;
    }

    // 2. Atualizar itens
    for (const it of items) {
      if (!it.id) continue;
      const itClone = { ...it };
      delete itClone.id;
      delete itClone.id_nota_fiscal;
      delete itClone.ref;
      delete itClone.id_int;
      // O CFOP NÃO VIAJA NO PAYLOAD DO ITEM. Ver o passo 2b.
      delete itClone.cfop;

      const { error: itemError } = await client
        .from("notas_fiscais_itens")
        .update(itClone)
        .eq("id", it.id);

      if (itemError) throw itemError;
    }

    // 2b. CFOP: UM update, UM valor, TODOS os itens.
    //
    // O CFOP é da NOTA, não do item — ele deriva da natureza da operação, que é
    // do cabeçalho. Gravar por item abria o caminho para itens discordarem entre
    // si na mesma nota, que é exatamente o defeito que esta rodada fecha. Aqui
    // não há esse caminho: a coluna é escrita uma vez, por `id_nota_fiscal`.
    //
    // `null` — natureza fora do catálogo, ou UF faltando — não escreve nada e os
    // itens mantêm o CFOP que já têm.
    if (cfopDosItens) {
      const { error: cfopError } = await client
        .from("notas_fiscais_itens")
        .update({ cfop: cfopDosItens })
        .eq("id_nota_fiscal", id);

      if (cfopError) throw cfopError;
    }

    // 3. Atualizar pagamentos
    for (const pg of pagamentos) {
      if (!pg.id) continue;
      const pgClone = { ...pg };
      delete pgClone.id;
      delete pgClone.id_nota_fiscal;
      delete pgClone.ref;
      delete pgClone.id_int;

      const { error: pgError } = await client
        .from("notas_fiscais_pagamentos")
        .update(pgClone)
        .eq("id", pg.id);

      if (pgError) throw pgError;
    }

    // 4. Recalcular totais
    if (updates.ref) {
      try {
        await client.rpc("fn_recalcular_totais_nfe", { p_ref: updates.ref });
      } catch (err) {
        console.warn("[NfeService] recalcular totals failed:", err);
      }
    }

    return { success: true };
  } catch (err) {
    console.error("[NfeService] updateNfeDraft failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

interface SupabasePropostaSimple {
  id: string;
  id_int: number;
  id_cliente: number;
  cliente: string;
  valor: number;
  valor_total: number;
  vendedor: string;
  status_interno: string;
  empresa: string;
  created_at: string;
  libera_nf?: boolean | null;
}

/**
 * Nome do sócio pagador por proposta.
 *
 * Sócio de verdade é `id_faturado` apontando para OUTRO cadastro que não o
 * `id_cliente`. `id_faturado` preenchido e igual ao cliente não é sócio — é o
 * próprio, e nesses casos o mapa não recebe entrada. Uma consulta para o
 * conjunto todo: não muda a paginação de quem chama.
 */
async function buscarSociosPagadores(
  client: NonNullable<ReturnType<typeof getSupabaseClient>>,
  linhas: Array<{ id_int: number | null; id_cliente: number | null; id_faturado: number | null }>
): Promise<Map<number, string>> {
  const socioPorProposta = new Map<number, string>();

  const idsSocio = Array.from(
    new Set(
      linhas
        .filter((l) => l.id_faturado != null && l.id_cliente != null && Number(l.id_faturado) !== Number(l.id_cliente))
        .map((l) => Number(l.id_faturado))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );
  if (idsSocio.length === 0) return socioPorProposta;

  const { data, error } = await client
    .from("clientes")
    .select("id_cliente,nome,fantasia")
    .in("id_cliente", idsSocio);

  if (error) {
    console.warn("[NfeService] Nao foi possivel ler os socios pagadores:", error.message);
    return socioPorProposta;
  }

  const nomePorCliente = new Map<number, string>();
  (data ?? []).forEach((c: { id_cliente: number; nome: string | null; fantasia: string | null }) => {
    // Fantasia primeiro; sem ela, razão social — mesmo critério da Conferência.
    nomePorCliente.set(Number(c.id_cliente), (c.fantasia || c.nome || "").trim());
  });

  linhas.forEach((l) => {
    if (l.id_faturado == null || l.id_cliente == null) return;
    if (Number(l.id_faturado) === Number(l.id_cliente)) return;
    const nome = nomePorCliente.get(Number(l.id_faturado));
    if (nome) socioPorProposta.set(Number(l.id_int), nome);
  });

  return socioPorProposta;
}

/**
 * Corta da Fila de Faturamento o pedido cujo CLIENTE esta marcado para NAO
 * receber nota (`clientes.nota = false`).
 *
 * O CLIENTE DO PEDIDO, NAO O PAGADOR. Sao coisas diferentes e a distincao e
 * deliberada: o destinatario da nota e o pagador (`propostas.id_faturado`), mas
 * quem decide se aquele pedido gera nota e quem comprou. Um agenciador que paga
 * por varios clientes nao pode arrastar para a fila o pedido de um cliente que
 * o Financeiro tirou dela — nem tirar o de quem continua faturando.
 *
 * CUSTO: uma consulta a mais, com os `id_cliente` que ja vieram no SELECT das
 * propostas. Nao ha join novo nem varredura de `clientes` — e o mesmo padrao
 * das consultas de cobranca e de socio pagador que ja rodam nesta funcao.
 *
 * FALHA PARA O LADO DE MOSTRAR: se a consulta der erro, ou se o cadastro do
 * cliente nao for encontrado, a proposta FICA na fila. Esconder trabalho de quem
 * fatura e pior do que mostrar demais — mesmo criterio ja adotado na contagem de
 * notas vivas logo abaixo.
 */
async function filtrarPorNotaDoClienteDoPedido(
  client: NonNullable<ReturnType<typeof getSupabaseClient>>,
  propostas: SupabasePropostaSimple[]
): Promise<SupabasePropostaSimple[]> {
  const idsCliente = Array.from(
    new Set(
      propostas
        .map((p) => Number(p.id_cliente))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );
  if (idsCliente.length === 0) return propostas;

  const { data, error } = await client
    .from("clientes")
    .select("id_cliente,nota")
    .in("id_cliente", idsCliente);

  if (error) {
    console.warn("[NfeService] Nao foi possivel ler a flag `nota` dos clientes da fila:", error.message);
    return propostas;
  }

  const naoFatura = new Set<number>();
  (data ?? []).forEach((linha: { id_cliente: number | null; nota: boolean | null }) => {
    // Só o `false` EXPLICITO corta. `null` nao corta: a coluna e nulavel e um
    // NULL significa cadastro que nunca foi decidido, nao decisao de nao faturar.
    if (linha.nota === false) naoFatura.add(Number(linha.id_cliente));
  });

  if (naoFatura.size === 0) return propostas;
  return propostas.filter((p) => !naoFatura.has(Number(p.id_cliente)));
}

/**
 * Status de nota que NÃO tiram a proposta da fila de faturamento.
 * `RASCUNHO` acompanha `PENDENTE` porque é o mesmo estágio — é assim que
 * `getNfeActions` já os trata na tela.
 */
const STATUS_QUE_NAO_TIRAM_DA_FILA = ["CANCELADA", "DENEGADA", "PENDENTE", "RASCUNHO"];

export async function getFaturaveisPropostas(): Promise<FaturavelOrigem[]> {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("[NfeService] Supabase client absent for getFaturaveisPropostas");
    return [];
  }

  try {
    const { data, error } = await client
      .from("propostas")
      .select("id,id_int,id_cliente,cliente,valor,valor_total,vendedor,status_interno,empresa,created_at,libera_nf,id_faturado")
      .eq("libera_nf", true)
      .order("id_int", { ascending: false });

    if (error) {
      console.error("[NfeService] Error fetching faturaveis propostas:", error);
      return [];
    }

    if (!data) return [];

    const propostas = await filtrarPorNotaDoClienteDoPedido(client, data as SupabasePropostaSimple[]);

    // Quantas notas cada proposta já tem ADIANTE do rascunho. Não contam:
    //   - CANCELADA e DENEGADA, porque a proposta volta a ser faturável quando
    //     a nota morre;
    //   - PENDENTE e RASCUNHO, porque rascunho aberto é trabalho não terminado,
    //     e a fila é a lista de trabalho do Financeiro.
    // Serve para a fila esconder, por padrão, o que já saiu das mãos de quem
    // fatura — sem apagar o caminho, porque faturamento parcial é legítimo
    // (a 15720 tem 5 autorizadas).
    const idsInt = Array.from(
      new Set(propostas.map((row) => Number(row.id_int)).filter((id) => Number.isFinite(id) && id > 0))
    );

    // A forma de cobrança negociada de cada pedido, para a fila mostrar o que é
    // faturado sem abrir nada. Uma consulta para toda a fila — a paginação não
    // muda, porque a lista continua vindo inteira de `propostas`.
    const cobrancaPorProposta = new Map<number, string>();
    if (idsInt.length > 0) {
      const { data: cobrancas, error: cobrancasError } = await client
        .from("pagamentos_v2")
        .select("id_int,tipo_cobranca,created_at")
        .in("id_int", idsInt)
        .order("created_at", { ascending: true });

      if (cobrancasError) {
        console.warn("[NfeService] Nao foi possivel ler as cobrancas da fila:", cobrancasError.message);
      } else {
        // Ordem crescente: a última escrita vence, que é a cobrança mais recente.
        (cobrancas ?? []).forEach((linha: { id_int: number | null; tipo_cobranca: string | null }) => {
          const idInt = Number(linha.id_int);
          const tipo = String(linha.tipo_cobranca ?? "").trim();
          if (!Number.isFinite(idInt) || !tipo) return;
          cobrancaPorProposta.set(idInt, tipo);
        });
      }
    }

    const socioPorProposta = await buscarSociosPagadores(
      client,
      propostas.map((row) => ({
        id_int: Number(row.id_int),
        id_cliente: row.id_cliente != null ? Number(row.id_cliente) : null,
        id_faturado: (row as { id_faturado?: number | null }).id_faturado ?? null
      }))
    );

    const notasVivasPorProposta = new Map<number, number>();
    if (idsInt.length > 0) {
      const { data: notas, error: notasError } = await client
        .from("notas_fiscais")
        .select("id_int,status")
        .in("id_int", idsInt);

      if (notasError) {
        // Sem a contagem, a fila mostra tudo — o estado de hoje. Errar exibindo
        // demais é melhor do que esconder um pedido que ainda precisa de nota.
        console.warn("[NfeService] Nao foi possivel contar notas por proposta:", notasError.message);
      } else {
        (notas ?? []).forEach((nota: { id_int: number | null; status: string | null }) => {
          const status = String(nota.status ?? "").toUpperCase();
          if (STATUS_QUE_NAO_TIRAM_DA_FILA.includes(status)) return;
          const idInt = Number(nota.id_int);
          if (!Number.isFinite(idInt)) return;
          notasVivasPorProposta.set(idInt, (notasVivasPorProposta.get(idInt) ?? 0) + 1);
        });
      }
    }

    return propostas.map((row) => {
      let idEmpresa = 1;
      const empresaStr = (row.empresa || "").toUpperCase();
      if (empresaStr.includes("BIRO") || empresaStr.includes("BIRÔ")) {
        idEmpresa = 2;
      } else if (empresaStr.includes("E3")) {
        idEmpresa = 3;
      }

      const valorTotal = Number(row.valor_total) || Number(row.valor) || 0;

      return {
        id: `prop-${row.id}`,
        tipo: "PEDIDO",
        ref_origem: `#${row.id_int}`,
        id_cliente: Number(row.id_cliente),
        cliente_nome: String(row.cliente || "").trim(),
        cliente_fantasia: String(row.cliente || "").trim(),
        id_empresa: idEmpresa,
        status: "PENDENTE",
        valor_total: valorTotal,
        itens: [],
        created_at: row.created_at || new Date().toISOString(),
        notas_vivas: notasVivasPorProposta.get(Number(row.id_int)) ?? 0,
        tipo_cobranca: cobrancaPorProposta.get(Number(row.id_int)),
        vendedor: String(row.vendedor || "").trim(),
        status_interno: String(row.status_interno || "").trim(),
        socio_pagador_nome: socioPorProposta.get(Number(row.id_int)) ?? null
      };
    });
  } catch (err) {
    console.error("[NfeService] Exception in getFaturaveisPropostas:", err);
    return [];
  }
}

export async function trocarEmpresaNfe(
  ref: string,
  idEmpresa: number,
  usuario: string
): Promise<{ ok: boolean; mensagem?: string; error?: string }> {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client not initialized");
  const { data, error } = await client.rpc("fn_trocar_empresa_nfe", {
    p_ref: ref,
    p_id_empresa: idEmpresa,
    p_usuario: usuario
  });
  if (error) throw error;
  return data;
}

/** Data de hoje no fuso local, em YYYY-MM-DD. */
function hojeLocalIso(): string {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

export type GerarPagamentosNfeOpcoes = {
  /** Parcela única com vencimento escolhido (YYYY-MM-DD). Ignora qtd/dias/intervalo. */
  vencimentoUnico?: string | null;
  /** Valor inteiro por parcela, com a diferença na última. Só vale de 2 parcelas em diante. */
  arredondar?: boolean;
};

/**
 * Gera as parcelas fiscais da nota. O cálculo é do servidor — esta função só
 * repassa os parâmetros para `fn_gerar_pagamentos_nfe`.
 *
 * `p_data_base` vai sempre com HOJE. Antes a RPC contava os dias a partir de
 * `notas_fiscais.created_at`, então uma nota criada há duas semanas gerava a
 * primeira parcela já vencida ou quase. O modal Preparar Cobrança sempre contou
 * a partir de hoje; a aba passa a fazer o mesmo. O default `null` da RPC segue
 * preservando o comportamento antigo para qualquer chamador que não mande nada.
 */
export async function gerarPagamentosNfe(
  ref: string,
  valorEntrada: number,
  qtdParcelas: number,
  diasPraInicio: number,
  intervalo: number,
  formaPagamento: string,
  opcoes?: GerarPagamentosNfeOpcoes
): Promise<{ ok: boolean; mensagem?: string; error?: string }> {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client not initialized");
  const { data, error } = await client.rpc("fn_gerar_pagamentos_nfe", {
    p_ref: ref,
    p_valor_entrada: valorEntrada,
    p_qtd_parcelas: qtdParcelas,
    p_dias_pra_inicio: diasPraInicio,
    p_intervalo: intervalo,
    p_forma_pagamento: formaPagamento,
    p_vencimento_unico: opcoes?.vencimentoUnico || null,
    p_arredondar: Boolean(opcoes?.arredondar),
    p_data_base: hojeLocalIso()
  });
  if (error) throw error;
  return data;
}

/** Título de contas a receber já lançado, usado como sugestão de vencimento. */
export type BoletoAtivoDaProposta = {
  id: string;
  parcela: number;
  total_parcelas: number | null;
  valor: number;
  vencimento: string;
  status: string | null;
  n_nf: string | null;
};

/**
 * Títulos ATIVOS da proposta, para sugerir vencimentos na aba Pagamentos.
 *
 * "Ativo" usa o mesmo predicado dos índices `boletos_unico_parcela_ativo` e
 * `idx_boletos_n_doc_boleto_ativo`: tudo que não é CANCELADO, com status nulo
 * contando como ativo. Divergir dessa normalização faria a tela sugerir a partir
 * de um título que o banco considera morto — ou ignorar um que ele considera vivo.
 *
 * Uma consulta só, por `id_int`. Nunca por linha.
 */
export async function getBoletosAtivosDaProposta(idInt: number): Promise<BoletoAtivoDaProposta[]> {
  const client = getSupabaseClient();
  if (!client || !Number.isFinite(idInt) || idInt <= 0) return [];

  const { data, error } = await client
    .from("boletos")
    .select("id, parcela, total_parcelas, valor, vencimento, status, n_nf")
    .eq("id_int", idInt)
    .order("parcela", { ascending: true });

  if (error) {
    console.error("[NfeService] getBoletosAtivosDaProposta failed:", error);
    return [];
  }

  return (data || [])
    .filter((linha) => String(linha.status ?? "").trim().toUpperCase() !== "CANCELADO")
    .map((linha) => ({
      id: String(linha.id),
      parcela: Number(linha.parcela) || 0,
      total_parcelas: linha.total_parcelas === null ? null : Number(linha.total_parcelas),
      valor: Number(linha.valor) || 0,
      vencimento: String(linha.vencimento ?? "").split("T")[0],
      status: linha.status === null ? null : String(linha.status),
      n_nf: linha.n_nf === null ? null : String(linha.n_nf)
    }));
}

/** Uma opção de natureza da operação, como o catálogo a guarda. */
export type NaturezaOperacaoNfe = {
  id: number;
  cfop: string;
  /** Rótulo com o CFOP na frente — vai inteiro para `drop_natureza_op`. */
  descricao: string;
  /** `descricao` sem o prefixo `NNNN - ` — é o que vai para `natureza_operacao`. */
  natureza: string;
  /** `VENDA`, `OUTRA_SAIDA`, `DEVOLUCAO`. Metade da chave do par de CFOP. */
  tipoOperacao: string;
  /** `INTERNA` ou `INTERESTADUAL`. A outra metade. */
  destinoOperacao: string;
};

/** Tira o prefixo de CFOP do rótulo. Mesma derivação de `fn_sync_natureza_operacao_nfe`. */
export function naturezaSemPrefixoCfop(descricao: string): string {
  return String(descricao ?? "").replace(/^\s*\d{4}\s*-\s*/, "").trim();
}

/**
 * As naturezas de operação disponíveis para NF-e.
 *
 * Fonte única: `nfe_naturezas_operacao`. O texto NÃO é literal no código — havia
 * três grafias para a mesma ideia (o código, a trigger de defaults e o catálogo),
 * e duas delas viviam fora da tabela feita para isso.
 *
 * `natureza` sai de `descricao` sem o prefixo, e não de `observacao`: naquela
 * coluna, 5949 e 6949 guardam INSTRUÇÃO AO OPERADOR ("USAR SOMENTE QUANDO NÃO
 * HOUVER CFOP MAIS ESPECÍFICO"), que não pode ir no campo natOp da nota.
 *
 * ---------------------------------------------------------------------------
 * FILTRO PROVISÓRIO: só `tipo_operacao = 'VENDA'` (28/08/2026)
 *
 * O catálogo tem 8 naturezas de NF-e; esta função devolve 4. Ficam de fora
 * 5949/6949 (OUTRA_SAIDA) e 1202/2202 (DEVOLUCAO).
 *
 * POR QUÊ: a tributação dos itens é fixa no código — CSOSN `102`, PIS/COFINS
 * `99`, origem `0`, em `createOrReuseNfeDraft` e em `NfeDetailPage`. Todos os
 * itens do banco têm exatamente esses valores. CSOSN 102 é operação de VENDA
 * tributada pelo Simples: emitir uma remessa ou uma devolução com ele declara
 * como venda tributada algo que não é venda.
 *
 * A SEFAZ não valida CST contra CFOP nem contra natOp, então a nota seria
 * ACEITA e ficaria errada — o que é pior que rejeitada, porque o conserto é
 * carta de correção ou cancelamento. Oferecer a opção na tela seria oferecer
 * esse erro.
 *
 * O CST correto de cada operação está com o contador e ainda não voltou.
 *
 * PARA REMOVER quando a definição fiscal chegar: apagar a linha marcada
 * `<< FILTRO PROVISÓRIO >>` abaixo e o aviso em `NfeDetailPage` que aponta para
 * este comentário. Nada mais depende dele — o catálogo nunca foi tocado, as
 * 8 linhas seguem ativas no banco.
 * ---------------------------------------------------------------------------
 */
export async function getNaturezasOperacaoNfe(): Promise<NaturezaOperacaoNfe[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from("nfe_naturezas_operacao")
    // `tipo_operacao` e `destino_operacao` alimentam `cfopDaNatureza`. Colunas
    // que já existiam: nenhuma migration, nenhum campo novo.
    .select("id, cfop, descricao, tipo_operacao, destino_operacao")
    .eq("modelo_fiscal", "NFE")
    .eq("ativo", true)
    // << FILTRO PROVISÓRIO >> ver o bloco no cabeçalho desta função.
    .eq("tipo_operacao", "VENDA")
    .order("cfop", { ascending: true });

  if (error) {
    console.error("[NfeService] Erro ao carregar naturezas de operacao:", error);
    return [];
  }

  return (data ?? []).map((linha) => ({
    id: Number(linha.id),
    cfop: String(linha.cfop ?? ""),
    descricao: String(linha.descricao ?? ""),
    natureza: naturezaSemPrefixoCfop(String(linha.descricao ?? "")),
    tipoOperacao: String(linha.tipo_operacao ?? ""),
    destinoOperacao: String(linha.destino_operacao ?? "")
  }));
}

export async function getTransportadoras() {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from("clientes")
    .select("id_cliente, nome, fantasia, documento, cidade_uf")
    .eq("categoria", "TRANSPORTADORA")
    .eq("ativo", true);
  if (error) {
    console.error("[NfeService] Error fetching transportadoras:", error);
    return [];
  }
  return data || [];
}

export async function insertNfeItem(
  item: Omit<SupabaseNfeItemRow, "id" | "editado_manualmente">
): Promise<SupabaseNfeItemRow | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from("notas_fiscais_itens")
    .insert({
      ...item,
      ativo: true
    })
    .select("*")
    .single();
  if (error) {
    console.error("[NfeService] Error inserting item:", error);
    return null;
  }
  return data;
}

export async function deleteNfeItem(id: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;
  const { error } = await client
    .from("notas_fiscais_itens")
    .delete()
    .eq("id", id);
  if (error) {
    console.error("[NfeService] Error deleting item:", error);
    return false;
  }
  return true;
}

export async function recalcularTotaisNfe(ref: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;
  const { error } = await client.rpc("fn_recalcular_totais_nfe", { p_ref: ref });
  if (error) {
    console.error("[NfeService] Error calling fn_recalcular_totais_nfe:", error);
    return false;
  }
  return true;
}

export interface SimpleProduct {
  id_produto: number;
  nomeReal: string;
  ncm: string | null;
  und_medida: string | null;
  unidade_comercial: string | null;
  valorUnt: number | null;
  peso: number | null;
  ativo: boolean;
}

export async function searchActiveProducts(): Promise<SimpleProduct[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from("produtos")
    .select("id_produto, nomeReal, ncm, und_medida, unidade_comercial, valorUnt, peso, ativo")
    .eq("ativo", true)
    .order("id_produto", { ascending: true });
  if (error) {
    console.error("[NfeService] Error searching active products:", error);
    return [];
  }
  return data || [];
}

export async function updateNfeItem(
  itemId: string,
  ref: string,
  itemUpdates: Partial<SupabaseNfeItemRow>
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase client not initialized" };

  try {
    const { error } = await client
      .from("notas_fiscais_itens")
      .update(itemUpdates)
      .eq("id", itemId);

    if (error) throw error;

    // Recalcular totais no banco
    await recalcularTotaisNfe(ref);
    return { success: true };
  } catch (err) {
    console.error("[NfeService] updateNfeItem failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function recreateSinglePayment(
  idNotaFiscal: string,
  ref: string,
  idInt: number,
  valorTotal: number,
  formaPagamento: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase client not initialized" };

  try {
    // 1. Soft-delete (set ativo = false) existing payments for the note
    const { error: updateError } = await client
      .from("notas_fiscais_pagamentos")
      .update({ ativo: false })
      .eq("id_nota_fiscal", idNotaFiscal);

    if (updateError) throw updateError;

    // 2. Insert new single à vista payment
    const paymentInsert = {
      id_int: idInt,
      ref: ref,
      id_nota_fiscal: idNotaFiscal,
      numero_parcela: 1,
      total_parcelas: 1,
      data_vencimento: new Date().toISOString().split("T")[0],
      valor: valorTotal,
      forma_pagamento: formaPagamento,
      ativo: true
    };

    const { error: insertError } = await client
      .from("notas_fiscais_pagamentos")
      .insert(paymentInsert);

    if (insertError) throw insertError;

    return { success: true };
  } catch (err) {
    console.error("[NfeService] recreateSinglePayment failed:", err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function previewNfeRascunho(ref: string): Promise<{ success: boolean; url?: string; blob?: Blob; error?: string }> {
  try {
    const response = await fetch("/api/nfe/preview", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ref })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { success: false, error: errorData.error || `Erro HTTP: ${response.status}` };
    }

    const data = await response.json();
    if (data && (data.url_pdf || data.url || data.ok)) {
      return { success: true, url: data.url_pdf || data.url };
    } else {
      return { success: false, error: data.mensagem || data.error || "A resposta da função não conteve uma URL de preview." };
    }
  } catch (err) {
    console.error("[NfeService] previewNfeRascunho proxy failed:", err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function invalidateNfePayments(idNotaFiscal: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;
  
  try {
    const { error } = await client
      .from("notas_fiscais_pagamentos")
      .update({ ativo: false })
      .eq("id_nota_fiscal", idNotaFiscal);
      
    if (error) {
      console.error("[NfeService] Invalidate payments failed:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[NfeService] Invalidate payments failed:", err);
    return false;
  }
}

export async function getNfeFinanceiroStatus(refs: string[]) {
  const client = getSupabaseClient();
  if (!client || refs.length === 0) {
    return { paymentsCountMap: {}, boletosMap: {} };
  }

  try {
    // Buscar contagem de vencimentos ativos por ref
    const { data: paymentsData, error: paymentsError } = await client
      .from("notas_fiscais_pagamentos")
      .select("ref, id")
      .in("ref", refs)
      .eq("ativo", true);

    if (paymentsError) {
      console.error("[NfeService] Error fetching payments count:", paymentsError);
    }

    // Buscar boletos correspondentes com todos os campos necessários para a revisão
    const { data: boletosData, error: boletosError } = await client
      .from("boletos")
      .select("id, id_int, ext_reference, valor, parcela, total_parcelas, vencimento, status, deposito_conta, id_boleto_c6, nosso_numero, linha_digitavel, multa, juros_dia, descricao, nome_cliente, documento, id_cliente, id_empresa, n_nf, is_faturado")
      .in("ext_reference", refs);

    if (boletosError) {
      console.error("[NfeService] Error fetching boletos:", boletosError);
    }

    const paymentsCountMap: Record<string, number> = {};
    paymentsData?.forEach((p) => {
      if (p.ref) {
        paymentsCountMap[p.ref] = (paymentsCountMap[p.ref] || 0) + 1;
      }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const boletosMap: Record<string, any[]> = {};
    boletosData?.forEach((b) => {
      const ref = b.ext_reference as string;
      if (ref) {
        if (!boletosMap[ref]) {
          boletosMap[ref] = [];
        }
        boletosMap[ref].push(b);
      }
    });

    return { paymentsCountMap, boletosMap };
  } catch (err) {
    console.error("[NfeService] getNfeFinanceiroStatus failed:", err);
    return { paymentsCountMap: {}, boletosMap: {} };
  }
}

/**
 * Tipos de `pagamentos_v2.tipo_cobranca` que representam venda faturada — a
 * única que vira título em contas a receber. PIX, cartão, crédito e boleto à
 * vista se resolvem no próprio checkout e não entram aqui.
 *
 * O banco guarda grafias mistas ("E-FATURADO" e "E-Faturado") e underscore,
 * então a comparação é sempre sobre a forma normalizada.
 */
const TIPOS_COBRANCA_FATURADA = new Set([
  "E-FATURADO",
  "FATURADO",
  "E-RETRABALHO",
  "E-PERMUTA",
  "E-AMOSTRA"
]);

/** Status em que a cobrança não está mais em aberto. */
const STATUS_COBRANCA_QUITADA_OU_MORTA = new Set([
  "PAID",
  "CANCELADO",
  "CANCELADA",
  "EXTORNADO",
  "RECUSADO"
]);

const normalizarTipoCobranca = (valor: unknown): string =>
  String(valor ?? "").trim().toUpperCase().replace(/_/g, "-");

export type FaturadoEmAberto = {
  /** Quantas cobranças faturadas não pagas existem para o id_int. */
  qtd: number;
  /** Soma dos valores dessas cobranças — o total que o título tem de fechar. */
  soma: number;
};

/**
 * Total faturado EM ABERTO por proposta (`id_int`).
 *
 * Serve a duas coisas em NotasFiscaisPage: decidir se a nota pode oferecer
 * "Lançar no Contas a Receber" (só venda faturada oferece) e dar o total contra
 * o qual a soma das parcelas fiscais é conferida.
 *
 * A conferência é por TOTAIS do id_int, não por cobrança individual: a mesma
 * venda pode ter sido dividida em vários pagamentos, e o que precisa fechar é a
 * soma.
 */
export async function getFaturadoEmAbertoPorIdInt(
  idInts: number[]
): Promise<Record<number, FaturadoEmAberto>> {
  const client = getSupabaseClient();
  const mapa: Record<number, FaturadoEmAberto> = {};
  if (!client || idInts.length === 0) return mapa;

  const unicos = Array.from(new Set(idInts.filter((n) => Number.isFinite(n) && n > 0)));
  const LOTE = 200;

  for (let i = 0; i < unicos.length; i += LOTE) {
    const lote = unicos.slice(i, i + LOTE);
    const { data, error } = await client
      .from("pagamentos_v2")
      .select("id_int, valor, tipo_cobranca, status, paid_at")
      .in("id_int", lote)
      .returns<Array<{ id_int: number | null; valor: number | null; tipo_cobranca: string | null; status: string | null; paid_at: string | null }>>();

    if (error) {
      console.error("[NfeService] getFaturadoEmAbertoPorIdInt failed:", error);
      return mapa;
    }

    for (const linha of data || []) {
      const idInt = Number(linha.id_int);
      if (!Number.isFinite(idInt) || idInt <= 0) continue;
      if (!TIPOS_COBRANCA_FATURADA.has(normalizarTipoCobranca(linha.tipo_cobranca))) continue;
      if (STATUS_COBRANCA_QUITADA_OU_MORTA.has(String(linha.status ?? "").trim().toUpperCase())) continue;
      if (linha.paid_at) continue;

      const atual = mapa[idInt] || { qtd: 0, soma: 0 };
      atual.qtd += 1;
      atual.soma = Math.round((atual.soma + (Number(linha.valor) || 0)) * 100) / 100;
      mapa[idInt] = atual;
    }
  }

  return mapa;
}

export async function updateBoletoInDb(
  id: string,
  updates: {
    vencimento?: string;
    valor?: number;
    descricao?: string;
    deposito_conta?: boolean;
    multa?: number | null;
    juros_dia?: number | null;
  }
) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client not initialized");

  // Whitelist rígida dos campos editáveis para impedir alterações acidentais de campos bancários
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cleanUpdates: Record<string, any> = {};
  const allowed = ["vencimento", "valor", "descricao", "deposito_conta", "multa", "juros_dia"];
  for (const key of allowed) {
    if (key in updates) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cleanUpdates[key] = (updates as any)[key];
    }
  }

  const { data, error } = await client
    .from("boletos")
    .update(cleanUpdates)
    .eq("id", id)
    .select("*");

  if (error) throw error;
  return data;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

/**
 * Chama uma rota server-side de título faturado. O servidor relê `id_empresa`
 * no banco e decide o provedor — o cliente não escolhe.
 *
 * `delegarLegado: true` significa empresa 1 ou 3: o chamador segue no fluxo
 * antigo, sem nenhuma alteração de comportamento.
 */
async function chamarRotaBoletoFaturado(rota: string, corpo: Record<string, unknown>) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client not initialized");

  const sessao = await client.auth.getSession();
  const token = sessao.data.session?.access_token || "";

  const resposta = await fetch(rota, {
    method: "POST",
    headers: { "content-type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify(corpo)
  });

  const resultado = await resposta.json().catch(() => null);

  if (!resposta.ok || !resultado?.success) {
    throw new Error(resultado?.message || "Falha na operação bancária do título faturado.");
  }

  return resultado as { success: true; delegarLegado?: boolean; data?: Record<string, unknown> };
}

export async function registerBoletoViaN8n(boleto: SupabaseBoletoRow, overrideEmail?: string) {
  // Roteamento por empresa, decidido no servidor com o id_empresa do banco.
  // Empresa 2 (Ideal Birô) emite pelo Inter e retorna aqui; 1 e 3 caem no
  // `delegarLegado` e seguem exatamente o fluxo abaixo, inalterado.
  const roteamento = await chamarRotaBoletoFaturado("/api/cobrancas/registrar-boleto-faturado", {
    boletoId: boleto.id,
    overrideEmail
  });

  if (!roteamento.delegarLegado) {
    return { success: true, data: roteamento.data || {} };
  }

  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client not initialized");

  // 1. Fetch Client email and details
  let email = "";
  if (boleto.id_cliente) {
    const { data: cliData } = await client
      .from("clientes")
      .select("email, email_financeiro, email_contato")
      .eq("id_cliente", boleto.id_cliente)
      .maybeSingle();

    if (cliData) {
      email = (String(cliData.email_financeiro || cliData.email || cliData.email_contato || "")).trim();
    }
  }

  // Fallback de E-mail do ERP se override não foi passado
  if (!email || !isValidEmail(email)) {
    if (overrideEmail && isValidEmail(overrideEmail)) {
      email = overrideEmail;
    } else {
      if (boleto.id_empresa === 1) {
        email = "financeiro@ingressoideal.com.br";
      } else if (boleto.id_empresa === 3) {
        email = "financeiro@e3brindes.com.br";
      } else {
        email = "financeiro@pay-ideal.com.br";
      }
    }
  }

  // Validação do email
  if (!email || !isValidEmail(email)) {
    throw new Error("O e-mail do cliente é inválido e nenhum e-mail de fallback pôde ser determinado.");
  }

  // 2. Fetch Client address
  let address = {
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: "",
    cep: ""
  };

  if (boleto.id_cliente) {
    // Try principal first
    let { data: addrData } = await client
      .from("enderecos")
      .select("endereco, numero, complemento, bairro, cidade, uf, cep")
      .eq("id_cliente", boleto.id_cliente)
      .eq("tipo_endereco", "Principal")
      .maybeSingle();

    if (!addrData) {
      // Fallback to any address
      const { data: fallbackAddr } = await client
        .from("enderecos")
        .select("endereco, numero, complemento, bairro, cidade, uf, cep")
        .eq("id_cliente", boleto.id_cliente)
        .limit(1);

      if (fallbackAddr && fallbackAddr.length > 0) {
        addrData = fallbackAddr[0];
      }
    }

    if (addrData) {
      address = {
        logradouro: addrData.endereco || "",
        numero: addrData.numero || "",
        complemento: addrData.complemento || "",
        bairro: addrData.bairro || "",
        cidade: addrData.cidade || "",
        uf: addrData.uf || "",
        cep: addrData.cep ? String(addrData.cep).replace(/\D/g, "") : ""
      };
    }
  }

  // Validação dos campos obrigatórios de endereço
  if (!address.logradouro) {
    throw new Error("Logradouro do cliente está pendente.");
  }
  if (!address.numero) {
    throw new Error("Número do endereço do cliente está pendente.");
  }
  if (!address.cidade) {
    throw new Error("Cidade do cliente está pendente.");
  }
  if (!address.uf) {
    throw new Error("UF do cliente está pendente.");
  }
  if (!address.cep) {
    throw new Error("CEP do cliente está pendente.");
  }
  if (address.cep.length !== 8) {
    throw new Error("CEP do cliente é inválido (deve conter exatamente 8 dígitos).");
  }

  // 3. Prepare payload
  if (!boleto.documento) {
    throw new Error("Documento do cliente está pendente.");
  }
  const documentoDigits = String(boleto.documento).replace(/\D/g, "");
  if (!documentoDigits) {
    throw new Error("Documento do cliente é inválido ou vazio (deve conter apenas dígitos).");
  }
  if (documentoDigits.length !== 11 && documentoDigits.length !== 14) {
    throw new Error("Documento do cliente é inválido (deve conter 11 dígitos para CPF ou 14 dígitos para CNPJ).");
  }

  const n_nfStr = boleto.n_nf ? String(boleto.n_nf) : "";
  const extReference = boleto.ext_reference || "";

  const payload = {
    boleto_id: boleto.id,
    ext_reference: extReference,
    id_empresa: boleto.id_empresa ? Number(boleto.id_empresa) : 0,
    id_cliente: boleto.id_cliente ? Number(boleto.id_cliente) : 0,
    id_int: boleto.id_int ? Number(boleto.id_int) : 0,
    n_nf: n_nfStr,
    parcela: boleto.parcela ? Number(boleto.parcela) : 1,
    total_parcelas: boleto.total_parcelas ? Number(boleto.total_parcelas) : 1,
    valor: boleto.valor ? Number(boleto.valor) : 0,
    vencimento: boleto.vencimento ? String(boleto.vencimento).slice(0, 10) : "",
    nome_cliente: boleto.nome_cliente || "",
    documento: documentoDigits,
    email: email,
    endereco: address,
    multa_percentual: boleto.multa ? Number(boleto.multa) : 0,
    juros_dia_percentual: boleto.juros_dia ? Number(boleto.juros_dia) : 0,
    instrucoes: [
      `Parcela ${boleto.parcela || 1}/${boleto.total_parcelas || 1} - NF ${n_nfStr || "S/N"} - Ref ${extReference}`
    ]
  };

  // 4. Send request
  const response = await fetch("https://10074.hostoo.net.br/webhook/boletos-vibe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Erro no processamento do registro do boleto: ${response.statusText}`);
  }

  // Check response
  let resData;
  try {
    resData = await response.json();
  } catch {
    throw new Error("A resposta do servidor não é um JSON válido.");
  }

  if (!resData) {
    throw new Error("Resposta do banco vazia ou inválida.");
  }

  if (resData.error || resData.message || resData.status === "error" || resData.success === false) {
    throw new Error(
      mensagemDoRetornoBancario(resData.error ?? resData.message, "Erro retornado pelo webhook.")
    );
  }

  return { success: true, data: resData };
}

/**
 * Mensagem legível a partir do que o webhook devolveu.
 *
 * O n8n responde ora `{ message }`, ora o objeto de erro cru do banco
 * (`{ error: { message } }`). No segundo caso `new Error(objeto)` vira
 * "[object Object]" na tela — foi o que o usuário viu quando o C6 recusou o
 * cancelamento do título 323976692 por situação do título: erro na tela, sem
 * uma palavra sobre o motivo.
 *
 * Os bancos ainda embutem o motivo real num JSON escapado dentro da própria
 * mensagem (`400 - "{...\"detail\":\"...\"}"`), então o `detail` é extraído
 * quando existe.
 */
function mensagemDoRetornoBancario(valor: unknown, padrao: string): string {
  if (typeof valor === "string" && valor.trim()) return valor.trim();

  if (valor && typeof valor === "object") {
    const obj = valor as { message?: unknown; detail?: unknown; description?: unknown };
    const texto = String(obj.detail ?? obj.message ?? obj.description ?? "").trim();
    if (texto) {
      const limpo = texto.split("\\").join("");
      const detalhe = limpo.match(/"detail"\s*:\s*"([^"]+)"/);
      const titulo = limpo.match(/"title"\s*:\s*"([^"]+)"/);
      return String(detalhe?.[1] ?? titulo?.[1] ?? texto).trim().slice(0, 400);
    }
  }

  return padrao;
}

export async function deleteBoletoFromBankViaN8n(
  boletoId: string,
  idBoletoC6: string,
  idEmpresa: number,
  motivo?: string
) {
  // Mesmo roteamento server-side do registro. O `idEmpresa` recebido aqui é
  // apenas informativo: quem decide é o servidor, relendo do banco.
  const roteamento = await chamarRotaBoletoFaturado("/api/cobrancas/cancelar-boleto-faturado", {
    boletoId,
    motivo: String(motivo || "").trim() || "Cancelamento solicitado no Registro de Recebiveis."
  });

  if (!roteamento.delegarLegado) {
    return { success: true, data: roteamento as Record<string, unknown> };
  }

  const response = await fetch("https://10074.hostoo.net.br/webhook/del-boleto-vibe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      boleto_id: boletoId,
      cod_C6: idBoletoC6,
      id_empresa: idEmpresa
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    let legivel = "";
    try {
      legivel = mensagemDoRetornoBancario(JSON.parse(errorText), "");
    } catch {
      legivel = "";
    }
    return await resolverRecusaDoBanco(
      legivel || errorText || `Erro no processamento da exclusão do boleto: ${response.statusText}`,
      boletoId
    );
  }

  let resData;
  try {
    resData = await response.json();
  } catch {
    throw new Error("A resposta do servidor não é um JSON válido.");
  }

  if (!resData) {
    throw new Error("Resposta do banco vazia ou inválida.");
  }

  if (resData.error || resData.message || resData.status === "error" || resData.success === false) {
    return await resolverRecusaDoBanco(
      mensagemDoRetornoBancario(resData.error ?? resData.message, "Erro retornado pelo webhook."),
      boletoId
    );
  }

  return { success: true, data: resData };
}

/**
 * O banco dá baixa automática no boleto alguns dias depois do vencimento. A
 * partir daí ele recusa o cancelamento — não existe mais título ativo para
 * cancelar.
 *
 * Isso NÃO é falha: o objetivo, tirar o boleto de circulação, já está cumprido.
 * Tratar como erro deixava o financeiro sem saída no caso mais comum (cliente
 * não paga no vencimento e depois quer pagar por PIX) e obrigava a corrigir o
 * banco de dados na mão.
 *
 * A DECISÃO MUDOU DE LUGAR EM 26/08/2026. Ela vivia aqui, no cliente: o
 * predicado da recusa, a consulta de pagamento e a conclusão. Agora quem decide
 * é `POST /api/cobrancas/titulo-inativo-no-banco`, no servidor — inclusive a
 * confirmação de que não houve pagamento, que é o que separa "saiu de
 * circulação" de "foi pago". Esta função só RELATA a recusa do banco.
 *
 * O webhook do C6 continua sendo chamado daqui porque trazê-lo para o servidor
 * é rodada própria; por isso o relato precisa existir.
 */
async function resolverRecusaDoBanco(motivo: string, boletoId: string) {
  const client = getSupabaseClient();
  if (!client) throw new Error(motivo);

  const sessao = await client.auth.getSession();
  const token = sessao.data.session?.access_token || "";
  if (!token) throw new Error(motivo);

  const resposta = await fetch("/api/cobrancas/titulo-inativo-no-banco", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ boletoId, motivoRecusa: motivo })
  });

  const dados = await resposta.json().catch(() => null);

  if (!resposta.ok || !dados?.success) {
    // Inclui o caso em que a recusa NÃO é de inatividade: aí é erro mesmo, e o
    // servidor devolve a mensagem que o operador precisa ler.
    throw new Error(dados?.message || motivo);
  }

  console.warn(`[deleteBoletoFromBankViaN8n] ${boletoId}: título já inativo no banco, cancelado no ERP.`);
  return { success: true, jaInativoNoBanco: true, data: dados };
}

export function getNfeDisplayStatus(note: {
  status?: string | null;
  erro_codigo?: string | null;
  status_focus?: string | null;
  status_sefaz?: string | null;
}) {
  if (
    (note.status || "").toUpperCase() === "RETORNO_FOCUS" &&
    note.erro_codigo &&
    !note.status_focus &&
    !note.status_sefaz
  ) {
    return "FALHA_INTEGRACAO";
  }
  return note.status || "PENDENTE";
}

export interface SupabaseNotaEventoRow {
  id?: string;
  tipo_documento: "NFE" | "NFSE";
  ref: string;
  tipo_evento: "AUTORIZACAO" | "REJEICAO" | "CONSULTA" | "WEBHOOK" | "CARTA_CORRECAO" | "CANCELAMENTO" | "INUTILIZACAO";
  sequencia_evento?: number | null;
  status_evento?: string | null;
  status_sefaz?: string | null;
  mensagem_sefaz?: string | null;
  caminho_xml?: string | null;
  caminho_pdf?: string | null;
  url_xml?: string | null;
  url_pdf?: string | null;
  justificativa?: string | null;
  correcao?: string | null;
  payload_envio?: Record<string, unknown> | null;
  payload_retorno?: Record<string, unknown> | null;
  origem?: string | null;
  criado_por?: string | null;
  criado_por_nome?: string | null;
  created_at?: string;
}

export async function insertNotaEvento(
  payload: Partial<SupabaseNotaEventoRow>
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    const { error } = await client
      .from("notas_eventos")
      .insert(payload);

    if (error) {
      console.error("[NfeService] insertNotaEvento failed:", error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[NfeService] insertNotaEvento exception:", err);
    return false;
  }
}

export async function getNotaEventos(tipoDocumento: "NFE" | "NFSE", ref: string): Promise<SupabaseNotaEventoRow[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from("notas_eventos")
      .select("*")
      .eq("tipo_documento", tipoDocumento)
      .eq("ref", ref)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("[NfeService] getNotaEventos failed:", err);
    return [];
  }
}

export async function getNotaEventosForRefs(
  tipoDocumento: "NFE" | "NFSE",
  refs: string[]
): Promise<SupabaseNotaEventoRow[]> {
  const client = getSupabaseClient();
  if (!client || refs.length === 0) return [];

  try {
    const { data, error } = await client
      .from("notas_eventos")
      .select("*")
      .eq("tipo_documento", tipoDocumento)
      .in("ref", refs)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("[NfeService] getNotaEventosForRefs failed:", err);
    return [];
  }
}






