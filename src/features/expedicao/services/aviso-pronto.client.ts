"use client";

import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Aviso "pedido pronto" pelo WhatsApp da Ideal (ChatGuru), 06/11/2026. Desde
 * 07/11/2026 por diálogo com template (um por forma de envio): o estado final é
 * "executado" — o ChatGuru não devolve message_id nem status de entrega.
 *
 * Tudo passa pela Edge Function `expedicao-pedido-pronto`: ela confere a
 * sessão e a permissão, relê pedido e contato, reserva e envia. A tabela
 * `expedicao_aviso_pronto` é só do service_role; a tela nunca lê nem grava nela.
 *
 * Destino (09/11/2026): a conversa do ChatGuru (remetente 3478) do cliente do
 * pedido, lida pelo servidor na visão chatguru_contatos_3478. Quando a regra não
 * decide sozinha, a resposta traz `escolha` e nada é enviado: a tela pergunta e
 * chama de novo com a seleção (`SelecaoConversas`).
 */

export type EstadoAviso = "preparando" | "aguardando" | "enviado" | "executado" | "falhou" | "desconhecido";

/**
 * Diálogo do ChatGuru escolhido pelo servidor para a forma de envio do pedido
 * (07/11/2026). Sem diálogo ou com bloqueio, o botão fica apagado com o aviso.
 */
export type ModeloAviso = {
  dialogo: string | null;
  bloqueio: string | null;
  /** "Testar modelo": modo teste ligado e pedido do cliente #14 (o servidor decide e confere de novo). */
  testavel?: boolean;
  /** Modo homologação (10/11/2026): modo teste ligado e pedido fora do cliente #14; o aviso vai para a conversa de teste. */
  homologacao?: boolean;
};

/** Os seis diálogos do ChatGuru, na ordem do "Testar modelo". */
export const DIALOGOS_AVISO = ["Sedex", "Motoboy", "Retira", "Veppo", "Azul", "Transportadora"] as const;
export type DialogoAviso = (typeof DIALOGOS_AVISO)[number];

/** Campos enviados num teste e quais deles foram com valor de teste. */
export type CamposDoTeste = { valores: Record<string, string>; de_teste: string[] };

export type AvisoPronto = {
  seq: number;
  estado: EstadoAviso;
  message_id: string | null;
  /** Nome do diálogo usado (Sedex, Retira...). Nulo nos avisos antigos por texto. */
  dialogo?: string | null;
  /** Diálogo em incerteza: o WhatsApp fica travado para novos avisos. */
  trava_conversa?: boolean;
  /**
   * v19 (trava compartilhada com o Imposition): o aviso já terminou, mas a conversa
   * ficou presa porque o servidor não conseguiu soltá-la. O ADM solta pelo Liberar número.
   */
  trava_compartilhada_presa?: boolean;
  modo_teste: boolean;
  /** Envio do "Testar modelo" ou da homologação (não conta como aviso do pedido). */
  teste?: boolean;
  /** Modo homologação (10/11/2026): pedido de cliente real enviado para a conversa de teste. */
  homologacao?: boolean;
  /** pedido_pronto (Expedição) ou pedido_em_producao (Liberar para Produção). */
  evento?: "pedido_pronto" | "pedido_em_producao";
  /** "Liberar número" (ADM): quem conferiu no ChatGuru, quando e o que respondeu (nulo: só soltou a conversa presa). */
  liberacao?: { por: string | null; em: string; resposta: "enviada" | "nao_enviada" | null } | null;
  /** Conversa do ChatGuru usada (09/11/2026); nulo nos avisos anteriores. */
  chat_id?: string | null;
  autor_nome: string | null;
  criado_em: string;
  atualizado_em: string;
};

/** Recusa do ChatGuru por número: o número e a conversa usados. */
export type RecusaPorNumero = { numero_enviado: string; chat_id: string };

/** Conversa do cliente no ChatGuru (remetente 3478): nome no Guru e número. */
export type ConversaChatGuru = { chat_id: string; nome: string; numero: string };

/**
 * A regra não decidiu sozinha: o WhatsApp do contato casa com mais de uma
 * conversa ("varias") ou com nenhuma ("nenhuma"). Nada foi enviado.
 */
export type EscolhaConversa = { motivo: "varias" | "nenhuma"; conversas: ConversaChatGuru[] };

/** Escolha feita na tela: uma ou várias conversas, ou todas as do cliente. */
export type SelecaoConversas = { chatIds: string[] } | { todas: true };

/** Resultado de cada conversa num envio para várias. */
export type EnvioPorConversa = ConversaChatGuru & {
  aviso: AvisoPronto | null;
  /** Não reservou (conversa travada ou envio concorrente): nada foi enviado para ela. */
  recusa: string | null;
  motivo_chatguru: string | null;
};

