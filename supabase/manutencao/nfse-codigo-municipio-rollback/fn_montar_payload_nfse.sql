-- ============================================================================
-- ROLLBACK de 20261006_nfse_codigo_municipio_tomador — fn_montar_payload_nfse
-- ============================================================================
-- Corpo INTEIRO da funcao como estava em producao em 06/10/2026, antes da
-- migration do codigo de municipio do tomador (de-para fixo Porto Alegre/Avare).
-- md5 do corpo (prosrc) em producao: e6293fc027bccaf5a37ed36de95c9892
-- O bloco refaz o CRLF do corpo (o arquivo funciona com qualquer fim de linha) e
-- so recria a funcao se o md5 bater. CREATE OR REPLACE preserva o ACL.
-- NAO e migration: so rodar para desfazer. Ordem: ver o rodape da migration.
-- ============================================================================

do $rollback$
declare
  v_corpo text := $corpo_rb$declare
  v_ns jsonb;
  v_emp jsonb;
  v_cli jsonb;
  v_end jsonb;

  v_doc_tomador text;
  v_doc_limpo text;
  v_nome_tomador text;
  v_email_tomador text;
  v_telefone_tomador text;

  v_logradouro_tomador text;
  v_numero_tomador text;
  v_complemento_tomador text;
  v_bairro_tomador text;
  v_municipio_tomador text;
  v_uf_tomador text;
  v_cep_tomador text;
  v_codigo_municipio_tomador text;

  v_codigo_servico text;
  v_codigo_tributacao_nacional_iss text;
  v_data_emissao text;
  v_data_competencia text;

  v_payload jsonb;
