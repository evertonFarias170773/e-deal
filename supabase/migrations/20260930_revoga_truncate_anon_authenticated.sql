-- =====================================================================
-- TRUNCATE sai de anon e authenticated em public; tabela nova nasce sem
-- =====================================================================
--
-- O QUE
-- -----
-- 1. REVOKE TRUNCATE de anon e authenticated em todo objeto de public que o
--    tenha. Em 30/09/2026 eram 139 (tabelas e views, todas do postgres):
--    67 com anon, 139 com authenticated, nenhum por PUBLIC.
-- 2. Privilegio padrao do postgres em public: tabela nova deixa de dar
--    TRUNCATE a anon e authenticated. Os demais privilegios padrao ficam.
--
-- Nenhum outro privilegio muda. Nenhuma linha e lida, escrita ou apagada.
--
-- POR QUE
-- -------
-- TRUNCATE nao passa pela RLS: quem tem o privilegio esvazia a tabela inteira,
-- ignorando as policies. O Vibe nao usa TRUNCATE (src, rotas e Edge Functions),
-- e o PostgREST nem expoe o comando; ele so seria alcancavel por funcao
-- SECURITY INVOKER.
--
-- EFEITO CONHECIDO
-- ----------------
-- gerar_sudeste_matriz e gerar_sudeste_capa (SECURITY INVOKER) fazem TRUNCATE
-- em sudeste_matriz e sudeste_capa. Chamadas por authenticated passam a ser
-- recusadas; por postgres/service_role seguem. Nenhuma chamada desde 22/09 e
-- nenhum chamador no repositorio nem no Imposition.
--
-- FORA DO ALCANCE
-- ---------------
-- O privilegio padrao do supabase_admin em public tambem da TRUNCATE a anon e
-- authenticated, mas o postgres nao pode altera-lo. As migrations rodam como
-- postgres, entao as tabelas novas do projeto nao passam por ele.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT c.oid::regclass AS obj
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND a.privilege_type = 'TRUNCATE'
      AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole)
  LOOP
    EXECUTE format('REVOKE TRUNCATE ON TABLE %s FROM anon, authenticated', r.obj);
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated;
