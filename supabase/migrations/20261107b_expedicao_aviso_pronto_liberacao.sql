-- "Liberar número" do aviso de pedido pronto (07/11/2026).
--
-- Aviso por diálogo em 'desconhecido' segura o WhatsApp (índice
-- expedicao_aviso_pronto_trava_conversa). Só ADM libera, pela Edge Function
-- expedicao-pedido-pronto, depois de conferir no ChatGuru: "enviada" -> o aviso
-- passa a 'executado' (sem reenviar); "nao_enviada" -> 'falhou' (Reenviar volta).
-- Estas colunas registram quem liberou, quando e o que respondeu.
--
-- Para voltar:
--   alter table public.expedicao_aviso_pronto
--     drop column liberacao_resposta, drop column liberado_em,
--     drop column liberado_por_nome, drop column liberado_por;

alter table public.expedicao_aviso_pronto
  add column if not exists liberado_por uuid,
  add column if not exists liberado_por_nome text,
  add column if not exists liberado_em timestamptz,
  add column if not exists liberacao_resposta text
    constraint expedicao_aviso_pronto_liberacao_resposta_check
    check (liberacao_resposta is null or liberacao_resposta in ('enviada', 'nao_enviada'));
