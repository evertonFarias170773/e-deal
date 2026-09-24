import { getSupabaseClient } from "@/lib/supabase/client";
import {
  categoriaDoServico,
  categoriaPorNomeConhecido
} from "@/features/orcamentos/lib/categoria-frete";
import type { ModalidadeFrete, TipoFreteNormalizado } from "../types";
import { destinoDoDespacho } from "../lib/destino-despacho";

export type AtorExpedicao = { uid: string | null; nome: string | null };
export type ResultadoAcao = {
  success: boolean;
  error?: string;
  /**
   * Só em `despachar`: o pedido ficou em `EXPEDICAO` esperando a coleta, em vez
   * de transicionar. Existe para a mensagem de sucesso do modal dizer o
   * desfecho certo — anunciar "despachado" num volume que ainda está na casa
   * mandaria o expedidor parar de olhar para ele.
   */
  aguardandoColeta?: boolean;
  /**
   * Código da recusa, quando a tela precisa reagir a ela e não só mostrar o
   * texto. Hoje: `COMPLEMENTO_FORA_EXPEDICAO`, `COMPLEMENTO_NAO_PAGO` e
   * `COMPLEMENTO_SEGUE_PRINCIPAL`.
   */
  code?: string;
  /**
   * Os complementos que motivaram a recusa. Em `COMPLEMENTO_NAO_PAGO` vêm
   * também o valor pago (`cc__valor_pago`) e o total, para a tela mostrar os
   * dois números.
   */
  complementos?: Array<{ idInt: number; statusInterno: string; valorPago?: number; valorTotal?: number }>;
  /**
   * PEDIDO COMPLEMENTAR (E9). Em `despachar` do principal: os complementos que
   * saíram junto. Em `confirmarColeta`, `marcarEntregue` e `confirmarRetirada`:
   * os complementos que acompanharam o passo. Só vem quando há complemento.
   */
  complementosDespachados?: number[];
  /**
   * Complementos que falharam DEPOIS de o principal já ter sido gravado. O
   * principal não é desfeito: o complemento segue onde estava e o expedidor
   * repete o gesto nele.
   */
  complementosComFalha?: Array<{ idInt: number; error: string }>;
};

/**
 * O que o despacho grava em `public.expedicoes`.
 *
 * `id_cliente_destinatario_etiqueta` NAO ESTA MAIS AQUI (04/09/2026): o select
 * "Em nome de quem sai a etiqueta" saiu e quem recebe virou regra FIXA, em
 * `lib/destinatario-etiqueta.ts` — o pagador quando existir, senao o cliente.
 * As 21 escolhas ja gravadas continuam na tabela e continuam VENCENDO na
 * leitura, e e por isso que o campo saiu tambem do upsert de `despachar`: ele
 * gravava `?? null` a cada despacho e, sem o modal enviando nada, apagaria a
 * escolha de quem redespachasse.
 */
export type DespachoInput = {
  tipoEntrega: "TRANSPORTE" | "RETIRADA";
  /** Quem paga o transporte. Null só em pedido legado que ainda não foi redespachado. */
  modalidadeFrete: ModalidadeFrete | null;
  tipoFrete: TipoFreteNormalizado;
  transportadoraNome: string;
  idTransportadoraCliente: number | null;
  pesoKg: number | null;
  qtdVolumes: number | null;
  tipoVolume: string | null;
  idEnderecoEntrega: string | null;
  codigoRastreamento: string;
  /**
   * `expedicoes.obs` — observacao LOGISTICA INTERNA. Nao sai em documento.
   *
   * OPCIONAL desde 02/09/2026: o modal Despachar removeu o campo da tela (dois
   * campos de observacao confundiam, e so `obs_etiqueta` chega ao papel) e
   * deixou de enviar este. A coluna CONTINUA no banco com o que ja estava
   * gravado — `undefined` significa "nao mexa", nunca "apague".
   */
  obs?: string;
  /**
   * `expedicoes.obs_etiqueta` — o texto IMPRESSO no volume (02/09/2026).
   *
   * Distinto de `obs` acima, e de proposito: aquele e recado interno da bancada,
   * este e lido pela transportadora e pelo destinatario. Ver o cabecalho da
   * migration `20260902183633_expedicoes_obs_etiqueta.sql`.
   */
  obsEtiqueta?: string;
  /**
   * `expedicoes.nf_numero_manual` — numero de NF digitado a mao, FALLBACK.
   *
   * `notas_fiscais.numero_nf` SEMPRE VENCE. O modal so deixa digitar quando NAO
   * ha nota autorizada; havendo, o campo e somente leitura e este valor sequer
   * e enviado. A precedencia da EXIBICAO vive em quem le, nao aqui — esta
   * camada apenas grava o que foi digitado.
   */
  nfNumeroManual?: string;
  /**
   * Override "Desvincular e despachar separado" (PEDIDO COMPLEMENTAR). Com ele,
   * cada complemento que ainda não chegou à Expedição, ou que está nela sem
   * pagamento integral (E9), é desvinculado ANTES de qualquer gravação do
   * despacho, pela função `desvincular_pedido_complementar`. Motivo
   * obrigatório.
   */
  desvincularComplementos?: { motivo: string };
};

import { camposMinimosDespacho, frasearFaltantes } from "../lib/campos-minimos-despacho";

const MSG_CONFLITO =
  "O pedido mudou de status em outra tela. A lista será recarregada.";

/** Status que já pertencem ao fluxo logístico — marcarPronto não parte daqui. */
const STATUS_FLUXO_LOGISTICO = ["EXPEDICAO", "A RETIRAR", "EM TRANSITO", "ENTREGUE"];

/**
 * Atualiza propostas.status_interno COM guarda de concorrência:
 * o UPDATE só acontece se o status ainda for o que a tela viu.
 */
