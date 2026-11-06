-- Comprador escolhido na aba Artes da proposta (06/11/2026).
--
-- O "Enviar para arte" exige um contato Comprador do cliente (ativo, com nome,
-- WhatsApp e e-mail). Quando o cliente tem mais de um, o escolhido fica aqui.
-- Coluna nova, nula em todas as propostas: nada existente muda, e pedido já
-- enviado para arte segue como está.
-- Contato nunca é apagado (é inativado), mas se um dia for, a proposta só perde
-- a escolha (on delete set null).
--
-- Para voltar:
--   alter table public.propostas drop column id_contato_comprador;

alter table public.propostas
  add column if not exists id_contato_comprador bigint
  references public.contatos(id) on delete set null;

create index if not exists propostas_id_contato_comprador_idx
  on public.propostas (id_contato_comprador)
  where id_contato_comprador is not null;

comment on column public.propostas.id_contato_comprador is
  'Contato Comprador escolhido na aba Artes (lib/comprador-da-arte). Nulo = ainda não escolhido.';
