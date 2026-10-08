-- ============================================================================
-- auditoria de enderecos: Latitude, longitude e distancia deixam de gerar linha
-- ============================================================================
-- APLICADA EM 08/10/2026, com autorizacao nominal do dono.
--
-- POR QUE
--   O fluxo do n8n COORDENADAS - VEPPO roda a cada cotacao Veppo do orcamento
--   (757 vezes em 12 dias) e grava `Latitude`, `longitude` e `distancia` em
--   TODOS os enderecos da cidade que ainda nao tem distancia. E um cache de
--   distancia, nao uma alteracao de endereco, e roda como service_role, sem
--   usuario. Com a auditoria ligada (20261008_enderecos_auditoria), cada chamada
--   gravaria uma linha por endereco da cidade (ate 160 no RS; a maior cidade do
--   pais tem 2.789 pendentes) e afogaria o que interessa: quem mudou rua, CEP,
--   cidade ou `tipo_endereco`.
--
-- O QUE MUDA
--   `audit.config_v2.ignored_columns` de public.enderecos passa a conter
--   `Latitude`, `longitude` e `distancia`, somadas ao que ja houver (em
--   08/10/2026 a lista estava vazia). So essa linha de config.
--
--   Efeito, pela funcao `audit.log_row_changes_v2` (nao alterada):
--   - UPDATE que so mexe nessas tres colunas NAO gera linha;
--   - qualquer outro UPDATE, INSERT e DELETE continua gerando;
--   - as tres colunas deixam de aparecer no antes e no depois gravados.
--     `tipo_endereco` e as outras 14 colunas continuam registradas.
--
-- OS NOMES
--   A comparacao e por chave do JSON da linha, com caixa exata. Na tabela a
--   coluna e "Latitude" (L maiusculo, criada entre aspas); `longitude` e
--   `distancia` sao minusculas. A migration confere as tres em pg_attribute
--   antes de gravar.
--
-- O QUE NAO MUDA
--   Nenhum endereco, nenhuma funcao, trigger, policy ou grant; as outras 8
--   linhas de audit.config_v2; o fluxo do n8n e o webhook.
--
-- ROLLBACK (volta a lista ao valor anterior, vazio)
--   update audit.config_v2
--      set ignored_columns = array[]::text[]
--    where schema_name = 'public' and table_name = 'enderecos';
-- ============================================================================

do $migracao$
declare
  c_novas constant text[] := array['Latitude', 'longitude', 'distancia'];
  v_antes        text[];
  v_depois       text[];
  v_esperado     text[];
  v_md5_outras_a text;
  v_md5_outras_d text;
  v_md5_end_a    text;
  v_md5_end_d    text;
  v_qtd          bigint;
  v_n            int;
begin
  -- os tres nomes existem na tabela, com esta caixa exata
  select count(*) into v_n
    from pg_attribute
   where attrelid = 'public.enderecos'::regclass and attnum > 0 and not attisdropped
     and attname = any (c_novas);
  if v_n <> 3 then
    raise exception 'esperava as 3 colunas com a caixa exata em public.enderecos, achei %', v_n;
  end if;

  select ignored_columns into v_antes
    from audit.config_v2 where schema_name = 'public' and table_name = 'enderecos' and enabled
     for update;
  if not found then
    raise exception 'audit.config_v2 nao tem linha ligada para public.enderecos';
  end if;
  if coalesce(v_antes, array[]::text[]) && c_novas then
    raise exception 'alguma das 3 colunas ja esta ignorada: %', v_antes;
  end if;
  if 'tipo_endereco' = any (coalesce(v_antes, array[]::text[])) then
    raise exception 'tipo_endereco esta ignorado, e nao deveria';
  end if;

  select md5(string_agg(schema_name || '.' || table_name || '|' || enabled::text || '|' || ignored_columns::text, ';' order by schema_name, table_name))
    into v_md5_outras_a
    from audit.config_v2 where not (schema_name = 'public' and table_name = 'enderecos');
  select count(*), md5(string_agg(md5(to_jsonb(e)::text), ',' order by e.id)) into v_qtd, v_md5_end_a from public.enderecos e;

  v_esperado := coalesce(v_antes, array[]::text[]) || c_novas;

  update audit.config_v2
     set ignored_columns = v_esperado
   where schema_name = 'public' and table_name = 'enderecos';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'esperava alterar 1 linha de config, alterou %', v_n;
  end if;

  select ignored_columns into v_depois
    from audit.config_v2 where schema_name = 'public' and table_name = 'enderecos';
  if v_depois is distinct from v_esperado or 'tipo_endereco' = any (v_depois) then
    raise exception 'ignored_columns nao ficou como esperado: %', v_depois;
  end if;

  select md5(string_agg(schema_name || '.' || table_name || '|' || enabled::text || '|' || ignored_columns::text, ';' order by schema_name, table_name))
    into v_md5_outras_d
    from audit.config_v2 where not (schema_name = 'public' and table_name = 'enderecos');
  if v_md5_outras_d is distinct from v_md5_outras_a then
    raise exception 'outra linha de audit.config_v2 mudou';
  end if;

  select md5(string_agg(md5(to_jsonb(e)::text), ',' order by e.id)) into v_md5_end_d from public.enderecos e;
  if v_md5_end_d is distinct from v_md5_end_a then
    raise exception 'as linhas de enderecos mudaram';
  end if;

  raise notice 'ok: enderecos ignora % (antes %); % enderecos intactos', v_depois, v_antes, v_qtd;
end
$migracao$;
