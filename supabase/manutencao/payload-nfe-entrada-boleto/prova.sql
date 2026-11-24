-- PROVA (transacao desfeita) da migration 20261124_payload_nfe_entrada_mais_boleto
--
-- Rodar INTEIRO no SQL Editor. Nada fica gravado: o bloco termina com
-- RAISE EXCEPTION 'PROVA_DESFEITA {json}', que desfaz tudo — a troca da funcao,
-- a nota simulada e as parcelas dela. O resultado e o JSON da mensagem de erro.
--
-- O que prova:
--   (a) amostra: as 20 ultimas NF-e AUTORIZADAS de producao de cada grupo
--       (BOLETO = so forma 15 e sem duplicata; FATURADO = com duplicata;
--        PIX = so forma 17; OUTRAS_A_VISTA = outras formas) — o payload de
--       fn_montar_payload_nfe antes e depois da migration, na MESMA transacao
--       (mesmo now()), comparado por igualdade de jsonb;
--   (b) nota simulada do 25427 (copia do cabecalho da NFE-25427-001 com a ref
--       NFE-25427-PROVA, sem tocar a 001): parcela 1 ENTRADA PIX R$ 10.675,97
--       vencendo 27/11 (cobranca 25427-H) + parcela 2 boleto R$ 10.675,96
--       vencendo 04/12 (faturado 25427-I), com os numeros de duplicata que a
--       tela grava (001 e 002) — payload antes e depois;
--   (c) md5 do corpo depois de aplicar (esperado 139bc8358e5ff947c8649a67b7030fb8).
--
-- A migration e executada pelo PROPRIO texto dela (copiado abaixo, sem edicao),
-- com todas as travas (md5 antes, bloco, ACL, md5 depois).
--
-- Validade: o boleto vence 04/12/2026. Rodando a partir de 04/12 ele vira
-- "a vista" (sem duplicata) e o caso (b) deixa de ser o da nota com entrada.
-- Efeitos que a transacao nao desfaz: os contadores das sequencias de
-- notas_fiscais_pagamentos e audit.logs_v2 avancam (ids pulados).

do $prova$
declare
  r record;
  v_ref_sim constant text := 'NFE-25427-PROVA';
  v_sim_antes jsonb;
  v_sim_depois jsonb;
  v_md5_antes text;
  v_md5_depois text;
  v_comparadas jsonb;
  v_diferentes jsonb;
  v_checks jsonb;
begin
  select md5(prosrc) into v_md5_antes from pg_proc where proname = 'fn_montar_payload_nfe';

  -- (a) amostra
  create temp table _prova_amostra on commit drop as
  with base as (
    select ref, data_autorizacao, payload_envio p
      from public.notas_fiscais
     where status = 'AUTORIZADA' and ambiente = 'producao' and payload_envio is not null
  ), cls as (
    select ref, data_autorizacao,
           case
             when jsonb_array_length(coalesce(p->'duplicatas', '[]'::jsonb)) > 0 then 'FATURADO'
             when (select bool_and(x->>'forma_pagamento' = '15') from jsonb_array_elements(coalesce(p->'formas_pagamento', '[]'::jsonb)) x) then 'BOLETO'
             when (select bool_and(x->>'forma_pagamento' = '17') from jsonb_array_elements(coalesce(p->'formas_pagamento', '[]'::jsonb)) x) then 'PIX'
             else 'OUTRAS_A_VISTA'
           end as grupo
      from base
  )
  select grupo, ref, null::jsonb as antes, null::jsonb as depois
    from (select cls.*, row_number() over (partition by grupo order by data_autorizacao desc) rn from cls) t
   where rn <= 20;

  for r in select ref from _prova_amostra loop
    begin
      update _prova_amostra set antes = public.fn_montar_payload_nfe(r.ref) where ref = r.ref;
    exception when others then
      update _prova_amostra set antes = jsonb_build_object('erro', sqlerrm) where ref = r.ref;
    end;
  end loop;

  -- (b) nota simulada: copia do cabecalho da 001, outra ref, parcelas do 25427-H e 25427-I
  insert into public.notas_fiscais
  select (jsonb_populate_record(null::public.notas_fiscais,
            to_jsonb(n) || jsonb_build_object('id', gen_random_uuid(), 'ref', v_ref_sim))).*
    from public.notas_fiscais n
   where n.ref = 'NFE-25427-001';

  insert into public.notas_fiscais_pagamentos
    (id_int, ref, id_nota_fiscal, numero_parcela, total_parcelas, numero_duplicata, data_vencimento,
     valor, forma_pagamento, descricao_forma_pagamento, origem, tipo_registro, ativo)
  select 25427, v_ref_sim, n.id, x.parcela, 2, x.dup, x.venc, x.valor, x.forma, x.descr, 'AUTO', x.tipo, true
    from public.notas_fiscais n
    cross join (values
      (1, '001', date '2026-11-27', 10675.97::numeric, '17', 'PIX', 'ENTRADA'),
      (2, '002', date '2026-12-04', 10675.96::numeric, '15', 'Boleto bancário', 'PARCELA')
    ) x(parcela, dup, venc, valor, forma, descr, tipo)
   where n.ref = v_ref_sim;

  v_sim_antes := public.fn_montar_payload_nfe(v_ref_sim);

  -- A MIGRATION, pelo proprio texto
  execute $mig$do $migracao$
