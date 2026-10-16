/**
 * Conferência automática — Fase 2 (16/10/2026).
 *
 * Pedido 100% Vibe com pagamento identificado (PAID) é conferido sozinho:
 * a automação elimina só o clique "conferido" do financeiro. Autoria "Sistema".
 *
 * QUEM ACIONA
 *   Uma varredura periódica no servidor (`POST /api/cobrancas/conferencia-automatica`),
 *   chamada por um fluxo pequeno do n8n com segredo próprio. Nenhum fluxo de
 *   baixa muda e não há gatilho no banco.
 *
 * ELEGÍVEL (tudo junto; qualquer outra coisa fica para o financeiro, como hoje)
 *   - pagamentos_v2 PAID e confirmado = false;
 *   - forma PIX, BOLETO, CARD_PARCELADO (C6 e Asaas) ou E-CREDITO;
 *   - proposta com is_sistema_antigo = false (true e NULL são manuais);
 *   - sem abatimento de Conta Corrente (reserva ou marcador antigo): as funções
 *     do banco que lançam o abatimento exigem um usuário com conferencia.confirm;
 *   - não é cancelada que consta paga (lib/cancelada-que-consta-paga);
 *   - passa na trava de quitação (calcularSituacaoQuitacaoProposta).
 *
 * CONFERIR
 *   O mesmo efeito do "Confirmar Conferência": o payload e os passos seguintes
 *   (abatimento, engine de status, prateleira) vêm do núcleo comum
 *   (conferencia-nucleo.server), e o aviso que a tela grava no chat é gravado
 *   aqui. O UPDATE leva status = PAID e confirmado = false na condição: repetir
 *   não grava de novo.
 *
 * MODOS (variável CONFERENCIA_AUTOMATICA_MODO; qualquer outro valor = desligado)
 *   desligado — não lê nem grava nada;
 *   sombra    — varre e só registra no log o que conferiria e por quê;
 *   ligado    — confere.
 *
 * Falha numa cobrança não impede as outras e a deixa para o financeiro.
 * O log não leva dado pessoal: só ids, códigos, forma, marca e motivos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularSituacaoQuitacaoProposta } from "@/features/cobrancas/services/conferencia-financeira.service";
import { confirmacaoDeveSerRecusada } from "@/features/cobrancas/lib/cancelada-que-consta-paga";
import {
  MENSAGEM_CHAT_COBRANCA_CONFERIDA,
  executarPosConfirmacao,
  montarPayloadConfirmacao
} from "@/features/cobrancas/services/conferencia-nucleo.server";

export const VARIAVEL_MODO_CONFERENCIA_AUTOMATICA = "CONFERENCIA_AUTOMATICA_MODO";
export const VARIAVEL_SEGREDO_CONFERENCIA_AUTOMATICA = "CONFERENCIA_AUTOMATICA_SEGREDO";
export const CABECALHO_SEGREDO_CONFERENCIA_AUTOMATICA = "x-vibe-conferencia-segredo";
export const AUTOR_CONFERENCIA_AUTOMATICA = "Sistema";
export const FORMAS_CONFERENCIA_AUTOMATICA = ["PIX", "BOLETO", "CARD_PARCELADO", "E-CREDITO"] as const;
/**
 * Teto por varredura, das pagas mais novas para as mais antigas. A fila de
 * PAID não conferidas é pequena (zero em 16/10/2026, poucas dezenas nos dias
 * cheios), mas inclui as manuais (marca true ou NULL), que não saem dela até o
 * financeiro conferir; por isso o teto é folgado e o resumo avisa quando é
 * atingido. Não dá para filtrar pela marca na mesma consulta: não há chave
 * estrangeira entre pagamentos_v2 e propostas.
 */
export const LIMITE_POR_VARREDURA = 1000;

export type ModoConferenciaAutomatica = "desligado" | "sombra" | "ligado";

export function lerModoConferenciaAutomatica(valor: string | undefined | null): ModoConferenciaAutomatica {
  const v = String(valor ?? "").trim().toLowerCase();
  return v === "sombra" || v === "ligado" ? v : "desligado";
}

export type CobrancaCandidata = {
  id: string;
  id_pagamento?: string | null;
  id_int?: number | null;
  id_cliente?: number | null;
  tipo_cobranca?: string | null;
  status?: string | null;
  confirmado?: boolean | null;
  motivo_cancela?: string | null;
  reserva_estado?: string | null;
  id_pendencia?: number | string | null;
  chave_reserva?: string | null;
  obs_v2?: string | null;
  paid_at?: string | null;
};

export type MotivoFora =
  | "FORMA_FORA"
  | "NAO_PAGA"
  | "JA_CONFIRMADA"
  | "SEM_PEDIDO"
  | "MARCA_NULL"
  | "MARCA_SISTEMA_ANTIGO"
  | "CANCELADA_E_PAGA"
  | "ABATIMENTO"
  | "QUITACAO"
  | "ERRO_NA_QUITACAO";

