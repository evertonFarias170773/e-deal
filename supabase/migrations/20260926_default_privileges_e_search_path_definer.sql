-- =====================================================================
-- Funcao nova do postgres deixa de nascer executavel por PUBLIC (e anon);
-- search_path fixo nas 16 funcoes SECURITY DEFINER que estavam sem
-- =====================================================================
--
-- O QUE
-- -----
-- 1. Privilegio padrao do papel postgres (quem aplica as migrations):
--    - global: funcao nova deixa de dar EXECUTE a PUBLIC. Era por PUBLIC que
--      anon executava toda funcao nova, mesmo depois de 01/09, quando o default
--      por schema de public ja tinha tirado anon;
--    - em public: REVOKE de anon, repetido de proposito (sem efeito hoje) para
--      a intencao ficar escrita aqui.
--    O default de public continua dando EXECUTE a authenticated e service_role.
--    Funcao nova que precise de anon (portal do cliente, QR da OS) recebe
--    GRANT explicito na propria migration.
-- 2. search_path = pg_catalog, public nas 16 SECURITY DEFINER sem search_path
--    (eram 18 no raio-X; check_and_promote_proposta e
--    recalcular_status_arte_briefing ja foram corrigidas em 20260926150320).
--
-- Nenhum corpo muda. Nenhum grant de funcao existente muda. RLS e policies
-- nao sao tocadas.
--
-- POR QUE pg_catalog, public BASTA
-- --------------------------------
-- Conferido corpo a corpo em 26/09/2026: as 8 de audit so citam audit.* com
-- schema e funcoes do pg_catalog; as 8 de public citam objetos de public (com
-- ou sem schema) e auth.uid() com schema. Nenhuma usa funcao de extensao
-- (extensions.*) sem schema.
--
-- TESTADO ANTES, em transacao desfeita, com o search_path novo e a sessao em
-- search_path = pg_catalog: os tres triggers (cadeia de arte ate a promocao e
-- pagamentos_v2), aplicar_credito_da_view, get_resumo_pagamento_por_proposta,
-- install/enable/disable_audit (v1 e v2) numa tabela temporaria e
-- run_maintenance_v2 com delete_old_logs_v2. duplicar_proposta nao foi
-- executada: queimaria um numero de pedido (id_int e identity) e nao tem
-- chamador. salvar_pagamento_v2_por_view e is_admin ja estavam quebradas antes
-- (id_cliente NOT NULL; coluna perfis.is_admin inexistente), sem chamador.
--
-- CUIDADO
-- -------
-- O REVOKE global vale para funcoes que o postgres criar em QUALQUER schema.
-- Se uma extensao nova for instalada pelo postgres, as funcoes dela nascem sem
-- EXECUTE para PUBLIC e podem precisar de GRANT.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

ALTER FUNCTION audit.enable_audit(text, text)                      SET search_path = pg_catalog, public;
ALTER FUNCTION audit.enable_audit_for_tables(text, text[])         SET search_path = pg_catalog, public;
ALTER FUNCTION audit.enable_audit_v2(text, text, text[])           SET search_path = pg_catalog, public;
ALTER FUNCTION audit.disable_audit_v2(text, text)                  SET search_path = pg_catalog, public;
ALTER FUNCTION audit.enable_audit_for_tables_v2(text, text[])      SET search_path = pg_catalog, public;
ALTER FUNCTION audit.delete_old_logs_v2(integer)                   SET search_path = pg_catalog, public;
ALTER FUNCTION audit.run_maintenance_v2(integer, integer)          SET search_path = pg_catalog, public;
ALTER FUNCTION audit.install_audit_v2(text, text, text[])          SET search_path = pg_catalog, public;
ALTER FUNCTION public.is_admin()                                   SET search_path = pg_catalog, public;
ALTER FUNCTION public.salvar_pagamento_v2_por_view(integer)        SET search_path = pg_catalog, public;
ALTER FUNCTION public.duplicar_proposta(bigint)                    SET search_path = pg_catalog, public;
ALTER FUNCTION public.aplicar_credito_da_view(bigint)              SET search_path = pg_catalog, public;
ALTER FUNCTION public.get_resumo_pagamento_por_proposta(bigint)    SET search_path = pg_catalog, public;
ALTER FUNCTION public.sync_status_arte_to_briefing()               SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_sync_artes_to_proposta_func()            SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_sync_financeiro_to_proposta_func()       SET search_path = pg_catalog, public;
