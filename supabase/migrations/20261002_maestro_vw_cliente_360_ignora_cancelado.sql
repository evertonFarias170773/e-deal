-- ============================================================================
-- 20261002_maestro_vw_cliente_360_ignora_cancelado.sql
--
-- O resumo de boletos do cliente no Maestro contava TÍTULO CANCELADO como
-- "em aberto" e, quando o vencimento antigo passava, como "atrasado": o
-- subselect `bo` olhava só `paid_at is null`. Em 02/10/2026 eram 58 títulos
-- cancelados contados como abertos e 53 como atrasados, em 35 clientes. O
-- "Refazer boleto" (01/10/2026) acrescenta um cancelado a cada uso — o boleto
-- antigo, com o vencimento antigo —, o que tornaria o erro rotineiro.
--
-- MUDANÇA ÚNICA: o subselect `bo` passa a ignorar título cancelado
--   and upper(coalesce(b.status, '')) <> 'CANCELADO'
-- Vale para os quatro números (abertos_qtd, abertos_valor, atrasados_qtd,
-- atrasados_valor). Nenhuma coluna entra, sai ou muda de tipo.
--
-- Parte da definição viva, conferida contra 20260726_maestro_vw_cliente_360.sql
-- antes de substituir: iguais, tirando formatação e os casts que o Postgres
-- escreve por conta própria (md5 das duas normalizadas:
-- 21f2e7952d20a6b8938db7be8cdcdf6c). md5 de pg_get_viewdef(..., true) antes:
-- 62b6fc659e773ad5589a83d17fc08e91.
--
-- security_invoker continua true. CREATE OR REPLACE preserva os GRANTs.
-- ============================================================================

create or replace view public.vw_maestro_cliente_360
with (security_invoker = true)
as
select
  -- ── Cadastro essencial ────────────────────────────────────────────────────
  c.id_cliente,
  c.nome,
  c.fantasia,
  c.documento,
  c.tipo_pessoa,
  c.cidade_uf,
  c.ativo,
  c.restricao,
  c.risco_credito,
  c.padrao_pagamento,
  c.categoria,
  c.nome_vendedor            as vendedor,
  c.data_cadastro,
  c.data_fundacao,

  -- ── Comercial / crédito / bônus ───────────────────────────────────────────
  c.credito,
  c.limite_credito,
  c.usa_preco_fixo,
  case when c.usa_preco_fixo then false else c.is_bonus end         as is_bonus,
  case when c.usa_preco_fixo then 0     else c.percentual_bunus end as percentual_bonus,

  -- ── Boletos: estado atual (resumo; detalhe = tool boletos_cliente) ────────
  bo.abertos_qtd             as boletos_abertos_qtd,
  bo.abertos_valor           as boletos_abertos_valor,
  bo.atrasados_qtd           as boletos_atrasados_qtd,
  bo.atrasados_valor         as boletos_atrasados_valor,

  -- ── Últimos registros relevantes ──────────────────────────────────────────
  up.id_int                  as ultima_proposta_id_int,
  up.valor                   as ultima_proposta_valor,
  up.created_at              as ultima_proposta_criada_em,
  up.status_interno          as ultima_proposta_status,
  coalesce(up.is_prd_aprovado = true and up.is_reproved = false, false)
                             as ultima_proposta_pedido_real,
  upp.id_int                 as ultimo_pedido_producao_id_int,
  upp.valor                  as ultimo_pedido_producao_valor,
  upp.created_at             as ultimo_pedido_producao_criada_em,
  ur.id_int                  as ultimo_recebimento_id_int,
  ur.valor                   as ultimo_recebimento_valor,
  ur.paid_at                 as ultimo_recebimento_em,

  -- Data mais recente entre proposta criada e recebimento confirmado
  -- ("esse cliente está ativo?" sem consultar outras tools)
  greatest(up.created_at, ur.paid_at) as ultima_movimentacao

from public.clientes c

left join lateral (
  select
    count(*)  filter (where b.paid_at is null)                  as abertos_qtd,
    coalesce(sum(b.valor) filter (where b.paid_at is null), 0)  as abertos_valor,
    count(*)  filter (where b.paid_at is null
                        and b.dias_atraso > 0)                  as atrasados_qtd,
    coalesce(sum(coalesce(b.valor_atualizado, b.valor))
             filter (where b.paid_at is null
                       and b.dias_atraso > 0), 0)               as atrasados_valor
  from public.boletos b
  where b.id_cliente = c.id_cliente
    -- Título cancelado não está em aberto nem em atraso (02/10/2026).
    and upper(coalesce(b.status, '')) <> 'CANCELADO'
) bo on true

left join lateral (
  select p.id_int, coalesce(p.valor_total, p.valor) as valor,
         p.created_at, p.status_interno, p.is_prd_aprovado, p.is_reproved
  from public.propostas p
  where p.id_cliente = c.id_cliente and p.is_reproved = false
  order by p.created_at desc, p.id_int desc
  limit 1
) up on true

left join lateral (
  select p.id_int, coalesce(p.valor_total, p.valor) as valor, p.created_at
  from public.propostas p
  where p.id_cliente = c.id_cliente
    and p.is_prd_aprovado = true
    and p.is_reproved = false
  order by p.created_at desc, p.id_int desc
  limit 1
) upp on true

left join lateral (
  select pg.id_int, pg.valor, pg.paid_at
  from public.pagamentos_v2 pg
  where pg.id_cliente = c.id_cliente
    and pg.confirmado = true
    and pg.status = 'PAID'
    and pg.paid_at is not null
  order by pg.paid_at desc
  limit 1
) ur on true;
