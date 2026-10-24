-- Lote 1b dos relatorios: duas funcoes NOVAS (nada existente e alterado, nenhum GRANT ou
-- RLS tocado). As views vw_cadastros_abc_clientes e vw_cadastros_abc_cidades so contam
-- pedidos hoje em APROVADO e nao aceitam periodo; estas contam a venda no periodo pela
-- data de fechamento do pedido (data_confirmacao), igual ao relatorio Vendas e ao Dashboard.
--   * rpc_relatorio_curva_abc_clientes  -- chave relatorios.curva_abc_clientes
--   * rpc_relatorio_vendas_por_cidade   -- chave relatorios.vendas_por_cidade
-- Cada uma confere a propria chave com cc__assert_permissao quando ha usuario logado (admin e
-- super admin passam); anon e recusado; service_role e conexao direta seguem sem usuario.
-- O criterio de venda e copiado de rpc_relatorio_vendas (nao a chama, porque ela exige a chave
-- de Vendas). Mudou uma, mude as tres.

-- Relatorio Curva ABC de clientes: valor vendido por cliente no periodo, com % do total,
-- % acumulado e classe. A venda entra pela data de fechamento do pedido (data_confirmacao),
-- com os mesmos cortes de rpc_relatorio_vendas (gemea: mudou uma, mude a outra).
-- Classe: A enquanto o acumulado ANTES do cliente for menor que 80%, B ate 95%, C o resto
-- (o cliente que cruza a linha dos 80% ainda e A).
create or replace function public.rpc_relatorio_curva_abc_clientes(
  p_data_inicio date, p_data_fim date,
  p_empresas smallint[] default null::smallint[],
  p_vendedores text[] default null::text[],
  p_incluir_frete boolean default false)
returns jsonb
language plpgsql
stable
as $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    perform public.cc__assert_permissao(v_uid, 'relatorios.curva_abc_clientes');
  elsif coalesce(auth.role(), '') = 'anon' then
    raise exception 'AUTH: usuário não autenticado' using errcode = '28000';
  end if;

  return (
    with pagamentos_filtrados as (
      select pg.*
      from public.pagamentos_v2 pg
      where pg.status in ('PAID', 'A_VENCER')
        -- "Pago" no criterio de cc__valor_pago, fora as linhas de reenvio.
        and (pg.status = 'PAID' or pg.confirmado is true)
        and pg.chave_reenvio is null
        -- Cortes da view do Dashboard: data de fechamento preenchida, sem amostra e
        -- retrabalho, sem vendas de teste.
        and pg.data_confirmacao is not null
        and public.fn_conta_no_faturamento(pg.tipo_cobranca)
        and not exists (
          select 1
          from public.propostas prt
          where prt.id_int = pg.id_int
            and public.fn_venda_de_teste(prt.id_cliente::bigint, prt.id_faturado, prt.vendedor, prt.user_id)
        )
        and pg.data_confirmacao >= (p_data_inicio::timestamp at time zone 'America/Sao_Paulo')
        and pg.data_confirmacao < ((p_data_fim + 1)::timestamp at time zone 'America/Sao_Paulo')
        and (
          p_empresas is null
          or array_length(p_empresas, 1) is null
          or pg.id_empresa = any(p_empresas)
        )
        and (
          p_vendedores is null
          or array_length(p_vendedores, 1) is null
          or exists (
            select 1
            from unnest(p_vendedores) vend
            where pg.atendente ilike '%' || vend || '%'
               or public.vendedor_nome_do_atendente(pg.atendente) ilike '%' || vend || '%'
          )
        )
    ),
    por_proposta as (
      -- Uma linha por proposta, com a mesma conta de frete de rpc_relatorio_vendas:
      -- sem frete = soma dos pagamentos do periodo menos o frete da proposta.
      select
        pf.id_int,
        max(pr.id_cliente) as id_cliente,
        max(pr.cliente) as cliente_proposta,
        max(pr.id_endereco_ent) as id_endereco_ent,
        sum(pf.valor) as com_frete,
        sum(pf.valor) - coalesce(max(pr.valor_frete), 0) as sem_frete,
        case
          when p_incluir_frete then sum(pf.valor)
          else sum(pf.valor) - coalesce(max(pr.valor_frete), 0)
        end as valor
      from pagamentos_filtrados pf
      left join public.propostas pr on pr.id_int = pf.id_int
      group by pf.id_int
    ),
  por_cliente as (
    select
      pp.id_cliente,
      coalesce(nullif(btrim(max(c.nome)), ''), max(pp.cliente_proposta), 'Cliente sem nome') as cliente,
      count(*) as pedidos,
      sum(pp.valor) as valor,
      sum(pp.com_frete) as com_frete,
      sum(pp.sem_frete) as sem_frete
    from por_proposta pp
    left join public.clientes c on c.id_cliente = pp.id_cliente
    group by pp.id_cliente
  ),
  ranqueado as (
    select
      pc.*,
      row_number() over (order by pc.valor desc, pc.id_cliente) as posicao,
      sum(pc.valor) over () as total,
      sum(pc.valor) over (order by pc.valor desc, pc.id_cliente rows between unbounded preceding and current row) as acumulado
    from por_cliente pc
  ),
  classificado as (
    select
      r.*,
      case when r.total > 0 then r.valor / r.total * 100 else 0 end as pct,
      case when r.total > 0 then r.acumulado / r.total * 100 else 0 end as pct_acumulado,
      case
        when r.total <= 0 then 'C'
        when (r.acumulado - r.valor) / r.total * 100 < 80 then 'A'
        when (r.acumulado - r.valor) / r.total * 100 < 95 then 'B'
        else 'C'
      end as classe
    from ranqueado r
  )
  select jsonb_build_object(
    'ok', true,
    'tipo', 'curva_abc_clientes',
    'filtros', jsonb_build_object(
      'data_inicio', p_data_inicio, 'data_fim', p_data_fim,
      'empresas', p_empresas, 'vendedores', p_vendedores, 'incluir_frete', p_incluir_frete),
    'totais', jsonb_build_object(
      'clientes', count(*),
      'pedidos', coalesce(sum(pedidos), 0),
      'valor', coalesce(sum(valor), 0),
      'total_com_frete', coalesce(sum(com_frete), 0),
      'total_sem_frete', coalesce(sum(sem_frete), 0),
      'pct', coalesce(round(sum(pct), 4), 0),
      'clientes_a', count(*) filter (where classe = 'A'),
      'clientes_b', count(*) filter (where classe = 'B'),
      'clientes_c', count(*) filter (where classe = 'C'),
      'valor_a', coalesce(sum(valor) filter (where classe = 'A'), 0),
      'valor_b', coalesce(sum(valor) filter (where classe = 'B'), 0),
      'valor_c', coalesce(sum(valor) filter (where classe = 'C'), 0)),
    'linhas', coalesce(jsonb_agg(
      jsonb_build_object(
        'posicao', posicao,
        'id_cliente', id_cliente,
        'cliente', cliente,
        'pedidos', pedidos,
        'valor', valor,
        'pct', round(pct, 4),
        'pct_acumulado', round(pct_acumulado, 4),
        'classe', classe)
      order by posicao), '[]'::jsonb))
  from classificado
  );
