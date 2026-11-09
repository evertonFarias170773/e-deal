-- 09/11/2026: os avisos do ChatGuru (pedido pronto e pedido em produção) passam a
-- escolher a conversa pela visão chatguru_contatos_3478 (codigo_cliente = id_cliente
-- do pedido), não mais por contatos.whats. Cada aviso registra o chat_id usado.
-- Avisos antigos ficam com chat_id vazio.
alter table public.expedicao_aviso_pronto add column if not exists chat_id text;

comment on column public.expedicao_aviso_pronto.chat_id is
  'chat_id da conversa do ChatGuru (remetente 3478) usada no envio, lido de chatguru_contatos_3478. Vazio nos avisos anteriores a 09/11/2026.';
