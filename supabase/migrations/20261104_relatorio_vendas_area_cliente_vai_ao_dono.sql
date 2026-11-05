-- Relatorio de vendas: o pagamento lancado pela area do cliente e do vendedor dono da proposta.
--
-- PEDIDO DO DONO (04/11/2026): no Pagamento de comissao aparecia um vendedor "Area do cliente"
-- (outubro/2026: 392 pedidos, R$ 176.666,46). A area do cliente grava o pagamento com
-- atendente = 'Area do cliente'; a venda e do vendedor dono da proposta (propostas.vendedor).
--
-- REGRA (so leitura; nenhum pagamento nem proposta e alterado)
--   * Pagamento com atendente 'Area do cliente' -> vendedor = propostas.vendedor (e-mail vira
--     o nome comercial pela mesma vendedor_nome_do_atendente). Sem dono, segue "Area do cliente"
--     (em 04/11/2026 nao ha nenhum caso: 392 de 392 com vendedor).
--   * Pagamento lancado por vendedor: igual a hoje, inclusive no pedido com mais de um vendedor
--     (cada um entra com os pagamentos que lancou).
--   * Filtro Vendedor: procura no vendedor atribuido acima; o texto gravado em atendente so vale
--     para pagamento lancado por vendedor (antes "Area do cliente" filtrava a si mesmo).
--   * Linhas, totais e criterio de venda: sem mudanca. O total do periodo nao muda.
--
-- OBJETOS: rpc_relatorio_vendas (base de rpc_relatorio_vendas_json, do relatorio Vendas e do
-- Pagamento de comissao) e a gemea rpc_relatorio_vendas_pagas (corpo proprio, 24/10/2026).
-- Assinaturas, colunas, ACL e a checagem de permissao ficam iguais. CREATE OR REPLACE preserva
-- dono e GRANT.
--
-- FICAM COMO ESTAO (mesmo filtro por quem lancou, fora do pedido): rpc_relatorio_curva_abc_clientes
-- e rpc_relatorio_vendas_por_cidade (20261024_relatorios_lote1b_curva_abc_cidades).
--
-- PROVA (04/11/2026, simulada pelas linhas da propria funcao, outubro/2026 com frete):
--   total do periodo R$ 1.249.717,02 antes e depois; "Area do cliente" some;
--   Alexandre Almeida 207 pedidos / R$ 132.401,71 -> 341 / R$ 191.555,95
--   (Meu desempenho: 342 / R$ 191.701,95; a diferenca e o pagamento de R$ 146,00 do 24076
--   lancado pela Edina, que pela regra de hoje fica com ela).
--
-- TRAVA: so aplica se o corpo vivo das duas tiver os trechos substituidos.
-- APLICADA em 04/11/2026 (autorizacao nominal do dono). Corpo vivo conferido antes: igual aos
-- arquivos de 24/10 sem os comentarios. Depois: outubro/2026 bateu com a simulacao, 8 de 8.

do $$
declare
  v_a text := pg_get_functiondef('public.rpc_relatorio_vendas(date,date,smallint[],text[],text[],boolean,text)'::regprocedure);
  v_b text := pg_get_functiondef('public.rpc_relatorio_vendas_pagas(date,date,smallint[],text[],text[],boolean)'::regprocedure);
  v_t text;
begin
  foreach v_t in array array[v_a, v_b] loop
    if position('public.vendedor_nome_do_atendente(pg.atendente) as atendente_nome' in v_t) = 0
       or position('where pg.atendente ilike ''%'' || vend || ''%''' in v_t) = 0
       or position('pg.data_confirmacao >= (p_data_inicio::timestamp' in v_t) = 0
       or position('dono.atendente_nome' in v_t) > 0 then
      raise exception 'Corpo vivo de rpc_relatorio_vendas(_pagas) diferente do esperado; abortado.';
    end if;
  end loop;
end $$;

create or replace function public.rpc_relatorio_vendas(
  p_data_inicio date, p_data_fim date,
  p_empresas smallint[] default null::smallint[],
  p_formas_pagamento text[] default null::text[],
  p_vendedores text[] default null::text[],
  p_incluir_frete boolean default true,
  p_situacao text default null::text)
