-- ============================================================================
-- NFS-e: o NBS padrao de nota nova passa de 121012200 para 121011000
-- ============================================================================
--
-- POR QUE
--   O NBS correto do servico 13.05.01 e 121011000 ("Servicos de editoracao"),
--   conforme o portal nacional e a NFS-e real da Ideal Biro. O 121012200 estava
--   fixo como padrao em quatro funcoes e no servico padrao.
--
-- O QUE MUDA (troca de 121012200 por 121011000, e nada mais)
--   tg_nfse_normalizar_recalcular_biu()  4 ocorrencias:
--       - NBS vazio            -> grava 121011000 (era 121012200)
--       - NBS '21012200'       -> grava 121011000 (era 121012200; decisao do dono:
--                                 o padrao antigo com digito faltando vira o novo)
--       - informacoes_complementares vazia -> 'NBS:' || codigo_nbs (reserva nova)
--       - o comentario que descreve a correcao
--       Qualquer outro NBS continua gravado como veio (so os digitos).
--   fn_montar_payload_nfse(text)         2 ocorrencias: reserva de codigo_nbs e
--                                        de informacoes_complementares ('NBS:...').
--   fn_alertas_nfse(text)                1 ocorrencia: o texto do alerta
--                                        CODIGO_NBS_NAO_INFORMADO.
--   fn_clonar_rascunho_nfse(text, text)  1 ocorrencia: a constante de reserva. A
--                                        copia do NBS da nota de origem NAO muda.
--   nfse_servicos_padrao id 1            codigo_nbs 121012200 -> 121011000.
--
-- O QUE NAO MUDA
--   Nenhuma nota existente e regravada (md5 das linhas conferido antes e depois).
--   ACL, SECURITY DEFINER e search_path das quatro funcoes (CREATE OR REPLACE
--   preserva; nenhum GRANT). NF-e, rotas, n8n, RLS e permissoes nao sao tocados.
--
-- COMO E FEITA
--   As quatro funcoes nao tinham arquivo no repositorio. A troca e ancorada no
--   corpo VIVO: a migration so segue se o md5 de cada corpo for o lido em
--   05/10/2026 e se a contagem de ocorrencias for a esperada; confere tambem o
--   md5 do corpo resultante.
--
--   funcao                               md5 antes                          md5 depois
--   tg_nfse_normalizar_recalcular_biu    2677d2172c5a7524f61ed063b00dc89b   9822964481d6aa3a0edbe86d3520d7a8
--   fn_montar_payload_nfse               03551870c43770971f3f381efc41de2d   8bebe2834b97ed5c0177132fac6c617e
--   fn_alertas_nfse                      f574d6ebca0b5a9e8d9d920f8ce4a264   49cf26b476b64f1cf740a242a28edf2d
--   fn_clonar_rascunho_nfse              4f716b39438854422cbe7ba8b55747fd   a27ac7994f258f44420312f4af818b88
--
-- FORA DO BANCO (nao tocado aqui)
--   O no de codigo "Preparar Body Focus NFS-e" do n8n usa 121012200 quando o NBS
--   recebido nao tem 9 digitos; 121011000 tem 9 e passa como veio.
--   `src/lib/mocks/nfse.mock.ts` ainda traz o valor antigo.
-- ============================================================================

do $migracao$
declare
  alvos constant jsonb := $alvos$[
    {"f": "public.tg_nfse_normalizar_recalcular_biu()",  "antes": "2677d2172c5a7524f61ed063b00dc89b", "depois": "9822964481d6aa3a0edbe86d3520d7a8", "n": 4},
    {"f": "public.fn_montar_payload_nfse(text)",          "antes": "03551870c43770971f3f381efc41de2d", "depois": "8bebe2834b97ed5c0177132fac6c617e", "n": 2},
    {"f": "public.fn_alertas_nfse(text)",                 "antes": "f574d6ebca0b5a9e8d9d920f8ce4a264", "depois": "49cf26b476b64f1cf740a242a28edf2d", "n": 1},
    {"f": "public.fn_clonar_rascunho_nfse(text, text)",   "antes": "4f716b39438854422cbe7ba8b55747fd", "depois": "a27ac7994f258f44420312f4af818b88", "n": 1}
  ]$alvos$::jsonb;
  velho constant text := '121012200';
  novo  constant text := '121011000';
  a            jsonb;
  v_oid        oid;
  v_src        text;
  v_acl        text;
  v_secdef     boolean;
  v_config     text;
  v_depois     record;
  v_n          int;
  v_linhas     int;
  v_md5_antes  text;
  v_md5_depois text;
