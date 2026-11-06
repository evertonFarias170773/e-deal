-- Contato do cliente pode ser inativado (06/11/2026).
--
-- O cadastro acumula contatos antigos e repetidos, e contato já salvo não pode
-- ser removido. Inativo sai da escolha de contato (proposta nova, pedido,
-- cobrança, envios automáticos), mas continua existindo: propostas, pedidos e
-- notas antigos seguem mostrando o contato que usaram.
--
-- Todos os contatos que já existem ficam ativos (o default preenche a coluna).
-- Nenhuma linha é apagada e nenhum vínculo com proposta muda.

alter table public.contatos
  add column if not exists ativo boolean not null default true;

comment on column public.contatos.ativo is
  'false = contato inativado no cadastro do cliente: fora da escolha de contato e dos envios automáticos; propostas antigas seguem mostrando o contato.';
