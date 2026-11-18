-- =============================================================================
-- 20261118_exp_reenvio_fase2b_diferenca
--
-- REENVIO, FASE 2B: A DIFERENCA DE FRETE (18/11/2026, decisoes do Everton).
--
-- Caso de origem: #24552, devolvido pelos Correios (endereco nao encontrado),
-- vai sair de novo por Transportadora e o cliente paga a diferenca. A fase 1
-- recusava ("exige recotar o frete... fase 2").
--
-- REGRA
--   - No reenvio o tipo de envio e o endereco podem mudar mesmo que o frete
--     mude. O frete novo e cotado e CONFERIDO NO BANCO:
--       * cotacao automatica (Azul/VEPPO/Correios...) gravada pelo servidor em
--         expedicao_recotacao_consultas: a tela manda o id da consulta e o id
--         da opcao; a consulta tem de ser a MAIS RECENTE do pedido para o CEP
--         novo e a opcao tem de ser do tipo de envio escolhido;
--       * sem opcao automatica para o tipo, um ADM (expedicao.admin) digita o
--         valor; o proprio ADM e a liberacao e fica gravado no ciclo.
--   - Diferenca = frete novo - frete do envio anterior (o do ultimo ciclo com
--     frete, ou o da proposta). Negativa: recusada como hoje. Positiva: fica
--     gravada no ciclo e vira cobranca PIX marcada (chave_reenvio, uma viva por
--     ciclo) OU abono de ADM. Proposta, cotacao_frete, NF e os tres gatilhos de
--     frete (trg_recalc_after_frete, tg_recalc_frete_v4,
--     trg_frete_sync_financeiro) NAO sao tocados.
--   - Reenvio com troca do tipo de envio exige nota nova (exige_nota). Quem
--     cobra isso e o gatilho do redespacho (migration 20261118b).
--   - Quem paga (CIF/FOB) continua travado.
--
-- SALDO: a cobranca marcada fica fora de cc__valor_pago (2A) e a diferenca
-- nao entra no valor_total; por isso exp_saldo_despacho ganha a parte do
-- reenvio (diferenca - abono - cobranca de reenvio paga, por ciclo). Pedido
-- sem reenvio com diferenca: resultado byte a byte igual ao de antes (o bloco
-- novo so roda quando o pedido nao tem saldo proprio, e so muda o retorno
-- quando ha diferenca pendente).
--
-- O QUE CRIA / MUDA
--   1. expedicao_reenvios: colunas do frete do ciclo, exige_nota e abono.
--   2. exp_reenvio_situacao(id_int): a conta por ciclo (leitura).
--   3. exp_saldo_despacho: + a parte do reenvio.
--   4. exp_reenviar_pedido: nova assinatura (+ p_id_consulta, p_id_opcao,
--      p_frete_digitado, todos DEFAULT NULL; a chamada antiga continua valendo).
--   5. exp_reenvio_cobrar_diferenca(chave): cria o PIX marcado (cobrancas.create).
--   6. exp_reenvio_abonar_diferenca(chave, motivo): abono, so administrador.
--
-- NAO MEXE em propostas (alem do status que a fase 1 ja grava), cotacao_frete,
-- notas, gatilhos de frete, cc__valor_pago, RLS nem GRANT de tabela.
-- =============================================================================

SET LOCAL lock_timeout = '8s';

-- -----------------------------------------------------------------------------
-- TRAVA DE APLICACAO: as funcoes de 22/10/2026 tem de estar iguais.
-- -----------------------------------------------------------------------------
DO $trava$
DECLARE
  v_md5 text;
  v_esperado record;
BEGIN
  FOR v_esperado IN
    SELECT * FROM (VALUES
      ('exp_reenviar_pedido',      'p_id_int bigint, p_ciclo integer, p_id_endereco_entrega uuid, p_tipo_frete text, p_motivo text, p_modalidade text', '48a0319358438866ff12fc8d735c7a30'),
      ('exp_saldo_despacho',       'p_id_int bigint', '8b42e75bf2366c1ed220b49e3198e72f'),
      ('cc__valor_pago',           'p_id_int bigint', '4e92cd145c719e998715b2ec31efbdfa'),
      ('exp_trava_frete_despacho', 'p_id_int bigint, p_cep_destino text, p_tipo_frete text, p_modalidade text', 'e1936809e7ebb7a5e57e70dcfdcc688a')
    ) AS t(nome, args, md5)
  LOOP
    SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_md5
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_esperado.nome
       AND pg_get_function_identity_arguments(p.oid) = v_esperado.args;
    IF v_md5 IS DISTINCT FROM v_esperado.md5 THEN
      RAISE EXCEPTION '% mudou desde 22/10/2026 (md5 %, esperado %). Nada aplicado.',
        v_esperado.nome, v_md5, v_esperado.md5;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.expedicao_reenvios'::regclass
                AND attname = 'diferenca' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'expedicao_reenvios.diferenca ja existe. Nada aplicado.';
  END IF;
END
$trava$;

-- -----------------------------------------------------------------------------
-- 1. O FRETE DO CICLO
-- -----------------------------------------------------------------------------
ALTER TABLE public.expedicao_reenvios
  ADD COLUMN frete_anterior          numeric(12,2),
  ADD COLUMN frete_novo              numeric(12,2),
  ADD COLUMN diferenca               numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN frete_origem            text,
  ADD COLUMN id_consulta_frete       bigint,
  ADD COLUMN opcao_frete             jsonb,
  ADD COLUMN frete_digitado_por      uuid,
  ADD COLUMN frete_digitado_por_nome text,
  ADD COLUMN exige_nota              boolean NOT NULL DEFAULT false,
  ADD COLUMN abono_valor             numeric(12,2),
  ADD COLUMN abonado_por             uuid,
  ADD COLUMN abonado_por_nome        text,
  ADD COLUMN abonado_em              timestamptz,
  ADD COLUMN abono_motivo            text;

