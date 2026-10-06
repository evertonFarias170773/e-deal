-- ============================================================================
-- NFS-e: fn_alertas_nfse deixa de resolver o municipio dos 66 mil enderecos
-- 06/10/2026 — opcao (b), decisao do dono.
--
-- PROBLEMA
--   fn_alertas_nfse levava ~4,4 s por chamada. O trecho do alerta
--   CODIGO_MUNICIPIO_TOMADOR_NAO_INFORMADO juntava notas_servico com enderecos e
--   filtrava por fn_nfse_codigo_municipio(ed.cidade, ed.uf). Como o filtro so cita
--   colunas de enderecos, o planejador o aplicava na VARREDURA da tabela: 66.745
--   resolucoes de municipio por chamada (3.321 ms medidos), fosse o tomador de 1
--   ou de 10 enderecos. A funcao e chamada pela janela "Gerar NFS-e" e por
--   fn_preparar_envio_nfse (n8n) em toda emissao.
--
-- O QUE MUDA — so a ORDEM, nesse unico trecho
--   Os enderecos do tomador (os do cliente da nota, ou o gravado na nota) sao
--   separados antes, num CTE MATERIALIZED, e o municipio so e resolvido neles.
--   A condicao logica, o codigo e o texto do alerta ficam exatamente como estavam.
--   O mesmo trecho reescrito mediu 19 ms.
--
-- O QUE NAO MUDA
--   Nenhum indice, nenhuma tabela, nenhuma nota. enderecos, fn_nfse_codigo_municipio,
--   fn_montar_payload_nfse, fn_preparar_envio_nfse, NF-e, rotas, n8n, RLS e
--   permissoes nao sao tocados. CREATE OR REPLACE preserva o ACL (postgres,
--   authenticated, service_role); nenhum GRANT.
--
-- CONFERIDO DENTRO DA MIGRATION (aborta e desfaz tudo se falhar)
--   - md5 de partida do corpo vivo e md5 do corpo novo;
--   - cada ancora aparece exatamente uma vez;
--   - ACL, SECURITY DEFINER e search_path iguais antes e depois;
--   - md5 das 5 notas antigas (sem a coluna id_endereco_tomador) identico, e igual
--     ao da migration anterior (cd68a40f...);
--   - nenhuma nota regravada (md5 de todas as linhas igual antes e depois);
--   - os alertas de CADA nota existente, calculados com a funcao nova, batem com o
--     retrato tirado com a funcao antiga (tipo, codigo, mensagem e bloqueio).
--
--   md5 antes   fe1e4da67c98cce4e9bc95479d149df8
--   md5 depois  529556ebdfd6c3240e96c11cb827984b
--
-- ROLLBACK: supabase/manutencao/nfse-alertas-municipio-rollback/fn_alertas_nfse.sql
--   (corpo anterior inteiro; confere o md5 antes de recriar).
-- ============================================================================

