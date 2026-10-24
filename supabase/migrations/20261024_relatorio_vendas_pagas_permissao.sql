-- rpc_relatorio_vendas_pagas passa a exigir a permissao relatorios.vendas_pagas.
--
-- Antes, qualquer usuario logado com a chave publica chamava a RPC (EXECUTE para
-- PUBLIC, RLS aberta em pagamentos_v2) e lia o relatorio inteiro. Agora:
--   * usuario logado (auth.uid() preenchido): cc__assert_permissao(uid, chave);
--     admin e super admin passam, perfil so com a chave ou com '*';
--   * anon (papel anon, sem usuario): recusado;
--   * sem usuario e papel diferente de anon (service_role das Edge Functions,
--     n8n, conexao direta ao banco): segue como antes. Nenhum GRANT e nenhuma
--     politica de RLS mudou.
-- rpc_relatorio_vendas_pagas_json chama esta funcao e herda a checagem.
--
-- A regra de venda de teste e o resto do corpo ficam identicos ao de 05/10/2026
-- (20261005_relatorio_vendas_pagas_exclui_vendas_de_teste.sql). Mudou so a
-- linguagem (sql -> plpgsql, para poder recusar) e o order by final, qualificado.
--
-- Trava: o corpo vivo precisa ter o md5 lido antes (24/10/2026), senao aborta.

do $$
declare
  v_md5 text := md5(pg_get_functiondef(
    'public.rpc_relatorio_vendas_pagas(date,date,smallint[],text[],text[],boolean)'::regprocedure));
begin
  if v_md5 <> '16b350e190c8fce32f1be0f40672a102' then
    raise exception 'rpc_relatorio_vendas_pagas mudou desde a leitura (md5 %); abortado.', v_md5;
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

  return query
  with pagamentos_filtrados as (
    select
      pg.*,
      -- E-mail de usuario vira o nome comercial; o resto fica como esta gravado.
      public.vendedor_nome_do_atendente(pg.atendente) as atendente_nome
    from public.pagamentos_v2 pg
    where pg.status in ('PAID', 'A_VENCER')
      and pg.confirmado is true
      and pg.paid_at is not null

      -- Vendas de teste ficam fora, pela mesma regra do faturamento, do ranking
      -- e do Meu desempenho (fn_venda_de_teste).
      and not exists (
        select 1
        from public.propostas prt
        where prt.id_int = pg.id_int
          and public.fn_venda_de_teste(prt.id_cliente::bigint, prt.id_faturado, prt.vendedor, prt.user_id)
      )

      -- Periodo: desde 00:00 da data inicial ate antes de 00:00 do dia seguinte
      -- a data final, no fuso America/Sao_Paulo.
      and pg.paid_at >= (p_data_inicio::timestamp at time zone 'America/Sao_Paulo')
      and pg.paid_at < ((p_data_fim + 1)::timestamp at time zone 'America/Sao_Paulo')

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
             -- o filtro por nome tambem acha a cobranca gravada com o e-mail
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
        string_agg(
          distinct pf.atendente_nome,
          ' / '
        ),
        'Não informado'
      ) as vendedor,

      min((pf.paid_at at time zone 'America/Sao_Paulo')::date) as primeira_data_pagamento,
      max((pf.paid_at at time zone 'America/Sao_Paulo')::date) as ultima_data_pagamento,

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