async function transicionar(
  idInt: number,
  statusEsperado: string,
  statusNovo: string,
  ator: AtorExpedicao,
  motivo: string | null,
  tipoTransicao: "NATURAL" | "RETORNO"
): Promise<ResultadoAcao> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase não inicializado." };

  const { data, error } = await client
    .from("propostas")
    .update({ status_interno: statusNovo })
    .eq("id_int", idInt)
    .eq("status_interno", statusEsperado)
    .select("id_int");

  if (error) return { success: false, error: error.message };
  if (!data || data.length === 0) return { success: false, error: MSG_CONFLITO };

  // Trilha de auditoria — mesma tabela do QR de produção. Falha no log NÃO
  // desfaz a transição: loga warn e segue (trilha é observabilidade).
  const { error: logError } = await client.from("os_status_log").insert({
    id_int: idInt,
    status_anterior: statusEsperado,
    status_novo: statusNovo,
    resultado: "sucesso",
    motivo,
    origem: "EXPEDICAO_UI",
    ator_tipo: "USUARIO",
    ator_uid: ator.uid,
    ator_nome: ator.nome,
    tipo_transicao: tipoTransicao
  });
  if (logError) console.warn("[expedicao-acoes] Falha ao gravar os_status_log:", logError);

  return { success: true };
}

/** Upsert em expedicoes por id_int (linha nasce no primeiro gesto do expedidor). */
async function upsertExpedicao(
  idInt: number,
  campos: Record<string, unknown>
): Promise<ResultadoAcao> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase não inicializado." };
  const { error } = await client
    .from("expedicoes")
    .upsert({ id_int: idInt, updated_at: new Date().toISOString(), ...campos }, { onConflict: "id_int" });
  // A trava de frete do despacho (trigger no banco) recusa com um codigo na
  // frente da mensagem; quem le e o expedidor, entao vai so o texto.
  if (error) return { success: false, error: error.message.replace(/^EXP_DESPACHO_TRAVA_FRETE:\s*/, "") };
  return { success: true };
}

/**
 * PEDIDO COMPLEMENTAR (E9). Campos do `expedicoes` do principal que o
 * complemento recebe no despacho conjunto. Fora da lista, de propósito:
 * `peso_kg` e `qtd_volumes` (o objeto é um só e eles ficam no principal) e
 * `codigo_rastreamento` / `correios_codigo_objeto` (o webhook dos Correios casa
 * o evento por código com `maybeSingle`, e duas linhas com o mesmo código
 * quebrariam o evento). O rastreio do complemento vai para `propostas_os`.
 */
type CamposDespachoConjunto = {
  modalidade_frete: unknown;
  tipo_frete: unknown;
  transportadora_nome: unknown;
  categoria_frete: unknown;
  id_transportadora_cliente: unknown;
  id_endereco_entrega: unknown;
  tipo_volume: unknown;
};

/**
 * Grava o despacho de UM complemento junto com o principal: `expedicoes` com os
 * campos do principal e a mesma `data_despacho`, o rastreio no espelho
 * `propostas_os` e a transição para o mesmo destino. Usada pelo despacho
 * conjunto e pelo caminho de repetição.
 */
async function despacharComplementoJunto(
  idComplemento: number,
  idPrincipal: number,
  campos: CamposDespachoConjunto,
  dataDespacho: string,
  destino: string | null,
  codigoRastreamento: string | null,
  ator: AtorExpedicao
): Promise<ResultadoAcao> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase não inicializado." };

  const up = await upsertExpedicao(idComplemento, {
    modalidade_frete: campos.modalidade_frete,
    tipo_frete: campos.tipo_frete,
    transportadora_nome: campos.transportadora_nome,
    categoria_frete: campos.categoria_frete,
    id_transportadora_cliente: campos.id_transportadora_cliente,
    id_endereco_entrega: campos.id_endereco_entrega,
    tipo_volume: campos.tipo_volume,
    data_despacho: dataDespacho,
    despachado_por: ator.nome,
    obs: `Despachado junto com #${idPrincipal}`
  });
  if (!up.success) {
    return {
      success: false,
      error: `Não foi possível gravar o despacho do complemento #${idComplemento} (${up.error}). Ele segue em EXPEDICAO.`
    };
  }

  if (codigoRastreamento) {
    const { error: osError } = await client
      .from("propostas_os")
      .update({ codigo_rastreamento: codigoRastreamento })
      .eq("id_int", idComplemento);
    if (osError) console.warn("[expedicao-acoes] Falha ao espelhar rastreio na OS do complemento:", osError);
  }

  if (destino !== null) {
    const t = await transicionar(idComplemento, "EXPEDICAO", destino, ator, `Despacho conjunto com #${idPrincipal}`, "NATURAL");
    if (!t.success) {
      return {
        success: false,
        error: `${t.error} Os dados do despacho do complemento #${idComplemento} foram gravados e ele segue em EXPEDICAO.`
      };
    }
  }
  return { success: true };
}

/**
 * PEDIDO COMPLEMENTAR (E9). Complementos vinculados a `idPrincipal` que estão
 * no status informado, lidos do banco. É o recorte de "mesmo status" que a
 * coleta e a entrega propagam.
 */
async function complementosNoStatus(
  idPrincipal: number,
  status: string
): Promise<{ ids: number[]; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { ids: [], error: "Supabase não inicializado." };
  const { data, error } = await client
    .from("propostas")
    .select("id_int")
    .eq("id_int_pedido_principal", idPrincipal)
    .eq("status_interno", status);
  if (error) return { ids: [], error: error.message };
  return { ids: (data ?? []).map((c) => Number(c.id_int)) };
}

/**
 * Aplica o mesmo passo do principal a cada complemento e junta o resultado. O
 * principal já foi gravado quando isto roda: falha num complemento não o
 * desfaz, só é devolvida para a tela.
 */
