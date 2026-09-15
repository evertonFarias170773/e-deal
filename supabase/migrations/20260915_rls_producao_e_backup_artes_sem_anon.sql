-- =====================================================================
-- RLS em 5 tabelas producao_* sem uso de anon e no backup de pedidos_artes;
-- anon sai das 5
-- =====================================================================
--
-- O QUE
-- -----
-- 1. REVOKE ALL de `anon` em:
--      producao_usuarios, producao_ordens_servico, producao_os_itens,
--      producao_os_log, producao_combinacoes
-- 2. ENABLE ROW LEVEL SECURITY nessas 5 e em pedidos_artes_status_backup_20260913
--    (esta nunca teve grant a anon);
-- 3. uma policy por tabela, `FOR ALL TO authenticated USING (true) WITH CHECK (true)`,
--    no padrao `<tabela>_all_authenticated`.
--
-- Nenhuma outra tabela e tocada. Nenhuma linha e lida, escrita ou apagada.
--
-- POR QUE
-- -------
-- Security Advisor, `rls_disabled_in_public`, 13/09/2026. Levantamento de
-- 15/09/2026: as 6 estavam sem RLS; as 5 producao_* com SELECT, INSERT, UPDATE,
-- DELETE, TRUNCATE, REFERENCES, TRIGGER e MAINTAIN para `anon` — gravaveis e
-- apagaveis sem login, com a chave que vai no navegador. Nenhuma tem policy.
--
-- POR QUE ISTO NAO QUEBRA NADA
-- ----------------------------
-- * O Vibe nao cita nenhuma das 6 (src, supabase, scripts, historico do git).
--   As producao_* sao do sistema parceiro de imposicao, no mesmo projeto.
-- * `anon` nas 5, por pg_stat_statements (zerado em 31/08): uma varredura de
--   `select *` em 01/09 13:10, 10 s passando pelas 5 — a auditoria de anon daquele
--   dia — e 2 consultas em producao_ordens_servico em 14/09 17:44. Nenhuma
--   escrita por anon, nunca. As tabelas estao vazias.
-- * `authenticated` mantem o acesso: a policy abaixo cobre SELECT, INSERT,
--   UPDATE e DELETE sem predicado. TRUNCATE, REFERENCES, TRIGGER e MAINTAIN nao
--   passam por RLS e seguem pelo grant, que nao muda.
-- * `service_role` e `postgres` tem BYPASSRLS; grants deles nao mudam.
-- * `link_cliente_bancos_modelos` e SECURITY DEFINER de postgres e nao le
--   nenhuma destas 6.
-- * Sem view dependente, sem grant por coluna, sem realtime, sem papel herdeiro
--   de anon. Os 3 triggers so gravam updated_at.
--
-- O QUE ESTA MIGRATION NAO FAZ
-- ----------------------------
-- * NAO toca em pedidos_bancos, pedidos_modelos_banco, producao_config nem
--   producao_produtos_combinaveis: tem uso real de anon pelo parceiro e dependem
--   de coordenacao com ele. Continuam sem RLS e com anon.
-- * nao altera default privileges, grants de authenticated/service_role, RPC,
--   trigger, codigo ou dado.
-- =====================================================================

-- ------------------------------------------------------------------
-- 1. ASSERCOES DE ENTRADA — o estado tem de ser o do levantamento
-- ------------------------------------------------------------------
do $entrada$
declare
  v_t text;
begin
  foreach v_t in array array['producao_usuarios','producao_ordens_servico','producao_os_itens','producao_os_log','producao_combinacoes'] loop
    if not (has_table_privilege('anon', 'public.' || v_t, 'SELECT')
        and has_table_privilege('anon', 'public.' || v_t, 'INSERT')
        and has_table_privilege('anon', 'public.' || v_t, 'UPDATE')
        and has_table_privilege('anon', 'public.' || v_t, 'DELETE')) then
      raise exception 'ABORTADO: anon ja nao tem SELECT/INSERT/UPDATE/DELETE em %. O estado divergiu do levantamento.', v_t;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.pedidos_artes_status_backup_20260913', 'SELECT') then
    raise exception 'ABORTADO: anon tem SELECT no backup de pedidos_artes; o levantamento dizia que nao.';
  end if;

  if exists (select 1 from pg_class c
              where c.oid in ('public.producao_usuarios'::regclass, 'public.producao_ordens_servico'::regclass,
                              'public.producao_os_itens'::regclass, 'public.producao_os_log'::regclass,
                              'public.producao_combinacoes'::regclass, 'public.pedidos_artes_status_backup_20260913'::regclass)
                and (c.relrowsecurity or exists (select 1 from pg_policy p where p.polrelid = c.oid)))
  then
    raise exception 'ABORTADO: alguma das 6 ja tem RLS ligado ou policy. O estado divergiu do levantamento.';
  end if;

  raise notice 'Entrada OK: anon com escrita nas 5, sem acesso ao backup; 6 sem RLS e sem policy.';
