-- Carga dos principais (14/11/2026, autorizada pelo Everton junto da migration
-- 20261114_propostas_contatos_chatguru). Só os pedidos ATIVOS que já têm
-- propostas.chatguru_chat_id (144 em 14/11/2026): a conversa vira a principal,
-- com nome e telefone do Guru. Sem preenchimento retroativo de mais nada; os
-- pedidos não ativos com chatguru_chat_id seguem lidos por essa coluna.
-- Ativo = a mesma regra do status "Ativos" da lista de Pedidos.
insert into public.propostas_contatos_chatguru (id_int, chat_id, nome, telefone, principal, escolhido_por_nome, escolhido_em)
select p.id_int, p.chatguru_chat_id, g.nome_chatguru, g.telefone_normalizado, true,
       'Carga 14/11/2026 (conversa já escolhida na proposta)', now()
from public.propostas p
join lateral (
  select c.nome_chatguru, c.telefone_normalizado
  from public.chatguru_contatos_3478 c
  where c.chat_id = p.chatguru_chat_id and c.codigo_cliente = p.id_cliente::text
  limit 1
) g on true
where p.chatguru_chat_id is not null
  and p.encerrado_teste_em is null
  and coalesce(p.is_avulso, false) = false
  and (p.status_interno is null or (upper(p.status_interno) not like 'CANCEL%' and p.status_interno not in ('ENTREGUE', 'EM TRANSITO')))
on conflict (id_int, chat_id) do nothing;
