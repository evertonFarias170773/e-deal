-- ============================================================================
-- 20261002_atualizar_atrasos_boletos_revoga_anon_public.sql
--
-- `public.atualizar_atrasos_boletos()` é a rotina diária de atraso dos títulos
-- (pg_cron `atualizar-atraso-boletos`, 03:00 UTC, agendada pelo papel
-- `postgres`). Ela faz UPDATE em toda a tabela `boletos`, e qualquer visitante
-- sem login podia chamá-la por RPC: o EXECUTE estava concedido a PUBLIC e a
-- `anon`.
--
-- ACL antes:  {PUBLIC, anon, authenticated, postgres, service_role}
-- ACL depois: {authenticated, postgres, service_role}
--
-- Ficam: `postgres` (dono e quem agenda) e `service_role`. `authenticated`
-- tem concessão própria e NÃO é tocado aqui — a decisão de 02/10/2026 foi
-- revogar só `anon` e PUBLIC. Nada no app chama esta função.
-- ============================================================================

revoke execute on function public.atualizar_atrasos_boletos() from public;
revoke execute on function public.atualizar_atrasos_boletos() from anon;