type Resposta = {
  ok: boolean;
  mensagem?: string;
  modo_teste?: boolean;
  /** Modo homologação: o envio foi (ou vai) para a conversa de teste do Edison, não para o cliente. */
  homologacao?: boolean;
  ja_existia?: boolean;
  aviso?: AvisoPronto | null;
  avisos?: Record<string, AvisoPronto | null>;
  /** Último envio do "Testar modelo" de cada pedido. */
  testes?: Record<string, AvisoPronto | null>;
  /** "Testar modelo": valores enviados e quais foram de teste. */
  teste?: CamposDoTeste | null;
  /** Pedido em produção: contato responsável da proposta (para quem vai). */
  destinatario?: { id_contato: number; nome: string; whatsapp: string } | null;
  /** Pedido em produção: por que o envio seria recusado (modo teste, contato, sem conversa). */
  bloqueio?: string | null;
  /** Conversa escolhida pela regra (preparar do pedido em produção). */
  conversa?: ConversaChatGuru | null;
  /** A regra não decidiu: lista para a tela perguntar. Nada foi enviado. */
  escolha?: EscolhaConversa | null;
  /** Envio para várias conversas: o resultado de cada uma. */
  envios?: EnvioPorConversa[];
  /** "Ver conversas do cliente". */
  conversas?: ConversaChatGuru[];
  decisao?: { modo: "automatica"; chat_id: string } | { modo: "escolha"; motivo: "varias" | "nenhuma" } | { modo: "sem_conversa"; mensagem: string };
  contato?: { id_contato: number; nome: string; whatsapp: string } | null;
  envio_recusado_pelo_modo_teste?: boolean;
  modelos?: Record<string, ModeloAviso>;
  modelo?: ModeloAviso | null;
  /** Etapa em que o ChatGuru recusou ou ficou incerto: campos ou diálogo. */
  etapa_chatguru?: "campos" | "dialogo" | null;
  status_chatguru?: string | null;
  /** Motivo da recusa dado pelo ChatGuru (ex.: "Chat não encontrado."). Não é gravado. */
  motivo_chatguru?: string | null;
  /** Só para ADM: HTTP e texto do ChatGuru em cada etapa, sem chave nem contato. Não é gravado. */
  diagnostico_chatguru?: DiagnosticoChatGuru[] | null;
  /** Só quando o ChatGuru recusou pelo número ("Chat não encontrado."). Não é gravado. */
  recusa_numero?: RecusaPorNumero | null;
};

export type DiagnosticoChatGuru = { etapa: string; http: number | null; texto: string };

const FUNCAO = "expedicao-pedido-pronto";

/**
 * Modo homologação (10/11/2026): com o modo teste ligado, pedido de cliente real
 * envia com os dados dele, mas sempre para a conversa de teste "Edison Junior - 14"
 * (cliente #14 no remetente 3478). Fica registrado à parte, fora do "já enviado".
 */
export const TEXTO_HOMOLOGACAO = "Modo homologação: a mensagem vai para a conversa de teste do Edison, não para o cliente.";
export const CONVERSA_TESTE_OCUPADA = "Conversa de teste ocupada, tente em 2 minutos.";

async function chamar(corpo: Record<string, unknown>): Promise<Resposta> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, mensagem: "Supabase não configurado." };
  const { data, error } = await supabase.functions.invoke(FUNCAO, { body: corpo });
  if (!error) return (data ?? { ok: false, mensagem: "Resposta vazia." }) as Resposta;

  // Erro HTTP da função: a mensagem legível vem no corpo da resposta.
  const contexto = (error as { context?: unknown }).context;
  if (contexto instanceof Response) {
    try {
      const corpoErro = (await contexto.json()) as Resposta;
      return { ok: false, mensagem: corpoErro?.mensagem || "Não foi possível falar com o ChatGuru." };
    } catch {
      /* corpo não é JSON */
    }
  }
  return { ok: false, mensagem: "Não foi possível falar com o servidor. Consulte o status antes de tentar de novo." };
}

export function listarAvisosPronto(ids: number[]) {
  return chamar({ acao: "listar", ids });
}

/**
 * Status em que o aviso de pedido pronto pode sair (v23, 10/11/2026): na bancada
 * e logo depois do despacho (SEDEX e PAC vão para EM TRANSITO, a retirada para
 * A RETIRAR). Mesma lista de STATUS_AVISO_PRONTO na lógica da Edge Function, que
 * é quem confere de verdade.
 */
export const STATUS_AVISO_PRONTO = ["EXPEDICAO", "A RETIRAR", "EM TRANSITO"] as const;

export function statusPermiteAvisoPronto(status: string | null | undefined): boolean {
  return (STATUS_AVISO_PRONTO as readonly string[]).includes((status ?? "").trim().toUpperCase());
}

/** Forma de envio que está na janela do despacho, ainda não gravada. */
export type DespachoParaAviso = {
  tipo_frete: string | null;
  modalidade_frete: string | null;
  transportadora_nome: string | null;
  id_transportadora_cliente: number | null;
  rastreio: string | null;
  id_endereco_entrega: string | null;
};

