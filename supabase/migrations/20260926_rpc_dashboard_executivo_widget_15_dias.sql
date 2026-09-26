-- rpc_dashboard_executivo: widget "Ultimas propostas aprovadas" com janela de 15 dias
--
-- Autorizado pelo dono em 26/09/2026, so para esta alteracao.
--
-- POR QUE
--   A RPC completava em media 5,2 s (maximo 7,1 s) contra o statement_timeout
--   de 8 s do papel authenticated; as chamadas que passavam de 8 s derrubavam
--   todos os indicadores do /dashboard e o widget, que vem no mesmo pacote.
--   O widget buscava 120 dias do log de auditoria (~14 mil eventos, ~47 mil
--   paginas) para devolver 5 linhas, e chegou a 2,8 s sozinho.
--
-- O QUE MUDA
--   So o bloco do widget. Ele tenta 15 dias; se vierem menos de 5 linhas
--   (empresa com pouca aprovacao no periodo), roda o bloco ORIGINAL de 120
--   dias, mantido intacto. As janelas ficam literais nas duas consultas, sem
--   variavel, para o plano da funcao nao virar generico.
--   Como o widget usa max(occurred_at) por proposta, as 5 mais recentes saem
--   iguais nas duas janelas.
--
-- PARTIU DO CORPO VIVO
--   O prosrc vivo foi comparado com 20260820_rpc_dashboard_executivo_ignora_teste.sql
--   antes de alterar: identicos (18.455 caracteres, md5 b4f39deb3d770efd42c20a01b619c2a8).
--   A assercao de entrada aborta se o corpo vivo nao for mais esse.
--
-- CREATE OR REPLACE preserva dono, ACL e assinatura. Nada mais na funcao muda.

do $$
declare
  v_md5 text;
  v_n   int;
begin
  select count(*), max(md5(p.prosrc)) into v_n, v_md5
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'rpc_dashboard_executivo';
  if v_n <> 1 then
    raise exception 'ABORTADO: esperada 1 rpc_dashboard_executivo, encontradas %.', v_n;
  end if;
  if v_md5 <> 'b4f39deb3d770efd42c20a01b619c2a8' then
    raise exception 'ABORTADO: o corpo vivo mudou desde a comparacao (md5 %). Reveja antes.', v_md5;
  end if;
end $$;

