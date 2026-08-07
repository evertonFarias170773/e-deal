-- 20260808_rpc_vendedor_admin_abc_e_ranking.sql
--
-- Evoluções dos dashboards:
--  1. rpc_dashboard_vendedor v2 — aceita p_vendedor SOMENTE para perfil
--     administrativo (modo consulta); vendedor autenticado continua vendo
--     apenas os próprios dados (p_vendedor é IGNORADO para ele). Adiciona o
--     bloco Curva ABC de clientes do vendedor no período.
--  2. rpc_ranking_vendedores — ranking por vendedor para o Dashboard
--     executivo, EXCLUSIVO de perfil administrativo (gate no banco).
--
-- Regra oficial de faturamento inalterada (pagamentos_v2 confirmado,
-- PAID/A_VENCER, data_confirmacao em America/Sao_Paulo; propostas apenas
-- como dimensão). Verificado: nenhum id_int possui vendedores divergentes,
-- então a dimensão max(vendedor) por id_int é idêntica ao EXISTS por nome.

-- ─── Perfil administrativo (gate compartilhado) ──────────────────────────────
create or replace function public.dashboard_usuario_admin(p_uid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from usuarios u
    left join perfis pf on pf.id = u.id_perfil
    where u.user_id = p_uid
      and (coalesce(u.is_super_adm, false)
           or coalesce(u.is_admin, false)
           or pf.slug in ('super_admin', 'admin'))
  )
$$;

revoke all on function public.dashboard_usuario_admin(uuid) from public, anon;
grant execute on function public.dashboard_usuario_admin(uuid) to authenticated, service_role;

-- ─── rpc_dashboard_vendedor v2 (substitui a assinatura de 4 parâmetros) ──────
drop function if exists public.rpc_dashboard_vendedor(date, date, date, date);

