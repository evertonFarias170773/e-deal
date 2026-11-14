-- Orçamento pelo WhatsApp com histórico e trava (14/11/2026).
--
-- O botão "Enviar pelo ChatGuru" do box 9 da proposta manda o diálogo
-- "Orçamento Whatsapp" (expedicao-pedido-pronto v29) para cada conversa escolhida
-- em Contatos do pedido. Cada envio passa pela mesma reserva dos avisos: uma linha
-- nesta tabela com evento 'orcamento_whatsapp', a mesma trava por conversa
-- (destino_chave em 'preparando' ou 'desconhecido') e o mesmo Liberar número.
-- Só amplia a lista de eventos; nenhuma linha muda.
alter table public.expedicao_aviso_pronto
  drop constraint expedicao_aviso_pronto_evento_check;

alter table public.expedicao_aviso_pronto
  add constraint expedicao_aviso_pronto_evento_check
    check (evento in ('pedido_pronto', 'pedido_em_producao', 'orcamento_whatsapp'));

comment on column public.expedicao_aviso_pronto.evento is
  'pedido_pronto (Expedição), pedido_em_producao (Liberar para Produção) ou orcamento_whatsapp (box 9 da proposta, desde 14/11/2026). A trava por conversa (destino_chave) vale para os três.';