declare
  v_oid oid := 'public.fn_montar_payload_nfe(text)'::regprocedure;
  v_def text;
  v_src text;
  v_md5_antes text;
  v_acl_antes text;
  v_md5_depois text;
  v_src_depois text;
  v_acl_depois text;
  crlf constant text := chr(13) || chr(10);
  v_m1 text;
  v_m2 text;
  v_ini int;
  v_fim int;
  v_velho text;
  v_novo text;
  v_def_novo text;
begin
  select pg_get_functiondef(p.oid), p.prosrc, md5(p.prosrc),
         (select array_agg(coalesce(r.rolname, 'PUBLIC') order by coalesce(r.rolname, 'PUBLIC'))::text
            from aclexplode(p.proacl) x left join pg_roles r on r.oid = x.grantee)
    into v_def, v_src, v_md5_antes, v_acl_antes
    from pg_proc p where p.oid = v_oid;

  -- (a)
  if v_md5_antes <> 'e5f040db1f31d2ca57ba3d689e1e5e5b' then
    raise exception 'fn_montar_payload_nfe mudou desde que esta migration foi escrita (md5 %). Abortado.', v_md5_antes;
  end if;

  v_m1 := 'jsonb_build_object(' || crlf || '        ''formas_pagamento'',';
  v_m2 := '      )' || crlf || crlf || '      ||' || crlf || crlf
       || '      -- =====================================================' || crlf
       || '      -- Pesos';

  -- (b)
  if (length(v_src) - length(replace(v_src, v_m1, ''))) / length(v_m1) <> 1
     or (length(v_src) - length(replace(v_src, v_m2, ''))) / length(v_m2) <> 1 then
    raise exception 'Marcadores do bloco de pagamentos nao aparecem uma vez cada. Abortado.';
  end if;

  v_ini := position(v_m1 in v_src);
  v_fim := position(v_m2 in v_src);
  v_velho := substr(v_src, v_ini, v_fim - v_ini);

  -- (c)
  if md5(v_velho) <> '3f7603e8ea676b84ccf96677e59ce642' then
    raise exception 'O bloco de pagamentos nao e o esperado (md5 %). Abortado.', md5(v_velho);
  end if;

  -- O trecho novo. Abre um parentese que o `      )` do marcador 2 fecha.
  v_novo := $novo$(
      -- 24/11/2026 (caso 25427): entrada (PIX ou outra forma) + boleto a prazo.
      -- "Mista" = tem duplicata (boleto 15 com vencimento futuro) e tem parcela
      -- ativa de outra forma. So a mista ganha `indicador_pagamento` e a fatura
      -- explicita; as outras notas saem exatamente como antes.
      jsonb_build_object(
        'formas_pagamento',
          (
            select coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'forma_pagamento', fp.forma_pagamento,
                  'valor_pagamento', to_char(fp.valor_total, 'FM9999999990.00')
                )
                || case
                     when exists (
                            select 1 from public.notas_fiscais_pagamentos d
                             where d.ref = nf.ref and coalesce(d.ativo, true) = true
                               and d.forma_pagamento = '15'
                               and d.data_vencimento > (now() at time zone 'America/Sao_Paulo')::date)
                      and exists (
                            select 1 from public.notas_fiscais_pagamentos o
                             where o.ref = nf.ref and coalesce(o.ativo, true) = true
                               and o.forma_pagamento is distinct from '15')
                     then jsonb_build_object('indicador_pagamento',
                            case when fp.forma_pagamento = '15' then '1' else '0' end)
                     else '{}'::jsonb
                   end
                order by fp.forma_pagamento
              ),
              '[]'::jsonb
            )
            from (
              select
                nfp.forma_pagamento,
                sum(coalesce(nfp.valor, 0)) as valor_total
              from public.notas_fiscais_pagamentos nfp
              where nfp.ref = nf.ref
                and coalesce(nfp.ativo, true) = true
              group by nfp.forma_pagamento
            ) fp
          ),

        'duplicatas',
          (
            select coalesce(
              jsonb_agg(
                jsonb_build_object(
                  -- 24/11/2026: numero = posicao entre os boletos (001, 002...),
                  -- nao o numero gravado na parcela. A Focus exige sequencia
                  -- consecutiva a partir de 001.
                  'numero', lpad(dd.posicao::text, 3, '0'),
                  'data_vencimento', to_char(dd.data_vencimento, 'YYYY-MM-DD'),
                  'valor', to_char(coalesce(dd.valor, 0), 'FM9999999990.00')
                )
                order by dd.posicao
              ),
              '[]'::jsonb
            )
            from (
              select
                nfp.data_vencimento,
                nfp.valor,
                row_number() over (order by nfp.numero_parcela, nfp.id) as posicao
              from public.notas_fiscais_pagamentos nfp
              where nfp.ref = nf.ref
                and coalesce(nfp.ativo, true) = true
                and nfp.forma_pagamento = '15'
                -- 15/09/2026: duplicata so com vencimento FUTURO. Parcela que vence
                -- na data de emissao e pagamento a vista e nao leva cobranca
                -- (rejeicao 853). Mesma data de `data_emissao`, acima.
                and nfp.data_vencimento > (now() at time zone 'America/Sao_Paulo')::date
            ) dd
          )
      )
      ||
      (
        -- 24/11/2026: fatura explicita so na nota mista = soma dos boletos.
        select case
                 when count(*) > 0
                  and exists (
                        select 1 from public.notas_fiscais_pagamentos o
                         where o.ref = nf.ref and coalesce(o.ativo, true) = true
                           and o.forma_pagamento is distinct from '15')
                 then jsonb_build_object(
                        'valor_original_fatura', to_char(sum(coalesce(d.valor, 0)), 'FM9999999990.00'),
                        'valor_desconto_fatura', '0.00',
                        'valor_liquido_fatura', to_char(sum(coalesce(d.valor, 0)), 'FM9999999990.00'))
                 else '{}'::jsonb
               end
          from public.notas_fiscais_pagamentos d
         where d.ref = nf.ref
           and coalesce(d.ativo, true) = true
           and d.forma_pagamento = '15'
           and d.data_vencimento > (now() at time zone 'America/Sao_Paulo')::date
      )
