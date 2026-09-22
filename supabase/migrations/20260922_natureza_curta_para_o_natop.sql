-- ============================================================================
-- Natureza da operacao que cabe nos 60 caracteres do natOp
-- ============================================================================
--
-- O QUE MUDA
--   1. Coluna `natureza_curta` em `nfe_naturezas_operacao`: texto anulavel, com
--      CHECK de ate 60 caracteres. Preenchida SO nas linhas cuja `descricao`
--      sem o prefixo "NNNN - " passa de 60.
--   2. `fn_defaults_rascunho_nfe` e `fn_sync_natureza_operacao_nfe` passam a
--      preferir esse texto curto quando ele existe. Sem ele, seguem tirando o
--      prefixo da descricao, exatamente como antes.
--
-- POR QUE
--   O campo `natOp` da NF-e tem limite de 60. A natureza da nota e gravada a
--   partir de `descricao` sem o prefixo do CFOP, e tres pares estouram:
--
--     5949/6949  66 caracteres
--     1202/2202  67
--     5108/6108  84
--
--   A conferencia de layout (limites-layout-nfe.ts) barra a emissao nesses
--   casos — e estava barrando uma nota real da E3 BRINDES, de R$ 3.467,50, em
--   natureza 6949.
--
--   `descricao` NAO pode encurtar: e a chave que casa `drop_natureza_op` da
--   nota com o catalogo, e mexer nela desligaria a derivacao de CFOP e de
--   tributacao de toda nota ja gravada. Dai a coluna nova: o rotulo continua
--   inteiro na tela, e o documento leva a versao curta.
--
-- OS TEXTOS ESCOLHIDOS
--   5949/6949  Outra saida de mercadoria nao especificada           (41)
--   5108/6108  Venda de mercadoria de terceiros a nao contribuinte  (50)
--   1202/2202  Devolucao de venda de mercadoria de terceiros        (44)
--
--   Os tres preservam o sentido fiscal do CFOP: o que sai e a parte redundante
--   ("adquirida ou recebida de", "ou prestacao de servico" — numa NF-e de
--   mercadoria). Acentuacao correta nos valores gravados.
--
-- METODO NAS FUNCOES
--   O de sempre: le a definicao VIVA com `pg_get_functiondef`, troca com
--   ancoras conferidas uma a uma, DESFAZ as trocas e exige o texto de volta
--   IDENTICO ao original. Sem E-string em lugar nenhum — as duas funcoes tem
--   `\s` e `\d` de regex no corpo, e foi uma E-string que engoliu o `\D` na
--   migration da remessa (82c5c8e).
--
--   As duas usam quebras de linha DIFERENTES (uma LF, outra CRLF), entao cada
--   ancora e montada com a quebra da propria funcao.
--
-- ROLLBACK
--   alter table public.nfe_naturezas_operacao drop constraint nfe_naturezas_operacao_natureza_curta_ate_60;
--   alter table public.nfe_naturezas_operacao drop column natureza_curta;
--   (e recriar as duas funcoes a partir do texto anterior, que a propria
--   migration exige ser reversivel)
-- ============================================================================

do $migracao$
declare
  v_def           text;
  v_nova          text;
  v_volta         text;
  v_nl            text;
  v_acl_antes     jsonb;
  v_acl_depois    jsonb;
  v_catalogo      text;
  v_catalogo_dep  text;
  v_maior         int;
  v_notas_antes   text;
  v_notas_depois  text;
  v_ocorrencias   int;
  v_ancora        text;
  de_1            text;
  para_1          text;
  de_2            text;
  para_2          text;
  de_3            text;
  para_3          text;