create or replace function public.rpc_dashboard_executivo(
  p_inicio date,
  p_fim date,
  p_inicio_prev date,
  p_fim_prev date,
  p_id_empresa integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_hoje    date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ini_min date := least(p_inicio, p_inicio_prev);
  v_fim_max date := greatest(p_fim, p_fim_prev);

  c_ganho constant text[] := array[
    'APROVADO','APROVADO / EM ARTE','LIBERADO',
    'REVISAO ATENDENTE','REVISAO PRODUCAO','EM PRODUCAO',
    'EM IMPRESSAO','EM IMPRESSAO / PENDENTE','EM ACABAMENTO','EM ACABAMENTO / PENDENTE',
    'EXPEDICAO','A RETIRAR','EM TRANSITO','ENTREGUE'];
  c_producao constant text[] := array[
    'LIBERADO','REVISAO ATENDENTE','REVISAO PRODUCAO','EM PRODUCAO',
    'EM IMPRESSAO','EM IMPRESSAO / PENDENTE','EM ACABAMENTO','EM ACABAMENTO / PENDENTE'];

  v_comercial          jsonb;
  v_por_status         jsonb;
  v_aprovadas_tipo     jsonb;
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
  -- INALTERADO: conta por created_at. Pedido de teste encerrado segue aqui.
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

  -- ── COMERCIAL: distribuição por status (LIBERADO unificado em APROVADO) ────
  select coalesce(jsonb_agg(jsonb_build_object('status', status, 'qtd', qtd, 'valor', valor)
                            order by qtd desc), '[]'::jsonb)
  into v_por_status
  from (
    select case upper(trim(coalesce(p.status_interno, '')))
             when 'LIBERADO' then 'APROVADO'
             when 'LIBERADO / EM ARTE' then 'APROVADO / EM ARTE'
             else coalesce(nullif(trim(p.status_interno), ''), 'SEM STATUS')
           end as status,
           count(*) as qtd,
           coalesce(sum(coalesce(p.valor_total, 0)::numeric), 0) as valor
    from propostas p
    where (p.created_at at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
      and dashboard_empresa_match(p.empresa, p_id_empresa)
    group by 1
  ) s;

  -- ── COMERCIAL: valores aprovados por tipo de cobrança (período atual) ──────
  -- Pagamentos VÁLIDOS (PAID, ou A_VENCER confirmado) das propostas da família
  -- ganho criadas no período. Caixa normalizada (E-Faturado ≡ E-FATURADO).
  select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'valor', valor, 'qtd', qtd)
                            order by valor desc), '[]'::jsonb)
  into v_aprovadas_tipo
  from (
    select coalesce(nullif(upper(trim(p2.tipo_cobranca)), ''), 'SEM TIPO') as tipo,
           sum(coalesce(p2.valor, 0)::numeric) as valor,
           count(*) as qtd
    from pagamentos_v2 p2
    where (p2.status = 'PAID' or (p2.status = 'A_VENCER' and p2.confirmado = true))
      and exists (
        select 1 from propostas p
        where p.id_int = p2.id_int
          and (p.created_at at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
          and p.status_interno = any(c_ganho)
          and not coalesce(p.is_reproved, false)
          and dashboard_empresa_match(p.empresa, p_id_empresa)
      )
    group by 1
  ) s;

  -- ── COMERCIAL: tempo até aprovação (1ª transição p/ APROVADO ou LIBERADO) ──
  with aprov as (
    select p.id,
           min(v.occurred_at) as aprovado_em,
           p.created_at
    from vw_audit_logs_v2 v
    join propostas p on p.id = (v.record_pk->>'id')::uuid
    where v.table_name = 'propostas'
      and v.action = 'UPDATE'
      and v.changed_fields->'status_interno'->>'new' in ('APROVADO', 'LIBERADO')
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

  -- ── WIDGET: últimas propostas aprovadas (APROVADO ou LIBERADO) ─────────────
  -- ALTERADO EM 26/09/2026: a janela de 120 dias lia ~14 mil eventos do log de
  -- auditoria para devolver 5 linhas, e o bloco sozinho chegou a 2,8 s. Tenta
  -- 15 dias primeiro; so se vierem menos de 5 (empresa com pouca aprovacao)
  -- cai no bloco original de 120 dias, mantido intacto logo abaixo. Como e o
  -- max(occurred_at) por proposta, as 5 mais recentes saem iguais nas duas.
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
        and v.changed_fields->'status_interno'->>'new' in ('APROVADO', 'LIBERADO')
        and v.occurred_at >= now() - interval '15 days'
      group by 1
    ) a
    join propostas p on p.id = a.pid
    where dashboard_empresa_match(p.empresa, p_id_empresa)
    order by a.aprovado_em desc
    limit 5
  ) s;

  if jsonb_array_length(v_ultimas_aprovacoes) < 5 then
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
          and v.changed_fields->'status_interno'->>'new' in ('APROVADO', 'LIBERADO')
          and v.occurred_at >= now() - interval '120 days'
        group by 1
      ) a
      join propostas p on p.id = a.pid
      where dashboard_empresa_match(p.empresa, p_id_empresa)
      order by a.aprovado_em desc
      limit 5
    ) s;
  end if;

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

  v_serie_bucket := case when (p_fim - p_inicio) <= 62 then 'dia' else 'mes' end;
  if v_serie_bucket = 'dia' then
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

  -- ── FINANCEIRO: carteira de boletos (foto de hoje) ─────────────────────────
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

  select jsonb_build_object('qtd', count(*), 'valor', coalesce(sum(valor_saldo), 0))
  into v_cc
  from conta_corrente_pendencias
  where status in ('ABERTA', 'PARCIALMENTE_RESOLVIDA');

  -- ── PRODUÇÃO ───────────────────────────────────────────────────────────────
  -- ALTERADO EM 20/08/2026: pedido de teste encerrado sai da contagem, para o
  -- card bater com o painel de /pedidos e o de /expedicao, que ja filtram.
  with prod as (
    select coalesce(nullif(trim(p.status_interno), ''), 'SEM STATUS') as etapa
    from propostas p
    where coalesce(p.is_prd_aprovado, false)
      and p.status_interno = any(c_producao)
      and p.encerrado_teste_em is null
      and dashboard_empresa_match(p.empresa, p_id_empresa)
  )
  select jsonb_build_object(
    'total', (select count(*) from prod),
    'por_etapa', coalesce((
      select jsonb_agg(jsonb_build_object('etapa', etapa, 'qtd', qtd) order by qtd desc)
      from (select etapa, count(*) as qtd from prod group by 1) e), '[]'::jsonb))
  into v_producao;

  -- ALTERADO EM 20/08/2026: mesmo filtro do bloco acima. Sem ele, a soma por
  -- setor nao fecharia com o total de `v_producao`.
  select coalesce(jsonb_agg(jsonb_build_object('setor', setor, 'qtd', qtd) order by qtd desc), '[]'::jsonb)
  into v_por_setor
  from (
    select coalesce(nullif(trim(pm.setor), ''), 'Sem setor') as setor, count(*) as qtd
    from pedidos_modelos pm
    join propostas p on p.id_int = pm.id_int
    where coalesce(p.is_prd_aprovado, false)
      and p.status_interno = any(c_producao)
      and p.encerrado_teste_em is null
      and dashboard_empresa_match(p.empresa, p_id_empresa)
    group by 1
  ) s;

  -- ── FISCAL ─────────────────────────────────────────────────────────────────
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

  -- ── CLIENTES ───────────────────────────────────────────────────────────────
  select jsonb_build_object(
    'atual',    count(*) filter (where data_cadastro between p_inicio and p_fim),
    'anterior', count(*) filter (where data_cadastro between p_inicio_prev and p_fim_prev))
  into v_novos
  from clientes
  where data_cadastro between v_ini_min and v_fim_max;

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
      || jsonb_build_object(
           'por_status', v_por_status,
           'tempo_aprovacao', v_tempo,
           'aprovadas_por_tipo', v_aprovadas_tipo),
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
$function$;

