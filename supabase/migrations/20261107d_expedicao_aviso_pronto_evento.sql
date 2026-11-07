-- Aviso "Pedido em Produção" (07/11/2026).
--
-- A liberação para a produção (lista de Pedidos e menu da proposta) pode mandar
-- ao contato do pedido o diálogo do ChatGuru de "pedido em produção". O envio usa
-- a mesma Edge Function, a mesma reserva e a mesma trava por conversa do aviso de
-- pedido pronto; o registro fica nesta tabela, separado pelo evento. Linhas
-- antigas são todas de pedido pronto (default).
alter table public.expedicao_aviso_pronto
  add column if not exists evento text not null default 'pedido_pronto';

alter table public.expedicao_aviso_pronto
  add constraint expedicao_aviso_pronto_evento_check
    check (evento in ('pedido_pronto', 'pedido_em_producao'));

comment on column public.expedicao_aviso_pronto.evento is
  'pedido_pronto (Expedição) ou pedido_em_producao (Liberar para Produção). A trava por conversa (destino_chave) vale para os dois.';
