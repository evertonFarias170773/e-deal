-- ============================================================================
-- NF-e: e-mail do destinatario na chave que a Focus le (15/11/2026)
-- ============================================================================
-- AUTORIZADA pelo Everton em 15/11/2026, so esta migration em fn_montar_payload_nfe.
--
-- POR QUE
--   A NF-e saia sem e-mail do destinatario: `fn_montar_payload_nfe` punha o
--   e-mail na chave `email`, e a Focus so le `email_destinatario` (tag `email`
--   do destinatario; "o destinatario recebera um e-mail com o XML e a DANFE").
--   Na semana de 08 a 15/11, 339 das 346 notas autorizadas tinham e-mail no
--   payload e nenhuma o levou ao XML (conferido em 3 XMLs, um por empresa).
--   A NFS-e ja usa `email_tomador` e nao muda.
--
-- O QUE MUDA
--   So o nome da chave: `'email'` vira `'email_destinatario'`. A regra do valor
--   fica igual: email_financeiro do pagador valido, senao email valido; sem
--   e-mail valido a chave e omitida (jsonb_strip_nulls isolado), como antes.
--
-- O QUE NAO MUDA
--   O resto da funcao, impostos, transportadora, telefone, NFS-e, n8n, cadastros
--   e notas ja emitidas. O ACL (CREATE OR REPLACE preserva).
--   Caminho conferido em 15/11 (so leitura): o n8n (bLRbWquDs2WV63Du, webhook
--   emitir-nfe-focus) chama fn_preparar_envio_nfe, que grava e devolve o payload
--   desta funcao sem mexer nas chaves; o no "Aplicar codigo do ViaCEP" so
--   espalha o payload e acrescenta codigo_municipio_destinatario; os tres
--   POST /v2/nfe mandam `{{ $json.payload }}` inteiro. Ninguem le a chave
--   `email` do payload (nem funcao do banco, nem o Vibe).
--
-- TECNICA: troca ANCORADA sobre o corpo vivo (pg_get_functiondef), como a
--   20261020_fn_montar_payload_nfe_telefone_destinatario. Travas:
--   a) md5(prosrc) igual ao corpo do repositorio (816e7bd41d323d4641727b97aa9a5ae2).
--      Conferido antes: desfazer no corpo vivo a troca da 20261020 da
--      exatamente o md5 de partida que ela registra (50f9fc9b...);
--   b) a ancora aparece uma vez; desfeita a troca, o texto volta exatamente;
--      depois de gravado, desfazer a troca no prosrc novo da o md5 de antes;
--   c) ACL igual antes e depois;
--   d) payload das 300 notas mais recentes (as tres empresas, com e sem e-mail,
--      remessas), montado antes e depois sem as duas datas (now()): sem a chave
--      `email` depois, `email_destinatario` igual ao `email` de antes, e todo o
--      resto igual. Recortado em 300 porque cada chamada leva ~38 ms e as 1.557
--      notas passariam do tempo da chamada.
--
-- ROLLBACK: supabase/manutencao/nfe-email-destinatario-rollback/rollback.sql
-- ============================================================================

do $migracao$
declare
  v_def          text;
  v_nova         text;
  v_volta        text;
  v_nl           text;
  v_md5_antes    text;
  v_md5_depois   text;
  v_md5_desfeito text;
  v_acl_antes    text;
  v_acl_depois   text;
  v_ocorrencias  integer;
  v_total        integer;
  v_com_email    integer;
  v_sobrou       integer;
  v_diferente    integer;
  de_1           text;
  para_1         text;
