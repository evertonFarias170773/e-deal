-- Conversa do WhatsApp (ChatGuru, remetente 3478) escolhida na aba Artes (10/11/2026).
--
-- Decisão do Everton: a visão chatguru_contatos_3478 é só para falar com o cliente
-- pelo WhatsApp; a tabela contatos segue sendo o cadastro da pessoa (e-mail e
-- telefone para etiqueta, cobrança e checkout). O "Comprador" da aba Artes passa a
-- ser uma conversa do Guru do cliente (codigo_cliente = id_cliente), gravada aqui
-- pelo chat_id. Os avisos (pedido em produção e pedido pronto) usam esta conversa
-- direto quando ela existe; sem ela, a regra de casar o telefone do contato.
--
-- Gravação só pela rota /api/orcamentos/conversa-whatsapp, que confere se o
-- chat_id é de uma conversa do cliente da proposta. Sem chave estrangeira: a
-- conversa vive nas tabelas do ChatGuru, que mudam pelo webhook.

alter table public.propostas
  add column if not exists chatguru_chat_id text;

comment on column public.propostas.chatguru_chat_id is
  'chat_id da conversa do ChatGuru (remetente 3478, visao chatguru_contatos_3478) escolhida na aba Artes como Comprador. Avisos de pedido em producao e pedido pronto usam esta conversa direto. Gravada pela rota /api/orcamentos/conversa-whatsapp (10/11/2026).';
