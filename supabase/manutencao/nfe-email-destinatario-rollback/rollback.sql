-- ROLLBACK de 20261115_fn_montar_payload_nfe_email_destinatario (NAO APLICADO).
-- Volta a chave `email_destinatario` para `email` em fn_montar_payload_nfe e
-- confere que o corpo volta ao md5 816e7bd41d323d4641727b97aa9a5ae2.
-- Rodar so com ordem do dono. Notas ja emitidas nao mudam.
do $volta$
declare
  v_def text; v_nl text; de_1 text; para_1 text; v_md5 text; v_n integer;
begin
  set local lock_timeout = '5s';
  select pg_get_functiondef('public.fn_montar_payload_nfe(text)'::regprocedure) into v_def;
  v_nl := case when position(chr(13) in v_def) > 0 then chr(13) || chr(10) else chr(10) end;
  de_1 := $x$      jsonb_strip_nulls(jsonb_build_object($x$ || v_nl
       || $x$        'email_destinatario',$x$ || v_nl
       || $x$        coalesce($x$;
  para_1 := $x$      jsonb_strip_nulls(jsonb_build_object($x$ || v_nl
       || $x$        'email',$x$ || v_nl
       || $x$        coalesce($x$;
  v_n := (length(v_def) - length(replace(v_def, de_1, ''))) / length(de_1);
  if v_n <> 1 then
    raise exception 'a ancora aparece % vezes', v_n;
  end if;
  execute replace(v_def, de_1, para_1);
  select md5(prosrc) into v_md5 from pg_proc where oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;
  if v_md5 <> '816e7bd41d323d4641727b97aa9a5ae2' then
    raise exception 'corpo nao voltou ao md5 de antes (%)', v_md5;
  end if;
  raise notice 'fn_montar_payload_nfe voltou a chave email (md5 %)', v_md5;
end
$volta$;
