-- Relatorio NOTAS FISCAIS (NF-e) do mes, para a contabilidade fechar os impostos: funcao NOVA,
-- somente leitura, nada existente e alterado, nenhum GRANT ou RLS tocado. NFS-e (notas_servico)
-- fica fora: este relatorio e so mercadoria (modelo 55).
--
-- Como o ERP identifica emitente e serie: notas_fiscais.id_empresa (-> empresas: razao_social,
-- cnpj) e notas_fiscais.serie. So ambiente de PRODUCAO (a serie 1 e as notas de homologacao
-- nao contam).
--
-- Lista (PDF): NF-e AUTORIZADAS, de natureza "Venda de producao do estabelecimento", pela data
-- de emissao (data_autorizacao, dia de Sao Paulo; nas notas conferidas e a mesma data_emissao
-- enviada). Valores de produtos, frete e total vem da PROPRIA nota (valor_produtos, valor_frete,
-- valor_total_nf), nunca de pagamentos. CFOP vem dos itens da nota; destinatario, do que foi
-- enviado ao SEFAZ (payload_envio), com reservas.
-- Fora da lista, mas devolvidas separadas para a nota de criterio: CANCELADAS e de outra natureza.
-- Para o zip: todas as NF-e do mes (autorizadas, canceladas, outras) e os eventos de
-- cancelamento e carta de correcao registrados no mes (os XML de evento so existem no provedor
-- fiscal; aqui vai so o registro, com o caminho dele).
--
-- Confere a chave relatorios.notas_fiscais com cc__assert_permissao quando ha usuario logado
-- (admin e super admin passam); anon e recusado; service_role e conexao direta seguem sem
-- usuario. Periodo maximo de 31 dias; p_limite protege o banco.

create or replace function public.rpc_relatorio_notas_fiscais(
  p_data_inicio date, p_data_fim date,
  p_id_empresa bigint default 1,
  p_serie text default '2',
  p_limite integer default 3000)
returns jsonb
language plpgsql
stable
as $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_emp record;
  v_qtd bigint;
