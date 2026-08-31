import { getSupabaseClient } from "@/lib/supabase/client";
import {
  nomeTransportadoraCadastro,
  nomeTransporteEfetivo
} from "@/features/orcamentos/lib/modalidade-frete";
import { labelTipoFrete, normalizarTipoFrete } from "../lib/tipo-frete";
import { temPagadorDistinto } from "../lib/destinatario-etiqueta";
import { escolherNotaAutorizadaDoPedido, type NotaCandidata } from "@/lib/fiscal/nota-do-pedido";
import { resolverPesoExpedicao } from "../lib/peso";
import type {
  EtapaExpedicao,
  ExpedicaoRegistro,
  ModalidadeFrete,
  NfStatusExpedicao,
  PedidoExpedicao,
  TipoFreteNormalizado
} from "../types";

/** Linha de `notas_fiscais` como a lista da Expedição a lê. */
type NotaFiscalExpedicaoRow = NotaCandidata & { id_int: number | null };

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
      "id_int, cliente, id_cliente, id_faturado, empresa, vendedor, status_interno, libera_nf, volume, modalidade_frete, id_transportadora_cliente"
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
        ...propostas.map((p) => Number(p.id_transportadora_cliente)),
        // O PAGADOR entra no MESMO `in`, pela mesma razao que a transportadora:
        // pagador tambem e um cadastro de `clientes`, e a lista precisa do NOME
        // dele para a coluna do cliente. Zero consulta a mais — sao alguns ids
        // no mesmo IN que ja rodava.
        ...propostas.map((p) => Number(p.id_faturado))
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
      .select("id_int, status, numero_nf, data_autorizacao, created_at")
      .in("id_int", ids),
    client
      .from("expedicoes")
      .select(
        "id_int, modalidade_frete, tipo_frete, transportadora_nome, id_transportadora_cliente, peso_kg, peso_bruto_kg, qtd_volumes, tipo_volume, id_endereco_entrega, id_cliente_destinatario_etiqueta, codigo_rastreamento, correios_id_prepostagem, correios_codigo_objeto, prepostagem_cancelada_em, correios_id_prepostagem_anterior, correios_codigo_objeto_anterior, data_pronto, data_despacho, data_entrega, despachado_por, retirado_por, obs, etiqueta_impressa_em"
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
  //
  // Um pedido pode ter VÁRIAS notas — é o desenho do faturamento parcial, e o
  // 20370 tem duas autorizadas. Antes, entre duas autorizadas a última lida
  // sobrescrevia a anterior, então o número exibido dependia da ordem em que o
  // Postgres devolvesse as linhas. Agora a escolha passa pelo mesmo critério da
  // etiqueta (`escolherNotaAutorizadaDoPedido`), e as duas telas mostram a mesma
  // nota.
  //
  // O ramo PENDENTE fica: `NfStatusExpedicao` tem esse estado, a lista o exibe
  // como selo e o Despachar avisa quando o pedido não está AUTORIZADO. Aplicar o
  // filtro estrito aqui apagaria esse aviso e faria pedido com rascunho parecer
  // pedido sem nota nenhuma.
  const notasPorPedido = new Map<number, NotaFiscalExpedicaoRow[]>();
  for (const row of nfsRes.data ?? []) {
    const idInt = Number(row.id_int);
    if (!Number.isFinite(idInt)) continue;
    const lista = notasPorPedido.get(idInt);
    if (lista) lista.push(row as NotaFiscalExpedicaoRow);
    else notasPorPedido.set(idInt, [row as NotaFiscalExpedicaoRow]);
  }

  const nfMap = new Map<number, { status: NfStatusExpedicao; numero: string | null }>();
  for (const [idInt, notas] of notasPorPedido) {
    const autorizada = escolherNotaAutorizadaDoPedido(notas);
    if (autorizada) {
      nfMap.set(idInt, { status: "AUTORIZADA", numero: String(autorizada.numero_nf ?? "") || null });
      continue;
    }

    // Sem autorizada utilizável: vale qualquer nota viva como PENDENTE.
    const viva = notas.find((nota) => String(nota.status ?? "").toUpperCase() !== "CANCELADA");
    if (viva) {
      nfMap.set(idInt, { status: "PENDENTE", numero: viva.numero_nf ? String(viva.numero_nf) : null });
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
      idClienteDestinatarioEtiqueta:
        row.id_cliente_destinatario_etiqueta !== null && row.id_cliente_destinatario_etiqueta !== undefined
          ? Number(row.id_cliente_destinatario_etiqueta)
          : null,
      correiosIdPrepostagem: row.correios_id_prepostagem ?? null,
      prepostagemCanceladaEm: (row.prepostagem_cancelada_em as string | null) ?? null,
      correiosIdPrepostagemAnterior: (row.correios_id_prepostagem_anterior as string | null) ?? null,
      correiosCodigoObjetoAnterior: (row.correios_codigo_objeto_anterior as string | null) ?? null,
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

    // Rascunho (dados gravados sem despachar) NAO vence a cotacao aqui: a lista,
    // a visao por transportadora e a etiqueta mostram o estado CONFIRMADO. Ver
    // `despachoConfirmado` em types.ts.
    // Subiu para antes do atraso em 25/08/2026: o atraso passou a depender dele.
    const despachoConfirmado = Boolean(exp?.dataDespacho);

    /**
     * ATRASO CONGELA NO DESPACHO (25/08/2026).
     *
     * `data_termino` e a promessa de ENTREGA DA PRODUCAO — a data em que o
     * pedido devia estar pronto para sair. Enquanto a comparacao era so contra
     * `hoje`, um pedido despachado continuava contando: 20925, 20928 e 20481
     * sairam em 20/08 para uma promessa de 21/08 — dentro do prazo — e o painel
     * marcava os tres como "ATRASADO 4d" em 25/08, porque a conta nao tinha onde
     * parar antes de `ENTREGUE`. O numero crescia sozinho todo dia, e a linha
     * ficava vermelha por um atraso que nunca existiu.
     *
     * Com `data_despacho` preenchida a mercadoria ja saiu: o que a Expedicao
     * devia fazer, fez. O que acontece do transporte em diante nao e atraso de
     * producao — e prazo de transportadora, que este campo nao mede.
     *
     * `prometidoHoje` fica INTOCADO de proposito: ele responde "o que promete
     * sair hoje", e um pedido que ja saiu hoje continua sendo verdade nesse
     * chip. So o atraso para.
     */
    const atrasadoDias =
      emAberto && !despachoConfirmado && promessaDia && promessaDia < hoje
        ? diffDias(promessaDia, hoje)
        : 0;
    const prometidoHoje = emAberto && promessaDia === hoje;

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
      // Pagador (24/08/2026): vem na MESMA linha que a lista ja lia, para o modal
      // Despachar poder oferecer os enderecos dele sem consulta extra.
      idFaturado: p.id_faturado !== null && p.id_faturado !== undefined ? Number(p.id_faturado) : null,
      // Nome do pagador, SO quando ele difere do cliente do pedido. A regra de
      // "difere" e a mesma `temPagadorDistinto` que o modal Despachar e a
      // etiqueta usam — os tres precisam concordar sobre quem e o pagador.
      // `fantasia || nome` e a mesma preferencia de rotulo do resto do cadastro.
      pagador: (() => {
        const idPagador = Number(p.id_faturado);
        if (!temPagadorDistinto(idCliente, Number.isFinite(idPagador) ? idPagador : null)) return "";
        const cadastro = clienteMap.get(idPagador);
        return String(cadastro?.fantasia ?? "").trim() || String(cadastro?.nome ?? "").trim() || `#${idPagador}`;
      })(),
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
      /**
       * O QUE A COLUNA FRETE ESCREVE (31/08/2026).
       *
       * Campo SÓ de exibição, criado porque a coluna decidia pela classificação
       * do texto de `cotacao_frete.servico`: `tipoFrete === "INDEFINIDO"`
       * imprimia "A definir" e DESCARTAVA o transportador, mesmo com
       * `propostas.id_transportadora_cliente` preenchido. Foi o caso do 21202
       * entre 27 e 31/08 — serviço "AÉREO ECONOMICO", fora do vocabulário de
       * `normalizarTipoFrete`, com a SVT TRANSPORTES definida no orçamento e
       * exibida sem dificuldade pelo modal Despachar.
       *
       * A ordem, e a razão de cada degrau:
       *   1. despacho confirmado manda — `expedicoes.transportadora_nome` é o
       *      que de fato levou a caixa, e esse comportamento fica intacto;
       *   2. classificação FALHOU (`INDEFINIDO`) e existe vínculo? então o
       *      cadastro responde. É exatamente o buraco relatado: o texto do
       *      serviço não diz nada reconhecível, e a coluna preferia "A definir"
       *      a olhar `propostas.id_transportadora_cliente`, que o modal
       *      Despachar lê sem dificuldade;
       *   3. o mesmo `nomeTransporteEfetivo` que a coluna já usava;
       *   4. o vínculo de novo, para o caso de nem texto haver;
       *   5. o rótulo do tipo — e `labelTipoFrete("INDEFINIDO")` já é
       *      "A definir", que assim só sobra quando não há absolutamente nada.
       *
       * POR QUE O DEGRAU 2 É CONDICIONADO A `INDEFINIDO`, e não incondicional.
       * Medido em 31/08/2026 sobre as 26 propostas com transportadora definida:
       * pondo o cadastro acima do texto sem condição, DEZ linhas trocariam de
       * rótulo — seis Correios passariam de "SEDEX" para "CORREIOS SEDE", e
       * "SÃO MIGUEL" viraria "EXPRESSO SAO MIGUEL S/A". Nenhuma delas está
       * errada hoje, e trocá-las não era o pedido. Condicionado, mudam só as
       * duas linhas que exibiam "A definir" tendo transporte conhecido.
       *
       * `transportadoraNome` NÃO foi alterado: ele alimenta o agrupamento "Por
       * transportadora", a busca textual e o pré-preenchimento do DespacharModal,
       * e mexer nele mudaria os três de carona. Este campo é outro, e só a
       * coluna o lê. `tipoFrete` também segue intocado — aqui ele é apenas LIDO.
       */
      rotuloTransporte:
        expConfirmado?.transportadoraNome ||
        (tipoFrete === "INDEFINIDO" ? transportadoraOrcamento : null) ||
        nomeTransporteEfetivo(frete?.servico, modalidadeOrcamento, transportadoraOrcamento) ||
        transportadoraOrcamento ||
        labelTipoFrete(tipoFrete),
      freteValor: frete?.valor !== null && frete?.valor !== undefined ? Number(frete.valor) : null,
      pesoKg,
      pesoOrigem,
      pesoCotadoGramas: frete?.peso !== null && frete?.peso !== undefined ? Number(frete.peso) : null,
      volumes: exp?.qtdVolumes ?? (p.volume !== null ? Number(p.volume) : null),
      nfStatus: nf?.status ?? "SEM_NF",
      nfNumero: nf?.numero ?? null,
      liberaNf: p.libera_nf === true,
      // Prepostagem marcada como cancelada: a lista passa a se comportar como
      // "sem rastreio" — some da coluna, some da busca e o item "Rastrear
      // objeto" nao aparece. O banco NAO muda: `expedicoes.codigo_rastreamento`
      // e o objeto continuam gravados, porque a marcacao e sobre exibicao, nao
      // sobre apagar a prova de que o objeto existiu.
      //
      // O fallback de `propostas_os.codigo_rastreamento` tambem e ignorado aqui:
      // aquele espelho guarda o codigo do objeto morto e, sem isto, o traria de
      // volta pela porta dos fundos.
      codigoRastreamento: exp?.prepostagemCanceladaEm
        ? ""
        : exp?.codigoRastreamento || os?.codigo_rastreamento || "",
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
