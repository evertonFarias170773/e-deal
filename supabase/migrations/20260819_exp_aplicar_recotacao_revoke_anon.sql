-- Parte C, Etapa 2 — retira o EXECUTE de `anon` em exp_aplicar_recotacao
--
-- O QUE E
--   Um REVOKE. Nao altera tabela, funcao, RLS nem dado nenhum.
--
-- POR QUE
--   A migration 20260819_expedicao_recotacoes fez
--     REVOKE EXECUTE ... FROM PUBLIC;
--     GRANT  EXECUTE ... TO authenticated;
--   e isso NAO bastou. O REVOKE tira o pseudo-papel PUBLIC, mas o Supabase
--   concede EXECUTE a `anon`, `authenticated` e `service_role` por DEFAULT
--   PRIVILEGES no schema public, no momento em que a funcao e criada — um
--   grant EXPLICITO, que REVOKE FROM PUBLIC nao alcanca.
--
--   Conferido em 19/08/2026, depois de aplicada:
--     exp_aplicar_recotacao : postgres | anon | authenticated | service_role
--     cc_abrir_pendencia    : postgres |      | authenticated | service_role
--     cc__valor_pago        : postgres |      | authenticated | service_role
--     cc__total_soberano_proposta e cc__assert_permissao: idem
--   A funcao desta etapa era a UNICA do conjunto com `anon`.
--
-- GRAVIDADE, MEDIDA E NAO SUPOSTA
--   Nao ha caminho de escrita aberto hoje. A primeira instrucao da RPC e
--   `PERFORM cc__assert_permissao(auth.uid(), 'expedicao.processar')`, e a
--   primeira instrucao DELA e
--     IF p_uid IS NULL THEN RAISE EXCEPTION 'AUTH: usuario nao autenticado'
--       USING ERRCODE = '28000';
--   Numa chamada anonima `auth.uid()` e nulo, entao a transacao aborta antes
--   de ler ou escrever qualquer coisa.
--
--   O que se corrige aqui e a camada a menos: exp_aplicar_recotacao e
--   SECURITY DEFINER, roda como o dono e passa por cima de RLS. Uma funcao
--   assim nao deve estar ao alcance do papel anonimo por acidente de default
--   privilege — a barreira nao pode depender so da primeira linha do corpo.
--
-- ROLLBACK
--   GRANT EXECUTE ON FUNCTION public.exp_aplicar_recotacao(...) TO anon;
--   (nao ha razao conhecida para querer isso)

REVOKE EXECUTE ON FUNCTION public.exp_aplicar_recotacao(
  bigint, uuid, numeric, numeric, numeric, text, text, text, integer, text,
  numeric, uuid, text, text, jsonb, text, text, text
) FROM anon;

-- VERIFICACAO
--   SELECT array_to_string(proacl::text[], ' | ') FROM pg_proc
--    WHERE proname = 'exp_aplicar_recotacao';
--   Esperado: postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
