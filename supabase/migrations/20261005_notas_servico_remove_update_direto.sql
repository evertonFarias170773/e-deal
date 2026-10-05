-- ============================================================================
-- NFS-e: sai o UPDATE direto de notas_servico (passo 2b do plano de 05/10)
-- ============================================================================
--
-- O QUE MUDA
--   Remove a policy `notas_servico_update_authenticated`
--   (FOR UPDATE TO authenticated USING (true) WITH CHECK (true)), que deixava
--   QUALQUER usuario logado alterar qualquer nota de servico direto pela API.
--
-- POR QUE AGORA PODE
--   O unico uso legitimo era a reserva da emissao em `/api/fiscal/emitir-nfse`.
--   Desde 1d60921 a rota reserva por `fn_reservar_emissao_nfse`, que confere
--   `fiscal.emit_nfse` e e SECURITY DEFINER — nao depende desta policy.
--   Provado antes desta migration, em transacao desfeita: sem a permissao a
--   funcao recusa; com ela reserva; repetir nao reserva de novo; o autor
--   aparece em `audit.logs_v2`.
--
-- O QUE NAO MUDA
--   RLS segue LIGADO. A policy de leitura `notas_servico_select_authenticated`
--   fica. Nenhum grant, nenhuma funcao, nenhum dado. O n8n grava como
--   service_role, que ignora RLS, e nao e afetado. `notas_fiscais` (NF-e) nao e
--   tocada.
--
--   Sem policy de UPDATE, um UPDATE direto de usuario logado nao da erro: o RLS
--   simplesmente nao deixa nenhuma linha casar, e zero linhas sao alteradas.
--
-- TRAVAS
--   a) a policy existe e e exatamente a esperada (so entao e removida);
--   b) a funcao de reserva existe;
--   c) depois: so a policy de leitura sobrou, RLS ligado, e o md5 das linhas
--      de `notas_servico` e identico (a migration nao toca dados).
--
-- ROLLBACK (recria a policy exatamente como estava)
--   create policy notas_servico_update_authenticated on public.notas_servico
--     for update to authenticated using (true) with check (true);
-- ============================================================================

do $migracao$
declare
  v_md5_antes  text;
  v_md5_depois text;
  v_restou     text;
begin
  -- a) a policy e exatamente a que se espera
  if not exists (
    select 1 from pg_policy
     where polrelid = 'public.notas_servico'::regclass
       and polname = 'notas_servico_update_authenticated'
       and polcmd = 'w'
       and polpermissive
       and polroles::regrole[]::text = '{authenticated}'
       and pg_get_expr(polqual, polrelid) = 'true'
       and pg_get_expr(polwithcheck, polrelid) = 'true'
  ) then
    raise exception 'a policy notas_servico_update_authenticated nao existe ou nao e a esperada. Abortado.';
  end if;

  -- b) a funcao que a substitui existe
  if to_regprocedure('public.fn_reservar_emissao_nfse(uuid, text, integer)') is null then
    raise exception 'fn_reservar_emissao_nfse nao existe: aplique 20261005_fn_reservar_emissao_nfse antes';
  end if;

  select md5(string_agg(md5(to_jsonb(n)::text), ',' order by n.id)) into v_md5_antes from public.notas_servico n;

  drop policy notas_servico_update_authenticated on public.notas_servico;

  -- c) conferencias
  select string_agg(polname::text || ':' || polcmd::text, ',' order by polname) into v_restou
    from pg_policy where polrelid = 'public.notas_servico'::regclass;
  if v_restou is distinct from 'notas_servico_select_authenticated:r' then
    raise exception 'policies inesperadas em notas_servico depois da remocao: %', v_restou;
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.notas_servico'::regclass) then
    raise exception 'RLS de notas_servico nao esta ligado';
  end if;

  select md5(string_agg(md5(to_jsonb(n)::text), ',' order by n.id)) into v_md5_depois from public.notas_servico n;
  if v_md5_depois is distinct from v_md5_antes then
    raise exception 'as linhas de notas_servico mudaram (% -> %)', v_md5_antes, v_md5_depois;
  end if;

  raise notice 'ok: UPDATE direto removido de notas_servico; dados intactos (md5 %)', v_md5_depois;
end
$migracao$;
