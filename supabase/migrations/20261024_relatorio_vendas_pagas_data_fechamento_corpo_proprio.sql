-- Complemento de 20261024_relatorio_vendas_pagas_data_fechamento.
--
-- Aquela migration deixou rpc_relatorio_vendas_pagas como camada fina sobre a funcao
-- nova. So que as funcoes novas nascem sem EXECUTE para PUBLIC (privilegios padrao do
-- schema: so authenticated e service_role), e a antiga tinha EXECUTE para PUBLIC. Quem
-- chamava a antiga por um papel fora dessas duas (a conexao somente leitura, por
-- exemplo) passaria a tomar "permission denied". Sem mexer em GRANT, a funcao antiga
-- volta a ter corpo proprio, com o mesmo criterio da nova (data de fechamento, pago pelo
-- criterio de cc__valor_pago, cortes da view do Dashboard), mantendo assinatura, colunas
-- e ACL. Gemea de rpc_relatorio_vendas: mudou uma, mude a outra.
--
-- Trava: so aplica se o corpo vivo (a camada fina de 24/10/2026) tiver o md5 lido antes.

do $$
declare
  v_a text := md5(pg_get_functiondef(
    'public.rpc_relatorio_vendas_pagas(date,date,smallint[],text[],text[],boolean)'::regprocedure));
begin
  if v_a <> 'dcadd2e0fab27d96dcb95b5b68e9fc97' then
    raise exception 'rpc_relatorio_vendas_pagas mudou desde a leitura (md5 %); abortado.', v_a;
  end if;
end $$;

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
      public.vendedor_nome_do_atendente(pg.atendente) as atendente_nome
    from public.pagamentos_v2 pg
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
