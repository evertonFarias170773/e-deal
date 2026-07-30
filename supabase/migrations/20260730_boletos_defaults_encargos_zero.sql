-- ============================================================================
-- 20260730_boletos_defaults_encargos_zero.sql
--
-- Zera os DEFAULTs de encargos de public.boletos.
--
-- Causa: as colunas nasceram com
--   multa     numeric(8,3) NOT NULL DEFAULT 2       -- 2% de multa
--   juros_dia numeric(8,5) NOT NULL DEFAULT 0.033   -- 0,033%/dia de mora
-- Todo INSERT que OMITE as duas colunas herda esses encargos silenciosamente.
-- Quando o titulo vence, o job pg_cron `atualizar-atraso-boletos` (0 3 * * *)
-- atualiza status/dias_atraso e, por tocar `status`, dispara a trigger
-- tg_recalcular_encargos_boleto, que materializa multa + mora em
-- valor_atualizado. Resultado observado: boletos de deposito em conta passaram a
-- acumular encargos que ninguem pediu (521 linhas na tabela, 248 com 2/0.033).
--
-- Esta migration NAO altera comportamento de vencimento. Continua tudo igual:
--   - job pg_cron `atualizar-atraso-boletos` intacto;
--   - public.atualizar_atrasos_boletos() intacta;
--   - trigger tg_recalcular_encargos_boleto intacta;
--   - public.fn_recalcular_encargos_boleto() intacta;
--   - status A_VENCER -> VENCIDO, dias_atraso e data_vencido seguem sendo
--     gravados normalmente.
-- Com multa = 0 e juros_dia = 0 a propria formula da trigger resulta em
-- valor_atualizado = valor: o boleto vence, mas nao cobra encargo.
--
-- As colunas permanecem NOT NULL. O default 0 e um valor valido, entao nao ha
-- risco de nulo; INSERTs que informam os campos continuam mandando neles.
--
-- Escopo: apenas os dois DEFAULTs. Nenhuma linha existente e alterada — nao ha
-- backfill aqui. Os 248 boletos ja gravados com 2/0.033 continuam como estao e
-- seguem acumulando mora enquanto vencidos; a correcao desse historico e uma
-- decisao separada, de negocio, e nao entra nesta migration.
-- ============================================================================

alter table public.boletos
  alter column multa     set default 0,
  alter column juros_dia set default 0;

comment on column public.boletos.multa is
  'Percentual de multa por atraso. DEFAULT 0 desde 30/07/2026: encargo passou a ser opt-in explicito de quem insere o titulo (antes o default era 2 e INSERTs que omitiam a coluna cobravam multa sem pedir). Consumida por fn_recalcular_encargos_boleto para compor valor_atualizado.';

comment on column public.boletos.juros_dia is
  'Percentual de juros de mora por dia de atraso. DEFAULT 0 desde 30/07/2026, mesmo motivo de public.boletos.multa. Consumida por fn_recalcular_encargos_boleto para compor valor_atualizado.';
