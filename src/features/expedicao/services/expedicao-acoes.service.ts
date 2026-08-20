import { getSupabaseClient } from "@/lib/supabase/client";
import type { ModalidadeFrete, TipoFreteNormalizado } from "../types";

export type AtorExpedicao = { uid: string | null; nome: string | null };
export type ResultadoAcao = { success: boolean; error?: string };

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
  obs: string;
};

import { camposMinimosDespacho, frasearFaltantes } from "../lib/campos-minimos-despacho";
import { divergenciaFreteDoDespacho, frasearMotivos } from "../lib/divergencia-frete-despacho";

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
  if (error) return { success: false, error: error.message };
  return { success: true };
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
  input: DespachoInput,
  ator: AtorExpedicao
): Promise<ResultadoAcao> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase não inicializado." };

  // Campos mínimos. Não existe rota de API no caminho do despacho — é PostgREST
  // direto do browser, e a RLS de `propostas` é permissiva — então esta
  // checagem é a validação de verdade, não um espelho da tela.
  const faltantes = camposMinimosDespacho(input, "DESPACHO");
  if (faltantes.length > 0) {
    return { success: false, error: `Antes de despachar, informe ${frasearFaltantes(faltantes)}.` };
  }

  const destino = input.tipoEntrega === "RETIRADA" ? "A RETIRAR" : "EM TRANSITO";

  // Divergência bloqueante. A UI já barra, mas ela é só a UI: o despacho é
  // PostgREST direto do browser, sem rota de API que revalide (§3.5 do
  // EXPEDICAO.md). A referência de peso/CEP é a ÚLTIMA recotação aplicada
  // quando houver — `cotacao_frete` não muda ao aplicar uma —, e só na falta
  // dela a cotação escolhida.
  const [{ data: cot }, { data: ultimaRecot }, { data: endereco }] = await Promise.all([
    client.from("cotacao_frete").select("servico, peso, cep").eq("id_int", idInt).eq("escolhido", true).limit(1).maybeSingle(),
    client
      .from("expedicao_recotacoes")
      .select("peso_gramas, cep")
      .eq("id_int", idInt)
      .order("aplicado_em", { ascending: false })
      .limit(1)
      .maybeSingle(),
    input.idEnderecoEntrega
      ? client.from("enderecos").select("cep").eq("id", input.idEnderecoEntrega).maybeSingle()
      : Promise.resolve({ data: null } as { data: { cep: string | null } | null })
  ]);

  const { data: propAtual } = await client
    .from("propostas")
    .select("status_interno, valor_frete")
    .eq("id_int", idInt)
    .maybeSingle();

  const divergencia = divergenciaFreteDoDespacho({
    cotacao: {
      pesoGramas: ultimaRecot ? ultimaRecot.peso_gramas : cot?.peso,
      cep: ultimaRecot ? ultimaRecot.cep : cot?.cep,
      valor: propAtual?.valor_frete,
      servico: cot?.servico,
      existe: Boolean(cot)
    },
    pesoAferidoGramas: input.pesoKg !== null ? Math.round(input.pesoKg * 1000) : null,
    cepDestino: endereco?.cep ?? null,
    modalidadeEfetiva: input.modalidadeFrete,
    tipoFreteEscolhido: input.tipoFrete,
    tipoFreteJaDespachado: null
  });
  if (divergencia.bloqueia) {
    return {
      success: false,
      error: `Recote o frete antes de despachar: ${frasearMotivos(divergencia.motivos)}.`
    };
  }

  // Leitura de cortesia: pega a aba obsoleta ANTES de escrever, no caso comum.
  // Não é garantia — quem garante a transição é o `.eq(status_interno, ...)` do
  // `transicionar`, preservado abaixo.
  if (propAtual && String(propAtual.status_interno ?? "").trim() !== "EXPEDICAO") {
    return { success: false, error: MSG_CONFLITO };
  }

  // GRAVA PRIMEIRO, TRANSICIONA DEPOIS (invertido em 20/08/2026).
  // Na ordem anterior o status ia primeiro, e uma falha na gravação deixava o
  // pedido FORA do funil logístico com os dados pela metade — o próprio código
  // admitia isso na mensagem de erro. Invertido, uma falha de escrita deixa o
  // pedido exatamente onde estava, e o expedidor tenta de novo.
  const up = await upsertExpedicao(idInt, {
    modalidade_frete: input.modalidadeFrete,
    tipo_frete: input.tipoFrete,
    transportadora_nome: input.transportadoraNome || null,
    id_transportadora_cliente: input.idTransportadoraCliente,
    peso_kg: input.pesoKg,
    qtd_volumes: input.qtdVolumes,
    tipo_volume: input.tipoVolume,
    id_endereco_entrega: input.idEnderecoEntrega,
    codigo_rastreamento: input.codigoRastreamento || null,
    obs: input.obs || null,
    data_despacho: new Date().toISOString(),
    despachado_por: ator.nome
  });
  if (!up.success) {
    return { success: false, error: `Não foi possível gravar os dados do despacho (${up.error}). O pedido segue em EXPEDICAO.` };
  }

  const t = await transicionar(idInt, "EXPEDICAO", destino, ator, null, "NATURAL");
  if (!t.success) {
    // Dados gravados, status não. É o lado seguro da inversão: o pedido continua
    // no funil e os dados estão lá para conferência.
    return {
      success: false,
      error: `${t.error} Os dados do despacho foram gravados e o pedido segue em EXPEDICAO.`
    };
  }

  // Espelho para as telas legadas que leem o rastreio na OS.
  if (input.codigoRastreamento) {
    const { error: osError } = await client
      .from("propostas_os")
      .update({ codigo_rastreamento: input.codigoRastreamento })
      .eq("id_int", idInt);
    if (osError) console.warn("[expedicao-acoes] Falha ao espelhar rastreio na OS:", osError);
  }

  return { success: true };
}