do $$
declare
  v_md5 text;
  v_n   int;
  v_acl text[];
  v_def boolean;
  v_vol text;
  v_cfg text[];
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'rpc_dashboard_executivo';
  if v_n <> 1 then
    raise exception 'FALHOU: % versoes da funcao.', v_n;
  end if;

  select md5(p.prosrc), p.prosecdef, p.provolatile::text, p.proconfig
    into v_md5, v_def, v_vol, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'rpc_dashboard_executivo';

  select array_agg(coalesce(r.rolname, 'PUBLIC') || '=' || x.privilege_type
                   order by coalesce(r.rolname, 'PUBLIC') || '=' || x.privilege_type)
    into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
         aclexplode(p.proacl) x left join pg_roles r on r.oid = x.grantee
   where n.nspname = 'public' and p.proname = 'rpc_dashboard_executivo';

  if v_md5 <> '60989ba7b030d634d18a1d92fe0c0710' then
    raise exception 'FALHOU: corpo gravado diverge do previsto (md5 %).', v_md5;
  end if;
  if not v_def or v_vol <> 's' or v_cfg is distinct from array['search_path=public, pg_temp'] then
    raise exception 'FALHOU: atributos mudaram: secdef % volat % config %.', v_def, v_vol, v_cfg;
  end if;
  if v_acl is distinct from array['anon=EXECUTE','authenticated=EXECUTE','postgres=EXECUTE','service_role=EXECUTE'] then
    raise exception 'FALHOU: ACL mudou: %.', v_acl;
  end if;
end $$;
