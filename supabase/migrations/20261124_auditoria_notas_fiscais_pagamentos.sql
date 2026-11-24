-- ============================================================================
-- Auditoria (audit.logs_v2) em notas_fiscais_pagamentos (24/11/2026)
-- ============================================================================
-- AUTORIZADA pelo Everton em 24/11/2026: so esta migration de auditoria em
-- notas_fiscais_pagamentos, no mesmo padrao de notas_fiscais (3c2e3557).
--
-- POR QUE
--   A NFE-25427-001 (NF 41686) saiu com 1x PIX a vista: as parcelas foram
--   desativadas e recriadas pela tela sem deixar autor nem antes/depois. So
--   deu para reconstruir pelo updated_at das proprias linhas.
--
-- O QUE MUDA
--   A MESMA auditoria de notas_fiscais (20261116_auditoria_notas_fiscais_eventos):
--   1. audit.config_v2: linha enabled = true, ignored_columns = {updated_at};
--   2. gatilho trg_audit_notas_fiscais_pagamentos AFTER INSERT OR DELETE OR
--      UPDATE ... FOR EACH ROW EXECUTE FUNCTION audit.log_row_changes_v2().
--
-- O QUE NAO MUDA
--   Regras de acesso (RLS, policies e grants), dados das parcelas, os outros
--   gatilhos da tabela e a funcao de auditoria.
--
-- TRAVAS
--   a) audit.log_row_changes_v2 com o corpo conferido (md5 d264f20e...);
--   b) o gatilho de notas_fiscais e exatamente o modelo, e a config dela e
--      (enabled, {updated_at});
--   c) notas_fiscais_pagamentos sem gatilho de auditoria e sem config;
--   d) depois: um gatilho de auditoria, igual ao modelo (so nome e tabela);
--   e) policies, RLS e ACL iguais antes e depois (md5).
--
-- ROLLBACK: supabase/manutencao/auditoria-notas-pagamentos-rollback/rollback.sql
-- ============================================================================

do $migracao$
declare
  v_modelo        text;
  v_def           text;
  v_acesso_antes  text;
  v_acesso_depois text;
begin
  set local lock_timeout = '5s';

  -- a) a funcao de auditoria e a conferida
  if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'audit' and p.proname = 'log_row_changes_v2') is distinct from 'd264f20e18956e987a487e4d0145a7f9' then
    raise exception 'audit.log_row_changes_v2 difere da conferida. Abortado.';
  end if;

  -- b) o modelo: o gatilho de notas_fiscais
  select pg_get_triggerdef(t.oid) into v_modelo
    from pg_trigger t
   where t.tgrelid = 'public.notas_fiscais'::regclass and t.tgname = 'trg_audit_notas_fiscais';
  if v_modelo is distinct from
     'CREATE TRIGGER trg_audit_notas_fiscais AFTER INSERT OR DELETE OR UPDATE ON public.notas_fiscais FOR EACH ROW EXECUTE FUNCTION audit.log_row_changes_v2()' then
    raise exception 'gatilho modelo de notas_fiscais diferente do esperado: %', v_modelo;
  end if;
  if not exists (select 1 from audit.config_v2 where schema_name = 'public' and table_name = 'notas_fiscais'
                   and enabled and ignored_columns = array['updated_at']::text[]) then
    raise exception 'config de notas_fiscais diferente do esperado. Abortado.';
  end if;

  -- c) nada de auditoria ainda
  if exists (select 1 from pg_trigger t join pg_proc f on f.oid = t.tgfoid join pg_namespace fn on fn.oid = f.pronamespace
              where t.tgrelid = 'public.notas_fiscais_pagamentos'::regclass
                and not t.tgisinternal and (fn.nspname = 'audit' or f.proname ilike '%audit%')) then
    raise exception 'ja existe gatilho de auditoria em notas_fiscais_pagamentos. Abortado.';
  end if;
  if exists (select 1 from audit.config_v2 where schema_name = 'public' and table_name = 'notas_fiscais_pagamentos') then
    raise exception 'ja existe linha em audit.config_v2 para notas_fiscais_pagamentos. Abortado.';
  end if;

  -- e) regras de acesso antes
  select md5(string_agg(x, E'\n' order by x)) into v_acesso_antes from (
    select format('%s|%s|%s|%s|%s|%s', tablename, policyname, cmd, roles, qual, with_check) x
      from pg_policies where schemaname = 'public' and tablename = 'notas_fiscais_pagamentos'
    union all
    select format('%s|rls=%s|force=%s|acl=%s', relname, relrowsecurity, relforcerowsecurity, relacl)
      from pg_class where oid = 'public.notas_fiscais_pagamentos'::regclass
  ) s;

  -- 1. config, igual a de notas_fiscais
  insert into audit.config_v2 (schema_name, table_name, enabled, ignored_columns)
  values ('public', 'notas_fiscais_pagamentos', true, array['updated_at']::text[]);

  -- 2. gatilho
  create trigger trg_audit_notas_fiscais_pagamentos
    after insert or delete or update on public.notas_fiscais_pagamentos
    for each row execute function audit.log_row_changes_v2();

  -- d) igual ao modelo, e so um
  select pg_get_triggerdef(t.oid) into v_def
    from pg_trigger t where t.tgrelid = 'public.notas_fiscais_pagamentos'::regclass
     and t.tgname = 'trg_audit_notas_fiscais_pagamentos';
  if v_def is distinct from replace(v_modelo, 'notas_fiscais', 'notas_fiscais_pagamentos') then
    raise exception 'gatilho difere do modelo: %', v_def;
  end if;
  if (select count(*) from pg_trigger t join pg_proc f on f.oid = t.tgfoid join pg_namespace fn on fn.oid = f.pronamespace
       where t.tgrelid = 'public.notas_fiscais_pagamentos'::regclass and not t.tgisinternal
         and (fn.nspname = 'audit' or f.proname ilike '%audit%')) <> 1 then
    raise exception 'mais de um gatilho de auditoria em notas_fiscais_pagamentos';
  end if;

  -- e) regras de acesso depois
  select md5(string_agg(x, E'\n' order by x)) into v_acesso_depois from (
    select format('%s|%s|%s|%s|%s|%s', tablename, policyname, cmd, roles, qual, with_check) x
      from pg_policies where schemaname = 'public' and tablename = 'notas_fiscais_pagamentos'
    union all
    select format('%s|rls=%s|force=%s|acl=%s', relname, relrowsecurity, relforcerowsecurity, relacl)
      from pg_class where oid = 'public.notas_fiscais_pagamentos'::regclass
  ) s;
  if v_acesso_depois is distinct from v_acesso_antes then
    raise exception 'regras de acesso mudaram (% -> %)', v_acesso_antes, v_acesso_depois;
  end if;

  raise notice 'auditoria ligada em notas_fiscais_pagamentos | gatilho igual ao de notas_fiscais | acesso % inalterado', v_acesso_antes;
end
$migracao$;
