-- Migration 1b/2 — Conta Corrente (Pendências Financeiras): CUTOVER
-- Data: 2026-07-21
-- Status: PREPARADA — NÃO APLICADA. Não rodar `supabase db push`, SQL Editor, nem aplicar em produção.
-- Pré-requisito: 20260721_conta_corrente_fase1a_aditiva.sql já aplicada.
--
-- ORDEM DE ROLLOUT OBRIGATÓRIA (não pular etapas, não inverter):
--   1) Aplicar a migration 1a (aditiva) em ambiente de teste/Preview.
--   2) Publicar em Preview o código desta branch, que já grava exclusivamente
--      via RPC (cc_abrir_pendencia, cc_usar_pendencia, cc_encerrar_pendencia,
--      mc_ajuste_avulso_criar, mc_ajuste_avulso_estornar,
--      mc_confirmar_abatimento_legado) — nenhum INSERT/UPDATE/DELETE direto
--      do cliente em movimento_credito permanece no código desta branch.
--   3) Executar em Preview a matriz de testes funcionais (crédito/débito,
--      uso total/parcial, concorrência, reserva/confirmação/liberação,
--      cancelamento/estorno, ABATER_DEBITO, ajuste avulso e seu estorno,
--      fallback de abatimento legado) — ver docs/business/CONTA-CORRENTE-FASE-1-PREPARACAO.md.
--   4) Só aplicar ESTA migration (1b) depois de confirmar, por busca no
--      repositório (`grep` por `.from("movimento_credito")` seguido de
--      `.insert(`/`.update(`/`.delete(`), que nenhum fluxo publicado em
--      Preview ainda escreve diretamente na tabela. Se algum fluxo legado
--      não migrado for encontrado, ele deve primeiro ser migrado para uma
--      RPC SECURITY DEFINER (mesmo padrão da Seção E de 20260721_conta_corrente_fase1a_aditiva.sql)
--      antes de aplicar este cutover — caso contrário esse fluxo quebra.
--
-- Esta migration torna `movimento_credito` append-only de fato (bloqueia
-- UPDATE/DELETE) e revoga TODA escrita direta (INSERT/UPDATE/DELETE) de
-- `anon` e `authenticated`. A partir daqui, a ÚNICA forma de gravar na razão
-- é através das RPCs SECURITY DEFINER da Fase 1a (que não dependem destes
-- grants — rodam como owner da função).
--
-- Pré-requisitos DE CÓDIGO para este REVOKE de INSERT ser seguro (todos já
-- feitos neste branch — ver relatório da Fase 1 / fechamento de segurança):
--   - `ajuste-credito` migrado de INSERT direto (registrarMovimento) para a
--     RPC mc_ajuste_avulso_criar.
--   - `estorno-credito` migrado de INSERT direto (estornarMovimentoCredito)
--     para a RPC mc_ajuste_avulso_estornar.
--   - Fallback legado de abatimento de débito em `confirmar` (marcador
--     [ABATIMENTO_DEBITO:x]) migrado de INSERT direto para a RPC
--     mc_confirmar_abatimento_legado.
--   Sem essas três correções aplicadas e publicadas, NÃO aplique este cutover.

BEGIN;

-- F.1 movimento_credito: fechar RLS permissiva legada; leitura autenticada mantida.
DROP POLICY IF EXISTS geral ON public.movimento_credito;
CREATE POLICY mc_select_authenticated ON public.movimento_credito
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.movimento_credito FROM anon;
-- Nenhuma escrita direta permanece liberada para `authenticated`: todos os
-- fluxos legados (ajuste avulso, estorno avulso, abatimento legado) foram
-- migrados para RPC SECURITY DEFINER antes deste cutover (ver cabeçalho).
REVOKE INSERT, UPDATE, DELETE ON public.movimento_credito FROM authenticated;

-- F.2 Imutabilidade real: proíbe UPDATE/DELETE em movimento_credito (append-only),
--     reforçando o REVOKE acima e cobrindo também o dono/superusuário por engano.
--     A limpeza autorizada de dados de teste (fase separada) fará
--     DROP TRIGGER -> DELETE -> recriar, nunca em produção sem autorização explícita.
CREATE OR REPLACE FUNCTION public.cc__movimento_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'movimento_credito é append-only: use lançamento compensatório (ESTORNO), nunca UPDATE/DELETE';
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS trg_mc_append_only ON public.movimento_credito;
CREATE TRIGGER trg_mc_append_only
  BEFORE UPDATE OR DELETE ON public.movimento_credito
  FOR EACH ROW EXECUTE FUNCTION public.cc__movimento_append_only();

-- NOTA: as RPCs legadas fn_lancar_movimento_credito / fn_cancelar_movimento_credito
-- permanecem no banco mas ficam DESCONTINUADAS (não chamadas pelo código). Sua remoção
-- de GRANT fica para uma limpeza posterior, para não interferir em nenhum consumidor
-- residual não identificado nesta auditoria.

COMMIT;
