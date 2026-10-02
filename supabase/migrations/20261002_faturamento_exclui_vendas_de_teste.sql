-- Faturamento: vendas de teste param de somar na visão do Dashboard e do Maestro.
--
-- DECISÃO DO DONO (02/10/2026)
--   Saem do faturamento os pedidos feitos nos cadastros de teste e os pedidos
--   lançados por vendedores de teste:
--     · clientes 6, 11, 14 e 58613 ("Teste Testando");
--     · vendedores "Everton Dev" e "TESTE AUTOMATIZADO";
--     · o login userteste1 (como vendedor do pedido ou como quem criou o pedido).
--   Nenhuma cobrança, boleto ou status é alterado. A exclusão é no CONSUMO,
--   nunca no registro — mesma regra da cortesia (20260909).
--
-- O QUE ESTA MIGRATION MUDA (2 objetos)
--   · public.fn_venda_de_teste            — o predicado, novo;
--   · public.view_pagamentos_pagos_v2     — ganha UMA condição.
--
--   A visão alimenta o card Faturamento e os blocos financeiros de
--   rpc_dashboard_executivo, a get_dashboard_financeiro e o total do Maestro
--   (calcularFaturamentoOficial). O espelho do predicado no aplicativo está em
--   src/features/maestro/core/simple/maestro-venda-de-teste.ts — as duas listas
--   têm de ser iguais; o teste maestro-faturamento-gabarito compara o Maestro
--   com esta visão e falha se divergirem.
--
-- O QUE ESTA MIGRATION NÃO MUDA
--   · rpc_ranking_vendedores e rpc_dashboard_vendedor leem pagamentos_v2
--     direto, não esta visão. Continuam contando as vendas de teste até uma
--     migration própria, com autorização própria. Enquanto isso o total do
--     ranking fica maior que o card Faturamento pelo valor dos testes.
--   · rpc_relatorio_vendas_pagas e vw_relatorio_vendas_pagas_base: extrato,
--     não faturamento.
--   · cobertura de proposta, saldo, status: nada disso lê esta visão.
--
-- ANTES DE ESCREVER (02/10/2026)
--   A definição viva da visão e a do arquivo
--   20260909_faturamento_exclui_amostra_e_retrabalho.sql foram comparadas pela
--   forma normalizada do banco: md5 54f8a8c52606e4b4c4be241e2b30f7e9 nas duas.
--   Visão sem reloptions (não é security_invoker), dona postgres, ACL
--   {postgres, authenticated, service_role}. CREATE OR REPLACE preserva dono e
--   ACL; as asserções (b) conferem.
--
--   Vendas de teste dentro do faturamento nessa data: 19 cobranças,
--   R$ 3.052,28 (jun 88,00 · jul 2.583,20 · ago 215,55 · set 165,53).
--   Os pedidos 19795 e 21833 (AUTOMATECH) NÃO são teste: o vendedor deles foi
--   corrigido de "userteste1" para "Edina Farias" antes desta migration.

