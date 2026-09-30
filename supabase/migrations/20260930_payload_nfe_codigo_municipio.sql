-- ============================================================================
-- fn_montar_payload_nfe: manda o codigo IBGE do municipio do destinatario
-- ============================================================================
--
-- POR QUE
--   Sem `codigo_municipio_destinatario`, a Focus acha o municipio pelo NOME e
--   recusa com 422 a grafia que nao for a oficial. Foi o que barrou a
--   NFE-22849-001 ("Santana Do Livramento") em 30/09 e a NFE-22596-001 ("Poa")
--   em 24/09. Na base, 85,2% dos enderecos tem a grafia identica a oficial; pela
--   chave sem acento, apostrofo, espaco e maiuscula, 99,0% resolvem.
--
-- O QUE MUDA
--   Depois de montar o payload, e so se ele ainda nao tiver o codigo:
--     1. codigo ja no payload            -> fica (hoje nenhum endereco guarda um;
--                                           `enderecos` nao tem essa coluna);
--     2. public.ibge_municipios          -> por UF + `nome_chave`, com a MESMA
--                                           expressao da coluna gerada;
--     3. CEP pelo ViaCEP                 -> NAO fica aqui: o banco nao faz HTTP
--                                           (nao ha extensao http/pg_net). Fica
--                                           no n8n, entre "IF - Pode Emitir?" e
--                                           o Switch, so quando o codigo faltar.
--   Nenhum resolveu: sai so o nome, exatamente como antes.
--
--   Le o municipio e a UF do PAYLOAD FINAL, ja com o bloco da REMESSA aplicado
--   por cima: o codigo segue o endereco que de fato vai na nota.
--
--   O NOME NAO MUDA. So a chave nova entra.
--
-- TRAVAS
--   a) md5(prosrc) igual ao lido ao escrever (e3e3e316ea7cd08147bef6437213a887).
--      Nao ha no repositorio arquivo com o corpo inteiro — as migrations
--      anteriores sao trocas ancoradas —, entao a comparacao e com o md5
--      congelado aqui. Mudou: aborta.
--   b) as duas ancoras aparecem uma vez cada; desfeita a troca, o texto volta
--      IDENTICO;
--   c) para TODAS as notas: o payload depois, sem a chave nova, e igual ao de
--      antes (sem data_emissao e data_entrada_saida, que usam now());
--   d) todo codigo gravado tem 7 digitos;
--   e) ACL, SECURITY DEFINER e search_path iguais. A migration nao escreve em
--      notas_fiscais (so le); contagem total com o banco em uso nao fecharia.
--
-- ROLLBACK
--   Desfazer as duas trocas (o texto de volta e exigido identico pela trava b).
-- ============================================================================

do $migracao$
declare
  v_def           text;
  v_nova          text;
  v_volta         text;
  v_nl            text;
  v_md5_antes     text;
  v_md5_depois    text;
  v_acl_antes     text;
  v_acl_depois    text;
  v_ocorrencias   int;
  v_ancora        text;
  v_diferentes    int;
  v_com_codigo    int;
  v_ja_tinham     int;
  v_codigo_ruim   int;
  de_1            text;
  para_1          text;
  de_2            text;
  para_2          text;
