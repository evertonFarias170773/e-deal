-- Dashboard: o bloco PRODUCAO passa a ignorar pedido de teste encerrado
--
-- O QUE E
--   `CREATE OR REPLACE` de `public.rpc_dashboard_executivo`, mudando DUAS
--   linhas: os blocos `prod` e `v_por_setor` ganham
--
--     and p.encerrado_teste_em is null
--
--   ao lado dos filtros que ja tinham (`is_prd_aprovado` + `c_producao`).
--   Nenhuma outra linha da funcao muda.
--
-- POR QUE
--   Sem isso, painel e dashboard divergem. Desde 20/08/2026 o painel geral de
--   Producao e o de Expedicao filtram `encerrado_teste_em is null`; o card
--   "Producao" do dashboard continuaria contando o pedido que a lista nao
--   mostra mais. Numero que nao bate com a tela vira desconfianca do dashboard
--   inteiro.
--
--   Os dois blocos alterados sao exatamente os que leem `is_prd_aprovado` — ou
--   seja, os que descrevem a FILA DE TRABALHO. Onde o dashboard descreve
--   dinheiro ou volume comercial, nada muda (ver ESCOPO).
--
-- ESCOPO / O QUE ESTA MIGRATION NAO FAZ
--   NAO mexe no bloco COMERCIAL (`criadas`, `ganho`, `perdido`, `por_status`,
--   `aprovadas_por_tipo`, `tempo_aprovacao`, `ultimas_aprovacoes`), que conta
--   por `created_at` e `status_interno`. NAO mexe no bloco FINANCEIRO, movido
--   por `view_pagamentos_pagos_v2` e `boletos`. NAO mexe em FISCAL nem em
--   CLIENTES.
--
--   Consequencia deliberada: pedido de teste encerrado SOME da fila de trabalho
--   e SEGUE contando no faturamento e no comercial. Tirar pedido de teste do
--   dinheiro e tarefa a parte, com decisao propria — nao e efeito colateral
--   desta.
--
--   NAO cria, remove nem altera permissao. `CREATE OR REPLACE` preserva o ACL e
--   o dono da funcao; um `DROP` + `CREATE` os perderia, e por isso nao e usado
--   aqui. A verificacao (c) compara o ACL antes/depois.
--
--   NAO altera `rpc_dashboard_vendedor`, que tambem le `is_prd_aprovado`. Fica
--   de fora de proposito: e a tela "Meu desempenho", de recorte por vendedor, e
--   merece decisao propria em vez de carona nesta migration. Registrado como
--   pendencia conhecida.
--
--   Verificado no banco em 20/08/2026, antes de escrever:
--
--   1. `public.propostas.encerrado_teste_em` existe (migration
--      20260820_propostas_encerrado_teste.sql, aplicada), e hoje ha ZERO
--      propostas marcadas. Portanto o predicado novo nao descarta NENHUMA linha
--      e a funcao devolve o mesmo resultado de antes: a mudanca so passa a ter
--      efeito quando o dono marcar o primeiro pedido pela tela.
--
--      E assim que a verificacao (d) confere isso — pela PROVA DE INERCIA
--      (contagem com e sem o filtro, no mesmo instante), e NAO por comparacao de
--      payload antes/depois. Banco vivo com operacao intensa move o payload
--      sozinho; ver a nota de criterio em (d).
--
--   2. Assinatura atual, preservada tal e qual:
--      rpc_dashboard_executivo(p_inicio date, p_fim date, p_inicio_prev date,
--                              p_fim_prev date, p_id_empresa integer)
--      RETURNS jsonb, LANGUAGE plpgsql, STABLE, SECURITY DEFINER,
--      SET search_path TO 'public', 'pg_temp'.
--
--   3. ACL atual: {anon, authenticated, postgres, service_role}.
--      `anon` esta na lista hoje. Esta migration NAO mexe nisso — reduzir o
--      alcance de uma funcao SECURITY DEFINER e mudanca de seguranca, com
--      impacto proprio, e nao entra de carona. Fica registrado como ponto a
--      revisar em separado.

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

