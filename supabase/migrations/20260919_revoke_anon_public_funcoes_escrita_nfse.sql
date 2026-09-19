-- ============================================================================
-- NFS-e: as cinco funcoes de ESCRITA param de aceitar anon e PUBLIC
-- ============================================================================
--
-- O QUE MUDA
--   EXECUTE revogado de `anon` e de `PUBLIC` em:
--     fn_criar_rascunho_nfse, fn_clonar_rascunho_nfse, fn_trocar_empresa_nfse,
--     fn_nfse_recalcular_totais, fn_preparar_envio_nfse.
--   `authenticated` e `service_role` seguem podendo executar as cinco.
--   `fn_alertas_nfse` e `fn_montar_payload_nfse` NAO sao tocadas: elas ja nao
--   tem esses grants, e a migration exige que continuem exatamente como estao.
--
-- POR QUE
--   As cinco sao SECURITY DEFINER e escrevem em `notas_servico`. Com EXECUTE
--   para `anon`, qualquer um com a chave anonima — que o app publica no browser
--   por natureza — criava rascunho, trocava a empresa emitente e disparava
--   `fn_preparar_envio_nfse`, que grava payload, muda status e incrementa
--   `tentativas_envio`. Nao e teoria: as notas de maio chegaram a OITO
--   tentativas.
--
--   Nesta mesma rodada nasceu `/api/fiscal/emitir-nfse`, que exige sessao,
--   permissao `fiscal.emit_nfse` e compare-and-swap. Uma porta so fecha quando
--   a janela do lado fecha junto.
--
-- POR QUE O REVOKE E NOMINAL
--   O ACL destas cinco tem DUAS concessoes que abrem o caminho: `anon=X` (grant
--   nominal) e `=X` (PUBLIC). `REVOKE ... FROM PUBLIC` derruba so a segunda: o
--   grant nominal a `anon` sobrevive, e `anon` continua executando. Por isso o
--   REVOKE nomeia os dois.
--
--   O default privilege de hoje em `public` para funcoes do dono `postgres` ja
--   e `postgres | authenticated | service_role` — sem anon e sem PUBLIC. Ou
--   seja: funcao NOVA nasce fechada, e estas cinco carregavam o padrao antigo.
--
-- O QUE FOI CONFERIDO ANTES (nenhum caminho vivo depende de anon)
--   - `nfse.service.ts` nao tem uma escrita sequer: nenhum insert, update,
--     delete, upsert, rpc ou fetch. So `getNfseReadOnlyList`.
--   - Nenhuma tela chama estas funcoes; nao existe tela de NFS-e.
--   - No n8n, TODOS os nos que falam com o Supabase usam `service_role` —
--     inclusive `Supabase - Preparar Envio NFS-e`, que chama
--     `rpc/fn_preparar_envio_nfse` com corpo `{ "p_ref": ... }`. Conferido pela
--     claim `role` da chave, sem ler a chave.
--   - Nenhuma Edge Function menciona NFS-e.
--
-- ROLLBACK (devolve exatamente o que foi tirado)
--   grant execute on function public.fn_criar_rascunho_nfse(bigint, bigint, bigint, bigint, numeric, text, text) to anon, public;
--   grant execute on function public.fn_clonar_rascunho_nfse(text, text)     to anon, public;
--   grant execute on function public.fn_trocar_empresa_nfse(text, integer, text) to anon, public;
--   grant execute on function public.fn_nfse_recalcular_totais(text)         to anon, public;
--   grant execute on function public.fn_preparar_envio_nfse(text)            to anon, public;
--
-- METODO
--   O REVOKE e montado por `oid::regprocedure`, e nao por assinatura escrita a
--   mao: assim uma sobrecarga que exista hoje ou apareca depois entra junto, e
--   nao ha como errar um tipo. As assercoes conferem o ACL das SETE funcoes
--   antes e depois.
-- ============================================================================

do $migracao$
declare
  v_antes         jsonb;
  v_depois        jsonb;
  v_intocadas_a   jsonb;
  v_intocadas_d   jsonb;
  v_sobrou        text;
  v_faltou        text;
  v_alvo          record;
  v_quantas       int;
  alvos           text[] := array[
    'fn_criar_rascunho_nfse',
    'fn_clonar_rascunho_nfse',
    'fn_trocar_empresa_nfse',
    'fn_nfse_recalcular_totais',
    'fn_preparar_envio_nfse'
  ];
  intocadas       text[] := array['fn_alertas_nfse', 'fn_montar_payload_nfse'];
