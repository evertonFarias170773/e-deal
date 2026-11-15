-- ROLLBACK de 20261115b_fn_montar_payload_nfe_telefone_da_conversa (NAO APLICADO).
-- Tira a conversa principal do bloco do telefone em fn_montar_payload_nfe,
-- confere que o corpo volta ao md5 06233f02c41aedd5bacb25343aa47af5 e apaga
-- fn_telefone_para_api. Rodar so com ordem do dono. Notas ja emitidas nao mudam.
do $volta$
declare
  v_def text; v_nl text; de_1 text; para_1 text; v_md5 text; v_n integer;
begin
  set local lock_timeout = '5s';
  select pg_get_functiondef('public.fn_montar_payload_nfe(text)'::regprocedure) into v_def;
  v_nl := case when position(chr(13) in v_def) > 0 then chr(13) || chr(10) else chr(10) end;
  de_1 := $x$          coalesce($x$ || v_nl
       || $x$            -- Conversa principal do pedido no ChatGuru (15/11/2026), com o 9$x$ || v_nl
       || $x$            -- pela regra do PIX (fn_telefone_para_api). Sem ela, o cadastro.$x$ || v_nl
       || $x$            (select public.fn_telefone_para_api(pc.telefone)$x$ || v_nl
       || $x$               from public.propostas_contatos_chatguru pc$x$ || v_nl
       || $x$              where pc.id_int = nf.id_int and pc.principal),$x$ || v_nl
       || $x$            public.fn_nfe_fone_valido(c.whatsapp_1),$x$;
  para_1 := $x$          coalesce($x$ || v_nl
       || $x$            public.fn_nfe_fone_valido(c.whatsapp_1),$x$;
  v_n := (length(v_def) - length(replace(v_def, de_1, ''))) / length(de_1);
  if v_n <> 1 then
    raise exception 'a ancora aparece % vezes', v_n;
  end if;
  execute replace(v_def, de_1, para_1);
  select md5(prosrc) into v_md5 from pg_proc where oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;
  if v_md5 <> '06233f02c41aedd5bacb25343aa47af5' then
    raise exception 'corpo nao voltou ao md5 de antes (%)', v_md5;
  end if;
  drop function public.fn_telefone_para_api(text);
  raise notice 'fn_montar_payload_nfe voltou ao telefone do cadastro (md5 %)', v_md5;
end
$volta$;