end
$entrada$;

-- ------------------------------------------------------------------
-- 2. anon sai das 5
-- ------------------------------------------------------------------
revoke all on table public.producao_usuarios       from anon;
revoke all on table public.producao_ordens_servico from anon;
revoke all on table public.producao_os_itens       from anon;
revoke all on table public.producao_os_log         from anon;
revoke all on table public.producao_combinacoes    from anon;

-- ------------------------------------------------------------------
-- 3. RLS nas 6
-- ------------------------------------------------------------------
alter table public.producao_usuarios                    enable row level security;
alter table public.producao_ordens_servico              enable row level security;
alter table public.producao_os_itens                    enable row level security;
alter table public.producao_os_log                      enable row level security;
alter table public.producao_combinacoes                 enable row level security;
alter table public.pedidos_artes_status_backup_20260913 enable row level security;

-- ------------------------------------------------------------------
-- 4. authenticated com exatamente o acesso de antes
-- ------------------------------------------------------------------
create policy "producao_usuarios_all_authenticated"
  on public.producao_usuarios for all to authenticated using (true) with check (true);
create policy "producao_ordens_servico_all_authenticated"
  on public.producao_ordens_servico for all to authenticated using (true) with check (true);
create policy "producao_os_itens_all_authenticated"
  on public.producao_os_itens for all to authenticated using (true) with check (true);
create policy "producao_os_log_all_authenticated"
  on public.producao_os_log for all to authenticated using (true) with check (true);
create policy "producao_combinacoes_all_authenticated"
  on public.producao_combinacoes for all to authenticated using (true) with check (true);
create policy "pedidos_artes_status_backup_20260913_all_authenticated"
  on public.pedidos_artes_status_backup_20260913 for all to authenticated using (true) with check (true);

-- ------------------------------------------------------------------
-- 5. ASSERCOES DE SAIDA
-- ------------------------------------------------------------------
do $saida$
declare
  v_t text;
  v_p text;
begin
  -- 5.1 RLS ligado nas 6
  foreach v_t in array array['producao_usuarios','producao_ordens_servico','producao_os_itens','producao_os_log','producao_combinacoes','pedidos_artes_status_backup_20260913'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || v_t)::regclass) then
      raise exception 'ABORTADO: RLS nao ficou ligado em %.', v_t;
    end if;
  end loop;

  -- 5.2 anon sem privilegio nenhum nas 5
  foreach v_t in array array['producao_usuarios','producao_ordens_servico','producao_os_itens','producao_os_log','producao_combinacoes'] loop
    foreach v_p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege('anon', 'public.' || v_t, v_p) then
        raise exception 'ABORTADO: anon ainda tem % em %.', v_p, v_t;
      end if;
    end loop;
  end loop;

  -- 5.3 authenticated mantem SELECT, INSERT, UPDATE e DELETE nas 6
  foreach v_t in array array['producao_usuarios','producao_ordens_servico','producao_os_itens','producao_os_log','producao_combinacoes','pedidos_artes_status_backup_20260913'] loop
    foreach v_p in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if not has_table_privilege('authenticated', 'public.' || v_t, v_p) then
        raise exception 'ABORTADO: authenticated perdeu % em %.', v_p, v_t;
      end if;
    end loop;
  end loop;

  raise notice 'Saida OK: RLS nas 6; anon zerado nas 5; authenticated com SELECT/INSERT/UPDATE/DELETE nas 6.';
end
$saida$;


-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Devolve exatamente o estado anterior — inclusive a escrita anonima nas 5.
--
-- begin;
--   drop policy if exists "producao_usuarios_all_authenticated"                    on public.producao_usuarios;
--   drop policy if exists "producao_ordens_servico_all_authenticated"              on public.producao_ordens_servico;
--   drop policy if exists "producao_os_itens_all_authenticated"                    on public.producao_os_itens;
--   drop policy if exists "producao_os_log_all_authenticated"                      on public.producao_os_log;
--   drop policy if exists "producao_combinacoes_all_authenticated"                 on public.producao_combinacoes;
--   drop policy if exists "pedidos_artes_status_backup_20260913_all_authenticated" on public.pedidos_artes_status_backup_20260913;
--
--   alter table public.producao_usuarios                    disable row level security;
--   alter table public.producao_ordens_servico              disable row level security;
--   alter table public.producao_os_itens                    disable row level security;
--   alter table public.producao_os_log                      disable row level security;
--   alter table public.producao_combinacoes                 disable row level security;
--   alter table public.pedidos_artes_status_backup_20260913 disable row level security;
--
--   grant all on table public.producao_usuarios       to anon;
--   grant all on table public.producao_ordens_servico to anon;
--   grant all on table public.producao_os_itens       to anon;
--   grant all on table public.producao_os_log         to anon;
--   grant all on table public.producao_combinacoes    to anon;
-- commit;
-- =====================================================================
