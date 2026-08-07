-- 20260808_rpc_dashboard_vendedor.sql
--
-- Dashboard do Vendedor ("Meu desempenho"): agregados EXCLUSIVAMENTE do
-- vendedor autenticado (auth.uid()) + total consolidado da empresa (escalar).
--
-- SEGURANÇA: SEM parâmetro de vendedor ou empresa — o vendedor é resolvido no
-- banco a partir do auth.uid() e nenhum input do front pode trocá-lo. Usuário
-- sem perfil de vendedor recebe exception (42501). Grant SEM anon.
--
-- PRIVACIDADE: nunca devolve nome/valor de outros vendedores, nem ranking,
-- nem breakdown por dimensão que permita dedução de valores de terceiros.
-- O único dado global é o total consolidado (escalar), permitido pelo dono.
--
-- Regra oficial de faturamento por vendedor (Maestro, gabarito validado):
-- pagamentos_v2 com confirmado = true AND status IN ('PAID','A_VENCER'),
-- período por (data_confirmacao AT TIME ZONE 'America/Sao_Paulo')::date,
-- soma de valor; propostas usadas APENAS como dimensão (vendedor via id_int);
-- pedidos = count(DISTINCT id_int). Idêntica à view_pagamentos_pagos_v2,
-- para o total consolidado bater com o Dashboard executivo.

-- ─── Normalização de nome comercial (paridade com o Maestro) ─────────────────
-- unaccent instalada no schema public (verificado).
create or replace function public.vendedor_nome_norm(p_nome text)
returns text
language sql
stable
as $$
  select lower(public.unaccent(trim(coalesce(p_nome, ''))))
$$;

revoke all on function public.vendedor_nome_norm(text) from public;
grant execute on function public.vendedor_nome_norm(text) to authenticated, service_role;

-- ─── RPC principal ───────────────────────────────────────────────────────────
create or replace function public.rpc_dashboard_vendedor(
  p_inicio      date,
  p_fim         date,
  p_inicio_prev date,
  p_fim_prev    date
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_nome    text;
  v_norm    text;
  v_ok      boolean;
  v_ini_min date := least(p_inicio, p_inicio_prev);
  v_fim_max date := greatest(p_fim, p_fim_prev);

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
  v_ult_pagamentos jsonb;
  v_ult_propostas  jsonb;
begin
  -- ── Resolução do vendedor: SEMPRE via auth.uid(); nunca por parâmetro ──────
  if v_uid is null then
    raise exception 'ACESSO_NEGADO_VENDEDOR' using errcode = '42501',
      hint = 'Sessão não autenticada.';
  end if;

  -- Mesmo critério que materializa perfilSlug = "vendedor" no front
  -- (perfil oficial OU legado sem perfil: is_vendedor sem flags de admin).
  select coalesce(nullif(trim(u.meu_vendedor), ''), nullif(trim(u.nome_usuario), '')),
         (pf.slug = 'vendedor')
         or (u.id_perfil is null
             and coalesce(u.is_vendedor, false)
             and not coalesce(u.is_admin, false)
             and not coalesce(u.is_super_adm, false))
    into v_nome, v_ok
  from usuarios u
  left join perfis pf on pf.id = u.id_perfil
  where u.user_id = v_uid;

  if not found or not coalesce(v_ok, false) then
    raise exception 'ACESSO_NEGADO_VENDEDOR' using errcode = '42501',
      hint = 'Página exclusiva do perfil vendedor.';
  end if;
  if v_nome is null then
    raise exception 'VENDEDOR_SEM_NOME' using errcode = '42501',
      hint = 'Usuário vendedor sem nome comercial configurado.';
  end if;

  v_norm := vendedor_nome_norm(v_nome);

  -- ── FATURAMENTO: uma varredura de pagamentos_v2 (regra oficial) ────────────
  -- "proprio" via EXISTS (nunca JOIN: id_int duplicado em propostas faria
  -- fan-out e inflaria o total consolidado).
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

  -- Participação % (null quando o total do range é zero).
  v_faturamento := v_faturamento || jsonb_build_object(
    'participacao_pct', jsonb_build_object(
      'atual', case when (v_faturamento#>>'{total,atual}')::numeric > 0
        then round(100 * (v_faturamento#>>'{proprio,atual,valor}')::numeric
                       / (v_faturamento#>>'{total,atual}')::numeric, 1) end,
      'anterior', case when (v_faturamento#>>'{total,anterior}')::numeric > 0
        then round(100 * (v_faturamento#>>'{proprio,anterior,valor}')::numeric
                       / (v_faturamento#>>'{total,anterior}')::numeric, 1) end));

  -- ── Evolução do faturamento PRÓPRIO (dia ≤ 62 dias, senão mês) ─────────────
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

  -- ── PROPOSTAS PRÓPRIAS: coorte por created_at SP (atual × anterior) ────────
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

  -- ── PROPOSTAS PRÓPRIAS por status (período atual) ──────────────────────────
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

  -- ── FOTO: propostas próprias aguardando ────────────────────────────────────
  select jsonb_build_object('qtd', count(*),
           'valor', coalesce(sum(coalesce(p.valor_total, 0)::numeric), 0))
  into v_aguardando
  from propostas p
  where p.status_interno = any(c_aguardando)
    and coalesce(p.is_reproved, false) = false
    and vendedor_nome_norm(p.vendedor) = v_norm;

  -- ── FOTO: pedidos próprios em produção (mesma regra da tela /producao) ─────
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
  -- (status de entrega em propostas OU propostas_os.data_termino populada).

  -- ── WIDGET: últimos 5 pagamentos confirmados do PRÓPRIO vendedor ───────────
  -- Filtro de dono ANTES do limit — nenhuma linha de terceiro entra.
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

  -- ── WIDGET: últimas 5 propostas do PRÓPRIO vendedor ────────────────────────
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
    'faturamento', v_faturamento,
    'serie', v_serie,
    'serie_bucket', v_serie_bucket,
    'propostas', v_propostas || jsonb_build_object('por_status', v_por_status),
    'fotos', jsonb_build_object('aguardando', v_aguardando, 'producao', v_producao),
    'widgets', jsonb_build_object(
      'ultimos_pagamentos', v_ult_pagamentos,
      'ultimas_propostas', v_ult_propostas));
end
$$;

-- SEM anon (diferente da RPC executiva): a página exige login e perfil vendedor.
revoke all on function public.rpc_dashboard_vendedor(date, date, date, date) from public, anon;
grant execute on function public.rpc_dashboard_vendedor(date, date, date, date) to authenticated, service_role;
