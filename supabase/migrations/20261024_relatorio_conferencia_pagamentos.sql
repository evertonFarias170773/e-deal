-- Relatorio CONFERENCIA DE PAGAMENTOS (para conferir com o extrato bancario): funcao NOVA,
-- nada existente e alterado, nenhum GRANT ou RLS tocado.
--
-- Criterio (o do extrato, nao o da tela de Conferencia): so PAID, pela data do pagamento
-- (paid_at, dia de Sao Paulo). Faturado A_VENCER nao aparece no extrato e fica fora; PAID sem
-- paid_at tambem (1 linha hoje). Vendas de teste ficam fora (fn_venda_de_teste). Nao tira
-- amostra, retrabalho nem credito: sao PAID, mas nao movimentam o banco; entram na lista e nos
-- subtotais por forma, marcados como "sem movimento no banco" (banco = false), e o total do
-- banco vem separado. Linhas de reenvio (diferenca de frete) entram: foram dinheiro de verdade.
-- Forma normalizada: maiuscula e sem espaco nas pontas (E-Faturado = E-FATURADO).
--
-- Devolve jsonb (sem o corte de 1000 linhas do PostgREST): totais, subtotais por forma, por
-- empresa e as linhas. Confere a chave relatorios.conferencia_pagamentos com cc__assert_permissao
-- quando ha usuario logado (admin e super admin passam); anon e recusado; service_role e conexao
-- direta seguem sem usuario. p_limite protege o banco e o PDF: acima dele, a funcao recusa.

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
        (p.forma in ('PIX', 'BOLETO', 'CREDIT_CARD', 'CARD_PARCELADO', 'E-FATURADO')) as banco
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