$novo$;
  -- Normaliza para CRLF, como o resto do corpo.
  v_novo := replace(replace(v_novo, crlf, chr(10)), chr(10), crlf);

  v_def_novo := replace(v_def, v_velho, v_novo);
  if v_def_novo = v_def then
    raise exception 'A troca nao aconteceu na definicao. Abortado.';
  end if;
  execute v_def_novo;

  select p.prosrc, md5(p.prosrc),
         (select array_agg(coalesce(r.rolname, 'PUBLIC') order by coalesce(r.rolname, 'PUBLIC'))::text
            from aclexplode(p.proacl) x left join pg_roles r on r.oid = x.grantee)
    into v_src_depois, v_md5_depois, v_acl_depois
    from pg_proc p where p.oid = v_oid;

  -- (d)
  if md5(replace(v_src_depois, v_novo, v_velho)) <> v_md5_antes then
    raise exception 'O corpo novo difere do antigo alem do bloco de pagamentos. Abortado.';
  end if;

  -- (e)
  if v_acl_depois is distinct from v_acl_antes then
    raise exception 'ACL mudou: % -> %. Abortado.', v_acl_antes, v_acl_depois;
  end if;

  -- (f)
  if v_md5_depois <> '139bc8358e5ff947c8649a67b7030fb8' then
    raise exception 'md5 do corpo novo % diferente do esperado. Abortado.', v_md5_depois;
  end if;

  raise notice 'fn_montar_payload_nfe: md5 % -> %, ACL %', v_md5_antes, v_md5_depois, v_acl_depois;
