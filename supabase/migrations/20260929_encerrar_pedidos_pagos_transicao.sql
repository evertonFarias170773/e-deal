-- =====================================================================
-- Encerrar pedidos pagos (transicao): LIBERADO -> ENTREGUE sob demanda
-- =====================================================================
--
-- O QUE
-- -----
-- 1. public.encerramento_transicao_copias: a copia de cada execucao (lote),
--    com id_int, grupo, status e data de status de ANTES. E de onde se volta.
--    RLS ligada, sem policy; so a service_role (que ignora RLS) le e grava.
-- 2. public.encerrar_pedidos_pagos_transicao(p_data_corte, p_so_previa,
--    p_qtd_esperada, p_executado_por):
--    - previa (padrao): so le. Devolve contagem e soma por grupo e a lista.
--    - execucao: numa transacao, grava a copia do lote, passa as propostas
--      para ENTREGUE, repoe a data de status de antes e confere tudo; qualquer
--      divergencia desfaz a transacao inteira.
--    EXECUTE so para service_role. Chamada pela rota
--    /api/admin/encerrar-pedidos-pagos, que confere admin no servidor.
--
-- A REGRA (a mesma dos lotes de 29/09/2026: 4.386 avulsas e 85 nao avulsas)
-- --------
-- status_interno = 'LIBERADO' e, em um de dois grupos:
--   AVULSA      is_avulso = true
--   NAO_AVULSA  is_avulso = false, is_prd_aprovado falso ou vazio, sem OS
--               (propostas_os), sem setor de producao (propostas_os_setores)
--               e sem linha em expedicoes
-- e o ultimo paid_at nao cancelado em pagamentos_v2 anterior a data de corte,
-- a meia-noite de Brasilia. Sempre fora: o cliente de teste 58613 e quem nao
-- tem paid_at.
--
-- A DATA DE STATUS FICA
-- ---------------------
-- trg_propostas_status_alterado grava now() quando o status muda. A funcao
-- repoe o valor de antes logo depois, na mesma transacao, e confere pelo md5
-- dos pares id;data. Proposta sem data antes continua sem data.
--
-- VOLTA DE UM LOTE (manual, com autorizacao):
--   BEGIN;
--   UPDATE public.propostas p SET status_interno = c.status_anterior
--     FROM public.encerramento_transicao_copias c
--    WHERE c.lote = '<lote>' AND p.id_int = c.id_int AND p.status_interno = 'ENTREGUE';
--   UPDATE public.propostas_status_alterado s SET status_alterado_em = c.status_alterado_em_anterior
--     FROM public.encerramento_transicao_copias c
--    WHERE c.lote = '<lote>' AND s.id_int = c.id_int AND c.status_alterado_em_anterior IS NOT NULL;
--   -- conferir e COMMIT

CREATE TABLE public.encerramento_transicao_copias (
  lote                        uuid        NOT NULL,
  id_int                      bigint      NOT NULL,
  grupo                       text        NOT NULL,
  status_anterior             text,
  status_alterado_em_anterior timestamptz,
  data_corte                  date        NOT NULL,
  executado_em                timestamptz NOT NULL DEFAULT now(),
  executado_por               text,
  PRIMARY KEY (lote, id_int)
);

COMMENT ON TABLE public.encerramento_transicao_copias IS
  'Copia de antes de cada execucao de encerrar_pedidos_pagos_transicao (status e data de status por id_int). Base da volta.';

ALTER TABLE public.encerramento_transicao_copias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.encerramento_transicao_copias FROM PUBLIC;
REVOKE ALL ON TABLE public.encerramento_transicao_copias FROM anon;
REVOKE ALL ON TABLE public.encerramento_transicao_copias FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.encerramento_transicao_copias TO service_role;

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
      AND u.ultimo_paid_at < v_corte
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
      'previa', true, 'data_corte', p_data_corte, 'corte', v_corte,
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
