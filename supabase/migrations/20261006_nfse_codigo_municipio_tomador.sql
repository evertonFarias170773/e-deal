-- ============================================================================
-- NFS-e: o codigo IBGE do municipio do tomador passa a vir de ibge_municipios
-- ============================================================================
--
-- POR QUE
--   fn_montar_payload_nfse e fn_alertas_nfse resolviam o codigo do municipio do
--   tomador por um de-para fixo de duas cidades (Porto Alegre e Avare). Sem codigo,
--   o n8n omite o endereco do tomador. Com o de-para, 17% dos enderecos cadastrados
--   eram reconhecidos (11.348 de 66.707); pela lista do IBGE, 99,36% (66.283).
--
-- O QUE MUDA
--   fn_nfse_codigo_municipio(p_cidade text, p_uf text) returns text — NOVA, so da
--       NFS-e, usada pelas duas funcoes (nunca discordam). Regra:
--         - cidade ou UF vazia (ou cidade com o texto NULL/UNDEFINED) -> nulo;
--         - UF 'DF' com cidade informada -> 5300108 (Brasilia), seja qual for a
--           regiao administrativa;
--         - senao, ibge_municipios por uf igual e nome_chave igual a cidade
--           normalizada pela MESMA expressao da coluna gerada nome_chave (a que a
--           fn_montar_payload_nfe usa): translate de lista fechada, minusculas, so
--           [a-z0-9];
--         - nao reconhecido (inclui UF errada) -> nulo. Nao adivinha a UF.
--       SECURITY INVOKER, search_path fixo. EXECUTE so para postgres e
--       service_role (nenhum GRANT para anon nem authenticated). Quem a chama sao as
--       duas funcoes SECURITY DEFINER, que rodam como o dono (postgres), dono tambem
--       de ibge_municipios — por isso leem a tabela, que tem RLS ligado e sem policy.
--   fn_montar_payload_nfse  o de-para fixo sai; entra a chamada a funcao de apoio.
--       O codigo ja presente no endereco (se um dia existir) continua com prioridade.
--   fn_alertas_nfse  CODIGO_MUNICIPIO_TOMADOR_NAO_INFORMADO passa a usar a mesma
--       funcao e ganha texto novo. Continua sem bloquear (decisao do dono: municipio
--       nao reconhecido = nota sai SEM endereco do tomador).
--
-- O QUE NAO MUDA
--   Nenhuma nota nem endereco e regravado. O endereco gravado na nota
--   (id_endereco_tomador) continua mandando. fn_montar_payload_nfe e tudo de NF-e,
--   rotas, n8n, RLS e permissoes nao sao tocados. ACL das duas funcoes igual.
--
-- CONFERIDO DENTRO DA MIGRATION (aborta se falhar)
--   - md5 de partida de cada corpo e md5 do corpo novo;
--   - a funcao de apoio devolve o proprio codigo_ibge para o nome e a UF de TODAS as
--     linhas de ibge_municipios (a expressao reproduz nome_chave em todas);
--   - o payload de cada nota existente so pode mudar ganhando
--     codigo_municipio_tomador onde antes nao havia;
--   - md5 das 5 notas antigas (sem a coluna id_endereco_tomador) identico.
--
--   funcao                     md5 antes                          md5 depois
--   fn_montar_payload_nfse     e6293fc027bccaf5a37ed36de95c9892   ab7f5f25132f195810117137c9dfc798
--   fn_alertas_nfse            70d8e050cfb8eb940f9e2d7668a57a71   fe1e4da67c98cce4e9bc95479d149df8
-- ============================================================================

