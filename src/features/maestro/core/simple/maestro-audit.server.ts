/**
 * maestro-audit.server.ts
 *
 * Auditoria de ações do Maestro (autoria + resultado).
 *
 * Camadas:
 *   1. Log estruturado no servidor — SEMPRE ativo (rastreabilidade mínima).
 *   2. Gravação em public.maestro_acoes — somente quando
 *      MAESTRO_AUDIT_DB_ENABLED=true E a migration
 *      supabase/migrations/20260722_maestro_auditoria.sql tiver sido aplicada
 *      (a migration é versionada e NÃO é aplicada automaticamente).
 *
 * Regras:
 *   - Usa o client autenticado do usuário (RLS: INSERT com user_id = auth.uid()).
 *   - Nunca grava campos sensíveis (linha digitável, pix, tokens, payloads externos).
 *   - Falha de auditoria não derruba o fluxo principal — é logada como erro.
 *
 * ⚠️ Roda apenas no servidor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type MaestroAcaoResultado = 'sucesso' | 'rejeitado' | 'erro';

export interface MaestroAuditEntry {
  /** UUID do usuário autenticado (auth.uid()) */
  userId: string;
  /** Nome curto da ação (ex.: 'salvar_cotacao_como_proposta') */
  acao: string;
  resultado: MaestroAcaoResultado;
  /** id_cliente envolvido, quando houver */
  idCliente?: number;
  /** id_int da proposta criada/afetada, quando houver */
  idInt?: number;
  /** Detalhe curto legível (motivo de rejeição, mensagem de erro) */
  detalhe?: string;
  /** Resumo estruturado NÃO sensível (itens, totais, frete) */
  payload?: Record<string, unknown>;
}

/**
 * Registra uma ação do Maestro.
 * Nunca lança — auditoria não pode quebrar o fluxo do usuário.
 */
export async function registrarAcaoMaestro(
  supabase: SupabaseClient,
  entry: MaestroAuditEntry
): Promise<void> {
  // ── 1. Log estruturado sempre ─────────────────────────────────────────────
  try {
    console.info('[MaestroAudit]', JSON.stringify({
      ts: new Date().toISOString(),
      user_id: entry.userId,
      acao: entry.acao,
      resultado: entry.resultado,
      id_cliente: entry.idCliente ?? null,
      id_int: entry.idInt ?? null,
      detalhe: entry.detalhe ?? null,
    }));
  } catch {
    // nunca propaga
  }

  // ── 2. Gravação em banco (flag-gated; exige migration aplicada) ───────────
  if (process.env.MAESTRO_AUDIT_DB_ENABLED !== 'true') return;

  try {
    const { error } = await supabase.from('maestro_acoes').insert({
      user_id: entry.userId,
      acao: entry.acao,
      resultado: entry.resultado,
      id_cliente: entry.idCliente ?? null,
      id_int: entry.idInt ?? null,
      detalhe: entry.detalhe ?? null,
      payload: entry.payload ?? null,
    });
    if (error) {
      console.error('[MaestroAudit] Falha ao gravar em maestro_acoes:', error.message);
    }
  } catch (err) {
    console.error('[MaestroAudit] Erro inesperado ao gravar auditoria:', err);
  }
}