begin
  /*
    Busca NFS-e + empresa + cliente + endereço.
    O endereço vem da tabela public.enderecos pelo mesmo id_cliente.
  */
  select
    to_jsonb(ns),
    to_jsonb(e),
    to_jsonb(c),
    to_jsonb(ed)
  into
    v_ns,
    v_emp,
    v_cli,
    v_end
  from public.notas_servico ns
  join public.empresas e
    on e.id = ns.id_empresa
  left join public.clientes c
    on c.id_cliente = ns.id_cliente
  left join lateral (
    select ed.*
    from public.enderecos ed
    where ed.id_cliente = ns.id_cliente
      and (ns.id_endereco_tomador is null or ed.id = ns.id_endereco_tomador)
    order by
      case
        when lower(coalesce(to_jsonb(ed) ->> 'principal', 'false')) in ('true', 't', '1', 'sim')
          then 0
        when lower(coalesce(to_jsonb(ed) ->> 'padrao', 'false')) in ('true', 't', '1', 'sim')
          then 0
        when lower(coalesce(to_jsonb(ed) ->> 'tipo', '')) in ('principal', 'cobranca', 'cobrança', 'fiscal')
          then 0
        else 1
      end,
      coalesce(to_jsonb(ed) ->> 'created_at', '') desc
    limit 1
  ) ed on true
  where ns.ref = p_ref;

  if v_ns is null then
    return jsonb_build_object(
      'ok', false,
      'erro', 'NFSE_NAO_ENCONTRADA',
      'mensagem', 'Rascunho de NFS-e não encontrado.',
      'ref', p_ref
    );
  end if;

  /*
    Datas da emissão/competência.
  */
  v_data_emissao := to_char(
    now() at time zone 'America/Sao_Paulo',
    'YYYY-MM-DD"T"HH24:MI:SS"-03:00"'
  );

  v_data_competencia := to_char(
    now() at time zone 'America/Sao_Paulo',
    'YYYY-MM-DD'
  );

  /*
    Código de tributação nacional.
    Se codigo_tributacao_nacional_iss estiver vazio,
    deriva de codigo_servico:
    13.05.01 -> 130501
  */
  v_codigo_servico :=
    nullif(v_ns ->> 'codigo_servico', '');

  v_codigo_tributacao_nacional_iss :=
    coalesce(
      nullif(v_ns ->> 'codigo_tributacao_nacional_iss', ''),
      nullif(replace(coalesce(v_codigo_servico, ''), '.', ''), '')
    );

  /*
    Dados do tomador.
  */
  v_doc_tomador :=
    coalesce(
      nullif(v_cli ->> 'documento', ''),
      nullif(v_cli ->> 'cpfCnpj', ''),
      nullif(v_cli ->> 'cpf_cnpj', ''),
      nullif(v_cli ->> 'cnpj', ''),
      nullif(v_cli ->> 'cpf', '')
    );

  v_doc_limpo := regexp_replace(coalesce(v_doc_tomador, ''), '\D', '', 'g');

  v_nome_tomador :=
    coalesce(
      nullif(v_cli ->> 'razao_social', ''),
      nullif(v_cli ->> 'nome', ''),
      nullif(v_cli ->> 'fantasia', ''),
      nullif(v_cli ->> 'nome_fantasia', ''),
      nullif(v_cli ->> 'apelido', ''),
      nullif(v_cli ->> 'contato', '')
    );

  v_email_tomador :=
    coalesce(
      nullif(v_cli ->> 'email_nfse', ''),
      nullif(v_cli ->> 'email_financeiro', ''),
      nullif(v_cli ->> 'email_contato', ''),
      nullif(v_cli ->> 'email', '')
    );

  v_telefone_tomador :=
    regexp_replace(
      coalesce(
        nullif(v_cli ->> 'telefone', ''),
        nullif(v_cli ->> 'telefone_fixo', ''),
        nullif(v_cli ->> 'celular', ''),
        nullif(v_cli ->> 'whatsapp', ''),
        nullif(v_cli ->> 'whatsapp_1', ''),
        nullif(v_cli ->> 'whatsapp_2', ''),
        ''
      ),
      '\D',
      '',
      'g'
    );

  /*
    Endereço do tomador.
    Prioridade:
    1. public.enderecos
    2. fallback em public.clientes, se algum dia houver campos ali.
  */
  v_logradouro_tomador :=
    coalesce(
      nullif(v_end ->> 'logradouro', ''),
      nullif(v_end ->> 'endereco', ''),
      nullif(v_end ->> 'rua', ''),
      nullif(v_end ->> 'endereco_principal', ''),
      nullif(v_cli ->> 'logradouro', ''),
      nullif(v_cli ->> 'endereco', ''),
      nullif(v_cli ->> 'rua', ''),
      nullif(v_cli ->> 'endereco_principal', '')
    );

  v_numero_tomador :=
    case
      when coalesce(v_logradouro_tomador, '') <> '' then
        coalesce(
          nullif(v_end ->> 'numero', ''),
          nullif(v_end ->> 'numero_endereco', ''),
          nullif(v_end ->> 'endereco_numero', ''),
          nullif(v_cli ->> 'numero', ''),
          nullif(v_cli ->> 'numero_endereco', ''),
          nullif(v_cli ->> 'endereco_numero', ''),
          'S/N'
        )
      else null
    end;

