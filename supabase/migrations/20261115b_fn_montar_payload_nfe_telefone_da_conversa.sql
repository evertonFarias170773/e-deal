-- ============================================================================
-- NF-e: telefone do destinatario = conversa principal do pedido (15/11/2026)
-- ============================================================================
-- AUTORIZADA pelo Everton em 15/11/2026: so esta migration em
-- fn_montar_payload_nfe e a funcao do 9 (fn_telefone_para_api).
--
-- POR QUE
--   Decisao: o telefone_destinatario (tag fone) da NF-e passa a ser o do
--   contato principal do pedido, a conversa do ChatGuru
--   (propostas_contatos_chatguru.principal, espelhada em
--   propostas.chatguru_chat_id), e nao o do cadastro do pagador.
--
-- O QUE MUDA
--   1. Funcao nova `fn_telefone_para_api(text)`: a MESMA regra de
--      `telefoneParaApi` (src/lib/telefone/telefone-br.ts), que so existia no app:
--      tira o 55 quando sobra numero nacional (12 ou 13 digitos); aceita so 10
--      ou 11 digitos com DDD 11 a 99; celular de 8 digitos comecando de 6 a 9
--      ganha o 9; fixo (2 a 5) fica; 9 digitos so comecando com 9; o resto da
--      nulo (no app, ""). Prova feita antes, em 15/11: 95.024 numeros distintos
--      (todas as conversas principais, os tres telefones de todos os clientes e
--      39 casos de borda) dao o mesmo resultado no app e nesta regra (contagem
--      igual e md5 da lista "entrada=saida" 50447fda... nos dois lados).
--   2. `fn_montar_payload_nfe`: no bloco do telefone, a conversa principal do
--      pedido vem primeiro, passada pela funcao nova. Sem conversa principal
--      (ou com numero que a regra recusa), continua o telefone do cadastro, na
--      ordem de antes (whatsapp_1, telefone_fixo, whatsapp_2). Na REMESSA
--      continua sem telefone.
--
-- O QUE NAO MUDA
--   O e-mail, o resto da funcao, o n8n, a NFS-e, cadastros e notas ja emitidas.
--   O ACL de fn_montar_payload_nfe. Nenhuma nota junta mais de um pedido
--   (conferido: todo item de notas_fiscais_itens e do pedido da propria nota) e
--   o indice ux_propostas_contatos_chatguru_principal garante uma principal
--   por pedido.
--
-- TRAVAS
--   a) md5(prosrc) igual ao publicado (06233f02c41aedd5bacb25343aa47af5) e
--      fn_telefone_para_api ainda nao existe;
--   b) a funcao nova da o mesmo que a expressao provada contra o app, em todos
--      os numeros (conversas principais e cadastro de clientes);
--   c) ancora unica e reversivel; desfazer a troca no corpo novo da o md5 de antes;
--   d) ACL de fn_montar_payload_nfe igual; a funcao nova so com o dono;
--   e) payload das 300 notas mais recentes, antes e depois (sem as datas): so
--      o telefone_destinatario muda, e so para o numero da conversa principal;
--      nota sem conversa principal fica igual; remessa continua sem telefone.
--
-- ROLLBACK: supabase/manutencao/nfe-telefone-da-conversa-rollback/rollback.sql
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
  v_acl_fone     text;
  v_ocorrencias  integer;
  v_divergem     integer;
  v_numeros      integer;
  v_total        integer;
  v_mudaram      integer;
  v_outras       integer;
  v_errado       integer;
  v_remessa_tel  integer;
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
  if v_md5_antes <> '06233f02c41aedd5bacb25343aa47af5' then
    raise exception 'fn_montar_payload_nfe difere do publicado (md5 %). Abortado.', v_md5_antes;
  end if;
  if exists (select 1 from pg_proc where proname = 'fn_telefone_para_api') then
    raise exception 'fn_telefone_para_api ja existe. Abortado.';
  end if;

  -- 1. a regra do 9 em SQL (espelho de telefoneParaApi)
  execute $f$
    create function public.fn_telefone_para_api(p_valor text)
    returns text
    language sql
    immutable
    set search_path to 'public'
    as $corpo$
      select case
        when length(d) not in (10, 11) then null
        when left(d, 2)::int not between 11 and 99 then null
        when length(d) = 11 then case when substr(d, 3, 1) = '9' then d end
        when substr(d, 3, 1) between '6' and '9' then left(d, 2) || '9' || substr(d, 3)
        when substr(d, 3, 1) between '2' and '5' then d
      end
      from (select case when length(d0) in (12, 13) and left(d0, 2) = '55' then substr(d0, 3) else d0 end as d
              from (select regexp_replace(coalesce(p_valor, ''), '[^0-9]', '', 'g') as d0) a) b
    $corpo$
  $f$;
  revoke all on function public.fn_telefone_para_api(text) from public;
  revoke all on function public.fn_telefone_para_api(text) from anon;
  revoke all on function public.fn_telefone_para_api(text) from authenticated;
  revoke all on function public.fn_telefone_para_api(text) from service_role;

  -- b) a funcao da o mesmo que a expressao provada contra o app
  with e as (
    select telefone t from public.propostas_contatos_chatguru where telefone is not null
    union select whatsapp_1 from public.clientes where whatsapp_1 is not null
    union select telefone_fixo from public.clientes where telefone_fixo is not null
    union select whatsapp_2 from public.clientes where whatsapp_2 is not null
  )
  select count(*),
         count(*) filter (where public.fn_telefone_para_api(e.t) is distinct from (
           select case
             when length(d) not in (10, 11) then null
             when left(d, 2)::int not between 11 and 99 then null
             when length(d) = 11 then case when substr(d, 3, 1) = '9' then d end
             when substr(d, 3, 1) between '6' and '9' then left(d, 2) || '9' || substr(d, 3)
             when substr(d, 3, 1) between '2' and '5' then d
           end
           from (select case when length(d0) in (12, 13) and left(d0, 2) = '55' then substr(d0, 3) else d0 end as d
                   from (select regexp_replace(coalesce(e.t, ''), '[^0-9]', '', 'g') as d0) a) b))
    into v_numeros, v_divergem
    from e;
  if v_divergem <> 0 then
    raise exception 'fn_telefone_para_api diverge da regra provada em % de % numeros', v_divergem, v_numeros;
  end if;

  -- e) payload das 300 notas mais recentes ANTES (sem as datas, que sao now())
  create temp table _payload_antes on commit drop as
    select nf.ref, upper(coalesce(nf.tipo_nota, '')) as tipo,
           (select public.fn_telefone_para_api(pc.telefone)
              from public.propostas_contatos_chatguru pc
             where pc.id_int = nf.id_int and pc.principal) as fone_conversa,
           public.fn_montar_payload_nfe(nf.ref) - 'data_emissao' - 'data_entrada_saida' as j
      from public.notas_fiscais nf
     order by nf.created_at desc
     limit 300;

  -- c) a troca ancorada: a conversa principal entra antes do cadastro
  v_nl := case when position(chr(13) in v_def) > 0 then chr(13) || chr(10) else chr(10) end;
  de_1 := $x$          coalesce($x$ || v_nl
       || $x$            public.fn_nfe_fone_valido(c.whatsapp_1),$x$;
  para_1 := $x$          coalesce($x$ || v_nl
       || $x$            -- Conversa principal do pedido no ChatGuru (15/11/2026), com o 9$x$ || v_nl
       || $x$            -- pela regra do PIX (fn_telefone_para_api). Sem ela, o cadastro.$x$ || v_nl
       || $x$            (select public.fn_telefone_para_api(pc.telefone)$x$ || v_nl
       || $x$               from public.propostas_contatos_chatguru pc$x$ || v_nl
       || $x$              where pc.id_int = nf.id_int and pc.principal),$x$ || v_nl
       || $x$            public.fn_nfe_fone_valido(c.whatsapp_1),$x$;

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

  select md5(p.prosrc), md5(replace(p.prosrc, para_1, de_1)),
         (select array_agg(case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end || '=' || g.privilege_type order by 1)::text
            from aclexplode(p.proacl) g)
    into v_md5_depois, v_md5_desfeito, v_acl_depois
    from pg_proc p where p.oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;
  if v_md5_desfeito <> v_md5_antes then
    raise exception 'o corpo novo difere do antigo alem do bloco do telefone (md5 desfeito %)', v_md5_desfeito;
  end if;

  -- d) ACL
  if v_acl_depois is distinct from v_acl_antes then
    raise exception 'ACL de fn_montar_payload_nfe mudou: % -> %', v_acl_antes, v_acl_depois;
  end if;
  select (select array_agg(case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end order by 1)::text
            from aclexplode(p.proacl) g)
    into v_acl_fone
    from pg_proc p where p.oid = 'public.fn_telefone_para_api(text)'::regprocedure;
  if v_acl_fone is distinct from '{postgres}' then
    raise exception 'ACL de fn_telefone_para_api diferente de {postgres}: %', v_acl_fone;
  end if;

  -- e) depois: so o telefone muda, e so para o da conversa principal
  create temp table _payload_depois on commit drop as
    select a.ref, public.fn_montar_payload_nfe(a.ref) - 'data_emissao' - 'data_entrada_saida' as j
      from _payload_antes a;

  select count(*),
         count(*) filter (where (d.j -> 'telefone_destinatario') is distinct from (a.j -> 'telefone_destinatario')),
         count(*) filter (where (d.j - 'telefone_destinatario') is distinct from (a.j - 'telefone_destinatario')),
         count(*) filter (where a.tipo <> 'REMESSA'
                            and (d.j ->> 'telefone_destinatario') is distinct from coalesce(a.fone_conversa, a.j ->> 'telefone_destinatario')),
         count(*) filter (where a.tipo = 'REMESSA' and d.j ? 'telefone_destinatario')
    into v_total, v_mudaram, v_outras, v_errado, v_remessa_tel
    from _payload_antes a join _payload_depois d using (ref);
  if v_total <> (select count(*) from _payload_antes) then
    raise exception 'comparacao incompleta';
  end if;
  if v_outras <> 0 then
    raise exception '% notas mudaram alem do telefone', v_outras;
  end if;
  if v_errado <> 0 then
    raise exception '% notas com telefone diferente da conversa principal ou do cadastro', v_errado;
  end if;
  if v_remessa_tel <> 0 then
    raise exception '% notas de remessa ganharam telefone', v_remessa_tel;
  end if;

  raise notice 'fn_montar_payload_nfe: md5 % -> % | fn_telefone_para_api igual em % numeros | % notas comparadas, % com telefone novo, 0 com outra diferenca | ACL %',
    v_md5_antes, v_md5_depois, v_numeros, v_total, v_mudaram, v_acl_depois;
end
$migracao$;