begin
  if v_uid is not null then
    perform public.cc__assert_permissao(v_uid, 'relatorios.notas_fiscais');
  elsif coalesce(auth.role(), '') = 'anon' then
    raise exception 'AUTH: usuário não autenticado' using errcode = '28000';
  end if;

  if p_data_inicio is null or p_data_fim is null or p_data_fim < p_data_inicio then
    raise exception 'Período inválido' using errcode = '22023';
  end if;
  if p_data_fim - p_data_inicio > 30 then
    raise exception 'Período máximo de 31 dias' using errcode = '22023';
  end if;

  select e.id, e.razao_social, e.cnpj, e.nome_fantasia into v_emp
  from public.empresas e where e.id = p_id_empresa;
  if not found then
    raise exception 'Empresa inválida' using errcode = '22023';
  end if;

  select count(*) into v_qtd
  from public.notas_fiscais n
  where n.modelo = '55' and n.ambiente = 'producao'
    and n.id_empresa = p_id_empresa and n.serie = p_serie
    and n.status in ('AUTORIZADA', 'CANCELADA') and n.data_autorizacao is not null
    and n.data_autorizacao >= (p_data_inicio::timestamp at time zone 'America/Sao_Paulo')
    and n.data_autorizacao < ((p_data_fim + 1)::timestamp at time zone 'America/Sao_Paulo');
  if v_qtd > p_limite then
    raise exception 'LIMITE: % notas no período; o máximo é %.', v_qtd, p_limite using errcode = '54000';
  end if;

  return (
    with nf as (
      select
        n.id, n.ref, n.numero_nf, n.status, n.chave_nfe, n.natureza_operacao,
        n.valor_produtos, n.valor_frete, n.valor_total_nf, n.id_cliente, n.dest_nome, n.payload_envio,
        (n.data_autorizacao at time zone 'America/Sao_Paulo')::date as data,
        case when n.numero_nf ~ '^[0-9]+$' then n.numero_nf::bigint end as numero_ordem
      from public.notas_fiscais n
      where n.modelo = '55' and n.ambiente = 'producao'
        and n.id_empresa = p_id_empresa and n.serie = p_serie
        and n.status in ('AUTORIZADA', 'CANCELADA') and n.data_autorizacao is not null
        and n.data_autorizacao >= (p_data_inicio::timestamp at time zone 'America/Sao_Paulo')
        and n.data_autorizacao < ((p_data_fim + 1)::timestamp at time zone 'America/Sao_Paulo')
    ),
    venda as (
      select * from nf
      where status = 'AUTORIZADA'
        and upper(btrim(natureza_operacao)) = upper('Venda de produção do estabelecimento')
    ),
    eventos as (
      select
        e.tipo_evento, e.sequencia_evento, e.caminho_xml, e.ref, n.numero_nf, n.chave_nfe,
        (e.created_at at time zone 'America/Sao_Paulo')::date as dia
      from public.notas_eventos e
      join public.notas_fiscais n on n.ref = e.ref
      where e.tipo_documento = 'NFE'
        and n.modelo = '55' and n.ambiente = 'producao'
        and n.id_empresa = p_id_empresa and n.serie = p_serie
        and ((e.tipo_evento = 'CANCELAMENTO' and e.status_evento = 'cancelado')
          or (e.tipo_evento = 'CARTA_CORRECAO' and e.status_evento = 'autorizado'))
        and e.created_at >= (p_data_inicio::timestamp at time zone 'America/Sao_Paulo')
        and e.created_at < ((p_data_fim + 1)::timestamp at time zone 'America/Sao_Paulo')
    )
    select jsonb_build_object(
      'ok', true,
      'tipo', 'notas_fiscais',
      'emitente', jsonb_build_object(
        'id_empresa', v_emp.id,
        'razao_social', coalesce(
          (select nullif(btrim(max(nf.payload_envio->>'nome_emitente')), '') from nf), v_emp.razao_social),
        'cnpj', coalesce(
          (select nullif(btrim(max(nf.payload_envio->>'cnpj_emitente')), '') from nf), v_emp.cnpj),
        'nome_fantasia', v_emp.nome_fantasia),
      'filtros', jsonb_build_object(
        'data_inicio', p_data_inicio, 'data_fim', p_data_fim,
        'id_empresa', p_id_empresa, 'serie', p_serie),
      'totais', jsonb_build_object(
        'quantidade', (select count(*) from venda),
        'produtos', (select coalesce(sum(valor_produtos), 0) from venda),
        'frete', (select coalesce(sum(valor_frete), 0) from venda),
        'total', (select coalesce(sum(valor_total_nf), 0) from venda),
        'nfe_no_periodo', (select count(*) from nf),
        'cancelamentos', (select count(*) from eventos where tipo_evento = 'CANCELAMENTO'),
        'cartas_correcao', (select count(*) from eventos where tipo_evento = 'CARTA_CORRECAO')),
      'notas', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'numero_nf', v.numero_nf, 'ref', v.ref, 'data', v.data,
          'destinatario', coalesce(
            nullif(btrim(v.payload_envio->>'nome_destinatario'), ''),
            nullif(btrim(v.dest_nome), ''),
            (select nullif(btrim(c.nome), '') from public.clientes c where c.id_cliente = v.id_cliente limit 1),
            ''),
          'cfop', (select string_agg(distinct i.cfop, ' / ' order by i.cfop)
                   from public.notas_fiscais_itens i
                   where i.id_nota_fiscal = v.id and coalesce(i.ativo, true)),
          'produtos', v.valor_produtos, 'frete', v.valor_frete, 'total', v.valor_total_nf)
          order by v.data, v.numero_ordem, v.numero_nf), '[]'::jsonb)
        from venda v),
      'canceladas', (
        select coalesce(jsonb_agg(jsonb_build_object('numero_nf', x.numero_nf)
          order by x.numero_ordem, x.numero_nf), '[]'::jsonb)
        from nf x where x.status = 'CANCELADA'),
      'outras', (
        select coalesce(jsonb_agg(jsonb_build_object('numero_nf', x.numero_nf, 'natureza', x.natureza_operacao)
          order by x.numero_ordem, x.numero_nf), '[]'::jsonb)
        from nf x
        where x.status = 'AUTORIZADA'
          and upper(btrim(x.natureza_operacao)) <> upper('Venda de produção do estabelecimento')),
      'nfe_xml', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'numero_nf', x.numero_nf, 'ref', x.ref, 'chave', x.chave_nfe, 'status', x.status)
          order by x.numero_ordem, x.numero_nf), '[]'::jsonb)
        from nf x),
      'eventos', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'tipo', ev.tipo_evento, 'numero_nf', ev.numero_nf, 'ref', ev.ref, 'chave', ev.chave_nfe,
          'sequencia', ev.sequencia_evento, 'dia', ev.dia, 'caminho_provedor', ev.caminho_xml)
          order by ev.dia, ev.numero_nf, ev.tipo_evento), '[]'::jsonb)
        from eventos ev)
    )
  );
end;
$function$;