returns table(numero_proposta integer, os_ideal integer, cliente text, vendedor text, primeira_data_fechamento date, ultima_data_fechamento date, formas_pagamento text, situacao text, empresa text, id_empresa smallint, valor numeric, valor_com_frete numeric, valor_frete numeric, valor_sem_frete numeric, valor_pago numeric, valor_a_vencer numeric, qtd_pagamentos bigint)
language plpgsql
stable
as $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    perform public.cc__assert_permissao(v_uid, 'relatorios.vendas_pagas');
  elsif coalesce(auth.role(), '') = 'anon' then
    raise exception 'AUTH: usuário não autenticado' using errcode = '28000';
  end if;

  if coalesce(p_situacao, '') not in ('', 'PAGO', 'FATURADO_A_VENCER') then
    raise exception 'Situação inválida: %', p_situacao using errcode = '22023';
  end if;

  return query
  with pagamentos_filtrados as (
    select
      pg.*,
      dono.atendente_nome
    from public.pagamentos_v2 pg
    -- Vendedor do pagamento: quem lancou (e-mail vira o nome comercial). O pagamento lancado
    -- pela area do cliente e do vendedor dono da proposta; sem dono, segue "Area do cliente".
    cross join lateral (
      select case
        when trim(coalesce(pg.atendente, '')) = 'Area do cliente' then coalesce(
          (select public.vendedor_nome_do_atendente(pd.vendedor)
             from public.propostas pd
            where pd.id_int = pg.id_int
            limit 1),
          public.vendedor_nome_do_atendente(pg.atendente))
        else public.vendedor_nome_do_atendente(pg.atendente)
      end as atendente_nome
    ) dono
    where pg.status in ('PAID', 'A_VENCER')
      -- "Pago" no criterio de cc__valor_pago: PAID, ou A_VENCER confirmado,
      -- fora as linhas de reenvio (diferenca de frete, nao e pagamento da proposta).
      and (pg.status = 'PAID' or pg.confirmado is true)
      and pg.chave_reenvio is null

      -- Cortes da view do Dashboard (view_pagamentos_pagos_v2).
      and pg.data_confirmacao is not null
      and public.fn_conta_no_faturamento(pg.tipo_cobranca)
      and not exists (
        select 1
        from public.propostas prt
        where prt.id_int = pg.id_int
          and public.fn_venda_de_teste(prt.id_cliente::bigint, prt.id_faturado, prt.vendedor, prt.user_id)
      )

      -- Data de fechamento do pedido: dia de Sao Paulo, extremos inclusos.
      and pg.data_confirmacao >= (p_data_inicio::timestamp at time zone 'America/Sao_Paulo')
      and pg.data_confirmacao < ((p_data_fim + 1)::timestamp at time zone 'America/Sao_Paulo')

      and (
        coalesce(p_situacao, '') = ''
        or (p_situacao = 'PAGO' and pg.status = 'PAID')
        or (p_situacao = 'FATURADO_A_VENCER' and pg.status = 'A_VENCER')
      )

      and (
        p_empresas is null
        or array_length(p_empresas, 1) is null
        or pg.id_empresa = any(p_empresas)
      )

      and (
        p_formas_pagamento is null
        or array_length(p_formas_pagamento, 1) is null
        or exists (
          select 1
          from unnest(p_formas_pagamento) f
          where pg.tipo_cobranca ilike '%' || f || '%'
        )
      )

      and (
        p_vendedores is null
        or array_length(p_vendedores, 1) is null
        or exists (
          select 1
          from unnest(p_vendedores) vend
          where dono.atendente_nome ilike '%' || vend || '%'
             -- O texto gravado so vale para quem lancou; o da area do cliente nao e vendedor.
             or (trim(coalesce(pg.atendente, '')) <> 'Area do cliente'
                 and pg.atendente ilike '%' || vend || '%')
        )
      )
  ),
  base as (
    select
      pf.id_int as numero_proposta,
      max(pf.os_ideal) as os_ideal,
      max(pf.cliente) as cliente,
      coalesce(
        string_agg(distinct pf.atendente_nome, ' / '),
        'Não informado'
      ) as vendedor,
      min((pf.data_confirmacao at time zone 'America/Sao_Paulo')::date) as primeira_data_fechamento,
      max((pf.data_confirmacao at time zone 'America/Sao_Paulo')::date) as ultima_data_fechamento,
      string_agg(distinct pf.tipo_cobranca, ' / ') as formas_pagamento,
      case
        when bool_or(pf.status = 'PAID') and bool_or(pf.status = 'A_VENCER') then 'Pago e faturado a vencer'
        when bool_or(pf.status = 'A_VENCER') then 'Faturado a vencer'
        else 'Pago'
      end as situacao,
      max(pf.id_empresa) as id_empresa,
      max(pf.empresa) as empresa_original,
      sum(pf.valor) as valor_com_frete,
      coalesce(max(pr.valor_frete), 0) as valor_frete,
      sum(pf.valor) - coalesce(max(pr.valor_frete), 0) as valor_sem_frete,
      coalesce(sum(pf.valor) filter (where pf.status = 'PAID'), 0) as valor_pago,
      coalesce(sum(pf.valor) filter (where pf.status = 'A_VENCER'), 0) as valor_a_vencer,
      count(*) as qtd_pagamentos
    from pagamentos_filtrados pf
    left join public.propostas pr
      on pr.id_int = pf.id_int
    group by pf.id_int
  ),
  final as (
    select
      b.numero_proposta,
      b.os_ideal,
      b.cliente,
      b.vendedor,
      b.primeira_data_fechamento,
      b.ultima_data_fechamento,
      b.formas_pagamento,
      b.situacao,
      case
        when b.id_empresa = 1 then 'IDEAL GRÁFICA EXPRESSA EIRELI'
        when b.id_empresa = 2 then 'IDEAL BIRÔ SERV. GRAFICOS'
        when b.id_empresa = 3 then 'E3 BRINDES LTDA'
        else b.empresa_original
      end as empresa,
      b.id_empresa,
      case
        when p_incluir_frete then b.valor_com_frete
        else b.valor_sem_frete
      end as valor,
      b.valor_com_frete,
      b.valor_frete,
      b.valor_sem_frete,
      b.valor_pago,
      b.valor_a_vencer,
      b.qtd_pagamentos
    from base b
  )
  select *
  from final
  order by final.ultima_data_fechamento desc, final.numero_proposta desc;