/**
 * Só leitura (v23): o que a caixa "Avisar o cliente pelo WhatsApp" da janela do
 * despacho mostra antes de confirmar: o último aviso, o modelo pela forma de envio
 * da tela, para qual conversa vai (ou a escolha) e, se o envio seria recusado, o
 * motivo. Nada é gravado nem enviado.
 */
export function prepararAvisoPronto(idInt: number, despacho: DespachoParaAviso) {
  return chamar({ acao: "preparar", id_int: idInt, despacho });
}

/** Seleção da tela no formato do servidor (chat_ids ou todas). */
function comSelecao(selecao?: SelecaoConversas): Record<string, unknown> {
  if (!selecao) return {};
  return "todas" in selecao ? { todas: true } : { chat_ids: selecao.chatIds };
}

/** Primeiro aviso. Se já houve um, o servidor devolve o que existe e não envia. */
export function enviarAvisoPronto(idInt: number, selecao?: SelecaoConversas) {
  return chamar({ acao: "enviar", id_int: idInt, ...comSelecao(selecao) });
}

/** Nova reserva e novo envio — só depois da confirmação na tela. */
export function reenviarAvisoPronto(idInt: number, seqAtual: number, selecao?: SelecaoConversas) {
  return chamar({ acao: "reenviar", id_int: idInt, seq_atual: seqAtual, confirmado: true, ...comSelecao(selecao) });
}

/** "Ver conversas do cliente": só leitura, as conversas do 3478 do cliente e a decisão da regra. */
export function verConversasDoCliente(idInt: number) {
  return chamar({ acao: "conversas", id_int: idInt });
}

/**
 * "Liberar número" (só ADM, aviso de diálogo em resultado desconhecido), depois
 * de conferir no ChatGuru. "enviada" -> executado, sem reenviar; "nao_enviada" ->
 * falhou, e o Reenviar volta. "soltar" (v19): aviso já terminado com a conversa
 * presa na trava compartilhada; só solta a conversa, o estado não muda.
 */
export function liberarNumeroAviso(idInt: number, seq: number, resposta: RespostaLiberacao) {
  if (resposta === "soltar") return chamar({ acao: "liberar", modo: "trava", id_int: idInt, seq, confirmado: true });
  return chamar({ acao: "liberar", id_int: idInt, seq, resposta, confirmado: true });
}

export type RespostaLiberacao = "enviada" | "nao_enviada" | "soltar";

/** v19: aviso terminado ("executado" ou "falhou") com a conversa presa na trava compartilhada. */
export function travaCompartilhadaPresa(a: AvisoPronto | null | undefined): boolean {
  return Boolean(a && a.trava_compartilhada_presa === true && (a.estado === "executado" || a.estado === "falhou"));
}

export const TEXTO_TRAVA_PRESA =
  "A conversa deste WhatsApp ficou presa na trava compartilhada com o Imposition. Novos envios para ela ficam parados até o ADM usar Liberar número.";

/** Texto do registro do Liberar número. */
export function textoDaLiberacao(l: NonNullable<AvisoPronto["liberacao"]>, quando: string): string {
  const quem = `Liberado por ${l.por || "—"} em ${quando}`;
  if (l.resposta === "enviada") return `${quem}: conferido no ChatGuru, a mensagem foi enviada.`;
  if (l.resposta === "nao_enviada") return `${quem}: conferido no ChatGuru, a mensagem não foi enviada.`;
  return `${quem}: conversa solta na trava compartilhada.`;
}

/**
 * "Testar modelo" (só modo teste, só pedido do cliente #14): envia o diálogo
 * escolhido, sem olhar a forma de envio. Cada chamada é um envio novo.
 */
export function testarModeloAviso(idInt: number, dialogo: DialogoAviso, selecao?: SelecaoConversas) {
  return chamar({ acao: "testar", id_int: idInt, dialogo, confirmado: true, ...comSelecao(selecao) });
}

/**
 * Aviso "Pedido em Produção" (07/11/2026): mesma função, evento separado.
 * preparar = para quem vai e se seria recusado (só leitura); enviar = só com o
 * pedido já liberado; reenviar exige a tentativa vista e confirmação.
 */
export function prepararAvisoProducao(idInt: number) {
  return chamar({ acao: "producao_preparar", id_int: idInt });
}

export function enviarAvisoProducao(idInt: number, reenvio?: { seqAtual: number }, selecao?: SelecaoConversas) {
  return chamar(
    reenvio
      ? { acao: "producao_enviar", id_int: idInt, reenviar: true, seq_atual: reenvio.seqAtual, confirmado: true, ...comSelecao(selecao) }
      : { acao: "producao_enviar", id_int: idInt, ...comSelecao(selecao) }
  );
}

export function consultarStatusAvisoPronto(idInt: number) {
  return chamar({ acao: "status", id_int: idInt });
}

export const ROTULO_ESTADO_AVISO: Record<EstadoAviso, string> = {
  preparando: "enviando",
  aguardando: "aguardando confirmação do WhatsApp",
  enviado: "entregue ao WhatsApp",
  executado: "diálogo executado no ChatGuru",
  falhou: "falhou",
  desconhecido: "resultado desconhecido"
};
