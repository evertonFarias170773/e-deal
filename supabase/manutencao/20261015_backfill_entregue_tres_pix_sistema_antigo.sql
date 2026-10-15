-- ============================================================================
-- backfill_entregue_tres_pix_sistema_antigo
-- Pedidos 13934, 15051 e 15830 (id_int): APROVADO -> ENTREGUE
-- ============================================================================
-- Autorizacao nominal do dono em 15/10/2026, so esta migration.
-- APLICADA EM 15/10/2026 20:03:38 UTC (17:03 em SP), versao 20261015200338,
-- projeto vwbtitjlpelrcnsytzqw, txid 2722516. A auditoria da transacao mostra
-- so os tres UPDATEs de status_interno; nenhuma cobranca ou boleto escrito.
--
-- Por que: pedidos de marco a maio, do tempo em que o pedido vivia no sistema
-- antigo e o Vibe recebia so o pagamento (PIX confirmado). A entrega aconteceu
-- fora do Vibe. Mesmo criterio e metodo do backfill C de 12/10/2026, SEM o
-- filtro de historico de producao: a flag is_prd_aprovado destes tres foi
-- ligada por uma operacao em massa do SQL Editor em 29/06 00:38 e desligada
-- 52 min depois, sem OS, setor, modelo, arte nem log de producao. O dono
-- decidiu que isso nao conta como producao.
--
-- So muda propostas.status_interno. Vem junto, por gatilho do banco (como no
-- C): updated_at, propostas_status_alterado (Data/Hora da lista), auditoria.
-- updated_at NAO e reposto, como no C. Nao toca valor_total, valor,
-- is_prd_aprovado, cobrancas nem boletos.
--
-- Travas (por id_int e condicao, nunca por contagem absoluta):
--   - cada um dos tres tem de estar em APROVADO, nao avulso, com
--     is_prd_aprovado = false, sem OS/setor/modelo/arte/expedicao/log de OS;
--   - cobrancas: ao menos uma ativa, todas confirmadas (PAID ou A_VENCER
--     confirmado), nada em aberto (cobranca ou boleto), conferida ha 60+ dias;
--   - nenhuma cobranca nem mensagem de chat nova desde 01/10/2026;
--   - depois: os tres em ENTREGUE, nenhuma outra proposta, cobranca ou boleto
--     escrita nesta transacao, resto da linha identico, uma linha de log por pedido.
-- Um bloco so = uma transacao. Qualquer RAISE EXCEPTION desfaz tudo.
-- ============================================================================

DO $tres$
DECLARE
  c_ids constant bigint[] := array[13934, 15051, 15830];
  v_faltando bigint[];
  v_ruins bigint[];
  v_fora int; v_dif int; v_pg int; v_bol int;
