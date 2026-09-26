-- =====================================================================
-- check_and_promote_proposta e recalcular_status_arte_briefing: sem EXECUTE
-- para anon, authenticated e PUBLIC; search_path fixo
-- =====================================================================
--
-- O QUE
-- -----
-- 1. REVOKE EXECUTE de PUBLIC, anon e authenticated nas duas funcoes.
--    `anon` e `authenticated` tinham grant proprio, alem do de PUBLIC; por isso
--    os tres saem pelo nome. `postgres` e `service_role` ficam.
-- 2. search_path = pg_catalog, public nas duas.
--
-- O corpo das duas nao muda. Nenhuma linha e lida, escrita ou apagada.
--
-- POR QUE
-- -------
-- As duas sao SECURITY DEFINER de postgres, sem search_path fixo e sem
-- checagem de quem chama: com a chave que vai no navegador, qualquer visitante
-- podia chamar `/rpc/check_and_promote_proposta` e mexer em status_interno, ou
-- `/rpc/recalcular_status_arte_briefing` e mexer em pedidos_artes.status.
--
-- POR QUE ISTO NAO QUEBRA NADA
-- ----------------------------
-- * Ninguem chama as duas por RPC: pg_stat_statements (desde o restart de
--   22/09 21:05) nao tem nenhuma chamada de anon nem de authenticated; src,
--   scripts e scratch nao tem `.rpc(` para elas.
-- * Quem chama sao quatro funcoes de trigger, todas SECURITY DEFINER com dono
--   postgres:
--     pedidos_modelos.trg_sync_arte_pendente    -> atualiza_flag_arte_proposta
--     pedidos_modelos.trg_sync_modelos_to_artes -> sync_status_arte_to_briefing
--     pedidos_artes.trg_sync_artes_to_proposta  -> trg_sync_artes_to_proposta_func
--     pagamentos_v2.trg_sync_finiro_to_proposta -> trg_sync_financeiro_to_proposta_func
--   Dentro delas o EXECUTE e conferido contra o dono (postgres), nao contra
--   quem gravou. A estacao do Imposition, que grava pedidos_modelos e
--   pedidos_artes como anon, segue disparando a promocao.
-- * Os dois corpos so citam public.* qualificado e funcoes do pg_catalog, entao
--   o search_path fixo nao muda a resolucao de nenhum nome.

REVOKE EXECUTE ON FUNCTION public.check_and_promote_proposta(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_and_promote_proposta(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_and_promote_proposta(integer) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.recalcular_status_arte_briefing(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recalcular_status_arte_briefing(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recalcular_status_arte_briefing(integer) FROM authenticated;

ALTER FUNCTION public.check_and_promote_proposta(integer) SET search_path = pg_catalog, public;
ALTER FUNCTION public.recalcular_status_arte_briefing(integer) SET search_path = pg_catalog, public;
