-- ============================================================================
-- NF-e: telefone do destinatario no payload (20/10/2026)
-- ============================================================================
-- APLICADA EM 20/10/2026 (19:07 UTC), com autorizacao nominal do dono, so esta migration.
--
-- POR QUE
--   O campo FONE/FAX do destinatario saia vazio no DANFE (NF 41170, E3 Brindes,
--   NFE-23936-001) e as transportadoras exigem o dado. `fn_montar_payload_nfe`
--   nao mandava telefone nenhum, embora o cadastro tivesse. O n8n repassa o
--   payload inteiro a Focus, e a Focus aceita `telefone_destinatario` (tag
--   `fone` do destinatario, opcional, 6 a 14 digitos).
--
-- O QUE MUDA
--   1. Funcao nova `fn_nfe_fone_valido(text)`: so digitos; tira o 55 da frente
--      (12 ou 13 digitos) ou o 0 de longa distancia (11 ou 12); aceita so 10
--      ou 11 digitos com DDD valido (dois primeiros de 1 a 9). Qualquer outra
--      coisa (nome, "NULL", numero sem DDD) devolve nulo.
--   2. `fn_montar_payload_nfe` ganha, logo depois do e-mail e no MESMO padrao
--      (jsonb_strip_nulls isolado), a chave `telefone_destinatario`:
--        - ordem whatsapp_1, telefone_fixo, whatsapp_2 do pagador (nf.id_cliente);
--          vence o primeiro que `fn_nfe_fone_valido` aceita;
--        - SO na nota de venda: com `tipo_nota = 'REMESSA'` a chave nao entra,
--          porque ali o destinatario e quem recebe, nao o pagador;
--        - sem telefone valido a chave e omitida e o payload sai IGUAL ao de antes.
--
-- O QUE NAO MUDA
--   Impostos, CFOP, natureza, serie, NFS-e, n8n, cadastros e notas ja emitidas.
--   O ACL de `fn_montar_payload_nfe` (CREATE OR REPLACE preserva). Quem chama:
--   fn_preparar_envio_nfe (grava o payload), fn_alertas_nfe (le duas chaves de
--   inscricao e consumidor final), a rota emitir-nfe e nfe.service.ts. Nenhum
--   deles depende da AUSENCIA de chave.
--
-- TECNICA: troca ANCORADA sobre o corpo vivo (pg_get_functiondef), como a
--   20260930_payload_nfe_codigo_municipio. Travas:
--   a) md5(prosrc) igual ao lido ao escrever (50f9fc9bd2a62f4698e57f042532d18b)
--      e fn_nfe_fone_valido ainda nao existe;
--   b) a ancora aparece uma vez; desfeita a troca, o texto volta exatamente;
--   c) ACL de fn_montar_payload_nfe igual antes e depois; fn_nfe_fone_valido so
--      com o dono (nem PUBLIC, nem anon);
--   d) o payload de TODAS as notas, montado antes e depois (sem as duas datas,
--      que sao now()), so difere pela chave nova, e so em nota que nao e remessa.
--
-- APLICACAO (20/10/2026, 19:07 UTC): a chamada do MCP estourou o tempo de
--   espera, mas a transacao terminou e foi gravada (schema_migrations
--   20261020190712). Como qualquer trava acima aborta a transacao inteira,
--   ter gravado prova que as quatro passaram, sobre as 555 notas. Uma segunda
--   chamada, feita antes de se saber disso, parou na trava (a) — md5 ja novo —
--   e nao mudou nada.
--
-- ROLLBACK (no rodape)
-- ============================================================================

do $migracao$
declare
  v_def          text;
  v_nova         text;
  v_volta        text;
  v_nl           text;
  v_md5_antes    text;
  v_md5_depois   text;
  v_acl_antes    text;
  v_acl_depois   text;
  v_acl_fone     text;
  v_ocorrencias  integer;
  v_total        integer;
  v_com_tel      integer;
  v_outras       integer;
  v_remessa_tel  integer;
  de_1           text;
  para_1         text;