/** A RETIRAR → ENTREGUE (quem retirou fica registrado). */
export async function confirmarRetirada(
  idInt: number,
  retiradoPor: string,
  ator: AtorExpedicao
): Promise<ResultadoAcao> {
  const t = await transicionar(idInt, "A RETIRAR", "ENTREGUE", ator, null, "NATURAL");
  if (!t.success) return t;
  const up = await upsertExpedicao(idInt, {
    data_entrega: new Date().toISOString(),
    retirado_por: retiradoPor || null
  });
  if (!up.success) {
    return {
      success: false,
      error: `Pedido marcado como ENTREGUE, mas a data de entrega não foi gravada (${up.error}). Use 'Editar dados de expedição'.`
    };
  }
  return up;
}

/** EM TRANSITO → ENTREGUE. */
export async function marcarEntregue(idInt: number, ator: AtorExpedicao): Promise<ResultadoAcao> {
  const t = await transicionar(idInt, "EM TRANSITO", "ENTREGUE", ator, null, "NATURAL");
  if (!t.success) return t;
  const up = await upsertExpedicao(idInt, { data_entrega: new Date().toISOString() });
  if (!up.success) {
    return {
      success: false,
      error: `Pedido marcado como ENTREGUE, mas a data de entrega não foi gravada (${up.error}). Use 'Editar dados de expedição'.`
    };
  }
  return up;
}

/**
 * Desfaz exatamente 1 passo. Destinos:
 *  ENTREGUE → EM TRANSITO se o despacho foi transporte; senão A RETIRAR;
 *  EM TRANSITO | A RETIRAR → EXPEDICAO;
 *  EXPEDICAO → EM ACABAMENTO.
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
  if (statusAtual === "EM TRANSITO" || statusAtual === "A RETIRAR")
    return upsertExpedicao(idInt, { data_despacho: null });
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
  if (dados.transportadoraNome !== undefined) campos.transportadora_nome = dados.transportadoraNome || null;
  if (dados.idTransportadoraCliente !== undefined) campos.id_transportadora_cliente = dados.idTransportadoraCliente;
  if (dados.pesoKg !== undefined) campos.peso_kg = dados.pesoKg;
  if (dados.qtdVolumes !== undefined) campos.qtd_volumes = dados.qtdVolumes;
  if (dados.tipoVolume !== undefined) campos.tipo_volume = dados.tipoVolume;
  if (dados.idEnderecoEntrega !== undefined) campos.id_endereco_entrega = dados.idEnderecoEntrega;
  if (dados.codigoRastreamento !== undefined) campos.codigo_rastreamento = dados.codigoRastreamento || null;
  if (dados.obs !== undefined) campos.obs = dados.obs || null;
  return upsertExpedicao(idInt, campos);
}
