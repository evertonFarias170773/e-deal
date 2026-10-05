-- ============================================================================
-- ROLLBACK de 20261005_nfse_nbs_padrao_121011000 — tg_nfse_normalizar_recalcular_biu
-- ============================================================================
-- Corpo INTEIRO da funcao como estava em producao em 05/10/2026, antes da troca do
-- NBS padrao (121012200 -> 121011000). Tirado de pg_get_functiondef, sem edicao.
--
-- md5 do corpo (prosrc) em producao: 2677d2172c5a7524f61ed063b00dc89b
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
  v_codigo_servico_digitos text;
  v_ibs_situacao_digitos text;
  v_ibs_classificacao_digitos text;
  v_nbs_digitos text;
begin
  /*
    NBS
    Corrige o erro específico que aconteceu: 21012200 -> 121012200.
    Se vier vazio, aplica o padrão atual.
  */
  v_nbs_digitos := regexp_replace(coalesce(new.codigo_nbs, ''), '\D', '', 'g');

  if v_nbs_digitos = '21012200' then
    new.codigo_nbs := '121012200';
  elsif nullif(v_nbs_digitos, '') is null then
    new.codigo_nbs := '121012200';
  else
    new.codigo_nbs := v_nbs_digitos;
  end if;

  /*
    Informações complementares
  */
  if nullif(trim(coalesce(new.informacoes_complementares, '')), '') is null then
    new.informacoes_complementares := 'NBS:' || coalesce(new.codigo_nbs, '121012200');
  end if;

  /*
    Código de serviço
    Mantém codigo_servico visual como 13.05.01 quando vier 130501.
  */
  v_codigo_servico_digitos :=
    regexp_replace(coalesce(new.codigo_servico, new.codigo_tributacao_nacional_iss, ''), '\D', '', 'g');

  if length(v_codigo_servico_digitos) = 6 then
    new.codigo_servico :=
      substring(v_codigo_servico_digitos from 1 for 2)
      || '.'
      || substring(v_codigo_servico_digitos from 3 for 2)
      || '.'
      || substring(v_codigo_servico_digitos from 5 for 2);

    new.codigo_tributacao_nacional_iss := v_codigo_servico_digitos;
  elsif nullif(trim(coalesce(new.codigo_tributacao_nacional_iss, '')), '') is null
    and nullif(trim(coalesce(new.codigo_servico, '')), '') is not null then
    new.codigo_tributacao_nacional_iss :=
      regexp_replace(new.codigo_servico, '\D', '', 'g');
  end if;

  /*
    IBS/CBS
    Se vier "000 - Tributação integral", salva apenas "000".
  */
  v_ibs_situacao_digitos :=
    regexp_replace(coalesce(new.ibs_cbs_situacao_tributaria, ''), '\D', '', 'g');

  if nullif(v_ibs_situacao_digitos, '') is null then
    new.ibs_cbs_situacao_tributaria := '000';
  else
    new.ibs_cbs_situacao_tributaria := substring(v_ibs_situacao_digitos from 1 for 3);
  end if;

  v_ibs_classificacao_digitos :=
    regexp_replace(coalesce(new.ibs_cbs_classificacao_tributaria, ''), '\D', '', 'g');

  if nullif(v_ibs_classificacao_digitos, '') is null then
    new.ibs_cbs_classificacao_tributaria := '000001';
  else
    new.ibs_cbs_classificacao_tributaria := substring(v_ibs_classificacao_digitos from 1 for 6);
  end if;

  /*
    Defaults fiscais importantes
  */
  new.codigo_indicador_operacao :=
    coalesce(nullif(trim(new.codigo_indicador_operacao), ''), '050201');

  new.indicador_destinatario :=
    coalesce(new.indicador_destinatario, 0);

  new.regime_especial_tributacao :=
    coalesce(nullif(trim(new.regime_especial_tributacao), ''), '0');

  new.codigo_opcao_simples_nacional :=
    coalesce(nullif(trim(new.codigo_opcao_simples_nacional), ''), '1');

  new.situacao_tributaria_pis_cofins :=
    coalesce(nullif(trim(new.situacao_tributaria_pis_cofins), ''), '00');

  /*
    Recálculo de totais
  */
  new.base_calculo_iss :=
    coalesce(new.valor_servicos, 0)
    - coalesce(new.valor_deducoes, 0)
    - coalesce(new.valor_desconto, 0);

  if coalesce(new.aliquota_iss, 0) > 0 then
    new.valor_iss :=
      round((coalesce(new.base_calculo_iss, 0) * coalesce(new.aliquota_iss, 0)) / 100, 2);
  else
    new.valor_iss := coalesce(new.valor_iss, 0);
  end if;

  new.valor_liquido :=
    coalesce(new.valor_servicos, 0)
    - coalesce(new.valor_deducoes, 0)
    - coalesce(new.valor_desconto, 0)
    - coalesce(new.valor_pis, 0)
    - coalesce(new.valor_cofins, 0)
    - coalesce(new.valor_csll, 0)
    - coalesce(new.valor_ir, 0)
    - coalesce(new.valor_inss, 0)
    - case
        when coalesce(new.iss_retido, false)
        then coalesce(new.valor_iss, 0)
        else 0
      end;

  return new;
end;
$corpo_rb$;
  v_vivo  text;
begin
  v_corpo := replace(replace(v_corpo, chr(13) || chr(10), chr(10)), chr(10), chr(13) || chr(10));
  if md5(v_corpo) <> '2677d2172c5a7524f61ed063b00dc89b' then
    raise exception 'corpo do arquivo nao confere com o de producao (md5 %). Abortado.', md5(v_corpo);
  end if;

  execute 'CREATE OR REPLACE FUNCTION public.tg_nfse_normalizar_recalcular_biu() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'' AS ' || quote_literal(v_corpo);

  select md5(p.prosrc) into v_vivo from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tg_nfse_normalizar_recalcular_biu';
  if v_vivo is distinct from '2677d2172c5a7524f61ed063b00dc89b' then
    raise exception 'depois do rollback o corpo vivo nao confere (md5 %)', v_vivo;
  end if;
  raise notice 'ok: tg_nfse_normalizar_recalcular_biu de volta ao corpo anterior';
end
$rollback$;
