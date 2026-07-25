-- ============================================================================
-- 20260726_maestro_vw_cliente_360.sql
--
-- Visão consolidada ENXUTA e ATEMPORAL do cliente para o Maestro Agent Loop.
-- Estratégia: "visão geral primeiro → tool especializada somente quando
-- necessário". Esta view cobre APENAS estado atual e últimos registros:
--   - cadastro essencial, comercial, crédito, vendedor, bônus;
--   - resumo de boletos em aberto/atrasados (estado atual; detalhe na tool);
--   - últimos registros relevantes (última proposta, último pedido real,
--     último recebimento) e ultima_movimentacao (cliente ativo?).
--
-- SEM RECORTE TEMPORAL EMBUTIDO (sem now()): indicadores de período — como
-- "mês atual" — são aplicados pela TOOL visao_geral_cliente via adapters
-- parametrizados, mantendo a view reutilizável para qualquer época.
--
-- FORA DO ESCOPO (permanecem nas tools/adapters especializados):
--   períodos parametrizados, comparações de meses, listagens detalhadas,
--   endereços/contatos/sócios, produção, conta corrente, produtos.
--
-- ⚠️ MIGRATION VERSIONADA E **NÃO APLICADA**.
--    Não executar sem autorização explícita.
--    O código correspondente (tool visao_geral_cliente) degrada graciosamente
--    enquanto a view não existir (usa apenas os adapters).
--
-- Segurança:
--   - security_invoker = true → a view executa com as permissões do USUÁRIO
--     chamador; a RLS das tabelas base (clientes, propostas, boletos,
--     pagamentos_v2) é aplicada normalmente — modelo de segurança do Maestro
--     preservado (diferente das views de UI existentes, que rodam como owner);
--   - GRANT somente para authenticated (nunca anon);
--   - nenhum campo sensível (tokens, linha digitável, PIX, payloads);
--   - idempotente: CREATE OR REPLACE + GRANT são re-executáveis.
--
-- Semântica (FLUXO-OFICIAL-STATUS-PROPOSTAS.md) — SEMPRE explícita:
--   - pedido real de Produção = is_prd_aprovado = true AND is_reproved = false;
--   - recebimento real = pagamentos_v2 com status PAID e confirmado, por paid_at;
--   - boletos ≠ pagamentos_v2 (aqui apenas contagem/soma de títulos).
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

comment on view public.vw_maestro_cliente_360 is
  'Visão consolidada enxuta e ATEMPORAL do cliente para o Maestro (security_invoker: RLS do usuário). Estado atual + últimos registros; indicadores de período são aplicados pela tool via adapters.';

-- Acesso: somente usuários autenticados (RLS das tabelas base governa as linhas)
grant select on public.vw_maestro_cliente_360 to authenticated;
revoke all on public.vw_maestro_cliente_360 from anon;
-- Default privileges do projeto concedem ALL em objetos novos — a visão é
-- somente leitura (aplicado também como migration maestro_vw_cliente_360_grants)
revoke insert, update, delete, truncate, references, trigger
  on public.vw_maestro_cliente_360 from authenticated;
