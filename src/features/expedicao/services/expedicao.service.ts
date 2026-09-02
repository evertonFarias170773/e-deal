import { getSupabaseClient } from "@/lib/supabase/client";
import { formatDocument } from "@/lib/formatters/document";
import { formatPhoneBR } from "@/lib/formatters/phone";
import {
  nomeTransportadoraCadastro,
  nomeTransporteEfetivo
} from "@/features/orcamentos/lib/modalidade-frete";
import { labelTipoFrete, normalizarTipoFrete } from "../lib/tipo-frete";
import { temPagadorDistinto } from "../lib/destinatario-etiqueta";
import { idEnderecoEntregaVigente } from "../lib/endereco-entrega";
import { escolherNotaAutorizadaDoPedido, type NotaCandidata } from "@/lib/fiscal/nota-do-pedido";
import { resolverPesoExpedicao } from "../lib/peso";
import type {
  ContatoDestinatario,
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

/**
 * Contato de um cadastro de `clientes`, ja mascarado para exibicao.
 *
 * Telefone: `whatsapp_1` antes de `telefone_fixo`, a MESMA preferencia que a
 * etiqueta 10x15 aplica — as duas telas mostram o mesmo numero.
 */
function contatoDoCadastro(
  cadastro: { documento: string | null; whatsapp_1: string | null; telefone_fixo: string | null } | undefined
): ContatoDestinatario {
  return {
    documento: cadastro?.documento ? formatDocument(String(cadastro.documento)) : "",
    telefone: formatPhoneBR(cadastro?.whatsapp_1 || cadastro?.telefone_fixo)
  };
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
      // `id_endereco_ent` (02/09/2026): o endereço de entrega DEFINIDO NA
      // PROPOSTA. Entrou na mesma linha que já vinha — zero consulta a mais
      // aqui. É `text` na tabela, e aponta para `enderecos.id` (uuid).
      "id_int, cliente, id_cliente, id_faturado, empresa, vendedor, status_interno, libera_nf, volume, modalidade_frete, id_transportadora_cliente, valor_frete, id_endereco_ent"
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
        "id_int, modalidade_frete, tipo_frete, transportadora_nome, id_transportadora_cliente, peso_kg, peso_bruto_kg, qtd_volumes, tipo_volume, id_endereco_entrega, id_cliente_destinatario_etiqueta, codigo_rastreamento, correios_id_prepostagem, correios_codigo_objeto, prepostagem_cancelada_em, correios_id_prepostagem_anterior, correios_codigo_objeto_anterior, data_pronto, data_despacho, coletado_em, data_entrega, despachado_por, retirado_por, obs, obs_etiqueta, nf_numero_manual, etiqueta_impressa_em"
      )
      .in("id_int", ids),
    idsCliente.length > 0
      ? client
          .from("clientes")
          // `documento`, `whatsapp_1` e `telefone_fixo` (02/09/2026): o modal
          // Despachar passou a exibir CPF/CNPJ e telefone do destinatario, que
          // pode ser o cliente OU o pagador — os dois ja estao neste `in`.
          // Mesma linha que ja vinha, nenhuma consulta a mais.
          .select("id_cliente, nome, fantasia, cidade_uf, documento, whatsapp_1, telefone_fixo")
          .in("id_cliente", idsCliente)
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
      coletadoEm: row.coletado_em ?? null,
      dataEntrega: row.data_entrega ?? null,
      despachadoPor: row.despachado_por ?? null,
      retiradoPor: row.retirado_por ?? null,
      obs: row.obs ?? null,
      obsEtiqueta: row.obs_etiqueta ?? null,
      nfNumeroManual: row.nf_numero_manual ?? null,
      etiquetaImpressaEm: row.etiqueta_impressa_em ?? null
    });
  }

  const clienteMap = new Map<
    number,
    {
      nome: string | null;
      fantasia: string | null;
      cidade_uf: string | null;
      documento: string | null;
      whatsapp_1: string | null;
      telefone_fixo: string | null;
    }
  >();
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

  /**
   * ENDEREÇOS DE ENTREGA, resolvidos numa consulta só (02/09/2026).
   *
   * Segunda onda, e não dentro do `Promise.all` acima, porque o conjunto de ids
   * depende de `expedicoes`, que só chega ali: são os endereços da PROPOSTA
   * (`id_endereco_ent`) MAIS os já gravados no despacho
   * (`expedicoes.id_endereco_entrega`), que nos pedidos já despachados podem ser
   * outro — e são, em 21229 e 21000.
   *
   * É um `in` por ids explícitos, não um `in` por `id_cliente`: `enderecos` não
   * tem FK para `clientes`, e filtrar pelo dono traria linhas órfãs e deixaria
   * de fora um endereço cujo `id_cliente` esteja errado. Uma ida ao banco para
   * a lista inteira, nenhuma por linha.
   */
  const idsEndereco = Array.from(
    new Set(
      [
        ...propostas.map((p) => String(p.id_endereco_ent ?? "").trim()),
        ...Array.from(expMap.values()).map((e) => String(e.idEnderecoEntrega ?? "").trim())
      ].filter((id) => id !== "")
    )
  );

  const enderecoMap = new Map<string, { rotulo: string; cep: string | null }>();
  if (idsEndereco.length > 0) {
    const { data: enderecosData, error: enderecosErro } = await client
      .from("enderecos")
      .select("id, endereco, numero, complemento, bairro, cidade, uf, cep")
      .in("id", idsEndereco);
    if (enderecosErro) {
      // Tolerante como os demais blocos: sem endereço o modal avisa e bloqueia,
      // que é melhor do que derrubar o painel inteiro.
      console.warn("[expedicao.service] Erro ao buscar enderecos de entrega:", enderecosErro);
    }
    for (const e of enderecosData ?? []) {
      // MESMO formato do rótulo que `listarEnderecosCliente` monta, para o
      // texto do modal não mudar de cara agora que ele não vem mais de lá.
      const linha = [
        [e.endereco, e.numero].filter(Boolean).join(", "),
        e.complemento,
        e.bairro,
        [e.cidade, e.uf].filter(Boolean).join("/")
      ]
        .filter(Boolean)
        .join(" - ");
      const cep = e.cep ? String(e.cep) : null;
      enderecoMap.set(String(e.id), { rotulo: `${linha}${cep ? ` (CEP ${cep})` : ""}`, cep });
    }
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
    // Alimentava o atraso ate 02/09/2026; hoje quem congela o atraso e a SAIDA
    // da etapa de EXPEDICAO, nao esta data. Ver `naEtapaDeExpedicao` abaixo.
    const despachoConfirmado = Boolean(exp?.dataDespacho);


    /**
     * O ATRASO CONGELA AO SAIR DA ETAPA DE EXPEDICAO (02/09/2026, Etapa 7).
     *
     * Era `!despachoConfirmado`, de 25/08/2026, quando confirmar o despacho e
     * sair de `EXPEDICAO` eram o mesmo evento. Deixaram de ser: em
     * TRANSPORTADORA e MOTOBOY o pedido agora FICA em `EXPEDICAO` aguardando
     * coleta, com `data_despacho` preenchida. Pela regra antiga o relogio
     * pararia ali — e o volume ainda esta na casa, ainda e responsabilidade da
     * bancada, e ainda pode atrasar.
     *
     * O que congela e a SAIDA: `A RETIRAR`, `EM TRANSITO` e `ENTREGUE` sao
     * prazo de transportadora ou de balcao, que `data_termino` nao mede.
     *
     * HISTORICO. Ate 25/08/2026 a conta nao tinha onde parar antes de
     * `ENTREGUE`: 20925, 20928 e 20481 sairam em 20/08 para uma promessa de
     * 21/08 — dentro do prazo — e o painel marcava os tres como "ATRASADO 4d",
     * numero que crescia sozinho todo dia. `data_despacho` resolveu aquilo e
     * hoje resolve menos, porque despachar deixou de significar sair.
     *
     * `prometidoHoje` fica INTOCADO de proposito: ele responde "o que promete
     * sair hoje", e um pedido que ja saiu hoje continua sendo verdade nesse
     * chip. So o atraso para.
     *
     * Medido em 02/09/2026 sobre o painel: as duas regras davam o MESMO
     * resultado em todos os pedidos — zero trocam de estado.
     */
    const naEtapaDeExpedicao = etapa === "PRODUCAO" || etapa === "ACABAMENTO" || etapa === "PRONTO";
    const atrasadoDias =
      naEtapaDeExpedicao && promessaDia && promessaDia < hoje ? diffDias(promessaDia, hoje) : 0;
    const prometidoHoje = emAberto && promessaDia === hoje;

    const expConfirmado = despachoConfirmado ? exp : null;
    const tipoFrete: TipoFreteNormalizado = expConfirmado?.tipoFrete ?? normalizarTipoFrete(frete?.servico);
    /**
     * AGUARDANDO COLETA, derivado UMA VEZ (02/09/2026, Etapa 7).
     *
     * As quatro condicoes do Desenho A, e nenhuma a mais: despacho confirmado,
     * coleta ainda nao registrada, pedido AINDA em `EXPEDICAO` (etapa `PRONTO`)
     * e transporte que espera carro. Correios vai direto a `EM TRANSITO` — a
     * postagem E a coleta — e retirada vai a `A RETIRAR`; nenhum dos dois entra.
     *
     * `tipoFrete` aqui ja e o resolvido acima: com despacho confirmado ele vem
     * de `expedicoes.tipo_frete`, que e a declaracao do expedidor. E ela que
     * decide, nao o texto da cotacao.
     */
    const aguardandoColeta =
      despachoConfirmado &&
      !exp?.coletadoEm &&
      etapa === "PRONTO" &&
      (tipoFrete === "TRANSPORTADORA" || tipoFrete === "MOTOBOY");

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

    /**
     * RAZAO — o nome de sempre. `propostas.cliente` e o nome gravado NA
     * PROPOSTA; o cadastro so entra como rede de seguranca quando ele vier
     * vazio. Continua sendo o que a lista, a busca e os documentos usam.
     */
    const nomeRazao = p.cliente || cli?.nome || cli?.fantasia || `Proposta #${idInt}`;
    /**
     * FANTASIA primeiro — so para exibicao no card do Kanban (ver
     * `clienteExibicao` em types.ts). Cai na razao quando o cadastro nao tem
     * fantasia: sao 5 dos 24 clientes do painel em 02/09/2026, quase todos
     * pessoa fisica, onde razao e fantasia seriam o mesmo nome de qualquer
     * forma. Sem consulta nova — `fantasia` ja vem no `in` de `clientes`.
     */
    const nomeFantasia = String(cli?.fantasia ?? "").trim() || nomeRazao;

    /**
     * DESPACHO CONFIRMADO VENCE (ver `enderecoEntrega` em types.ts). Rascunho
     * NÃO vence: sem `data_despacho` o que vale é a proposta, mesma lógica de
     * `expConfirmado` que o transporte e a etiqueta já seguem.
     */
    const idEnderecoVigente = idEnderecoEntregaVigente({
      despachoConfirmado,
      idGravadoNoDespacho: exp?.idEnderecoEntrega,
      idDefinidoNaProposta: p.id_endereco_ent as string | null | undefined
    });
    const enderecoResolvido = idEnderecoVigente ? enderecoMap.get(idEnderecoVigente) ?? null : null;
    const origemEndereco =
      despachoConfirmado && String(exp?.idEnderecoEntrega ?? "").trim() ? "DESPACHO" : "PROPOSTA";

    resultado.push({
      idInt,
      cliente: nomeRazao,
      clienteExibicao: nomeFantasia,
      enderecoEntrega: enderecoResolvido && idEnderecoVigente
        ? {
            id: idEnderecoVigente,
            rotulo: enderecoResolvido.rotulo,
            cep: enderecoResolvido.cep,
            origem: origemEndereco
          }
        : null,
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
      // Contato dos dois destinatarios possiveis. O do pagador so existe quando
      // ele e distinto — mesma condicao do drop no modal.
      contatoCliente: contatoDoCadastro(cli),
      contatoPagador: temPagadorDistinto(idCliente, Number(p.id_faturado) || null)
        ? contatoDoCadastro(clienteMap.get(Number(p.id_faturado)))
        : null,
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
      /**
       * `propostas.valor_frete` — o que a proposta COBRA hoje.
       *
       * Distinto de `freteValor`, que e `cotacao_frete.valor`, o valor COTADO.
       * Os dois nascem iguais no salvamento do orcamento e permanecem iguais na
       * base inteira hoje (44 de 44 pedidos do painel em 01/09/2026), mas
       * divergem por desenho depois de uma recotacao: aplicar recotacao grava
       * `propostas.valor_frete` e NAO toca em `cotacao_frete`, que e imutavel
       * para a Expedicao (tres triggers reescreveriam valor_total e
       * status_interno).
       *
       * Veio na MESMA linha do select de `propostas` que ja rodava — nenhuma
       * consulta a mais. Quem exibe "o frete do pedido" deve ler daqui.
       */
      freteCobrado: p.valor_frete !== null && p.valor_frete !== undefined ? Number(p.valor_frete) : null,
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
      despachoConfirmado,
      aguardandoColeta
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
