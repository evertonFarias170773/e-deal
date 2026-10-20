-- ROLLBACK de 20261020_fn_montar_payload_nfe_telefone_destinatario (NAO APLICADO).
-- Volta fn_montar_payload_nfe ao corpo anterior (confere o md5 50f9fc9b...) e
-- apaga fn_nfe_fone_valido. Rodar so com ordem do dono.
do $volta$
declare
  v_def text; v_nl text; de_1 text; para_1 text; v_md5 text; v_n integer;
begin
  select pg_get_functiondef('public.fn_montar_payload_nfe(text)'::regprocedure) into v_def;
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
  v_n := (length(v_def) - length(replace(v_def, para_1, ''))) / length(para_1);
  if v_n <> 1 then raise exception 'o bloco do telefone aparece % vezes', v_n; end if;
  execute replace(v_def, para_1, de_1);
  select md5(prosrc) into v_md5 from pg_proc where oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;
  if v_md5 <> '50f9fc9bd2a62f4698e57f042532d18b' then
    raise exception 'o corpo nao voltou ao anterior (md5 %)', v_md5;
  end if;
  drop function public.fn_nfe_fone_valido(text);
  raise notice 'rollback ok: fn_montar_payload_nfe de volta (md5 %), fn_nfe_fone_valido apagada', v_md5;
end
$volta$;
