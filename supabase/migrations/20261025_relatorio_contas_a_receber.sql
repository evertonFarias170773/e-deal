-- Relatorio CONTAS A RECEBER (vencidas e a vencer): funcao NOVA, nada existente e alterado,
-- nenhum GRANT ou RLS tocado.
--
-- Fonte e regra = as da Carteira (/contas-a-receber): tabela boletos; so entram VENCIDO e
-- A_VENCER (A_RECEBER fica de fora, como na Carteira; PAID e CANCELADO nao sao a receber).
-- Valor = valor_atualizado, ou valor quando nao ha atualizacao (a mesma conta dos cards).
-- Meio de pagamento = o da Carteira: "Deposito em conta" quando deposito_conta, senao "Boleto".
-- Dias de atraso = o da Carteira: o dias_atraso gravado quando maior que zero, senao hoje (dia de
-- Sao Paulo) menos o vencimento; vazio para a vencer.
-- A data do filtro e o VENCIMENTO. Os cards da Carteira nao recortam por data (somam a carteira
-- inteira); este relatorio recorta pelo periodo pedido.
-- Diferenca de proposito para a Carteira: vendas de teste ficam de fora (fn_venda_de_teste).
--
-- Devolve jsonb: totais (geral, vencidas, a vencer), subtotais por meio (com a divisao vencidas e
-- a vencer) e por empresa, e as linhas. Confere a chave relatorios.contas_a_receber com
-- cc__assert_permissao quando ha usuario logado (admin e super admin passam); anon e recusado;
-- service_role e conexao direta seguem sem usuario. p_limite protege o banco e o PDF.

create or replace function public.rpc_relatorio_contas_a_receber(
  p_data_inicio date, p_data_fim date,
  p_empresas smallint[] default null::smallint[],
  p_meios text[] default null::text[],
  p_limite integer default 5000)
returns jsonb
language plpgsql
stable
as $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_qtd bigint;
begin
  if v_uid is not null then
    perform public.cc__assert_permissao(v_uid, 'relatorios.contas_a_receber');
  elsif coalesce(auth.role(), '') = 'anon' then
    raise exception 'AUTH: usuário não autenticado' using errcode = '28000';
  end if;

  if p_data_inicio is null or p_data_fim is null or p_data_fim < p_data_inicio then
    raise exception 'Período inválido' using errcode = '22023';
  end if;

  select count(*) into v_qtd
  from public.boletos b
  where b.status in ('VENCIDO', 'A_VENCER')
    and b.vencimento between p_data_inicio and p_data_fim
    and not exists (
      select 1 from public.propostas prt
      where prt.id_int = b.id_int
        and public.fn_venda_de_teste(prt.id_cliente::bigint, prt.id_faturado, prt.vendedor, prt.user_id)
    )
    and (p_empresas is null or array_length(p_empresas, 1) is null or b.id_empresa = any(p_empresas))
    and (p_meios is null or array_length(p_meios, 1) is null
         or (case when coalesce(b.deposito_conta, false) then 'DEPOSITO' else 'BOLETO' end)
            = any(select upper(btrim(m)) from unnest(p_meios) m));

  if v_qtd > p_limite then
    raise exception 'LIMITE: % títulos no período; o máximo é %. Reduza o período.', v_qtd, p_limite
      using errcode = '54000';
  end if;

  return (
    with titulos as (
      select
        b.id,
        b.id_int,
        b.id_empresa,
        b.vencimento,
        case when b.status = 'VENCIDO' then 'VENCIDA' else 'A_VENCER' end as situacao,
        case when coalesce(b.deposito_conta, false) then 'DEPOSITO' else 'BOLETO' end as meio,
        coalesce(
          nullif(btrim(b.nome_cliente), ''),
          case when b.id_cliente is not null then 'Cliente ' || b.id_cliente else 'Cliente não informado' end
        ) as cliente,
        coalesce(b.valor_atualizado, b.valor) as valor,
        case
          when b.status = 'VENCIDO' then
            case
              when b.dias_atraso > 0 then b.dias_atraso
              when v_hoje - b.vencimento > 0 then v_hoje - b.vencimento
            end
        end as dias_atraso
      from public.boletos b
      where b.status in ('VENCIDO', 'A_VENCER')
        and b.vencimento between p_data_inicio and p_data_fim
        and not exists (
          select 1 from public.propostas prt
          where prt.id_int = b.id_int
            and public.fn_venda_de_teste(prt.id_cliente::bigint, prt.id_faturado, prt.vendedor, prt.user_id)
        )
        and (p_empresas is null or array_length(p_empresas, 1) is null or b.id_empresa = any(p_empresas))
        and (p_meios is null or array_length(p_meios, 1) is null
             or (case when coalesce(b.deposito_conta, false) then 'DEPOSITO' else 'BOLETO' end)
                = any(select upper(btrim(m)) from unnest(p_meios) m))
    ),
    por_meio as (
      select
        meio,
        count(*) as quantidade,
        coalesce(sum(valor), 0) as total,
        count(*) filter (where situacao = 'VENCIDA') as qtd_vencidas,
        coalesce(sum(valor) filter (where situacao = 'VENCIDA'), 0) as total_vencidas,
        count(*) filter (where situacao = 'A_VENCER') as qtd_a_vencer,
        coalesce(sum(valor) filter (where situacao = 'A_VENCER'), 0) as total_a_vencer
      from titulos group by meio
    ),
    por_empresa as (
      select
        id_empresa,
        count(*) as quantidade,
        coalesce(sum(valor), 0) as total,
        coalesce(sum(valor) filter (where situacao = 'VENCIDA'), 0) as total_vencidas,
        coalesce(sum(valor) filter (where situacao = 'A_VENCER'), 0) as total_a_vencer
      from titulos group by id_empresa
    )
    select jsonb_build_object(
      'ok', true,
      'tipo', 'contas_a_receber',
      'filtros', jsonb_build_object(
        'data_inicio', p_data_inicio, 'data_fim', p_data_fim,
        'empresas', p_empresas, 'meios', p_meios, 'hoje', v_hoje),
      'totais', jsonb_build_object(
        'quantidade', (select count(*) from titulos),
        'total', (select coalesce(sum(valor), 0) from titulos),
        'quantidade_vencidas', (select count(*) from titulos where situacao = 'VENCIDA'),
        'total_vencidas', (select coalesce(sum(valor), 0) from titulos where situacao = 'VENCIDA'),
        'quantidade_a_vencer', (select count(*) from titulos where situacao = 'A_VENCER'),
        'total_a_vencer', (select coalesce(sum(valor), 0) from titulos where situacao = 'A_VENCER')),
      'por_meio', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'meio', meio, 'quantidade', quantidade, 'total', total,
          'qtd_vencidas', qtd_vencidas, 'total_vencidas', total_vencidas,
          'qtd_a_vencer', qtd_a_vencer, 'total_a_vencer', total_a_vencer)
          order by total desc), '[]'::jsonb)
        from por_meio),
      'por_empresa', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id_empresa', id_empresa, 'quantidade', quantidade, 'total', total,
          'total_vencidas', total_vencidas, 'total_a_vencer', total_a_vencer)
          order by id_empresa), '[]'::jsonb)
        from por_empresa),
      'linhas', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', id, 'vencimento', vencimento, 'pedido', id_int, 'cliente', cliente,
          'meio', meio, 'situacao', situacao, 'id_empresa', id_empresa,
          'valor', valor, 'dias_atraso', dias_atraso)
          order by vencimento, id), '[]'::jsonb)
        from titulos)
    )
  );
end;
$function$;
