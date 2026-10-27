-- propostas.frete_valor_digitado (27/10/2026) — autorizada nominalmente pelo dono.
--
-- JA APLICADA MANUALMENTE pelo dono no SQL Editor em 27/10/2026 (conferida por
-- leitura: coluna boolean, nenhuma linha preenchida). NAO reaplicar; o IF NOT
-- EXISTS abaixo so evita erro se alguem rodar de novo.
--
-- O QUE E
--   Marca de que o "Valor cobrado" do card do motoboy interno (transportadora 997,
--   TRANSPORTADORAS_PARCEIRAS.MOTOBOY) foi digitado pelo usuario na aba Fretes.
--   true = digitado; null = valor do card (ou qualquer outro frete).
--   Quem grava: so o saveProposta, na fase de orcamento (lib/origem-frete.ts,
--   freteValorDigitadoParaGravar). Quem le: so a tela do orcamento, para a
--   recotacao automatica manter o digitado e atualizar so o cotado de referencia.
--   Maestro, Expedicao, relatorios e n8n NAO leem esta coluna.
--
-- O QUE NAO FAZ
--   So ADD COLUMN, nula, sem default nem backfill. Nao toca cotacao_frete,
--   triggers, RLS, GRANT nem politica. Linhas existentes ficam null.
--
-- ROLLBACK —
--   ALTER TABLE public.propostas DROP COLUMN IF EXISTS frete_valor_digitado;

ALTER TABLE public.propostas
  ADD COLUMN IF NOT EXISTS frete_valor_digitado boolean;

COMMENT ON COLUMN public.propostas.frete_valor_digitado IS
  'Valor cobrado do card do motoboy interno (997) digitado pelo usuario na aba Fretes. true = digitado; null = valor do card. Gravado so pelo saveProposta na fase de orcamento; lido so pela tela do orcamento.';