begin
  set local lock_timeout = '5s';

  -- a) estado de partida
  select pg_get_functiondef(p.oid), md5(p.prosrc),
         (select array_agg(case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end || '=' || g.privilege_type order by 1)::text
            from aclexplode(p.proacl) g)
    into v_def, v_md5_antes, v_acl_antes
    from pg_proc p where p.oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;
  if v_md5_antes <> '816e7bd41d323d4641727b97aa9a5ae2' then
    raise exception 'fn_montar_payload_nfe difere do repositorio (md5 %). Abortado.', v_md5_antes;
  end if;

  -- d) payload das 300 notas mais recentes ANTES (sem as datas, que sao now())
  create temp table _payload_antes on commit drop as
    select nf.ref,
           public.fn_montar_payload_nfe(nf.ref) - 'data_emissao' - 'data_entrada_saida' as j
      from public.notas_fiscais nf
     order by nf.created_at desc
     limit 300;

  -- b) a troca ancorada: so o nome da chave
  v_nl := case when position(chr(13) in v_def) > 0 then chr(13) || chr(10) else chr(10) end;
  de_1 := $x$      jsonb_strip_nulls(jsonb_build_object($x$ || v_nl
       || $x$        'email',$x$ || v_nl
       || $x$        coalesce($x$;
  para_1 := $x$      jsonb_strip_nulls(jsonb_build_object($x$ || v_nl
       || $x$        'email_destinatario',$x$ || v_nl
       || $x$        coalesce($x$;

  v_ocorrencias := (length(v_def) - length(replace(v_def, de_1, ''))) / length(de_1);
  if v_ocorrencias <> 1 then
    raise exception 'a ancora aparece % vezes', v_ocorrencias;
  end if;
  if position(para_1 in v_def) > 0 then
    raise exception 'email_destinatario ja existe no corpo. Abortado.';
  end if;

  v_nova  := replace(v_def, de_1, para_1);
  v_volta := replace(v_nova, para_1, de_1);
  if v_volta <> v_def then
    raise exception 'a troca alcancou algo alem da ancora';
  end if;

  execute v_nova;

  -- b) depois: desfazer a troca no prosrc novo devolve o md5 de antes
  select md5(p.prosrc), md5(replace(p.prosrc, para_1, de_1)),
         (select array_agg(case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end || '=' || g.privilege_type order by 1)::text
            from aclexplode(p.proacl) g)
    into v_md5_depois, v_md5_desfeito, v_acl_depois
    from pg_proc p where p.oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;
  if v_md5_desfeito <> v_md5_antes then
    raise exception 'o corpo novo difere do antigo alem da chave (md5 desfeito %)', v_md5_desfeito;
  end if;

  -- c) ACL igual
  if v_acl_depois is distinct from v_acl_antes then
    raise exception 'ACL de fn_montar_payload_nfe mudou: % -> %', v_acl_antes, v_acl_depois;
  end if;

  -- d) depois: so o nome da chave mudou
  create temp table _payload_depois on commit drop as
    select a.ref, public.fn_montar_payload_nfe(a.ref) - 'data_emissao' - 'data_entrada_saida' as j
      from _payload_antes a;

  select count(*),
         count(*) filter (where d.j ? 'email_destinatario'),
         count(*) filter (where d.j ? 'email'),
         count(*) filter (where (d.j - 'email_destinatario') is distinct from (a.j - 'email')
                             or (d.j -> 'email_destinatario') is distinct from (a.j -> 'email'))
    into v_total, v_com_email, v_sobrou, v_diferente
    from _payload_antes a join _payload_depois d using (ref);
  if v_total <> (select count(*) from _payload_antes) then
    raise exception 'comparacao incompleta: % de %', v_total, (select count(*) from _payload_antes);
  end if;
  if v_sobrou <> 0 then
    raise exception '% payloads ainda com a chave email', v_sobrou;
  end if;
  if v_diferente <> 0 then
    raise exception '% payloads mudaram alem do nome da chave', v_diferente;
  end if;
  if exists (select 1 from _payload_antes a where a.j ? 'email_destinatario') then
    raise exception 'havia payload com email_destinatario antes da troca';
  end if;

  raise notice 'fn_montar_payload_nfe: md5 % -> % | % notas comparadas, % com email_destinatario, 0 com outra diferenca | ACL %',
    v_md5_antes, v_md5_depois, v_total, v_com_email, v_acl_depois;
end
$migracao$;