end
$migracao$$mig$;

  select md5(prosrc) into v_md5_depois from pg_proc where proname = 'fn_montar_payload_nfe';

  for r in select ref from _prova_amostra loop
    begin
      update _prova_amostra set depois = public.fn_montar_payload_nfe(r.ref) where ref = r.ref;
    exception when others then
      update _prova_amostra set depois = jsonb_build_object('erro', sqlerrm) where ref = r.ref;
    end;
  end loop;

  v_sim_depois := public.fn_montar_payload_nfe(v_ref_sim);

  select jsonb_object_agg(grupo, jsonb_build_object('comparadas', n, 'iguais', iguais))
    into v_comparadas
    from (select grupo, count(*) n, count(*) filter (where antes = depois) iguais
            from _prova_amostra group by grupo) g;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ref', ref, 'grupo', grupo,
           'antes', jsonb_build_object('formas_pagamento', antes->'formas_pagamento', 'duplicatas', antes->'duplicatas', 'erro', antes->'erro'),
           'depois', jsonb_build_object('formas_pagamento', depois->'formas_pagamento', 'duplicatas', depois->'duplicatas', 'erro', depois->'erro'))), '[]'::jsonb)
    into v_diferentes
    from _prova_amostra where antes is distinct from depois;

  v_checks := jsonb_build_object(
    'pix_a_vista_e_boleto_a_prazo',
      v_sim_depois->'formas_pagamento' = '[{"forma_pagamento":"15","valor_pagamento":"10675.96","indicador_pagamento":"1"},{"forma_pagamento":"17","valor_pagamento":"10675.97","indicador_pagamento":"0"}]'::jsonb,
    'duplicatas_so_do_boleto_001',
      v_sim_depois->'duplicatas' = '[{"numero":"001","data_vencimento":"2026-12-04","valor":"10675.96"}]'::jsonb,
    'fatura_igual_soma_dos_boletos',
      v_sim_depois->>'valor_original_fatura' = '10675.96'
      and v_sim_depois->>'valor_liquido_fatura' = '10675.96'
      and v_sim_depois->>'valor_desconto_fatura' = '0.00',
    'resto_do_payload_igual',
      (v_sim_antes - 'formas_pagamento' - 'duplicatas')
        = (v_sim_depois - 'formas_pagamento' - 'duplicatas' - 'valor_original_fatura' - 'valor_desconto_fatura' - 'valor_liquido_fatura'),
    'md5_depois_esperado', v_md5_depois = '139bc8358e5ff947c8649a67b7030fb8'
  );

  raise exception 'PROVA_DESFEITA %', jsonb_build_object(
    'a_amostra', v_comparadas,
    'a_total_comparadas', (select count(*) from _prova_amostra),
    'a_total_iguais', (select count(*) from _prova_amostra where antes = depois),
    'a_diferentes', v_diferentes,
    'b_simulada_antes', jsonb_build_object(
       'formas_pagamento', v_sim_antes->'formas_pagamento',
       'duplicatas', v_sim_antes->'duplicatas',
       'valor_total', v_sim_antes->'valor_total'),
    'b_simulada_depois', jsonb_build_object(
       'formas_pagamento', v_sim_depois->'formas_pagamento',
       'duplicatas', v_sim_depois->'duplicatas',
       'valor_original_fatura', v_sim_depois->'valor_original_fatura',
       'valor_desconto_fatura', v_sim_depois->'valor_desconto_fatura',
       'valor_liquido_fatura', v_sim_depois->'valor_liquido_fatura',
       'valor_total', v_sim_depois->'valor_total'),
    'b_checks', v_checks,
    'c_md5_antes', v_md5_antes,
    'c_md5_depois', v_md5_depois
  );
end
$prova$;
