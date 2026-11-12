-- ============================================================================
-- 20261112_atualizar_atrasos_boletos_volta_a_vencer.sql
--
-- A rotina diária `atualizar-atraso-boletos` (pg_cron, 03:00 UTC) passava
-- A_VENCER para VENCIDO e nunca fazia o caminho de volta. O "Editar depósito"
-- da Carteira troca só o vencimento: o título prorrogado ficava VENCIDO com
-- data futura, em Vencidos e no card "Cobranças Vencidas" (caso 20717-B,
-- depósito futuro, 10/11 -> 19/11, R$ 133.356,00).
--
-- MUDANÇA ÚNICA: um ramo a mais no CASE do status. Volta para A_VENCER o
-- título VENCIDO, não pago (paid_at nulo) e sem baixa (confirmado_por nulo),
-- cujo vencimento é hoje ou depois. PAID e baixados não entram (o primeiro
-- ramo e a condição de baixa); CANCELADO segue fora pelo WHERE. O resto do
-- corpo fica como estava.
--
-- Vencimento igual a hoje volta para A_VENCER porque o ramo de ida só marca
-- VENCIDO com CURRENT_DATE > vencimento: as duas regras ficam simétricas.
--
-- Corpo vivo antes: md5(prosrc) c9b3200496665a92fe90c18b7049df49, igual a
-- 20261002_atualizar_atrasos_boletos_ignora_cancelado.sql. Reversão em
-- supabase/manutencao/atualizar-atrasos-boletos-volta-a-vencer-rollback/.
-- Cabeçalho idêntico: sem SECURITY DEFINER, sem search_path, RETURNS void.
-- ACL mantida pelo CREATE OR REPLACE: {postgres, authenticated, service_role}.
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

      -- Prorrogado (Editar depósito): vencimento hoje ou depois, sem
      -- pagamento e sem baixa, volta a A_VENCER (20717-B, 12/11/2026).
      WHEN status = 'VENCIDO'
           AND vencimento IS NOT NULL
           AND vencimento >= CURRENT_DATE
           AND confirmado_por IS NULL
        THEN 'A_VENCER'

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
