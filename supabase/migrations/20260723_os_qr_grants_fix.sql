-- ============================================================================
-- 20260723_os_qr_grants_fix.sql
--
-- PATCH DE SEGURANÇA do fluxo QR de produção (20260722_os_qr_producao.sql).
--
-- Causa: `revoke ... from public` NÃO remove os grants default que o Supabase
-- concede DIRETAMENTE a anon/authenticated/service_role na criação de funções
-- (ALTER DEFAULT PRIVILEGES). Resultado observado no banco: os_qr_finalizar e
-- helpers privados executáveis por anon/authenticated — em desacordo com a
-- Matriz de Segurança (seção "QR de Produção (OS)").
--
-- Este patch aplica REVOKE explícito por papel, mantendo APENAS os grants
-- previstos no desenho aprovado:
--   - os_qr_consultar  → anon, authenticated
--   - os_qr_avancar    → anon, authenticated
--   - os_qr_preparar   → authenticated
--   - os_qr_finalizar  → service_role (somente backend confiável)
--   - osqr__* helpers  → nenhum papel da aplicação
-- ============================================================================

-- Finalização: SOMENTE service_role.
revoke execute on function public.os_qr_finalizar(uuid, text, bigint, int, int, text) from public, anon, authenticated;
grant execute on function public.os_qr_finalizar(uuid, text, bigint, int, int, text) to service_role;

-- Preparação: somente authenticated.
revoke execute on function public.os_qr_preparar(bigint) from public, anon;
grant execute on function public.os_qr_preparar(bigint) to authenticated;

-- Helpers privados: nenhum papel da aplicação.
revoke execute on function public.osqr__has_permissao(uuid, text) from public, anon, authenticated;
revoke execute on function public.osqr__assert_permissao_any(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.osqr__assert_escopo(uuid, bigint) from public, anon, authenticated;
revoke execute on function public.osqr__timeline(bigint, text) from public, anon, authenticated;
revoke execute on function public.osqr__proximo_status(text) from public, anon, authenticated;

-- Públicas (reafirma o estado previsto; não amplia nada).
revoke execute on function public.os_qr_consultar(text) from public;
grant execute on function public.os_qr_consultar(text) to anon, authenticated;
revoke execute on function public.os_qr_avancar(text, text, text, text) from public;
grant execute on function public.os_qr_avancar(text, text, text, text) to anon, authenticated;
