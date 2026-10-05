-- ============================================================================
-- ROLLBACK de 20261005_nfse_nbs_padrao_121011000 — fn_clonar_rascunho_nfse
-- ============================================================================
-- Corpo INTEIRO da funcao como estava em producao em 05/10/2026, antes da troca do
-- NBS padrao (121012200 -> 121011000). Tirado de pg_get_functiondef, sem edicao.
--
-- md5 do corpo (prosrc) em producao: 4f716b39438854422cbe7ba8b55747fd
-- O corpo vivo usa fim de linha CRLF. O bloco abaixo refaz o CRLF sozinho, de modo
-- que o arquivo funciona com qualquer fim de linha que o git/editor tenha deixado,
-- e SO recria a funcao se o md5 do corpo bater com o de producao.
-- CREATE OR REPLACE preserva o ACL: nenhum GRANT e necessario.
-- NAO e migration: so rodar para desfazer a troca do NBS.
-- ============================================================================

do $rollback$
declare
  v_corpo text := $corpo_rb$
declare
  v_nfse_origem public.notas_servico%rowtype;
  v_nova_id uuid;
  v_nova_ref text;
  v_prefixo text;
  v_seq integer := 1;
  v_result_recalculo jsonb;
begin
  -- 1) Valida referência de origem
  if p_ref_origem is null or trim(p_ref_origem) = '' then
    return jsonb_build_object(
      'ok', false,
      'erro', 'REF_ORIGEM_OBRIGATORIA',
      'mensagem', 'Informe a referência da NFS-e de origem.'
    );
  end if;

  -- 2) Busca NFS-e de origem
  select *
  into v_nfse_origem
  from public.notas_servico
  where ref = p_ref_origem
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'erro', 'NFSE_ORIGEM_NAO_ENCONTRADA',
      'mensagem', 'NFS-e de origem não localizada.',
      'ref_origem', p_ref_origem
    );
  end if;

  -- 3) Gera nova REF: NFS-16477-001 -> NFS-16477-002
  v_prefixo := 'NFS-' || v_nfse_origem.id_int || '-';

  loop
    v_nova_ref := v_prefixo || lpad(v_seq::text, 3, '0');

    exit when not exists (
      select 1
      from public.notas_servico
      where ref = v_nova_ref
    );

    v_seq := v_seq + 1;
  end loop;

  -- 4) Cria novo rascunho, copiando dados operacionais e limpando autorização/retorno
  insert into public.notas_servico (
    id_int,
    ref,
    id_empresa,
    id_cliente,

    ambiente,
    municipio_prestacao,
    uf_prestacao,

    id_servico_padrao,
    codigo_servico,
    codigo_tributario_municipio,
    item_lista_servico,
    cnae,

    discriminacao,
    valor_servicos,
    valor_deducoes,
    valor_desconto,
    base_calculo_iss,
    valor_iss,
    valor_liquido,

    valor_pis,
    valor_cofins,
    valor_inss,
    valor_ir,
    valor_csll,

    aliquota_iss,
    iss_retido,

    aliquota_pis,
    aliquota_cofins,
    aliquota_csll,
    aliquota_ir,
    aliquota_inss,

    id_natureza_operacao,
    natureza_operacao,

    codigo_nbs,
    codigo_tributacao_nacional_iss,
    regime_especial_tributacao,
    codigo_opcao_simples_nacional,
    situacao_tributaria_pis_cofins,

    ibs_cbs_situacao_tributaria,
    ibs_cbs_classificacao_tributaria,
    codigo_indicador_operacao,
    indicador_destinatario,

    aliquota_cbs,
    valor_cbs,
    aliquota_ibs_estadual,
    valor_ibs_estadual,
    aliquota_ibs_municipal,
    valor_ibs_municipal,

    forma_pagamento,
    informacoes_complementares,
    informacoes_fisco,

    serie_dps,
    numero_dps,

    criado_por_nome,
    status,
    status_focus,
    status_prefeitura,
    mensagem_prefeitura,

    numero_nfse,
    codigo_verificacao,
    caminho_xml,
    caminho_pdf,
    url_xml,
    url_pdf,

    erro_codigo,
    erro_mensagem,
    payload_envio,
    payload_retorno,

    ultima_tentativa_em,
    tentativas_envio
  )
  values (
    v_nfse_origem.id_int,
    v_nova_ref,
    v_nfse_origem.id_empresa,
    v_nfse_origem.id_cliente,

    coalesce(v_nfse_origem.ambiente, 'homologacao'),
    coalesce(v_nfse_origem.municipio_prestacao, 'Porto Alegre'),
    coalesce(v_nfse_origem.uf_prestacao, 'RS'),

    coalesce(v_nfse_origem.id_servico_padrao, 1),
    coalesce(v_nfse_origem.codigo_servico, '13.05.01'),
    v_nfse_origem.codigo_tributario_municipio,
    coalesce(v_nfse_origem.item_lista_servico, '13.05'),
    v_nfse_origem.cnae,

    v_nfse_origem.discriminacao,
    coalesce(v_nfse_origem.valor_servicos, 0),
    coalesce(v_nfse_origem.valor_deducoes, 0),
    coalesce(v_nfse_origem.valor_desconto, 0),
    coalesce(v_nfse_origem.base_calculo_iss, 0),
    coalesce(v_nfse_origem.valor_iss, 0),
    coalesce(v_nfse_origem.valor_liquido, 0),

    coalesce(v_nfse_origem.valor_pis, 0),
    coalesce(v_nfse_origem.valor_cofins, 0),
    coalesce(v_nfse_origem.valor_inss, 0),
    coalesce(v_nfse_origem.valor_ir, 0),
    coalesce(v_nfse_origem.valor_csll, 0),

    v_nfse_origem.aliquota_iss,
    coalesce(v_nfse_origem.iss_retido, false),

    coalesce(v_nfse_origem.aliquota_pis, 0),
    coalesce(v_nfse_origem.aliquota_cofins, 0),
    coalesce(v_nfse_origem.aliquota_csll, 0),
    coalesce(v_nfse_origem.aliquota_ir, 0),
    coalesce(v_nfse_origem.aliquota_inss, 0),

    v_nfse_origem.id_natureza_operacao,
    v_nfse_origem.natureza_operacao,

    coalesce(v_nfse_origem.codigo_nbs, '121012200'),
    coalesce(v_nfse_origem.codigo_tributacao_nacional_iss, '130501'),
    coalesce(v_nfse_origem.regime_especial_tributacao, '0'),
    coalesce(v_nfse_origem.codigo_opcao_simples_nacional, '1'),
    coalesce(v_nfse_origem.situacao_tributaria_pis_cofins, '00'),

    coalesce(v_nfse_origem.ibs_cbs_situacao_tributaria, '000'),
    coalesce(v_nfse_origem.ibs_cbs_classificacao_tributaria, '000001'),
    coalesce(v_nfse_origem.codigo_indicador_operacao, '050201'),
    coalesce(v_nfse_origem.indicador_destinatario, 0),

    coalesce(v_nfse_origem.aliquota_cbs, 0),
    coalesce(v_nfse_origem.valor_cbs, 0),
    coalesce(v_nfse_origem.aliquota_ibs_estadual, 0),
    coalesce(v_nfse_origem.valor_ibs_estadual, 0),
    coalesce(v_nfse_origem.aliquota_ibs_municipal, 0),
    coalesce(v_nfse_origem.valor_ibs_municipal, 0),

    v_nfse_origem.forma_pagamento,
    v_nfse_origem.informacoes_complementares,
    v_nfse_origem.informacoes_fisco,

    coalesce(v_nfse_origem.serie_dps, '1'),
    null,

    coalesce(p_criado_por_nome, v_nfse_origem.criado_por_nome),
    'PENDENTE',
    null,
    null,
    null,

    null,
    null,
    null,
    null,
    null,
    null,

    null,
    null,
    null,
    null,

    null,
    0
  )
  returning id into v_nova_id;

  -- 5) Recalcula totais, se a função existir
  begin
    select public.fn_nfse_recalcular_totais(v_nova_ref)
    into v_result_recalculo;
  exception
    when undefined_function then
      v_result_recalculo := null;
  end;

  -- 6) Retorno
  return jsonb_build_object(
    'ok', true,
    'mensagem', 'Rascunho criado a partir de cópia da NFS-e.',
    'ref_origem', p_ref_origem,
    'ref', v_nova_ref,
    'id_nota_servico', v_nova_id,
    'id_int', v_nfse_origem.id_int,
    'id_cliente', v_nfse_origem.id_cliente,
    'id_empresa', v_nfse_origem.id_empresa,
    'status', 'PENDENTE',
    'numero_dps', null,
    'serie_dps', coalesce(v_nfse_origem.serie_dps, '1'),
    'recalculo', v_result_recalculo
  );
end;
$corpo_rb$;
  v_vivo  text;
begin
  v_corpo := replace(replace(v_corpo, chr(13) || chr(10), chr(10)), chr(10), chr(13) || chr(10));
  if md5(v_corpo) <> '4f716b39438854422cbe7ba8b55747fd' then
    raise exception 'corpo do arquivo nao confere com o de producao (md5 %). Abortado.', md5(v_corpo);
  end if;

  execute 'CREATE OR REPLACE FUNCTION public.fn_clonar_rascunho_nfse(p_ref_origem text, p_criado_por_nome text DEFAULT NULL::text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'' AS ' || quote_literal(v_corpo);

  select md5(p.prosrc) into v_vivo from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_clonar_rascunho_nfse';
  if v_vivo is distinct from '4f716b39438854422cbe7ba8b55747fd' then
    raise exception 'depois do rollback o corpo vivo nao confere (md5 %)', v_vivo;
  end if;
  raise notice 'ok: fn_clonar_rascunho_nfse de volta ao corpo anterior';
end
$rollback$;
