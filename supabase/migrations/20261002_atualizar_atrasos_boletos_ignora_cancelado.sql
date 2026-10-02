-- ============================================================================
-- 20261002_atualizar_atrasos_boletos_ignora_cancelado.sql
--
-- A rotina diária `atualizar-atraso-boletos` (pg_cron, 03:00 UTC) calculava
-- `dias_atraso` e `data_vencido` para TODO título faturado com vencimento
-- passado, inclusive os cancelados. Título cancelado não está em atraso: é
-- histórico. Com o "Refazer boleto" (01/10/2026) o boleto antigo fica na
-- tabela como CANCELADO, com o vencimento antigo, e passaria a acumular dias
-- de atraso enquanto o título de verdade vence em outra data.
--
-- MUDANÇA ÚNICA: o UPDATE ganha
--   WHERE upper(coalesce(status, '')) <> 'CANCELADO'
-- As três expressões do SET ficam como estavam.
--
-- Por que WHERE e não um CASE a mais: a trigger `tg_recalcular_encargos_boleto`
-- dispara em qualquer UPDATE que cite `status` no SET, e recalcula
-- `dias_atraso` a partir do vencimento. Enquanto a rotina tocar a linha
-- cancelada, a trigger recalcula. Fora do UPDATE, a linha fica como está.
--
-- NÃO zera o que já foi gravado: os títulos cancelados que hoje têm
-- `dias_atraso > 0` ficam com o valor congelado. Limpar é escrita em dados, à
-- parte.
--
-- A função não tinha arquivo no repositório. Este parte do corpo vivo
-- (md5(prosrc) antes: 91ac503c638be922f4ec803ed52cb640). Cabeçalho idêntico:
-- sem SECURITY DEFINER, sem search_path, RETURNS void, plpgsql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.atualizar_atrasos_boletos()
 RETURNS void
 LANGUAGE plpgsql
AS $function$BEGIN
  UPDATE public.boletos
  SET
    dias_atraso = CASE
      WHEN paid_at IS NOT NULL AND vencimento IS NOT NULL
        THEN GREATEST((paid_at::date - vencimento), 0)

      WHEN is_faturado = true
           AND vencimento IS NOT NULL
           AND CURRENT_DATE > vencimento
        THEN CURRENT_DATE - vencimento

      ELSE 0
    END,

    status = CASE
      WHEN paid_at IS NOT NULL THEN status

      WHEN is_faturado = true
           AND CURRENT_DATE > vencimento
           AND status = 'A_VENCER'
        THEN 'VENCIDO'

      ELSE status
    END,

    data_vencido = CASE
      WHEN is_faturado = true
           AND CURRENT_DATE > vencimento
           AND data_vencido IS NULL
        THEN CURRENT_DATE

      ELSE data_vencido
    END
  WHERE upper(coalesce(status, '')) <> 'CANCELADO';
END;$function$;
