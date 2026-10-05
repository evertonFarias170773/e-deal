-- ============================================================================
-- NFS-e: notas_servico passa a gravar em audit.logs_v2
-- ============================================================================
--
-- POR QUE
--   `notas_servico` nao tinha trigger de auditoria: toda alteracao numa nota de
--   servico ficava sem historico e sem autor. E o passo 1 do plano de 05/10/2026
--   para fechar a escrita de NFS-e (os proximos travam o UPDATE direto e o
--   EXECUTE das funcoes; nenhum deles entra aqui).
--
-- O QUE MUDA
--   1. Trigger `trg_audit_notas_servico`, AFTER INSERT OR DELETE OR UPDATE, FOR
--      EACH ROW, chamando `audit.log_row_changes_v2()` — identico ao de
--      `pagamentos_v2`, `boletos`, `propostas` e das outras cinco tabelas
--      auditadas.
--   2. Linha em `audit.config_v2` (public, notas_servico, enabled = true,
--      ignored_columns = {updated_at}) — o mesmo de `boletos`. Sem essa linha a
--      funcao devolve a linha sem registrar nada.
--
-- O QUE NAO MUDA
--   Nenhum dado, nenhuma policy, nenhum grant, nenhuma funcao. O trigger
--   existente `trg_nfse_normalizar_recalcular_biu` e BEFORE e continua rodando
--   antes, igual; o de auditoria e AFTER e nao consegue alterar a linha gravada.
--   Nao ha backfill: as 5 notas de maio nao ganham linha de auditoria.
--
-- COMO A FUNCAO REGISTRA (padrao ja existente, nao alterado aqui)
--   - UPDATE que nao muda nada alem das colunas ignoradas NAO gera linha;
--   - `payload_envio` e `payload_retorno` entram no historico de proposito: o
--     retorno sobrescrito ja apagou a prova de uma nota antes;
--   - gravacao do n8n chega como service_role, sem usuario (actor_uid nulo) —
--     limite conhecido. A funcao e SECURITY DEFINER e ja registra gravacoes de
--     service_role nas outras tabelas.
--
-- TRAVAS
--   a) trigger e linha de config ainda nao existem;
--   b) depois: o md5 das linhas de `notas_servico` e identico (a migration nao
--      toca dados), o trigger BEFORE existente tem a mesma definicao, e a
--      contagem de auditoria da tabela nao mudou.
--
-- ROLLBACK
--   drop trigger if exists trg_audit_notas_servico on public.notas_servico;
--   delete from audit.config_v2 where schema_name = 'public' and table_name = 'notas_servico';
--   (as linhas ja gravadas em audit.logs_v2 ficam: sao historico)
-- ============================================================================

do $migracao$
declare
  v_md5_antes      text;
  v_md5_depois     text;
  v_trg_antes      text;
  v_trg_depois     text;
  v_audit_antes    bigint;
  v_audit_depois   bigint;
begin
  -- a) nada disto existe ainda
  if exists (select 1 from pg_trigger
              where tgrelid = 'public.notas_servico'::regclass and tgname = 'trg_audit_notas_servico') then
    raise exception 'trg_audit_notas_servico ja existe';
  end if;
  if exists (select 1 from audit.config_v2 where schema_name = 'public' and table_name = 'notas_servico') then
    raise exception 'audit.config_v2 ja tem linha para public.notas_servico';
  end if;

  select md5(string_agg(md5(to_jsonb(n)::text), ',' order by n.id)) into v_md5_antes from public.notas_servico n;
  select pg_get_triggerdef(oid) into v_trg_antes
    from pg_trigger where tgrelid = 'public.notas_servico'::regclass and tgname = 'trg_nfse_normalizar_recalcular_biu';
  select count(*) into v_audit_antes from audit.logs_v2 where schema_name = 'public' and table_name = 'notas_servico';

  -- 1. a configuracao (o mesmo de boletos)
  insert into audit.config_v2 (schema_name, table_name, enabled, ignored_columns)
  values ('public', 'notas_servico', true, array['updated_at']);

  -- 2. o trigger (o mesmo das outras tabelas auditadas)
  create trigger trg_audit_notas_servico
    after insert or delete or update on public.notas_servico
    for each row execute function audit.log_row_changes_v2();

  -- b) conferencias
  select md5(string_agg(md5(to_jsonb(n)::text), ',' order by n.id)) into v_md5_depois from public.notas_servico n;
  if v_md5_depois is distinct from v_md5_antes then
    raise exception 'as linhas de notas_servico mudaram (% -> %)', v_md5_antes, v_md5_depois;
  end if;

  select pg_get_triggerdef(oid) into v_trg_depois
    from pg_trigger where tgrelid = 'public.notas_servico'::regclass and tgname = 'trg_nfse_normalizar_recalcular_biu';
  if v_trg_depois is distinct from v_trg_antes then
    raise exception 'o trigger trg_nfse_normalizar_recalcular_biu mudou';
  end if;

  select count(*) into v_audit_depois from audit.logs_v2 where schema_name = 'public' and table_name = 'notas_servico';
  if v_audit_depois is distinct from v_audit_antes then
    raise exception 'a migration gerou linha de auditoria (% -> %)', v_audit_antes, v_audit_depois;
  end if;

  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.notas_servico'::regclass and t.tgname = 'trg_audit_notas_servico'
       and t.tgfoid = 'audit.log_row_changes_v2()'::regprocedure
       and (t.tgtype & 2) = 0          -- AFTER
       and (t.tgtype & 1) = 1          -- FOR EACH ROW
       and (t.tgtype & 28) = 28        -- INSERT + DELETE + UPDATE
       and t.tgenabled = 'O'
  ) then
    raise exception 'trg_audit_notas_servico nao ficou como esperado';
  end if;

  raise notice 'ok: auditoria ligada em notas_servico; dados intactos (md5 %)', v_md5_depois;
end
$migracao$;
