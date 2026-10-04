-- Relatorio de vendas pagas: quando pagamentos_v2.atendente e um E-MAIL, mostra
-- o nome comercial do usuario dono do e-mail. As cobrancas NAO sao regravadas.
--
-- Aplicada em 04/10/2026. A funcao nao estava versionada no repositorio; o corpo
-- vivo de rpc_relatorio_vendas_pagas antes (prosrc sem CR) tinha md5
-- 0977ed05f31e02f8f5f70894fa111571, conferido antes de substituir.
--
-- A funcao do relatorio e SECURITY INVOKER e hoje pode ser chamada por anon,
-- que nao le public.usuarios. Para nao quebrar nenhum chamador, a troca do
-- e-mail pelo nome fica numa funcao auxiliar SECURITY DEFINER que so devolve o
-- nome comercial de um e-mail exato, ou o proprio texto quando nao e e-mail de
-- usuario.

create or replace function public.vendedor_nome_do_atendente(p_atendente text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select coalesce(nullif(trim(u.meu_vendedor), ''), nullif(trim(u.nome_usuario), ''))
       from public.usuarios u
      where position('@' in coalesce(p_atendente, '')) > 0
        and lower(u.email) = lower(trim(p_atendente))
      limit 1),
    nullif(trim(p_atendente), ''));
$$;

revoke all on function public.vendedor_nome_do_atendente(text) from public;
grant execute on function public.vendedor_nome_do_atendente(text) to anon, authenticated, service_role, supabase_read_only_user;

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
with pagamentos_filtrados as (
  select
    pg.*,
    -- E-mail de usuario vira o nome comercial; o resto fica como esta gravado.
    public.vendedor_nome_do_atendente(pg.atendente) as atendente_nome
  from public.pagamentos_v2 pg
  where pg.status in ('PAID', 'A_VENCER')
    and pg.confirmado is true
    and pg.paid_at is not null

    -- Regra correta de período:
    -- pega desde 00:00:00 da data inicial
    -- até antes de 00:00:00 do dia seguinte à data final
    -- considerando o fuso America/Sao_Paulo
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
order by ultima_data_pagamento desc, numero_proposta desc;
$function$;
