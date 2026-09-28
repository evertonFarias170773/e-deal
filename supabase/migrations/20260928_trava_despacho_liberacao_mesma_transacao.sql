-- ============================================================================
-- exp_trava_frete_despacho: a liberacao de ADM vale na propria transacao que a consome
-- 28/09/2026 — decisao do dono (22715).
--
-- O QUE ACONTECIA
--   O despacho grava `expedicoes` por UPSERT (PostgREST `on_conflict=id_int`).
--   Com a linha ja existente, o Postgres dispara a trigger BEFORE INSERT OR
--   UPDATE `trg_exp_trava_frete_despacho` DUAS vezes no mesmo comando:
--     1. passada de INSERT: a trava ve a liberacao ativa, devolve LIBERADO_ADM e
--        a trigger CONSOME a liberacao (consumida_em = now());
--     2. passada de UPDATE: a trava procurava so `consumida_em IS NULL`, ja nao
--        achava a liberacao e, sem recotacao, devolvia PRECISA_RECOTAR ->
--        EXCEPTION -> o comando inteiro volta, inclusive o consumo.
--   Resultado: a liberacao de ADM nunca destravou um despacho (as tres ja dadas,
--   #3, #4 e #5, estao sem consumo), e a 22715 recusava sempre.
--
-- O QUE MUDA
--   So a condicao da liberacao: `consumida_em IS NULL` passa a ser
--   `(consumida_em IS NULL OR consumida_em = now())`. `now()` e fixo na
--   transacao, entao a segunda passada enxerga a liberacao que a primeira acabou
--   de consumir; fora dela (outra transacao, a pre-checagem do app) a liberacao
--   continua valendo uma vez so. O UPDATE de consumo da trigger ja filtra
--   `consumida_em IS NULL` e vira no-op na segunda passada: consome uma vez.
--
--   Corpo = o VIVO em 28/09/2026 (md5 do corpo sem espacos 30d11ab8...), igual
--   ao de 20260924_despacho_trava_frete_recotacao.sql fora os comentarios, que
--   nao foram para o banco. O bloco DO confere esse md5 e aborta se divergir.
--   Assinatura, STABLE, SECURITY DEFINER, search_path e grants nao mudam
--   (CREATE OR REPLACE preserva a ACL).
-- ============================================================================

DO $guard$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(regexp_replace(substring(pg_get_functiondef(p.oid) from '\$function\$(.*)\$function\$'), '\s', '', 'g'))
    INTO v_md5
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'exp_trava_frete_despacho';

  IF v_md5 IS DISTINCT FROM '30d11ab862dcea29b96329648d354724' THEN
    RAISE EXCEPTION 'exp_trava_frete_despacho: corpo vivo (md5 %) difere do conferido em 28/09/2026; reconfira antes de aplicar', v_md5;
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.exp_trava_frete_despacho(p_id_int bigint, p_cep_destino text, p_tipo_frete text, p_modalidade text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_limite_centavos constant integer := 400;
  v_prop        record;
  v_modalidade  text;
  v_ref_cep     text;
  v_ref_servico text;
  v_ref_tipo    text;
  v_cep_dest    text := nullif(regexp_replace(coalesce(p_cep_destino, ''), '\D', '', 'g'), '');
  v_tipo        text := nullif(upper(btrim(coalesce(p_tipo_frete, ''))), '');
  v_cep_mudou   boolean := false;
  v_transp_mudou boolean := false;
  v_frete       numeric;
  v_consulta    record;
  v_opcao       jsonb;
  v_valor       numeric;
  v_dif_cent    integer;
  v_lib         record;
  v_base        jsonb;
BEGIN
  SELECT id_int, modalidade_frete, valor_frete, id_int_pedido_principal
    INTO v_prop
    FROM public.propostas WHERE id_int = p_id_int;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('bloqueia', false, 'situacao', 'SEM_PROPOSTA');
  END IF;

  v_modalidade := upper(coalesce(nullif(btrim(p_modalidade), ''),
    (SELECT modalidade_frete FROM public.expedicoes WHERE id_int = p_id_int),
    v_prop.modalidade_frete, ''));
  IF v_modalidade <> 'CIF' THEN
    RETURN jsonb_build_object('bloqueia', false, 'situacao', 'FORA_DE_CIF');
  END IF;

  SELECT cep, servico INTO v_ref_cep, v_ref_servico
    FROM public.expedicao_recotacoes WHERE id_int = p_id_int
   ORDER BY aplicado_em DESC LIMIT 1;
  IF NOT FOUND THEN
    SELECT cep, servico INTO v_ref_cep, v_ref_servico
      FROM public.cotacao_frete WHERE id_int = p_id_int AND escolhido = true
     LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('bloqueia', false, 'situacao', 'SEM_COTACAO');
    END IF;
  END IF;

  v_ref_cep := nullif(regexp_replace(coalesce(v_ref_cep, ''), '\D', '', 'g'), '');
  v_ref_tipo := public.exp__tipo_frete_do_texto(v_ref_servico);
  IF v_ref_tipo NOT IN ('CORREIOS', 'MOTOBOY', 'TRANSPORTADORA') THEN
    v_ref_tipo := NULL;
  END IF;

  v_cep_mudou := v_ref_cep IS NOT NULL AND v_cep_dest IS NOT NULL AND v_ref_cep <> v_cep_dest;
  v_transp_mudou := v_ref_tipo IS NOT NULL AND v_tipo IS NOT NULL AND v_tipo <> v_ref_tipo;

  v_frete := round(coalesce(v_prop.valor_frete, 0), 2);
  v_base := jsonb_build_object(
    'cep_mudou', v_cep_mudou,
    'transporte_mudou', v_transp_mudou,
    'cep_cotado', v_ref_cep,
    'cep_destino', v_cep_dest,
    'transporte_cotado', v_ref_tipo,
    'frete_proposta', v_frete,
    'limite', c_limite_centavos / 100.0
  );

  IF NOT v_cep_mudou AND NOT v_transp_mudou THEN
    RETURN v_base || jsonb_build_object('bloqueia', false, 'situacao', 'SEM_DIVERGENCIA');
  END IF;

  SELECT id, consultado_em, opcoes INTO v_consulta
    FROM public.expedicao_recotacao_consultas
   WHERE id_int = p_id_int
     AND (v_cep_dest IS NULL OR cep = v_cep_dest)
   ORDER BY consultado_em DESC
   LIMIT 1;

  IF FOUND AND v_tipo IS NOT NULL THEN
    SELECT o INTO v_opcao
      FROM jsonb_array_elements(v_consulta.opcoes) o
     WHERE public.exp__tipo_frete_do_texto(coalesce(nullif(o->>'servico', ''), o->>'transportadora')) = v_tipo
       AND (o->>'valor') ~ '^-?[0-9]+(\.[0-9]+)?$'
     ORDER BY (upper(btrim(coalesce(o->>'servico', ''))) = upper(btrim(coalesce(v_ref_servico, '')))) DESC,
              (o->>'valor')::numeric ASC
     LIMIT 1;
  END IF;

  SELECT id, liberado_em, liberado_por_nome, motivo INTO v_lib
    FROM public.expedicao_despacho_liberacoes
   WHERE id_int = p_id_int AND (consumida_em IS NULL OR consumida_em = now()) AND revogada_em IS NULL;
  IF FOUND THEN
    v_base := v_base || jsonb_build_object('liberacao', jsonb_build_object(
      'id', v_lib.id, 'liberado_em', v_lib.liberado_em,
      'liberado_por_nome', v_lib.liberado_por_nome, 'motivo', v_lib.motivo));
  END IF;

  IF v_opcao IS NULL THEN
    RETURN v_base || jsonb_build_object(
      'bloqueia', v_lib.id IS NULL,
      'situacao', CASE WHEN v_lib.id IS NULL THEN 'PRECISA_RECOTAR' ELSE 'LIBERADO_ADM' END,
      'precisa_recotar', true,
      'mensagem', 'Recote o frete para o CEP de entrega antes de despachar.');
  END IF;

  v_valor := round((v_opcao->>'valor')::numeric, 2);
  v_dif_cent := round((v_valor - v_frete) * 100)::integer;
  v_base := v_base || jsonb_build_object(
    'id_consulta', v_consulta.id,
    'consultado_em', v_consulta.consultado_em,
    'opcao', v_opcao,
    'valor_recotado', v_valor,
    'diferenca', v_dif_cent / 100.0);

  IF v_dif_cent <= c_limite_centavos THEN
    RETURN v_base || jsonb_build_object('bloqueia', false, 'situacao', 'DENTRO_DO_LIMITE');
  END IF;

  RETURN v_base || jsonb_build_object(
    'bloqueia', v_lib.id IS NULL,
    'situacao', CASE WHEN v_lib.id IS NULL THEN 'ACIMA_DO_LIMITE' ELSE 'LIBERADO_ADM' END,
    'mensagem', format('A recotação (R$ %s) passa R$ %s do frete da proposta (R$ %s): acima de R$ 4,00 só com liberação de ADM.',
      replace(to_char(v_valor, 'FM999999990.00'), '.', ','),
      replace(to_char(v_dif_cent / 100.0, 'FM999999990.00'), '.', ','),
      replace(to_char(v_frete, 'FM999999990.00'), '.', ',')));
END;
$function$;
