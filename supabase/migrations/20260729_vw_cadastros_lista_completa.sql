-- View exclusiva da LISTA de Cadastros (/cadastros).
--
-- Motivo: public.vw_cadastros_clientes_lista fixa `categoria = 'CLIENTE'` e
-- `ativo = true` na propria definicao, o que impede a tela de oferecer filtro por
-- tipo de cadastro e o checkbox "Mostrar inativos" (2.542 clientes inativos e 24
-- transportadoras nunca chegam a aplicacao).
--
-- A view compartilhada NAO e alterada: ela continua servindo o dashboard de
-- Cadastros (contagem de ativos e aniversariantes) e o Maestro. Esta nova view
-- repete as MESMAS colunas, o mesmo join e os mesmos campos derivados, sem o
-- WHERE — quem consulta decide o filtro.
--
-- Seguranca: security_invoker=true, igual a view compartilhada, para que a RLS de
-- public.clientes continue sendo avaliada com o papel de quem consulta. Nenhuma
-- politica de RLS e criada ou alterada. Os GRANTs abaixo apenas habilitam leitura
-- do objeto novo, no mesmo nivel de acesso que a view existente ja tem.

create or replace view public.vw_cadastros_lista_completa
with (security_invoker = true) as
  with pedidos_por_cliente as (
    select p.id_cliente,
           count(distinct p.id_int) as qtd_pedidos,
           max(p.created_at) as ultimo_pedido_at
      from propostas p
     where p.id_cliente is not null
       and p.status_interno = 'APROVADO'::text
       and coalesce(p.is_copia, false) = false
     group by p.id_cliente
  )
  select c.id,
         c.id_cliente,
         c.id_cliente::text as id_cliente_text,
         c.nome,
         c.fantasia,
         c.apelido,
         c.documento,
         regexp_replace(coalesce(c.documento, ''::text), '\D'::text, ''::text, 'g'::text) as documento_numeros,
         c.tipo_pessoa,
         c.categoria,
         c.ativo,
         c.restricao,
         c.cidade_uf,
         c.nome_vendedor,
         c.email,
         c.email_contato,
         c.email_financeiro,
         c.whatsapp_1,
         c.whatsapp_2,
         c.telefone_fixo,
         regexp_replace(coalesce(c.whatsapp_1, ''::text), '\D'::text, ''::text, 'g'::text) as whatsapp_1_numeros,
         regexp_replace(coalesce(c.whatsapp_2, ''::text), '\D'::text, ''::text, 'g'::text) as whatsapp_2_numeros,
         regexp_replace(coalesce(c.telefone_fixo, ''::text), '\D'::text, ''::text, 'g'::text) as telefone_fixo_numeros,
         c.credito,
         c.limite_credito,
         c.risco_credito,
         c.padrao_pagamento,
         c.data_fundacao,
         extract(day from c.data_fundacao)::integer as dia_fundacao,
         extract(month from c.data_fundacao)::integer as mes_fundacao,
         c.data_fundacao is not null
           and extract(day from c.data_fundacao) = extract(day from current_date)
           and extract(month from c.data_fundacao) = extract(month from current_date) as aniversariante_hoje,
         coalesce(ppc.qtd_pedidos, 0::bigint) as qtd_pedidos,
         ppc.ultimo_pedido_at::date as data_ult_pedido,
         lower(concat_ws(' '::text,
           c.id_cliente::text, c.nome, c.fantasia, c.apelido, c.documento,
           regexp_replace(coalesce(c.documento, ''::text), '\D'::text, ''::text, 'g'::text),
           c.cidade_uf,
           c.whatsapp_1, regexp_replace(coalesce(c.whatsapp_1, ''::text), '\D'::text, ''::text, 'g'::text),
           c.whatsapp_2, regexp_replace(coalesce(c.whatsapp_2, ''::text), '\D'::text, ''::text, 'g'::text),
           c.telefone_fixo, regexp_replace(coalesce(c.telefone_fixo, ''::text), '\D'::text, ''::text, 'g'::text),
           c.email, c.email_contato)) as busca_geral
    from clientes c
    left join pedidos_por_cliente ppc on ppc.id_cliente = c.id_cliente;

comment on view public.vw_cadastros_lista_completa is
  'Lista de Cadastros (/cadastros). Mesmas colunas de vw_cadastros_clientes_lista, sem fixar categoria e ativo — o filtro e responsabilidade da consulta. A view compartilhada segue intacta para o dashboard e o Maestro.';

grant select on public.vw_cadastros_lista_completa to authenticated;
grant select on public.vw_cadastros_lista_completa to anon;
grant select on public.vw_cadastros_lista_completa to service_role;
