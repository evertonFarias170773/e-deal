import { getSupabaseClient } from "@/lib/supabase/client";
import { normalizarTipoFrete } from "../lib/tipo-frete";
import { resolverPesoExpedicao } from "../lib/peso";
import type {
  EtapaExpedicao,
  ExpedicaoRegistro,
  ModalidadeFrete,
  NfStatusExpedicao,
  PedidoExpedicao,
  TipoFreteNormalizado
} from "../types";

/**
 * Universo do painel: tudo que está aprovado para produção (is_prd_aprovado)
 * do APROVADO até a entrega. EXPEDICAO em diante é o fluxo oficial da doc
 * FLUXO-OFICIAL-STATUS-PROPOSTAS.md §6.13.
 */
export const STATUS_FUNIL_EXPEDICAO = [
  "APROVADO",
  "LIBERADO",
  "REVISAO ATENDENTE",
  "REVISAO PRODUCAO",
  "EM PRODUCAO",
  "EM IMPRESSAO",
  "EM IMPRESSAO / PENDENTE",
  "EM ACABAMENTO",
  "EM ACABAMENTO / PENDENTE",
  "EXPEDICAO",
  "A RETIRAR",
  "EM TRANSITO",
  "ENTREGUE"
];

/** Entregues somem do painel depois de 30 dias (expedicoes.data_entrega). */
const DIAS_ENTREGUE_VISIVEL = 30;