do $migracao$
declare
  crlf constant text := chr(13) || chr(10);
  f constant text := 'public.fn_alertas_nfse(text)';
  md5_antes  constant text := 'fe1e4da67c98cce4e9bc95479d149df8';
  md5_depois constant text := '529556ebdfd6c3240e96c11cb827984b';
  -- Retrato dos alertas de cada nota com a funcao ANTIGA (06/10/2026): md5 de
  -- tipo|codigo|mensagem|bloqueia, uma linha por alerta, em ordem de codigo e tipo.
  retrato constant jsonb := $r${
  "NFS-16251-002": "1e106bc43ef27c35a52129d021b2f39a",
  "NFS-16482-001": "22ab04f17949f40f6670ac7eae109d0d",
  "NFS-16496-001": "22ab04f17949f40f6670ac7eae109d0d",
  "NFS-16547-001": "334d4fd7d74ad87c959f3e2f560c0123",
  "NFS-16551-003": "22ab04f17949f40f6670ac7eae109d0d",
  "NFS-22552-001": "817089d2eacf654fa0a7847f70bf24da",
  "NFS-22760-001": "cb85be53a0faa5ee97499b38025bd4d1",
  "NFS-22820-001": "cb85be53a0faa5ee97499b38025bd4d1",
  "NFS-22821-001": "cb85be53a0faa5ee97499b38025bd4d1",
  "NFS-22823-001": "608c6a3f298f24507bf5efa0c5466463",
  "NFS-23248-001": "cb85be53a0faa5ee97499b38025bd4d1",
  "NFS-23304-001": "cb85be53a0faa5ee97499b38025bd4d1"
}$r$::jsonb;
  t_de text[] := array[
    $t$return query
select
  'ALERTA'::text,
  'CODIGO_MUNICIPIO_TOMADOR_NAO_INFORMADO'::text,$t$,
    $t$from public.notas_servico ns
join public.enderecos ed on ed.id_cliente = ns.id_cliente and (ns.id_endereco_tomador is null or ed.id = ns.id_endereco_tomador)
where ns.ref = p_ref
  and nullif(
    trim(
      coalesce(
        to_jsonb(ed) ->> 'codigo_municipio_ibge',$t$
  ];
  t_para text[] := array[
    $t$return query
with do_tomador as materialized (
  -- Primeiro SO os enderecos do tomador (os do cliente da nota, ou o gravado na
  -- nota). MATERIALIZED de proposito: sem ele o planejador leva o filtro do
  -- municipio para a varredura de enderecos e resolve o municipio dos 66 mil
  -- enderecos da tabela a cada chamada (3,3 s). A condicao e a mesma de antes.
  select ed.*
  from public.notas_servico ns
  join public.enderecos ed on ed.id_cliente = ns.id_cliente and (ns.id_endereco_tomador is null or ed.id = ns.id_endereco_tomador)
  where ns.ref = p_ref
)
select
  'ALERTA'::text,
  'CODIGO_MUNICIPIO_TOMADOR_NAO_INFORMADO'::text,$t$,
    $t$from do_tomador ed
where nullif(
    trim(
      coalesce(
        to_jsonb(ed) ->> 'codigo_municipio_ibge',$t$
  ];
  i           int;
  r           record;
  v_oid       oid;
  v_src       text;
  v_acl       text;
  v_secdef    boolean;
  v_config    text;
  v_def       text;
  v_de        text;
  v_para      text;
  v_n         int;
  v_depois    record;
  v_antigas_a text;
  v_antigas_d text;
  v_todas_a   text;
  v_todas_d   text;
  v_md5       text;
  v_conferidas int := 0;
begin
  -- 0. O ANTES
  v_oid := to_regprocedure(f);
  if v_oid is null then
    raise exception 'funcao % nao existe', f;
  end if;
  select p.prosrc, p.proacl::text, p.prosecdef, p.proconfig::text into v_src, v_acl, v_secdef, v_config from pg_proc p where p.oid = v_oid;
  if md5(v_src) <> md5_antes then
    raise exception '% mudou desde a leitura (md5 %, esperado %). Abortado.', f, md5(v_src), md5_antes;
  end if;

  select md5(string_agg(md5((to_jsonb(s) - 'id_endereco_tomador')::text), ',' order by s.id)) into v_antigas_a
    from public.notas_servico s where s.ref ~ '^NFS-(16251|16482|16496|16551|16547)-';
  if v_antigas_a is distinct from 'cd68a40fb52231d23b69aed9eb087051' then
    raise exception 'md5 das 5 notas antigas diferente do esperado: %', v_antigas_a;
  end if;
  select md5(string_agg(md5(to_jsonb(s)::text), ',' order by s.id)) into v_todas_a from public.notas_servico s;

  -- 1. A troca: so as duas ancoras do trecho do municipio
  v_def := pg_get_functiondef(v_oid);
  for i in 1 .. array_length(t_de, 1) loop
    v_de   := replace(replace(t_de[i],   chr(13), ''), chr(10), crlf);
    v_para := replace(replace(t_para[i], chr(13), ''), chr(10), crlf);
    v_n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
    if v_n <> 1 then
      raise exception 'ancora % aparece % vez(es), esperava 1', i, v_n;
    end if;
    v_def := replace(v_def, v_de, v_para);
  end loop;
  execute v_def;

  select p.prosrc, p.proacl::text as acl, p.prosecdef, p.proconfig::text as config into v_depois from pg_proc p where p.oid = v_oid;
  if md5(v_depois.prosrc) <> md5_depois then
    raise exception 'md5 do corpo novo % (esperado %)', md5(v_depois.prosrc), md5_depois;
  end if;
  if v_depois.acl is distinct from v_acl or v_depois.prosecdef is distinct from v_secdef or v_depois.config is distinct from v_config then
    raise exception 'ACL/secdef/config mudaram (% -> %)', v_acl, v_depois.acl;
  end if;

  -- 2. O DEPOIS: os alertas de cada nota, com a funcao nova, batem com o retrato
  for r in select s.ref from public.notas_servico s order by s.ref loop
    if not (retrato ? r.ref) then
      continue; -- nota criada depois do retrato: nao ha com o que comparar
    end if;
    select md5(coalesce(string_agg(a.tipo || '|' || a.codigo || '|' || a.mensagem || '|' || a.bloqueia_envio::text, chr(10)
                                   order by a.codigo collate "C", a.tipo collate "C"), ''))
      into v_md5
      from public.fn_alertas_nfse(r.ref) a;
    if v_md5 is distinct from (retrato ->> r.ref) then
      raise exception 'os alertas da nota % mudaram (md5 %, retrato %). Nada foi aplicado.', r.ref, v_md5, retrato ->> r.ref;
    end if;
    v_conferidas := v_conferidas + 1;
  end loop;
  if v_conferidas < 12 then
    raise exception 'so % nota(s) do retrato foram conferidas; esperava 12', v_conferidas;
  end if;

  select md5(string_agg(md5((to_jsonb(s) - 'id_endereco_tomador')::text), ',' order by s.id)) into v_antigas_d
    from public.notas_servico s where s.ref ~ '^NFS-(16251|16482|16496|16551|16547)-';
  select md5(string_agg(md5(to_jsonb(s)::text), ',' order by s.id)) into v_todas_d from public.notas_servico s;
  if v_antigas_d is distinct from v_antigas_a or v_todas_d is distinct from v_todas_a then
    raise exception 'alguma nota mudou (antigas % -> %, todas % -> %)', v_antigas_a, v_antigas_d, v_todas_a, v_todas_d;
  end if;

  perform pg_notify('pgrst', 'reload schema');
  raise notice 'ok: fn_alertas_nfse reescrita; alertas de % notas identicos ao retrato', v_conferidas;
end
$migracao$;

-- ============================================================================
-- ROLLBACK: supabase/manutencao/nfse-alertas-municipio-rollback/fn_alertas_nfse.sql
-- O corpo anterior, inteiro, esta nesse arquivo; ele confere o md5 antes e depois
-- de recriar a funcao. Nao e migration: so rodar para desfazer.
-- ============================================================================
