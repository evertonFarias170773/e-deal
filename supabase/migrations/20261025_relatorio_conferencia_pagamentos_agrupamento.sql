-- Conferencia de pagamentos: o Faturado deixa o grupo "passa pelo banco" (decisao de 25/10/2026).
-- "Passa pelo banco" = PIX, boleto e cartao (de credito e parcelado). Faturado entra em "sem
-- movimento no banco", junto de credito do cliente, amostra, retrabalho e permuta. Mudou so a
-- marcacao banco (e, por ela, os totais total_banco / total_sem_banco e o agrupamento por forma):
-- criterio de data (paid_at, dia de Sao Paulo), PAID, empresa, forma e venda de teste ficam como
-- estavam, e o total geral nao muda. Nenhum GRANT ou RLS tocado.
--
-- Trava: so aplica se o corpo vivo tiver o md5 lido antes (25/10/2026).

do $$
declare
  v_md5 text := md5(pg_get_functiondef(
    'public.rpc_relatorio_conferencia_pagamentos(date,date,smallint[],text[],integer)'::regprocedure));
begin
  if v_md5 <> '0478b50adb8295efb03e94ff4fa63fa4' then
    raise exception 'rpc_relatorio_conferencia_pagamentos mudou desde a leitura (md5 %); abortado.', v_md5;
  end if;
end $$;

create or replace function public.rpc_relatorio_conferencia_pagamentos(
  p_data_inicio date, p_data_fim date,
  p_empresas smallint[] default null::smallint[],
  p_formas text[] default null::text[],
  p_limite integer default 5000)
returns jsonb
language plpgsql
stable
as $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_qtd bigint;
begin
  if v_uid is not null then
    perform public.cc__assert_permissao(v_uid, 'relatorios.conferencia_pagamentos');
  elsif coalesce(auth.role(), '') = 'anon' then
    raise exception 'AUTH: usuário não autenticado' using errcode = '28000';
  end if;

  if p_data_inicio is null or p_data_fim is null or p_data_fim < p_data_inicio then
    raise exception 'Período inválido' using errcode = '22023';
  end if;

  select count(*) into v_qtd
  from public.pagamentos_v2 pg
  where pg.status = 'PAID'
    and pg.paid_at is not null
    and pg.paid_at >= (p_data_inicio::timestamp at time zone 'America/Sao_Paulo')
    and pg.paid_at < ((p_data_fim + 1)::timestamp at time zone 'America/Sao_Paulo')
    and not exists (
      select 1 from public.propostas prt
      where prt.id_int = pg.id_int
        and public.fn_venda_de_teste(prt.id_cliente::bigint, prt.id_faturado, prt.vendedor, prt.user_id)
    )
    and (p_empresas is null or array_length(p_empresas, 1) is null or pg.id_empresa = any(p_empresas))
    and (p_formas is null or array_length(p_formas, 1) is null
         or upper(btrim(coalesce(pg.tipo_cobranca, ''))) = any(select upper(btrim(f)) from unnest(p_formas) f));

  if v_qtd > p_limite then
    raise exception 'LIMITE: % pagamentos no período; o máximo é %. Reduza o período.', v_qtd, p_limite
      using errcode = '54000';
  end if;

  return (
    with pagamentos as (
      select
        pg.id,
        pg.id_int,
        pg.id_empresa,
        (pg.paid_at at time zone 'America/Sao_Paulo')::date as data,
        to_char(pg.paid_at at time zone 'America/Sao_Paulo', 'HH24:MI') as hora,
        pg.paid_at,
        coalesce(nullif(upper(btrim(pg.tipo_cobranca)), ''), 'SEM FORMA') as forma,
        coalesce(nullif(btrim(pg.cliente), ''), nullif(btrim(pr.cliente), ''), '') as cliente,
        pg.valor
      from public.pagamentos_v2 pg
      left join public.propostas pr on pr.id_int = pg.id_int
      where pg.status = 'PAID'
        and pg.paid_at is not null
        and pg.paid_at >= (p_data_inicio::timestamp at time zone 'America/Sao_Paulo')
        and pg.paid_at < ((p_data_fim + 1)::timestamp at time zone 'America/Sao_Paulo')
        and not exists (
          select 1 from public.propostas prt
          where prt.id_int = pg.id_int
            and public.fn_venda_de_teste(prt.id_cliente::bigint, prt.id_faturado, prt.vendedor, prt.user_id)
        )
        and (p_empresas is null or array_length(p_empresas, 1) is null or pg.id_empresa = any(p_empresas))
        and (p_formas is null or array_length(p_formas, 1) is null
             or upper(btrim(coalesce(pg.tipo_cobranca, ''))) = any(select upper(btrim(f)) from unnest(p_formas) f))
    ),
    marcado as (
      select p.*,
        (p.forma in ('PIX', 'BOLETO', 'CREDIT_CARD', 'CARD_PARCELADO')) as banco
      from pagamentos p
    ),
    por_forma as (
      select forma, banco, count(*) as quantidade, coalesce(sum(valor), 0) as total
      from marcado group by forma, banco
    ),
    por_empresa as (
      select id_empresa, count(*) as quantidade, coalesce(sum(valor), 0) as total
      from marcado group by id_empresa
    )
    select jsonb_build_object(
      'ok', true,
      'tipo', 'conferencia_pagamentos',
      'filtros', jsonb_build_object(
        'data_inicio', p_data_inicio, 'data_fim', p_data_fim,
        'empresas', p_empresas, 'formas', p_formas),
      'totais', jsonb_build_object(
        'quantidade', (select count(*) from marcado),
        'total', (select coalesce(sum(valor), 0) from marcado),
        'quantidade_banco', (select count(*) from marcado where banco),
        'total_banco', (select coalesce(sum(valor), 0) from marcado where banco),
        'quantidade_sem_banco', (select count(*) from marcado where not banco),
        'total_sem_banco', (select coalesce(sum(valor), 0) from marcado where not banco)),
      'por_forma', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'forma', forma, 'banco', banco, 'quantidade', quantidade, 'total', total)
          order by banco desc, total desc), '[]'::jsonb)
        from por_forma),
      'por_empresa', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id_empresa', id_empresa, 'quantidade', quantidade, 'total', total)
          order by id_empresa), '[]'::jsonb)
        from por_empresa),
      'linhas', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', id, 'data', data, 'hora', hora, 'pedido', id_int, 'cliente', cliente,
          'forma', forma, 'banco', banco, 'id_empresa', id_empresa, 'valor', valor)
          order by paid_at, id), '[]'::jsonb)
        from marcado)
    )
  );
end;
$function$;
