-- =====================================================================
-- Fecha o acesso ANONIMO a public.clientes e public.enderecos,
-- e o acesso de `authenticated` a public.token_inter
-- =====================================================================
--
-- O QUE
-- -----
-- 1. REVOKE ALL de `anon` em `public.clientes` e `public.enderecos`;
-- 2. recria as policies PUBLIC dessas duas tabelas restritas a `authenticated`,
--    com os MESMOS predicados, no padrao de `contatos_all_authenticated`;
-- 3. REVOKE ALL de `authenticated` em `public.token_inter`.
--
-- Nenhuma outra tabela e tocada. Nenhuma linha e lida, escrita ou apagada.
--
-- POR QUE — clientes e enderecos
-- ------------------------------
-- `public.clientes` tem **65.966 linhas** com CPF/CNPJ, e-mail, telefone,
-- WhatsApp, limite de credito e endereco de cobranca. `public.enderecos` guarda
-- o endereco fisico de cada uma delas.
--
-- As duas respondiam a requisicao ANONIMA, com escrita liberada:
--
--   clientes    GRANT anon: SELECT, INSERT, UPDATE, DELETE
--               policy `clientes_select` [SELECT] roles {-} using true
--               policy `geral`           [ALL]    roles {-} using true / check true
--
--   enderecos   GRANT anon: SELECT, INSERT, UPDATE, DELETE
--               policy `geral`           [ALL]    roles {-} using true / check true
--
-- `{-}` e PUBLIC: alcanca TODOS os papeis, `anon` incluido. E a chave `anon` do
-- Supabase vai no bundle do navegador — e publica por definicao.
--
-- Verificado em 01/09/2026, antes desta migration, com a anon key do
-- `.env.local`: GET /rest/v1/clientes e /rest/v1/enderecos -> **HTTP 200**.
--
-- O trigger `tg_controlar_delete_clientes` nao era barreira: bloqueia apenas
-- DELETE de mais de 2 linhas por statement. Sao ~33 mil requisicoes para
-- esvaziar a tabela, nao uma protecao.
--
-- POR QUE — token_inter para `authenticated`
-- ------------------------------------------
-- A migration 20260901141026 tirou o `anon` de `token_inter`, mas manteve o
-- `authenticated` como estava. `grep -rn "token_inter" src/` continua sem
-- devolver NADA: o app nunca leu essa tabela. Manter o token bancario do Inter,
-- em texto puro, legivel por qualquer usuario logado — inclusive perfis
-- `operador` e `Designer`, que so deviam ver pedido — e privilegio sem uso.
-- Quem precisa e so o n8n, por `service_role`.
--
-- POR QUE ISTO NAO QUEBRA NADA
-- ----------------------------
-- **n8n.** 17 nos tocam `clientes`/`enderecos`, entre eles o `Importar Cliente
-- Texto` (ativo), que INSERE nas duas. Todos os 17 usam a credencial
-- `Supabase e-deal`, confirmada **service_role** pelo claim `role` do JWT. E
-- `service_role` tem `rolbypassrls = true`: nem grants de `anon` nem policies
-- participam do caminho dele.
--
-- **Os 7 nos com chave `anon` literal.** Nenhum cita `clientes` ou `enderecos`
-- — sao os 6 ativos dos fluxos Focus NFe/NFSe (que tocam `notas_fiscais` e 3
-- RPCs) mais o `PDF-FATURA`, inativo.
--
-- **A aplicacao.** No navegador o `createBrowserClient` carrega a sessao, entao
-- o app opera como `authenticated`, nunca como `anon` — e `authenticated`
-- continua com os mesmos grants e os mesmos predicados. As 9 rotas de API que
-- tocam essas tabelas exigem sessao (conferidas uma a uma). Nao ha pagina fora
-- de `(erp)` que as leia. O unico ponto que usava o client de navegador dentro
-- do servidor, `gerar-boleto`, foi corrigido em 8f9c842.
--
-- O QUE ESTA MIGRATION **NAO** FECHA — leia antes de assumir que acabou
-- ---------------------------------------------------------------------
-- 14 funcoes `SECURITY DEFINER` com `EXECUTE` para `anon` referenciam
-- `clientes` ou `enderecos`:
--
--   aplicar_credito_da_view, fn_alertas_nfe, fn_alertas_nfse,
--   fn_analise_credito_cliente, fn_autopreencher_fiscal_nfe_item,
--   fn_criar_rascunho_nfe, fn_defaults_rascunho_nfe,
--   fn_lancar_movimento_credito, fn_montar_payload_nfe, fn_montar_payload_nfse,
--   fn_nfe_normalizar_destinatario_cpf, fn_trocar_destinatario_nfe,
--   link_cliente_pedido, rpc_dashboard_executivo
--
-- `SECURITY DEFINER` roda com os privilegios do DONO, entao elas seguem
-- funcionando depois deste REVOKE — que e justamente por que este REVOKE nao as
-- quebra, e tambem por que ele NAO fecha sozinho o acesso anonimo aos dados de
-- cliente. Revisar o `EXECUTE` dessas 14 e um bloco separado.
--
-- O QUE ESTA MIGRATION NAO FAZ
-- ----------------------------
-- * nao toca em boletos, pagamentos, pagamentos_v2, movimento_credito, propostas;
-- * nao altera o default privilege do schema public;
-- * nao altera grants de `service_role` em tabela alguma;
-- * nao mexe em RPC, trigger, workflow do n8n ou codigo da aplicacao;
-- * nao insere, atualiza nem apaga nenhuma linha.
-- =====================================================================

