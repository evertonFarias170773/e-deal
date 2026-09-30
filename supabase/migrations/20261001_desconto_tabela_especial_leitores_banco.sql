-- ============================================================================
-- Bonus da tabela especial gravado na venda — Fase 1: os LEITORES do banco
-- ============================================================================
--
-- CONTEXTO (CONTA-CORRENTE-CREDITO.md §4.2, item 13; decisao de 19/08/2026)
--   O bonus de tabela especial vive so no front, pelo percentual de HOJE do
--   cliente. O banco calcula o total BRUTO, e `cc_abrir_pendencia` recusa com
--   CC_TOTAL_DIVERGENTE a edicao de proposta paga de cliente com bonus (36
--   propostas em 30/09, entre elas a 22930). A correcao: gravar o bonus da venda
--   como linha propria em `desconto_proposta`, tipo TABELA_ESPECIAL.
--
--   Esta fase so ENSINA os leitores do banco a entender a linha. Nenhuma linha
--   TABELA_ESPECIAL existe ainda (a carga e a Fase 3, com autorizacao propria),
--   entao NADA muda no comportamento hoje.
--
-- O QUE MUDA
--   indice   desconto_proposta_uma_tabela_especial: no maximo UMA linha
--            TABELA_ESPECIAL por proposta.
--   cc__total_soberano_proposta  aplica o percentual da linha nos produtos,
--            ANTES do desconto geral — a ordem de `calculateItemSubtotal` +
--            `calculateResumo` no app.
--   recalcular_proposta_v3  (GRAVA propostas.valor e valor_total; disparada por
--            trg_recalc_after_frete) — o mesmo, e as duas leituras "LIMIT 1" de
--            desconto deixam de poder pegar a linha TABELA_ESPECIAL.
--   recalcular_proposta_v4  (so devolve valores; o trigger descarta) — idem.
--   copiar_proposta_v2 / duplicar_proposta  nao copiam a linha: a copia e
--            proposta nova e usa o bonus vigente.
--   gerar_texto_whatsapp_e_salvar  a leitura "LIMIT 1" deixa de poder pegar a
--            linha. (Sem chamador no repositorio nem no banco.)
--
--   Sem a linha, cada expressao nova cai EXATAMENTE na antiga: nenhum valor muda,
--   nem de escala (o bonus so entra num IF/CASE com percentual > 0).
--
-- TRAVAS
--   a) md5(prosrc) de cada funcao igual ao lido ao escrever — mudou, aborta;
--   b) cada ancora aparece o numero de vezes esperado; desfeitas as trocas, o
--      texto volta IDENTICO;
--   c) ACL, SECURITY DEFINER e search_path iguais;
--   d) para TODAS as propostas, cc__total_soberano_proposta e o retorno da v4
--      iguais antes e depois. As que gravam (v3, copias, whatsapp) nao sao
--      executadas: a prova delas e (a) + (b).
--
-- ROLLBACK
--   drop index public.desconto_proposta_uma_tabela_especial;
--   e desfazer as trocas (a trava b garante que o texto volta identico).
-- ============================================================================

do $migracao$
declare
  v_fn          text;
  v_def         text;
  v_nova        text;
  v_volta       text;
  v_nl          text;
  v_n           int;
  v_diferentes  int;
  v_total       int;
  v_esperado    jsonb := jsonb_build_object(
    'cc__total_soberano_proposta(bigint)', 'ee7ca87aa5335009edc86d06535acc62',
    'recalcular_proposta_v3(integer)',     '26bf78c303da0265ffcd1355eb69b3a8',
    'recalcular_proposta_v4(integer)',     '27ce601f9424ddc95da334574bef418b',
    'copiar_proposta_v2(integer)',         '94a8abd49f4bc833cacac9b26c6ce41f',
    'duplicar_proposta(bigint)',           '35fe7fd27d7b95207e668aa06ad400a4',
    'gerar_texto_whatsapp_e_salvar(bigint)', '140c7c4adabe2526af1cc7b1b2e055a0'
  );
  v_acl_antes   jsonb;
  v_acl_depois  jsonb;
  v_md5_depois  jsonb := '{}'::jsonb;
  -- trocas: [de, para, ocorrencias esperadas]
  de            text[];
  para          text[];
  qtd           int[];
  i             int;
