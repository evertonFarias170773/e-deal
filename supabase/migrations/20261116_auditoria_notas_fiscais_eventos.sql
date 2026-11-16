-- ============================================================================
-- Auditoria (audit.logs_v2) em notas_fiscais e notas_eventos (16/11/2026)
-- ============================================================================
-- AUTORIZADA pelo Everton em 16/11/2026: so esta migration de auditoria em
-- notas_fiscais e notas_eventos.
--
-- POR QUE
--   So notas_servico era auditada. Uma troca de status de NF-e (por exemplo
--   marcar CANCELADA sem a SEFAZ, como em NFE-23138-001, NFE-23564-002,
--   NFE-23702-001 e NFE-22066-001) nao deixava autor nem antes/depois.
--
-- O QUE MUDA
--   A MESMA auditoria de notas_servico (ligada direto no banco em 05/10/2026):
--   1. audit.config_v2: linha enabled = true, ignored_columns = {updated_at},
--      para public.notas_fiscais e public.notas_eventos;
--   2. gatilho AFTER INSERT OR DELETE OR UPDATE ... FOR EACH ROW EXECUTE
--      FUNCTION audit.log_row_changes_v2() em cada uma, com o nome no padrao
--      trg_audit_<tabela>.
--
-- O QUE NAO MUDA
--   Regras de acesso (RLS, policies e grants), status e dados das notas, os
--   outros gatilhos das duas tabelas e a funcao de auditoria.
--
-- TRAVAS
--   a) audit.log_row_changes_v2 com o corpo conferido (md5 d264f20e...);
--   b) o gatilho de notas_servico e exatamente o modelo copiado;
--   c) nenhuma das duas tabelas tem gatilho de auditoria (v1 ou v2) nem linha
--      em audit.config_v2;
--   d) depois: um gatilho de auditoria por tabela, com a mesma definicao do de
--      notas_servico (trocado so o nome e a tabela), config igual;
--   e) policies, RLS e ACL das duas tabelas iguais antes e depois.
--
-- ROLLBACK: supabase/manutencao/auditoria-notas-rollback/rollback.sql
-- ============================================================================

do $migracao$
declare
  v_modelo        text;
  v_def           text;
  v_esperado      text;
  v_acesso_antes  text;
  v_acesso_depois text;
  v_tabela        text;
begin
  set local lock_timeout = '5s';

  -- a) a funcao de auditoria e a conferida
  if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'audit' and p.proname = 'log_row_changes_v2') is distinct from 'd264f20e18956e987a487e4d0145a7f9' then
    raise exception 'audit.log_row_changes_v2 difere da conferida. Abortado.';
  end if;

  -- b) o modelo: o gatilho de notas_servico
  select pg_get_triggerdef(t.oid) into v_modelo
    from pg_trigger t
   where t.tgrelid = 'public.notas_servico'::regclass and t.tgname = 'trg_audit_notas_servico';
  if v_modelo is distinct from
     'CREATE TRIGGER trg_audit_notas_servico AFTER INSERT OR DELETE OR UPDATE ON public.notas_servico FOR EACH ROW EXECUTE FUNCTION audit.log_row_changes_v2()' then
    raise exception 'gatilho modelo de notas_servico diferente do esperado: %', v_modelo;
  end if;
  if not exists (select 1 from audit.config_v2 where schema_name = 'public' and table_name = 'notas_servico'
                   and enabled and ignored_columns = array['updated_at']::text[]) then
    raise exception 'config de notas_servico diferente do esperado. Abortado.';
  end if;

  -- c) nada de auditoria ainda nas duas
  if exists (select 1 from pg_trigger t join pg_proc f on f.oid = t.tgfoid join pg_namespace fn on fn.oid = f.pronamespace
              where t.tgrelid in ('public.notas_fiscais'::regclass, 'public.notas_eventos'::regclass)
                and not t.tgisinternal and (fn.nspname = 'audit' or f.proname ilike '%audit%')) then
    raise exception 'ja existe gatilho de auditoria em notas_fiscais ou notas_eventos. Abortado.';
  end if;
  if exists (select 1 from audit.config_v2 where schema_name = 'public' and table_name in ('notas_fiscais', 'notas_eventos')) then
    raise exception 'ja existe linha em audit.config_v2 para notas_fiscais ou notas_eventos. Abortado.';
  end if;

  -- e) regras de acesso antes
  select md5(string_agg(x, E'\n' order by x)) into v_acesso_antes from (
    select format('%s|%s|%s|%s|%s|%s', tablename, policyname, cmd, roles, qual, with_check) x
      from pg_policies where schemaname = 'public' and tablename in ('notas_fiscais', 'notas_eventos')
    union all
    select format('%s|rls=%s|force=%s|acl=%s', relname, relrowsecurity, relforcerowsecurity, relacl)
      from pg_class where oid in ('public.notas_fiscais'::regclass, 'public.notas_eventos'::regclass)
  ) s;

  -- 1. config, igual a de notas_servico
  insert into audit.config_v2 (schema_name, table_name, enabled, ignored_columns)
  values ('public', 'notas_fiscais', true, array['updated_at']::text[]),
         ('public', 'notas_eventos', true, array['updated_at']::text[]);

  -- 2. gatilhos
  create trigger trg_audit_notas_fiscais
    after insert or delete or update on public.notas_fiscais
    for each row execute function audit.log_row_changes_v2();
  create trigger trg_audit_notas_eventos
    after insert or delete or update on public.notas_eventos
    for each row execute function audit.log_row_changes_v2();

  -- d) cada um igual ao modelo, e so um por tabela
  foreach v_tabela in array array['notas_fiscais', 'notas_eventos'] loop
    v_esperado := replace(v_modelo, 'notas_servico', v_tabela);
    select pg_get_triggerdef(t.oid) into v_def
      from pg_trigger t where t.tgrelid = ('public.' || v_tabela)::regclass and t.tgname = 'trg_audit_' || v_tabela;
    if v_def is distinct from v_esperado then
      raise exception 'gatilho de % difere do modelo: %', v_tabela, v_def;
    end if;
    if (select count(*) from pg_trigger t join pg_proc f on f.oid = t.tgfoid join pg_namespace fn on fn.oid = f.pronamespace
         where t.tgrelid = ('public.' || v_tabela)::regclass and not t.tgisinternal
           and (fn.nspname = 'audit' or f.proname ilike '%audit%')) <> 1 then
      raise exception 'mais de um gatilho de auditoria em %', v_tabela;
    end if;
  end loop;

  -- e) regras de acesso depois
  select md5(string_agg(x, E'\n' order by x)) into v_acesso_depois from (
    select format('%s|%s|%s|%s|%s|%s', tablename, policyname, cmd, roles, qual, with_check) x
      from pg_policies where schemaname = 'public' and tablename in ('notas_fiscais', 'notas_eventos')
    union all
    select format('%s|rls=%s|force=%s|acl=%s', relname, relrowsecurity, relforcerowsecurity, relacl)
      from pg_class where oid in ('public.notas_fiscais'::regclass, 'public.notas_eventos'::regclass)
  ) s;
  if v_acesso_depois is distinct from v_acesso_antes then
    raise exception 'regras de acesso mudaram (% -> %)', v_acesso_antes, v_acesso_depois;
  end if;

  raise notice 'auditoria ligada em notas_fiscais e notas_eventos | gatilho igual ao de notas_servico | acesso % inalterado', v_acesso_antes;
end
$migracao$;
