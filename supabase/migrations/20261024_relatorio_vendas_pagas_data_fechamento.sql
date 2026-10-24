-- Relatorio de vendas: a venda entra no periodo pela DATA DE FECHAMENTO do pedido
-- (pagamentos_v2.data_confirmacao, dia de Sao Paulo), e conta tanto o PAID quanto o
-- faturado A_VENCER confirmado. Antes a janela era paid_at, que o faturado A_VENCER
-- quase nunca tem (446 de 449), e o relatorio deixava o faturado de fora.
--
-- Criterio de "pago": o de cc__valor_pago (status PAID, ou A_VENCER com confirmado,
-- sem CANCELADO e sem as linhas de reenvio). Data e demais cortes: os da view
-- view_pagamentos_pagos_v2 que alimenta o Dashboard (data_confirmacao preenchida,
-- fn_conta_no_faturamento, sem vendas de teste), para os totais baterem.
-- Linhas sem data_confirmacao (74 A_VENCER confirmados de abril e maio/2026) ficam
-- fora, como no Dashboard.
--
-- Objetos:
--   * NOVO  rpc_relatorio_vendas(..., p_situacao)         -- linhas, com situacao
--   * NOVO  rpc_relatorio_vendas_json(..., p_situacao)    -- linhas + totais, para a tela
--   * rpc_relatorio_vendas_pagas (6 args, mesmas colunas) passa a chamar o novo; a forma
--     _json de 6 args segue intacta e chama esta. Quem ja as chama recebe o criterio
--     corrigido sem mudar de assinatura. As colunas de data mantem o nome antigo.
-- A checagem de permissao relatorios.vendas_pagas fica no novo (as antigas herdam).
-- Nenhum GRANT nem politica de RLS e tocado.
--
-- Trava: so aplica se o corpo vivo da funcao substituida tiver o md5 lido antes (24/10/2026).

do $$
declare
  v_a text := md5(pg_get_functiondef(
    'public.rpc_relatorio_vendas_pagas(date,date,smallint[],text[],text[],boolean)'::regprocedure));
begin
  if v_a <> '165ba80a8835c1763ecc5801e0a16523' then
    raise exception 'rpc_relatorio_vendas_pagas mudou desde a leitura (md5 %); abortado.', v_a;
  end if;
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
      public.vendedor_nome_do_atendente(pg.atendente) as atendente_nome
    from public.pagamentos_v2 pg
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
          where pg.atendente ilike '%' || vend || '%'
             or public.vendedor_nome_do_atendente(pg.atendente) ilike '%' || vend || '%'
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

create or replace function public.rpc_relatorio_vendas_json(
  p_data_inicio date, p_data_fim date,
  p_empresas smallint[] default null::smallint[],
  p_formas_pagamento text[] default null::text[],
  p_vendedores text[] default null::text[],
  p_incluir_frete boolean default true,
  p_situacao text default null::text)
returns jsonb
language sql
stable
as $function$
with dados as (
  select *
  from public.rpc_relatorio_vendas(
    p_data_inicio, p_data_fim, p_empresas, p_formas_pagamento,
    p_vendedores, p_incluir_frete, p_situacao
  )
),
totais as (
  select
    count(*) as quantidade_vendas,
    coalesce(sum(valor), 0) as total_relatorio,
    coalesce(sum(valor_com_frete), 0) as total_com_frete,
    coalesce(sum(valor_frete), 0) as total_frete,
    coalesce(sum(valor_sem_frete), 0) as total_sem_frete,
    coalesce(sum(valor_pago), 0) as total_pago,
    coalesce(sum(valor_a_vencer), 0) as total_faturado_a_vencer
  from dados
),
lista as (
  select
    jsonb_agg(
      jsonb_build_object(
        'numero_proposta', numero_proposta,
        'os_ideal', os_ideal,
        'cliente', cliente,
        'vendedor', vendedor,
        'primeira_data_fechamento', primeira_data_fechamento,
        'ultima_data_fechamento', ultima_data_fechamento,
        'formas_pagamento', formas_pagamento,
        'situacao', situacao,
        'empresa', empresa,
        'id_empresa', id_empresa,
        'valor', valor,
        'valor_com_frete', valor_com_frete,
        'valor_frete', valor_frete,
        'valor_sem_frete', valor_sem_frete,
        'qtd_pagamentos', qtd_pagamentos
      )
      order by ultima_data_fechamento desc, numero_proposta desc
    ) as vendas
  from dados
)
select jsonb_build_object(
  'ok', true,
  'tipo', 'vendas',
  'titulo', 'Relatório de Vendas',
  'filtros', jsonb_build_object(
    'data_inicio', p_data_inicio,
    'data_fim', p_data_fim,
    'empresas', p_empresas,
    'formas_pagamento', p_formas_pagamento,
    'vendedores', p_vendedores,
    'incluir_frete', p_incluir_frete,
    'situacao', p_situacao
  ),
  'totais', (
    select jsonb_build_object(
      'quantidade_vendas', quantidade_vendas,
      'total_relatorio', total_relatorio,
      'total_com_frete', total_com_frete,
      'total_frete', total_frete,
      'total_sem_frete', total_sem_frete,
      'total_pago', total_pago,
      'total_faturado_a_vencer', total_faturado_a_vencer
    )
    from totais
  ),
  'vendas', (select coalesce(vendas, '[]'::jsonb) from lista)
);
$function$;

-- A funcao antiga (mesma assinatura e colunas) vira uma camada fina sobre a nova. Sua forma
-- _json NAO muda: continua chamando esta e devolvendo o mesmo formato (com o criterio novo).
create or replace function public.rpc_relatorio_vendas_pagas(
  p_data_inicio date, p_data_fim date,
  p_empresas smallint[] default null::smallint[],
  p_formas_pagamento text[] default null::text[],
  p_vendedores text[] default null::text[],
  p_incluir_frete boolean default true)
returns table(numero_proposta integer, os_ideal integer, cliente text, vendedor text, primeira_data_pagamento date, ultima_data_pagamento date, formas_pagamento text, empresa text, id_empresa smallint, valor numeric, valor_com_frete numeric, valor_frete numeric, valor_sem_frete numeric, qtd_pagamentos bigint)
language sql
stable
as $function$
  select r.numero_proposta, r.os_ideal, r.cliente, r.vendedor,
         r.primeira_data_fechamento, r.ultima_data_fechamento,
         r.formas_pagamento, r.empresa, r.id_empresa, r.valor,
         r.valor_com_frete, r.valor_frete, r.valor_sem_frete, r.qtd_pagamentos
  from public.rpc_relatorio_vendas(
    p_data_inicio, p_data_fim, p_empresas, p_formas_pagamento,
    p_vendedores, p_incluir_frete, null
  ) r;
$function$;
