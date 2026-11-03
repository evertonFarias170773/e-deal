-- Relatorio NOTAS FISCAIS: a lista de producao passa a exigir CFOP 5101/6101 nos itens E a
-- natureza "Venda de producao do estabelecimento" ou "Venda de Producao Propria" (o titulo novo
-- do 5101/6101). Antes era so o texto antigo: trocar o titulo no catalogo tiraria as notas novas
-- da lista. A secao "outras" segue sendo o complemento da lista entre as AUTORIZADAS.
--
-- Muda SO o filtro (CTE nf ganha venda_producao; venda e outras usam a coluna). Assinatura,
-- retorno, volatilidade, permissao e GRANTs ficam como estao (CREATE OR REPLACE preserva os
-- privilegios). Nenhum dado gravado muda. Unico chamador: o relatorio
-- (src/features/relatorios/definicoes/notas-fiscais.ts).
--
-- Conferido em 03/11/2026, antes de aplicar:
--   corpo vivo = arquivo 20261025_relatorio_notas_fiscais.sql (md5 do prosrc eb3906dc...2b95);
--   funcao rodada em todo o historico (12 chamadas: meses x empresa x serie):
--     lista  941 ids md5 b67ae97ee7fb641b0e63ada62fb64c81
--     outras  46 ids md5 b13da4d475eb4ff07b845847398e85d7
--   As 6 notas de teste (48000, 48001, 41003, 41005, 41006, 41007) tem CFOP 5101 e natureza
--   "VENDA DENTRO DO ESTADO - PRODUCAO PROPRIA": seguem em "outras", sem filtro por numero.
--
-- GUARDA: so aplica se o corpo vivo for o de 20261025 (o CREATE OR REPLACE sem guarda regride
-- producao quando os dois divergem).
--
-- ROLLBACK (no rodape).

do $guarda$
declare v_md5 text;
begin
  select md5(p.prosrc) into v_md5
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'rpc_relatorio_notas_fiscais'
    and pg_get_function_identity_arguments(p.oid) = 'p_data_inicio date, p_data_fim date, p_id_empresa bigint, p_serie text, p_limite integer';
  if v_md5 is distinct from 'eb3906dcba11c5c873fc12daf38a2b95' then
    raise exception 'ABORTADO: o corpo vivo de rpc_relatorio_notas_fiscais (md5 %) nao e o de 20261025.', v_md5;
  end if;
end
$guarda$;

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
        -- Venda de producao (03/11/2026): itens so com CFOP 5101/6101 E natureza com o titulo
        -- antigo ou o novo do 5101/6101. O CFOP sozinho traria as 6 notas de teste.
        coalesce(
          upper(btrim(n.natureza_operacao)) in (upper('Venda de produção do estabelecimento'), upper('Venda de Produção Própria'))
          and exists (select 1 from public.notas_fiscais_itens i
                      where i.id_nota_fiscal = n.id and coalesce(i.ativo, true))
          and not exists (select 1 from public.notas_fiscais_itens i
                          where i.id_nota_fiscal = n.id and coalesce(i.ativo, true)
                            and coalesce(btrim(i.cfop), '') not in ('5101', '6101')),
          false) as venda_producao,
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
      where status = 'AUTORIZADA' and venda_producao
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
        where x.status = 'AUTORIZADA' and not x.venda_producao),
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

-- ROLLBACK
--   Rodar de novo o CREATE OR REPLACE de supabase/migrations/20261025_relatorio_notas_fiscais.sql
--   (corpo md5 eb3906dcba11c5c873fc12daf38a2b95). Nada mais muda: sem dado, sem GRANT, sem RLS.