begin
  -- ==========================================================================
  -- 0. O ANTES
  -- ==========================================================================
  select jsonb_object_agg(p.proname, jsonb_build_object(
           'acl', coalesce(array_to_string(p.proacl, ' | '), ''),
           'secdef', p.prosecdef,
           'config', coalesce(p.proconfig::text, '')))
    into v_acl_antes
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fn_defaults_rascunho_nfe', 'fn_sync_natureza_operacao_nfe');

  -- O que NAO pode mudar no catalogo.
  select md5(string_agg(x.linha, ',' order by x.linha)) into v_catalogo
    from (select n.id || '|' || n.cfop || '|' || n.descricao || '|' || coalesce(n.tipo_operacao,'') || '|'
              || coalesce(n.destino_operacao,'') || '|' || coalesce(n.modelo_fiscal,'') || '|'
              || coalesce(n.icms_situacao_tributaria,'') || '|' || coalesce(n.pis_situacao_tributaria,'') || '|'
              || coalesce(n.cofins_situacao_tributaria,'') || '|' || n.ativo::text as linha
            from public.nfe_naturezas_operacao n) x;

  select count(*)::text || '|' || coalesce(max(updated_at)::text, '') into v_notas_antes
    from public.notas_fiscais;

  -- ==========================================================================
  -- 1. A coluna
  -- ==========================================================================
  alter table public.nfe_naturezas_operacao add column if not exists natureza_curta text;

  alter table public.nfe_naturezas_operacao drop constraint if exists nfe_naturezas_operacao_natureza_curta_ate_60;
  alter table public.nfe_naturezas_operacao
    add constraint nfe_naturezas_operacao_natureza_curta_ate_60
    check (natureza_curta is null or char_length(btrim(natureza_curta)) between 1 and 60);

  comment on column public.nfe_naturezas_operacao.natureza_curta is
    'Texto que vai no campo natOp da NF-e quando a descricao sem o prefixo "NNNN - " passa dos 60 caracteres do layout. Nulo = usa a descricao sem prefixo, como sempre. A descricao NAO pode ser encurtada: e a chave que casa notas_fiscais.drop_natureza_op com este catalogo. Criada em 22/09/2026.';

  -- ==========================================================================
  -- 2. Os tres pares que estouram
  -- ==========================================================================
  update public.nfe_naturezas_operacao
     set natureza_curta = 'Outra saída de mercadoria não especificada', updated_at = now()
   where modelo_fiscal = 'NFE' and cfop in ('5949', '6949');

  update public.nfe_naturezas_operacao
     set natureza_curta = 'Venda de mercadoria de terceiros a não contribuinte', updated_at = now()
   where modelo_fiscal = 'NFE' and cfop in ('5108', '6108');

  update public.nfe_naturezas_operacao
     set natureza_curta = 'Devolução de venda de mercadoria de terceiros', updated_at = now()
   where modelo_fiscal = 'NFE' and cfop in ('1202', '2202');

  -- ==========================================================================
  -- 3. fn_defaults_rascunho_nfe
  -- ==========================================================================
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.oid = 'public.fn_defaults_rascunho_nfe()'::regprocedure;
  v_nl := case when position(chr(13) in v_def) > 0 then chr(13) || chr(10) else chr(10) end;

  de_1   := $x$  v_natureza text;$x$;
  para_1 := $x$  v_natureza text;$x$ || v_nl || $x$  v_curta text;$x$;

  de_2   := $x$    select n.descricao$x$ || v_nl || $x$      into v_descricao$x$;
  para_2 := $x$    select n.descricao, nullif(btrim(n.natureza_curta), '')$x$ || v_nl
         || $x$      into v_descricao, v_curta$x$;

  de_3   := $x$      v_natureza := trim(regexp_replace(v_descricao, '^\s*\d{4}\s*-\s*', ''));$x$;
  para_3 := $x$      -- O texto CURTO do catalogo tem preferencia: e o que cabe nos 60$x$ || v_nl
         || $x$      -- caracteres do natOp. Sem ele, tira o prefixo, como sempre.$x$ || v_nl
         || $x$      v_natureza := coalesce($x$ || v_nl
         || $x$        v_curta,$x$ || v_nl
         || $x$        trim(regexp_replace(v_descricao, '^\s*\d{4}\s*-\s*', ''))$x$ || v_nl
         || $x$      );$x$;

  foreach v_ancora in array array[de_1, de_2, de_3] loop
    v_ocorrencias := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
    if v_ocorrencias <> 1 then
      raise exception 'ancora de fn_defaults_rascunho_nfe aparece % vezes: %', v_ocorrencias, v_ancora;
    end if;
  end loop;

  v_nova := replace(replace(replace(v_def, de_1, para_1), de_2, para_2), de_3, para_3);
  v_volta := replace(replace(replace(v_nova, para_1, de_1), para_2, de_2), para_3, de_3);
  if v_volta is distinct from v_def then
    raise exception 'fn_defaults_rascunho_nfe: a troca alcancou algo alem das tres ancoras';
  end if;
  execute v_nova;

  -- ==========================================================================
  -- 4. fn_sync_natureza_operacao_nfe
  -- ==========================================================================
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.oid = 'public.fn_sync_natureza_operacao_nfe()'::regprocedure;
  v_nl := case when position(chr(13) in v_def) > 0 then chr(13) || chr(10) else chr(10) end;

  de_1 := $x$    new.natureza_operacao :=$x$ || v_nl
       || $x$      case$x$ || v_nl
       || $x$        when new.drop_natureza_op ~ '^\s*\d{4}\s*-'$x$ || v_nl
       || $x$          then trim(regexp_replace(new.drop_natureza_op, '^\s*\d{4}\s*-\s*', ''))$x$ || v_nl
       || $x$        else trim(new.drop_natureza_op)$x$ || v_nl
       || $x$      end;$x$;

  para_1 := $x$    -- O texto CURTO do catalogo tem preferencia: e o que cabe nos 60$x$ || v_nl
         || $x$    -- caracteres do natOp. A descricao casa a nota com o catalogo.$x$ || v_nl
         || $x$    select nullif(btrim(n.natureza_curta), '')$x$ || v_nl
         || $x$      into new.natureza_operacao$x$ || v_nl
         || $x$      from public.nfe_naturezas_operacao n$x$ || v_nl
         || $x$     where n.descricao = new.drop_natureza_op$x$ || v_nl
         || $x$       and n.modelo_fiscal = 'NFE'$x$ || v_nl
         || $x$     limit 1;$x$ || v_nl
         || v_nl
         || $x$    if new.natureza_operacao is null then$x$ || v_nl
         || $x$      new.natureza_operacao :=$x$ || v_nl
         || $x$        case$x$ || v_nl
         || $x$          when new.drop_natureza_op ~ '^\s*\d{4}\s*-'$x$ || v_nl
         || $x$            then trim(regexp_replace(new.drop_natureza_op, '^\s*\d{4}\s*-\s*', ''))$x$ || v_nl
         || $x$          else trim(new.drop_natureza_op)$x$ || v_nl
         || $x$        end;$x$ || v_nl
         || $x$    end if;$x$;

  v_ocorrencias := (length(v_def) - length(replace(v_def, de_1, ''))) / length(de_1);
  if v_ocorrencias <> 1 then
    raise exception 'ancora de fn_sync_natureza_operacao_nfe aparece % vezes', v_ocorrencias;
  end if;

  v_nova := replace(v_def, de_1, para_1);
  v_volta := replace(v_nova, para_1, de_1);
  if v_volta is distinct from v_def then
    raise exception 'fn_sync_natureza_operacao_nfe: a troca alcancou algo alem da ancora';
  end if;
  execute v_nova;

  -- ==========================================================================
  -- 5. ASSERCOES
  -- ==========================================================================

  -- 5.1 Toda linha de NF-e cabe no natOp.
  select max(char_length(coalesce(nullif(btrim(n.natureza_curta), ''),
                                  btrim(regexp_replace(n.descricao, '^\s*\d{4}\s*-\s*', '')))))
    into v_maior
    from public.nfe_naturezas_operacao n
   where coalesce(n.modelo_fiscal, 'NFE') = 'NFE';
  if v_maior > 60 then
    raise exception 'assercao 1 falhou: ainda ha natureza de % caracteres', v_maior;
  end if;

  -- 5.2 So estourava quem devia: quem cabia continua sem texto curto.
  if exists (
    select 1 from public.nfe_naturezas_operacao n
     where coalesce(n.modelo_fiscal, 'NFE') = 'NFE'
       and n.natureza_curta is not null
       and char_length(btrim(regexp_replace(n.descricao, '^\s*\d{4}\s*-\s*', ''))) <= 60
  ) then
    raise exception 'assercao 2 falhou: linha que ja cabia ganhou texto curto';
  end if;
  if exists (
    select 1 from public.nfe_naturezas_operacao n
     where coalesce(n.modelo_fiscal, 'NFE') = 'NFE'
       and n.natureza_curta is null
       and char_length(btrim(regexp_replace(n.descricao, '^\s*\d{4}\s*-\s*', ''))) > 60
  ) then
    raise exception 'assercao 2 falhou: linha que estoura ficou sem texto curto';
  end if;

  -- 5.3 O resto do catalogo nao mudou: descricao, cfop, tipo, destino, tributacao.
  select md5(string_agg(x.linha, ',' order by x.linha)) into v_catalogo_dep
    from (select n.id || '|' || n.cfop || '|' || n.descricao || '|' || coalesce(n.tipo_operacao,'') || '|'
              || coalesce(n.destino_operacao,'') || '|' || coalesce(n.modelo_fiscal,'') || '|'
              || coalesce(n.icms_situacao_tributaria,'') || '|' || coalesce(n.pis_situacao_tributaria,'') || '|'
              || coalesce(n.cofins_situacao_tributaria,'') || '|' || n.ativo::text as linha
            from public.nfe_naturezas_operacao n) x;
  if v_catalogo_dep is distinct from v_catalogo then
    raise exception 'assercao 3 falhou: o catalogo mudou alem da coluna nova';
  end if;

  -- 5.4 Nenhuma nota foi tocada pela migration.
  select count(*)::text || '|' || coalesce(max(updated_at)::text, '') into v_notas_depois
    from public.notas_fiscais;
  if v_notas_depois is distinct from v_notas_antes then
    raise exception 'assercao 4 falhou: notas_fiscais mudou (% -> %)', v_notas_antes, v_notas_depois;
  end if;

  -- 5.5 ACL, SECURITY DEFINER e search_path das duas funcoes.
  select jsonb_object_agg(p.proname, jsonb_build_object(
           'acl', coalesce(array_to_string(p.proacl, ' | '), ''),
           'secdef', p.prosecdef,
           'config', coalesce(p.proconfig::text, '')))
    into v_acl_depois
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fn_defaults_rascunho_nfe', 'fn_sync_natureza_operacao_nfe');
  if v_acl_depois is distinct from v_acl_antes then
    raise exception 'assercao 5 falhou: ACL/secdef/config mudaram (% -> %)', v_acl_antes, v_acl_depois;
  end if;

  raise notice 'ok: maior natureza de NF-e agora tem % caracteres', v_maior;
end
$migracao$;