async function propagarAosComplementos(
  idPrincipal: number,
  ids: number[],
  aplicar: (idComplemento: number) => Promise<ResultadoAcao>
): Promise<Pick<ResultadoAcao, "complementosDespachados" | "complementosComFalha">> {
  if (ids.length === 0) return {};
  const complementosDespachados: number[] = [];
  const complementosComFalha: Array<{ idInt: number; error: string }> = [];
  for (const id of ids) {
    const r = await aplicar(id);
    if (r.success) complementosDespachados.push(id);
    else {
      console.warn(`[expedicao-acoes] Complemento #${id} do #${idPrincipal} não acompanhou o passo:`, r.error);
      complementosComFalha.push({ idInt: id, error: r.error ?? "Falha desconhecida." });
    }
  }
  return { complementosDespachados, complementosComFalha };
}

function formatarReais(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type ComplementoNaoPago = { idInt: number; statusInterno: string; valorPago: number; valorTotal: number };

/**
 * Guarda (e), decisão 5 do dono: o despacho conjunto EXIGE complemento pago.
 * Mesma regra de "paga integralmente" da função de criação —
 * `cc__valor_pago(Y) >= round(valor_total, 2)` e `valor_total > 0` —,
 * comparada em centavos.
 *
 * A REGRA MORA SÓ AQUI: vale no despacho pelo principal e no caminho de
 * repetição (despachar o próprio complemento com o principal já despachado).
 * `erro` vem quando a conferência não pôde ser feita, e aí nada é despachado.
 */
async function complementosSemPagamentoIntegral(
  complementos: Array<{ id_int: unknown; status_interno: unknown; valor_total: unknown }>
): Promise<{ naoPagos: ComplementoNaoPago[]; erro?: ResultadoAcao }> {
  const client = getSupabaseClient();
  if (!client) return { naoPagos: [], erro: { success: false, error: "Supabase não inicializado." } };
  const naoPagos: ComplementoNaoPago[] = [];
  for (const c of complementos) {
    const idComplemento = Number(c.id_int);
    const { data: valorPagoBruto, error: erroPago } = await client.rpc("cc__valor_pago", { p_id_int: idComplemento });
    if (erroPago) {
      return {
        naoPagos: [],
        erro: {
          success: false,
          error: `Não foi possível conferir o pagamento do complemento #${idComplemento} (${erroPago.message}). O pedido segue em EXPEDICAO.`
        }
      };
    }
    const totalCentavos = Math.round(Number(c.valor_total ?? 0) * 100);
    const pagoCentavos = Math.round(Number(valorPagoBruto ?? 0) * 100);
    if (!(totalCentavos > 0 && pagoCentavos >= totalCentavos)) {
      naoPagos.push({
        idInt: idComplemento,
        statusInterno: String(c.status_interno ?? ""),
        valorPago: pagoCentavos / 100,
        valorTotal: totalCentavos / 100
      });
    }
  }
  return { naoPagos };
}

/** A recusa `COMPLEMENTO_NAO_PAGO`, com o mesmo texto nos dois caminhos. */
function recusaComplementoNaoPago(naoPagos: ComplementoNaoPago[]): ResultadoAcao {
  const lista = naoPagos
    .map((c) => `#${c.idInt} (pago ${formatarReais(c.valorPago)} de ${formatarReais(c.valorTotal)})`)
    .join(", ");
  return {
    success: false,
    code: "COMPLEMENTO_NAO_PAGO",
    complementos: naoPagos,
    error:
      `Este pedido tem complemento na Expedição sem pagamento integral: ${lista}. ` +
      "Espere o pagamento ou use \"Desvincular e despachar separado\"."
  };
}

/** Produção/acabamento → EXPEDICAO ("chegou na bancada"). */
export async function marcarPronto(
  idInt: number,
  statusAtual: string,
  ator: AtorExpedicao
): Promise<ResultadoAcao> {
  if (STATUS_FLUXO_LOGISTICO.includes(statusAtual)) {
    return {
      success: false,
      error: `Pedido já está no fluxo logístico (status ${statusAtual}).`
    };
  }
  const t = await transicionar(idInt, statusAtual, "EXPEDICAO", ator, null, "NATURAL");
  if (!t.success) return t;
  return upsertExpedicao(idInt, { data_pronto: new Date().toISOString() });
}

/** EXPEDICAO → EM TRANSITO (transporte) ou A RETIRAR (retirada). */
export async function despachar(
  idInt: number,
  inputBruto: DespachoInput,
  ator: AtorExpedicao
): Promise<ResultadoAcao> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase não inicializado." };

  // Campos mínimos. Não existe rota de API no caminho do despacho — é PostgREST
  // direto do browser, e a RLS de `propostas` é permissiva — então esta
  // checagem é a validação de verdade, não um espelho da tela.
  // A derivacao vem ANTES da validacao: em MOTOBOY o nome e imposto aqui, e e
  // ele que `camposMinimosDespacho` enxerga. Sem isto, o campo oculto na tela
  // deixaria "a transportadora" na lista de faltantes e travaria o despacho.
  const input = {
    ...inputBruto,
    transportadoraNome: transportadoraDerivada(inputBruto.tipoFrete, inputBruto.transportadoraNome),
    idTransportadoraCliente: vinculoTransportadoraDerivado(
      inputBruto.tipoFrete,
      inputBruto.idTransportadoraCliente
    )
  };

  const { data: propAtual } = await client
    .from("propostas")
    .select("status_interno, valor_frete, id_int_pedido_principal, valor_total")
    .eq("id_int", idInt)
    .maybeSingle();

  /**
   * PEDIDO COMPLEMENTAR (docs/business/PEDIDO-COMPLEMENTAR.md), lido do BANCO
   * antes de qualquer gravação. Pedido sem vínculo nenhum passa por aqui sem
   * efeito e segue exatamente como antes.
   *
   * 1. ESTE pedido é complemento: quem despacha é o principal, e os dois saem
   *    juntos. Enquanto o principal não tiver despacho, recusa. Com o principal
   *    já despachado, é o CAMINHO DE REPETIÇÃO (E9): retry do conjunto que
   *    falhou no complemento, ou complemento que ficou pronto depois. Os campos
   *    vêm do `expedicoes` do principal, e não do modal — por isso este ramo
   *    roda antes da validação dos campos digitados.
   *
   *    A guarda de pagamento vale aqui também: complemento sem pagamento
   *    integral não sai, venha pelo principal ou pela repetição. Com o override
   *    "Desvincular e despachar separado" e motivo, este pedido deixa de ser
   *    complemento e segue abaixo como despacho próprio, com os dados do modal
   *    e todas as validações de um pedido comum; o desvínculo só é gravado
   *    depois delas, junto dos demais, antes do upsert.
   */
  let desvincularEsteComplemento = false;
  const idPrincipal =
    propAtual?.id_int_pedido_principal !== null && propAtual?.id_int_pedido_principal !== undefined
      ? Number(propAtual.id_int_pedido_principal)
      : null;
  if (idPrincipal !== null) {
    const { data: expPrincipal } = await client
      .from("expedicoes")
      .select(
        "data_despacho, modalidade_frete, tipo_frete, transportadora_nome, categoria_frete, id_transportadora_cliente, id_endereco_entrega, tipo_volume, codigo_rastreamento"
      )
      .eq("id_int", idPrincipal)
      .maybeSingle();
    if (!expPrincipal?.data_despacho) {
      return {
        success: false,
        code: "COMPLEMENTO_SEGUE_PRINCIPAL",
        error: `Este pedido é complemento do #${idPrincipal}: o despacho é feito pelo pedido principal, e os dois saem juntos.`
      };
    }
    if (propAtual && String(propAtual.status_interno ?? "").trim() !== "EXPEDICAO") {
      return { success: false, error: MSG_CONFLITO };
    }
    const conferencia = await complementosSemPagamentoIntegral([
      { id_int: idInt, status_interno: propAtual?.status_interno, valor_total: propAtual?.valor_total }
    ]);
    if (conferencia.erro) return conferencia.erro;
    if (conferencia.naoPagos.length > 0) {
      if (!input.desvincularComplementos) return recusaComplementoNaoPago(conferencia.naoPagos);
      if (!input.desvincularComplementos.motivo.trim()) {
        return {
          success: false,
          code: "COMPLEMENTO_NAO_PAGO",
          complementos: conferencia.naoPagos,
          error: "Informe o motivo para desvincular o complemento e despachar separado."
        };
      }
      desvincularEsteComplemento = true;
    } else {
      const tipoFretePrincipal = String(expPrincipal.tipo_frete ?? "") as TipoFreteNormalizado;
      const destinoPrincipal = destinoDoDespacho(
        tipoFretePrincipal === "RETIRA_BALCAO" ? "RETIRADA" : "TRANSPORTE",
        tipoFretePrincipal
      );
      const repeticao = await despacharComplementoJunto(
        idInt,
        idPrincipal,
        expPrincipal,
        String(expPrincipal.data_despacho),
        destinoPrincipal,
        expPrincipal.codigo_rastreamento ? String(expPrincipal.codigo_rastreamento) : null,
        ator
      );
      if (!repeticao.success) return repeticao;
      return { success: true, aguardandoColeta: destinoPrincipal === null };
    }
  }

  const faltantes = camposMinimosDespacho(input, "DESPACHO");
  if (faltantes.length > 0) {
    return { success: false, error: `Antes de despachar, informe ${frasearFaltantes(faltantes)}.` };
  }

  // Regra das três saídas em `lib/destino-despacho.ts`. `null` = sem transição.
  const destino = destinoDoDespacho(input.tipoEntrega, input.tipoFrete);

  // TRAVA DE FRETE (24/09/2026). Quem garante e a trigger
  // `trg_exp_trava_frete_despacho`, no banco: o despacho e PostgREST direto do
  // browser (§3.5 do EXPEDICAO.md), e so o banco nao e contornavel. Aqui a mesma
  // funcao e consultada ANTES de gravar, para recusar com a mensagem certa em
  // vez do erro cru da trigger. Com CEP ou transporte diferentes do cotado, vale
  // a ultima recotacao para o CEP de agora: ate R$ 4,00 acima do frete da
  // proposta passa; acima, ou sem recotacao, so com liberacao de ADM.
  const { data: endereco } = input.idEnderecoEntrega
    ? await client.from("enderecos").select("cep").eq("id", input.idEnderecoEntrega).maybeSingle()
    : { data: null as { cep: string | null } | null };
  const { data: trava } = await client.rpc("exp_trava_frete_despacho", {
    p_id_int: idInt,
    p_cep_destino: endereco?.cep ?? null,
    p_tipo_frete: input.tipoFrete,
    p_modalidade: input.modalidadeFrete
  });
  const veredito = trava as { bloqueia?: boolean; mensagem?: string } | null;
  if (veredito?.bloqueia) {
    return { success: false, error: veredito.mensagem || "Despacho bloqueado pela diferença de frete." };
  }

  // Leitura de cortesia: pega a aba obsoleta ANTES de escrever, no caso comum.
  // Não é garantia — quem garante a transição é o `.eq(status_interno, ...)` do
  // `transicionar`, preservado abaixo.
  if (propAtual && String(propAtual.status_interno ?? "").trim() !== "EXPEDICAO") {
    return { success: false, error: MSG_CONFLITO };
  }

  /**
   * 2. ESTE pedido tem complemento aberto que ainda não chegou à Expedição
   *    (guarda (c), E8), ou que está nela sem pagamento integral (guarda (e),
   *    E9): recusa, a menos que o expedidor tenha escolhido "Desvincular e
   *    despachar separado" com motivo. Nesse caso cada um é desvinculado AQUI,
   *    antes do upsert; falhando qualquer um, nada do despacho é gravado.
   */
  const { data: complementosAbertos, error: erroComplementos } = await client
    .from("propostas")
    .select("id_int, status_interno, valor_total")
    .eq("id_int_pedido_principal", idInt)
    .neq("status_interno", "CANCELADO");
  if (erroComplementos) {
    return {
      success: false,
      error: `Não foi possível verificar os pedidos complementares (${erroComplementos.message}). O pedido segue em EXPEDICAO.`
    };
  }
  const complementosForaDaExpedicao = (complementosAbertos ?? [])
    .filter((c) => String(c.status_interno ?? "").trim().toUpperCase() !== "EXPEDICAO")
    .map((c) => ({ idInt: Number(c.id_int), statusInterno: String(c.status_interno ?? "") }));

  if (complementosForaDaExpedicao.length > 0 && !input.desvincularComplementos) {
    const lista = complementosForaDaExpedicao.map((c) => `#${c.idInt} (${c.statusInterno || "sem status"})`).join(", ");
    return {
      success: false,
      code: "COMPLEMENTO_FORA_EXPEDICAO",
      complementos: complementosForaDaExpedicao,
      error:
        `Este pedido tem complemento que ainda não chegou à Expedição: ${lista}. ` +
        "Espere o complemento ou use \"Desvincular e despachar separado\"."
    };
  }

  // Guarda (e): regra em `complementosSemPagamentoIntegral`.
  const complementosEmExpedicao = (complementosAbertos ?? []).filter(
    (c) => String(c.status_interno ?? "").trim().toUpperCase() === "EXPEDICAO"
  );
  const conferenciaPagamento = await complementosSemPagamentoIntegral(complementosEmExpedicao);
  if (conferenciaPagamento.erro) return conferenciaPagamento.erro;
  const complementosNaoPagos = conferenciaPagamento.naoPagos;
  if (complementosNaoPagos.length > 0 && !input.desvincularComplementos) {
    return recusaComplementoNaoPago(complementosNaoPagos);
  }

  // O próprio pedido entra na lista quando é complemento não pago despachado
  // separado pelo override (caminho de repetição, acima).
  const complementosADesvincular = [
    ...(desvincularEsteComplemento
      ? [{ idInt, statusInterno: String(propAtual?.status_interno ?? "") }]
      : []),
    ...complementosForaDaExpedicao,
    ...complementosNaoPagos
  ];
  if (complementosADesvincular.length > 0 && input.desvincularComplementos) {
    const motivo = input.desvincularComplementos.motivo.trim();
    if (!motivo) {
      return {
        success: false,
        code: complementosForaDaExpedicao.length > 0 ? "COMPLEMENTO_FORA_EXPEDICAO" : "COMPLEMENTO_NAO_PAGO",
        complementos: complementosADesvincular,
        error: "Informe o motivo para desvincular o complemento e despachar separado."
      };
    }
    for (const complemento of complementosADesvincular) {
      const { error: erroDesvinculo } = await client.rpc("desvincular_pedido_complementar", {
        p_id_int_complemento: complemento.idInt,
        p_motivo: motivo,
        p_origem: "EXPEDICAO",
        p_limpar_vinculo: true
      });
      if (erroDesvinculo) {
        return {
          success: false,
          error: `Não foi possível desvincular o complemento #${complemento.idInt} (${erroDesvinculo.message}). Nada do despacho foi gravado.`
        };
      }
    }
  }

  // GRAVA PRIMEIRO, TRANSICIONA DEPOIS (invertido em 20/08/2026).
  // Na ordem anterior o status ia primeiro, e uma falha na gravação deixava o
  // pedido FORA do funil logístico com os dados pela metade — o próprio código
  // admitia isso na mensagem de erro. Invertido, uma falha de escrita deixa o
  // pedido exatamente onde estava, e o expedidor tenta de novo.
  /**
   * A CATEGORIA DO PAINEL, derivada do que o expedidor REGISTROU — nao do que a
   * proposta declarou.
   *
   * Aqui esta a resposta para a recotacao: `exp_aplicar_recotacao` troca o frete
   * mas so escreve `valor_frete` e `valor_total` em `propostas`, e a
   * transportadora recotada nunca chega la — ela vive no estado do modal e se
   * materializa AQUI. Gravando a categoria no despacho, o pedido recotado entra
   * na coluna certa sem que ninguem precise reescrever a proposta.
   *
   * `tipo_frete` entra como servico de proposito: CORREIOS, MOTOBOY e
   * RETIRA_BALCAO ja sao o vocabulario que a derivacao le, e `transportadora_nome`
   * cobre VEPPO, Azul e Sao Miguel. Transportadora sem meio conhecido devolve
   * `null`, e a leitura cai na declaracao da proposta pela precedencia.
   *
   * NAO retroalimenta `propostas`: a proposta guarda o que foi vendido, a
   * expedicao guarda o que aconteceu.
   */
  // Nao ha declaracao no despacho: o expedidor registra QUEM leva, nao o meio.
  // Por isso a tabela de nomes entra logo atras da derivacao forte.
  const categoriaFrete =
    categoriaDoServico(input.transportadoraNome || null, input.tipoFrete, input.modalidadeFrete) ??
    categoriaPorNomeConhecido(input.transportadoraNome || null, input.tipoFrete);

  // Um ISO só: o complemento que sai junto recebe exatamente a mesma data.
  const dataDespacho = new Date().toISOString();
  const up = await upsertExpedicao(idInt, {
    modalidade_frete: input.modalidadeFrete,
    tipo_frete: input.tipoFrete,
    transportadora_nome: input.transportadoraNome || null,
    categoria_frete: categoriaFrete,
    id_transportadora_cliente: input.idTransportadoraCliente,
    peso_kg: input.pesoKg,
    qtd_volumes: input.qtdVolumes,
    tipo_volume: input.tipoVolume,
    id_endereco_entrega: input.idEnderecoEntrega,
    codigo_rastreamento: input.codigoRastreamento || null,
    // `undefined` NAO entra no upsert: o modal parou de enviar `obs` e escrever
    // `null` aqui apagaria o recado interno de quem ainda o tem gravado.
    ...(input.obs !== undefined ? { obs: input.obs || null } : {}),
    // Campos da etiqueta, no MESMO upsert dos demais: uma escrita so, mesma
    // transacao implicita, mesmo tratamento de erro.
    obs_etiqueta: input.obsEtiqueta?.trim() || null,
    nf_numero_manual: input.nfNumeroManual?.trim() || null,
    data_despacho: dataDespacho,
    despachado_por: ator.nome
  });
  if (!up.success) {
    return { success: false, error: `Não foi possível gravar os dados do despacho (${up.error}). O pedido segue em EXPEDICAO.` };
  }

  // Sem destino, não há transição a fazer: o pedido FICA em EXPEDICAO por
  // desenho, e é a gravação acima que o coloca em "aguardando coleta".
  if (destino !== null) {
    const t = await transicionar(idInt, "EXPEDICAO", destino, ator, null, "NATURAL");
    if (!t.success) {
      // Dados gravados, status não. É o lado seguro da inversão: o pedido continua
      // no funil e os dados estão lá para conferência.
      return {
        success: false,
        error: `${t.error} Os dados do despacho foram gravados e o pedido segue em EXPEDICAO.`
      };
    }
  }

  // Espelho para as telas legadas que leem o rastreio na OS.
  if (input.codigoRastreamento) {
    const { error: osError } = await client
      .from("propostas_os")
      .update({ codigo_rastreamento: input.codigoRastreamento })
      .eq("id_int", idInt);
    if (osError) console.warn("[expedicao-acoes] Falha ao espelhar rastreio na OS:", osError);
  }

  /**
   * DESPACHO CONJUNTO (E9). Principal gravado e transicionado; agora os
   * complementos que estão em EXPEDICAO, relidos do BANCO (os desvinculados
   * acima já não aparecem), saem na mesma caixa. Falha num complemento não
   * desfaz o principal: volta em `complementosComFalha`, e o caminho de
   * repetição (`despachar` no próprio complemento) fecha o passo.
   */
  const { data: complementosJuntos, error: erroJuntos } = await client
    .from("propostas")
    .select("id_int")
    .eq("id_int_pedido_principal", idInt)
    .eq("status_interno", "EXPEDICAO");
  if (erroJuntos) {
    const pendentes = complementosEmExpedicao
      .map((c) => Number(c.id_int))
      .filter((id) => !complementosNaoPagos.some((n) => n.idInt === id));
    if (pendentes.length > 0) {
      return {
        success: true,
        aguardandoColeta: destino === null,
        complementosDespachados: [],
        complementosComFalha: pendentes.map((id) => ({
          idInt: id,
          error: `Não foi possível reler os complementos (${erroJuntos.message}).`
        }))
      };
    }
    return { success: true, aguardandoColeta: destino === null };
  }
  const conjunto = await propagarAosComplementos(
    idInt,
    (complementosJuntos ?? []).map((c) => Number(c.id_int)),
    (idComplemento) =>
      despacharComplementoJunto(
        idComplemento,
        idInt,
        {
          modalidade_frete: input.modalidadeFrete,
          tipo_frete: input.tipoFrete,
          transportadora_nome: input.transportadoraNome || null,
          categoria_frete: categoriaFrete,
          id_transportadora_cliente: input.idTransportadoraCliente,
          id_endereco_entrega: input.idEnderecoEntrega,
          tipo_volume: input.tipoVolume
        },
        dataDespacho,
        destino,
        input.codigoRastreamento || null,
        ator
      )
  );

  return { success: true, aguardandoColeta: destino === null, ...conjunto };
}