ALTER TABLE public.expedicao_reenvios
  ADD CONSTRAINT expedicao_reenvios_diferenca_nao_negativa CHECK (diferenca >= 0),
  ADD CONSTRAINT expedicao_reenvios_frete_origem CHECK (
    frete_origem IS NULL OR frete_origem IN ('SEM_MUDANCA', 'FORA_DE_CIF', 'TRAVA', 'COTACAO', 'DIGITADO_ADM')),
  ADD CONSTRAINT expedicao_reenvios_abono_ate_diferenca CHECK (
    abono_valor IS NULL OR (abono_valor > 0 AND abono_valor <= diferenca)),
  ADD CONSTRAINT expedicao_reenvios_abono_completo CHECK (
    (abono_valor IS NULL) = (abonado_em IS NULL)
    AND (abono_valor IS NULL OR char_length(btrim(coalesce(abono_motivo, ''))) >= 5));

COMMENT ON COLUMN public.expedicao_reenvios.diferenca IS
  'Fase 2B (18/11/2026): frete_novo - frete_anterior quando positiva; 0 quando o frete nao mudou ou em FOB. Negativa nao e gravada (o reenvio e recusado).';
COMMENT ON COLUMN public.expedicao_reenvios.exige_nota IS
  'Fase 2B: o tipo de envio mudou. O redespacho so sai com nota de producao autorizada depois de criado_em (gatilho trg_exp_reenvio_redespacho).';
COMMENT ON COLUMN public.expedicao_reenvios.abono_valor IS
  'Fase 2B: diferenca abonada por administrador (exp_reenvio_abonar_diferenca). Nao mexe em valor_total nem em desconto.';

-- -----------------------------------------------------------------------------
-- 2. A CONTA POR CICLO (leitura)
-- -----------------------------------------------------------------------------
-- Pago do ciclo = mesmo criterio de cc__valor_pago (PAID, ou A_VENCER
-- confirmado), so que nas cobrancas COM a marca do ciclo.
CREATE FUNCTION public.exp_reenvio_situacao(p_id_int bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'ciclo',          r.ciclo,
      'chave',          r.chave,
      'frete_anterior', r.frete_anterior,
      'frete_novo',     r.frete_novo,
      'frete_origem',   r.frete_origem,
      'diferenca',      r.diferenca,
      'abono',          r.abono_valor,
      'abonado_por',    r.abonado_por_nome,
      'pago',           c.pago,
      'cobranca_viva',  c.viva,
      'pendente',       greatest(0, r.diferenca - coalesce(r.abono_valor, 0) - c.pago),
      'exige_nota',     r.exige_nota,
      'criado_em',      r.criado_em
    ) ORDER BY r.ciclo), '[]'::jsonb)
  FROM public.expedicao_reenvios r
  CROSS JOIN LATERAL (
    SELECT
      coalesce(round((sum(p.valor) FILTER (
        WHERE p.status = 'PAID' OR (p.status = 'A_VENCER' AND p.confirmado = true)))::numeric, 2), 0) AS pago,
      (SELECT jsonb_build_object('id', v.id, 'id_pagamento', v.id_pagamento, 'status', v.status, 'valor', v.valor,
                                 'id_empresa', v.id_empresa, 'pix_copia_cola', v.pix_copia_cola IS NOT NULL)
         FROM public.pagamentos_v2 v
        WHERE v.chave_reenvio = r.chave AND v.status IS DISTINCT FROM 'CANCELADO'
        ORDER BY v.created_at DESC LIMIT 1) AS viva
    FROM public.pagamentos_v2 p
    WHERE p.chave_reenvio = r.chave AND p.status IS DISTINCT FROM 'CANCELADO'
  ) c
  WHERE r.id_int = p_id_int;
$$;

