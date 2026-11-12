-- ============================================================================
-- Reversão de 20261112_atualizar_atrasos_boletos_volta_a_vencer.sql
--
-- Corpo vivo de public.atualizar_atrasos_boletos() em 12/11/2026, antes da
-- migration: md5(prosrc) = c9b3200496665a92fe90c18b7049df49, idêntico ao
-- arquivo 20261002_atualizar_atrasos_boletos_ignora_cancelado.sql.
-- ACL antes: {postgres, authenticated, service_role}. CREATE OR REPLACE mantém.
--
-- Rodar só com autorização: volta a rotina a NÃO devolver VENCIDO para
-- A_VENCER. Não desfaz o status dos títulos já devolvidos.
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