begin
  -- ==========================================================================
  -- 0. O ANTES — quem pode executar cada uma das sete
  -- ==========================================================================
  select jsonb_object_agg(x.proname, x.quem) into v_antes
    from (
      select p.proname,
             (select array_agg(coalesce(nullif(a.grantee::regrole::text, '-'), 'PUBLIC')
                     order by coalesce(nullif(a.grantee::regrole::text, '-'), 'PUBLIC'))
                from aclexplode(p.proacl) a
               where a.privilege_type = 'EXECUTE') as quem
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any(alvos || intocadas)
    ) x;

  select jsonb_object_agg(x.proname, x.quem) into v_intocadas_a
    from (
      select p.proname,
             (select array_agg(coalesce(nullif(a.grantee::regrole::text, '-'), 'PUBLIC')
                     order by coalesce(nullif(a.grantee::regrole::text, '-'), 'PUBLIC'))
                from aclexplode(p.proacl) a
               where a.privilege_type = 'EXECUTE') as quem
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any(intocadas)
    ) x;

  raise notice 'ACL antes: %', v_antes;

  -- ==========================================================================
  -- 1. O REVOKE, nominal, por oid
  -- ==========================================================================
  v_quantas := 0;
  for v_alvo in
    select p.oid::regprocedure as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any(alvos)
  loop
    execute format('revoke execute on function %s from anon', v_alvo.assinatura);
    execute format('revoke execute on function %s from public', v_alvo.assinatura);
    v_quantas := v_quantas + 1;
  end loop;

  if v_quantas <> array_length(alvos, 1) then
    raise exception 'esperava % funcoes alvo, encontrei %', array_length(alvos, 1), v_quantas;
  end if;

  -- ==========================================================================
  -- 2. ASSERCOES
  -- ==========================================================================
  select jsonb_object_agg(x.proname, x.quem) into v_depois
    from (
      select p.proname,
             (select array_agg(coalesce(nullif(a.grantee::regrole::text, '-'), 'PUBLIC')
                     order by coalesce(nullif(a.grantee::regrole::text, '-'), 'PUBLIC'))
                from aclexplode(p.proacl) a
               where a.privilege_type = 'EXECUTE') as quem
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any(alvos || intocadas)
    ) x;

  -- 2.1 Nenhuma das cinco aceita mais anon ou PUBLIC.
  select string_agg(p.proname || ' -> ' || a.grantee::regrole::text, ', ') into v_sobrou
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace,
         lateral aclexplode(p.proacl) a
   where n.nspname = 'public' and p.proname = any(alvos)
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text = 'anon');
  if v_sobrou is not null then
    raise exception 'assercao 1 falhou: ainda ha EXECUTE para anon ou PUBLIC em %', v_sobrou;
  end if;

  -- 2.2 authenticated e service_role continuam podendo executar as cinco.
  select string_agg(f.proname || ' sem ' || f.papel, ', ') into v_faltou
    from (
      select p.proname, papel
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace,
             unnest(array['authenticated', 'service_role']) as papel
       where n.nspname = 'public' and p.proname = any(alvos)
         and not exists (
           select 1 from aclexplode(p.proacl) a
            where a.privilege_type = 'EXECUTE'
              and a.grantee::regrole::text = papel
         )
    ) f;
  if v_faltou is not null then
    raise exception 'assercao 2 falhou: perdeu EXECUTE de quem precisa: %', v_faltou;
  end if;

  -- 2.3 As duas somente-leitura seguem byte a byte como estavam.
  select jsonb_object_agg(x.proname, x.quem) into v_intocadas_d
    from (
      select p.proname,
             (select array_agg(coalesce(nullif(a.grantee::regrole::text, '-'), 'PUBLIC')
                     order by coalesce(nullif(a.grantee::regrole::text, '-'), 'PUBLIC'))
                from aclexplode(p.proacl) a
               where a.privilege_type = 'EXECUTE') as quem
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any(intocadas)
    ) x;
  if v_intocadas_d is distinct from v_intocadas_a then
    raise exception 'assercao 3 falhou: fn_alertas_nfse / fn_montar_payload_nfse mudaram (% -> %)',
      v_intocadas_a, v_intocadas_d;
  end if;

  -- 2.4 Nenhuma funcao de NF-e foi alcancada.
  select string_agg(p.proname, ', ') into v_sobrou
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fn_montar_payload_nfe', 'fn_preparar_envio_nfe', 'fn_salvar_retorno_focus_nfe')
     and not exists (
       select 1 from aclexplode(p.proacl) a
        where a.privilege_type = 'EXECUTE' and a.grantee::regrole::text = 'authenticated'
     );
  if v_sobrou is not null then
    raise exception 'assercao 4 falhou: funcao de NF-e perdeu authenticated: %', v_sobrou;
  end if;

  raise notice 'ACL depois: %', v_depois;
end
$migracao$;