/**
 * AGUARDANDO COLETA → EM TRANSITO. O carro passou e levou o volume.
 *
 * Espelha `marcarPronto`: grava a data e chama o MESMO `transicionar`, com a
 * mesma guarda de concorrência (`.eq("status_interno", "EXPEDICAO")` lá dentro)
 * e a mesma trilha em `os_status_log`. Não há status novo nem caminho paralelo.
 *
 * A ORDEM É A DO DESPACHO: grava primeiro, transiciona depois. Falhando a
 * escrita, o pedido fica exatamente onde estava; falhando a transição, a data
 * de coleta fica gravada e o pedido segue em `EXPEDICAO` — o mesmo lado seguro
 * que `despachar` escolheu em 20/08/2026, e um novo clique fecha o passo.
 */
export async function confirmarColeta(idInt: number, ator: AtorExpedicao): Promise<ResultadoAcao> {
  const coletadoEm = new Date().toISOString();
  const up = await upsertExpedicao(idInt, { coletado_em: coletadoEm });
  if (!up.success) {
    return { success: false, error: `Não foi possível registrar a coleta (${up.error}). O pedido segue em EXPEDICAO.` };
  }
  const t = await transicionar(idInt, "EXPEDICAO", "EM TRANSITO", ator, null, "NATURAL");
  if (!t.success) {
    return { success: false, error: `${t.error} A coleta foi registrada e o pedido segue em EXPEDICAO.` };
  }

  /**
   * PEDIDO COMPLEMENTAR (E9): a coleta propaga para o complemento no mesmo
   * status que saiu no despacho conjunto — em EXPEDICAO, com `data_despacho` e
   * ainda sem `coletado_em`. Complemento em EXPEDICAO que não foi despachado
   * não foi no carro, e fica.
   */
  const noStatus = await complementosNoStatus(idInt, "EXPEDICAO");
  let aguardandoColeta: number[] = [];
  if (noStatus.error) console.warn("[expedicao-acoes] Falha ao ler complementos para a coleta:", noStatus.error);
  else if (noStatus.ids.length > 0) {
    const client = getSupabaseClient();
    const { data: exps, error: erroExps } = client
      ? await client.from("expedicoes").select("id_int, data_despacho, coletado_em").in("id_int", noStatus.ids)
      : { data: null, error: { message: "Supabase não inicializado." } };
    if (erroExps) console.warn("[expedicao-acoes] Falha ao ler o despacho dos complementos:", erroExps);
    aguardandoColeta = (exps ?? [])
      .filter((e) => Boolean(e.data_despacho) && !e.coletado_em)
      .map((e) => Number(e.id_int));
  }
  const propagacao = await propagarAosComplementos(idInt, aguardandoColeta, async (idComplemento) => {
    const upC = await upsertExpedicao(idComplemento, { coletado_em: coletadoEm });
    if (!upC.success) return upC;
    return transicionar(idComplemento, "EXPEDICAO", "EM TRANSITO", ator, `Coleta conjunta com #${idInt}`, "NATURAL");
  });
  return { success: true, ...propagacao };
}

