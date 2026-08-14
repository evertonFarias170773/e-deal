-- propostas.editar_faturado — nova permissao, concedida ao perfil Financeiro
--
-- O QUE ELA LIBERA
--   Editar proposta cuja cobranca e E-FATURADO em A_VENCER e ainda nao
--   liquidada: trocar frete, incluir ou excluir produto, com o valor da
--   cobranca acompanhando o novo total. Faturado a vencer e receita
--   autorizada, nao dinheiro recebido — enquanto o titulo nao e pago, o
--   pedido ainda pode mudar.
--
-- O QUE ELA NAO LIBERA
--   Editar proposta paga de verdade (PIX, cartao, boleto quitado). Esse caso
--   continua exigindo `propostas.editar_paga`, que o perfil Financeiro NAO
--   tem — de proposito: ali existe dinheiro recebido e a diferenca precisa
--   passar pela Conta Corrente.
--
-- ONDE E LIDA
--   src/features/orcamentos/OrcamentoFormPage.tsx (canEditarFaturado) e
--   src/app/api/orcamentos/editar-paga/route.ts (PERMISSAO_FATURADO). As
--   regras do que e ou nao elegivel estao em
--   src/features/orcamentos/services/faturado-editavel.ts.
--
-- ANTES DE APLICAR — verificacao (somente leitura)
--
--     select id, nome, permissoes @> '["propostas.editar_faturado"]'::jsonb as ja_tem
--     from public.perfis order by id;
--
-- IDEMPOTENTE: o where impede duplicar a permissao em reexecucao.

update public.perfis
set permissoes = permissoes || '["propostas.editar_faturado"]'::jsonb
where id = 3
  and not (permissoes @> '["propostas.editar_faturado"]'::jsonb);
