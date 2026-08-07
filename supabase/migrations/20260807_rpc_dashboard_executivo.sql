-- 20260807_rpc_dashboard_executivo.sql
--
-- Dashboard executivo: todos os KPIs agregados em UMA chamada.
-- Somente leitura (STABLE). SECURITY DEFINER porque o bloco de "tempo até
-- aprovação" agrega a trilha vw_audit_logs_v2, que não é (e não deve ser)
-- legível pela anon key — a função devolve apenas agregados e top-5, nunca
-- linhas individuais da auditoria.
--
-- Períodos: o front calcula o período atual e o anterior equivalente
-- (America/Sao_Paulo) e passa os quatro limites; a função varre cada fonte
-- uma única vez usando FILTER para os dois ranges.

-- ─── Espelho SQL de empresaTextMatchesCompany (dashboard.service.ts) ─────────
-- `propostas` não tem id_empresa; o campo `empresa` é texto livre.
-- MANTER EM PARIDADE com a heurística do front:
--   1 = contém "ideal" e NÃO contém padrões de 2 (biro/birô) nem de 3 (e3)
--   2 = contém "biro"/"birô"   3 = contém "e3"   0 = todas
create or replace function public.dashboard_empresa_match(p_empresa text, p_id integer)
returns boolean
language sql
immutable
as $$
  select case
    when p_id = 0 then true
    when p_id = 1 then
      strpos(lower(coalesce(p_empresa, '')), 'ideal') > 0
      and strpos(lower(coalesce(p_empresa, '')), 'biro') = 0
      and strpos(lower(coalesce(p_empresa, '')), 'birô') = 0
      and strpos(lower(coalesce(p_empresa, '')), 'e3') = 0
    when p_id = 2 then
      strpos(lower(coalesce(p_empresa, '')), 'biro') > 0
      or strpos(lower(coalesce(p_empresa, '')), 'birô') > 0
    when p_id = 3 then
      strpos(lower(coalesce(p_empresa, '')), 'e3') > 0
    else false
  end
$$;

revoke all on function public.dashboard_empresa_match(text, integer) from public;
grant execute on function public.dashboard_empresa_match(text, integer) to anon, authenticated, service_role;

