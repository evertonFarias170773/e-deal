-- clientes.pode_editar_frete (27/10/2026) — autorizada nominalmente pelo dono
-- (vale so para esta migration).
--
-- JÁ APLICADA MANUALMENTE — NÃO reaplicar. O dono rodou o ALTER e o COMMENT no
-- SQL Editor, projeto vwbtit, em 27/10/2026 (conferido por leitura: boolean,
-- nula, nenhuma linha preenchida). O IF NOT EXISTS so evita erro se rodar de novo.
--
-- O QUE E
--   Checkbox "Pode editar valor do frete" do cadastro do cliente. Ligado, o pedido
--   desse cliente aceita digitar o "Valor cobrado" em qualquer card calculado da
--   aba Fretes, R$ 0,00 incluido, com o mesmo mecanismo do motoboy interno (997):
--   propostas.frete_valor_digitado e as mesmas regras de descarte.
--   null = desligado (padrao). Quem le: a tela do orcamento e o saveProposta, que
--   rele o cadastro do banco antes de aceitar o valor (lib/origem-frete.ts).
--
-- O QUE NAO FAZ
--   So ADD COLUMN, nula, SEM default (nao reescreve a tabela), sem backfill.
--   Nao toca RLS, GRANT, politica, triggers de frete nem pedidos existentes.
--
-- ROLLBACK —
--   ALTER TABLE public.clientes DROP COLUMN IF EXISTS pode_editar_frete;

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS pode_editar_frete boolean;

COMMENT ON COLUMN public.clientes.pode_editar_frete IS
  'Pode editar valor do frete: com true, o pedido do cliente aceita valor de frete digitado (0 incluido) em qualquer card calculado. null = desligado. Lido pela aba Fretes e pelo saveProposta.';