v_complemento_tomador :=
  nullif(
    nullif(
      coalesce(
        nullif(v_end ->> 'complemento', ''),
        nullif(v_end ->> 'endereco_complemento', ''),
        nullif(v_cli ->> 'complemento', ''),
        nullif(v_cli ->> 'endereco_complemento', '')
      ),
      '-'
    ),
    '.'
  );

  v_bairro_tomador :=
    coalesce(
      nullif(v_end ->> 'bairro', ''),
      nullif(v_end ->> 'endereco_bairro', ''),
      nullif(v_cli ->> 'bairro', ''),
      nullif(v_cli ->> 'endereco_bairro', '')
    );

  v_municipio_tomador :=
    coalesce(
      nullif(v_end ->> 'municipio', ''),
      nullif(v_end ->> 'cidade', ''),
      nullif(v_end ->> 'cidade_nome', ''),
      nullif(v_cli ->> 'municipio', ''),
      nullif(v_cli ->> 'cidade', ''),
      nullif(v_cli ->> 'cidade_nome', '')
    );

  v_uf_tomador :=
    upper(
      coalesce(
        nullif(v_end ->> 'uf', ''),
        nullif(v_end ->> 'estado', ''),
        nullif(v_end ->> 'uf_endereco', ''),
        nullif(v_cli ->> 'uf', ''),
        nullif(v_cli ->> 'estado', ''),
        nullif(v_cli ->> 'uf_endereco', '')
      )
    );

  v_cep_tomador :=
    regexp_replace(
      coalesce(
        nullif(v_end ->> 'cep', ''),
        nullif(v_end ->> 'codigo_postal', ''),
        nullif(v_cli ->> 'cep', ''),
        nullif(v_cli ->> 'codigo_postal', ''),
        ''
      ),
      '\D',
      '',
      'g'
    );

