-- =============================================================================
-- 20261022_exp_reenvio_trava_saldo
--
-- REENVIO, FASE 1: TRAVA DE SALDO (22/10/2026).
--
-- exp_reenviar_pedido nao conferia saldo, e o reenvio mantem a data do despacho
-- anterior: a trigger trg_exp_trava_despacho_saldo (so no PRIMEIRO data_despacho)
-- tambem nao roda no redespacho. Pedido que ganhou saldo a definir depois do
-- primeiro envio (frete ou modalidade alterados depois de pago) saia de novo.
--
-- O QUE MUDA: so exp_reenviar_pedido (CREATE OR REPLACE, mesma assinatura, mesmos
-- GRANTs). Um passo novo, 4b, antes de qualquer gravacao: consulta
-- exp_saldo_despacho(p_id_int) e, com bloqueia = true, recusa com
-- EXP_REENVIO_SALDO + a mensagem dela + 'o saldo precisa ser resolvido (cobranca
-- paga ou abono) antes do reenvio'. DETAIL leva o veredito (total, pago, saldo).
-- A repeticao da mesma chave continua devolvendo o registro ja gravado.
--
-- NAO MEXE em exp_saldo_despacho, trg_exp_trava_despacho_saldo, trava de frete,
-- data_despacho, cotacao_frete, valor_total, pagamentos_v2 nem Conta Corrente.
-- Nao corrige pedido existente.
--
-- Quem depende (mapeado 22/10/2026): nenhuma funcao nem visao do banco chama
-- exp_reenviar_pedido; no app, so src/features/expedicao/services/reenvio.client.ts.
--
-- TRAVA DE APLICACAO: a funcao de hoje tem de bater com o md5 lido no mapeamento,
-- e exp_saldo_despacho (lida, nao alterada) tambem.
-- =============================================================================

SET LOCAL lock_timeout = '8s';

DO $trava$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'exp_reenviar_pedido'
     AND pg_get_function_identity_arguments(p.oid) = 'p_id_int bigint, p_ciclo integer, p_id_endereco_entrega uuid, p_tipo_frete text, p_motivo text, p_modalidade text';
  IF v_md5 IS DISTINCT FROM 'e67a549e47a4b1c2cb955c29dc17d872' THEN
    RAISE EXCEPTION 'exp_reenviar_pedido mudou desde o mapeamento (md5 %). Nada aplicado.', v_md5;
  END IF;

  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'exp_saldo_despacho'
     AND pg_get_function_identity_arguments(p.oid) = 'p_id_int bigint';
  IF v_md5 IS DISTINCT FROM '8b42e75bf2366c1ed220b49e3198e72f' THEN
    RAISE EXCEPTION 'exp_saldo_despacho mudou desde o mapeamento (md5 %). Nada aplicado.', v_md5;
  END IF;
END
$trava$;