create or replace function public.rpc_dashboard_vendedor(
  p_inicio      date,
  p_fim         date,
  p_inicio_prev date,
  p_fim_prev    date,
  p_vendedor    text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_nome     text;
  v_norm     text;
  v_vendedor boolean;
  v_admin    boolean;
  v_modo     text;
  v_ini_min  date := least(p_inicio, p_inicio_prev);
  v_fim_max  date := greatest(p_fim, p_fim_prev);

  -- MESMOS arrays da rpc_dashboard_executivo (20260807) — manter em paridade.
  c_ganho constant text[] := array[
    'APROVADO','APROVADO / EM ARTE','LIBERADO',
    'REVISAO ATENDENTE','REVISAO PRODUCAO','EM PRODUCAO',
    'EM IMPRESSAO','EM IMPRESSAO / PENDENTE','EM ACABAMENTO','EM ACABAMENTO / PENDENTE',
    'EXPEDICAO','A RETIRAR','EM TRANSITO','ENTREGUE'];
  c_producao constant text[] := array[
    'LIBERADO','REVISAO ATENDENTE','REVISAO PRODUCAO','EM PRODUCAO',
    'EM IMPRESSAO','EM IMPRESSAO / PENDENTE','EM ACABAMENTO','EM ACABAMENTO / PENDENTE'];
  c_aguardando constant text[] := array[
    'AGUARDANDO','AGUARDANDO / EM ARTE','AGUARDANDO / PENDENTE'];

  v_faturamento    jsonb;
  v_serie          jsonb;
  v_serie_bucket   text;
  v_propostas      jsonb;
  v_por_status     jsonb;
  v_aguardando     jsonb;
  v_producao       jsonb;
  v_abc            jsonb;
  v_ult_pagamentos jsonb;
  v_ult_propostas  jsonb;
begin
  if v_uid is null then
    raise exception 'ACESSO_NEGADO_VENDEDOR' using errcode = '42501',
      hint = 'Sessão não autenticada.';
  end if;

  select coalesce(nullif(trim(u.meu_vendedor), ''), nullif(trim(u.nome_usuario), '')),
         (pf.slug = 'vendedor')
         or (u.id_perfil is null
             and coalesce(u.is_vendedor, false)
             and not coalesce(u.is_admin, false)
             and not coalesce(u.is_super_adm, false))
    into v_nome, v_vendedor
  from usuarios u
  left join perfis pf on pf.id = u.id_perfil
  where u.user_id = v_uid;

  v_admin := dashboard_usuario_admin(v_uid);

  -- Resolução do vendedor consultado:
  --  · vendedor autenticado → SEMPRE ele mesmo (p_vendedor é ignorado);
  --  · perfil administrativo → modo consulta, exige p_vendedor;
  --  · demais perfis → negado.
  if coalesce(v_vendedor, false) then
    v_modo := 'proprio';
    if v_nome is null then
      raise exception 'VENDEDOR_SEM_NOME' using errcode = '42501',
        hint = 'Usuário vendedor sem nome comercial configurado.';
    end if;
  elsif v_admin then
    v_modo := 'consulta';
    if p_vendedor is null or trim(p_vendedor) = '' then
      raise exception 'VENDEDOR_NAO_INFORMADO' using errcode = '42501',
        hint = 'Informe o vendedor a consultar.';
    end if;
    v_nome := trim(p_vendedor);
  else
    raise exception 'ACESSO_NEGADO_VENDEDOR' using errcode = '42501',
      hint = 'Página exclusiva do perfil vendedor.';
  end if;

  v_norm := vendedor_nome_norm(v_nome);

  -- ── FATURAMENTO (regra oficial; EXISTS, nunca JOIN — evita fan-out) ────────
  with pg as (
    select (p2.data_confirmacao at time zone 'America/Sao_Paulo')::date as dt,
           coalesce(p2.valor, 0)::numeric as valor,
           p2.id_int,
           exists (
             select 1 from propostas pr
             where pr.id_int = p2.id_int
               and vendedor_nome_norm(pr.vendedor) = v_norm
           ) as proprio
    from pagamentos_v2 p2
    where p2.confirmado = true
      and p2.status in ('PAID', 'A_VENCER')
      and p2.data_confirmacao is not null
      and (p2.data_confirmacao at time zone 'America/Sao_Paulo')::date
            between v_ini_min and v_fim_max
  )
  select jsonb_build_object(
    'proprio', jsonb_build_object(
      'atual', jsonb_build_object(
        'valor',   coalesce(sum(valor) filter (where proprio and dt between p_inicio and p_fim), 0),
        'pedidos', count(distinct id_int) filter (where proprio and dt between p_inicio and p_fim)),
      'anterior', jsonb_build_object(
        'valor',   coalesce(sum(valor) filter (where proprio and dt between p_inicio_prev and p_fim_prev), 0),
        'pedidos', count(distinct id_int) filter (where proprio and dt between p_inicio_prev and p_fim_prev))),
    'total', jsonb_build_object(
      'atual',    coalesce(sum(valor) filter (where dt between p_inicio and p_fim), 0),
      'anterior', coalesce(sum(valor) filter (where dt between p_inicio_prev and p_fim_prev), 0)))
  into v_faturamento
  from pg;

  v_faturamento := v_faturamento || jsonb_build_object(
    'participacao_pct', jsonb_build_object(
      'atual', case when (v_faturamento#>>'{total,atual}')::numeric > 0
        then round(100 * (v_faturamento#>>'{proprio,atual,valor}')::numeric
                       / (v_faturamento#>>'{total,atual}')::numeric, 1) end,
      'anterior', case when (v_faturamento#>>'{total,anterior}')::numeric > 0
        then round(100 * (v_faturamento#>>'{proprio,anterior,valor}')::numeric
                       / (v_faturamento#>>'{total,anterior}')::numeric, 1) end));

  -- ── Evolução do faturamento (dia ≤ 62 dias, senão mês) ─────────────────────
  v_serie_bucket := case when (p_fim - p_inicio) <= 62 then 'dia' else 'mes' end;
  select coalesce(jsonb_agg(jsonb_build_object('ref', ref, 'total', total) order by ref), '[]'::jsonb)
  into v_serie
  from (
    select to_char((p2.data_confirmacao at time zone 'America/Sao_Paulo')::date,
                   case when v_serie_bucket = 'dia' then 'YYYY-MM-DD' else 'YYYY-MM' end) as ref,
           sum(coalesce(p2.valor, 0)::numeric) as total
    from pagamentos_v2 p2
    where p2.confirmado = true
      and p2.status in ('PAID', 'A_VENCER')
      and p2.data_confirmacao is not null
      and (p2.data_confirmacao at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
      and exists (select 1 from propostas pr
                  where pr.id_int = p2.id_int
                    and vendedor_nome_norm(pr.vendedor) = v_norm)
    group by 1
  ) s;

  -- ── CURVA ABC de clientes do vendedor (período atual; faturamento oficial) ─
  -- Classe pelo acumulado no INÍCIO da faixa do cliente (A < 80%, B < 95%);
  -- assim o 1º cliente é sempre A mesmo que sozinho passe de 80%.
  with fat as (
    select p2.id_cliente,
           max(coalesce(nullif(trim(p2.cliente), ''), 'Sem cliente')) as cliente,
           sum(coalesce(p2.valor, 0)::numeric) as valor,
           count(distinct p2.id_int) as pedidos
    from pagamentos_v2 p2
    where p2.confirmado = true
      and p2.status in ('PAID', 'A_VENCER')
      and p2.data_confirmacao is not null
      and (p2.data_confirmacao at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
      and exists (select 1 from propostas pr
                  where pr.id_int = p2.id_int
                    and vendedor_nome_norm(pr.vendedor) = v_norm)
    group by p2.id_cliente
  ), ordenado as (
    select id_cliente,
           case when id_cliente is null then 'Sem cadastro' else cliente end as cliente,
           valor, pedidos,
           sum(valor) over () as total,
           coalesce(sum(valor) over (order by valor desc, cliente
             rows between unbounded preceding and 1 preceding), 0) as acum_ini
    from fat
  ), classificado as (
    select id_cliente, cliente, valor, pedidos,
           case when acum_ini < total * 0.80 then 'A'
                when acum_ini < total * 0.95 then 'B'
                else 'C' end as classe,
           round(100 * valor / total, 1) as pct,
           round(100 * (acum_ini + valor) / total, 1) as pct_acum,
           total
    from ordenado
    where total > 0
  )
  select jsonb_build_object(
    'clientes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id_cliente', id_cliente, 'cliente', cliente, 'valor', valor,
               'pedidos', pedidos, 'pct', pct, 'pct_acum', pct_acum, 'classe', classe)
               order by valor desc, cliente)
      from (select * from classificado order by valor desc, cliente limit 60) top), '[]'::jsonb),
    'resumo', coalesce((
      select jsonb_object_agg(classe, jsonb_build_object('qtd', qtd, 'valor', valor, 'pct', pct))
      from (
        select classe, count(*) as qtd, sum(valor) as valor,
               round(100 * sum(valor) / max(total), 1) as pct
        from classificado
        group by classe
      ) r), '{}'::jsonb))
  into v_abc;

  -- ── PROPOSTAS: coorte por created_at SP (atual × anterior) ─────────────────
  with base as (
    select (p.created_at at time zone 'America/Sao_Paulo')::date as dt,
           coalesce(p.valor_total, 0)::numeric as valor,
           (p.status_interno = any(c_ganho) and not coalesce(p.is_reproved, false)) as ganha,
           (coalesce(p.is_reproved, false) or p.status_interno = 'CANCELADO') as perdida
    from propostas p
    where (p.created_at at time zone 'America/Sao_Paulo')::date between v_ini_min and v_fim_max
      and vendedor_nome_norm(p.vendedor) = v_norm
  )
  select jsonb_build_object(
    'criadas', jsonb_build_object(
      'atual', jsonb_build_object(
        'qtd',   count(*) filter (where dt between p_inicio and p_fim),
        'valor', coalesce(sum(valor) filter (where dt between p_inicio and p_fim), 0)),
      'anterior', jsonb_build_object(
        'qtd',   count(*) filter (where dt between p_inicio_prev and p_fim_prev),
        'valor', coalesce(sum(valor) filter (where dt between p_inicio_prev and p_fim_prev), 0))),
    'ganhas', jsonb_build_object(
      'atual', jsonb_build_object(
        'qtd',   count(*) filter (where ganha and dt between p_inicio and p_fim),
        'valor', coalesce(sum(valor) filter (where ganha and dt between p_inicio and p_fim), 0)),
      'anterior', jsonb_build_object(
        'qtd',   count(*) filter (where ganha and dt between p_inicio_prev and p_fim_prev),
        'valor', coalesce(sum(valor) filter (where ganha and dt between p_inicio_prev and p_fim_prev), 0))),
    'perdidas', jsonb_build_object(
      'atual', jsonb_build_object(
        'qtd',   count(*) filter (where perdida and dt between p_inicio and p_fim),
        'valor', coalesce(sum(valor) filter (where perdida and dt between p_inicio and p_fim), 0)),
      'anterior', jsonb_build_object(
        'qtd',   count(*) filter (where perdida and dt between p_inicio_prev and p_fim_prev),
        'valor', coalesce(sum(valor) filter (where perdida and dt between p_inicio_prev and p_fim_prev), 0))))
  into v_propostas
  from base;

  -- ── PROPOSTAS por status (período atual) ───────────────────────────────────
  select coalesce(jsonb_agg(jsonb_build_object('status', status, 'qtd', qtd, 'valor', valor)
                            order by qtd desc), '[]'::jsonb)
  into v_por_status
  from (
    select coalesce(nullif(trim(p.status_interno), ''), 'SEM STATUS') as status,
           count(*) as qtd,
           coalesce(sum(coalesce(p.valor_total, 0)::numeric), 0) as valor
    from propostas p
    where (p.created_at at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
      and vendedor_nome_norm(p.vendedor) = v_norm
    group by 1
  ) s;

  -- ── FOTO: aguardando ───────────────────────────────────────────────────────
  select jsonb_build_object('qtd', count(*),
           'valor', coalesce(sum(coalesce(p.valor_total, 0)::numeric), 0))
  into v_aguardando
  from propostas p
  where p.status_interno = any(c_aguardando)
    and coalesce(p.is_reproved, false) = false
    and vendedor_nome_norm(p.vendedor) = v_norm;

  -- ── FOTO: em produção ──────────────────────────────────────────────────────
  with prod as (
    select coalesce(nullif(trim(p.status_interno), ''), 'SEM STATUS') as etapa,
           coalesce(p.valor_total, 0)::numeric as valor
    from propostas p
    where coalesce(p.is_prd_aprovado, false)
      and p.status_interno = any(c_producao)
      and vendedor_nome_norm(p.vendedor) = v_norm
  )
  select jsonb_build_object(
    'qtd',   (select count(*) from prod),
    'valor', (select coalesce(sum(valor), 0) from prod),
    'por_etapa', coalesce((
      select jsonb_agg(jsonb_build_object('etapa', etapa, 'qtd', qtd) order by qtd desc)
      from (select etapa, count(*) as qtd from prod group by 1) e), '[]'::jsonb))
  into v_producao;

  -- ── [FUTURO] "Pedidos concluídos" entraria AQUI quando existir fonte real ──

  -- ── WIDGET: últimos 5 pagamentos do vendedor consultado ────────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
           'id_int', s.id_int, 'cliente', s.cliente, 'valor', s.valor,
           'data_confirmacao', s.data_confirmacao) order by s.data_confirmacao desc), '[]'::jsonb)
  into v_ult_pagamentos
  from (
    select p2.id_int,
           coalesce(nullif(trim(p2.cliente), ''), 'Sem cliente') as cliente,
           coalesce(p2.valor, 0)::numeric as valor,
           p2.data_confirmacao
    from pagamentos_v2 p2
    where p2.confirmado = true
      and p2.status in ('PAID', 'A_VENCER')
      and p2.data_confirmacao is not null
      and exists (select 1 from propostas pr
                  where pr.id_int = p2.id_int
                    and vendedor_nome_norm(pr.vendedor) = v_norm)
    order by p2.data_confirmacao desc
    limit 5
  ) s;

  -- ── WIDGET: últimas 5 propostas do vendedor consultado ─────────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
           'id_int', s.id_int, 'cliente', s.cliente, 'status', s.status,
           'valor', s.valor, 'created_at', s.created_at) order by s.created_at desc), '[]'::jsonb)
  into v_ult_propostas
  from (
    select p.id_int,
           coalesce(nullif(trim(p.cliente), ''), 'Sem cliente') as cliente,
           coalesce(nullif(trim(p.status_interno), ''), 'SEM STATUS') as status,
           coalesce(p.valor_total, 0)::numeric as valor,
           p.created_at
    from propostas p
    where vendedor_nome_norm(p.vendedor) = v_norm
    order by p.created_at desc
    limit 5
  ) s;

  return jsonb_build_object(
    'periodo', jsonb_build_object(
      'inicio', p_inicio, 'fim', p_fim,
      'inicio_prev', p_inicio_prev, 'fim_prev', p_fim_prev),
    'vendedor', jsonb_build_object('nome', v_nome),
    'modo', v_modo,
    'faturamento', v_faturamento,
    'serie', v_serie,
    'serie_bucket', v_serie_bucket,
    'abc', v_abc,
    'propostas', v_propostas || jsonb_build_object('por_status', v_por_status),
    'fotos', jsonb_build_object('aguardando', v_aguardando, 'producao', v_producao),
    'widgets', jsonb_build_object(
      'ultimos_pagamentos', v_ult_pagamentos,
      'ultimas_propostas', v_ult_propostas));
end
$$;

revoke all on function public.rpc_dashboard_vendedor(date, date, date, date, text) from public, anon;
grant execute on function public.rpc_dashboard_vendedor(date, date, date, date, text) to authenticated, service_role;

-- ─── Ranking de vendedores (Dashboard executivo — EXCLUSIVO de admin) ────────
create or replace function public.rpc_ranking_vendedores(
  p_inicio date,
  p_fim    date
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_resultado jsonb;
begin
  if v_uid is null or not dashboard_usuario_admin(v_uid) then
    raise exception 'ACESSO_NEGADO_RANKING' using errcode = '42501',
      hint = 'Ranking disponível apenas para perfis administrativos.';
  end if;

  -- Mesma regra oficial do dashboard do vendedor. Dimensão: max(vendedor) por
  -- id_int (verificado: nenhum id_int tem vendedores divergentes — idêntico ao
  -- EXISTS por nome usado na rpc_dashboard_vendedor).
  with pg as (
    select p2.id_int, coalesce(p2.valor, 0)::numeric as valor
    from pagamentos_v2 p2
    where p2.confirmado = true
      and p2.status in ('PAID', 'A_VENCER')
      and p2.data_confirmacao is not null
      and (p2.data_confirmacao at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
  ), dim as (
    select pr.id_int, max(trim(pr.vendedor)) as vnome
    from propostas pr
    where pr.vendedor is not null and trim(pr.vendedor) <> ''
      and pr.id_int in (select distinct id_int from pg)
    group by pr.id_int
  ), base as (
    select pg.id_int, pg.valor, d.vnome,
           case when d.vnome is not null then vendedor_nome_norm(d.vnome) end as vnorm
    from pg
    left join dim d on d.id_int = pg.id_int
  ), agg as (
    select vnorm, max(vnome) as vendedor,
           sum(valor) as valor, count(distinct id_int) as pedidos
    from base
    where vnorm is not null
    group by vnorm
  ), tot as (
    select coalesce(sum(valor), 0) as total from base
  )
  select jsonb_build_object(
    'total', (select total from tot),
    'ranking', coalesce((
      select jsonb_agg(jsonb_build_object(
               'posicao', posicao, 'vendedor', vendedor, 'valor', valor,
               'pedidos', pedidos,
               'ticket', case when pedidos > 0 then round(valor / pedidos, 2) end,
               'participacao_pct', case when (select total from tot) > 0
                 then round(100 * valor / (select total from tot), 1) end)
               order by posicao)
      from (select row_number() over (order by valor desc, vendedor) as posicao, agg.*
            from agg) r), '[]'::jsonb))
  into v_resultado;

  return v_resultado;
end
$$;

revoke all on function public.rpc_ranking_vendedores(date, date) from public, anon;
grant execute on function public.rpc_ranking_vendedores(date, date) to authenticated, service_role;