v_codigo_municipio_tomador :=
  coalesce(
    nullif(v_end ->> 'codigo_municipio', ''),
    nullif(v_end ->> 'codigo_municipio_ibge', ''),
    nullif(v_end ->> 'ibge', ''),
    nullif(v_end ->> 'cod_ibge', ''),
    nullif(v_cli ->> 'codigo_municipio', ''),
    nullif(v_cli ->> 'codigo_municipio_ibge', ''),
    nullif(v_cli ->> 'ibge', ''),
    nullif(v_cli ->> 'cod_ibge', ''),
    case
      when upper(coalesce(v_municipio_tomador, '')) = 'PORTO ALEGRE'
       and upper(coalesce(v_uf_tomador, '')) = 'RS'
      then '4314902'

      when upper(coalesce(v_municipio_tomador, '')) in ('AVARE', 'AVARÉ')
       and upper(coalesce(v_uf_tomador, '')) = 'SP'
      then '3504503'

      else null
    end
  );

  /*
    Payload base Focus NFS-e Nacional.
  */
  v_payload := jsonb_build_object(
    'ref', v_ns ->> 'ref',

    -- DPS
    'serie_dps', coalesce(nullif(v_ns ->> 'serie_dps', ''), '1'),
    'numero_dps', nullif(v_ns ->> 'numero_dps', ''),
    'data_emissao', v_data_emissao,
    'data_competencia', v_data_competencia,

    -- Prestador
    'cnpj_prestador',
      regexp_replace(coalesce(v_emp ->> 'cnpj', ''), '\D', '', 'g'),

    'email_prestador',
      coalesce(
        nullif(v_emp ->> 'email_nfse', ''),
        nullif(v_emp ->> 'email', '')
      ),

    'telefone_prestador',
      regexp_replace(
        coalesce(
          nullif(v_emp ->> 'telefone_nfse', ''),
          nullif(v_emp ->> 'telefone', ''),
          ''
        ),
        '\D',
        '',
        'g'
      ),

    'codigo_municipio_emissora',
      coalesce(
        nullif(v_emp ->> 'codigo_municipio_nfse', ''),
        '4314902'
      ),

    -- Tomador
    'razao_social_tomador', v_nome_tomador,
    'email_tomador', v_email_tomador,
    'telefone_tomador', nullif(v_telefone_tomador, ''),

    'cpf_tomador',
      case
        when length(v_doc_limpo) = 11 then v_doc_limpo
        else null
      end,

    'cnpj_tomador',
      case
        when length(v_doc_limpo) = 14 then v_doc_limpo
        else null
      end,

    -- Endereço do tomador
    'logradouro_tomador', v_logradouro_tomador,
    'numero_tomador', v_numero_tomador,
    'complemento_tomador', v_complemento_tomador,
    'bairro_tomador', v_bairro_tomador,
    'codigo_municipio_tomador', v_codigo_municipio_tomador,
    'uf_tomador', v_uf_tomador,
    'cep_tomador', nullif(v_cep_tomador, ''),

    -- Serviço
    'codigo_municipio_prestacao',
      coalesce(
        nullif(v_ns ->> 'codigo_municipio_prestacao', ''),
        '4314902'
      ),

    'codigo_tributacao_nacional_iss',
      coalesce(v_codigo_tributacao_nacional_iss, '130501'),

    'codigo_nbs',
      coalesce(
        nullif(v_ns ->> 'codigo_nbs', ''),
        '121011000'
      ),

    'descricao_servico',
      coalesce(
        nullif(v_ns ->> 'discriminacao', ''),
        'SERVICOS DE IMPRESSAO'
      ),

    'valor_servico',
      coalesce(nullif(v_ns ->> 'valor_servicos', '')::numeric, 0),

    -- Tributação municipal
    'tributacao_iss',
      coalesce(
        nullif(v_ns ->> 'tributacao_iss', ''),
        '1'
      ),

    'tipo_retencao_iss',
      case
        when coalesce(nullif(v_ns ->> 'iss_retido', '')::boolean, false) = true
        then '2'
        else '1'
      end,

    'regime_especial_tributacao',
      coalesce(
        nullif(v_ns ->> 'regime_especial_tributacao', ''),
        '0'
      ),

    -- Simples Nacional / Tributação federal
    'codigo_opcao_simples_nacional',
      coalesce(
        nullif(v_ns ->> 'codigo_opcao_simples_nacional', ''),
        '1'
      ),

    'situacao_tributaria_pis_cofins',
      coalesce(
        nullif(v_ns ->> 'situacao_tributaria_pis_cofins', ''),
        '00'
      ),

    -- Totais aproximados
    'percentual_total_tributos_federais', '0.00',
    'percentual_total_tributos_estaduais', '0.00',
    'percentual_total_tributos_municipais', '0.00',

    -- Informações complementares
    'informacoes_complementares',
      coalesce(
        nullif(v_ns ->> 'informacoes_complementares', ''),
        'NBS:121011000'
      ),

    'informacoes_fisco',
      nullif(v_ns ->> 'informacoes_fisco', ''),

    -- IBS/CBS
    'codigo_indicador_operacao',
      coalesce(
        nullif(v_ns ->> 'codigo_indicador_operacao', ''),
        '050201'
      ),

    'indicador_destinatario',
      coalesce(
        nullif(v_ns ->> 'indicador_destinatario', '')::int,
        0
      ),

    'ibs_cbs_situacao_tributaria',
      coalesce(
        nullif(v_ns ->> 'ibs_cbs_situacao_tributaria', ''),
        '000'
      ),

    'ibs_cbs_classificacao_tributaria',
      coalesce(
        nullif(v_ns ->> 'ibs_cbs_classificacao_tributaria', ''),
        '000001'
      )
  );

  /*
    Remove campos null do payload.
  */
  v_payload := jsonb_strip_nulls(v_payload);

  return v_payload;
end;$corpo_rb$;
  v_vivo  text;
begin
  v_corpo := replace(replace(v_corpo, chr(13) || chr(10), chr(10)), chr(10), chr(13) || chr(10));
  if md5(v_corpo) <> 'e6293fc027bccaf5a37ed36de95c9892' then
    raise exception 'corpo do arquivo nao confere com o de producao (md5 %). Abortado.', md5(v_corpo);
  end if;

  execute 'CREATE OR REPLACE FUNCTION public.fn_montar_payload_nfse(p_ref text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'' AS ' || quote_literal(v_corpo);

  select md5(p.prosrc) into v_vivo from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_montar_payload_nfse';
  if v_vivo is distinct from 'e6293fc027bccaf5a37ed36de95c9892' then
    raise exception 'depois do rollback o corpo vivo nao confere (md5 %)', v_vivo;
  end if;
  raise notice 'ok: fn_montar_payload_nfse de volta ao corpo anterior';
end
$rollback$;
