/**
 * maestro-orcamento-service.server.ts
 *
 * Camada de orquestração isolada do Orçamento Avulso — Fase 3.
 *
 * Responsabilidade única: integrar parser + resolver + cálculo em um único ponto,
 * sem contaminar o Router principal, o Context Manager ou o Financeiro.
 *
 * Fluxo interno:
 *   1. Recebe query e estado atual do orçamento (OrcamentoAvulsoState).
 *   2. Passa a query para `processarOrcamentoAvulso` (parser puro — sem DB).
 *   3. Se a ação for ADD, REPLACE ou UPDATE_QTD:
 *      a. Mapeia os itens extraídos → `ResolverItemReq[]`.
 *      b. Passa para `resolverOrcamento` (consulta read-only em public.produtos).
 *      c. Agrega subtotais e totalGeral.
 *      d. Retorna resultado estruturado completo.
 *   4. Se a ação for CLEAR, NONE ou ERROR, repassa sem chamar o banco.
 *
 * Regras de cálculo:
 *   - subtotal = quantidade * valorUnt + (valorFixo ?? 0)
 *   - valorUnt null → preco_incompleto (cálculo bloqueado)
 *   - ativo=false → inativo (não entra no total)
 *   - totalGeral = null se qualquer item não for 'sucesso'
 *
 * INVARIANTES CRÍTICOS:
 *   - Não faz chamadas de escrita no Supabase.
 *   - Não acessa tabelas de clientes, boletos, pagamentos ou produção.
 *   - Não chama Brain/OpenAI.
 *   - Não verifica MAESTRO_AVULSO_ENABLED (responsabilidade do Router).
 *   - O supabase client é injetado (não importado direto), facilitando testes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  processarOrcamentoAvulso,
  type OrcamentoAvulsoState,
  type OrcamentoAvulsoItem,
  type OrcamentoActionType,
} from './maestro-orcamento-engine';
import {
  resolverOrcamento,
  type ResolverItemReq,
  type ResolverItemResult,
  type ResolverResult,
} from './maestro-orcamento-resolver.server';

// ─── Tipos públicos ────────────────────────────────────────────────────────────

/** Entrada do serviço de orçamento */
export interface OrcamentoServiceInput {
  query: string;
  state: OrcamentoAvulsoState;
  supabase: SupabaseClient;
}

/** Resultado completo do serviço de orçamento */
export interface OrcamentoServiceResult {
  /** Ação determinada pelo motor de parsing */
  action: OrcamentoActionType;
  /** Itens finais da lista de orçamento (estado pós-ação) */
  items: OrcamentoAvulsoItem[];
  /** Estado atualizado (para persistir na sessão) */
  nextState: OrcamentoAvulsoState;
  /** Resolução individual de cada item no catálogo */
  resolucao: ResolverItemResult[];
  /** Total geral calculado (null se houver qualquer erro) */
  totalGeral: number | null;
  /** Erros de resolução (produtos não encontrados, ambíguos, etc.) */
  errors: string[];
  /** Indica se há pendências de ambiguidade que requerem resposta do usuário */
  temPendencia: boolean;
  /** Mensagem de resposta sugerida para o usuário */
  response: string;
}

// ─── Serviço principal ─────────────────────────────────────────────────────────

/**
 * Processa uma query de orçamento avulso de ponta a ponta:
 * parsing textual → resolução de catálogo → cálculo de totais.
 *
 * @param input.query     - texto digitado pelo usuário
 * @param input.state     - estado atual do orçamento na sessão
 * @param input.supabase  - cliente Supabase injetado (read-only)
 */