do $migracao$
declare
  crlf constant text := chr(13) || chr(10);
  apoio constant text := 'public.fn_nfse_codigo_municipio(text, text)';
  funcoes constant jsonb := $f$[
  {
    "nome": "fn_montar_payload_nfse",
    "f": "public.fn_montar_payload_nfse(text)",
    "antes": "e6293fc027bccaf5a37ed36de95c9892",
    "depois": "ab7f5f25132f195810117137c9dfc798"
  },
  {
    "nome": "fn_alertas_nfse",
    "f": "public.fn_alertas_nfse(text)",
    "antes": "70d8e050cfb8eb940f9e2d7668a57a71",
    "depois": "fe1e4da67c98cce4e9bc95479d149df8"
  }
]$f$::jsonb;
  t_alvo text[] := array['fn_montar_payload_nfse', 'fn_alertas_nfse', 'fn_alertas_nfse'];
  t_qtd  int[]  := array[1, 1, 1];
  t_de   text[] := array[
    $t$    case
      when upper(coalesce(v_municipio_tomador, '')) = 'PORTO ALEGRE'
       and upper(coalesce(v_uf_tomador, '')) = 'RS'
      then '4314902'

      when upper(coalesce(v_municipio_tomador, '')) in ('AVARE', 'AVARÉ')
       and upper(coalesce(v_uf_tomador, '')) = 'SP'
      then '3504503'

      else null
    end$t$,
    $t$  and not (
    upper(coalesce(ed.cidade, '')) = 'PORTO ALEGRE'
    and upper(coalesce(ed.uf, '')) = 'RS'
  )
  and not (
    upper(coalesce(ed.cidade, '')) in ('AVARE', 'AVARÉ')
    and upper(coalesce(ed.uf, '')) = 'SP'
  );$t$,
    $t$'O código IBGE do município do tomador não está salvo no endereço. Se a cidade não estiver tratada no fallback da RPC, a DANFS-e pode sair sem município do tomador.'::text,$t$
  ];
  t_para text[] := array[
    $t$    public.fn_nfse_codigo_municipio(v_municipio_tomador, v_uf_tomador)$t$,
    $t$  and public.fn_nfse_codigo_municipio(ed.cidade, ed.uf) is null;$t$,
    $t$'O município do tomador não foi reconhecido na lista do IBGE (confira a cidade e a UF do endereço). A NFS-e sairá sem endereço do tomador.'::text,$t$
  ];
  f            jsonb;
  i            int;
  r            record;
  v_oid        oid;
  v_src        text;
  v_acl        text;
  v_secdef     boolean;
  v_config     text;
  v_def        text;
  v_de         text;
  v_para       text;
  v_n          int;
  v_total      int;
  v_depois     record;
  v_grantees   text;
  v_antigas_a  text;
  v_antigas_d  text;
  v_pa         jsonb;
  v_pd         jsonb;
  v_mudaram    text := '';
