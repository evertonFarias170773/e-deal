-- NF-e: entrada (PIX ou outra forma) + restante em boleto a prazo
--
-- PEDIDO E DECISAO (Everton, 24/11/2026, caso 25427)
--   A nota com entrada em PIX e restante em boleto vai assim:
--     - pagamento PIX a vista (indicador 0), sem duplicata;
--     - pagamento boleto a prazo (indicador 1);
--     - fatura = soma dos boletos (original = liquido, desconto 0);
--     - duplicatas so dos boletos, numeradas 001, 002... (a Focus exige numero
--       de 3 algarismos, sequencial e consecutivo).
--   Autorizacao: escrever esta migration (nao aplicar nesta rodada).
--
-- O QUE MUDA em `public.fn_montar_payload_nfe(text)` — SO o bloco
-- "Pagamentos / Duplicatas":
--   1) `duplicatas.numero` passa a ser a posicao do boleto entre os boletos com
--      vencimento futuro (lpad 3), e nao mais `numero_duplicata` gravado na
--      parcela. Com a entrada PIX como parcela 1 (numero gravado 001), o
--      primeiro boleto saia 002 sem existir 001.
--   2) Nota MISTA = tem duplicata (boleto 15 com vencimento futuro) E tem
--      parcela ativa de outra forma (17, 03, 99...). So nela:
--        - cada item de `formas_pagamento` ganha `indicador_pagamento`
--          ('1' para 15, '0' para as outras);
--        - o payload ganha `valor_original_fatura`, `valor_desconto_fatura`
--          ('0.00') e `valor_liquido_fatura` = soma das duplicatas.
--      Nota nao mista (so boleto, so PIX, faturado, a vista): nenhuma chave
--      nova. Antes a Focus montava a fatura sozinha a partir das duplicatas, e
--      a documentacao dela nao diz o que faz quando as duplicatas nao fecham o
--      total da nota — por isso a fatura vai explicita so na mista.
--
-- O QUE NAO MUDA
--   - quais parcelas viram duplicata (15 com vencimento futuro, regra de
--     15/09 — rejeicao 853), datas e valores das duplicatas;
--   - `formas_pagamento` agrupado por forma, com a soma, na mesma ordem;
--   - itens, impostos, totais, emitente, destinatario, transporte, volumes,
--     informacoes adicionais: nada;
--   - notas ja emitidas: o payload delas ja esta gravado em `payload_envio`.
--
-- COMO E FEITA (mesmo metodo de 20260915_payload_nfe_duplicata_so_vencimento_futuro)
--   Le a definicao atual com `pg_get_functiondef`, troca SO o trecho entre
--   `jsonb_build_object(<CRLF>        'formas_pagamento',` e o fecho do bloco
--   (`      )<CRLF><CRLF>      ||<CRLF><CRLF>      -- ====...<CRLF>      -- Pesos`)
--   e recria com `CREATE OR REPLACE` (preserva dono, ACL, SECURITY DEFINER e
--   search_path). Travas, todas abortam a migration inteira:
--     a) md5 do corpo atual = e5f040db1f31d2ca57ba3d689e1e5e5b (lido em 24/11);
--     b) cada marcador aparece UMA vez;
--     c) md5 do trecho trocado = 3f7603e8ea676b84ccf96677e59ce642 (o bloco
--        antigo, exatamente);
--     d) depois, devolver o trecho antigo no corpo novo da o md5 original
--        (nada alem do trecho mudou);
--     e) ACL igual antes e depois;
--     f) md5 do corpo novo = o esperado (ver no fim do arquivo).
--   O trecho novo e normalizado para CRLF, como o resto do corpo (a funcao foi
--   gravada pelo SQL Editor com CRLF); assim o md5 final nao depende de como
--   este arquivo foi salvo (LF ou CRLF).
--
-- PROVA ANTES DE APLICAR: supabase/manutencao/payload-nfe-entrada-boleto/prova.sql
--   (transacao desfeita, termina com PROVA_DESFEITA {json}).

do $migracao$
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
$migracao$;

-- VERIFICACAO (somente leitura, depois de aplicar)
--   select md5(prosrc), prosecdef, proconfig from pg_proc where proname = 'fn_montar_payload_nfe';
--   -- esperado: 139bc8358e5ff947c8649a67b7030fb8, true, {search_path=public}
--
-- ROLLBACK
--   Mesmo metodo ao contrario: ler o corpo, conferir md5 = 139bc8358e5ff947c8649a67b7030fb8,
--   trocar o trecho novo pelo antigo (o bloco de md5 3f7603e8...) e recriar.
--   O corpo volta a e5f040db1f31d2ca57ba3d689e1e5e5b.
