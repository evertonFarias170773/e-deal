-- =====================================================================
-- encerrar_pedidos_pagos_transicao: corte proprio para o grupo NAO_AVULSA
-- =====================================================================
--
-- O QUE MUDA
-- ----------
-- NAO_AVULSA passa a usar como corte o MENOR entre a data escolhida e
-- 26/09/2026 00:00 (Brasilia). AVULSA continua com a data escolhida. A previa
-- devolve tambem 'corte_nao_avulsa'.
--
-- POR QUE
-- -------
-- Nao avulso pago depois de 26/09 pode ser pedido que so ainda nao foi
-- liberado para a producao (is_prd_aprovado ainda falso). Na previa de 29/09
-- com corte em 29/09, o 22798 (pago em 28/09 20:33) entrava; com esta regra
-- ele fica de fora.
--
-- O resto do corpo e identico ao de 20260929152843 (conferido pelo md5 do
-- corpo vivo contra o arquivo; a unica diferenca eram dois comentarios que
-- nao foram aplicados na primeira vez). ACL e search_path nao mudam; os
-- REVOKE/GRANT abaixo so reafirmam o que ja esta.

CREATE OR REPLACE FUNCTION public.encerrar_pedidos_pagos_transicao(
  p_data_corte    date,
  p_so_previa     boolean DEFAULT true,
  p_qtd_esperada  integer DEFAULT NULL,
  p_executado_por text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_hoje       date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_corte      timestamptz;
  -- Nao avulso so entra se pago antes de 26/09/2026, qualquer que seja a data escolhida.
  c_limite_nao_avulsa constant timestamptz := timestamptz '2026-09-26 00:00:00 America/Sao_Paulo';
  v_corte_nao_avulsa  timestamptz;
  v_ids        bigint[];
  v_itens      jsonb;
  v_grupos     jsonb;
  v_qtd        integer;
  v_soma       numeric;
  v_lote       uuid;
  v_alterados  bigint[];
  v_md5_antes  text;
  v_md5_depois text;
BEGIN
  IF p_data_corte IS NULL THEN
    RAISE EXCEPTION 'Informe a data de corte.';
  END IF;
  IF p_data_corte > v_hoje THEN
    RAISE EXCEPTION 'A data de corte nao pode ser depois de hoje (%).', v_hoje;
  END IF;
  v_corte := p_data_corte::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_corte_nao_avulsa := least(v_corte, c_limite_nao_avulsa);

  WITH ult AS (
    SELECT g.id_int, max(g.paid_at) AS ultimo_paid_at
    FROM public.pagamentos_v2 g
    WHERE upper(coalesce(g.status, '')) NOT IN ('CANCELADO', 'CANCELADA') AND g.paid_at IS NOT NULL
    GROUP BY g.id_int
  ), cand AS (
    SELECT p.id_int,
           CASE WHEN p.is_avulso THEN 'AVULSA' ELSE 'NAO_AVULSA' END AS grupo,
           p.cliente, p.id_cliente, p.valor_total, u.ultimo_paid_at
    FROM public.propostas p
    JOIN ult u ON u.id_int = p.id_int
    WHERE p.status_interno = 'LIBERADO'
      AND u.ultimo_paid_at < CASE WHEN p.is_avulso THEN v_corte ELSE v_corte_nao_avulsa END
      AND coalesce(p.id_cliente, 0) <> 58613
      AND (
        p.is_avulso = true
        OR (
          p.is_avulso = false
          AND coalesce(p.is_prd_aprovado, false) = false
          AND NOT EXISTS (SELECT 1 FROM public.propostas_os o WHERE o.id_int = p.id_int)
          AND NOT EXISTS (SELECT 1 FROM public.propostas_os_setores s WHERE s.id_int = p.id_int)
          AND NOT EXISTS (SELECT 1 FROM public.expedicoes e WHERE e.id_int = p.id_int)
        )
      )
  )
  SELECT
    coalesce(array_agg(c.id_int ORDER BY c.id_int), '{}'),
    count(*),
    coalesce(sum(c.valor_total), 0)::numeric(14, 2),
    coalesce(jsonb_agg(jsonb_build_object(
      'id_int', c.id_int, 'grupo', c.grupo, 'cliente', c.cliente, 'id_cliente', c.id_cliente,
      'ultimo_paid_at', c.ultimo_paid_at, 'valor_total', c.valor_total
    ) ORDER BY c.ultimo_paid_at, c.id_int), '[]'),
    (SELECT coalesce(jsonb_agg(jsonb_build_object('grupo', x.grupo, 'qtd', x.qtd, 'soma', x.soma) ORDER BY x.grupo), '[]')
       FROM (SELECT c2.grupo, count(*) AS qtd, sum(c2.valor_total)::numeric(14, 2) AS soma FROM cand c2 GROUP BY c2.grupo) x)
  INTO v_ids, v_qtd, v_soma, v_itens, v_grupos
  FROM cand c;

  IF p_so_previa THEN
    RETURN jsonb_build_object(
      'previa', true, 'data_corte', p_data_corte, 'corte', v_corte, 'corte_nao_avulsa', v_corte_nao_avulsa,
      'total', v_qtd, 'soma', v_soma, 'grupos', v_grupos, 'itens', v_itens
    );
  END IF;

  -- Execucao: so com a quantidade que a pessoa viu na previa.
  IF p_qtd_esperada IS NULL OR p_qtd_esperada <> v_qtd THEN
    RAISE EXCEPTION 'A lista mudou desde a previa (previa: %, agora: %). Gere a previa de novo.', p_qtd_esperada, v_qtd;
  END IF;
  IF v_qtd = 0 THEN
    RETURN jsonb_build_object('previa', false, 'total', 0, 'alterados', '[]'::jsonb);
  END IF;

  v_lote := gen_random_uuid();

  INSERT INTO public.encerramento_transicao_copias
    (lote, id_int, grupo, status_anterior, status_alterado_em_anterior, data_corte, executado_por)
  SELECT v_lote, p.id_int,
         CASE WHEN p.is_avulso THEN 'AVULSA' ELSE 'NAO_AVULSA' END,
         p.status_interno, s.status_alterado_em, p_data_corte, p_executado_por
  FROM public.propostas p
  LEFT JOIN public.propostas_status_alterado s ON s.id_int = p.id_int
  WHERE p.id_int = ANY(v_ids);

  SELECT md5(coalesce(string_agg(c.id_int || ';' || c.status_alterado_em_anterior::text, E'\n' ORDER BY c.id_int), ''))
    INTO v_md5_antes
  FROM public.encerramento_transicao_copias c
  WHERE c.lote = v_lote AND c.status_alterado_em_anterior IS NOT NULL;

  WITH upd AS (
    UPDATE public.propostas p SET status_interno = 'ENTREGUE'
    WHERE p.id_int = ANY(v_ids) AND p.status_interno = 'LIBERADO'
    RETURNING p.id_int
  )
  SELECT coalesce(array_agg(u.id_int ORDER BY u.id_int), '{}') INTO v_alterados FROM upd u;

  IF v_alterados IS DISTINCT FROM v_ids THEN
    RAISE EXCEPTION 'Os pedidos alterados (%) nao batem com a lista (%). Nada foi gravado.',
      array_length(v_alterados, 1), array_length(v_ids, 1);
  END IF;

  -- Repoe a data de status de antes (o trigger acabou de gravar now()).
  UPDATE public.propostas_status_alterado s SET status_alterado_em = c.status_alterado_em_anterior
  FROM public.encerramento_transicao_copias c
  WHERE c.lote = v_lote AND s.id_int = c.id_int AND c.status_alterado_em_anterior IS NOT NULL;

  DELETE FROM public.propostas_status_alterado s
  USING public.encerramento_transicao_copias c
  WHERE c.lote = v_lote AND s.id_int = c.id_int AND c.status_alterado_em_anterior IS NULL;

  SELECT md5(coalesce(string_agg(s.id_int || ';' || s.status_alterado_em::text, E'\n' ORDER BY s.id_int), ''))
    INTO v_md5_depois
  FROM public.propostas_status_alterado s
  WHERE s.id_int = ANY(v_ids);

  IF v_md5_depois IS DISTINCT FROM v_md5_antes THEN
    RAISE EXCEPTION 'A data de status nao voltou ao valor de antes. Nada foi gravado.';
  END IF;

  RETURN jsonb_build_object(
    'previa', false, 'lote', v_lote, 'data_corte', p_data_corte,
    'total', v_qtd, 'soma', v_soma, 'grupos', v_grupos, 'alterados', to_jsonb(v_alterados)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.encerrar_pedidos_pagos_transicao(date, boolean, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.encerrar_pedidos_pagos_transicao(date, boolean, integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.encerrar_pedidos_pagos_transicao(date, boolean, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.encerrar_pedidos_pagos_transicao(date, boolean, integer, text) TO service_role;
