-- ============================================================================
-- ROLLBACK de 20261006_nfse_endereco_tomador — fn_alertas_nfse
-- ============================================================================
-- Corpo INTEIRO da funcao como estava em producao em 05/10/2026, antes da
-- migration do endereco do tomador. Tirado de pg_get_functiondef, sem edicao.
-- md5 do corpo (prosrc) em producao: 49cf26b476b64f1cf740a242a28edf2d
-- O bloco refaz o CRLF do corpo (o arquivo funciona com qualquer fim de linha) e
-- so recria a funcao se o md5 bater. NAO e migration: so rodar para desfazer.
-- CREATE OR REPLACE preserva o ACL: nenhum GRANT e necessario.
-- Ordem do rollback: ver o rodape da migration.
-- ============================================================================

do $rollback$
declare
  v_corpo text := $corpo_rb$begin

  -- Nota inexistente
  if not exists (
    select 1
    from public.notas_servico ns
    where ns.ref = p_ref
  ) then
    return query
    select
      'ERRO'::text,
      'NFSE_NAO_ENCONTRADA'::text,
      'Rascunho de NFS-e não encontrado.'::text,
      true;
    return;
  end if;

  -- Nota já autorizada
  return query
  select
    'ERRO'::text,
    'NFSE_JA_AUTORIZADA'::text,
    'Esta NFS-e já está autorizada e não deve ser enviada novamente.'::text,
    true
  from public.notas_servico ns
  where ns.ref = p_ref
    and (
      upper(coalesce(ns.status, '')) = 'AUTORIZADA'
      or lower(coalesce(ns.status_focus, '')) = 'autorizado'
      or nullif(trim(coalesce(ns.numero_nfse, '')), '') is not null
      or nullif(trim(coalesce(ns.codigo_verificacao, '')), '') is not null
    );

  -- Empresa emitente não habilitada para NFS-e
  return query
  select
    'ERRO'::text,
    'EMPRESA_NFSE_DESABILITADA'::text,
    'A empresa emitente não está habilitada para emissão de NFS-e.'::text,
    true
  from public.notas_servico ns
  join public.empresas e on e.id = ns.id_empresa
  where ns.ref = p_ref
    and coalesce(e.habilita_nfse, false) is false;

  -- Ambiente NFS-e não definido
  return query
  select
    'ERRO'::text,
    'AMBIENTE_NFSE_NAO_DEFINIDO'::text,
    'O ambiente da NFS-e não está definido na empresa emitente.'::text,
    true
  from public.notas_servico ns
  join public.empresas e on e.id = ns.id_empresa
  where ns.ref = p_ref
    and nullif(trim(coalesce(e.ambiente_nfse, '')), '') is null;

  -- CNPJ da empresa não preenchido
  return query
  select
    'ERRO'::text,
    'CNPJ_EMPRESA_NAO_INFORMADO'::text,
    'O CNPJ da empresa emitente não está informado.'::text,
    true
  from public.notas_servico ns
  join public.empresas e on e.id = ns.id_empresa
  where ns.ref = p_ref
    and nullif(trim(coalesce(e.cnpj, '')), '') is null;

  -- Município da empresa NFS-e não preenchido
  return query
  select
    'ERRO'::text,
    'MUNICIPIO_EMPRESA_NFSE_NAO_INFORMADO'::text,
    'O município da empresa emitente para NFS-e não está informado.'::text,
    true
  from public.notas_servico ns
  join public.empresas e on e.id = ns.id_empresa
  where ns.ref = p_ref
    and nullif(trim(coalesce(e.municipio_nfse, '')), '') is null;

  -- UF da empresa NFS-e não preenchida
  return query
  select
    'ERRO'::text,
    'UF_EMPRESA_NFSE_NAO_INFORMADA'::text,
    'A UF da empresa emitente para NFS-e não está informada.'::text,
    true
  from public.notas_servico ns
  join public.empresas e on e.id = ns.id_empresa
  where ns.ref = p_ref
    and nullif(trim(coalesce(e.uf_nfse, '')), '') is null;

  -- Código IBGE do município da empresa não preenchido
  return query
  select
    'ERRO'::text,
    'CODIGO_MUNICIPIO_NFSE_NAO_INFORMADO'::text,
    'O código IBGE do município da empresa para NFS-e não está informado.'::text,
    true
  from public.notas_servico ns
  join public.empresas e on e.id = ns.id_empresa
  where ns.ref = p_ref
    and nullif(trim(coalesce(e.codigo_municipio_nfse, '')), '') is null;

  -- Inscrição municipal não informada
  -- Na DANFS-e modelo aparece como "-", então por enquanto é alerta.
  return query
  select
    'ALERTA'::text,
    'INSCRICAO_MUNICIPAL_NFSE_NAO_INFORMADA'::text,
    'A inscrição municipal da empresa para NFS-e não está informada. Na DANFS-e modelo consta como "-", então este alerta não bloqueia o envio por enquanto.'::text,
    false
  from public.notas_servico ns
  join public.empresas e on e.id = ns.id_empresa
  where ns.ref = p_ref
    and nullif(trim(coalesce(e.inscricao_municipal_nfse, '')), '') is null;

  -- Cliente não informado
  return query
  select
    'ERRO'::text,
    'CLIENTE_NAO_INFORMADO'::text,
    'O tomador/cliente da NFS-e não está informado.'::text,
    true
  from public.notas_servico ns
  where ns.ref = p_ref
    and ns.id_cliente is null;

  -- Cliente não encontrado
  return query
  select
    'ERRO'::text,
    'CLIENTE_NAO_ENCONTRADO'::text,
    'O cliente vinculado à NFS-e não foi encontrado na tabela de clientes.'::text,
    true
  from public.notas_servico ns
  left join public.clientes c on c.id_cliente = ns.id_cliente
  where ns.ref = p_ref
    and ns.id_cliente is not null
    and c.id_cliente is null;

  -- Documento do tomador ausente
  return query
  select
    'ERRO'::text,
    'DOCUMENTO_TOMADOR_NAO_INFORMADO'::text,
    'O CPF/CNPJ do tomador não está informado no cadastro do cliente.'::text,
    true
  from public.notas_servico ns
  join public.clientes c on c.id_cliente = ns.id_cliente
  where ns.ref = p_ref
    and nullif(trim(coalesce(c.documento, '')), '') is null;

  -- Documento do tomador inválido em tamanho
  return query
  select
    'ERRO'::text,
    'DOCUMENTO_TOMADOR_INVALIDO'::text,
    'O documento do tomador deve ter 11 dígitos para CPF ou 14 dígitos para CNPJ.'::text,
    true
  from public.notas_servico ns
  join public.clientes c on c.id_cliente = ns.id_cliente
  where ns.ref = p_ref
    and nullif(trim(coalesce(c.documento, '')), '') is not null
    and length(regexp_replace(coalesce(c.documento, ''), '\D', '', 'g')) not in (11, 14);

  -- Nome/Razão social do tomador ausente
  return query
  select
    'ERRO'::text,
    'NOME_TOMADOR_NAO_INFORMADO'::text,
    'O nome ou razão social do tomador não está informado no cadastro do cliente.'::text,
    true
  from public.notas_servico ns
  join public.clientes c on c.id_cliente = ns.id_cliente
  where ns.ref = p_ref
    and nullif(trim(coalesce(c.nome, c.fantasia, c.contato, '')), '') is null;

  -- E-mail do tomador ausente
  return query
  select
    'ALERTA'::text,
    'EMAIL_TOMADOR_NAO_INFORMADO'::text,
    'O e-mail do tomador não está informado. A NFS-e pode autorizar, mas o cadastro ficará menos completo.'::text,
    false
  from public.notas_servico ns
  join public.clientes c on c.id_cliente = ns.id_cliente
  where ns.ref = p_ref
    and nullif(trim(coalesce(c.email_financeiro, c.email_contato, c.email, '')), '') is null;

  -- Endereço do tomador ausente
  return query
  select
    'ALERTA'::text,
    'ENDERECO_TOMADOR_NAO_INFORMADO'::text,
    'O endereço do tomador não foi encontrado na tabela de endereços. A NFS-e pode autorizar, mas a DANFS-e pode sair sem endereço do tomador.'::text,
    false
  from public.notas_servico ns
  left join public.enderecos ed on ed.id_cliente = ns.id_cliente
  where ns.ref = p_ref
    and ed.id_cliente is null;

  -- Endereço do tomador incompleto
  return query
  select
    'ALERTA'::text,
    'ENDERECO_TOMADOR_INCOMPLETO'::text,
    'O endereço do tomador está incompleto. Confira logradouro, número, bairro, cidade, UF e CEP.'::text,
    false
  from public.notas_servico ns
  join public.enderecos ed on ed.id_cliente = ns.id_cliente
  where ns.ref = p_ref
    and (
      nullif(trim(coalesce(ed.endereco, '')), '') is null
      or nullif(trim(coalesce(ed.numero, '')), '') is null
      or nullif(trim(coalesce(ed.bairro, '')), '') is null
      or nullif(trim(coalesce(ed.cidade, '')), '') is null
      or nullif(trim(coalesce(ed.uf, '')), '') is null
      or nullif(trim(coalesce(ed.cep, '')), '') is null
    );