begin
  -- ==========================================================================
  -- 0. O ANTES
  -- ==========================================================================
  for v_fn in select jsonb_object_keys(v_esperado) loop
    if (select md5(p.prosrc) from pg_proc p where p.oid = ('public.' || v_fn)::regprocedure)
       is distinct from v_esperado ->> v_fn then
      raise exception '% mudou desde que esta migration foi escrita. Abortado.', v_fn;
    end if;
  end loop;

  if exists (select 1 from public.desconto_proposta where tipo_desconto = 'TABELA_ESPECIAL') then
    raise exception 'ja existe linha TABELA_ESPECIAL: a prova de diferenca zero nao valeria';
  end if;

  select jsonb_object_agg(p.oid::regprocedure::text,
           coalesce(array_to_string(p.proacl, ' | '), '') || '|' || p.prosecdef::text || '|' || coalesce(p.proconfig::text, ''))
    into v_acl_antes
    from pg_proc p
   where p.oid in (select ('public.' || k)::regprocedure from jsonb_object_keys(v_esperado) k);

  create temp table _antes on commit drop as
    select p.id_int,
           public.cc__total_soberano_proposta(p.id_int) as soberano,
           (select row(v.*)::text from public.recalcular_proposta_v4(p.id_int::integer) v) as v4
      from public.propostas p;

  -- ==========================================================================
  -- 1. Indice: no maximo uma linha TABELA_ESPECIAL por proposta
  -- ==========================================================================
  create unique index if not exists desconto_proposta_uma_tabela_especial
    on public.desconto_proposta (id_int)
    where tipo_desconto = 'TABELA_ESPECIAL';

  -- ==========================================================================
  -- 2. As trocas, funcao a funcao
  -- ==========================================================================
  for v_fn in select jsonb_object_keys(v_esperado) loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p where p.oid = ('public.' || v_fn)::regprocedure;
    v_nl := case when position(chr(13) in v_def) > 0 then chr(13) || chr(10) else chr(10) end;

    if v_fn = 'cc__total_soberano_proposta(bigint)' then
      de   := array[
        $x$  v_desconto numeric;$x$ || v_nl,
        $x$     AND COALESCE(status_item, 'PENDENTE') <> 'CANCELADO';$x$ || v_nl
      ];
      para := array[
        $x$  v_desconto numeric;$x$ || v_nl || $x$  v_bonus_pct numeric;$x$ || v_nl,
        $x$     AND COALESCE(status_item, 'PENDENTE') <> 'CANCELADO';$x$ || v_nl
        || v_nl
        || $x$  -- Bonus da tabela especial GRAVADO na venda (linha TABELA_ESPECIAL,$x$ || v_nl
        || $x$  -- 01/10/2026): sai dos produtos ANTES do desconto geral, como no app.$x$ || v_nl
        || $x$  -- Sem a linha, o subtotal fica exatamente como era.$x$ || v_nl
        || $x$  SELECT valor_percentual INTO v_bonus_pct$x$ || v_nl
        || $x$    FROM public.desconto_proposta$x$ || v_nl
        || $x$   WHERE id_int = p_id_int AND tipo_desconto = 'TABELA_ESPECIAL';$x$ || v_nl
        || $x$  IF COALESCE(v_bonus_pct, 0) > 0 THEN$x$ || v_nl
        || $x$    v_subtotal := GREATEST(0, v_subtotal - v_subtotal * v_bonus_pct / 100);$x$ || v_nl
        || $x$  END IF;$x$ || v_nl
      ];
      qtd  := array[1, 1];

    elsif v_fn = 'recalcular_proposta_v3(integer)' then
      de   := array[
        $x$    v_valor_gravado    numeric := 0;$x$ || v_nl,
        $x$        FROM desconto_proposta$x$ || v_nl || $x$        WHERE id_int = p_id_int$x$ || v_nl || $x$        LIMIT 1$x$,
        $x$        -- NAO AVULSA: byte a byte o comportamento de sempre.$x$ || v_nl
      ];
      para := array[
        $x$    v_valor_gravado    numeric := 0;$x$ || v_nl || $x$    v_bonus_pct        numeric := 0;$x$ || v_nl,
        $x$        FROM desconto_proposta$x$ || v_nl || $x$        WHERE id_int = p_id_int$x$ || v_nl
        || $x$          AND tipo_desconto IS DISTINCT FROM 'TABELA_ESPECIAL'$x$ || v_nl || $x$        LIMIT 1$x$,
        $x$        -- NAO AVULSA: byte a byte o comportamento de sempre.$x$ || v_nl
        || $x$        -- Bonus da tabela especial GRAVADO na venda (linha TABELA_ESPECIAL,$x$ || v_nl
        || $x$        -- 01/10/2026): sai dos produtos ANTES do desconto geral, como no$x$ || v_nl
        || $x$        -- app. Sem a linha, nada muda.$x$ || v_nl
        || $x$        SELECT valor_percentual INTO v_bonus_pct$x$ || v_nl
        || $x$        FROM desconto_proposta$x$ || v_nl
        || $x$        WHERE id_int = p_id_int AND tipo_desconto = 'TABELA_ESPECIAL'$x$ || v_nl
        || $x$        LIMIT 1;$x$ || v_nl
        || $x$        IF COALESCE(v_bonus_pct, 0) > 0 THEN$x$ || v_nl
        || $x$            v_valor_produtos := v_valor_produtos - (v_valor_produtos * v_bonus_pct) / 100;$x$ || v_nl
        || $x$        END IF;$x$ || v_nl
      ];
      qtd  := array[1, 2, 1];

    elsif v_fn = 'recalcular_proposta_v4(integer)' then
      de   := array[
        $x$WHERE dp.id_int = p_id_int$x$,
        $x$SELECT SUM(pp.valor_sub_total)$x$
      ];
      para := array[
        $x$WHERE dp.id_int = p_id_int AND dp.tipo_desconto IS DISTINCT FROM 'TABELA_ESPECIAL'$x$,
        $x$SELECT CASE WHEN COALESCE((SELECT dpb.valor_percentual FROM desconto_proposta dpb WHERE dpb.id_int = p_id_int AND dpb.tipo_desconto = 'TABELA_ESPECIAL' LIMIT 1), 0) > 0 THEN SUM(pp.valor_sub_total) - SUM(pp.valor_sub_total) * (SELECT dpb.valor_percentual FROM desconto_proposta dpb WHERE dpb.id_int = p_id_int AND dpb.tipo_desconto = 'TABELA_ESPECIAL' LIMIT 1) / 100 ELSE SUM(pp.valor_sub_total) END$x$
      ];
      qtd  := array[6, 4];

    elsif v_fn in ('copiar_proposta_v2(integer)', 'duplicar_proposta(bigint)') then
      de   := array[
        $x$  FROM public.desconto_proposta$x$ || v_nl || $x$  WHERE id_int = p_id_int_origem;$x$
      ];
      para := array[
        $x$  FROM public.desconto_proposta$x$ || v_nl || $x$  WHERE id_int = p_id_int_origem$x$ || v_nl
        || $x$    -- O bonus da venda (TABELA_ESPECIAL) NAO vai para a copia: ela e$x$ || v_nl
        || $x$    -- proposta nova e usa o bonus vigente do cliente (01/10/2026).$x$ || v_nl
        || $x$    AND tipo_desconto IS DISTINCT FROM 'TABELA_ESPECIAL';$x$
      ];
      qtd  := array[1];

    else -- gerar_texto_whatsapp_e_salvar(bigint)
      de   := array[
        $x$  FROM desconto_proposta$x$ || v_nl || $x$  WHERE id_int = p_id_int$x$ || v_nl || $x$  LIMIT 1;$x$
      ];
      para := array[
        $x$  FROM desconto_proposta$x$ || v_nl || $x$  WHERE id_int = p_id_int$x$ || v_nl
        || $x$    AND tipo_desconto IS DISTINCT FROM 'TABELA_ESPECIAL'$x$ || v_nl || $x$  LIMIT 1;$x$
      ];
      qtd  := array[1];
    end if;

    v_nova := v_def;
    for i in 1 .. array_length(de, 1) loop
      v_n := (length(v_def) - length(replace(v_def, de[i], ''))) / length(de[i]);
      if v_n <> qtd[i] then
        raise exception '%: ancora % aparece % vezes (esperado %)', v_fn, i, v_n, qtd[i];
      end if;
      v_nova := replace(v_nova, de[i], para[i]);
    end loop;

    v_volta := v_nova;
    for i in reverse array_length(de, 1) .. 1 loop
      v_volta := replace(v_volta, para[i], de[i]);
    end loop;
    if v_volta is distinct from v_def then
      raise exception '%: a troca alcancou algo alem das ancoras', v_fn;
    end if;

    execute v_nova;

    v_md5_depois := v_md5_depois || jsonb_build_object(v_fn,
      (select md5(p.prosrc) from pg_proc p where p.oid = ('public.' || v_fn)::regprocedure));
  end loop;

  -- ==========================================================================
  -- 3. ASSERCOES
  -- ==========================================================================
  select jsonb_object_agg(p.oid::regprocedure::text,
           coalesce(array_to_string(p.proacl, ' | '), '') || '|' || p.prosecdef::text || '|' || coalesce(p.proconfig::text, ''))
    into v_acl_depois
    from pg_proc p
   where p.oid in (select ('public.' || k)::regprocedure from jsonb_object_keys(v_esperado) k);
  if v_acl_depois is distinct from v_acl_antes then
    raise exception 'ACL/secdef/config mudaram: % -> %', v_acl_antes, v_acl_depois;
  end if;

  select count(*),
         count(*) filter (where a.soberano is distinct from public.cc__total_soberano_proposta(a.id_int)
                             or a.v4 is distinct from (select row(v.*)::text from public.recalcular_proposta_v4(a.id_int::integer) v))
    into v_total, v_diferentes
    from _antes a;
  if v_diferentes <> 0 then
    raise exception '% de % propostas mudaram de total. Abortado.', v_diferentes, v_total;
  end if;

  raise notice 'ok: % propostas, 0 diferencas; md5 depois: %', v_total, v_md5_depois;
end
$migracao$;
