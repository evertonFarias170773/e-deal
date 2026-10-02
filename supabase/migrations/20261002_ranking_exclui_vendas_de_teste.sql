-- Ranking e "Meu desempenho": vendas de teste param de somar.
--
-- POR QUE
--   A migration 20261002_faturamento_exclui_vendas_de_teste tirou as vendas de
--   teste da visão view_pagamentos_pagos_v2 (card Faturamento e Maestro). As
--   duas funções abaixo leem pagamentos_v2 DIRETO, não a visão, e continuavam
--   contando os testes: o ranking mostrava "Everton Dev" e as vendas do
--   cadastro 6 em "Edison Jr", e o total dele ficava maior que o card.
--   Autorização nominal do dono em 02/10/2026, só para esta migration.
--
-- O QUE FAZ (2 objetos, por transformação guardada — mesmo método da 20260909)
--   · rpc_ranking_vendedores  — 1 bloco
--   · rpc_dashboard_vendedor  — 4 blocos (faturamento, série, curva ABC, últimos)
--   Em cada bloco, logo depois de
--       and public.fn_conta_no_faturamento(p2.tipo_cobranca)
--   entra
--       and not exists (select 1 from propostas prt where prt.id_int = p2.id_int
--                       and public.fn_venda_de_teste(prt.id_cliente::bigint, prt.id_faturado, prt.vendedor, prt.user_id))
--   A regra é a de public.fn_venda_de_teste — a mesma da visão. Nenhuma
--   cobrança, boleto ou status muda.
--
-- CONFERIDO ANTES DE APLICAR (02/10/2026)
--   O corpo vivo de cada função foi comparado com o que os arquivos do
--   repositório produzem (20260808_rpc_vendedor_admin_abc_e_ranking.sql mais a
--   linha inserida pela 20260909), pelo md5 do corpo:
--     rpc_dashboard_vendedor  14c3c88640bab8891b6fda3304d44e22  (arquivo = banco)
--     rpc_ranking_vendedores  a644ff91fd991836bbdfb09563ce1734  (arquivo = banco)
--   md5 da definição inteira (pg_get_functiondef), usado na guarda abaixo:
--     rpc_dashboard_vendedor  30ebded40d12288bd9bde4e93db3df56
--     rpc_ranking_vendedores  fda73fcba2259b460c60e3527d587e98
--   md5 do corpo ESPERADO depois desta migration (conferido na asserção):
--     rpc_dashboard_vendedor  2ebcdc05dbb3b8309f5e6691bca14600
--     rpc_ranking_vendedores  de86008d05f9bb5c73aabb6b839425c9
--   ACL das duas: {postgres, authenticated, service_role} — CREATE OR REPLACE preserva.
--
-- Custo assumido (como na 20260909): este bloco não recria as funções num
-- banco vazio — depende de elas já existirem. É migration de produção.

DO $mig$
DECLARE
  r            record;
  v_def        text;
  v_novo       text;
  v_qtd        int;
  v_acl_depois text;
  v_md5_corpo  text;
  c_ancora     constant text := E'      and public.fn_conta_no_faturamento(p2.tipo_cobranca)\n';
  c_insercao   constant text :=
    E'      and not exists (select 1 from propostas prt where prt.id_int = p2.id_int\n' ||
    E'                      and public.fn_venda_de_teste(prt.id_cliente::bigint, prt.id_faturado, prt.vendedor, prt.user_id))\n';
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, p.proacl::text AS acl,
           CASE p.proname
             WHEN 'rpc_dashboard_vendedor' THEN 4
             WHEN 'rpc_ranking_vendedores' THEN 1
           END AS esperado,
           CASE p.proname
             WHEN 'rpc_dashboard_vendedor' THEN '30ebded40d12288bd9bde4e93db3df56'
             WHEN 'rpc_ranking_vendedores' THEN 'fda73fcba2259b460c60e3527d587e98'
           END AS md5_mapeado,
           CASE p.proname
             WHEN 'rpc_dashboard_vendedor' THEN '2ebcdc05dbb3b8309f5e6691bca14600'
             WHEN 'rpc_ranking_vendedores' THEN 'de86008d05f9bb5c73aabb6b839425c9'
           END AS md5_corpo_esperado
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('rpc_dashboard_vendedor', 'rpc_ranking_vendedores')
  LOOP
    v_def := pg_get_functiondef(r.oid);

    -- Idempotência: rodar de novo não empilha a condição.
    IF position('fn_venda_de_teste' IN v_def) > 0 THEN
      RAISE NOTICE 'ja aplicada em %, nada a fazer', r.proname;
      CONTINUE;
    END IF;

    IF md5(v_def) <> r.md5_mapeado THEN
      RAISE EXCEPTION 'CORPO_DIVERGENTE: % tem md5 %, mapeado %. Nada foi alterado.', r.proname, md5(v_def), r.md5_mapeado;
    END IF;

    v_qtd := (length(v_def) - length(replace(v_def, c_ancora, ''))) / length(c_ancora);
    IF v_qtd IS DISTINCT FROM r.esperado THEN
      RAISE EXCEPTION 'ANCORA_DIVERGENTE: % tem % ancora(s), esperado %. Nada foi alterado.', r.proname, v_qtd, r.esperado;
    END IF;

    v_novo := replace(v_def, c_ancora, c_ancora || c_insercao);
    IF length(v_novo) <> length(v_def) + r.esperado * length(c_insercao) THEN
      RAISE EXCEPTION 'DIFERENCA_INESPERADA em %. Nada foi alterado.', r.proname;
    END IF;

    EXECUTE v_novo;

    SELECT p.proacl::text, md5(replace(p.prosrc, E'\r', ''))
      INTO v_acl_depois, v_md5_corpo
      FROM pg_proc p WHERE p.oid = r.oid;
    IF v_acl_depois IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'ACL_MUDOU em %: antes % depois %', r.proname, r.acl, v_acl_depois;
    END IF;
    IF v_md5_corpo <> r.md5_corpo_esperado THEN
      RAISE EXCEPTION 'CORPO_NOVO_DIVERGENTE em %: md5 %, esperado %', r.proname, v_md5_corpo, r.md5_corpo_esperado;
    END IF;
    RAISE NOTICE '% atualizada: % bloco(s), corpo md5 %', r.proname, r.esperado, v_md5_corpo;
  END LOOP;
END
$mig$;

-- As duas funções têm de ter saído com a regra (pega o caso de nenhuma linha no laço).
DO $assert$
BEGIN
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname IN ('rpc_dashboard_vendedor', 'rpc_ranking_vendedores')
         AND position('fn_venda_de_teste' IN p.prosrc) > 0) <> 2 THEN
    RAISE EXCEPTION 'ASSERCAO_FALHOU: as duas funcoes deveriam citar fn_venda_de_teste.';
  END IF;
END
$assert$;