begin
  -- 0. O ANTES
  if to_regprocedure(apoio) is not null then
    raise exception 'a funcao de apoio ja existe. Abortado.';
  end if;
  if not exists (select 1 from public.ibge_municipios where codigo_ibge = '5300108' and uf = 'DF') then
    raise exception 'Brasilia (5300108) nao esta em ibge_municipios. Abortado.';
  end if;
  select md5(string_agg(md5((to_jsonb(s) - 'id_endereco_tomador')::text), ',' order by s.id)) into v_antigas_a
    from public.notas_servico s where s.ref !~ '^NFS-(22552|22823|22821|22820)-';
  if v_antigas_a is distinct from 'cd68a40fb52231d23b69aed9eb087051' then
    raise exception 'md5 das 5 notas antigas diferente do esperado: %', v_antigas_a;
  end if;
  select jsonb_object_agg(s.ref, public.fn_montar_payload_nfse(s.ref)) into v_pa from public.notas_servico s;

  -- 1. A funcao de apoio
  execute $h$
    create function public.fn_nfse_codigo_municipio(p_cidade text, p_uf text)
    returns text
    language sql
    stable
    set search_path to 'public'
    as $fn$
      select case
        when nullif(btrim(coalesce(p_cidade, '')), '') is null
          or nullif(btrim(coalesce(p_uf, '')), '') is null
          or upper(btrim(p_cidade)) in ('NULL', 'UNDEFINED')
          or regexp_replace(
               lower(translate(p_cidade,
                 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
                 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
               '[^a-z0-9]', '', 'g') = ''
          then null
        when upper(btrim(p_uf)) = 'DF' then '5300108'
        else (
          select m.codigo_ibge
            from public.ibge_municipios m
           where m.uf = upper(btrim(p_uf))
             and m.nome_chave = regexp_replace(
                   lower(translate(p_cidade,
                     'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
                     'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
                   '[^a-z0-9]', '', 'g')
        )
      end
    $fn$
  $h$;
  execute 'revoke all on function ' || apoio || ' from public, anon, authenticated';
  execute 'grant execute on function ' || apoio || ' to service_role';
  execute $c$comment on function public.fn_nfse_codigo_municipio(text, text) is
    'NFS-e: codigo IBGE do municipio do tomador por cidade e UF (ibge_municipios, mesma expressao de nome_chave; DF = 5300108). Nao reconhecido = nulo. Usada por fn_montar_payload_nfse e fn_alertas_nfse.'$c$;

  select string_agg(distinct x.grantee::regrole::text, ',' order by x.grantee::regrole::text) into v_grantees
    from pg_proc p, aclexplode(p.proacl) x where p.oid = to_regprocedure(apoio) and x.privilege_type = 'EXECUTE';
  if v_grantees is distinct from 'postgres,service_role'
     or has_function_privilege('anon', to_regprocedure(apoio), 'EXECUTE')
     or has_function_privilege('authenticated', to_regprocedure(apoio), 'EXECUTE') then
    raise exception 'funcao de apoio: ACL inesperado (%)', v_grantees;
  end if;

  -- a expressao reproduz nome_chave em TODAS as linhas da lista do IBGE
  select count(*), count(*) filter (where public.fn_nfse_codigo_municipio(m.nome, m.uf) is distinct from m.codigo_ibge)
    into v_total, v_n from public.ibge_municipios m;
  if v_total < 5000 or v_n <> 0 then
    raise exception 'a funcao de apoio nao reproduz a lista do IBGE: % de % linhas divergem', v_n, v_total;
  end if;

  -- 2. As duas funcoes
  for f in select * from jsonb_array_elements(funcoes) loop
    v_oid := to_regprocedure(f ->> 'f');
    if v_oid is null then
      raise exception 'funcao % nao existe', f ->> 'f';
    end if;
    select p.prosrc, p.proacl::text, p.prosecdef, p.proconfig::text into v_src, v_acl, v_secdef, v_config from pg_proc p where p.oid = v_oid;
    if md5(v_src) <> (f ->> 'antes') then
      raise exception '% mudou desde a leitura (md5 %, esperado %). Abortado.', f ->> 'f', md5(v_src), f ->> 'antes';
    end if;

    v_def := pg_get_functiondef(v_oid);
    for i in 1 .. array_length(t_alvo, 1) loop
      continue when t_alvo[i] <> (f ->> 'nome');
      v_de   := replace(replace(t_de[i],   chr(13), ''), chr(10), crlf);
      v_para := replace(replace(t_para[i], chr(13), ''), chr(10), crlf);
      v_n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
      if v_n <> t_qtd[i] then
        raise exception '%: ancora % aparece % vez(es), esperava %', f ->> 'nome', i, v_n, t_qtd[i];
      end if;
      v_def := replace(v_def, v_de, v_para);
    end loop;
    execute v_def;

    select p.prosrc, p.proacl::text as acl, p.prosecdef, p.proconfig::text as config into v_depois from pg_proc p where p.oid = v_oid;
    if md5(v_depois.prosrc) <> (f ->> 'depois') then
      raise exception '%: md5 do corpo novo % (esperado %)', f ->> 'nome', md5(v_depois.prosrc), f ->> 'depois';
    end if;
    if v_depois.acl is distinct from v_acl or v_depois.prosecdef is distinct from v_secdef or v_depois.config is distinct from v_config then
      raise exception '%: ACL/secdef/config mudaram (% -> %)', f ->> 'nome', v_acl, v_depois.acl;
    end if;
  end loop;

  -- 3. O DEPOIS
  select md5(string_agg(md5((to_jsonb(s) - 'id_endereco_tomador')::text), ',' order by s.id)) into v_antigas_d
    from public.notas_servico s where s.ref !~ '^NFS-(22552|22823|22821|22820)-';
  if v_antigas_d is distinct from v_antigas_a then
    raise exception 'as 5 notas antigas mudaram (% -> %)', v_antigas_a, v_antigas_d;
  end if;

  select jsonb_object_agg(s.ref, public.fn_montar_payload_nfse(s.ref)) into v_pd from public.notas_servico s;
  for r in select key as ref from jsonb_object_keys(v_pa) key order by key loop
    if ((v_pd -> r.ref) - 'codigo_municipio_tomador') is distinct from ((v_pa -> r.ref) - 'codigo_municipio_tomador') then
      raise exception 'o payload da nota % mudou em algo alem do codigo do municipio do tomador', r.ref;
    end if;
    if (v_pa -> r.ref) ? 'codigo_municipio_tomador'
       and ((v_pd -> r.ref) ->> 'codigo_municipio_tomador') is distinct from ((v_pa -> r.ref) ->> 'codigo_municipio_tomador') then
      raise exception 'a nota % ja tinha codigo de municipio e ele mudou', r.ref;
    end if;
    if not ((v_pa -> r.ref) ? 'codigo_municipio_tomador') and ((v_pd -> r.ref) ? 'codigo_municipio_tomador') then
      v_mudaram := v_mudaram || r.ref || '=' || ((v_pd -> r.ref) ->> 'codigo_municipio_tomador') || ' ';
    end if;
  end loop;

  perform pg_notify('pgrst', 'reload schema');
  raise notice 'ok: codigo do municipio do tomador pela lista do IBGE (% linhas conferidas). Payloads que ganharam o codigo: %', v_total, coalesce(nullif(v_mudaram, ''), '(nenhum)');
end
$migracao$;

-- ============================================================================
-- ROLLBACK (arquivos em supabase/manutencao/nfse-codigo-municipio-rollback/)
-- ============================================================================
-- Os corpos anteriores, inteiros, estao em arquivos proprios; cada um confere o
-- md5 antes de recriar a funcao. Rodar NESTA ordem:
--   1. fn_alertas_nfse.sql
--   2. fn_montar_payload_nfse.sql
--   3. zz_drop_funcao_de_apoio.sql   (so depois das duas: elas chamam a funcao)
-- ============================================================================
