-- =====================================================================
-- Fecha o acesso ANONIMO a public.token_inter
-- =====================================================================
--
-- O QUE
-- -----
-- Tira todo privilegio do papel `anon` sobre `public.token_inter` e recria as
-- tres policies PUBLIC da tabela restritas a `authenticated`, com os MESMOS
-- predicados de hoje. Nenhuma outra tabela, view, policy ou default privilege e
-- tocada.
--
-- POR QUE
-- -------
-- `token_inter` guarda o access token OAuth do Banco Inter EM TEXTO PURO, na
-- coluna `token`. A tabela tinha:
--
--   * GRANT de SELECT, INSERT, UPDATE e DELETE para `anon`;
--   * tres policies com roles `{-}` (PUBLIC, ou seja TODOS os papeis):
--       "Permitir leitura do token"      SELECT  using true
--       "Permitir inserção do token"     INSERT  with check true
--       "Permitir atualização do token"  UPDATE  using true
--
-- A chave `anon` do Supabase vai no bundle do navegador — e publica por
-- definicao. Ou seja: qualquer pessoa com a chave que o app entrega ao browser
-- lia um token bancario VIVO, e podia sobrescreve-lo.
--
-- Verificado em 01/09/2026, antes desta migration, com a anon key do
-- `.env.local` contra o PostgREST:
--
--   GET /rest/v1/token_inter?select=*&limit=1
--   -> 200, 2 linhas na tabela, resposta com a chave "token" preenchida.
--
-- Nao e teoria: e leitura de segredo bancario por requisicao anonima.
--
-- POR QUE ISTO NAO QUEBRA OS FLUXOS DO INTER
-- ------------------------------------------
-- Cinco workflows do n8n usam a tabela — PIX INTER BIRO, PIX INTER LISITON,
-- EDITAR PIX INTER IDEAL, PIX GERAL - VIBE e CANCELAR PIX INTER IDEAL — com 7
-- nos de UPDATE e 3 de leitura. TODOS passam pela credencial `Supabase e-deal`,
-- confirmada como **service_role** pelo claim `role` do JWT.
--
-- E `service_role` tem `rolbypassrls = true` no catalogo: nem os GRANTs de
-- `anon` nem as policies desta tabela participam do caminho dele. Conferido:
--
--   select rolname, rolbypassrls from pg_roles where rolname='service_role';
--   -> service_role | true
--
-- OS 7 NOS COM CHAVE ANON LITERAL NAO ENCOSTAM AQUI
-- -------------------------------------------------
-- Existem 7 nos no n8n com a chave `anon` embutida em texto (6 ativos):
--
--   Focus NFe Homologação  > Preparar Envio NF-e            rpc/fn_preparar_envio_nfe
--   Focus NFe Homologação  > Atualizar Bloqueio Validação   PATCH notas_fiscais
--   Focus NFe Homologação  > Atualizar Retorno Focus1       rpc/fn_salvar_retorno_focus_nfe
--   Focus NFSe Homologação > Atualizar Bloqueio Validação   PATCH notas_fiscais
--   Focus NFSe Homologação > Atualizar Retorno Focus1       rpc/fn_salvar_retorno_focus_nfe
--   Focus NFSe Homologação > Preparar Envio NFS-e           rpc/fn_preparar_envio_nfse
--   PDF-FATURA (INATIVO)   > HTTP Request                   functions/v1/fatura-pdf
--
-- Nenhum cita `token_inter`, e nenhum dos workflows que os contem cita a tabela
-- em no algum. As tres RPCs que eles chamam tambem nao: conferido com
--
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname in ('public','audit') and p.prokind='f'
--      and pg_get_functiondef(p.oid) ~* 'token_inter';
--   -> ZERO linhas. NENHUMA funcao do banco referencia token_inter.
--
-- Ponto que NAO deu para inspecionar: a Edge Function `fatura-pdf`, chamada
-- pelo PDF-FATURA, vive fora deste repositorio. O workflow esta INATIVO, e Edge
-- Functions usam a propria service_role key, nao a do chamador — mas fica
-- registrado como o unico caminho nao verificado por leitura direta.
--
-- ZERO CONSUMIDORES NA APLICACAO
-- ------------------------------
-- `grep -rn "token_inter" src/` nao devolve nada. Nem leitura, nem escrita. O
-- app nunca tocou esta tabela; quem a usa e so o n8n.
--
-- O QUE ESTA MIGRATION NAO FAZ
-- ----------------------------
-- * nao altera GRANT nem policy de `authenticated` ou `service_role`;
-- * nao toca em nenhuma outra tabela ou view;
-- * nao altera o default privilege do schema public;
-- * nao mexe nas RPCs dos fluxos Focus NFe/NFSe;
-- * nao apaga, insere nem atualiza linha alguma.
--
-- NOTA SOBRE DELETE
-- -----------------
-- `anon` tinha GRANT de DELETE, mas nao ha policy de DELETE na tabela — a RLS ja
-- barrava. O REVOKE abaixo remove o privilegio de qualquer forma, para o ACL nao
-- depender da ausencia de uma policy.
-- =====================================================================

