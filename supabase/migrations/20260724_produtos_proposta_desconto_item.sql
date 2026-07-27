-- Persistência do desconto por item da proposta (public.produtos_proposta)
--
-- Antes desta migration o desconto do item existia apenas no estado do formulário
-- (em memória). O save gravava somente o subtotal líquido (valor_sub_total) e o
-- load fixava descontoTipo/descontoValor em 'VALOR'/0, de modo que ao reabrir a
-- proposta o desconto do item era perdido (mostrava 0). Estas colunas passam a
-- guardar valor + tipo do desconto de cada item, permitindo recuperá-lo.
--
-- Segurança: os grants de produtos_proposta são a nível de tabela (não por coluna),
-- portanto NENHUMA alteração de RLS/grant é necessária — as colunas novas herdam os
-- privilégios existentes. Alteração puramente aditiva, com defaults seguros para as
-- linhas já existentes (todas assumem 'VALOR'/0, ou seja, sem desconto de item).

ALTER TABLE public.produtos_proposta
  ADD COLUMN IF NOT EXISTS desconto_tipo text NOT NULL DEFAULT 'VALOR',
  ADD COLUMN IF NOT EXISTS desconto_valor numeric NOT NULL DEFAULT 0;