REVOKE ALL ON FUNCTION public.exp_reenvio_situacao(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exp_reenvio_situacao(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.exp_reenvio_situacao(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exp_reenvio_situacao(bigint) TO service_role;

COMMENT ON FUNCTION public.exp_reenvio_situacao(bigint) IS
  'Reenvio fase 2B: por ciclo, frete anterior/novo, diferenca, abono, pago (cobranca marcada PAID ou A_VENCER confirmada), cobranca viva e pendente. So leitura.';

-- -----------------------------------------------------------------------------
-- 3. SALDO DO DESPACHO (mesma assinatura e GRANTs; o bloco do reenvio e novo)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exp_saldo_despacho(p_id_int bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_total       numeric;
  v_pago        numeric;
  v_saldo_cent  bigint;
  v_saldo       numeric;
  v_reenvio     record;
BEGIN
  SELECT round(coalesce(valor_total, 0)::numeric, 2) INTO v_total
    FROM public.propostas WHERE id_int = p_id_int;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('bloqueia', false, 'situacao', 'SEM_PROPOSTA');
  END IF;

  v_pago := coalesce(public.cc__valor_pago(p_id_int), 0);
  v_saldo_cent := round(v_total * 100)::bigint - round(v_pago * 100)::bigint;
  v_saldo := round(v_saldo_cent / 100.0, 2);

  IF v_saldo_cent <= 0 THEN
    -- Reenvio fase 2B (18/11/2026): a diferenca de frete do reenvio nao esta no
    -- total nem no pago da proposta; o que falta dela conta aqui. Sem ciclo com
    -- diferenca pendente, o retorno e o mesmo de sempre.
    SELECT round(sum(greatest(0, s.diferenca - coalesce(s.abono, 0) - s.pago)), 2) AS pendente,
           min(s.ciclo) FILTER (WHERE s.diferenca - coalesce(s.abono, 0) - s.pago > 0) AS ciclo
      INTO v_reenvio
      FROM jsonb_to_recordset(public.exp_reenvio_situacao(p_id_int))
           AS s(ciclo integer, diferenca numeric, abono numeric, pago numeric);
    IF coalesce(v_reenvio.pendente, 0) > 0 THEN
      RETURN jsonb_build_object(
        'bloqueia', true,
        'situacao', 'SALDO_REENVIO',
        'total', v_total,
        'pago', v_pago,
        'saldo', v_reenvio.pendente,
        'ciclo', v_reenvio.ciclo,
        'mensagem',
          'Despacho bloqueado: falta receber ' || public.exp__reais(v_reenvio.pendente) ||
          ' da diferença de frete do reenvio ' || v_reenvio.ciclo || '. ' ||
          'Gere o PIX da diferença na aba Pagamentos da proposta (ou peça ao administrador para abonar a diferença) ' ||
          'e despache depois que o pagamento for confirmado.'
      );
    END IF;

    RETURN jsonb_build_object('bloqueia', false, 'situacao', 'SEM_SALDO',
      'total', v_total, 'pago', v_pago, 'saldo', v_saldo);
  END IF;

  RETURN jsonb_build_object(
    'bloqueia', true,
    'situacao', 'SALDO_A_RECEBER',
    'total', v_total,
    'pago', v_pago,
    'saldo', v_saldo,
    'mensagem',
      'Despacho bloqueado: falta receber ' || public.exp__reais(v_saldo) || ' deste pedido. ' ||
      'O total do pedido é ' || public.exp__reais(v_total) || ' e o pago confirmado é ' || public.exp__reais(v_pago) || '. ' ||
      'Gere a cobrança da diferença na aba Pagamentos da proposta (ou peça ao administrador para abonar a diferença) ' ||
      'e despache depois que o pagamento for confirmado.'
  );
END;
$function$;

-- -----------------------------------------------------------------------------
-- 4. A RPC DO REENVIO (assinatura nova: tres parametros opcionais no fim)
-- -----------------------------------------------------------------------------
DROP FUNCTION public.exp_reenviar_pedido(bigint, integer, uuid, text, text, text);

CREATE FUNCTION public.exp_reenviar_pedido(
  p_id_int               bigint,
  p_ciclo                integer,
  p_id_endereco_entrega  uuid,
  p_tipo_frete           text,
  p_motivo               text,
  p_modalidade           text    DEFAULT NULL,
  p_id_consulta          bigint  DEFAULT NULL,
  p_id_opcao             text    DEFAULT NULL,
  p_frete_digitado       numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_chave       text;
  v_motivo      text;
  v_exist       public.expedicao_reenvios%ROWTYPE;
  v_prop        public.propostas%ROWTYPE;
  v_exp         public.expedicoes%ROWTYPE;
  v_end         public.enderecos%ROWTYPE;
  v_status      text;
  v_modalidade  text;
  v_pedida      text;
  v_tipo_novo   text;
  v_tipo_ant    text;
  v_tipo_mudou  boolean;
  v_cep_novo    text;
  v_cep_ant     text;
  v_veredito    jsonb;
  v_situacao    text;
  v_ciclo_prox  integer;
  v_nome        text;
  v_novo_id     bigint;
  v_saldo       jsonb;
  -- fase 2B
  v_frete_ant   numeric;
  v_frete_novo  numeric;
  v_diferenca   numeric := 0;
  v_origem      text;
  v_consulta    public.expedicao_recotacao_consultas%ROWTYPE;
  v_opcao       jsonb;
  v_tem_do_tipo boolean := false;
  v_digit_uid   uuid;
  v_digit_nome  text;
BEGIN
  -- 1. permissao (super/admin passam pelo fallback de sempre de cc__assert_permissao)
  PERFORM public.cc__assert_permissao(v_uid, 'expedicao.reenvio');

  IF p_id_int IS NULL OR p_ciclo IS NULL OR p_ciclo < 1
     OR p_id_endereco_entrega IS NULL OR nullif(btrim(coalesce(p_tipo_frete, '')), '') IS NULL THEN
    RAISE EXCEPTION 'EXP_REENVIO_PARAMS: pedido, ciclo, endereco e tipo de envio sao obrigatorios.' USING ERRCODE = 'P0001';
  END IF;
  IF p_id_consulta IS NOT NULL AND p_frete_digitado IS NOT NULL THEN
    RAISE EXCEPTION 'EXP_REENVIO_PARAMS: informe a opcao cotada OU o frete digitado, nao os dois.' USING ERRCODE = 'P0001';
  END IF;
  IF p_id_consulta IS NOT NULL AND nullif(btrim(coalesce(p_id_opcao, '')), '') IS NULL THEN
    RAISE EXCEPTION 'EXP_REENVIO_PARAMS: escolha uma das opcoes cotadas.' USING ERRCODE = 'P0001';
  END IF;
  v_motivo := btrim(coalesce(p_motivo, ''));
  IF char_length(v_motivo) < 3 THEN
    RAISE EXCEPTION 'EXP_REENVIO_MOTIVO: informe o motivo do reenvio.' USING ERRCODE = 'P0001';
  END IF;
  IF char_length(v_motivo) > 500 THEN
    RAISE EXCEPTION 'EXP_REENVIO_MOTIVO: o motivo passa de 500 caracteres.' USING ERRCODE = 'P0001';
  END IF;

  v_chave := 'REENVIO:' || p_id_int || ':' || p_ciclo;

  -- 2. IDEMPOTENCIA antes de tudo: a mesma chave devolve o registro anterior,
  --    sem gravar nada de novo.
  SELECT * INTO v_exist FROM public.expedicao_reenvios WHERE chave = v_chave;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_exist.id, 'ciclo', v_exist.ciclo, 'chave', v_exist.chave, 'idempotente', true,
      'diferenca', v_exist.diferenca, 'exige_nota', v_exist.exige_nota);
  END IF;

  -- 3. trava do pedido; a chave e conferida de novo depois do lock (duas
  --    chamadas simultaneas: a segunda espera e devolve a primeira).
  SELECT * INTO v_prop FROM public.propostas WHERE id_int = p_id_int FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXP_REENVIO_PEDIDO: pedido #% nao encontrado.', p_id_int USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_exist FROM public.expedicao_reenvios WHERE chave = v_chave;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_exist.id, 'ciclo', v_exist.ciclo, 'chave', v_exist.chave, 'idempotente', true,
      'diferenca', v_exist.diferenca, 'exige_nota', v_exist.exige_nota);
  END IF;

  v_status := upper(btrim(coalesce(v_prop.status_interno, '')));
  IF v_status <> 'EM TRANSITO' THEN
    RAISE EXCEPTION 'EXP_REENVIO_STATUS: o reenvio parte de pedido EM TRANSITO; o #% esta em "%".',
      p_id_int, coalesce(v_prop.status_interno, 'sem status') USING ERRCODE = 'P0001';
  END IF;
  IF v_prop.id_int_pedido_principal IS NOT NULL THEN
    RAISE EXCEPTION 'EXP_REENVIO_COMPLEMENTO: o #% e complemento do #%; o envio e o do pedido principal.',
      p_id_int, v_prop.id_int_pedido_principal USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.propostas c
              WHERE c.id_int_pedido_principal = p_id_int
                AND upper(btrim(coalesce(c.status_interno, ''))) <> 'CANCELADO') THEN
    RAISE EXCEPTION 'EXP_REENVIO_COM_COMPLEMENTO: o #% tem pedido complementar que saiu junto; o reenvio de pedido com complemento ainda nao existe.',
      p_id_int USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_exp FROM public.expedicoes WHERE id_int = p_id_int FOR UPDATE;
  IF NOT FOUND OR v_exp.data_despacho IS NULL THEN
    RAISE EXCEPTION 'EXP_REENVIO_SEM_DESPACHO: o #% nao tem despacho registrado para refazer.', p_id_int USING ERRCODE = 'P0001';
  END IF;
  IF v_exp.data_entrega IS NOT NULL THEN
    RAISE EXCEPTION 'EXP_REENVIO_ENTREGUE: o #% tem data de entrega registrada.', p_id_int USING ERRCODE = 'P0001';
  END IF;

  -- 4. ciclo: um a mais que o ultimo. Tela desatualizada nao cria ciclo pulado.
  SELECT coalesce(max(ciclo), 0) + 1 INTO v_ciclo_prox FROM public.expedicao_reenvios WHERE id_int = p_id_int;
  IF p_ciclo <> v_ciclo_prox THEN
    RAISE EXCEPTION 'EXP_REENVIO_CICLO: a tela esta desatualizada (reenvio % pedido, o proximo do #% e o %). Recarregue a lista.',
      p_ciclo, p_id_int, v_ciclo_prox USING ERRCODE = 'P0001';
  END IF;

  -- 4b. SALDO A DEFINIR (22/10/2026). Desde a 2B o veredito inclui a diferenca
  --     de frete pendente de ciclos anteriores.
  v_saldo := public.exp_saldo_despacho(p_id_int);
  IF coalesce((v_saldo->>'bloqueia')::boolean, false) THEN
    RAISE EXCEPTION 'EXP_REENVIO_SALDO: %',
      coalesce(v_saldo->>'mensagem', 'Despacho bloqueado: o pedido tem saldo a receber.')
      || ' O saldo precisa ser resolvido (cobranca paga ou abono) antes do reenvio; nada foi gravado.'
      USING ERRCODE = 'P0001', DETAIL = v_saldo::text;
  END IF;

  -- 5. quem paga nao muda
  v_modalidade := upper(nullif(btrim(coalesce(v_exp.modalidade_frete, v_prop.modalidade_frete, '')), ''));
  v_pedida := upper(nullif(btrim(coalesce(p_modalidade, '')), ''));
  IF v_pedida IS NOT NULL AND v_pedida IS DISTINCT FROM v_modalidade THEN
    RAISE EXCEPTION 'EXP_REENVIO_QUEM_PAGA: o reenvio nao troca quem paga o frete (gravado %, pedido %).',
      coalesce(v_modalidade, 'nenhum'), v_pedida USING ERRCODE = 'P0001';
  END IF;
  IF v_modalidade IS NULL OR v_modalidade NOT IN ('CIF', 'FOB') THEN
    RAISE EXCEPTION 'EXP_REENVIO_QUEM_PAGA: o #% esta como "%"; reenvio so em CIF ou FOB.',
      p_id_int, coalesce(v_modalidade, 'sem quem paga') USING ERRCODE = 'P0001';
  END IF;

  -- 6. tipo de envio: o mesmo vocabulario do Despachar (TRANSPORTES_POR_MODALIDADE)
  v_tipo_novo := upper(btrim(p_tipo_frete));
  IF v_tipo_novo NOT IN ('CORREIOS', 'MOTOBOY', 'TRANSPORTADORA')
     OR (v_modalidade = 'FOB' AND v_tipo_novo = 'CORREIOS') THEN
    RAISE EXCEPTION 'EXP_REENVIO_TIPO: tipo de envio "%" nao vale em %.', p_tipo_frete, v_modalidade USING ERRCODE = 'P0001';
  END IF;
  v_tipo_ant := upper(nullif(btrim(coalesce(v_exp.tipo_frete, '')), ''));
  v_tipo_mudou := v_tipo_ant IS DISTINCT FROM v_tipo_novo;

  -- 7. endereco: do cliente ou do pagador, com CEP
  SELECT * INTO v_end FROM public.enderecos WHERE id = p_id_endereco_entrega;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXP_REENVIO_ENDERECO: endereco nao encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF v_end.id_cliente IS DISTINCT FROM v_prop.id_cliente AND v_end.id_cliente IS DISTINCT FROM v_prop.id_faturado THEN
    RAISE EXCEPTION 'EXP_REENVIO_ENDERECO: o endereco escolhido nao e do cliente nem do pagador do #%.', p_id_int USING ERRCODE = 'P0001';
  END IF;
  v_cep_novo := nullif(regexp_replace(coalesce(v_end.cep, ''), '\D', '', 'g'), '');
  IF v_cep_novo IS NULL OR length(v_cep_novo) <> 8 THEN
    RAISE EXCEPTION 'EXP_REENVIO_ENDERECO: o endereco escolhido esta sem CEP valido.' USING ERRCODE = 'P0001';
  END IF;
  IF v_exp.id_endereco_entrega IS NOT NULL THEN
    SELECT nullif(regexp_replace(coalesce(cep, ''), '\D', '', 'g'), '') INTO v_cep_ant
      FROM public.enderecos WHERE id = v_exp.id_endereco_entrega;
  END IF;

  -- 8. frete. Frete do envio anterior: o do ultimo ciclo que gravou frete, ou o
  --    da proposta (primeiro reenvio).
  SELECT r.frete_novo INTO v_frete_ant
    FROM public.expedicao_reenvios r
   WHERE r.id_int = p_id_int AND r.frete_novo IS NOT NULL
   ORDER BY r.ciclo DESC LIMIT 1;
  v_frete_ant := round(coalesce(v_frete_ant, v_prop.valor_frete::numeric, 0), 2);

  IF v_modalidade = 'CIF' AND (v_cep_novo IS DISTINCT FROM v_cep_ant OR v_tipo_mudou)
     AND (p_id_consulta IS NOT NULL OR p_frete_digitado IS NOT NULL) THEN
    -- 8a. FASE 2B: frete novo cotado e conferido aqui.
    SELECT * INTO v_consulta
      FROM public.expedicao_recotacao_consultas
     WHERE id_int = p_id_int AND cep = v_cep_novo
     ORDER BY consultado_em DESC, id DESC
     LIMIT 1;
    IF FOUND THEN
      v_tem_do_tipo := EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_consulta.opcoes) o
         WHERE public.exp__tipo_frete_do_texto(coalesce(nullif(o->>'servico', ''), o->>'transportadora')) = v_tipo_novo
            OR public.exp__tipo_frete_do_texto(o->>'transportadora') = v_tipo_novo);
    END IF;

    IF p_id_consulta IS NOT NULL THEN
      IF v_consulta.id IS DISTINCT FROM p_id_consulta THEN
        RAISE EXCEPTION 'EXP_REENVIO_FRETE: a cotacao escolhida nao e a mais recente deste pedido para o CEP %. Cote de novo; nada foi gravado.',
          v_cep_novo USING ERRCODE = 'P0001';
      END IF;
      SELECT o INTO v_opcao
        FROM jsonb_array_elements(v_consulta.opcoes) o
       WHERE o->>'id' = btrim(p_id_opcao)
       LIMIT 1;
      IF v_opcao IS NULL THEN
        RAISE EXCEPTION 'EXP_REENVIO_FRETE: a opcao escolhida nao esta nessa cotacao. Cote de novo; nada foi gravado.' USING ERRCODE = 'P0001';
      END IF;
      IF public.exp__tipo_frete_do_texto(coalesce(nullif(v_opcao->>'servico', ''), v_opcao->>'transportadora')) IS DISTINCT FROM v_tipo_novo
         AND public.exp__tipo_frete_do_texto(v_opcao->>'transportadora') IS DISTINCT FROM v_tipo_novo THEN
        RAISE EXCEPTION 'EXP_REENVIO_FRETE: a opcao % nao e do tipo de envio %.',
          coalesce(v_opcao->>'servico', v_opcao->>'transportadora'), v_tipo_novo USING ERRCODE = 'P0001';
      END IF;
      IF coalesce(v_opcao->>'valor', '') !~ '^[0-9]+(\.[0-9]+)?$' THEN
        RAISE EXCEPTION 'EXP_REENVIO_FRETE: a opcao escolhida esta sem valor.' USING ERRCODE = 'P0001';
      END IF;
      v_frete_novo := round((v_opcao->>'valor')::numeric, 2);
      v_origem := 'COTACAO';
    ELSE
      -- Valor digitado: so ADM, e so quando a cotacao automatica nao trouxe o tipo.
      BEGIN
        PERFORM public.cc__assert_permissao(v_uid, 'expedicao.admin');
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'EXP_REENVIO_FRETE: so um administrador da Expedicao (expedicao.admin) digita o frete do reenvio.' USING ERRCODE = 'P0001';
      END;
      IF v_tem_do_tipo THEN
        RAISE EXCEPTION 'EXP_REENVIO_FRETE: a cotacao automatica tem opcao de %; escolha a opcao cotada em vez de digitar.',
          v_tipo_novo USING ERRCODE = 'P0001';
      END IF;
      IF p_frete_digitado <= 0 OR p_frete_digitado > 100000 THEN
        RAISE EXCEPTION 'EXP_REENVIO_FRETE: frete digitado invalido.' USING ERRCODE = 'P0001';
      END IF;
      v_frete_novo := round(p_frete_digitado, 2);
      v_origem := 'DIGITADO_ADM';
      v_digit_uid := v_uid;
    END IF;

    v_diferenca := v_frete_novo - v_frete_ant;
    IF v_diferenca < 0 THEN
      RAISE EXCEPTION 'EXP_REENVIO_FRETE: o frete novo (R$ %) e menor que o do envio anterior (R$ %). Diferenca a devolver ainda nao existe no reenvio; nada foi gravado.',
        replace(to_char(v_frete_novo, 'FM999999990.00'), '.', ','),
        replace(to_char(v_frete_ant, 'FM999999990.00'), '.', ',') USING ERRCODE = 'P0001';
    END IF;
    v_veredito := jsonb_build_object('situacao', v_origem, 'frete_anterior', v_frete_ant, 'frete_novo', v_frete_novo,
      'diferenca', v_diferenca, 'id_consulta', v_consulta.id, 'opcao', v_opcao);

  ELSIF v_modalidade = 'CIF' AND (v_cep_novo IS DISTINCT FROM v_cep_ant OR v_tipo_mudou) THEN
    -- 8b. Sem cotacao informada: a regra da fase 1 (so passa sem diferenca).
    v_veredito := public.exp_trava_frete_despacho(p_id_int, v_cep_novo, v_tipo_novo, v_modalidade);
    v_situacao := v_veredito->>'situacao';
    IF NOT (v_situacao = 'SEM_DIVERGENCIA'
            OR (v_situacao = 'DENTRO_DO_LIMITE' AND coalesce((v_veredito->>'diferenca')::numeric, 1) = 0)) THEN
      RAISE EXCEPTION 'EXP_REENVIO_FRETE: %',
        CASE
          WHEN v_situacao IN ('PRECISA_RECOTAR', 'SEM_COTACAO') OR (v_situacao = 'LIBERADO_ADM' AND v_veredito->>'valor_recotado' IS NULL) THEN
            'este endereco ou tipo de envio exige cotar o frete do reenvio.'
          ELSE
            format('este endereco ou tipo de envio muda o valor do frete (recotado R$ %s, proposta R$ %s).',
              replace(to_char(coalesce((v_veredito->>'valor_recotado')::numeric, 0), 'FM999999990.00'), '.', ','),
              replace(to_char(coalesce((v_veredito->>'frete_proposta')::numeric, 0), 'FM999999990.00'), '.', ','))
        END || ' Cote o frete na janela do reenvio e escolha a opcao; nada foi gravado.'
        USING ERRCODE = 'P0001';
    END IF;
    v_frete_novo := v_frete_ant;
    v_origem := 'TRAVA';
  ELSE
    v_veredito := jsonb_build_object('situacao', CASE WHEN v_modalidade = 'FOB' THEN 'FORA_DE_CIF' ELSE 'SEM_MUDANCA' END);
    v_origem := CASE WHEN v_modalidade = 'FOB' THEN 'FORA_DE_CIF' ELSE 'SEM_MUDANCA' END;
    v_frete_novo := CASE WHEN v_modalidade = 'CIF' THEN v_frete_ant ELSE NULL END;
  END IF;

  -- 9. gravacoes
  SELECT coalesce(nullif(btrim(nome_usuario), ''), email) INTO v_nome FROM public.usuarios WHERE user_id = v_uid;
  IF v_digit_uid IS NOT NULL THEN
    v_digit_nome := v_nome;
  END IF;

  INSERT INTO public.expedicao_reenvios (
    id_int, ciclo, chave, motivo, autor_uid, autor_nome, status_anterior, modalidade_frete,
    id_endereco_anterior, id_endereco_novo, cep_anterior, cep_novo,
    tipo_frete_anterior, tipo_frete_novo, data_despacho_anterior, veredito_frete, envio_anterior,
    frete_anterior, frete_novo, diferenca, frete_origem, id_consulta_frete, opcao_frete,
    frete_digitado_por, frete_digitado_por_nome, exige_nota)
  VALUES (
    p_id_int, p_ciclo, v_chave, v_motivo, v_uid, v_nome, v_prop.status_interno, v_modalidade,
    v_exp.id_endereco_entrega, p_id_endereco_entrega, v_cep_ant, v_cep_novo,
    v_tipo_ant, v_tipo_novo, v_exp.data_despacho, v_veredito, to_jsonb(v_exp),
    CASE WHEN v_modalidade = 'CIF' THEN v_frete_ant END, v_frete_novo, v_diferenca, v_origem,
    CASE WHEN v_origem = 'COTACAO' THEN v_consulta.id END, v_opcao,
    v_digit_uid, v_digit_nome, v_tipo_mudou)
  RETURNING id INTO v_novo_id;

  UPDATE public.expedicoes
     SET id_endereco_entrega       = p_id_endereco_entrega,
         tipo_frete                = v_tipo_novo,
         transportadora_nome       = CASE WHEN v_tipo_mudou THEN NULL ELSE transportadora_nome END,
         id_transportadora_cliente = CASE WHEN v_tipo_mudou THEN NULL ELSE id_transportadora_cliente END,
         categoria_frete           = CASE WHEN v_tipo_mudou THEN NULL ELSE categoria_frete END,
         updated_at                = now()
   WHERE id_int = p_id_int;

  UPDATE public.propostas
     SET status_interno = 'EXPEDICAO'
   WHERE id_int = p_id_int AND status_interno = v_prop.status_interno;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXP_REENVIO_CONFLITO: o status do #% mudou durante o reenvio.', p_id_int USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.os_status_log (
    id_int, status_anterior, status_novo, resultado, motivo, origem, ator_tipo, ator_uid, ator_nome, tipo_transicao)
  VALUES (
    p_id_int, v_prop.status_interno, 'EXPEDICAO', 'sucesso',
    left(format('Reenvio %s: %s', p_ciclo, v_motivo)
      || CASE WHEN v_diferenca > 0
              THEN format(' (frete R$ %s -> R$ %s, diferenca R$ %s)',
                     replace(to_char(v_frete_ant, 'FM999999990.00'), '.', ','),
                     replace(to_char(v_frete_novo, 'FM999999990.00'), '.', ','),
                     replace(to_char(v_diferenca, 'FM999999990.00'), '.', ','))
              ELSE '' END, 500),
    'EXPEDICAO_REENVIO', 'USUARIO', v_uid, v_nome, 'RETORNO');

  RETURN jsonb_build_object('id', v_novo_id, 'ciclo', p_ciclo, 'chave', v_chave, 'idempotente', false,
    'veredito_frete', v_veredito, 'diferenca', v_diferenca, 'exige_nota', v_tipo_mudou);
