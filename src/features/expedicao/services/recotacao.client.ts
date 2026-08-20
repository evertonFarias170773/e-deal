import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Cliente da recotação de frete do despacho (Parte C, Etapa 1).
 *
 * A rota é READ-ONLY: cota e devolve. Nada é gravado — nem em `cotacao_frete`,
 * nem em `propostas.valor_frete`/`valor_total`, nem na Conta Corrente. Gravar o
 * valor e lançar a diferença são as etapas seguintes.
 *
 * Mesmo desenho de `correios.client.ts`: o token sai da sessão do browser e vai
 * no header, porque a rota autentica por Bearer OU cookie.
 */

async function tokenSessao(): Promise<string | null> {
  const client = getSupabaseClient();
  const sessionResult = client ? await client.auth.getSession() : null;
  return sessionResult?.data?.session?.access_token ?? null;
}

/** Uma opção cotada agora, já comparada com o frete que a proposta cobra hoje. */
export interface OpcaoRecotacao {
  id: string;
  transportadora: string;
  servico: string;
  valor: number;
  prazo: string;
  /** `valor − freteAtual`. Negativo = barateia (crédito futuro ao cliente). */
  diferenca: number;
  /** `valor <= 150`. Nesta etapa é rótulo informativo: nada é gravado. */
  dentroDaAlcada: boolean;
}

export interface RecotacaoResult {
  success: boolean;
  errorMessage?: string;
  freteAtual?: number;
  subtotalItens?: number;
  pesoGramas?: number;
  pesoOrigem?: string | null;
  endereco?: { rotulo: string; cep: string; cidade: string; uf: string } | null;
  opcoes?: OpcaoRecotacao[];
  avisos?: string[];
  /** Quem autorizou esta recotacao, e quando. Vem da liberacao ativa. */
  liberadoPorNome?: string | null;
  liberadoEm?: string | null;
}

export async function recotarFrete(
  idInt: number,
  idEnderecoEntrega?: string | null
): Promise<RecotacaoResult> {
  const token = await tokenSessao();
  if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };
  try {
    const res = await fetch("/api/expedicao/recotacao/cotar", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id_int: idInt, id_endereco_entrega: idEnderecoEntrega ?? null })
    });
    const data = (await res.json().catch(() => null)) as (RecotacaoResult & { message?: string }) | null;
    if (res.ok && data?.success) return data;
    return { success: false, errorMessage: data?.message || `Falha ao recotar (HTTP ${res.status}).` };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro de rede." };
  }
}

/** Resultado de aplicar UMA opcao (Parte C, Etapa 2). */
export interface AplicacaoRecotacao {
  success: boolean;
  errorMessage?: string;
  /** true quando a chave ja tinha sido aplicada: nada foi gravado de novo. */
  idempotente?: boolean;
  freteAnterior?: number;
  freteNovo?: number;
  diferenca?: number;
  totalAnterior?: number;
  totalNovo?: number;
  transportadora?: string;
  servico?: string;
  prazo?: string;
  /** Peso e CEP que a recotacao usou — passam a ser a "cotacao vigente". */
  pesoGramas?: number | null;
  cep?: string | null;
}

/**
 * Aplica uma opcao da recotacao: grava o frete novo na proposta, move o total
 * pelo delta e registra o ledger. NAO lanca nada na Conta Corrente.
 *
 * `chave` e a idempotencia e nasce por OPCAO, quando o resultado da cotacao
 * chega — nunca no clique. Quem decide e o banco (unique na tabela do ledger):
 * repetir a mesma chave devolve o registro anterior sem gravar de novo.
 */
export async function aplicarRecotacao(input: {
  idInt: number;
  chave: string;
  opcaoId: string;
  valorVisto: number;
  idEnderecoEntrega?: string | null;
}): Promise<AplicacaoRecotacao> {
  const token = await tokenSessao();
  if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };
  try {
    const res = await fetch("/api/expedicao/recotacao/aplicar", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        id_int: input.idInt,
        chave: input.chave,
        opcao_id: input.opcaoId,
        valor_visto: input.valorVisto,
        id_endereco_entrega: input.idEnderecoEntrega ?? null
      })
    });
    const data = (await res.json().catch(() => null)) as (AplicacaoRecotacao & { message?: string }) | null;
    if (res.ok && data?.success) return data;
    return { success: false, errorMessage: data?.message || `Falha ao aplicar (HTTP ${res.status}).` };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro de rede." };
  }
}

/** Resultado de liberar ou cancelar a liberacao de recotacao (admin). */
export interface LiberacaoResult {
  success: boolean;
  errorMessage?: string;
  /** true quando o pedido ja estava liberado: nenhuma linha nova foi criada. */
  idempotente?: boolean;
  idLiberacao?: number;
  liberadoPorNome?: string | null;
  liberadoEm?: string | null;
}

async function chamarLiberacao(metodo: "POST" | "DELETE", idInt: number, motivo?: string | null) {
  const token = await tokenSessao();
  if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };
  try {
    const res = await fetch("/api/expedicao/recotacao/liberar", {
      method: metodo,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id_int: idInt, motivo: motivo ?? null })
    });
    const data = (await res.json().catch(() => null)) as (LiberacaoResult & { message?: string }) | null;
    if (res.ok && data?.success) return data;
    return { success: false, errorMessage: data?.message || `Falha na operação (HTTP ${res.status}).` };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro de rede." };
  }
}

/**
 * Libera a recotacao de UM pedido. So admin (expedicao.admin).
 *
 * Idempotente: liberar pedido que ja tem liberacao ativa devolve a existente,
 * sem criar segunda linha — quem garante e o indice unico parcial do banco.
 */
export function liberarRecotacao(idInt: number, motivo?: string | null): Promise<LiberacaoResult> {
  return chamarLiberacao("POST", idInt, motivo);
}

/**
 * Cancela a liberacao ATIVA de um pedido. So alcanca liberacao nao consumida:
 * autorizacao ja usada nao se desfaz por aqui.
 */
export function revogarRecotacao(idInt: number, motivo?: string | null): Promise<LiberacaoResult> {
  return chamarLiberacao("DELETE", idInt, motivo);
}