begin
  select md5(string_agg(md5(to_jsonb(s)::text), ',' order by s.id)) into v_md5_antes from public.notas_servico s;

  -- 0. O trigger: as 4 ocorrencias sao exatamente as esperadas (padrao e correcao
  --    do padrao). Se o corpo tiver outra coisa com o NBS, o md5 abaixo ja barra;
  --    estas ancoras deixam explicito o que esta sendo trocado.
  select prosrc into v_src from pg_proc where oid = to_regprocedure('public.tg_nfse_normalizar_recalcular_biu()');
  if v_src is null
     or position('21012200 -> 121012200.' in v_src) = 0
     or position('if v_nbs_digitos = ''21012200'' then' in v_src) = 0
     or (length(v_src) - length(replace(v_src, 'new.codigo_nbs := ''121012200'';', ''))) / length('new.codigo_nbs := ''121012200'';') <> 2
     or position('coalesce(new.codigo_nbs, ''121012200'')' in v_src) = 0
     or position('new.codigo_nbs := v_nbs_digitos;' in v_src) = 0 then
    raise exception 'ancoras do trigger nao conferem. Abortado.';
  end if;

  -- 1. As quatro funcoes
  for a in select * from jsonb_array_elements(alvos) loop
    v_oid := to_regprocedure(a ->> 'f');
    if v_oid is null then
      raise exception 'funcao % nao existe', a ->> 'f';
    end if;

    select p.prosrc, p.proacl::text, p.prosecdef, p.proconfig::text
      into v_src, v_acl, v_secdef, v_config
      from pg_proc p where p.oid = v_oid;

    if md5(v_src) <> (a ->> 'antes') then
      raise exception '% mudou desde a leitura (md5 %, esperado %). Abortado.', a ->> 'f', md5(v_src), a ->> 'antes';
    end if;

    v_n := (length(v_src) - length(replace(v_src, velho, ''))) / length(velho);
    if v_n <> (a ->> 'n')::int then
      raise exception '%: % ocorrencias de %, esperava %', a ->> 'f', v_n, velho, a ->> 'n';
    end if;
    if position(novo in v_src) > 0 then
      raise exception '%: ja contem %', a ->> 'f', novo;
    end if;

    execute replace(pg_get_functiondef(v_oid), velho, novo);

    select p.prosrc, p.proacl::text as acl, p.prosecdef, p.proconfig::text as config
      into v_depois
      from pg_proc p where p.oid = v_oid;

    if v_depois.prosrc is distinct from replace(v_src, velho, novo) then
      raise exception '%: o corpo novo nao e o antigo com a troca', a ->> 'f';
    end if;
    if md5(v_depois.prosrc) <> (a ->> 'depois') then
      raise exception '%: md5 do corpo novo % (esperado %)', a ->> 'f', md5(v_depois.prosrc), a ->> 'depois';
    end if;
    if position(velho in v_depois.prosrc) > 0 then
      raise exception '%: sobrou % no corpo', a ->> 'f', velho;
    end if;
    if v_depois.acl is distinct from v_acl
       or v_depois.prosecdef is distinct from v_secdef
       or v_depois.config is distinct from v_config then
      raise exception '%: ACL/secdef/config mudaram (% -> %)', a ->> 'f', v_acl, v_depois.acl;
    end if;
  end loop;

  -- 2. O servico padrao
  update public.nfse_servicos_padrao
     set codigo_nbs = novo, updated_at = now()
   where id = 1 and codigo_nbs = velho;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'nfse_servicos_padrao id 1: esperava trocar 1 linha, troquei %', v_linhas;
  end if;

  -- 3. Nada mais no banco guarda o padrao antigo em funcao
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema') and p.prosrc like '%' || velho || '%';
  if v_n <> 0 then
    raise exception 'ainda ha % funcao(oes) com %', v_n, velho;
  end if;

  -- 4. Nenhuma nota foi regravada
  select md5(string_agg(md5(to_jsonb(s)::text), ',' order by s.id)) into v_md5_depois from public.notas_servico s;
  if v_md5_depois is distinct from v_md5_antes then
    raise exception 'as linhas de notas_servico mudaram (% -> %)', v_md5_antes, v_md5_depois;
  end if;

  raise notice 'ok: NBS padrao de NFS-e = %; notas intactas (md5 %)', novo, v_md5_depois;
end
$migracao$;

-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- Os corpos ANTERIORES, inteiros, estao em arquivos proprios (somam ~1.300
-- linhas; cada um confere o md5 antes de recriar a funcao e preserva o ACL):
--   supabase/manutencao/nfse-nbs-121011000-rollback/tg_nfse_normalizar_recalcular_biu.sql
--   supabase/manutencao/nfse-nbs-121011000-rollback/fn_montar_payload_nfse.sql
--   supabase/manutencao/nfse-nbs-121011000-rollback/fn_alertas_nfse.sql
--   supabase/manutencao/nfse-nbs-121011000-rollback/fn_clonar_rascunho_nfse.sql
-- Rodar os quatro e depois o valor anterior do servico padrao:
--   update public.nfse_servicos_padrao set codigo_nbs = '121012200', updated_at = now()
--    where id = 1 and codigo_nbs = '121011000';
-- Notas criadas depois desta migration ficam com o NBS que receberam; o rollback
-- nao as regrava.
-- ============================================================================