/**
 * Transportadora que vai para o banco, derivada do COMO VAI.
 *
 * MOTOBOY nao tem transportadora a digitar: o proprio meio ja e a resposta, e o
 * campo so servia para herdar lixo de uma escolha anterior. Foi o que aconteceu
 * no 21055 — despacho de motoboy gravado com "Retira balcao", porque o pedido
 * tinha sido retirada antes e o valor sobreviveu no formulario. A etiqueta
 * imprimiu isso.
 *
 * Derivado no momento de GRAVAR, nunca digitado: a tela esconde o campo, e aqui
 * o valor e imposto — quem chamar o service por outro caminho recebe a mesma
 * regra. Os demais transportes seguem com o nome informado.
 */
export function transportadoraDerivada(
  tipoFrete: TipoFreteNormalizado,
  nomeInformado: string | null | undefined
): string {
  if (tipoFrete === "MOTOBOY") return "Motoboy";
  return String(nomeInformado ?? "").trim();
}

/**
 * Vinculo com transportadora cadastrada: MOTOBOY nao tem. O select some da tela
 * nesse caso, e mandar o id anterior gravaria um vinculo orfao, invisivel para
 * quem for conferir depois. Decisao do dono em 24/08/2026.
 */
export function vinculoTransportadoraDerivado(
  tipoFrete: TipoFreteNormalizado,
  idInformado: number | null
): number | null {
  if (tipoFrete === "MOTOBOY") return null;
  return idInformado;
}