-- ── 1. O predicado ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_venda_de_teste(
  p_id_cliente  bigint,
  p_id_faturado bigint,
  p_vendedor    text,
  p_user_id     uuid
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  -- Recebe as colunas da PROPOSTA (id_cliente, id_faturado, vendedor, user_id).
  -- Verdadeiro só para o que está nas listas; nulo, vazio e desconhecido contam
  -- como venda real — na dúvida a receita aparece.
  SELECT coalesce(p_id_cliente,  -1) IN (6, 11, 14, 58613)
      OR coalesce(p_id_faturado, -1) IN (6, 11, 14, 58613)
      OR lower(btrim(coalesce(p_vendedor, ''))) IN ('everton dev', 'teste automatizado', 'userteste1')
      OR coalesce(p_user_id = '264c562e-3fee-48c2-a071-d609e71cb8bb'::uuid, false);
$function$;

COMMENT ON FUNCTION public.fn_venda_de_teste(bigint, bigint, text, uuid) IS
  'A proposta e de teste e fica FORA do faturamento? Recebe id_cliente, id_faturado, vendedor e user_id da proposta. '
  'Verdadeiro para os cadastros 6, 11, 14 e 58613, os vendedores Everton Dev e TESTE AUTOMATIZADO e o login userteste1 '
  '(como vendedor ou como criador). Decisao do dono em 02/10/2026. Espelho no aplicativo: maestro-venda-de-teste.ts. '
  'Nao altera cobranca, boleto nem status: so decide o que soma.';

REVOKE ALL ON FUNCTION public.fn_venda_de_teste(bigint, bigint, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_venda_de_teste(bigint, bigint, text, uuid) TO authenticated, service_role;

-- ── 2. A visão ──────────────────────────────────────────────────────────────
-- Idêntica à versão viva, mais a última condição. NOT EXISTS (e não JOIN) para
-- a cobrança sem proposta continuar contando e para não haver multiplicação
-- de linhas. propostas.id_int é único (propostas_id_int_key).
CREATE OR REPLACE VIEW public.view_pagamentos_pagos_v2 AS
 SELECT ((pg.data_confirmacao AT TIME ZONE 'America/Sao_Paulo'::text))::date AS data,
    pg.id_empresa,
    pg.status,
    sum(pg.valor) AS total,
    count(*) AS quantidade
   FROM pagamentos_v2 pg
  WHERE ((pg.status = ANY (ARRAY['PAID'::text, 'A_VENCER'::text]))
     AND (pg.confirmado = true)
     AND (pg.data_confirmacao IS NOT NULL)
     AND public.fn_conta_no_faturamento(pg.tipo_cobranca)
     AND (NOT (EXISTS ( SELECT 1
           FROM propostas pr
          WHERE ((pr.id_int = pg.id_int)
             AND public.fn_venda_de_teste((pr.id_cliente)::bigint, pr.id_faturado, pr.vendedor, pr.user_id))))))
  GROUP BY (((pg.data_confirmacao AT TIME ZONE 'America/Sao_Paulo'::text))::date), pg.id_empresa, pg.status;

-- ── 3. Asserções ────────────────────────────────────────────────────────────
-- Se qualquer uma falhar, a migration inteira é desfeita.
DO $assert$
DECLARE
  r            record;
  v_acl        text;
  v_opcoes     text[];
  v_colunas    text;
  v_meses      int := 0;
  v_tirado     numeric := 0;
  v_linhas     bigint := 0;
BEGIN
  -- (a) As colunas da visão são as mesmas, nos mesmos tipos.
  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
    INTO v_colunas
    FROM pg_attribute a
   WHERE a.attrelid = 'public.view_pagamentos_pagos_v2'::regclass AND a.attnum > 0;
  IF v_colunas <> 'data:date, id_empresa:smallint, status:text, total:numeric, quantidade:bigint' THEN
    RAISE EXCEPTION 'ASSERCAO_A_FALHOU: colunas da visao mudaram: %', v_colunas;
  END IF;

  -- (b) Dono, ACL e opções preservados (CREATE OR REPLACE VIEW troca as opções
  --     pelas informadas; a visão não tinha nenhuma e continua sem).
  SELECT c.relacl::text, c.reloptions INTO v_acl, v_opcoes
    FROM pg_class c WHERE c.oid = 'public.view_pagamentos_pagos_v2'::regclass;
  IF v_acl IS DISTINCT FROM '{postgres=arwdDxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}' THEN
    RAISE EXCEPTION 'ASSERCAO_B_FALHOU: ACL da visao mudou: %', v_acl;
  END IF;
  IF v_opcoes IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERCAO_B_FALHOU: a visao ganhou opcoes: %', v_opcoes;
  END IF;

  -- (c) Mês a mês: faturamento pela regra ANTIGA menos o da visão NOVA tem de
  --     ser exatamente a soma das cobranças de teste, calculada aqui por
  --     extenso, sem passar pelo predicado. As três contas saem de UM comando,
  --     portanto do mesmo instante: operação em andamento não desalinha.
  FOR r IN
    WITH antiga AS (
      SELECT to_char((g.data_confirmacao AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM') AS mes,
             sum(g.valor) AS total, count(*) AS qtd
        FROM pagamentos_v2 g
       WHERE g.status IN ('PAID', 'A_VENCER') AND g.confirmado = true AND g.data_confirmacao IS NOT NULL
         AND public.fn_conta_no_faturamento(g.tipo_cobranca)
       GROUP BY 1
    ), nova AS (
      SELECT to_char(v.data, 'YYYY-MM') AS mes, sum(v.total) AS total, sum(v.quantidade) AS qtd
        FROM public.view_pagamentos_pagos_v2 v
       GROUP BY 1
    ), teste AS (
      SELECT to_char((g.data_confirmacao AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM') AS mes,
             sum(g.valor) AS total, count(*) AS qtd
        FROM pagamentos_v2 g
        JOIN propostas pr ON pr.id_int = g.id_int
       WHERE g.status IN ('PAID', 'A_VENCER') AND g.confirmado = true AND g.data_confirmacao IS NOT NULL
         AND public.fn_conta_no_faturamento(g.tipo_cobranca)
         AND (   pr.id_cliente  IN (6, 11, 14, 58613)
              OR pr.id_faturado IN (6, 11, 14, 58613)
              OR lower(btrim(coalesce(pr.vendedor, ''))) IN ('everton dev', 'teste automatizado', 'userteste1')
              OR pr.user_id = '264c562e-3fee-48c2-a071-d609e71cb8bb'::uuid)
       GROUP BY 1
    )
    SELECT a.mes, a.total AS antes, coalesce(n.total, 0) AS depois, coalesce(t.total, 0) AS teste,
           a.qtd AS qtd_antes, coalesce(n.qtd, 0) AS qtd_depois, coalesce(t.qtd, 0) AS qtd_teste
      FROM antiga a
      LEFT JOIN nova n  ON n.mes = a.mes
      LEFT JOIN teste t ON t.mes = a.mes
     ORDER BY a.mes
  LOOP
    IF r.antes - r.depois <> r.teste OR r.qtd_antes - r.qtd_depois <> r.qtd_teste THEN
      RAISE EXCEPTION
        'ASSERCAO_C_FALHOU em %: antes=% depois=% (diferenca %) mas teste=%; cobrancas antes=% depois=% teste=%',
        r.mes, r.antes, r.depois, r.antes - r.depois, r.teste, r.qtd_antes, r.qtd_depois, r.qtd_teste;
    END IF;
    v_meses  := v_meses + 1;
    v_tirado := v_tirado + r.teste;
    v_linhas := v_linhas + r.qtd_teste;
    RAISE NOTICE 'mes %: antes % · depois % · teste % (% cobranca(s))', r.mes, r.antes, r.depois, r.teste, r.qtd_teste;
  END LOOP;

  IF v_meses = 0 THEN
    RAISE EXCEPTION 'ASSERCAO_C_FALHOU: nenhum mes conferido.';
  END IF;

  -- (d) A AUTOMATECH (vendedor corrigido para Edina Farias) continua contando.
  IF EXISTS (
    SELECT 1 FROM propostas pr
     WHERE pr.id_int IN (19795, 21833)
       AND public.fn_venda_de_teste((pr.id_cliente)::bigint, pr.id_faturado, pr.vendedor, pr.user_id)
  ) THEN
    RAISE EXCEPTION 'ASSERCAO_D_FALHOU: pedido 19795 ou 21833 (AUTOMATECH) caiu como teste.';
  END IF;

  -- (e) O predicado: o que é e o que não é teste.
  IF NOT public.fn_venda_de_teste(14, 8469, 'André Toniazzo', NULL)
     OR NOT public.fn_venda_de_teste(100, 58613, NULL, NULL)
     OR NOT public.fn_venda_de_teste(100, 200, '  Everton DEV ', NULL)
     OR NOT public.fn_venda_de_teste(100, 200, 'teste automatizado', NULL)
     OR NOT public.fn_venda_de_teste(100, 200, 'Edina Farias', '264c562e-3fee-48c2-a071-d609e71cb8bb')
     OR public.fn_venda_de_teste(66235, 66235, 'Edina Farias', '4cab5b88-50b9-44bc-8063-e68de9f5da06')
     OR public.fn_venda_de_teste(NULL, NULL, NULL, NULL)
     OR public.fn_venda_de_teste(100, NULL, 'Everton Farias', NULL) THEN
    RAISE EXCEPTION 'ASSERCAO_E_FALHOU: o predicado fn_venda_de_teste nao respondeu como esperado.';
  END IF;

  RAISE NOTICE 'Assercoes OK: % mes(es) conferido(s); % cobranca(s) de teste fora do faturamento, somando %.',
    v_meses, v_linhas, v_tirado;
END
$assert$;