begin
  -- ==========================================================================
  -- 0. O ANTES
  -- ==========================================================================
  select pg_get_functiondef(p.oid), md5(p.prosrc),
         coalesce(array_to_string(p.proacl, ' | '), '') || '|' || p.prosecdef::text || '|' || coalesce(p.proconfig::text, '')
    into v_def, v_md5_antes, v_acl_antes
    from pg_proc p
   where p.oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;

  if v_md5_antes <> 'e3e3e316ea7cd08147bef6437213a887' then
    raise exception 'fn_montar_payload_nfe mudou desde que esta migration foi escrita (md5 %). Abortado.', v_md5_antes;
  end if;

  if (select count(*) from public.ibge_municipios) < 5570 then
    raise exception 'public.ibge_municipios nao esta carregada. Rode scripts/fiscal/carregar-ibge-municipios.mjs --gravar antes.';
  end if;

  create temp table _payload_antes on commit drop as
    select nf.ref,
           public.fn_montar_payload_nfe(nf.ref) - 'data_emissao' - 'data_entrada_saida' as j
      from public.notas_fiscais nf;

  select count(*) into v_ja_tinham
    from _payload_antes where j ? 'codigo_municipio_destinatario';

  -- ==========================================================================
  -- 1. As duas trocas
  -- ==========================================================================
  v_nl := case when position(chr(13) in v_def) > 0 then chr(13) || chr(10) else chr(10) end;

  de_1   := $x$  v_payload jsonb;$x$ || v_nl || $x$begin$x$;
  para_1 := $x$  v_payload jsonb;$x$ || v_nl
         || $x$  v_codigo_municipio text;$x$ || v_nl
         || $x$begin$x$;

  de_2   := $x$  return v_payload;$x$;
  para_2 := $x$  -- ===========================================================$x$ || v_nl
         || $x$  -- Codigo IBGE do municipio do destinatario (30/09/2026)$x$ || v_nl
         || $x$  -- ===========================================================$x$ || v_nl
         || $x$  -- Sem o codigo, a Focus acha o municipio pelo NOME e recusa$x$ || v_nl
         || $x$  -- grafia fora da oficial (NFE-22849-001, "Santana Do Livramento").$x$ || v_nl
         || $x$  -- Ordem: o codigo que ja estiver no payload; a tabela do IBGE por$x$ || v_nl
         || $x$  -- UF + nome sem acento, apostrofo, espaco e maiuscula; o ViaCEP,$x$ || v_nl
         || $x$  -- que e HTTP e por isso fica no n8n, antes do envio. Sem codigo,$x$ || v_nl
         || $x$  -- sai so o nome, como antes. O NOME NAO MUDA.$x$ || v_nl
         || $x$  -- Le o payload FINAL: na REMESSA, o endereco de quem recebe.$x$ || v_nl
         || $x$  -- A expressao da chave e a MESMA de ibge_municipios.nome_chave.$x$ || v_nl
         || $x$  if v_payload is not null$x$ || v_nl
         || $x$     and nullif(btrim(coalesce(v_payload ->> 'codigo_municipio_destinatario', '')), '') is null then$x$ || v_nl
         || $x$    select m.codigo_ibge$x$ || v_nl
         || $x$      into v_codigo_municipio$x$ || v_nl
         || $x$      from public.ibge_municipios m$x$ || v_nl
         || $x$     where m.uf = upper(btrim(coalesce(v_payload ->> 'uf_destinatario', '')))$x$ || v_nl
         || $x$       and m.nome_chave = regexp_replace($x$ || v_nl
         || $x$             lower(translate(coalesce(v_payload ->> 'municipio_destinatario', ''),$x$ || v_nl
         || $x$               'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',$x$ || v_nl
         || $x$               'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),$x$ || v_nl
         || $x$             '[^a-z0-9]', '', 'g');$x$ || v_nl
         || v_nl
         || $x$    if v_codigo_municipio is not null then$x$ || v_nl
         || $x$      v_payload := v_payload || jsonb_build_object('codigo_municipio_destinatario', v_codigo_municipio);$x$ || v_nl
         || $x$    end if;$x$ || v_nl
         || $x$  end if;$x$ || v_nl
         || v_nl
         || $x$  return v_payload;$x$;

  foreach v_ancora in array array[de_1, de_2] loop
    v_ocorrencias := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
    if v_ocorrencias <> 1 then
      raise exception 'ancora aparece % vezes: %', v_ocorrencias, v_ancora;
    end if;
  end loop;

  v_nova  := replace(replace(v_def, de_1, para_1), de_2, para_2);
  v_volta := replace(replace(v_nova, para_2, de_2), para_1, de_1);
  if v_volta is distinct from v_def then
    raise exception 'a troca alcancou algo alem das duas ancoras';
  end if;

  execute v_nova;

  -- ==========================================================================
  -- 2. ASSERCOES
  -- ==========================================================================
  select md5(p.prosrc),
         coalesce(array_to_string(p.proacl, ' | '), '') || '|' || p.prosecdef::text || '|' || coalesce(p.proconfig::text, '')
    into v_md5_depois, v_acl_depois
    from pg_proc p
   where p.oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;

  if v_acl_depois is distinct from v_acl_antes then
    raise exception 'ACL/secdef/config mudaram (% -> %)', v_acl_antes, v_acl_depois;
  end if;

  -- c) o payload de TODA nota, sem a chave nova, e o mesmo de antes.
  select count(*) filter (where (d.j - 'codigo_municipio_destinatario') is distinct from a.j),
         count(*) filter (where d.j ? 'codigo_municipio_destinatario'),
         count(*) filter (where (d.j ->> 'codigo_municipio_destinatario') !~ '^[0-9]{7}$')
    into v_diferentes, v_com_codigo, v_codigo_ruim
    from _payload_antes a
    join lateral (
      select public.fn_montar_payload_nfe(a.ref) - 'data_emissao' - 'data_entrada_saida' as j
    ) d on true;

  if v_ja_tinham <> 0 then
    raise exception 'havia % payloads com codigo antes; a comparacao nao seria limpa', v_ja_tinham;
  end if;
  if v_diferentes <> 0 then
    raise exception '% payloads mudaram em algo alem do codigo do municipio', v_diferentes;
  end if;
  if v_codigo_ruim <> 0 then
    raise exception '% codigos fora do formato de 7 digitos', v_codigo_ruim;
  end if;

  raise notice 'fn_montar_payload_nfe: md5 % -> % | % notas, % ganham o codigo, 0 com outra diferenca',
    v_md5_antes, v_md5_depois, (select count(*) from _payload_antes), v_com_codigo;
end
$migracao$;