/** A RETIRAR → ENTREGUE (quem retirou fica registrado). */
export async function confirmarRetirada(
  idInt: number,
  retiradoPor: string,
  ator: AtorExpedicao
): Promise<ResultadoAcao> {
  const t = await transicionar(idInt, "A RETIRAR", "ENTREGUE", ator, null, "NATURAL");
  if (!t.success) return t;
  const dataEntrega = new Date().toISOString();
  const up = await upsertExpedicao(idInt, {
    data_entrega: dataEntrega,
    retirado_por: retiradoPor || null
  });
  if (!up.success) {
    return {
      success: false,
      error: `Pedido marcado como ENTREGUE, mas a data de entrega não foi gravada (${up.error}). Use 'Editar dados de expedição'.`
    };
  }

  // PEDIDO COMPLEMENTAR (E9): a retirada propaga para o complemento em A RETIRAR.
  const noStatus = await complementosNoStatus(idInt, "A RETIRAR");
  if (noStatus.error) console.warn("[expedicao-acoes] Falha ao ler complementos para a retirada:", noStatus.error);
  const propagacao = await propagarAosComplementos(idInt, noStatus.ids, async (idComplemento) => {
    const tC = await transicionar(idComplemento, "A RETIRAR", "ENTREGUE", ator, `Retirada conjunta com #${idInt}`, "NATURAL");
    if (!tC.success) return tC;
    return upsertExpedicao(idComplemento, { data_entrega: dataEntrega, retirado_por: retiradoPor || null });
  });
  return { ...up, ...propagacao };
}