export function hojeSaoPaulo(): string {
  // en-CA formata como YYYY-MM-DD, comparável por string.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** Converte um instante ISO para a data-calendário (YYYY-MM-DD) em America/Sao_Paulo. */
function diaSaoPaulo(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
}

function etapaDoStatus(status: string): EtapaExpedicao {
  if (status === "EXPEDICAO") return "PRONTO";
  if (status === "A RETIRAR") return "A_RETIRAR";
  if (status === "EM TRANSITO") return "EM_TRANSITO";
  if (status === "ENTREGUE") return "ENTREGUE";
  if (status.startsWith("EM ACABAMENTO")) return "ACABAMENTO";
  return "PRODUCAO";
}

/** Diferença em dias entre duas datas YYYY-MM-DD (b - a). */
function diffDias(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

export async function listarPainelExpedicao(): Promise<PedidoExpedicao[]> {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("[expedicao.service] Supabase client não inicializado.");
    return [];
  }

  // 1. Propostas do funil
  const { data: propostas, error: propError } = await client
    .from("propostas")
    .select(
      "id_int, cliente, id_cliente, empresa, status_interno, libera_nf, volume, modalidade_frete, id_transportadora_cliente"
    )
    .eq("is_prd_aprovado", true)
    .in("status_interno", STATUS_FUNIL_EXPEDICAO)
    .order("id_int", { ascending: false });

  if (propError || !propostas) {
    console.error("[expedicao.service] Erro ao buscar propostas:", propError);
    return [];
  }
  if (propostas.length === 0) return [];

  const ids = propostas.map((p) => Number(p.id_int));
  const idsCliente = Array.from(
    new Set(propostas.map((p) => Number(p.id_cliente)).filter((n) => Number.isFinite(n) && n > 0))
  );

  // 2..6 em paralelo — cada bloco é tolerante a falha individual (warn + vazio),
  // MENOS cotacao_frete, cujo erro é logado com destaque (foi o bug da tela antiga).
  const [osRes, fretesRes, nfsRes, expRes, clientesRes, pesosRes] = await Promise.all([
    client
      .from("propostas_os")
      .select("id_int, data_termino, codigo_rastreamento, obs")
      .in("id_int", ids),
    client
      .from("cotacao_frete")
      .select("id_int, servico, valor, peso, cep")
      .eq("escolhido", true)
      .in("id_int", ids),
    client
      .from("notas_fiscais")
      .select("id_int, status, numero_nf")
      .in("id_int", ids),
    client
      .from("expedicoes")
      .select(
        "id_int, modalidade_frete, tipo_frete, transportadora_nome, id_transportadora_cliente, peso_kg, peso_bruto_kg, qtd_volumes, tipo_volume, id_endereco_entrega, codigo_rastreamento, correios_id_prepostagem, correios_codigo_objeto, data_pronto, data_despacho, data_entrega, despachado_por, retirado_por, obs, etiqueta_impressa_em"
      )
      .in("id_int", ids),
    idsCliente.length > 0
      ? client.from("clientes").select("id_cliente, nome, fantasia, cidade_uf").in("id_cliente", idsCliente)
      : Promise.resolve({ data: [], error: null } as const),
    client.from("produtos_proposta").select("id_int, peso_total").in("id_int", ids)
  ]);

  if (fretesRes.error) {
    console.error("[expedicao.service] Erro ao buscar cotacao_frete (frete ficará 'A definir'):", fretesRes.error);
  }
  for (const [nome, res] of [
    ["propostas_os", osRes],
    ["notas_fiscais", nfsRes],
    ["expedicoes", expRes],
    ["clientes", clientesRes],
    ["produtos_proposta", pesosRes]
  ] as const) {
    if (res.error) console.warn(`[expedicao.service] Erro ao buscar ${nome}:`, res.error);
  }

  const osMap = new Map<number, { data_termino: string | null; codigo_rastreamento: string | null; obs: string | null }>();
  for (const row of osRes.data ?? []) {
    if (row.id_int !== null) osMap.set(Number(row.id_int), row);
  }

  const freteMap = new Map<number, { servico: string | null; valor: number | null; peso: number | null; cep: string | null }>();
  for (const row of fretesRes.data ?? []) freteMap.set(Number(row.id_int), row);

  // NF: AUTORIZADA vence; senão qualquer nota não-cancelada conta como PENDENTE.
  const nfMap = new Map<number, { status: NfStatusExpedicao; numero: string | null }>();
  for (const row of nfsRes.data ?? []) {
    const idInt = Number(row.id_int);
    const st = String(row.status ?? "").toUpperCase();
    const atual = nfMap.get(idInt);
    if (st === "AUTORIZADA") {
      nfMap.set(idInt, { status: "AUTORIZADA", numero: row.numero_nf ? String(row.numero_nf) : null });
    } else if (st !== "CANCELADA" && atual?.status !== "AUTORIZADA") {
      nfMap.set(idInt, { status: "PENDENTE", numero: row.numero_nf ? String(row.numero_nf) : null });
    }
  }

  const expMap = new Map<number, ExpedicaoRegistro>();
  for (const row of expRes.data ?? []) {
    expMap.set(Number(row.id_int), {
      idInt: Number(row.id_int),
      modalidadeFrete: (row.modalidade_frete as ModalidadeFrete | null) ?? null,
      tipoFrete: (row.tipo_frete as TipoFreteNormalizado | null) ?? null,
      transportadoraNome: row.transportadora_nome ?? null,
      idTransportadoraCliente: row.id_transportadora_cliente !== null ? Number(row.id_transportadora_cliente) : null,
      pesoKg: row.peso_kg !== null ? Number(row.peso_kg) : null,
      pesoBrutoKg: row.peso_bruto_kg !== null ? Number(row.peso_bruto_kg) : null,
      qtdVolumes: row.qtd_volumes !== null ? Number(row.qtd_volumes) : null,
      tipoVolume: row.tipo_volume ?? null,
      idEnderecoEntrega: row.id_endereco_entrega ?? null,
      codigoRastreamento: row.codigo_rastreamento ?? null,
      correiosIdPrepostagem: row.correios_id_prepostagem ?? null,
      correiosCodigoObjeto: row.correios_codigo_objeto ?? null,
      dataPronto: row.data_pronto ?? null,
      dataDespacho: row.data_despacho ?? null,
      dataEntrega: row.data_entrega ?? null,
      despachadoPor: row.despachado_por ?? null,
      retiradoPor: row.retirado_por ?? null,
      obs: row.obs ?? null,
      etiquetaImpressaEm: row.etiqueta_impressa_em ?? null
    });
  }

  const clienteMap = new Map<number, { nome: string | null; fantasia: string | null; cidade_uf: string | null }>();
  for (const row of clientesRes.data ?? []) clienteMap.set(Number(row.id_cliente), row);

  const pesoTeoricoGramas = new Map<number, number>();
  for (const row of pesosRes.data ?? []) {
    const idInt = Number(row.id_int);
    const g = Number(row.peso_total) || 0;
    pesoTeoricoGramas.set(idInt, (pesoTeoricoGramas.get(idInt) ?? 0) + g);
  }

  const hoje = hojeSaoPaulo();
  const resultado: PedidoExpedicao[] = [];

  for (const p of propostas) {
    const idInt = Number(p.id_int);
    const statusInterno = String(p.status_interno ?? "");
    const etapa = etapaDoStatus(statusInterno);
    const os = osMap.get(idInt);
    const frete = freteMap.get(idInt);
    const exp = expMap.get(idInt) ?? null;
    const nf = nfMap.get(idInt);
    const idCliente = p.id_cliente !== null ? Number(p.id_cliente) : null;
    const cli = idCliente !== null ? clienteMap.get(idCliente) : undefined;

    // Entregue some do painel após 30 dias (sem data_entrega registrada, mantém).
    if (etapa === "ENTREGUE" && exp?.dataEntrega) {
      const dataEntregueDia = diaSaoPaulo(exp.dataEntrega);
      if (diffDias(dataEntregueDia, hoje) > DIAS_ENTREGUE_VISIVEL) continue;
    }

    const dataPromessa = os?.data_termino ?? null;
    // data_termino é timestamp SEM timezone (não timestamptz) — slice direto já
    // é a data-calendário correta; não trocar por diaSaoPaulo (isso é só para
    // instantes timestamptz em UTC, como expedicoes.data_entrega acima).
    const promessaDia = dataPromessa ? dataPromessa.slice(0, 10) : null;
    const emAberto = etapa !== "ENTREGUE";
    const atrasadoDias =
      emAberto && promessaDia && promessaDia < hoje ? diffDias(promessaDia, hoje) : 0;
    const prometidoHoje = emAberto && promessaDia === hoje;

    const tipoFrete: TipoFreteNormalizado = exp?.tipoFrete ?? normalizarTipoFrete(frete?.servico);

    // Precedência única (lib/peso.ts): aferido > bruto da revisão > cotado > teórico.
    const { pesoKg, origem: pesoOrigem } = resolverPesoExpedicao({
      pesoAferidoKg: exp?.pesoKg,
      pesoBrutoKg: exp?.pesoBrutoKg,
      pesoCotadoGramas: frete?.peso,
      pesoTeoricoGramas: pesoTeoricoGramas.get(idInt)
    });

    resultado.push({
      idInt,
      cliente: p.cliente || cli?.nome || cli?.fantasia || `Proposta #${idInt}`,
      idCliente,
      cidadeUf: cli?.cidade_uf ?? "",
      empresa: p.empresa || "",
      statusInterno,
      etapa,
      dataPromessa,
      atrasadoDias,
      prometidoHoje,
      tipoFrete,
      // O que o VENDEDOR declarou no orçamento. Não vira `tipoFrete` nem
      // sobrescreve nada: é a referência que o despacho pré-seleciona e contra
      // a qual a divergência do expedidor é mostrada.
      modalidadeOrcamento: (p.modalidade_frete as ModalidadeFrete | null) ?? null,
      idTransportadoraOrcamento:
        p.id_transportadora_cliente !== null && p.id_transportadora_cliente !== undefined
          ? Number(p.id_transportadora_cliente)
          : null,
      freteServico: frete?.servico ?? "",
      freteCep: frete?.cep ? String(frete.cep) : null,
      transportadoraNome: exp?.transportadoraNome || frete?.servico || "",
      freteValor: frete?.valor !== null && frete?.valor !== undefined ? Number(frete.valor) : null,
      pesoKg,
      pesoOrigem,
      volumes: exp?.qtdVolumes ?? (p.volume !== null ? Number(p.volume) : null),
      nfStatus: nf?.status ?? "SEM_NF",
      nfNumero: nf?.numero ?? null,
      liberaNf: p.libera_nf === true,
      codigoRastreamento: exp?.codigoRastreamento || os?.codigo_rastreamento || "",
      obsOs: os?.obs ?? "",
      // "Envio já preparado": prepostagem Correios OU 10x15 registrada OU rastreio (de qualquer origem).
      etiquetaGerada: Boolean(
        exp?.correiosIdPrepostagem || exp?.etiquetaImpressaEm || exp?.codigoRastreamento || os?.codigo_rastreamento
      ),
      expedicao: exp
    });
  }

  // Urgência primeiro: atrasados (mais atrasado no topo) → prometidos hoje →
  // demais por promessa mais próxima; sem promessa vai para o fim de cada grupo.
  resultado.sort((a, b) => {
    if (a.atrasadoDias !== b.atrasadoDias) return b.atrasadoDias - a.atrasadoDias;
    if (a.prometidoHoje !== b.prometidoHoje) return a.prometidoHoje ? -1 : 1;
    const pa = a.dataPromessa ?? "9999-12-31";
    const pb = b.dataPromessa ?? "9999-12-31";
    if (pa !== pb) return pa < pb ? -1 : 1;
    return b.idInt - a.idInt;
  });

  return resultado;
}
