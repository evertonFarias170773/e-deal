import { getSupabaseClient } from "@/lib/supabase/client";
import {
  nomeTransportadoraCadastro,
  nomeTransporteEfetivo
} from "@/features/orcamentos/lib/modalidade-frete";
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
      "id_int, cliente, id_cliente, empresa, vendedor, status_interno, libera_nf, volume, modalidade_frete, id_transportadora_cliente"
    )
    .eq("is_prd_aprovado", true)
    .in("status_interno", STATUS_FUNIL_EXPEDICAO)
    // Pedido de teste encerrado sai do painel sem ser apagado. Corte independente
    // do auto-ocultar de ENTREGUE após 30 dias, mais abaixo: um é sobre pedido
    // que nunca foi real, o outro é sobre pedido real que já terminou.
    .is("encerrado_teste_em", null)
    .order("id_int", { ascending: false });

  if (propError || !propostas) {
    console.error("[expedicao.service] Erro ao buscar propostas:", propError);
    return [];
  }
  if (propostas.length === 0) return [];

  const ids = propostas.map((p) => Number(p.id_int));
  // Transportadoras são clientes: entram no MESMO `in` que já busca os clientes
  // do painel, sem ida e volta extra. Sem isso o nome da transportadora declarada
  // no orçamento não existiria no mapa e a coluna FRETE cairia de volta no texto
  // da cotação — que em FOB diz "SEDEX".
  const idsCliente = Array.from(
    new Set(
      [
        ...propostas.map((p) => Number(p.id_cliente)),
        ...propostas.map((p) => Number(p.id_transportadora_cliente))
      ].filter((n) => Number.isFinite(n) && n > 0)
    )
  );

  // 2..6 em paralelo — cada bloco é tolerante a falha individual (warn + vazio),
  // MENOS cotacao_frete, cujo erro é logado com destaque (foi o bug da tela antiga).
  const [
    osRes,
    fretesRes,
    nfsRes,
    expRes,
    clientesRes,
    pesosRes,
    liberacoesRes,
    recotacoesRes,
    setoresRes
  ] = await Promise.all([
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
    client.from("produtos_proposta").select("id_int, peso_total").in("id_int", ids),
    // Liberacao ATIVA da recotacao (Parte C): quem autorizou e quando. Vem
    // junto da lista de proposito — o menu Acoes e o modal Despachar precisam
    // ler a MESMA fonte, senao um mostra liberado e o outro bloqueado.
    client
      .from("expedicao_recotacao_liberacoes")
      .select("id, id_int, liberado_em, liberado_por_nome")
      .is("consumida_em", null)
      .is("revogada_em", null)
      .in("id_int", ids),
    // Ultima recotacao aplicada: vira a referencia de peso/CEP no despacho,
    // porque `cotacao_frete` nao muda quando uma recotacao e aplicada.
    client
      .from("expedicao_recotacoes")
      .select("id_int, peso_gramas, cep, aplicado_em")
      .in("id_int", ids)
      .order("aplicado_em", { ascending: false }),
    // Peso REAL por setor, medido na Revisão do boletim. A soma vira o "Peso
    // aferido" que o despacho abre preenchido — antes o expedidor tinha de
    // repetir na bancada uma pesagem que a produção já havia feito.
    client.from("propostas_os_setores").select("id_int, setor, peso_real_kg").in("id_int", ids)
  ]);

  if (fretesRes.error) {
    console.error("[expedicao.service] Erro ao buscar cotacao_frete (frete ficará 'A definir'):", fretesRes.error);
  }
  for (const [nome, res] of [
    ["propostas_os", osRes],
    ["notas_fiscais", nfsRes],
    ["expedicoes", expRes],
    ["clientes", clientesRes],
    ["produtos_proposta", pesosRes],
    ["expedicao_recotacao_liberacoes", liberacoesRes],
    ["expedicao_recotacoes", recotacoesRes]
  ] as const) {
    if (res.error) console.warn(`[expedicao.service] Erro ao buscar ${nome}:`, res.error);
  }

  const liberacaoMap = new Map<number, { id: number; liberadoEm: string; liberadoPorNome: string | null }>();
  for (const row of liberacoesRes.data ?? []) {
    liberacaoMap.set(Number(row.id_int), {
      id: Number(row.id),
      liberadoEm: String(row.liberado_em),
      liberadoPorNome: row.liberado_por_nome ?? null
    });
  }

  // Vem ordenado por aplicado_em DESC: a primeira de cada id_int e a vigente.
  const recotacaoMap = new Map<number, { pesoGramas: number | null; cep: string | null }>();
  for (const row of recotacoesRes.data ?? []) {
    const chave = Number(row.id_int);
    if (recotacaoMap.has(chave)) continue;
    recotacaoMap.set(chave, {
      pesoGramas: row.peso_gramas !== null && row.peso_gramas !== undefined ? Number(row.peso_gramas) : null,
      cep: row.cep ? String(row.cep) : null
    });
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

  /**
   * Peso real somado por pedido, e quantos setores ficaram sem medir.
   * Setor sem `peso_real_kg` não conta como zero: ele simplesmente não entra na
   * soma, e o contador diz que o total está incompleto.
   */
  const pesoRealSetores = new Map<number, { somaKg: number; medidos: number; semPeso: number }>();
  for (const linha of setoresRes.data ?? []) {
    const idInt = Number(linha.id_int);
    const atual = pesoRealSetores.get(idInt) ?? { somaKg: 0, medidos: 0, semPeso: 0 };
    const kg = Number(linha.peso_real_kg);
    if (Number.isFinite(kg) && kg > 0) {
      atual.somaKg += kg;
      atual.medidos += 1;
    } else {
      atual.semPeso += 1;
    }
    pesoRealSetores.set(idInt, atual);
  }

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

    // Rascunho (dados gravados sem despachar) NAO vence a cotacao aqui: a lista,
    // a visao por transportadora e a etiqueta mostram o estado CONFIRMADO. Ver
    // `despachoConfirmado` em types.ts.
    const despachoConfirmado = Boolean(exp?.dataDespacho);
    const expConfirmado = despachoConfirmado ? exp : null;
    const tipoFrete: TipoFreteNormalizado = expConfirmado?.tipoFrete ?? normalizarTipoFrete(frete?.servico);

    const modalidadeOrcamento = (p.modalidade_frete as ModalidadeFrete | null) ?? null;
    const idTransportadoraOrcamento =
      p.id_transportadora_cliente !== null && p.id_transportadora_cliente !== undefined
        ? Number(p.id_transportadora_cliente)
        : null;
    const transportadoraOrcamento =
      idTransportadoraOrcamento !== null
        ? nomeTransportadoraCadastro(
            (() => {
              const cadastro = clienteMap.get(idTransportadoraOrcamento);
              return cadastro ? { id_cliente: idTransportadoraOrcamento, ...cadastro } : null;
            })()
          )
        : null;

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
      vendedor: (p.vendedor as string | null) || "",
      pesoRealSetoresKg: (pesoRealSetores.get(idInt)?.medidos ?? 0) > 0
        ? Number(pesoRealSetores.get(idInt)!.somaKg.toFixed(3))
        : null,
      setoresSemPesoReal: pesoRealSetores.get(idInt)?.semPeso ?? 0,
      statusInterno,
      etapa,
      dataPromessa,
      atrasadoDias,
      prometidoHoje,
      tipoFrete,
      // O que o VENDEDOR declarou no orçamento. Não vira `tipoFrete` nem
      // sobrescreve nada: é a referência que o despacho pré-seleciona e contra
      // a qual a divergência do expedidor é mostrada.
      modalidadeOrcamento,
      idTransportadoraOrcamento,
      // `freteServico` continua sendo o texto CRU da cotação: é o "frete cotado"
      // que o DespacharModal mostra como referência, e mexer nele apagaria a
      // evidência de com o que o frete foi calculado.
      freteServico: frete?.servico ?? "",
      freteCep: frete?.cep ? String(frete.cep) : null,
      // Precedência preservada: o despacho é soberano. O que muda é o degrau
      // seguinte — antes caía direto no texto da cotação, que sob FOB diz
      // "SEDEX" num pedido que os Correios nunca vão tocar.
      transportadoraNome:
        expConfirmado?.transportadoraNome ||
        nomeTransporteEfetivo(frete?.servico, modalidadeOrcamento, transportadoraOrcamento) ||
        "",
      freteValor: frete?.valor !== null && frete?.valor !== undefined ? Number(frete.valor) : null,
      pesoKg,
      pesoOrigem,
      pesoCotadoGramas: frete?.peso !== null && frete?.peso !== undefined ? Number(frete.peso) : null,
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
      expedicao: exp,
      liberacaoRecotacao: liberacaoMap.get(idInt) ?? null,
      recotacaoVigente: recotacaoMap.get(idInt) ?? null,
      despachoConfirmado
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