-- VERIFICACAO (somente leitura, depois de aplicar)
--
--   -- a) a funcao continua UNICA, com a mesma assinatura e as mesmas flags
--   select p.proname,
--          pg_get_function_identity_arguments(p.oid) as args,
--          p.prosecdef as security_definer,
--          p.provolatile as volatilidade,   -- 's' = STABLE
--          p.proconfig                      -- {search_path=public,pg_temp}
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'rpc_dashboard_executivo';
--   -- esperado: 1 linha; args = "p_inicio date, p_fim date, p_inicio_prev date,
--   --           p_fim_prev date, p_id_empresa integer"; security_definer = true;
--   --           volatilidade = 's'. Duas linhas significam sobrecarga acidental.
--
--   -- b) os DOIS filtros novos estao no corpo, e so eles
--   select (select count(*) from regexp_matches(p.prosrc, 'encerrado_teste_em is null', 'g')) as filtros_novos
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'rpc_dashboard_executivo';
--   -- esperado: 2 (bloco `prod` e bloco `v_por_setor`). Nem 1, nem 3.
--
--   -- c) ACL COMPLETO preservado pelo CREATE OR REPLACE.
--   --    Rodar ANTES e DEPOIS e comparar as duas saidas — devem ser IDENTICAS.
--   select p.proname,
--          pg_get_userbyid(p.proowner) as dono,
--          coalesce(
--            (select array_agg(coalesce(r.rolname, 'PUBLIC') || '=' || x.privilege_type
--                              order by coalesce(r.rolname, 'PUBLIC'), x.privilege_type)
--               from aclexplode(p.proacl) x
--               left join pg_roles r on r.oid = x.grantee),
--            '{}'::text[]) as acl
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'rpc_dashboard_executivo';
--   -- esperado ANTES e DEPOIS (medido em 20/08/2026):
--   --   dono = postgres
--   --   acl  = {anon=EXECUTE, authenticated=EXECUTE, postgres=EXECUTE, service_role=EXECUTE}
--   -- Se o ACL encolher, PARAR: o dashboard cai para os perfis que perderam EXECUTE.
--
--   -- d) PROVA DE INERCIA — o criterio que vale neste banco.
--   --
--   -- CRITERIO: CONTAGEM COM E SEM O FILTRO, NO MESMO INSTANTE.
--   -- Comparar hash do payload antes/depois NAO serve aqui, pelo mesmo motivo
--   -- da migration 20260820_propostas_encerrado_teste.sql: o banco e vivo e a
--   -- operacao e intensa. Na aplicacao real, em 20/08/2026, entre as duas
--   -- medicoes houve 17 mudancas de status_interno, 7 pagamentos confirmados e
--   -- 5 propostas novas em 15 minutos — o payload muda sozinho, e a divergencia
--   -- nao diz nada sobre a migration.
--   --
--   -- O que prova a inercia e que o predicado novo nao descarta NENHUMA linha:
--   -- as duas contagens abaixo, lidas no mesmo instante, devem ser IGUAIS.
--   -- Predicado que nao descarta linha nao altera agregado.
--   select
--     (select count(*) from propostas p
--       where coalesce(p.is_prd_aprovado, false)
--         and p.status_interno = any(array['LIBERADO','REVISAO ATENDENTE','REVISAO PRODUCAO',
--             'EM PRODUCAO','EM IMPRESSAO','EM IMPRESSAO / PENDENTE','EM ACABAMENTO',
--             'EM ACABAMENTO / PENDENTE'])
--         and p.encerrado_teste_em is null
--         and dashboard_empresa_match(p.empresa, 0)) as com_filtro,
--     (select count(*) from propostas p
--       where coalesce(p.is_prd_aprovado, false)
--         and p.status_interno = any(array['LIBERADO','REVISAO ATENDENTE','REVISAO PRODUCAO',
--             'EM PRODUCAO','EM IMPRESSAO','EM IMPRESSAO / PENDENTE','EM ACABAMENTO',
--             'EM ACABAMENTO / PENDENTE'])
--         and dashboard_empresa_match(p.empresa, 0)) as sem_filtro,
--     (select count(*) from propostas where encerrado_teste_em is not null) as marcados;
--   -- esperado enquanto ninguem marcou: com_filtro = sem_filtro, marcados = 0.
--   -- Medido na aplicacao (20/08/2026): 9 = 9 para todas as empresas e 6 = 6
--   -- para a empresa 3, com marcados = 0.
--   --
--   -- Depois que houver pedido marcado, a igualdade vira uma diferenca EXATA:
--   -- sem_filtro - com_filtro = numero de marcados que estariam na fila (item e).
--
--   -- d.1) ANOMALIA NAO EXPLICADA, registrada de proposito.
--   --   Na aplicacao de 20/08/2026 a instrumentacao guardou o md5 do payload
--   --   antes e depois, em dois recortes. O recorte da empresa 3 divergiu
--   --   (deriva de dados, confirmada pelos 7 pagamentos da janela). O recorte de
--   --   TODAS as empresas veio com hash identico nas tres leituras — o que nao
--   --   bate, ja que `dashboard_empresa_match(empresa, 0)` devolve true
--   --   incondicionalmente e portanto ele e superconjunto do recorte da 3.
--   --
--   --   Isso ficou SEM EXPLICACAO. A instrumentacao guardou apenas o md5, e nao
--   --   o payload byte a byte, entao nao da para apontar qual sub-bloco explica
--   --   a estabilidade. E limitacao da medicao daquele dia, nao evidencia sobre
--   --   a funcao: a prova de inercia acima INDEPENDE dela e sozinha ja fecha a
--   --   questao. Registrado para nao parecer resolvido — nao investigar de novo
--   --   sem motivo novo (decisao do dono, 20/08/2026).
--
--   -- e) confirmacao de que so o bloco `producao` reage a marcacao.
--   --    Com pelo menos um pedido marcado, o total do bloco `producao` deve cair
--   --    exatamente na quantidade de marcados que estariam na fila:
--   select (select count(*) from public.propostas
--            where coalesce(is_prd_aprovado, false)
--              and encerrado_teste_em is not null
--              and status_interno in ('LIBERADO','REVISAO ATENDENTE','REVISAO PRODUCAO',
--                  'EM PRODUCAO','EM IMPRESSAO','EM IMPRESSAO / PENDENTE',
--                  'EM ACABAMENTO','EM ACABAMENTO / PENDENTE')) as marcados_que_sairam_da_fila;
--
-- ROLLBACK
--   Reaplicar a versao anterior da funcao, que e a mesma deste arquivo SEM as
--   duas linhas `and p.encerrado_teste_em is null`. `CREATE OR REPLACE` de novo
--   preserva ACL e dono. Fonte da versao anterior:
--   supabase/migrations/20260807_rpc_dashboard_executivo.sql.
--
--   Alternativa mais barata, se o objetivo for so parar o efeito: reabrir os
--   pedidos marcados pela tela (menu Acoes em Orcamentos). Com zero marcados, a
--   funcao com filtro e a sem filtro devolvem o mesmo resultado.
