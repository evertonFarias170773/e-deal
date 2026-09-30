-- ============================================================================
-- Bonus da tabela especial gravado na venda — Fase 3a: a CHECK da linha
-- ============================================================================
--
-- A linha `desconto_proposta` do tipo TABELA_ESPECIAL guarda o bonus da venda
-- como PERCENTUAL: entre 0 e 100, obrigatorio, e sem valor nominal. O app ja
-- ignora linha fora disso (`percentualGravado`, lib/bonus-da-proposta.ts); esta
-- CHECK impede que ela seja gravada.
--
-- As outras linhas (DESCONTO_GERAL, as legadas de tipo nulo e "Tabela especial")
-- nao sao tocadas: a condicao so vale para TABELA_ESPECIAL.
--
-- Aplicada ANTES da carga (20261001_desconto_tabela_especial_carga), que exige
-- que ela exista. Hoje nao ha linha TABELA_ESPECIAL, entao a validacao das
-- linhas existentes passa.
--
-- ROLLBACK
--   alter table public.desconto_proposta drop constraint desconto_proposta_tabela_especial_valida;
-- ============================================================================

alter table public.desconto_proposta
  add constraint desconto_proposta_tabela_especial_valida
  check (
    tipo_desconto is distinct from 'TABELA_ESPECIAL'
    or (
      valor_percentual is not null
      and valor_percentual >= 0
      and valor_percentual <= 100
      and coalesce(valor_nominal, 0) = 0
    )
  );

comment on constraint desconto_proposta_tabela_especial_valida on public.desconto_proposta is
  'Linha TABELA_ESPECIAL (bonus da venda): percentual obrigatorio entre 0 e 100, sem valor nominal. Criada em 01/10/2026.';