CREATE OR REPLACE FUNCTION public.exp_reenviar_pedido(
  p_id_int               bigint,
  p_ciclo                integer,
  p_id_endereco_entrega  uuid,
  p_tipo_frete           text,
  p_motivo               text,
  p_modalidade           text DEFAULT NULL)
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
BEGIN
  -- 1. permissao (super/admin passam pelo fallback de sempre de cc__assert_permissao)
  PERFORM public.cc__assert_permissao(v_uid, 'expedicao.reenvio');

  IF p_id_int IS NULL OR p_ciclo IS NULL OR p_ciclo < 1
     OR p_id_endereco_entrega IS NULL OR nullif(btrim(coalesce(p_tipo_frete, '')), '') IS NULL THEN
    RAISE EXCEPTION 'EXP_REENVIO_PARAMS: pedido, ciclo, endereco e tipo de envio sao obrigatorios.' USING ERRCODE = 'P0001';
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
    RETURN jsonb_build_object('id', v_exist.id, 'ciclo', v_exist.ciclo, 'chave', v_exist.chave, 'idempotente', true);
  END IF;

  -- 3. trava do pedido; a chave e conferida de novo depois do lock (duas
  --    chamadas simultaneas: a segunda espera e devolve a primeira).
  SELECT * INTO v_prop FROM public.propostas WHERE id_int = p_id_int FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXP_REENVIO_PEDIDO: pedido #% nao encontrado.', p_id_int USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_exist FROM public.expedicao_reenvios WHERE chave = v_chave;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_exist.id, 'ciclo', v_exist.ciclo, 'chave', v_exist.chave, 'idempotente', true);
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

  -- 4b. SALDO A DEFINIR (22/10/2026, exp_reenvio_trava_saldo). O mesmo veredito
  --     da trava de saldo do despacho: round(valor_total, 2) - cc__valor_pago, em
  --     centavos, R$ 0,01 ja bloqueia. A trigger da trava so age no primeiro
  --     data_despacho, e o reenvio mantem a data do envio anterior; por isso a
  --     conferencia mora aqui, antes de qualquer gravacao. Sem criterio novo.
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
    RAISE EXCEPTION 'EXP_REENVIO_QUEM_PAGA: o reenvio nao troca quem paga o frete (gravado %, pedido %). A diferenca de frete sera tratada na fase 2.',
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

  -- 8. frete: so passa o que nao exige recotar nem muda o valor
  IF v_modalidade = 'CIF' AND (v_cep_novo IS DISTINCT FROM v_cep_ant OR v_tipo_mudou) THEN
    v_veredito := public.exp_trava_frete_despacho(p_id_int, v_cep_novo, v_tipo_novo, v_modalidade);
    v_situacao := v_veredito->>'situacao';
    IF NOT (v_situacao = 'SEM_DIVERGENCIA'
            OR (v_situacao = 'DENTRO_DO_LIMITE' AND coalesce((v_veredito->>'diferenca')::numeric, 1) = 0)) THEN
      RAISE EXCEPTION 'EXP_REENVIO_FRETE: %',
        CASE
          WHEN v_situacao IN ('PRECISA_RECOTAR', 'SEM_COTACAO') OR (v_situacao = 'LIBERADO_ADM' AND v_veredito->>'valor_recotado' IS NULL) THEN
            'este endereco ou tipo de envio exige recotar o frete.'
          ELSE
            format('este endereco ou tipo de envio muda o valor do frete (recotado R$ %s, proposta R$ %s).',
              replace(to_char(coalesce((v_veredito->>'valor_recotado')::numeric, 0), 'FM999999990.00'), '.', ','),
              replace(to_char(coalesce((v_veredito->>'frete_proposta')::numeric, 0), 'FM999999990.00'), '.', ','))
        END || ' A diferenca de frete no reenvio sera tratada na fase 2; nada foi gravado.'
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_veredito := jsonb_build_object('situacao', CASE WHEN v_modalidade = 'FOB' THEN 'FORA_DE_CIF' ELSE 'SEM_MUDANCA' END);
  END IF;

  -- 9. gravacoes
  SELECT coalesce(nullif(btrim(nome_usuario), ''), email) INTO v_nome FROM public.usuarios WHERE user_id = v_uid;

  INSERT INTO public.expedicao_reenvios (
    id_int, ciclo, chave, motivo, autor_uid, autor_nome, status_anterior, modalidade_frete,
    id_endereco_anterior, id_endereco_novo, cep_anterior, cep_novo,
    tipo_frete_anterior, tipo_frete_novo, data_despacho_anterior, veredito_frete, envio_anterior)
  VALUES (
    p_id_int, p_ciclo, v_chave, v_motivo, v_uid, v_nome, v_prop.status_interno, v_modalidade,
    v_exp.id_endereco_entrega, p_id_endereco_entrega, v_cep_ant, v_cep_novo,
    v_tipo_ant, v_tipo_novo, v_exp.data_despacho, v_veredito, to_jsonb(v_exp))
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
    left(format('Reenvio %s: %s', p_ciclo, v_motivo), 500),
    'EXPEDICAO_REENVIO', 'USUARIO', v_uid, v_nome, 'RETORNO');

  RETURN jsonb_build_object('id', v_novo_id, 'ciclo', p_ciclo, 'chave', v_chave, 'idempotente', false, 'veredito_frete', v_veredito);
END;
$$;

COMMENT ON FUNCTION public.exp_reenviar_pedido(bigint, integer, uuid, text, text, text) IS
  'Reenvio fase 1: EM TRANSITO -> EXPEDICAO com endereco/tipo novos, sem diferenca de frete e sem saldo a definir (exp_saldo_despacho). Permissao expedicao.reenvio; chave REENVIO:<id_int>:<ciclo>; grava expedicao_reenvios, expedicoes (endereco/tipo), propostas.status_interno e os_status_log.';