/** Cobrança com abatimento de Conta Corrente: reserva (nova) ou marcador em obs_v2 (antigo). */
export function temAbatimentoDeContaCorrente(c: CobrancaCandidata): boolean {
  if (c.reserva_estado || c.id_pendencia != null || c.chave_reserva) return true;
  return /\[ABATIMENTO_DEBITO:/.test(String(c.obs_v2 ?? ""));
}

/**
 * As condições que não dependem da trava de quitação, na ordem em que são
 * explicadas no log. `null` = segue para a quitação.
 */
export function motivoParaFicarManual(c: CobrancaCandidata, marca: boolean | null | undefined): MotivoFora | null {
  if (!(FORMAS_CONFERENCIA_AUTOMATICA as readonly string[]).includes(String(c.tipo_cobranca ?? ""))) return "FORMA_FORA";
  if (c.status !== "PAID") return "NAO_PAGA";
  if (c.confirmado === true) return "JA_CONFIRMADA";
  if (!c.id_int) return "SEM_PEDIDO";
  if (marca === true) return "MARCA_SISTEMA_ANTIGO";
  if (marca !== false) return "MARCA_NULL";
  if (confirmacaoDeveSerRecusada(c)) return "CANCELADA_E_PAGA";
  if (temAbatimentoDeContaCorrente(c)) return "ABATIMENTO";
  return null;
}

export type ResultadoItem = {
  id: string;
  id_pagamento: string | null;
  id_int: number | null;
  forma: string | null;
  marca: boolean | null;
  decisao: "CONFERIRIA" | "CONFERIDA" | "MANUAL" | "JA_CONFERIDA_POR_OUTRO" | "FALHOU";
  motivo?: MotivoFora;
  quitacao?: { podeConfirmar: boolean; valorTotalProposta: number; novoValorQuitado: number };
  erro?: string;
};

export type ResumoVarredura = {
  modo: ModoConferenciaAutomatica;
  examinadas: number;
  conferiria: number;
  conferidas: number;
  manuais: Partial<Record<MotivoFora, number>>;
  falhas: number;
  /** A leitura veio cheia: pode haver pagas mais antigas fora desta varredura. */
  limiteAtingido: boolean;
  itens: ResultadoItem[];
};

type Dependencias = {
  calcularQuitacao: typeof calcularSituacaoQuitacaoProposta;
  posConfirmacao: typeof executarPosConfirmacao;
  agoraIso: () => string;
  log: (linha: string) => void;
};

const DEPENDENCIAS_PADRAO: Dependencias = {
  calcularQuitacao: calcularSituacaoQuitacaoProposta,
  posConfirmacao: executarPosConfirmacao,
  agoraIso: () => new Date().toISOString(),
  log: (linha) => console.log(linha)
};

const COLUNAS_CANDIDATA =
  "id, id_pagamento, id_int, id_cliente, tipo_cobranca, status, confirmado, motivo_cancela, reserva_estado, id_pendencia, chave_reserva, obs_v2, paid_at";

/**
 * Uma varredura. No modo desligado volta sem tocar no banco. Nunca lança por
 * causa de uma cobrança; só lança se a leitura inicial falhar.
 */
export async function varrerConferenciaAutomatica(
  supabase: SupabaseClient,
  modo: ModoConferenciaAutomatica,
  dependencias: Partial<Dependencias> = {}
): Promise<ResumoVarredura> {
  const deps = { ...DEPENDENCIAS_PADRAO, ...dependencias };
  const resumo: ResumoVarredura = { modo, examinadas: 0, conferiria: 0, conferidas: 0, manuais: {}, falhas: 0, limiteAtingido: false, itens: [] };
  if (modo === "desligado") return resumo;

  const { data: candidatasData, error: erroCandidatas } = await supabase
    .from("pagamentos_v2")
    .select(COLUNAS_CANDIDATA)
    .eq("status", "PAID")
    .eq("confirmado", false)
    .in("tipo_cobranca", [...FORMAS_CONFERENCIA_AUTOMATICA])
    .order("paid_at", { ascending: false })
    .limit(LIMITE_POR_VARREDURA);
  if (erroCandidatas) throw new Error(`Leitura das cobranças pagas falhou: ${erroCandidatas.message}`);
  const candidatas = (Array.isArray(candidatasData) ? candidatasData : []) as CobrancaCandidata[];
  if (candidatas.length >= LIMITE_POR_VARREDURA) {
    resumo.limiteAtingido = true;
    deps.log(JSON.stringify({ evento: "conferencia_automatica_limite", modo, limite: LIMITE_POR_VARREDURA }));
  }

  const idsPedido = [...new Set(candidatas.map((c) => c.id_int).filter((v): v is number => typeof v === "number"))];
  const marcas = new Map<number, boolean | null>();
  if (idsPedido.length > 0) {
    const { data: propostasData, error: erroPropostas } = await supabase
      .from("propostas")
      .select("id_int, is_sistema_antigo")
      .in("id_int", idsPedido);
    if (erroPropostas) throw new Error(`Leitura das propostas falhou: ${erroPropostas.message}`);
    for (const linha of (Array.isArray(propostasData) ? propostasData : []) as Array<{ id_int: number; is_sistema_antigo: boolean | null }>) {
      marcas.set(Number(linha.id_int), typeof linha.is_sistema_antigo === "boolean" ? linha.is_sistema_antigo : null);
    }
  }

  for (const c of candidatas) {
    resumo.examinadas++;
    const marca = c.id_int ? (marcas.has(c.id_int) ? marcas.get(c.id_int)! : null) : null;
    const item: ResultadoItem = {
      id: c.id,
      id_pagamento: c.id_pagamento ?? null,
      id_int: c.id_int ?? null,
      forma: c.tipo_cobranca ?? null,
      marca,
      decisao: "MANUAL"
    };
    try {
      let motivo = motivoParaFicarManual(c, marca);
      if (!motivo) {
        try {
          const situacao = await deps.calcularQuitacao(supabase, c.id_int as number, c.id);
          item.quitacao = {
            podeConfirmar: situacao.podeConfirmar,
            valorTotalProposta: situacao.valorTotalProposta,
            novoValorQuitado: situacao.novoValorQuitado
          };
          if (!situacao.podeConfirmar) motivo = "QUITACAO";
        } catch {
          motivo = "ERRO_NA_QUITACAO";
        }
      }

      if (motivo) {
        item.motivo = motivo;
        resumo.manuais[motivo] = (resumo.manuais[motivo] ?? 0) + 1;
      } else if (modo === "sombra") {
        item.decisao = "CONFERIRIA";
        resumo.conferiria++;
      } else {
        resumo.conferiria++;
        await conferirUma(supabase, c, item, deps);
        if (item.decisao === "CONFERIDA") resumo.conferidas++;
      }
    } catch (erro) {
      item.decisao = "FALHOU";
      item.erro = erro instanceof Error ? erro.message : String(erro);
      resumo.falhas++;
    }
    resumo.itens.push(item);
    deps.log(JSON.stringify({ evento: "conferencia_automatica", modo, ...item }));
  }

  return resumo;
}

async function conferirUma(
  supabase: SupabaseClient,
  c: CobrancaCandidata,
  item: ResultadoItem,
  deps: Dependencias
): Promise<void> {
  const payload = montarPayloadConfirmacao(c, AUTOR_CONFERENCIA_AUTOMATICA, deps.agoraIso());

  // Só grava se a linha AINDA é a lida: paga e não confirmada. É o que faz uma
  // segunda varredura (ou o clique do financeiro no mesmo instante) não gerar
  // segunda confirmação. Filtros `eq` simples e retorno com as colunas deles.
  const { data: gravadas, error } = await supabase
    .from("pagamentos_v2")
    .update(payload)
    .eq("id", c.id)
    .eq("status", "PAID")
    .eq("confirmado", false)
    .select("id, status, confirmado");
  if (error) throw new Error(error.message);
  if (!Array.isArray(gravadas) || gravadas.length === 0) {
    item.decisao = "JA_CONFERIDA_POR_OUTRO";
    return;
  }
  item.decisao = "CONFERIDA";

  // O aviso que a tela grava ao confirmar (ConfirmarLiberacaoModal). Falhar
  // aqui não desfaz a confirmação, como na tela.
  const { error: erroChat } = await supabase.from("propostas_chat").insert([
    {
      id_int: c.id_int,
      id_cliente: c.id_cliente ?? null,
      mensagem: MENSAGEM_CHAT_COBRANCA_CONFERIDA,
      tipo: "SISTEMA",
      autor_nome: AUTOR_CONFERENCIA_AUTOMATICA,
      autor_email: null,
      setor: "Financeiro",
      visivel_externo: false
    }
  ]);
  if (erroChat) console.warn(`[conferencia-automatica] chat nao gravado (cobranca ${c.id_pagamento ?? c.id}):`, erroChat.message);

  await deps.posConfirmacao(supabase, c, {
    idCobranca: c.id,
    confirmadoPor: AUTOR_CONFERENCIA_AUTOMATICA,
    autorReconciliacao: { uid: "", nome: AUTOR_CONFERENCIA_AUTOMATICA, email: "" },
    usuarioPrateleira: { uid: "", email: "" }
  });
}