END;
$$;

REVOKE ALL ON FUNCTION public.exp_reenviar_pedido(bigint, integer, uuid, text, text, text, bigint, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exp_reenviar_pedido(bigint, integer, uuid, text, text, text, bigint, text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.exp_reenviar_pedido(bigint, integer, uuid, text, text, text, bigint, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exp_reenviar_pedido(bigint, integer, uuid, text, text, text, bigint, text, numeric) TO service_role;

COMMENT ON FUNCTION public.exp_reenviar_pedido(bigint, integer, uuid, text, text, text, bigint, text, numeric) IS
  'Reenvio (fase 1 22/10 + 2B 18/11/2026): EM TRANSITO -> EXPEDICAO com endereco/tipo novos. Em CIF com frete novo: opcao da cotacao mais recente do CEP (conferida aqui) ou valor digitado por expedicao.admin; diferenca positiva fica no ciclo (cobranca/abono depois), negativa recusada. Tipo trocado exige nota nova no redespacho. Quem paga travado.';

-- -----------------------------------------------------------------------------
-- 5. COBRAR A DIFERENCA (PIX marcado; o QR e gerado pela aba Pagamentos)
-- -----------------------------------------------------------------------------
-- Pagador, empresa e atendente: os da cobranca do pedido (a paga mais recente,
-- ou a ativa mais recente), como a Chave Pix copia da origem. Uma viva por
-- ciclo: ja existindo, devolve a mesma (o indice unico da 2A garante).
CREATE FUNCTION public.exp_reenvio_cobrar_diferenca(p_chave text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_r         public.expedicao_reenvios%ROWTYPE;
  v_viva      public.pagamentos_v2%ROWTYPE;
  v_modelo    public.pagamentos_v2%ROWTYPE;
  v_status    text;
  v_pendente  numeric;
  v_id        uuid;
  v_ref       text;
BEGIN
  PERFORM public.cc__assert_permissao(v_uid, 'cobrancas.create');

  SELECT * INTO v_r FROM public.expedicao_reenvios WHERE chave = p_chave FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXP_REENVIO_COBRANCA: reenvio % nao encontrado.', coalesce(p_chave, 'vazio') USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_viva FROM public.pagamentos_v2
   WHERE chave_reenvio = v_r.chave AND status IS DISTINCT FROM 'CANCELADO'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_viva.id, 'id_pagamento', v_viva.id_pagamento, 'valor', v_viva.valor,
      'id_empresa', v_viva.id_empresa, 'idempotente', true);
  END IF;

  v_pendente := round(v_r.diferenca - coalesce(v_r.abono_valor, 0), 2);
  IF v_pendente <= 0 THEN
    RAISE EXCEPTION 'EXP_REENVIO_COBRANCA: o reenvio % nao tem diferenca de frete a cobrar.', v_r.ciclo USING ERRCODE = 'P0001';
  END IF;

  SELECT upper(btrim(coalesce(status_interno, ''))) INTO v_status FROM public.propostas WHERE id_int = v_r.id_int;
  IF v_status IN ('CANCELADO', 'ENTREGUE') THEN
    RAISE EXCEPTION 'EXP_REENVIO_COBRANCA: o #% esta %; nao recebe cobranca nova.', v_r.id_int, v_status USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_modelo FROM public.pagamentos_v2
   WHERE id_int = v_r.id_int AND chave_reenvio IS NULL AND status IS DISTINCT FROM 'CANCELADO'
   ORDER BY (status = 'PAID') DESC, created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXP_REENVIO_COBRANCA: o #% nao tem cobranca ativa de onde copiar o pagador.', v_r.id_int USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.pagamentos_v2 (
    id_int, id_cliente, cliente, documento, valor, status, tipo_cobranca,
    empresa, id_empresa, os_ideal, atendente, descricao, vencimento, obs_v2,
    confirmado, forma_fatu, forma_pgto, id_modelo_cobranca,
    p_valor_entrada, p_qtd_parcelas, p_dias_pra_inicio, p_intervalo, paid_at, chave_reenvio
  ) VALUES (
    v_r.id_int, v_modelo.id_cliente, v_modelo.cliente, v_modelo.documento,
    v_pendente, 'A_RECEBER', 'PIX',
    v_modelo.empresa, v_modelo.id_empresa, v_modelo.os_ideal, v_modelo.atendente,
    format('Diferença de frete do reenvio %s do pedido #%s (R$ %s -> R$ %s)', v_r.ciclo, v_r.id_int,
      replace(to_char(coalesce(v_r.frete_anterior, 0), 'FM999999990.00'), '.', ','),
      replace(to_char(coalesce(v_r.frete_novo, 0), 'FM999999990.00'), '.', ',')),
    (now() AT TIME ZONE 'America/Sao_Paulo')::date, NULL,
    false, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, v_r.chave
  ) RETURNING id, id_pagamento INTO v_id, v_ref;

  RETURN jsonb_build_object('id', v_id, 'id_pagamento', v_ref, 'valor', v_pendente,
    'id_empresa', v_modelo.id_empresa, 'idempotente', false);
END;
$$;

REVOKE ALL ON FUNCTION public.exp_reenvio_cobrar_diferenca(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exp_reenvio_cobrar_diferenca(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.exp_reenvio_cobrar_diferenca(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exp_reenvio_cobrar_diferenca(text) TO service_role;

COMMENT ON FUNCTION public.exp_reenvio_cobrar_diferenca(text) IS
  'Reenvio fase 2B: cria a cobranca PIX (A_RECEBER) da diferenca de frete do ciclo, marcada com chave_reenvio, copiando pagador/empresa da cobranca do pedido. Uma viva por ciclo (devolve a existente). Permissao cobrancas.create. O QR e gerado depois por /api/cobrancas/gerar-pix.';

-- -----------------------------------------------------------------------------
-- 6. ABONAR A DIFERENCA (so administrador)
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.exp_reenvio_abonar_diferenca(p_chave text, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_adm     boolean;
  v_nome    text;
  v_motivo  text := btrim(coalesce(p_motivo, ''));
  v_r       public.expedicao_reenvios%ROWTYPE;
  v_viva    public.pagamentos_v2%ROWTYPE;
  v_cli     bigint;
BEGIN
  SELECT coalesce(is_super_adm, false) OR coalesce(is_admin, false),
         coalesce(nullif(btrim(nome_usuario), ''), email)
    INTO v_adm, v_nome
    FROM public.usuarios WHERE user_id = v_uid;
  IF NOT coalesce(v_adm, false) THEN
    RAISE EXCEPTION 'EXP_REENVIO_ABONO: somente administrador abona a diferenca de frete do reenvio.' USING ERRCODE = 'P0001';
  END IF;
  IF char_length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'EXP_REENVIO_ABONO: descreva o motivo do abono (minimo 5 caracteres).' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_r FROM public.expedicao_reenvios WHERE chave = p_chave FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXP_REENVIO_ABONO: reenvio % nao encontrado.', coalesce(p_chave, 'vazio') USING ERRCODE = 'P0001';
  END IF;
  IF v_r.abonado_em IS NOT NULL THEN
    RETURN jsonb_build_object('chave', v_r.chave, 'abono', v_r.abono_valor, 'idempotente', true);
  END IF;
  IF v_r.diferenca <= 0 THEN
    RAISE EXCEPTION 'EXP_REENVIO_ABONO: o reenvio % nao tem diferenca de frete.', v_r.ciclo USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_viva FROM public.pagamentos_v2
   WHERE chave_reenvio = v_r.chave AND status IS DISTINCT FROM 'CANCELADO'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'EXP_REENVIO_ABONO: a diferenca do reenvio % ja tem a cobranca % (%). %',
      v_r.ciclo, coalesce(v_viva.id_pagamento, v_viva.id::text), v_viva.status,
      CASE WHEN v_viva.status = 'PAID' THEN 'Ja foi paga; nao ha o que abonar.'
           ELSE 'Cancele a cobranca antes de abonar.' END
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.expedicao_reenvios
     SET abono_valor = v_r.diferenca, abonado_por = v_uid, abonado_por_nome = v_nome,
         abonado_em = now(), abono_motivo = v_motivo
   WHERE id = v_r.id;

  SELECT id_cliente INTO v_cli FROM public.propostas WHERE id_int = v_r.id_int;
  INSERT INTO public.propostas_chat (id_int, id_cliente, mensagem, tipo, autor_uid, autor_nome, setor, visivel_externo)
  VALUES (v_r.id_int, v_cli,
    format('Diferença de frete do reenvio %s (%s) abonada por %s. Motivo: %s',
      v_r.ciclo, public.exp__reais(v_r.diferenca), coalesce(v_nome, 'Usuário'), v_motivo),
    'SISTEMA', v_uid, v_nome, 'Financeiro', false);

  RETURN jsonb_build_object('chave', v_r.chave, 'abono', v_r.diferenca, 'idempotente', false);
END;
$$;

REVOKE ALL ON FUNCTION public.exp_reenvio_abonar_diferenca(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exp_reenvio_abonar_diferenca(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.exp_reenvio_abonar_diferenca(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exp_reenvio_abonar_diferenca(text, text) TO service_role;

COMMENT ON FUNCTION public.exp_reenvio_abonar_diferenca(text, text) IS
  'Reenvio fase 2B: abona a diferenca de frete do ciclo (so is_admin/is_super_adm, motivo obrigatorio). Recusa se ha cobranca viva do ciclo. Grava no ciclo e no chat (Financeiro). Nao mexe em valor_total nem desconto.';

-- -----------------------------------------------------------------------------
-- CONFERENCIA (sem contagem em tabela viva)
-- -----------------------------------------------------------------------------
DO $confere$
BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.exp_saldo_despacho(bigint)'::regprocedure) NOT LIKE '%SALDO_REENVIO%' THEN
    RAISE EXCEPTION 'exp_saldo_despacho sem a parte do reenvio.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'exp_reenviar_pedido'
                AND pg_get_function_identity_arguments(p.oid) = 'p_id_int bigint, p_ciclo integer, p_id_endereco_entrega uuid, p_tipo_frete text, p_motivo text, p_modalidade text') THEN
    RAISE EXCEPTION 'a assinatura antiga de exp_reenviar_pedido continua no banco.';
  END IF;
  IF has_function_privilege('anon', 'public.exp_reenvio_cobrar_diferenca(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.exp_reenvio_abonar_diferenca(text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.exp_reenviar_pedido(bigint, integer, uuid, text, text, text, bigint, text, numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon com EXECUTE numa funcao do reenvio.';
  END IF;
END
$confere$;

-- =============================================================================
-- ROLLBACK (so com autorizacao; antes confira que nenhum ciclo tem diferenca
-- ou abono e nenhuma cobranca tem chave_reenvio:
--   select count(*) from public.expedicao_reenvios where diferenca > 0 or abonado_em is not null;
--   select count(*) from public.pagamentos_v2 where chave_reenvio is not null;)
--   1. drop function public.exp_reenvio_abonar_diferenca(text, text);
--      drop function public.exp_reenvio_cobrar_diferenca(text);
--   2. drop function public.exp_reenviar_pedido(bigint, integer, uuid, text, text, text, bigint, text, numeric);
--      e rodar de novo o CREATE de 20261022_exp_reenvio_trava_saldo.sql (com os
--      revoke/grant dela: authenticated e service_role, sem anon/PUBLIC);
--   3. rodar de novo o CREATE OR REPLACE de exp_saldo_despacho de
--      20261021_exp_trava_saldo_despacho.sql (md5 8b42e75bf2366c1ed220b49e3198e72f);
--   4. drop function public.exp_reenvio_situacao(bigint);
--   5. alter table public.expedicao_reenvios
--        drop constraint expedicao_reenvios_abono_completo,
--        drop constraint expedicao_reenvios_abono_ate_diferenca,
--        drop constraint expedicao_reenvios_frete_origem,
--        drop constraint expedicao_reenvios_diferenca_nao_negativa,
--        drop column abono_motivo, drop column abonado_em, drop column abonado_por_nome,
--        drop column abonado_por, drop column abono_valor, drop column exige_nota,
--        drop column frete_digitado_por_nome, drop column frete_digitado_por,
--        drop column opcao_frete, drop column id_consulta_frete, drop column frete_origem,
--        drop column diferenca, drop column frete_novo, drop column frete_anterior;
--   Rodar a migration 20261118b (rollback dela) ANTES deste.
-- =============================================================================