end;
$function$;

-- Relatorio Vendas por cidade: valor vendido por cidade no periodo, com a mesma regra de
-- venda, de periodo e de frete de rpc_relatorio_vendas (gemea: mudou uma, mude a outra).
-- Cidade da venda = cidade do CADASTRO do cliente (clientes.cidade_uf, nos formatos
-- "Cidade - UF" e "Cidade/UF"); se o cliente nao tiver, a do endereco de entrega da proposta;
-- se nenhuma, "SEM CIDADE INFORMADA". Nome normalizado como o ERP: maiusculas, sem acento,
-- sem espaco repetido. Nenhuma venda sai do total.
create or replace function public.rpc_relatorio_vendas_por_cidade(
  p_data_inicio date, p_data_fim date,
  p_empresas smallint[] default null::smallint[],
  p_vendedores text[] default null::text[],
  p_incluir_frete boolean default false)
returns jsonb
language plpgsql
stable
as $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    perform public.cc__assert_permissao(v_uid, 'relatorios.vendas_por_cidade');
  elsif coalesce(auth.role(), '') = 'anon' then
    raise exception 'AUTH: usuário não autenticado' using errcode = '28000';
  end if;

  return (
    with pagamentos_filtrados as (
      select pg.*
      from public.pagamentos_v2 pg
      where pg.status in ('PAID', 'A_VENCER')
        -- "Pago" no criterio de cc__valor_pago, fora as linhas de reenvio.
        and (pg.status = 'PAID' or pg.confirmado is true)
        and pg.chave_reenvio is null
        -- Cortes da view do Dashboard: data de fechamento preenchida, sem amostra e
        -- retrabalho, sem vendas de teste.
        and pg.data_confirmacao is not null
        and public.fn_conta_no_faturamento(pg.tipo_cobranca)
        and not exists (
          select 1
          from public.propostas prt
          where prt.id_int = pg.id_int
            and public.fn_venda_de_teste(prt.id_cliente::bigint, prt.id_faturado, prt.vendedor, prt.user_id)
        )
        and pg.data_confirmacao >= (p_data_inicio::timestamp at time zone 'America/Sao_Paulo')
        and pg.data_confirmacao < ((p_data_fim + 1)::timestamp at time zone 'America/Sao_Paulo')
        and (
          p_empresas is null
          or array_length(p_empresas, 1) is null
          or pg.id_empresa = any(p_empresas)
        )
        and (
          p_vendedores is null
          or array_length(p_vendedores, 1) is null
          or exists (
            select 1
            from unnest(p_vendedores) vend
            where pg.atendente ilike '%' || vend || '%'
               or public.vendedor_nome_do_atendente(pg.atendente) ilike '%' || vend || '%'
          )
        )
    ),
    por_proposta as (
      -- Uma linha por proposta, com a mesma conta de frete de rpc_relatorio_vendas:
      -- sem frete = soma dos pagamentos do periodo menos o frete da proposta.
      select
        pf.id_int,
        max(pr.id_cliente) as id_cliente,
        max(pr.cliente) as cliente_proposta,
        max(pr.id_endereco_ent) as id_endereco_ent,
        sum(pf.valor) as com_frete,
        sum(pf.valor) - coalesce(max(pr.valor_frete), 0) as sem_frete,
        case
          when p_incluir_frete then sum(pf.valor)
          else sum(pf.valor) - coalesce(max(pr.valor_frete), 0)
        end as valor
      from pagamentos_filtrados pf
      left join public.propostas pr on pr.id_int = pf.id_int
      group by pf.id_int
    ),
  origem as (
    select
      pp.*,
      nullif(btrim(c.cidade_uf), '') as cidade_uf_cliente,
      nullif(btrim(e.cidade), '') as cidade_entrega,
      nullif(btrim(e.uf), '') as uf_entrega
    from por_proposta pp
    left join public.clientes c on c.id_cliente = pp.id_cliente
    left join public.enderecos e on e.id::text = pp.id_endereco_ent
  ),
  separado as (
    select
      o.*,
      regexp_match(o.cidade_uf_cliente, '^(.*?)\s*[-/]\s*([A-Za-z]{2})\s*$') as partes
    from origem o
  ),
  locais as (
    select
      s.id_int, s.id_cliente, s.valor, s.com_frete, s.sem_frete,
      coalesce(
        nullif(upper(public.unaccent(regexp_replace(btrim(
          case when s.cidade_uf_cliente is not null
               then coalesce(s.partes[1], s.cidade_uf_cliente)
               else s.cidade_entrega end
        ), '\s+', ' ', 'g'))), ''),
        'SEM CIDADE INFORMADA'
      ) as cidade,
      nullif(upper(btrim(
        case when s.cidade_uf_cliente is not null then s.partes[2] else s.uf_entrega end
      )), '') as uf
    from separado s
  ),
  por_cidade as (
    select
      l.cidade, l.uf,
      count(distinct l.id_cliente) as clientes,
      count(*) as pedidos,
      sum(l.valor) as valor,
      sum(l.com_frete) as com_frete,
      sum(l.sem_frete) as sem_frete
    from locais l
    group by l.cidade, l.uf
  ),
  ranqueado as (
    select
      pc.*,
      row_number() over (order by pc.valor desc, pc.cidade, pc.uf) as posicao,
      sum(pc.valor) over () as total
    from por_cidade pc
  )
  select jsonb_build_object(
    'ok', true,
    'tipo', 'vendas_por_cidade',
    'filtros', jsonb_build_object(
      'data_inicio', p_data_inicio, 'data_fim', p_data_fim,
      'empresas', p_empresas, 'vendedores', p_vendedores, 'incluir_frete', p_incluir_frete),
    'totais', jsonb_build_object(
      'cidades', count(*),
      'clientes', (select count(distinct id_cliente) from locais),
      'pedidos', coalesce(sum(pedidos), 0),
      'valor', coalesce(sum(valor), 0),
      'total_com_frete', coalesce(sum(com_frete), 0),
      'total_sem_frete', coalesce(sum(sem_frete), 0),
      'pct', coalesce(round(sum(case when total > 0 then valor / total * 100 else 0 end), 4), 0)),
    'linhas', coalesce(jsonb_agg(
      jsonb_build_object(
        'posicao', posicao,
        'cidade', cidade,
        'uf', uf,
        'clientes', clientes,
        'pedidos', pedidos,
        'valor', valor,
        'pct', round(case when total > 0 then valor / total * 100 else 0 end, 4))
      order by posicao), '[]'::jsonb))
  from ranqueado
  );
end;
$function$;