-- ------------------------------------------------------------------
-- 1. ASSERCOES DE ENTRADA
-- ------------------------------------------------------------------
do $entrada$
declare
  v_n integer;
begin
  if to_regclass('public.clientes') is null
     or to_regclass('public.enderecos') is null
     or to_regclass('public.token_inter') is null then
    raise exception 'ABORTADO: alguma das tres tabelas nao existe.';
  end if;

  if not (has_table_privilege('anon','public.clientes','SELECT')
      and has_table_privilege('anon','public.enderecos','SELECT')) then
    raise exception 'ABORTADO: anon ja NAO tem SELECT em clientes e/ou enderecos. O estado divergiu do levantamento de 01/09/2026 — refazer o diagnostico.';
  end if;

  if not has_table_privilege('authenticated','public.token_inter','SELECT') then
    raise exception 'ABORTADO: authenticated ja NAO tem SELECT em token_inter.';
  end if;

  -- as 3 policies PUBLIC que serao recriadas
  select count(*) into v_n
    from pg_policy
   where polrelid in ('public.clientes'::regclass, 'public.enderecos'::regclass)
     and polroles = '{0}'::oid[];
  if v_n <> 3 then
    raise exception 'ABORTADO: esperava 3 policies PUBLIC (clientes_select, geral em clientes, geral em enderecos), encontrei %.', v_n;
  end if;

  raise notice 'Entrada OK: anon com SELECT nas duas, authenticated com SELECT em token_inter, 3 policies PUBLIC a recriar.';
end
$entrada$;

-- ------------------------------------------------------------------
-- 2. OS REVOKES
-- ------------------------------------------------------------------
revoke all on table public.clientes    from anon;
revoke all on table public.enderecos   from anon;
revoke all on table public.token_inter from authenticated;

-- ------------------------------------------------------------------
-- 3. As policies PUBLIC viram policies de `authenticated`, com os MESMOS
--    predicados. O que o app autenticado enxerga nao muda.
--
--    `clientes_select` [SELECT using true] e redundante com `geral` [ALL],
--    que ja cobre SELECT — mas e recriada assim mesmo, para o estado depois
--    espelhar o de antes e o rollback ser simetrico.
-- ------------------------------------------------------------------
drop policy if exists "clientes_select" on public.clientes;
drop policy if exists "geral"           on public.clientes;
drop policy if exists "geral"           on public.enderecos;

create policy "clientes_select"
  on public.clientes for select to authenticated
  using (true);

create policy "geral"
  on public.clientes for all to authenticated
  using (true) with check (true);

create policy "geral"
  on public.enderecos for all to authenticated
  using (true) with check (true);

-- ------------------------------------------------------------------
-- 4. ASSERCOES DE SAIDA
-- ------------------------------------------------------------------
do $saida$
declare
  v_n integer;