-- ─── RPC principal ───────────────────────────────────────────────────────────
create or replace function public.rpc_dashboard_executivo(
  p_inicio      date,
  p_fim         date,
  p_inicio_prev date,
  p_fim_prev    date,
  p_id_empresa  integer default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoje    date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ini_min date := least(p_inicio, p_inicio_prev);
  v_fim_max date := greatest(p_fim, p_fim_prev);

  -- Família "ganho": status pós-aprovação (inclui LIBERADO, presente nos dados
  -- reais ainda que fora da union TS legada) e exige is_reproved = false.
  c_ganho constant text[] := array[
    'APROVADO','APROVADO / EM ARTE','LIBERADO',
    'REVISAO ATENDENTE','REVISAO PRODUCAO','EM PRODUCAO',
    'EM IMPRESSAO','EM IMPRESSAO / PENDENTE','EM ACABAMENTO','EM ACABAMENTO / PENDENTE',
    'EXPEDICAO','A RETIRAR','EM TRANSITO','ENTREGUE'];

  -- Mesmo universo de listarPedidosOperacionais() (tela /producao).
  c_producao constant text[] := array[
    'LIBERADO','REVISAO ATENDENTE','REVISAO PRODUCAO','EM PRODUCAO',
    'EM IMPRESSAO','EM IMPRESSAO / PENDENTE','EM ACABAMENTO','EM ACABAMENTO / PENDENTE'];

  v_comercial          jsonb;
  v_por_status         jsonb;
  v_tempo              jsonb;
  v_fin_recebido       jsonb;
  v_serie              jsonb;
  v_serie_bucket       text;
  v_por_empresa        jsonb := '[]'::jsonb;
  v_carteira           jsonb;
  v_fluxo              jsonb;
  v_cc                 jsonb;
  v_producao           jsonb;
  v_por_setor          jsonb;
  v_fiscal_nfe         jsonb;
  v_fiscal_nfse        jsonb;
  v_clientes           jsonb;
  v_novos              jsonb;
  v_ultimas_aprovacoes jsonb;
begin
  -- ── COMERCIAL: criadas / ganho / perdido (atual × anterior) ────────────────
  -- Coorte por data de criação (SP). Perdida = reprovada financeiramente ou
  -- cancelada. valor_total é float8 → cast para numeric antes de somar.
  select jsonb_build_object(
    'criadas', jsonb_build_object(
      'atual', jsonb_build_object(
        'qtd',   count(*) filter (where dt between p_inicio and p_fim),
        'valor', coalesce(sum(valor) filter (where dt between p_inicio and p_fim), 0)),
      'anterior', jsonb_build_object(
        'qtd',   count(*) filter (where dt between p_inicio_prev and p_fim_prev),
        'valor', coalesce(sum(valor) filter (where dt between p_inicio_prev and p_fim_prev), 0))),
    'ganho', jsonb_build_object(
      'atual', jsonb_build_object(
        'qtd',   count(*) filter (where ganho and dt between p_inicio and p_fim),
        'valor', coalesce(sum(valor) filter (where ganho and dt between p_inicio and p_fim), 0)),
      'anterior', jsonb_build_object(
        'qtd',   count(*) filter (where ganho and dt between p_inicio_prev and p_fim_prev),
        'valor', coalesce(sum(valor) filter (where ganho and dt between p_inicio_prev and p_fim_prev), 0))),
    'perdido', jsonb_build_object(
      'atual', jsonb_build_object(
        'qtd',   count(*) filter (where perdido and dt between p_inicio and p_fim),
        'valor', coalesce(sum(valor) filter (where perdido and dt between p_inicio and p_fim), 0)),
      'anterior', jsonb_build_object(
        'qtd',   count(*) filter (where perdido and dt between p_inicio_prev and p_fim_prev),
        'valor', coalesce(sum(valor) filter (where perdido and dt between p_inicio_prev and p_fim_prev), 0))))
  into v_comercial
  from (
    select (p.created_at at time zone 'America/Sao_Paulo')::date as dt,
           coalesce(p.valor_total, 0)::numeric as valor,
           (p.status_interno = any(c_ganho) and not coalesce(p.is_reproved, false)) as ganho,
           (coalesce(p.is_reproved, false) or p.status_interno = 'CANCELADO') as perdido
    from propostas p
    where (p.created_at at time zone 'America/Sao_Paulo')::date between v_ini_min and v_fim_max
      and dashboard_empresa_match(p.empresa, p_id_empresa)
  ) base;

  -- ── COMERCIAL: distribuição por status (somente período atual) ─────────────
  select coalesce(jsonb_agg(jsonb_build_object('status', status, 'qtd', qtd, 'valor', valor)
                            order by qtd desc), '[]'::jsonb)
  into v_por_status
  from (
    select coalesce(nullif(trim(p.status_interno), ''), 'SEM STATUS') as status,
           count(*) as qtd,
           coalesce(sum(coalesce(p.valor_total, 0)::numeric), 0) as valor
    from propostas p
    where (p.created_at at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
      and dashboard_empresa_match(p.empresa, p_id_empresa)
    group by 1
  ) s;

  -- ── COMERCIAL: tempo até aprovação (auditoria; agregado, nunca linhas) ─────
  -- 1ª transição de status_interno para APROVADO por proposta; classificada
  -- pelo range em que a aprovação ocorreu. Sem aprovações → null (UI oculta).
  with aprov as (
    select p.id,
           min(v.occurred_at) as aprovado_em,
           p.created_at
    from vw_audit_logs_v2 v
    join propostas p on p.id = (v.record_pk->>'id')::uuid
    where v.table_name = 'propostas'
      and v.action = 'UPDATE'
      and v.changed_fields->'status_interno'->>'new' = 'APROVADO'
      and v.occurred_at >= ((v_ini_min - 1)::timestamp at time zone 'America/Sao_Paulo')
      and v.occurred_at <  ((v_fim_max + 2)::timestamp at time zone 'America/Sao_Paulo')
      and dashboard_empresa_match(p.empresa, p_id_empresa)
    group by p.id, p.created_at
  ), cls as (
    select case
             when (aprovado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim then 'atual'
             when (aprovado_em at time zone 'America/Sao_Paulo')::date between p_inicio_prev and p_fim_prev then 'anterior'
           end as rng,
           extract(epoch from (aprovado_em - created_at)) / 3600.0 as horas
    from aprov
    where aprovado_em > created_at
  )
  select jsonb_build_object(
    'atual', (select case when count(*) = 0 then null else jsonb_build_object(
        'qtd', count(*),
        'media_horas',   round(avg(horas)::numeric, 1),
        'mediana_horas', round((percentile_cont(0.5) within group (order by horas))::numeric, 1)) end
      from cls where rng = 'atual'),
    'anterior', (select case when count(*) = 0 then null else jsonb_build_object(
        'qtd', count(*),
        'media_horas',   round(avg(horas)::numeric, 1),
        'mediana_horas', round((percentile_cont(0.5) within group (order by horas))::numeric, 1)) end
      from cls where rng = 'anterior'))
  into v_tempo;

  -- ── WIDGET: últimas propostas aprovadas (independe do período) ─────────────
  select coalesce(jsonb_agg(jsonb_build_object(
           'id_int', s.id_int, 'cliente', s.cliente, 'valor', s.valor, 'aprovado_em', s.aprovado_em)
           order by s.aprovado_em desc), '[]'::jsonb)
  into v_ultimas_aprovacoes
  from (
    select p.id_int,
           coalesce(nullif(trim(p.cliente), ''), 'Sem cliente') as cliente,
           coalesce(p.valor_total, 0)::numeric as valor,
           a.aprovado_em
    from (
      select (v.record_pk->>'id')::uuid as pid, max(v.occurred_at) as aprovado_em
      from vw_audit_logs_v2 v
      where v.table_name = 'propostas'
        and v.action = 'UPDATE'
        and v.changed_fields->'status_interno'->>'new' = 'APROVADO'
        and v.occurred_at >= now() - interval '120 days'
      group by 1
    ) a
    join propostas p on p.id = a.pid
    where dashboard_empresa_match(p.empresa, p_id_empresa)
    order by a.aprovado_em desc
    limit 5
  ) s;

  -- ── FINANCEIRO: recebido confirmado (view oficial view_pagamentos_pagos_v2) ─
  select jsonb_build_object(
    'atual', jsonb_build_object(
      'valor', coalesce(sum(total) filter (where data between p_inicio and p_fim), 0),
      'qtd',   coalesce(sum(quantidade) filter (where data between p_inicio and p_fim), 0)),
    'anterior', jsonb_build_object(
      'valor', coalesce(sum(total) filter (where data between p_inicio_prev and p_fim_prev), 0),
      'qtd',   coalesce(sum(quantidade) filter (where data between p_inicio_prev and p_fim_prev), 0)))
  into v_fin_recebido
  from view_pagamentos_pagos_v2
  where data between v_ini_min and v_fim_max
    and (p_id_empresa = 0 or id_empresa = p_id_empresa);

  -- Série temporal do período atual: por dia até 62 dias, senão por mês.
  if (p_fim - p_inicio) <= 62 then
    v_serie_bucket := 'dia';
    select coalesce(jsonb_agg(jsonb_build_object('ref', ref, 'total', total) order by ref), '[]'::jsonb)
    into v_serie
    from (
      select to_char(data, 'YYYY-MM-DD') as ref, sum(total)::numeric as total
      from view_pagamentos_pagos_v2
      where data between p_inicio and p_fim
        and (p_id_empresa = 0 or id_empresa = p_id_empresa)
      group by 1
    ) s;
  else
    v_serie_bucket := 'mes';
    select coalesce(jsonb_agg(jsonb_build_object('ref', ref, 'total', total) order by ref), '[]'::jsonb)
    into v_serie
    from (
      select to_char(data, 'YYYY-MM') as ref, sum(total)::numeric as total
      from view_pagamentos_pagos_v2
      where data between p_inicio and p_fim
        and (p_id_empresa = 0 or id_empresa = p_id_empresa)
      group by 1
    ) s;
  end if;

  -- Recebido por empresa (só faz sentido no consolidado).
  if p_id_empresa = 0 then
    select coalesce(jsonb_agg(jsonb_build_object('id_empresa', id_empresa, 'valor', valor, 'qtd', qtd)
                              order by valor desc), '[]'::jsonb)
    into v_por_empresa
    from (
      select id_empresa, sum(total)::numeric as valor, sum(quantidade) as qtd
      from view_pagamentos_pagos_v2
      where data between p_inicio and p_fim
      group by 1
    ) s;
  end if;

  -- ── FINANCEIRO: carteira de boletos (foto de hoje; sem comparativo) ────────
  -- Mesmos buckets da tela Contas a Receber: abertos = A_VENCER + VENCIDO,
  -- valor = valor_atualizado ?? valor. A_RECEBER/PAID/CANCELADO ficam fora.
  select jsonb_build_object(
    'vencido', jsonb_build_object(
      'qtd',   count(*) filter (where bucket = 'vencido'),
      'valor', coalesce(sum(valor) filter (where bucket = 'vencido'), 0)),
    'hoje', jsonb_build_object(
      'qtd',   count(*) filter (where bucket = 'hoje'),
      'valor', coalesce(sum(valor) filter (where bucket = 'hoje'), 0)),
    'a_vencer', jsonb_build_object(
      'qtd',   count(*) filter (where bucket = 'a_vencer'),
      'valor', coalesce(sum(valor) filter (where bucket = 'a_vencer'), 0)),
    'total', jsonb_build_object('qtd', count(*), 'valor', coalesce(sum(valor), 0)))
  into v_carteira
  from (
    select coalesce(b.valor_atualizado, b.valor)::numeric as valor,
           case when b.vencimento < v_hoje then 'vencido'
                when b.vencimento = v_hoje then 'hoje'
                else 'a_vencer' end as bucket
    from boletos b
    where b.status in ('A_VENCER', 'VENCIDO')
      and (p_id_empresa = 0 or b.id_empresa = p_id_empresa)
  ) ab;

  -- Fluxo de recebimento: boletos abertos com vencimento de hoje em diante.
  select coalesce(jsonb_agg(jsonb_build_object('faixa', faixa, 'qtd', qtd, 'valor', valor)
                            order by ord), '[]'::jsonb)
  into v_fluxo
  from (
    select case when b.vencimento - v_hoje <= 7  then '0-7 dias'
                when b.vencimento - v_hoje <= 15 then '8-15 dias'
                when b.vencimento - v_hoje <= 30 then '16-30 dias'
                else 'Mais de 30' end as faixa,
           min(case when b.vencimento - v_hoje <= 7  then 1
                    when b.vencimento - v_hoje <= 15 then 2
                    when b.vencimento - v_hoje <= 30 then 3
                    else 4 end) as ord,
           count(*) as qtd,
           coalesce(sum(coalesce(b.valor_atualizado, b.valor)::numeric), 0) as valor
    from boletos b
    where b.status in ('A_VENCER', 'VENCIDO')
      and b.vencimento >= v_hoje
      and (p_id_empresa = 0 or b.id_empresa = p_id_empresa)
    group by 1
  ) s;

  -- ── FINANCEIRO: pendências de conta corrente (global — tabela sem empresa) ─
  select jsonb_build_object('qtd', count(*), 'valor', coalesce(sum(valor_saldo), 0))
  into v_cc
  from conta_corrente_pendencias
  where status in ('ABERTA', 'PARCIALMENTE_RESOLVIDA');

  -- ── PRODUÇÃO: OS por etapa (foto; mesmo universo da tela /producao) ────────
  with prod as (
    select coalesce(nullif(trim(p.status_interno), ''), 'SEM STATUS') as etapa
    from propostas p
    where coalesce(p.is_prd_aprovado, false)
      and p.status_interno = any(c_producao)
      and dashboard_empresa_match(p.empresa, p_id_empresa)
  )
  select jsonb_build_object(
    'total', (select count(*) from prod),
    'por_etapa', coalesce((
      select jsonb_agg(jsonb_build_object('etapa', etapa, 'qtd', qtd) order by qtd desc)
      from (select etapa, count(*) as qtd from prod group by 1) e), '[]'::jsonb))
  into v_producao;

  -- Modelos por setor (pedidos_modelos das propostas em produção).
  select coalesce(jsonb_agg(jsonb_build_object('setor', setor, 'qtd', qtd) order by qtd desc), '[]'::jsonb)
  into v_por_setor
  from (
    select coalesce(nullif(trim(pm.setor), ''), 'Sem setor') as setor, count(*) as qtd
    from pedidos_modelos pm
    join propostas p on p.id_int = pm.id_int
    where coalesce(p.is_prd_aprovado, false)
      and p.status_interno = any(c_producao)
      and dashboard_empresa_match(p.empresa, p_id_empresa)
    group by 1
  ) s;

  -- ── FISCAL: NFe (emitida = autorizada; data_autorizacao no range) ──────────
  select jsonb_build_object(
    'emitidas', jsonb_build_object(
      'atual', jsonb_build_object(
        'qtd',   count(*) filter (where da between p_inicio and p_fim),
        'valor', coalesce(sum(vt) filter (where da between p_inicio and p_fim), 0)),
      'anterior', jsonb_build_object(
        'qtd',   count(*) filter (where da between p_inicio_prev and p_fim_prev),
        'valor', coalesce(sum(vt) filter (where da between p_inicio_prev and p_fim_prev), 0))),
    'pendentes',  count(*) filter (where st in ('PENDENTE', 'PRONTA_PARA_ENVIO', 'PROCESSANDO')),
    'rejeitadas', count(*) filter (where st like 'ERRO%' or st = 'DENEGADA'))
  into v_fiscal_nfe
  from (
    select nf.status as st,
           (nf.data_autorizacao at time zone 'America/Sao_Paulo')::date as da,
           coalesce(nf.valor_total_nf, 0)::numeric as vt
    from notas_fiscais nf
    where (p_id_empresa = 0 or nf.id_empresa = p_id_empresa)
  ) s;

  -- ── FISCAL: NFSe (sem data_autorizacao própria → created_at + AUTORIZADA) ──
  select jsonb_build_object(
    'emitidas', jsonb_build_object(
      'atual', jsonb_build_object(
        'qtd',   count(*) filter (where st = 'AUTORIZADA' and dc between p_inicio and p_fim),
        'valor', coalesce(sum(vs) filter (where st = 'AUTORIZADA' and dc between p_inicio and p_fim), 0)),
      'anterior', jsonb_build_object(
        'qtd',   count(*) filter (where st = 'AUTORIZADA' and dc between p_inicio_prev and p_fim_prev),
        'valor', coalesce(sum(vs) filter (where st = 'AUTORIZADA' and dc between p_inicio_prev and p_fim_prev), 0))),
    'pendentes',  count(*) filter (where st in ('PENDENTE', 'PRONTA_PARA_ENVIO', 'PROCESSANDO')),
    'rejeitadas', count(*) filter (where st like 'ERRO%' or st = 'DENEGADA'))
  into v_fiscal_nfse
  from (
    select ns.status as st,
           (ns.created_at at time zone 'America/Sao_Paulo')::date as dc,
           coalesce(ns.valor_servicos, 0)::numeric as vs
    from notas_servico ns
    where (p_id_empresa = 0 or ns.id_empresa = p_id_empresa)
  ) s;

  -- ── CLIENTES: novos por data de cadastro (cadastro é global às empresas) ───
  select jsonb_build_object(
    'atual',    count(*) filter (where data_cadastro between p_inicio and p_fim),
    'anterior', count(*) filter (where data_cadastro between p_inicio_prev and p_fim_prev))
  into v_novos
  from clientes
  where data_cadastro between v_ini_min and v_fim_max;

  -- ── CLIENTES: ativos (com proposta ganha no período) + top 5 por valor ─────
  with ganhas as (
    select p.id_cliente,
           coalesce(nullif(trim(p.cliente), ''), 'Sem cliente') as cliente,
           coalesce(p.valor_total, 0)::numeric as valor,
           (p.created_at at time zone 'America/Sao_Paulo')::date as dt
    from propostas p
    where (p.created_at at time zone 'America/Sao_Paulo')::date between v_ini_min and v_fim_max
      and p.status_interno = any(c_ganho)
      and not coalesce(p.is_reproved, false)
      and dashboard_empresa_match(p.empresa, p_id_empresa)
  )
  select jsonb_build_object(
    'ativos', jsonb_build_object(
      'atual', (select count(distinct id_cliente) from ganhas
                where dt between p_inicio and p_fim and id_cliente is not null),
      'anterior', (select count(distinct id_cliente) from ganhas
                   where dt between p_inicio_prev and p_fim_prev and id_cliente is not null)),
    'top', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id_cliente', id_cliente, 'cliente', cliente, 'valor', valor, 'qtd', qtd)
               order by valor desc)
      from (
        select id_cliente, max(cliente) as cliente, sum(valor) as valor, count(*) as qtd
        from ganhas
        where dt between p_inicio and p_fim and id_cliente is not null
        group by id_cliente
        order by 3 desc
        limit 5
      ) t), '[]'::jsonb))
  into v_clientes;

  return jsonb_build_object(
    'periodo', jsonb_build_object(
      'inicio', p_inicio, 'fim', p_fim,
      'inicio_prev', p_inicio_prev, 'fim_prev', p_fim_prev, 'hoje', v_hoje),
    'comercial', v_comercial
      || jsonb_build_object('por_status', v_por_status, 'tempo_aprovacao', v_tempo),
    'financeiro', jsonb_build_object(
      'recebido', v_fin_recebido,
      'serie', v_serie,
      'serie_bucket', v_serie_bucket,
      'por_empresa', v_por_empresa,
      'carteira', v_carteira,
      'fluxo', v_fluxo,
      'pendencias_cc', v_cc),
    'producao', v_producao || jsonb_build_object('por_setor', v_por_setor),
    'fiscal', jsonb_build_object('nfe', v_fiscal_nfe, 'nfse', v_fiscal_nfse),
    'clientes', v_clientes || jsonb_build_object('novos', v_novos),
    'widgets', jsonb_build_object('ultimas_aprovacoes', v_ultimas_aprovacoes));
end
$$;

revoke all on function public.rpc_dashboard_executivo(date, date, date, date, integer) from public;
grant execute on function public.rpc_dashboard_executivo(date, date, date, date, integer) to anon, authenticated, service_role;