BEGIN
  SET LOCAL lock_timeout = '3s';
  SET LOCAL statement_timeout = '60s';

  -- Trava as tres linhas, se ainda estao em APROVADO.
  PERFORM 1 FROM public.propostas p
   WHERE p.id_int = ANY (c_ids) AND p.status_interno = 'APROVADO'
   ORDER BY p.id_int FOR UPDATE OF p;

  -- Copia de trabalho (some ao fim da transacao).
  CREATE TEMP TABLE _tres_antes ON COMMIT DROP AS
    SELECT p.* FROM public.propostas p
     WHERE p.id_int = ANY (c_ids) AND p.status_interno = 'APROVADO';

  -- 1. Cada um dos tres ainda em APROVADO.
  SELECT array_agg(i ORDER BY i) INTO v_faltando
    FROM unnest(c_ids) i WHERE NOT EXISTS (SELECT 1 FROM _tres_antes a WHERE a.id_int = i);
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'ABORTADO: fora de APROVADO agora: %. Nada foi gravado.', v_faltando;
  END IF;

  -- 2. Criterio do C (sem o filtro de historico de producao), pedido a pedido.
  SELECT array_agg(a.id_int ORDER BY a.id_int) INTO v_ruins
    FROM _tres_antes a
   WHERE NOT (
         a.is_avulso = false
     AND a.is_prd_aprovado = false
     AND NOT EXISTS (SELECT 1 FROM public.os_status_log l WHERE l.id_int = a.id_int)
     AND NOT EXISTS (SELECT 1 FROM public.propostas_os o WHERE o.id_int = a.id_int)
     AND NOT EXISTS (SELECT 1 FROM public.propostas_os_setores t WHERE t.id_int = a.id_int)
     AND NOT EXISTS (SELECT 1 FROM public.pedidos_modelos m WHERE m.id_int = a.id_int)
     AND NOT EXISTS (SELECT 1 FROM public.pedidos_artes r WHERE r.id_int = a.id_int)
     AND NOT EXISTS (SELECT 1 FROM public.expedicoes e WHERE e.id_int = a.id_int)
     AND EXISTS (SELECT 1 FROM public.pagamentos_v2 x WHERE x.id_int = a.id_int AND upper(coalesce(x.status,'')) <> 'CANCELADO')
     AND NOT EXISTS (SELECT 1 FROM public.pagamentos_v2 x WHERE x.id_int = a.id_int AND upper(coalesce(x.status,'')) <> 'CANCELADO'
                       AND NOT (upper(x.status) IN ('PAID','A_VENCER') AND x.confirmado IS TRUE))
     AND NOT EXISTS (SELECT 1 FROM public.pagamentos_v2 x WHERE x.id_int = a.id_int
                       AND upper(x.status) IN ('A_VENCER','A_RECEBER') AND x.paid_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.boletos b WHERE b.id_int = a.id_int
                       AND upper(b.status) IN ('A_VENCER','A_RECEBER','VENCIDO'))
     AND ((now() AT TIME ZONE 'America/Sao_Paulo')::date
          - ((SELECT max(x.data_confirmacao) FROM public.pagamentos_v2 x
               WHERE x.id_int = a.id_int AND upper(coalesce(x.status,'')) <> 'CANCELADO') AT TIME ZONE 'America/Sao_Paulo')::date) >= 60
     AND NOT EXISTS (SELECT 1 FROM public.pagamentos_v2 x WHERE x.id_int = a.id_int AND x.created_at >= '2026-10-01')
     AND NOT EXISTS (SELECT 1 FROM public.propostas_chat c WHERE c.id_int = a.id_int AND c.created_at >= '2026-10-01')
   );
  IF v_ruins IS NOT NULL THEN
    RAISE EXCEPTION 'ABORTADO: fora do criterio agora: %. Nada foi gravado.', v_ruins;
  END IF;

  -- 3. O UPDATE, travado por id_int e status atual.
  UPDATE public.propostas p SET status_interno = 'ENTREGUE'
   WHERE p.id_int = ANY (c_ids) AND p.status_interno = 'APROVADO';

  -- 4. Conferencias por condicao.
  SELECT array_agg(i ORDER BY i) INTO v_faltando
    FROM unnest(c_ids) i
   WHERE NOT EXISTS (SELECT 1 FROM public.propostas p WHERE p.id_int = i AND p.status_interno = 'ENTREGUE');
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'ABORTADO: nao ficaram ENTREGUE (algum gatilho mexeu): %.', v_faltando;
  END IF;

  SELECT count(*) INTO v_fora FROM public.propostas p
   WHERE p.xmin::text::bigint = (txid_current() % 4294967296) AND NOT (p.id_int = ANY (c_ids));
  IF v_fora <> 0 THEN
    RAISE EXCEPTION 'ABORTADO: % propostas fora dos tres foram alteradas nesta transacao.', v_fora;
  END IF;

  SELECT count(*) INTO v_pg FROM public.pagamentos_v2 x WHERE x.xmin::text::bigint = (txid_current() % 4294967296);
  SELECT count(*) INTO v_bol FROM public.boletos b WHERE b.xmin::text::bigint = (txid_current() % 4294967296);
  IF v_pg <> 0 OR v_bol <> 0 THEN
    RAISE EXCEPTION 'ABORTADO: a transacao escreveu em cobrancas (%) ou boletos (%).', v_pg, v_bol;
  END IF;

  SELECT count(*) INTO v_dif FROM (
    (SELECT to_jsonb(a) - 'status_interno' - 'updated_at' FROM _tres_antes a
     EXCEPT
     SELECT to_jsonb(p) - 'status_interno' - 'updated_at' FROM public.propostas p WHERE p.id_int = ANY (c_ids))
    UNION ALL
    (SELECT to_jsonb(p) - 'status_interno' - 'updated_at' FROM public.propostas p WHERE p.id_int = ANY (c_ids)
     EXCEPT
     SELECT to_jsonb(a) - 'status_interno' - 'updated_at' FROM _tres_antes a)
  ) d;
  IF v_dif <> 0 THEN
    RAISE EXCEPTION 'ABORTADO: % linhas com outra coluna diferente (valor_total, is_prd_aprovado ou outra).', v_dif;
  END IF;

  -- 5. Autoria, na mesma transacao: uma linha por pedido, com o status de antes.
  INSERT INTO public.os_status_log
    (id_int, status_anterior, status_novo, resultado, motivo, origem, ator_tipo, ator_nome, tipo_transicao)
  SELECT a.id_int, a.status_interno, 'ENTREGUE', 'sucesso',
         'Backfill autorizado pelo dono: pedido do sistema antigo (Vibe recebeu so o PIX, entrega fora do Vibe), '
           || 'em ' || a.status_interno || ', passa a ENTREGUE. Criterio do backfill C sem o filtro de producao '
           || '(flag de 29/06 desfeita em 52 min). So status_interno.',
         'BACKFILL_ENTREGUE_PIX_ANTIGO', 'SISTEMA', 'Everton Farias (backfill autorizado)', 'NATURAL'
    FROM _tres_antes a;

  SELECT array_agg(i ORDER BY i) INTO v_faltando
    FROM unnest(c_ids) i
   WHERE (SELECT count(*) FROM public.os_status_log l
           WHERE l.id_int = i AND l.origem = 'BACKFILL_ENTREGUE_PIX_ANTIGO') <> 1;
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'ABORTADO: log sem exatamente uma linha para: %.', v_faltando;
  END IF;