begin
  -- a) estado de partida
  select pg_get_functiondef(p.oid), md5(p.prosrc),
         (select array_agg(case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end || '=' || g.privilege_type order by 1)::text
            from aclexplode(p.proacl) g)
    into v_def, v_md5_antes, v_acl_antes
    from pg_proc p where p.oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;
  if v_md5_antes <> '50f9fc9bd2a62f4698e57f042532d18b' then
    raise exception 'fn_montar_payload_nfe mudou desde que esta migration foi escrita (md5 %). Abortado.', v_md5_antes;
  end if;
  if exists (select 1 from pg_proc where proname = 'fn_nfe_fone_valido') then
    raise exception 'fn_nfe_fone_valido ja existe. Abortado.';
  end if;

  -- 1. a validacao do telefone
  execute $f$
    create function public.fn_nfe_fone_valido(p_valor text)
    returns text
    language plpgsql
    immutable
    set search_path to 'public'
    as $corpo$
    declare
      d text := regexp_replace(coalesce(p_valor, ''), '\D', '', 'g');
    begin
      -- DDI 55 na frente (12 ou 13 digitos) ou o 0 de longa distancia (11 ou 12)
      if length(d) in (12, 13) and left(d, 2) = '55' then
        d := substr(d, 3);
      elsif length(d) in (11, 12) and left(d, 1) = '0' then
        d := substr(d, 2);
      end if;
      -- DDD (dois digitos de 1 a 9) + 8 ou 9 digitos
      if d ~ '^[1-9][1-9][0-9]{8,9}$' then
        return d;
      end if;
      return null;
    end
    $corpo$
  $f$;
  revoke all on function public.fn_nfe_fone_valido(text) from public;
  revoke all on function public.fn_nfe_fone_valido(text) from anon;
  revoke all on function public.fn_nfe_fone_valido(text) from authenticated;
  revoke all on function public.fn_nfe_fone_valido(text) from service_role;

  -- d) o payload de todas as notas ANTES (sem as datas, que sao now())
  create temp table _payload_antes on commit drop as
    select nf.ref, upper(coalesce(nf.tipo_nota, '')) as tipo,
           public.fn_montar_payload_nfe(nf.ref) - 'data_emissao' - 'data_entrada_saida' as j
      from public.notas_fiscais nf;

  -- 2. a troca ancorada: o bloco do telefone entra logo depois do e-mail
  v_nl := case when position(chr(13) in v_def) > 0 then chr(13) || chr(10) else chr(10) end;

  de_1 := $x$      ))$x$ || v_nl || v_nl
       || $x$      ||$x$ || v_nl || v_nl
       || $x$      -- =====================================================$x$ || v_nl
       || $x$      -- Transportadora$x$;
  para_1 := $x$      ))$x$ || v_nl || v_nl
       || $x$      ||$x$ || v_nl || v_nl
       || $x$      -- =====================================================$x$ || v_nl
       || $x$      -- Telefone do destinatario (20/10/2026)$x$ || v_nl
       || $x$      --$x$ || v_nl
       || $x$      -- O DANFE saia sem FONE/FAX do destinatario (NF 41170) e as$x$ || v_nl
       || $x$      -- transportadoras exigem o dado. Ordem do pagador: whatsapp_1,$x$ || v_nl
       || $x$      -- telefone_fixo, whatsapp_2; vence o primeiro que$x$ || v_nl
       || $x$      -- fn_nfe_fone_valido aceita (10 ou 11 digitos, com DDD).$x$ || v_nl
       || $x$      -- SO NA NOTA DE VENDA: na REMESSA o destinatario e quem recebe,$x$ || v_nl
       || $x$      -- e o telefone do pagador nao e dele.$x$ || v_nl
       || $x$      -- Sem telefone valido a chave e OMITIDA (strip_nulls isolado,$x$ || v_nl
       || $x$      -- como o e-mail) e o payload sai exatamente como antes.$x$ || v_nl
       || $x$      -- =====================================================$x$ || v_nl
       || $x$      jsonb_strip_nulls(jsonb_build_object($x$ || v_nl
       || $x$        'telefone_destinatario',$x$ || v_nl
       || $x$        case when upper(coalesce(nf.tipo_nota, '')) <> 'REMESSA' then$x$ || v_nl
       || $x$          coalesce($x$ || v_nl
       || $x$            public.fn_nfe_fone_valido(c.whatsapp_1),$x$ || v_nl
       || $x$            public.fn_nfe_fone_valido(c.telefone_fixo),$x$ || v_nl
       || $x$            public.fn_nfe_fone_valido(c.whatsapp_2)$x$ || v_nl
       || $x$          )$x$ || v_nl
       || $x$        end$x$ || v_nl
       || $x$      ))$x$ || v_nl || v_nl
       || $x$      ||$x$ || v_nl || v_nl
       || $x$      -- =====================================================$x$ || v_nl
       || $x$      -- Transportadora$x$;

  v_ocorrencias := (length(v_def) - length(replace(v_def, de_1, ''))) / length(de_1);
  if v_ocorrencias <> 1 then
    raise exception 'a ancora aparece % vezes', v_ocorrencias;
  end if;

  v_nova  := replace(v_def, de_1, para_1);
  v_volta := replace(v_nova, para_1, de_1);
  if v_volta <> v_def then
    raise exception 'a troca alcancou algo alem da ancora';
  end if;

  execute v_nova;

  -- c) ACL igual e a funcao nova so com o dono
  select md5(p.prosrc),
         (select array_agg(case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end || '=' || g.privilege_type order by 1)::text
            from aclexplode(p.proacl) g)
    into v_md5_depois, v_acl_depois
    from pg_proc p where p.oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;
  if v_acl_depois is distinct from v_acl_antes then
    raise exception 'ACL de fn_montar_payload_nfe mudou: % -> %', v_acl_antes, v_acl_depois;
  end if;
  select (select array_agg(case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end order by 1)::text
            from aclexplode(p.proacl) g)
    into v_acl_fone
    from pg_proc p where p.oid = 'public.fn_nfe_fone_valido(text)'::regprocedure;
  if v_acl_fone is distinct from '{postgres}' then
    raise exception 'ACL de fn_nfe_fone_valido diferente de {postgres}: %', v_acl_fone;
  end if;

  -- d) depois: so a chave nova, e so fora da remessa
  select count(*),
         count(*) filter (where (public.fn_montar_payload_nfe(a.ref) - 'data_emissao' - 'data_entrada_saida') ? 'telefone_destinatario'),
         count(*) filter (where (public.fn_montar_payload_nfe(a.ref) - 'data_emissao' - 'data_entrada_saida' - 'telefone_destinatario')
                                is distinct from (a.j - 'telefone_destinatario')),
         count(*) filter (where a.tipo = 'REMESSA'
                            and (public.fn_montar_payload_nfe(a.ref)) ? 'telefone_destinatario')
    into v_total, v_com_tel, v_outras, v_remessa_tel
    from _payload_antes a;
  if v_outras <> 0 then
    raise exception '% notas mudaram alem do telefone', v_outras;
  end if;
  if v_remessa_tel <> 0 then
    raise exception '% notas de remessa ganharam telefone', v_remessa_tel;
  end if;
  if exists (select 1 from _payload_antes a where a.j ? 'telefone_destinatario') then
    raise exception 'havia payload com telefone_destinatario antes da troca';
  end if;

  raise notice 'fn_montar_payload_nfe: md5 % -> % | % notas, % ganham o telefone, 0 com outra diferenca, 0 remessas | ACL %',
    v_md5_antes, v_md5_depois, v_total, v_com_tel, v_acl_depois;
