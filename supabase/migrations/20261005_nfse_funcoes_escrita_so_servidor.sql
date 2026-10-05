-- ============================================================================
-- NFS-e: as cinco funcoes de ESCRITA deixam de aceitar usuario logado
-- (passo 3 do plano de 05/10/2026)
-- ============================================================================
--
-- O QUE MUDA
--   EXECUTE revogado de `authenticated` (e de `anon` e PUBLIC, que ja nao
--   constavam — o REVOKE os nomeia para garantir) em:
--     fn_criar_rascunho_nfse, fn_clonar_rascunho_nfse, fn_preparar_envio_nfse,
--     fn_trocar_empresa_nfse, fn_nfse_recalcular_totais.
--   Ficam `postgres` (dono) e `service_role`. NENHUM GRANT novo.
--
-- POR QUE
--   As cinco sao SECURITY DEFINER, escrevem em `notas_servico` e nao conferem
--   quem chama. Com EXECUTE para `authenticated`, qualquer usuario logado criava
--   rascunho, trocava a empresa emitente, recalculava totais e preparava o envio
--   por RPC — informando o autor que quisesse (`p_criado_por_nome`,
--   `p_usuario`). So o servidor deve chama-las.
--
-- O QUE FOI CONFERIDO ANTES (nenhum caminho vivo depende de authenticated)
--   - Banco: a unica chamada interna e `fn_clonar_rascunho_nfse` ->
--     `fn_nfse_recalcular_totais`, e a que chama e SECURITY DEFINER (roda como o
--     dono, que mantem o EXECUTE). Nenhum trigger, policy, view, valor padrao ou
--     cron cita as cinco; o trigger da tabela
--     (`tg_nfse_normalizar_recalcular_biu`) nao chama nenhuma.
--   - App: nenhuma chamada; as ocorrencias no codigo sao comentarios. A rota
--     `/api/fiscal/emitir-nfse` usa `fn_reservar_emissao_nfse`, que NAO entra
--     aqui e mantem o ACL.
--   - n8n (89 workflows): so `fn_preparar_envio_nfse`, com a chave
--     service_role.
--
-- ACL ANTES (identico nas cinco)
--   {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- ACL DEPOIS (identico nas cinco)
--   {postgres=X/postgres,service_role=X/postgres}
--
-- ROLLBACK (devolve exatamente o que foi tirado)
--   grant execute on function public.fn_criar_rascunho_nfse(bigint, bigint, bigint, bigint, numeric, text, text) to authenticated;
--   grant execute on function public.fn_clonar_rascunho_nfse(text, text)        to authenticated;
--   grant execute on function public.fn_preparar_envio_nfse(text)               to authenticated;
--   grant execute on function public.fn_trocar_empresa_nfse(text, integer, text) to authenticated;
--   grant execute on function public.fn_nfse_recalcular_totais(text)            to authenticated;
-- ============================================================================

do $migracao$
declare
  alvos        text[] := array[
    'fn_criar_rascunho_nfse',
    'fn_clonar_rascunho_nfse',
    'fn_preparar_envio_nfse',
    'fn_trocar_empresa_nfse',
    'fn_nfse_recalcular_totais'
  ];
  v_alvo       record;
  v_quantas    int;
  v_md5_antes  text;
  v_md5_depois text;
  v_reserva_a  text;
  v_reserva_d  text;
  v_ruim       text;
begin
  -- 0. O ANTES: exatamente cinco funcoes (sem sobrecarga), todas com o ACL esperado.
  select count(*) into v_quantas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any (alvos);
  if v_quantas <> 5 then
    raise exception 'esperava 5 funcoes, achei % (ha sobrecarga ou falta alguma)', v_quantas;
  end if;

  select string_agg(p.oid::regprocedure::text || ' => ' || coalesce(p.proacl::text, '(nulo)'), ' ; ') into v_ruim
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any (alvos)
     and p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}';
  if v_ruim is not null then
    raise exception 'ACL de partida diferente do lido ao escrever: %', v_ruim;
  end if;

  select md5(string_agg(md5(to_jsonb(s)::text), ',' order by s.id)) into v_md5_antes from public.notas_servico s;
  select proacl::text into v_reserva_a from pg_proc where oid = 'public.fn_reservar_emissao_nfse(uuid, text, integer)'::regprocedure;

  -- 1. So REVOKE. Nominal para anon e PUBLIC tambem: REVOKE FROM PUBLIC nao
  --    alcanca um grant nominal a anon, e o contrario tambem nao.
  for v_alvo in
    select p.oid::regprocedure as assinatura
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (alvos)
  loop
    execute format('revoke execute on function %s from authenticated, anon, public', v_alvo.assinatura);
  end loop;

  -- 2. O DEPOIS
  select string_agg(p.oid::regprocedure::text || ' => ' || coalesce(p.proacl::text, '(nulo)'), ' ; ') into v_ruim
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any (alvos)
     and p.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}';
  if v_ruim is not null then
    raise exception 'ACL final inesperado: %', v_ruim;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ') into v_ruim
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any (alvos)
     and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
       or has_function_privilege('anon', p.oid, 'EXECUTE')
       or not has_function_privilege('service_role', p.oid, 'EXECUTE'));
  if v_ruim is not null then
    raise exception 'privilegio efetivo inesperado em: %', v_ruim;
  end if;

  select proacl::text into v_reserva_d from pg_proc where oid = 'public.fn_reservar_emissao_nfse(uuid, text, integer)'::regprocedure;
  if v_reserva_d is distinct from v_reserva_a then
    raise exception 'o ACL de fn_reservar_emissao_nfse mudou (% -> %)', v_reserva_a, v_reserva_d;
  end if;

  select md5(string_agg(md5(to_jsonb(s)::text), ',' order by s.id)) into v_md5_depois from public.notas_servico s;
  if v_md5_depois is distinct from v_md5_antes then
    raise exception 'as linhas de notas_servico mudaram (% -> %)', v_md5_antes, v_md5_depois;
  end if;

  raise notice 'ok: cinco funcoes de escrita de NFS-e so para postgres e service_role';
end
$migracao$;