-- Código IBGE do município do tomador não identificado
-- Só alerta se não estiver salvo E se a cidade/UF não estiver coberta pelos fallbacks conhecidos.
return query
select
  'ALERTA'::text,
  'CODIGO_MUNICIPIO_TOMADOR_NAO_INFORMADO'::text,
  'O código IBGE do município do tomador não está salvo no endereço. Se a cidade não estiver tratada no fallback da RPC, a DANFS-e pode sair sem município do tomador.'::text,
  false
from public.notas_servico ns
join public.enderecos ed on ed.id_cliente = ns.id_cliente
where ns.ref = p_ref
  and nullif(
    trim(
      coalesce(
        to_jsonb(ed) ->> 'codigo_municipio_ibge',
        to_jsonb(ed) ->> 'codigo_municipio',
        to_jsonb(ed) ->> 'ibge',
        to_jsonb(ed) ->> 'cod_ibge',
        ''
      )
    ),
    ''
  ) is null
  and not (
    upper(coalesce(ed.cidade, '')) = 'PORTO ALEGRE'
    and upper(coalesce(ed.uf, '')) = 'RS'
  )
  and not (
    upper(coalesce(ed.cidade, '')) in ('AVARE', 'AVARÉ')
    and upper(coalesce(ed.uf, '')) = 'SP'
  );

  -- Serviço padrão não informado
  return query
  select
    'ERRO'::text,
    'SERVICO_PADRAO_NAO_INFORMADO'::text,
    'O serviço padrão da NFS-e não está informado.'::text,
    true
  from public.notas_servico ns
  where ns.ref = p_ref
    and ns.id_servico_padrao is null;

  -- Serviço padrão não encontrado
  return query
  select
    'ERRO'::text,
    'SERVICO_PADRAO_NAO_ENCONTRADO'::text,
    'O serviço padrão vinculado à NFS-e não foi encontrado.'::text,
    true
  from public.notas_servico ns
  left join public.nfse_servicos_padrao sp on sp.id = ns.id_servico_padrao
  where ns.ref = p_ref
    and ns.id_servico_padrao is not null
    and sp.id is null;

  -- Serviço padrão inativo
  return query
  select
    'ERRO'::text,
    'SERVICO_PADRAO_INATIVO'::text,
    'O serviço padrão vinculado à NFS-e está inativo.'::text,
    true
  from public.notas_servico ns
  join public.nfse_servicos_padrao sp on sp.id = ns.id_servico_padrao
  where ns.ref = p_ref
    and coalesce(sp.ativo, false) is false;

  -- Código de serviço não informado
  return query
  select
    'ERRO'::text,
    'CODIGO_SERVICO_NAO_INFORMADO'::text,
    'O código de serviço da NFS-e não está informado.'::text,
    true
  from public.notas_servico ns
  left join public.nfse_servicos_padrao sp on sp.id = ns.id_servico_padrao
  where ns.ref = p_ref
    and nullif(trim(coalesce(ns.codigo_servico, sp.codigo_servico, '')), '') is null;

  -- Código de tributação nacional ISS não informado
  return query
  select
    'ERRO'::text,
    'CODIGO_TRIBUTACAO_NACIONAL_ISS_NAO_INFORMADO'::text,
    'O código de tributação nacional do ISS não está informado. Para o serviço atual, o padrão esperado é 130501.'::text,
    true
  from public.notas_servico ns
  where ns.ref = p_ref
    and nullif(trim(coalesce(ns.codigo_tributacao_nacional_iss, replace(coalesce(ns.codigo_servico, ''), '.', ''), '')), '') is null;

  -- NBS não informado
  return query
  select
    'ERRO'::text,
    'CODIGO_NBS_NAO_INFORMADO'::text,
    'O código NBS não está informado. Para o serviço atual, o padrão esperado é 121011000.'::text,
    true
  from public.notas_servico ns
  where ns.ref = p_ref
    and nullif(trim(coalesce(ns.codigo_nbs, '')), '') is null;

  -- Município de prestação não informado
  return query
  select
    'ERRO'::text,
    'MUNICIPIO_PRESTACAO_NAO_INFORMADO'::text,
    'O município de prestação do serviço não está informado.'::text,
    true
  from public.notas_servico ns
  left join public.nfse_servicos_padrao sp on sp.id = ns.id_servico_padrao
  where ns.ref = p_ref
    and nullif(trim(coalesce(ns.municipio_prestacao, sp.municipio_prestacao, '')), '') is null;

  -- UF de prestação não informada
  return query
  select
    'ERRO'::text,
    'UF_PRESTACAO_NAO_INFORMADA'::text,
    'A UF de prestação do serviço não está informada.'::text,
    true
  from public.notas_servico ns
  left join public.nfse_servicos_padrao sp on sp.id = ns.id_servico_padrao
  where ns.ref = p_ref
    and nullif(trim(coalesce(ns.uf_prestacao, sp.uf_prestacao, '')), '') is null;

  -- Descrição do serviço vazia
  return query
  select
    'ERRO'::text,
    'DESCRICAO_SERVICO_NAO_INFORMADA'::text,
    'A descrição/discriminação do serviço não está informada.'::text,
    true
  from public.notas_servico ns
  where ns.ref = p_ref
    and nullif(trim(coalesce(ns.discriminacao, '')), '') is null;

  -- Descrição do serviço genérica
  return query
  select
    'ALERTA'::text,
    'DESCRICAO_SERVICO_GENERICA'::text,
    'A descrição do serviço está genérica. Para uma NFS-e real, considere detalhar pedido, revisão, quantidades, valores e referência comercial.'::text,
    false
  from public.notas_servico ns
  where ns.ref = p_ref
    and upper(trim(coalesce(ns.discriminacao, ''))) in (
      'SERVICOS DE IMPRESSAO',
      'SERVIÇOS DE IMPRESSÃO',
      'PRESTACAO DE SERVICO',
      'PRESTAÇÃO DE SERVIÇO'
    );

  -- Valor do serviço inválido
  return query
  select
    'ERRO'::text,
    'VALOR_SERVICO_INVALIDO'::text,
    'O valor dos serviços precisa ser maior que zero.'::text,
    true
  from public.notas_servico ns
  where ns.ref = p_ref
    and coalesce(ns.valor_servicos, 0) <= 0;

  -- Valor líquido ausente
  return query
  select
    'ALERTA'::text,
    'VALOR_LIQUIDO_NAO_CALCULADO'::text,
    'O valor líquido da NFS-e ainda não foi calculado. Salve/recalcule o rascunho antes de emitir.'::text,
    false
  from public.notas_servico ns
  where ns.ref = p_ref
    and ns.valor_liquido is null;

  -- Base de cálculo ausente
  return query
  select
    'ALERTA'::text,
    'BASE_CALCULO_ISS_NAO_CALCULADA'::text,
    'A base de cálculo do ISS ainda não foi calculada. Salve/recalcule o rascunho antes de emitir.'::text,
    false
  from public.notas_servico ns
  where ns.ref = p_ref
    and ns.base_calculo_iss is null;

  -- Natureza da operação não selecionada
  return query
  select
    'ALERTA'::text,
    'NATUREZA_OPERACAO_NAO_INFORMADA'::text,
    'A natureza da operação ainda não foi selecionada. Isso não bloqueia o envio, mas ajuda a orientar a tributação e o agente de IA.'::text,
    false
  from public.notas_servico ns
  where ns.ref = p_ref
    and ns.id_natureza_operacao is null
    and nullif(trim(coalesce(ns.natureza_operacao, '')), '') is null;

  -- Regime especial não informado
  return query
  select
    'ALERTA'::text,
    'REGIME_ESPECIAL_TRIBUTACAO_NAO_INFORMADO'::text,
    'O regime especial de tributação não está informado. Para o cenário atual, o padrão esperado é 0 = Nenhum.'::text,
    false
  from public.notas_servico ns
  where ns.ref = p_ref
    and nullif(trim(coalesce(ns.regime_especial_tributacao, '')), '') is null;

  -- Código opção Simples Nacional não informado
  return query
  select
    'ALERTA'::text,
    'CODIGO_OPCAO_SIMPLES_NACIONAL_NAO_INFORMADO'::text,
    'O código de opção do Simples Nacional não está informado. O fluxo do n8n ainda aplica o padrão usado na homologação.'::text,
    false
  from public.notas_servico ns
  where ns.ref = p_ref
    and nullif(trim(coalesce(ns.codigo_opcao_simples_nacional, '')), '') is null;

  -- Situação tributária PIS/COFINS não informada
  return query
  select
    'ERRO'::text,
    'SITUACAO_TRIBUTARIA_PIS_COFINS_NAO_INFORMADA'::text,
    'A situação tributária de PIS/COFINS não está informada. Para o cenário atual, o padrão esperado é 00.'::text,
    true
  from public.notas_servico ns
  where ns.ref = p_ref
    and nullif(trim(coalesce(ns.situacao_tributaria_pis_cofins, '')), '') is null;

  -- Código indicador da operação não informado
  return query
  select
    'ERRO'::text,
    'CODIGO_INDICADOR_OPERACAO_NAO_INFORMADO'::text,
    'O código indicador da operação não está informado. Para o cenário atual, o padrão esperado é 050201.'::text,
    true
  from public.notas_servico ns
  where ns.ref = p_ref
    and nullif(trim(coalesce(ns.codigo_indicador_operacao, '')), '') is null;

  -- Indicador destinatário não informado
  return query
  select
    'ERRO'::text,
    'INDICADOR_DESTINATARIO_NAO_INFORMADO'::text,
    'O indicador do destinatário não está informado. Para o cenário atual, o padrão esperado é 0.'::text,
    true
  from public.notas_servico ns
  where ns.ref = p_ref
    and ns.indicador_destinatario is null;

  -- Situação tributária IBS/CBS não informada
  return query
  select
    'ERRO'::text,
    'IBS_CBS_SITUACAO_TRIBUTARIA_NAO_INFORMADA'::text,
    'A situação tributária IBS/CBS não está informada. Para o cenário atual, o padrão esperado é 000.'::text,
    true
  from public.notas_servico ns
  where ns.ref = p_ref
    and nullif(trim(coalesce(ns.ibs_cbs_situacao_tributaria, '')), '') is null;

  -- Classificação tributária IBS/CBS não informada
  return query
  select
    'ERRO'::text,
    'IBS_CBS_CLASSIFICACAO_TRIBUTARIA_NAO_INFORMADA'::text,
    'A classificação tributária IBS/CBS não está informada. Para o cenário atual, o padrão esperado é 000001.'::text,
    true
  from public.notas_servico ns
  where ns.ref = p_ref
    and nullif(trim(coalesce(ns.ibs_cbs_classificacao_tributaria, '')), '') is null;

end;$corpo_rb$;
  v_vivo  text;
begin
  v_corpo := replace(replace(v_corpo, chr(13) || chr(10), chr(10)), chr(10), chr(13) || chr(10));
  if md5(v_corpo) <> '49cf26b476b64f1cf740a242a28edf2d' then
    raise exception 'corpo do arquivo nao confere com o de producao (md5 %). Abortado.', md5(v_corpo);
  end if;

  execute 'CREATE OR REPLACE FUNCTION public.fn_alertas_nfse(p_ref text) RETURNS TABLE(tipo text, codigo text, mensagem text, bloqueia_envio boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'' AS ' || quote_literal(v_corpo);

  select md5(p.prosrc) into v_vivo from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_alertas_nfse';
  if v_vivo is distinct from '49cf26b476b64f1cf740a242a28edf2d' then
    raise exception 'depois do rollback o corpo vivo nao confere (md5 %)', v_vivo;
  end if;
  raise notice 'ok: fn_alertas_nfse de volta ao corpo anterior';
end
$rollback$;