/** EM TRANSITO → ENTREGUE. */
export async function marcarEntregue(idInt: number, ator: AtorExpedicao): Promise<ResultadoAcao> {
  const t = await transicionar(idInt, "EM TRANSITO", "ENTREGUE", ator, null, "NATURAL");
  if (!t.success) return t;
  const dataEntrega = new Date().toISOString();
  const up = await upsertExpedicao(idInt, { data_entrega: dataEntrega });
  if (!up.success) {
    return {
      success: false,
      error: `Pedido marcado como ENTREGUE, mas a data de entrega não foi gravada (${up.error}). Use 'Editar dados de expedição'.`
    };
  }

  // PEDIDO COMPLEMENTAR (E9): a entrega propaga para o complemento em EM TRANSITO.
  const noStatus = await complementosNoStatus(idInt, "EM TRANSITO");
  if (noStatus.error) console.warn("[expedicao-acoes] Falha ao ler complementos para a entrega:", noStatus.error);
  const propagacao = await propagarAosComplementos(idInt, noStatus.ids, async (idComplemento) => {
    const tC = await transicionar(idComplemento, "EM TRANSITO", "ENTREGUE", ator, `Entrega conjunta com #${idInt}`, "NATURAL");
    if (!tC.success) return tC;
    return upsertExpedicao(idComplemento, { data_entrega: dataEntrega });
  });
  return { ...up, ...propagacao };
}

