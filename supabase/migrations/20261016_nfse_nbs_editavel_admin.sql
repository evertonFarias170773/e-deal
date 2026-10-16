-- ============================================================================
-- NFS-e: administrador corrige o NBS de um rascunho
-- ============================================================================
-- APLICADA EM 16/10/2026, com autorizacao nominal do dono.
--
-- POR QUE
--   O NBS da NFS-e e fixo em 121011000: `fn_criar_rascunho_nfse` nao copia o
--   NBS do servico e o gatilho `tg_nfse_normalizar_recalcular_biu` grava o
--   padrao na nota que nasce sem ele. O administrador precisa corrigir o NBS de
--   um rascunho antes de emitir.
--
-- O QUE MUDA
--   Uma funcao nova, `fn_definir_nbs_rascunho_nfse(p_id, p_codigo_nbs,
--   p_status_lido)`, chamada pela rota `/api/fiscal/rascunho-nfse` (PATCH) com o
--   token DO USUARIO — e por isso a auditoria de `notas_servico` registra o
--   autor (auth.uid()), como ja acontece em `fn_reservar_emissao_nfse`.
--   Dentro dela:
--     1. so super administrador ou administrador (`cc__assert_permissao(...,
--        '__ADMIN__')`) — a rota confere antes, e o banco confere de novo;
--     2. NBS com exatamente 9 digitos numericos;
--     3. so rascunho: status PENDENTE, PRONTA_PARA_ENVIO, ERRO_VALIDACAO ou
--        ERRO_ENVIO, sem numero de NFS-e — nunca nota autorizada, em analise,
--        recusada ou cancelada;
--     4. compare-and-swap pelo status lido: se a nota mudou desde a leitura da
--        tela, nada e gravado;
--     5. se `informacoes_complementares` ainda e so a reserva "NBS:<codigo>"
--        (texto que o gatilho poe e que o n8n nao envia), ela acompanha o NBS
--        novo. Texto escrito por alguem nunca e tocado.
--
-- O QUE NAO MUDA
--   O gatilho (ja mantem qualquer NBS em digitos; vazio e 21012200 viram
--   121011000), `fn_criar_rascunho_nfse`, a trava de servico da rota
--   (`NBS_GRAVADO_PELO_BANCO`), `fiscal.emit_nfse`, a auditoria e o n8n. O no
--   "Preparar Body Focus NFS-e" ja envia o NBS da nota quando tem 9 digitos.
--
-- EXECUTE: so `authenticated` e o dono (`postgres`). `anon`, `PUBLIC` e
--   `service_role` nao: o padrao do banco da EXECUTE a `service_role` em toda
--   funcao nova, e a rota chama com o token do usuario, entao ele sai.
--
-- ROLLBACK (no rodape)
-- ============================================================================

do $migracao$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'fn_definir_nbs_rascunho_nfse') then
    raise exception 'fn_definir_nbs_rascunho_nfse ja existe';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'cc__assert_permissao') then
    raise exception 'cc__assert_permissao nao existe';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.notas_servico'::regclass
                  and tgname = 'trg_audit_notas_servico' and tgenabled = 'O') then
    raise exception 'auditoria de notas_servico nao esta ligada';
  end if;
end
$migracao$;

create function public.fn_definir_nbs_rascunho_nfse(
  p_id uuid,
  p_codigo_nbs text,
  p_status_lido text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $funcao$
declare
  v_uid    uuid := auth.uid();
  v_nbs    text := btrim(coalesce(p_codigo_nbs, ''));
  v_antes  text;
  v_n      integer;
begin
  -- 1. So administrador, antes de qualquer leitura ou escrita.
  perform public.cc__assert_permissao(v_uid, '__ADMIN__');

  -- 2. Nove digitos, nada mais.
  if v_nbs !~ '^[0-9]{9}$' then
    return jsonb_build_object('alterada', false, 'motivo', 'NBS_INVALIDO');
  end if;

  if p_id is null or p_status_lido is null then
    raise exception 'NFSE_NBS_PARAMS: id e status lido sao obrigatorios';
  end if;

  -- 3. So rascunho (a mesma lista fechada da tela).
  if p_status_lido not in ('PENDENTE', 'PRONTA_PARA_ENVIO', 'ERRO_VALIDACAO', 'ERRO_ENVIO') then
    return jsonb_build_object('alterada', false, 'motivo', 'STATUS_NAO_EDITAVEL');
  end if;

  select n.codigo_nbs into v_antes from public.notas_servico n where n.id = p_id;
  if not found then
    return jsonb_build_object('alterada', false, 'motivo', 'NOTA_NAO_ENCONTRADA');
  end if;

  -- 4. Compare-and-swap: status igual ao lido, ainda sem numero de NFS-e.
  update public.notas_servico n
     set codigo_nbs = v_nbs,
         informacoes_complementares = case
           when coalesce(n.informacoes_complementares, '') ~* '^\s*NBS:\s*[0-9]*\s*$' then 'NBS:' || v_nbs
           else n.informacoes_complementares
         end,
         updated_at = now()
   where n.id = p_id
     and n.status = p_status_lido
     and nullif(btrim(coalesce(n.numero_nfse, '')), '') is null;
  get diagnostics v_n = row_count;

  if v_n <> 1 then
    return jsonb_build_object('alterada', false, 'motivo', 'NOTA_MUDOU');
  end if;

  return jsonb_build_object('alterada', true, 'codigo_nbs', v_nbs, 'codigo_nbs_anterior', v_antes);
end
$funcao$;

revoke all on function public.fn_definir_nbs_rascunho_nfse(uuid, text, text) from public;
revoke all on function public.fn_definir_nbs_rascunho_nfse(uuid, text, text) from anon;
revoke all on function public.fn_definir_nbs_rascunho_nfse(uuid, text, text) from service_role;
grant execute on function public.fn_definir_nbs_rascunho_nfse(uuid, text, text) to authenticated;

do $conferencia$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'fn_definir_nbs_rascunho_nfse' and p.prosecdef
  ) then
    raise exception 'fn_definir_nbs_rascunho_nfse nao ficou SECURITY DEFINER';
  end if;
  if has_function_privilege('anon', 'public.fn_definir_nbs_rascunho_nfse(uuid, text, text)', 'EXECUTE') then
    raise exception 'anon ficou com EXECUTE';
  end if;
  if not has_function_privilege('authenticated', 'public.fn_definir_nbs_rascunho_nfse(uuid, text, text)', 'EXECUTE') then
    raise exception 'authenticated ficou sem EXECUTE';
  end if;
  -- ACL exato: so o dono e authenticated (grantee 0 = PUBLIC reprova).
  if (select array_agg(distinct case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end
                       order by case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end)
        from pg_proc p, aclexplode(p.proacl) g
       where p.oid = 'public.fn_definir_nbs_rascunho_nfse(uuid, text, text)'::regprocedure)
     is distinct from array['authenticated', 'postgres'] then
    raise exception 'ACL de fn_definir_nbs_rascunho_nfse diferente de {authenticated, postgres}';
  end if;
  raise notice 'ok: fn_definir_nbs_rascunho_nfse criada';
end
$conferencia$;

-- ============================================================================
-- ROLLBACK (NAO APLICADO)
--   drop function if exists public.fn_definir_nbs_rascunho_nfse(uuid, text, text);
--   (os NBS ja gravados pela funcao ficam nas notas, com o autor na auditoria)
-- ============================================================================
