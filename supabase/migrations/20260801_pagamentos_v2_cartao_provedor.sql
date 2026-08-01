-- ============================================================================
-- 20260801_pagamentos_v2_cartao_provedor.sql
--
-- Adiciona public.pagamentos_v2.cartao_provedor para identificar o adquirente
-- que gerou o checkout de cartao.
--
-- Causa: ate hoje so existia um provedor de cartao (C6), entao o adquirente era
-- implicito — deduzido de tipo_cobranca = 'CARD_PARCELADO' + id_empresa, com a
-- URL do webhook n8n hardcoded no codigo. Com a entrada do Asaas como opcao de
-- contingencia da empresa 1, duas linhas de pagamentos_v2 passam a ser
-- indistinguiveis entre si, e o cancelamento (src/app/api/cobrancas/
-- cancelar-externo/route.ts, branch CARD-PARCELADO) chamaria o provedor errado:
-- pediria ao C6 o cancelamento de um checkout que so existe no Asaas.
--
-- ATENCAO — GRANT DE COLUNA (nao remover o bloco de grant no fim do arquivo):
-- 20260721_conta_corrente_fase1a_aditiva.sql (secao C, linhas 225-243) revogou
-- INSERT/UPDATE de TABELA para anon/authenticated e regrantou COLUNA A COLUNA,
-- congelando a lista de colunas existentes naquela data. Coluna nova nasce SEM
-- privilegio: todo INSERT que a inclua falha em runtime com
-- "permission denied for column cartao_provedor". As sete colunas cartao_* sao
-- anteriores a 21/07/2026 e ja estao contempladas no grant vigente.
--
-- Escopo: uma coluna aditiva e nullable, mais o grant correspondente. Nenhuma
-- linha existente e alterada — NAO ha backfill aqui. As cobrancas de cartao ja
-- gravadas permanecem com cartao_provedor NULL e continuam sendo lidas como C6
-- pelo roteador de cancelamento. A partir desta migration o codigo passa a
-- gravar o provedor explicitamente ('C6' ou 'ASAAS') em toda cobranca de cartao
-- nova, de modo que NULL identifica exclusivamente o legado anterior a 01/08/2026.
-- Normalizar o historico e uma decisao separada e exige aprovacao propria.
--
-- Seguranca: nao altera RLS, policies, triggers, views ou RPCs. A coluna nao
-- carrega dado sensivel — nunca recebe numero de cartao, token de cartao nem
-- credencial de adquirente, apenas o rotulo do provedor.
--
-- Pre-voo (rodar antes de aplicar, confirmar que a coluna ainda nao existe e
-- que o grant congelado realmente nao a contempla):
--
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'pagamentos_v2'
--      and column_name = 'cartao_provedor';
--
--   select grantee, privilege_type, column_name
--     from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'pagamentos_v2'
--      and grantee in ('anon','authenticated')
--      and column_name like 'cartao%'
--    order by column_name, grantee, privilege_type;
--
-- Rollback:
--   revoke insert (cartao_provedor), update (cartao_provedor)
--     on public.pagamentos_v2 from anon, authenticated;
--   alter table public.pagamentos_v2 drop column if exists cartao_provedor;
-- ============================================================================

alter table public.pagamentos_v2
  add column if not exists cartao_provedor text;

comment on column public.pagamentos_v2.cartao_provedor is
  'Adquirente que gerou o checkout de cartao. Valores gravados pelo codigo: C6 (padrao) e ASAAS (contingencia, exclusiva da empresa 1). NULL = cobranca de cartao anterior a 01/08/2026, tratada como C6 pelo roteador de cancelamento. Nao aceita dado de cartao nem credencial. Consumida por src/app/api/cobrancas/cancelar-externo/route.ts para escolher o webhook de cancelamento.';

-- Obrigatorio: sem este grant o INSERT que inclui a coluna falha para
-- anon/authenticated. Ver bloco ATENCAO no cabecalho.
grant insert (cartao_provedor), update (cartao_provedor)
  on public.pagamentos_v2 to anon, authenticated;