begin
  -- 4.1 anon zerado em clientes e enderecos
  if has_table_privilege('anon','public.clientes','SELECT')
     or has_table_privilege('anon','public.clientes','INSERT')
     or has_table_privilege('anon','public.clientes','UPDATE')
     or has_table_privilege('anon','public.clientes','DELETE')
     or has_table_privilege('anon','public.enderecos','SELECT')
     or has_table_privilege('anon','public.enderecos','INSERT')
     or has_table_privilege('anon','public.enderecos','UPDATE')
     or has_table_privilege('anon','public.enderecos','DELETE')
  then
    raise exception 'ABORTADO: anon ainda tem privilegio em clientes e/ou enderecos.';
  end if;

  -- 4.2 authenticated zerado em token_inter
  if has_table_privilege('authenticated','public.token_inter','SELECT')
     or has_table_privilege('authenticated','public.token_inter','INSERT')
     or has_table_privilege('authenticated','public.token_inter','UPDATE')
     or has_table_privilege('authenticated','public.token_inter','DELETE')
  then
    raise exception 'ABORTADO: authenticated ainda tem privilegio em token_inter.';
  end if;

  -- 4.3 authenticated INTACTO em clientes e enderecos
  if not (has_table_privilege('authenticated','public.clientes','SELECT')
      and has_table_privilege('authenticated','public.clientes','INSERT')
      and has_table_privilege('authenticated','public.clientes','UPDATE')
      and has_table_privilege('authenticated','public.enderecos','SELECT')
      and has_table_privilege('authenticated','public.enderecos','INSERT')
      and has_table_privilege('authenticated','public.enderecos','UPDATE')) then
    raise exception 'ABORTADO: authenticated perdeu privilegio em clientes/enderecos.';
  end if;

  -- 4.4 service_role intacto nas tres
  if not (has_table_privilege('service_role','public.clientes','SELECT')
      and has_table_privilege('service_role','public.enderecos','SELECT')
      and has_table_privilege('service_role','public.token_inter','SELECT')
      and has_table_privilege('service_role','public.clientes','UPDATE')
      and has_table_privilege('service_role','public.enderecos','UPDATE')
      and has_table_privilege('service_role','public.token_inter','UPDATE')) then
    raise exception 'ABORTADO: service_role perdeu privilegio.';
  end if;

  -- 4.5 nenhuma policy das tres alcanca mais PUBLIC ou anon
  select count(*) into v_n
    from pg_policy
   where polrelid in ('public.clientes'::regclass, 'public.enderecos'::regclass, 'public.token_inter'::regclass)
     and (polroles = '{0}'::oid[] or 'anon'::regrole::oid = any(polroles));
  if v_n <> 0 then
    raise exception 'ABORTADO: % policy(s) ainda alcancam PUBLIC ou anon.', v_n;
  end if;

  -- 4.6 as 3 policies recriadas existem, para authenticated
  select count(*) into v_n
    from pg_policy
   where polrelid in ('public.clientes'::regclass, 'public.enderecos'::regclass)
     and 'authenticated'::regrole::oid = any(polroles);
  if v_n <> 3 then
    raise exception 'ABORTADO: esperava 3 policies para authenticated, encontrei %.', v_n;
  end if;

  raise notice 'Saida OK: anon zerado em clientes/enderecos; authenticated zerado em token_inter e intacto nas outras duas; service_role intacto; 3 policies restritas a authenticated.';
end
$saida$;


-- =====================================================================
-- VERIFICACOES APOS APLICAR (rodar como SELECT)
-- =====================================================================
--
-- (a) ACL das tres:
--     select t.relname,
--            has_table_privilege('anon', t.oid,'SELECT') as anon,
--            has_table_privilege('authenticated', t.oid,'SELECT') as auth,
--            has_table_privilege('service_role', t.oid,'SELECT') as service
--       from pg_class t join pg_namespace n on n.oid=t.relnamespace
--      where n.nspname='public' and t.relname in ('clientes','enderecos','token_inter');
--     -- esperado: clientes false|true|true ; enderecos false|true|true ; token_inter false|false|true
--
-- (b) policies: todas com {authenticated}, nenhuma com {-}
--     select t.relname, p.polname, p.polroles::regrole[] from pg_policy p
--       join pg_class t on t.oid=p.polrelid
--      where t.relname in ('clientes','enderecos','token_inter') order by 1,2;
--
-- (c) pelo PostgREST:
--     anon          -> clientes 401, enderecos 401, token_inter 401
--     authenticated -> clientes 200, enderecos 200, token_inter 403
--       (403 e nao 401: o PostgREST devolve 401 para requisicao anonima e 403
--        para JWT valido sem privilegio. Medido em 01/09/2026.)
--     service_role  -> as tres 200
--
--
-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Devolve exatamente o estado anterior. So rodar se algo de fato quebrar — o
-- estado que ele restaura e o que expunha 65.966 cadastros com CPF/CNPJ a
-- leitura e escrita anonimas.
--
-- begin;
--   grant select, insert, update, delete on table public.clientes    to anon;
--   grant select, insert, update, delete on table public.enderecos   to anon;
--   grant select, insert, update, delete on table public.token_inter to authenticated;
--
--   drop policy if exists "clientes_select" on public.clientes;
--   drop policy if exists "geral"           on public.clientes;
--   drop policy if exists "geral"           on public.enderecos;
--
--   create policy "clientes_select" on public.clientes for select using (true);
--   create policy "geral"           on public.clientes for all using (true) with check (true);
--   create policy "geral"           on public.enderecos for all using (true) with check (true);
-- commit;
--
-- Para devolver so o token_inter a `authenticated`, sem reabrir o resto:
--   grant select, insert, update, delete on table public.token_inter to authenticated;
-- =====================================================================
