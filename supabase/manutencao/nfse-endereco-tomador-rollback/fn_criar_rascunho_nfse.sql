-- ============================================================================
-- ROLLBACK de 20261006_nfse_endereco_tomador — fn_criar_rascunho_nfse
-- ============================================================================
-- Corpo INTEIRO da funcao como estava em producao em 05/10/2026, antes da
-- migration do endereco do tomador. Tirado de pg_get_functiondef, sem edicao.
-- md5 do corpo (prosrc) em producao: 3f312b21338d04daed2eb601e47c48ab
-- O bloco refaz o CRLF do corpo (o arquivo funciona com qualquer fim de linha) e
-- so recria a funcao se o md5 bater. NAO e migration: so rodar para desfazer.
-- Esta funcao mudou de ASSINATURA: o bloco derruba a de 8 parametros, recria a de 7
-- e devolve o ACL (so postgres e service_role).
-- Ordem do rollback: ver o rodape da migration.
-- ============================================================================

do $rollback$
declare
  v_corpo text := $corpo_rb$
declare
  v_ref text;
  v_prefixo text;
  v_seq integer := 1;
  v_servico public.nfse_servicos_padrao%rowtype;
  v_id uuid;
  v_id_empresa bigint;
  v_id_servico_padrao bigint;
  v_discriminacao text;
begin
  if p_id_int is null then
    return jsonb_build_object(
      'ok', false,
      'erro', 'ID_INT_OBRIGATORIO',
      'mensagem', 'Informe o id_int para criar o rascunho da NFS-e.'
    );
  end if;

  if p_id_cliente is null then
    return jsonb_build_object(
      'ok', false,
      'erro', 'ID_CLIENTE_OBRIGATORIO',
      'mensagem', 'Informe o tomador/cliente da NFS-e.'
    );
  end if;

  v_id_empresa := coalesce(p_id_empresa, 2);
  v_id_servico_padrao := coalesce(p_id_servico_padrao, 1);

  -- Validar empresa habilitada para NFS-e
  if not exists (
    select 1
    from public.empresas e
    where e.id = v_id_empresa
      and coalesce(e.habilita_nfse, false) = true
  ) then
    return jsonb_build_object(
      'ok', false,
      'erro', 'EMPRESA_NFSE_NAO_HABILITADA',
      'mensagem', 'A empresa informada não está habilitada para emissão de NFS-e.'
    );
  end if;

  -- Buscar serviço padrão
  select *
  into v_servico
  from public.nfse_servicos_padrao
  where id = v_id_servico_padrao
    and ativo = true
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'erro', 'SERVICO_PADRAO_NAO_ENCONTRADO',
      'mensagem', 'Serviço padrão não localizado ou inativo.'
    );
  end if;

  v_discriminacao := coalesce(
    nullif(trim(p_discriminacao), ''),
    v_servico.descricao_padrao,
    'SERVICOS DE IMPRESSAO'
  );

  v_prefixo := 'NFS-' || p_id_int || '-';

  loop
    v_ref := v_prefixo || lpad(v_seq::text, 3, '0');

    exit when not exists (
      select 1
      from public.notas_servico
      where ref = v_ref
    );

    v_seq := v_seq + 1;
  end loop;

  insert into public.notas_servico (
    id_int,
    ref,
    id_empresa,
    id_cliente,
    id_servico_padrao,

    ambiente,
    municipio_prestacao,
    uf_prestacao,

    codigo_servico,
    codigo_tributario_municipio,
    item_lista_servico,
    cnae,

    discriminacao,
    valor_servicos,
    valor_deducoes,
    aliquota_iss,
    iss_retido,

    criado_por_nome,
    status
  )
  values (
    p_id_int,
    v_ref,
    v_id_empresa,
    p_id_cliente,
    v_id_servico_padrao,

    'homologacao',
    coalesce(v_servico.municipio_prestacao, 'Porto Alegre'),
    coalesce(v_servico.uf_prestacao, 'RS'),

    v_servico.codigo_servico,
    v_servico.codigo_tributario_municipio,
    v_servico.item_lista_servico,
    v_servico.cnae,

    v_discriminacao,
    coalesce(p_valor_servicos, 0),
    0,
    v_servico.aliquota_iss,
    coalesce(v_servico.iss_retido, false),

    p_criado_por_nome,
    'PENDENTE'
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'mensagem', 'Rascunho de NFS-e criado com sucesso.',
    'id', v_id,
    'ref', v_ref,
    'id_int', p_id_int,
    'id_empresa', v_id_empresa,
    'id_cliente', p_id_cliente,
    'id_servico_padrao', v_id_servico_padrao,
    'status', 'PENDENTE'
  );
end;
$corpo_rb$;
  v_vivo  text;
begin
  v_corpo := replace(replace(v_corpo, chr(13) || chr(10), chr(10)), chr(10), chr(13) || chr(10));
  if md5(v_corpo) <> '3f312b21338d04daed2eb601e47c48ab' then
    raise exception 'corpo do arquivo nao confere com o de producao (md5 %). Abortado.', md5(v_corpo);
  end if;

  drop function if exists public.fn_criar_rascunho_nfse(bigint, bigint, bigint, bigint, numeric, text, text, uuid);

  execute 'CREATE OR REPLACE FUNCTION public.fn_criar_rascunho_nfse(p_id_int bigint, p_id_empresa bigint DEFAULT 2, p_id_cliente bigint DEFAULT NULL::bigint, p_id_servico_padrao bigint DEFAULT 1, p_valor_servicos numeric DEFAULT 0, p_discriminacao text DEFAULT NULL::text, p_criado_por_nome text DEFAULT ''FlutterFlow''::text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'' AS ' || quote_literal(v_corpo);

  revoke all on function public.fn_criar_rascunho_nfse(bigint, bigint, bigint, bigint, numeric, text, text) from public, anon, authenticated;
  grant execute on function public.fn_criar_rascunho_nfse(bigint, bigint, bigint, bigint, numeric, text, text) to service_role;

  select md5(p.prosrc) into v_vivo from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_criar_rascunho_nfse';
  if v_vivo is distinct from '3f312b21338d04daed2eb601e47c48ab' then
    raise exception 'depois do rollback o corpo vivo nao confere (md5 %)', v_vivo;
  end if;
  raise notice 'ok: fn_criar_rascunho_nfse de volta ao corpo anterior';
end
$rollback$;