-- ------------------------------------------------------------------
-- 1. ASSERCOES DE ENTRADA
-- ------------------------------------------------------------------
do $entrada$
begin
  if to_regclass('public.token_inter') is null then
    raise exception 'ABORTADO: public.token_inter nao existe.';
  end if;

  if not has_table_privilege('anon', 'public.token_inter', 'SELECT') then
    raise exception 'ABORTADO: anon ja NAO tem SELECT em token_inter. O estado do banco divergiu do levantamento de 01/09/2026 — refazer o diagnostico antes de aplicar.';
  end if;

  raise notice 'Entrada OK: token_inter existe e anon tem SELECT (o que esta migration vem remover).';
end
$entrada$;

-- ------------------------------------------------------------------
-- 2. O REVOKE
-- ------------------------------------------------------------------
revoke all on table public.token_inter from anon;

-- ------------------------------------------------------------------
-- 3. As policies PUBLIC viram policies de `authenticated`.
--    Os predicados sao os MESMOS de hoje — o que `authenticated` enxerga nao
--    muda. Muda so o conjunto de papeis que a policy alcanca.
-- ------------------------------------------------------------------
drop policy if exists "Permitir leitura do token"     on public.token_inter;
drop policy if exists "Permitir inserção do token"    on public.token_inter;
drop policy if exists "Permitir atualização do token" on public.token_inter;

create policy "Permitir leitura do token"
  on public.token_inter for select to authenticated
  using (true);

create policy "Permitir inserção do token"
  on public.token_inter for insert to authenticated
  with check (true);

create policy "Permitir atualização do token"
  on public.token_inter for update to authenticated
  using (true);

-- ------------------------------------------------------------------
-- 4. ASSERCOES DE SAIDA
-- ------------------------------------------------------------------
do $saida$
declare
  v_n integer;
begin
  -- 4.1 anon sem privilegio algum
  if has_table_privilege('anon', 'public.token_inter', 'SELECT')
     or has_table_privilege('anon', 'public.token_inter', 'INSERT')
     or has_table_privilege('anon', 'public.token_inter', 'UPDATE')
     or has_table_privilege('anon', 'public.token_inter', 'DELETE')
  then
    raise exception 'ABORTADO: anon ainda tem privilegio em token_inter apos o REVOKE.';
  end if;

  -- 4.2 authenticated e service_role inalterados
  if not (has_table_privilege('authenticated', 'public.token_inter', 'SELECT')
      and has_table_privilege('authenticated', 'public.token_inter', 'UPDATE')) then
    raise exception 'ABORTADO: authenticated perdeu privilegio que tinha antes.';
  end if;

  if not (has_table_privilege('service_role', 'public.token_inter', 'SELECT')
      and has_table_privilege('service_role', 'public.token_inter', 'UPDATE')) then
    raise exception 'ABORTADO: service_role perdeu privilegio que tinha antes.';
  end if;

  -- 4.3 nenhuma policy da tabela alcanca mais PUBLIC ou anon
  select count(*) into v_n
    from pg_policy
   where polrelid = 'public.token_inter'::regclass
     and (polroles = '{0}'::oid[] or 'anon'::regrole::oid = any(polroles));
  if v_n <> 0 then
    raise exception 'ABORTADO: % policy(s) de token_inter ainda alcancam PUBLIC ou anon.', v_n;
  end if;

  -- 4.4 as tres policies existem, agora restritas a authenticated
  select count(*) into v_n
    from pg_policy
   where polrelid = 'public.token_inter'::regclass
     and 'authenticated'::regrole::oid = any(polroles);
  if v_n <> 3 then
    raise exception 'ABORTADO: esperava 3 policies para authenticated, encontrei %.', v_n;
  end if;

  raise notice 'Saida OK: anon sem privilegio; authenticated e service_role intactos; 3 policies restritas a authenticated.';
end
$saida$;


-- =====================================================================
-- VERIFICACOES APOS APLICAR (rodar como SELECT)
-- =====================================================================
--
-- (a) ACL:
--     select has_table_privilege('anon','public.token_inter','SELECT') as anon_le,
--            has_table_privilege('authenticated','public.token_inter','SELECT') as auth_le,
--            has_table_privilege('service_role','public.token_inter','SELECT') as service_le;
--     -- esperado: false | true | true
--
-- (b) policies:
--     select polname, polcmd, polroles::regrole[] from pg_policy
--      where polrelid='public.token_inter'::regclass order by polname;
--     -- esperado: as 3, todas com {authenticated}
--
-- (c) requisicao anonima (com a anon key do .env.local) deve parar de devolver dados:
--     GET /rest/v1/token_inter?select=id  ->  401/permission denied, nunca linhas
--
-- (d) os fluxos do Inter seguem operando: service_role tem rolbypassrls,
--     select rolname, rolbypassrls from pg_roles where rolname='service_role';
--     -- esperado: true
--
--
-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Devolve exatamente o estado anterior: os 4 grants de anon e as 3 policies
-- PUBLIC com os mesmos predicados. So rodar se algo de fato quebrar — o estado
-- que ele restaura e o que expunha o token bancario a leitura anonima.
--
-- begin;
--   grant select, insert, update, delete on table public.token_inter to anon;
--
--   drop policy if exists "Permitir leitura do token"     on public.token_inter;
--   drop policy if exists "Permitir inserção do token"    on public.token_inter;
--   drop policy if exists "Permitir atualização do token" on public.token_inter;
--
--   create policy "Permitir leitura do token"
--     on public.token_inter for select using (true);
--   create policy "Permitir inserção do token"
--     on public.token_inter for insert with check (true);
--   create policy "Permitir atualização do token"
--     on public.token_inter for update using (true);
-- commit;
-- =====================================================================