END
$tres$;

-- ============================================================================
-- ROLLBACK (GUARDADO, NAO EXECUTADO). Exige nova autorizacao do dono.
-- Por pedido: so volta quem esta em ENTREGUE por ESTE backfill. updated_at e a
-- Data/Hora da lista NAO voltam ao valor de 14/07 (o gatilho recarimba de novo).
-- ============================================================================
-- DO $volta$
-- DECLARE v_id bigint;
-- BEGIN
--   SET LOCAL lock_timeout = '3s';
--   FOREACH v_id IN ARRAY array[13934, 15051, 15830]::bigint[] LOOP
--     UPDATE public.propostas p SET status_interno = 'APROVADO'
--      WHERE p.id_int = v_id AND p.status_interno = 'ENTREGUE'
--        AND EXISTS (SELECT 1 FROM public.os_status_log l
--                     WHERE l.id_int = v_id AND l.origem = 'BACKFILL_ENTREGUE_PIX_ANTIGO'
--                       AND l.status_anterior = 'APROVADO');
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'ABORTADO: pedido % nao esta em ENTREGUE por este backfill. Nada foi desfeito.', v_id;
--     END IF;
--     INSERT INTO public.os_status_log
--       (id_int, status_anterior, status_novo, resultado, motivo, origem, ator_tipo, ator_nome, tipo_transicao)
--     VALUES (v_id, 'ENTREGUE', 'APROVADO', 'sucesso',
--             'Volta do backfill BACKFILL_ENTREGUE_PIX_ANTIGO, autorizada pelo dono.',
--             'BACKFILL_ENTREGUE_PIX_ANTIGO_VOLTA', 'SISTEMA', 'Everton Farias (volta autorizada)', 'NATURAL');
--   END LOOP;
-- END
-- $volta$;