end
$migracao$;

-- ============================================================================
-- ROLLBACK (NAO APLICADO) — o mesmo bloco esta em
-- supabase/manutencao/nfe-telefone-destinatario-rollback/rollback.sql
-- ============================================================================
-- -- ROLLBACK de 20261020_fn_montar_payload_nfe_telefone_destinatario (NAO APLICADO).
-- -- Volta fn_montar_payload_nfe ao corpo anterior (confere o md5 50f9fc9b...) e
-- -- apaga fn_nfe_fone_valido. Rodar so com ordem do dono.
-- do $volta$
-- declare
--   v_def text; v_nl text; de_1 text; para_1 text; v_md5 text; v_n integer;
-- begin
--   select pg_get_functiondef('public.fn_montar_payload_nfe(text)'::regprocedure) into v_def;
--   v_nl := case when position(chr(13) in v_def) > 0 then chr(13) || chr(10) else chr(10) end;
--   de_1 := $x$      ))$x$ || v_nl || v_nl
--        || $x$      ||$x$ || v_nl || v_nl
--        || $x$      -- =====================================================$x$ || v_nl
--        || $x$      -- Transportadora$x$;
--   para_1 := $x$      ))$x$ || v_nl || v_nl
--        || $x$      ||$x$ || v_nl || v_nl
--        || $x$      -- =====================================================$x$ || v_nl
--        || $x$      -- Telefone do destinatario (20/10/2026)$x$ || v_nl
--        || $x$      --$x$ || v_nl
--        || $x$      -- O DANFE saia sem FONE/FAX do destinatario (NF 41170) e as$x$ || v_nl
--        || $x$      -- transportadoras exigem o dado. Ordem do pagador: whatsapp_1,$x$ || v_nl
--        || $x$      -- telefone_fixo, whatsapp_2; vence o primeiro que$x$ || v_nl
--        || $x$      -- fn_nfe_fone_valido aceita (10 ou 11 digitos, com DDD).$x$ || v_nl
--        || $x$      -- SO NA NOTA DE VENDA: na REMESSA o destinatario e quem recebe,$x$ || v_nl
--        || $x$      -- e o telefone do pagador nao e dele.$x$ || v_nl
--        || $x$      -- Sem telefone valido a chave e OMITIDA (strip_nulls isolado,$x$ || v_nl
--        || $x$      -- como o e-mail) e o payload sai exatamente como antes.$x$ || v_nl
--        || $x$      -- =====================================================$x$ || v_nl
--        || $x$      jsonb_strip_nulls(jsonb_build_object($x$ || v_nl
--        || $x$        'telefone_destinatario',$x$ || v_nl
--        || $x$        case when upper(coalesce(nf.tipo_nota, '')) <> 'REMESSA' then$x$ || v_nl
--        || $x$          coalesce($x$ || v_nl
--        || $x$            public.fn_nfe_fone_valido(c.whatsapp_1),$x$ || v_nl
--        || $x$            public.fn_nfe_fone_valido(c.telefone_fixo),$x$ || v_nl
--        || $x$            public.fn_nfe_fone_valido(c.whatsapp_2)$x$ || v_nl
--        || $x$          )$x$ || v_nl
--        || $x$        end$x$ || v_nl
--        || $x$      ))$x$ || v_nl || v_nl
--        || $x$      ||$x$ || v_nl || v_nl
--        || $x$      -- =====================================================$x$ || v_nl
--        || $x$      -- Transportadora$x$;
--   v_n := (length(v_def) - length(replace(v_def, para_1, ''))) / length(para_1);
--   if v_n <> 1 then raise exception 'o bloco do telefone aparece % vezes', v_n; end if;
--   execute replace(v_def, para_1, de_1);
--   select md5(prosrc) into v_md5 from pg_proc where oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;
--   if v_md5 <> '50f9fc9bd2a62f4698e57f042532d18b' then
--     raise exception 'o corpo nao voltou ao anterior (md5 %)', v_md5;
--   end if;
--   drop function public.fn_nfe_fone_valido(text);
--   raise notice 'rollback ok: fn_montar_payload_nfe de volta (md5 %), fn_nfe_fone_valido apagada', v_md5;
-- end
-- $volta$;
-- ============================================================================