export async function processarOrcamentoService(
  input: OrcamentoServiceInput
): Promise<OrcamentoServiceResult> {
  const { query, state, supabase } = input;

  // ── Passo 1: Motor de parsing (puro, sem DB) ─────────────────────────────
  const engineResult = processarOrcamentoAvulso(query, state);

  // ── Passo 2: Ações que não precisam do resolver ───────────────────────────
  if (
    engineResult.action === 'CLEAR' ||
    engineResult.action === 'NONE' ||
    engineResult.action === 'ERROR' ||
    engineResult.action === 'UPDATE_QTD'
  ) {
    return {
      action: engineResult.action,
      items: engineResult.items,
      nextState: engineResult.nextState,
      resolucao: [],
      totalGeral: null,
      errors: engineResult.errors,
      temPendencia: false,
      response: engineResult.response,
    };
  }

  // ── Passo 3: Mapear itens para o resolver ────────────────────────────────
  const itemsParaResolver: ResolverItemReq[] = engineResult.items.map(item => ({
    quantidade: item.quantidade,
    termo: item.produtoId ? String(item.produtoId) : item.termo,
  }));

  // ── Passo 4: Consultar catálogo read-only ────────────────────────────────
  let resolucaoResult: ResolverResult;
  try {
    resolucaoResult = await resolverOrcamento(supabase, itemsParaResolver);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[OrcamentoService] Erro ao resolver catálogo:', msg);
    return {
      action: 'ERROR',
      items: state.itens,
      nextState: state,
      resolucao: [],
      totalGeral: null,
      errors: [`Erro ao consultar catálogo de produtos: ${msg}`],
      temPendencia: false,
      response: 'Não consegui consultar o catálogo de produtos agora. Tente novamente em instantes.',
    };
  }

  // ── Passo 5: Classificar erros e construir resposta ───────────────────────
  const errors: string[] = [];
  let temPendencia = false;

  for (const item of resolucaoResult.itens) {
    switch (item.status) {
      case 'nao_encontrado':
        errors.push(`Produto "${item.termo}" não encontrado no catálogo.`);
        break;
      case 'ambiguo':
        errors.push(
          `"${item.termo}" retornou ${item.candidatos?.length ?? 0} produtos. ` +
          `Informe o ID do produto desejado: ${item.candidatos?.map(c => `#${c.id_produto} ${c.descricao}`).join(', ')}.`
        );
        temPendencia = true;
        break;
      case 'inativo':
        errors.push(`Produto "${item.produto?.descricao ?? item.termo}" está inativo e não pode ser orçado.`);
        break;
      case 'preco_incompleto':
        errors.push(`Produto "${item.produto?.descricao ?? item.termo}" está sem preço cadastrado (valorUnt ausente).`);
        break;
    }
  }

  // ── Passo 6: Sincronizar nextState com os produtos resolvidos ─────────────
  // Atualiza itens com precoUnitario quando disponível
  const itemsEnriquecidos: OrcamentoAvulsoItem[] = engineResult.items.map((item, idx) => {
    const res = resolucaoResult.itens[idx];
    if (!res || res.status !== 'sucesso') return item;
    return {
      ...item,
      produtoId: res.produto?.id_produto,
      precoUnitario: res.produto?.valorUnt ?? undefined,
      pesoUnitario: res.produto?.peso ?? undefined,
    };
  });

  const ambiguoItem = resolucaoResult.itens.find(i => i.status === 'ambiguo');

  const nextStateAtualizado: OrcamentoAvulsoState = {
    ...engineResult.nextState,
    itens: itemsEnriquecidos,
    // Marcar pendência de ambiguidade se houver
    pendingAmbiguity: temPendencia,
    pendingTerm: ambiguoItem?.termo,
    pendingQuantidade: ambiguoItem?.quantidade,
    pendingOptions: ambiguoItem?.candidatos?.map((c, i) => ({
      index: i + 1,
      id: c.id_produto,
      name: c.descricao
    }))
  };

  // ── Passo 7: Construir resposta textual ───────────────────────────────────
  const response = construirResposta(resolucaoResult, errors);

  return {
    action: engineResult.action,
    items: itemsEnriquecidos,
    nextState: nextStateAtualizado,
    resolucao: resolucaoResult.itens,
    totalGeral: resolucaoResult.totalGeral,
    errors,
    temPendencia,
    response,
  };
}

// ─── Construtor de resposta ────────────────────────────────────────────────────

function construirResposta(resolucao: ResolverResult, errors: string[]): string {
  const linhas: string[] = [];

  for (const item of resolucao.itens) {
    if (item.status === 'sucesso' && item.produto) {
      const subtotalFmt = formatarBRL(item.subtotal!);
      linhas.push(
        `• ${item.quantidade.toLocaleString('pt-BR')}× ${item.produto.descricao}` +
        ` → ${subtotalFmt}`
      );
    }
  }

  if (resolucao.totalGeral !== null) {
    linhas.push('');
    linhas.push(`**Total: ${formatarBRL(resolucao.totalGeral)}**`);
  }

  if (errors.length > 0) {
    linhas.push('');
    linhas.push('⚠️ Pendências:');
    for (const e of errors) {
      linhas.push(`  - ${e}`);
    }
    if (resolucao.totalGeral === null) {
      linhas.push('');
      linhas.push('_Total geral não calculado até resolver as pendências acima._');
    }
  }

  return linhas.join('\n');
}

function formatarBRL(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