/**
 * Desfaz exatamente 1 passo. Destinos:
 *  ENTREGUE → EM TRANSITO se o despacho foi transporte; senão A RETIRAR;
 *  EM TRANSITO | A RETIRAR → EXPEDICAO;
 *  EXPEDICAO → EM ACABAMENTO.
 *
 * PEDIDO COMPLEMENTAR: NÃO propaga para os complementos, de propósito. Voltar o
 * principal não desfaz o despacho do complemento (pendência registrada em
 * docs/business/PEDIDO-COMPLEMENTAR.md).
 */
export async function voltarStatus(
  idInt: number,
  statusAtual: string,
  motivo: string,
  ator: AtorExpedicao
): Promise<ResultadoAcao> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase não inicializado." };

  let destino: string;
  if (statusAtual === "ENTREGUE") {
    // Leitura sem lock: a decisão de destino (A RETIRAR vs EM TRANSITO) se
    // baseia neste SELECT solto em expedicoes. Uma edição concorrente de
    // tipo_frete/retirado_por entre este SELECT e o UPDATE de propostas logo
    // abaixo (em transicionar) pode mandar o retorno para o braço errado.
    // Aceito por ser operação de balcão de baixa concorrência e reversível
    // (um novo "Voltar status" corrige); o fix real exigiria RPC
    // transacional (SELECT ... FOR UPDATE + UPDATE na mesma transação).
    const { data } = await client
      .from("expedicoes")
      .select("tipo_frete, retirado_por")
      .eq("id_int", idInt)
      .maybeSingle();
    const foiRetirada = data?.tipo_frete === "RETIRA_BALCAO" || Boolean(data?.retirado_por);
    destino = foiRetirada ? "A RETIRAR" : "EM TRANSITO";
  } else if (statusAtual === "EM TRANSITO" || statusAtual === "A RETIRAR") {
    destino = "EXPEDICAO";
  } else if (statusAtual === "EXPEDICAO") {
    destino = "EM ACABAMENTO";
  } else {
    return { success: false, error: `Não há retorno definido a partir de "${statusAtual}".` };
  }

  const t = await transicionar(idInt, statusAtual, destino, ator, motivo || null, "RETORNO");
  if (!t.success) return t;

  // Limpa a data correspondente ao passo desfeito.
  if (statusAtual === "ENTREGUE") return upsertExpedicao(idInt, { data_entrega: null, retirado_por: null });
  // `coletado_em` sai junto com `data_despacho` (02/09/2026): desfazer o
  // despacho tem de desfazer também a coleta, senão o pedido voltaria a
  // EXPEDICAO já marcado como coletado e nunca mais apareceria como aguardando
  // coleta — ficaria invisível para a bancada.
  if (statusAtual === "EM TRANSITO" || statusAtual === "A RETIRAR")
    return upsertExpedicao(idInt, { data_despacho: null, coletado_em: null });
  return upsertExpedicao(idInt, { data_pronto: null });
}

/** Edita dados de execução sem mexer no status. */
export async function salvarDadosExpedicao(
  idInt: number,
  dados: Partial<Omit<DespachoInput, "tipoEntrega">>
): Promise<ResultadoAcao> {
  const campos: Record<string, unknown> = {};
  if (dados.modalidadeFrete !== undefined) campos.modalidade_frete = dados.modalidadeFrete;
  if (dados.tipoFrete !== undefined) campos.tipo_frete = dados.tipoFrete;
  // Mesma derivacao do despacho: rascunho de motoboy tambem nao herda nome de
  // escolha anterior. `tipoFrete` pode nao vir no patch — sem ele, nada a derivar.
  if (dados.transportadoraNome !== undefined) {
    campos.transportadora_nome =
      (dados.tipoFrete ? transportadoraDerivada(dados.tipoFrete, dados.transportadoraNome) : dados.transportadoraNome) ||
      null;
  }
  if (dados.idTransportadoraCliente !== undefined) {
    campos.id_transportadora_cliente = dados.tipoFrete
      ? vinculoTransportadoraDerivado(dados.tipoFrete, dados.idTransportadoraCliente)
      : dados.idTransportadoraCliente;
  }
  /**
   * A categoria acompanha a declaracao editada. Sem isto, corrigir a
   * transportadora depois do despacho deixaria a coluna apontando para o
   * transporte anterior — o mesmo defeito que a rota admin da transportadora
   * tem do lado da proposta. So recalcula quando ha o que derivar.
   */
  if (dados.tipoFrete !== undefined || dados.transportadoraNome !== undefined) {
    const nomeEditado = (campos.transportadora_nome as string | null) ?? dados.transportadoraNome ?? null;
    campos.categoria_frete =
      categoriaDoServico(nomeEditado, dados.tipoFrete ?? null, dados.modalidadeFrete ?? null) ??
      categoriaPorNomeConhecido(nomeEditado, dados.tipoFrete ?? null);
  }
  if (dados.pesoKg !== undefined) campos.peso_kg = dados.pesoKg;
  if (dados.qtdVolumes !== undefined) campos.qtd_volumes = dados.qtdVolumes;
  if (dados.tipoVolume !== undefined) campos.tipo_volume = dados.tipoVolume;
  if (dados.idEnderecoEntrega !== undefined) campos.id_endereco_entrega = dados.idEnderecoEntrega;
  if (dados.codigoRastreamento !== undefined) campos.codigo_rastreamento = dados.codigoRastreamento || null;
  if (dados.obs !== undefined) campos.obs = dados.obs || null;
  if (dados.obsEtiqueta !== undefined) campos.obs_etiqueta = dados.obsEtiqueta.trim() || null;
  if (dados.nfNumeroManual !== undefined) campos.nf_numero_manual = dados.nfNumeroManual.trim() || null;
  return upsertExpedicao(idInt, campos);
}