end;
$function$;

create or replace function public.rpc_relatorio_vendas_pagas(
  p_data_inicio date, p_data_fim date,
  p_empresas smallint[] default null::smallint[],
  p_formas_pagamento text[] default null::text[],
  p_vendedores text[] default null::text[],
  p_incluir_frete boolean default true)
returns table(numero_proposta integer, os_ideal integer, cliente text, vendedor text, primeira_data_pagamento date, ultima_data_pagamento date, formas_pagamento text, empresa text, id_empresa smallint, valor numeric, valor_com_frete numeric, valor_frete numeric, valor_sem_frete numeric, qtd_pagamentos bigint)
language plpgsql
stable
as $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    perform public.cc__assert_permissao(v_uid, 'relatorios.vendas_pagas');
  elsif coalesce(auth.role(), '') = 'anon' then
    raise exception 'AUTH: usuário não autenticado' using errcode = '28000';
  end if;

  -- As colunas de data mantem o nome antigo, mas agora trazem a data de fechamento.
  return query
  with pagamentos_filtrados as (
    select
      pg.*,
      dono.atendente_nome
    from public.pagamentos_v2 pg
    -- Vendedor do pagamento: quem lancou (e-mail vira o nome comercial). O pagamento lancado
    -- pela area do cliente e do vendedor dono da proposta; sem dono, segue "Area do cliente".
    cross join lateral (
      select case
        when trim(coalesce(pg.atendente, '')) = 'Area do cliente' then coalesce(
          (select public.vendedor_nome_do_atendente(pd.vendedor)
             from public.propostas pd
            where pd.id_int = pg.id_int
            limit 1),
          public.vendedor_nome_do_atendente(pg.atendente))
        else public.vendedor_nome_do_atendente(pg.atendente)
      end as atendente_nome
    ) dono
    where pg.status in ('PAID', 'A_VENCER')
      and (pg.status = 'PAID' or pg.confirmado is true)
      and pg.chave_reenvio is null
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
        p_formas_pagamento is null
        or array_length(p_formas_pagamento, 1) is null
        or exists (
          select 1
          from unnest(p_formas_pagamento) f
          where pg.tipo_cobranca ilike '%' || f || '%'
        )
      )
      and (
        p_vendedores is null
        or array_length(p_vendedores, 1) is null
        or exists (
          select 1
          from unnest(p_vendedores) vend
          where dono.atendente_nome ilike '%' || vend || '%'
             -- O texto gravado so vale para quem lancou; o da area do cliente nao e vendedor.
             or (trim(coalesce(pg.atendente, '')) <> 'Area do cliente'
                 and pg.atendente ilike '%' || vend || '%')
        )
      )
  ),
  base as (
    select
      pf.id_int as numero_proposta,
      max(pf.os_ideal) as os_ideal,
      max(pf.cliente) as cliente,
      coalesce(
        string_agg(distinct pf.atendente_nome, ' / '),
        'Não informado'
      ) as vendedor,
      min((pf.data_confirmacao at time zone 'America/Sao_Paulo')::date) as primeira_data_pagamento,
      max((pf.data_confirmacao at time zone 'America/Sao_Paulo')::date) as ultima_data_pagamento,
      string_agg(distinct pf.tipo_cobranca, ' / ') as formas_pagamento,
      max(pf.id_empresa) as id_empresa,
      max(pf.empresa) as empresa_original,
      sum(pf.valor) as valor_com_frete,
      coalesce(max(pr.valor_frete), 0) as valor_frete,
      sum(pf.valor) - coalesce(max(pr.valor_frete), 0) as valor_sem_frete,
      count(*) as qtd_pagamentos
    from pagamentos_filtrados pf
    left join public.propostas pr
      on pr.id_int = pf.id_int
    group by pf.id_int
  ),
  final as (
    select
      b.numero_proposta,
      b.os_ideal,
      b.cliente,
      b.vendedor,
      b.primeira_data_pagamento,
      b.ultima_data_pagamento,
      b.formas_pagamento,
      case
        when b.id_empresa = 1 then 'IDEAL GRÁFICA EXPRESSA EIRELI'
        when b.id_empresa = 2 then 'IDEAL BIRÔ SERV. GRAFICOS'
        when b.id_empresa = 3 then 'E3 BRINDES LTDA'
        else b.empresa_original
      end as empresa,
      b.id_empresa,
      case
        when p_incluir_frete then b.valor_com_frete
        else b.valor_sem_frete
      end as valor,
      b.valor_com_frete,
      b.valor_frete,
      b.valor_sem_frete,
      b.qtd_pagamentos
    from base b
  )
  select *
  from final
  order by final.ultima_data_pagamento desc, final.numero_proposta desc;
end;
$function$;
