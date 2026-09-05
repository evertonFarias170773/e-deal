/**
 * Cliente da correção de frete pós-liberação — os dois modos da rota
 * `/api/expedicao/corrigir-frete`.
 *
 * `simular` é a ÚNICA leitura antes de gravar: ela responde se dá para corrigir
 * e quanto muda, sem tocar em nada. `confirmar` grava. A tela nunca calcula o
 * efeito por conta própria — o número que ela exibe é o que o servidor projetou,
 * com a mesma função que o salvamento usa.
 *
 * Nenhuma barreira é decidida aqui. O menu esconde a ação pelo que a Expedição
 * já tem em memória, mas quem barra de verdade é o servidor, a cada chamada, com
 * o token do usuário — e as mensagens exibidas na tela são as que ele devolve.
 */

import { tokenDaSessao } from "@/lib/supabase/bearer";
import type { ModalidadeFrete } from "../types";

/** O efeito projetado da correção. Espelha o `dados` do modo simular. */
export interface SimulacaoFrete {
  idInt: number;
  idCliente: number | null;
  cliente: string;
  statusInterno: string;
  modalidadeAtual: ModalidadeFrete | null;
  modalidadeNova: ModalidadeFrete;
  transportadoraAtualId: number | null;
  transportadoraNovaId: number | null;
  valorTotalAtual: number;
  valorFreteAtual: number;
  valorFreteProjetado: number;
  /** `cotacao_frete.servico` escolhido — a tela deriva a categoria com ele. */
  servicoCotado: string;
  totalProjetado: number;
  valorPagoConfirmado: number;
  /** > 0 o cliente deve; < 0 há crédito a devolver. */
  diferenca: number;
  /** Efeito isolado da correção sobre o total. */
  deltaTotal: number;
  exigeAcaoFinanceira: boolean;
}

export interface RespostaSimulacao {
  success: boolean;
  /** Preenchido quando `success` é false — o texto vem do servidor, inteiro. */
  errorMessage?: string;
  /** `DESPACHO_CONFIRMADO`, `NF_AUTORIZADA`, … para a tela poder reagir. */
  motivo?: string;
  avisos?: string[];
  dados?: SimulacaoFrete;
}

export interface RespostaConfirmacao {
  success: boolean;
  errorMessage?: string;
  motivo?: string;
  idInt?: number;
  modalidadeNova?: ModalidadeFrete;
  freteEscolhido?: string;
  valorTotalAnterior?: number;
  valorTotalNovo?: number;
  valorPagoConfirmado?: number;
  diferenca?: number;
  /** Pendência de Conta Corrente aberta pela correção, quando houve crédito. */
  pendenciaAtiva?: { id: number; descricao: string } | null;
  avisos?: string[];
}

/**
 * A única ação que o `confirmar` aceita, e só no caso credor: abrir a pendência
 * a favor do cliente. O destino do crédito é escolhido depois, no
 * `DiferencaFinanceiraModal`, que é o mesmo de Orçamentos e trabalha sobre a
 * pendência já criada.
 */
export const ACAO_ABRIR_PENDENCIA_CREDITO = "ABRIR_PENDENCIA_CREDITO";

async function chamar(
  corpo: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  const token = await tokenDaSessao();
  if (!token) return { ok: false, status: 401, data: { message: "Sessão expirada. Faça login novamente." } };
  const res = await fetch("/api/expedicao/corrigir-frete", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(corpo)
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: res.ok, status: res.status, data };
}

export async function simularCorrecaoFrete(params: {
  idInt: number;
  modalidade: ModalidadeFrete;
  transportadoraId: number | null;
}): Promise<RespostaSimulacao> {
  try {
    const { ok, status, data } = await chamar({ ...params, modo: "simular" });
    if (ok && data?.success) {
      const { success: _s, avisos, ...dados } = data as Record<string, unknown> & { success: boolean };
      void _s;
      return { success: true, avisos: (avisos as string[]) ?? [], dados: dados as unknown as SimulacaoFrete };
    }
    return {
      success: false,
      motivo: (data?.motivo as string) ?? undefined,
      errorMessage: (data?.message as string) || `Falha ao simular a correção (HTTP ${status}).`
    };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro de rede." };
  }
}

export async function confirmarCorrecaoFrete(params: {
  idInt: number;
  modalidade: ModalidadeFrete;
  transportadoraId: number | null;
  /** `ACAO_ABRIR_PENDENCIA_CREDITO` quando a diferença é credora. */
  acaoFinanceira?: string | null;
  /** RODOVIARIO ou AEREO, quando a derivação não resolve sozinha. */
  categoriaFreteDeclarada?: string | null;
}): Promise<RespostaConfirmacao> {
  try {
    const { ok, status, data } = await chamar({ ...params, modo: "confirmar" });
    if (ok && data?.success) return data as unknown as RespostaConfirmacao;
    return {
      success: false,
      motivo: (data?.motivo as string) ?? undefined,
      errorMessage: (data?.message as string) || `Falha ao gravar a correção (HTTP ${status}).`
    };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro de rede." };
  }
}
