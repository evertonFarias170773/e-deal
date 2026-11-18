-- =============================================================================
-- 20261118c_exp_reenvio_modo_cobranca
--
-- REENVIO: COMO COBRAR O FRETE DO REENVIO (18/11/2026, regra do Everton).
-- Depende de 20261118_exp_reenvio_fase2b_diferenca.sql e
-- 20261118b_exp_reenvio_trava_redespacho.sql (ambas no ar desde d5bd7601).
--
-- A 2B so cobrava a diferenca (frete novo - frete anterior). Agora, no reenvio,
-- escolhe-se o MODO de cobrar o frete novo:
--   - DIFERENCA:    frete novo - frete anterior (o de hoje). Frete menor
--                   continua recusado, SO neste modo.
--   - CHEIO:        o frete novo inteiro, sem desconto do anterior. Aceita
--                   qualquer valor de frete novo.
--   - SEM_COBRANCA: nada a cobrar. So administrador (is_admin/is_super_adm),
--                   com motivo. Aceita qualquer valor de frete novo. O Abonar
--                   posterior continua existindo.
-- O VALOR A COBRAR do ciclo (valor_cobrar) sai do modo, numa coluna gerada: e
-- ele que entra na trava de saldo (exp_reenvio_situacao/exp_saldo_despacho) e
-- no PIX do reenvio. A diferenca continua gravada, so como informacao (pode
-- ser negativa fora do modo DIFERENCA).
--
-- Em FOB o cliente paga o frete direto a transportadora: o reenvio so aceita
-- DIFERENCA (valor 0).
--
-- O QUE CRIA / MUDA
--   1. expedicao_reenvios: modo_cobranca (+ motivo e quem definiu) e
--      valor_cobrar (GERADA a partir do modo; coerencia no banco). Ciclos
--      existentes ficam DIFERENCA, com valor_cobrar = diferenca.
--   2. exp_reenvio_situacao: + modo, valor a cobrar, transportadora; pendente
--      passa a ser valor_cobrar - abono - pago.
--   3. exp_saldo_despacho: o bloco SALDO_REENVIO le o pendente do valor a
--      cobrar (antes, da diferenca). Pedido sem reenvio: retorno igual.
--   4. exp_reenviar_pedido: nova assinatura (+ p_modo_cobranca,
--      p_motivo_cobranca, ambos DEFAULT; sem eles = DIFERENCA, como hoje).
--   5. exp_reenvio_cobrar_diferenca: cobra o valor a cobrar do ciclo.
--   6. exp_reenvio_abonar_diferenca: abona o valor a cobrar do ciclo.
--   7. exp_reenvio_redespacho: devolve tambem modo e valor a cobrar.
--   8. exp_reenvio_trocar_modo(chave, modo, motivo): so administrador, so o
--      ultimo ciclo e so aberto, sem cobranca viva nem paga e sem abono.
--
-- NAO MEXE em propostas (frete), cotacao_frete, notas, nos tres gatilhos de
-- frete, cc__valor_pago, no gatilho do redespacho, RLS nem GRANT de tabela.
-- Nao muda nenhum ciclo existente alem das colunas novas (DIFERENCA).
-- =============================================================================

SET LOCAL lock_timeout = '8s';

-- -----------------------------------------------------------------------------
-- TRAVA DE APLICACAO: as funcoes da 2B tem de estar como em d5bd7601.
-- -----------------------------------------------------------------------------
DO $trava$
DECLARE
  v_md5 text;
  v_esperado record;
BEGIN
  FOR v_esperado IN
    SELECT * FROM (VALUES
      ('exp_saldo_despacho',           'p_id_int bigint', '7b12dd2d308e0de6b0c7c7eb68348caf'),
      ('exp_reenviar_pedido',          'p_id_int bigint, p_ciclo integer, p_id_endereco_entrega uuid, p_tipo_frete text, p_motivo text, p_modalidade text, p_id_consulta bigint, p_id_opcao text, p_frete_digitado numeric', 'a1630d00064af7f2e1284b5754f5eac4'),
      ('exp_reenvio_situacao',         'p_id_int bigint', '10577bae74e6099574a8fa469cc89619'),
      ('exp_reenvio_cobrar_diferenca', 'p_chave text', 'a3fbebb056d5167fd0467db2ce982d7b'),
      ('exp_reenvio_abonar_diferenca', 'p_chave text, p_motivo text', '9136ac1bf58a629c0f40678272f78004'),
      ('exp_reenvio_redespacho',       'p_id_int bigint, p_cep text, p_tipo_frete text', '886e56a1fdbbff7f382383fce5533bed'),
      ('exp__trg_reenvio_redespacho',  '', '3806427aed5b923dfa1e527084ab3803'),
      ('cc__valor_pago',               'p_id_int bigint', '4e92cd145c719e998715b2ec31efbdfa'),
      ('exp_trava_frete_despacho',     'p_id_int bigint, p_cep_destino text, p_tipo_frete text, p_modalidade text', 'e1936809e7ebb7a5e57e70dcfdcc688a')
    ) AS t(nome, args, md5)
  LOOP
    SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_md5
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_esperado.nome
       AND pg_get_function_identity_arguments(p.oid) = v_esperado.args;
    IF v_md5 IS DISTINCT FROM v_esperado.md5 THEN
      RAISE EXCEPTION '% mudou desde d5bd7601 (md5 %, esperado %). Nada aplicado.',
        v_esperado.nome, v_md5, v_esperado.md5;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.expedicao_reenvios'::regclass
                AND attname = 'modo_cobranca' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'expedicao_reenvios.modo_cobranca ja existe. Nada aplicado.';
  END IF;
END
$trava$;

-- -----------------------------------------------------------------------------
-- 1. MODO E VALOR A COBRAR DO CICLO
-- -----------------------------------------------------------------------------
ALTER TABLE public.expedicao_reenvios
  ADD COLUMN modo_cobranca          text NOT NULL DEFAULT 'DIFERENCA',
  ADD COLUMN modo_motivo            text,
  ADD COLUMN modo_definido_por      uuid,
  ADD COLUMN modo_definido_por_nome text,
  ADD COLUMN modo_definido_em       timestamptz;

-- Gerada: o valor a cobrar nao pode divergir do modo. Os ciclos que existem
-- (DIFERENCA) ficam com valor_cobrar = diferenca.
ALTER TABLE public.expedicao_reenvios
  ADD COLUMN valor_cobrar numeric(12,2) GENERATED ALWAYS AS (
    CASE modo_cobranca
      WHEN 'CHEIO'        THEN coalesce(frete_novo, 0)
      WHEN 'SEM_COBRANCA' THEN 0
      ELSE diferenca
    END) STORED;

ALTER TABLE public.expedicao_reenvios
  DROP CONSTRAINT expedicao_reenvios_diferenca_nao_negativa,
  DROP CONSTRAINT expedicao_reenvios_abono_ate_diferenca;

ALTER TABLE public.expedicao_reenvios
  ADD CONSTRAINT expedicao_reenvios_modo_cobranca CHECK (
    modo_cobranca IN ('DIFERENCA', 'CHEIO', 'SEM_COBRANCA')),
  -- frete menor so e recusado no modo DIFERENCA
  ADD CONSTRAINT expedicao_reenvios_diferenca_no_modo CHECK (
    modo_cobranca <> 'DIFERENCA' OR diferenca >= 0),
  ADD CONSTRAINT expedicao_reenvios_valor_cobrar_nao_negativo CHECK (
    valor_cobrar >= 0),
  -- sem cobranca: administrador e motivo gravados
  ADD CONSTRAINT expedicao_reenvios_sem_cobranca_motivada CHECK (
    modo_cobranca <> 'SEM_COBRANCA'
    OR (modo_definido_por IS NOT NULL AND char_length(btrim(coalesce(modo_motivo, ''))) >= 5)),
  -- em FOB nao ha frete a cobrar no reenvio
  ADD CONSTRAINT expedicao_reenvios_fob_sem_cobranca CHECK (
    modalidade_frete <> 'FOB' OR modo_cobranca = 'DIFERENCA'),
  ADD CONSTRAINT expedicao_reenvios_abono_ate_valor_cobrar CHECK (
    abono_valor IS NULL OR (abono_valor > 0 AND abono_valor <= valor_cobrar));

COMMENT ON COLUMN public.expedicao_reenvios.modo_cobranca IS
  '18/11/2026: como o frete do reenvio e cobrado. DIFERENCA (frete novo - anterior; menor recusado), CHEIO (frete novo inteiro), SEM_COBRANCA (so administrador, com motivo).';
COMMENT ON COLUMN public.expedicao_reenvios.valor_cobrar IS
  '18/11/2026: gerada a partir do modo. E o valor que entra na trava de saldo e no PIX do reenvio. A diferenca fica so como informacao.';
COMMENT ON COLUMN public.expedicao_reenvios.diferenca IS
  'Fase 2B: frete_novo - frete_anterior (informacao). Negativa so fora do modo DIFERENCA. O que se cobra e valor_cobrar.';

-- -----------------------------------------------------------------------------
-- 2. A CONTA POR CICLO (leitura)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exp_reenvio_situacao(p_id_int bigint)
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
      'tipo_frete_novo', r.tipo_frete_novo,
      'transportadora', coalesce(nullif(r.opcao_frete->>'transportadora', ''), nullif(r.opcao_frete->>'servico', '')),
      'diferenca',      r.diferenca,
      'modo_cobranca',  r.modo_cobranca,
      'modo_motivo',    r.modo_motivo,
      'modo_definido_por', r.modo_definido_por_nome,
      'valor_cobrar',   r.valor_cobrar,
      'abono',          r.abono_valor,
      'abonado_por',    r.abonado_por_nome,
      'pago',           c.pago,
      'cobranca_viva',  c.viva,
      'pendente',       greatest(0, r.valor_cobrar - coalesce(r.abono_valor, 0) - c.pago),
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

COMMENT ON FUNCTION public.exp_reenvio_situacao(bigint) IS
  'Reenvio (2B + modo 18/11/2026): por ciclo, frete anterior/novo, transportadora, diferenca (informacao), modo e valor a cobrar, abono, pago (cobranca marcada PAID ou A_VENCER confirmada), cobranca viva e pendente (valor a cobrar - abono - pago). So leitura.';

-- -----------------------------------------------------------------------------
-- 3. SALDO DO DESPACHO (mesma assinatura e GRANTs; so o bloco do reenvio muda)
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
    -- Reenvio (2B + modo de cobranca, 18/11/2026): o frete cobrado no reenvio
    -- nao esta no total nem no pago da proposta; o que falta do valor a cobrar
    -- do ciclo (pelo modo) conta aqui. Sem ciclo pendente, o retorno e o mesmo
    -- de sempre.
    SELECT round(sum(greatest(0, s.valor_cobrar - coalesce(s.abono, 0) - s.pago)), 2) AS pendente,
           min(s.ciclo) FILTER (WHERE s.valor_cobrar - coalesce(s.abono, 0) - s.pago > 0) AS ciclo
      INTO v_reenvio
      FROM jsonb_to_recordset(public.exp_reenvio_situacao(p_id_int))
           AS s(ciclo integer, valor_cobrar numeric, abono numeric, pago numeric);
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
          ' do frete do reenvio ' || v_reenvio.ciclo || '. ' ||
          'Gere o PIX do frete do reenvio na aba Pagamentos da proposta (ou peça ao administrador para abonar) ' ||
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
-- 4. A RPC DO REENVIO (assinatura nova: modo e motivo da cobranca no fim)
-- -----------------------------------------------------------------------------
DROP FUNCTION public.exp_reenviar_pedido(bigint, integer, uuid, text, text, text, bigint, text, numeric);

CREATE FUNCTION public.exp_reenviar_pedido(
  p_id_int               bigint,
  p_ciclo                integer,
  p_id_endereco_entrega  uuid,
  p_tipo_frete           text,
  p_motivo               text,
  p_modalidade           text    DEFAULT NULL,
  p_id_consulta          bigint  DEFAULT NULL,
  p_id_opcao             text    DEFAULT NULL,
  p_frete_digitado       numeric DEFAULT NULL,
  p_modo_cobranca        text    DEFAULT NULL,
  p_motivo_cobranca      text    DEFAULT NULL)
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
  -- modo de cobranca (18/11/2026)
  v_modo        text;
  v_motivo_cob  text;
  v_adm         boolean;
  v_valor       numeric;
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

  -- 1b. modo de cobranca do frete do reenvio (sem modo = DIFERENCA, como na 2B)
  v_modo := upper(coalesce(nullif(btrim(coalesce(p_modo_cobranca, '')), ''), 'DIFERENCA'));
  IF v_modo NOT IN ('DIFERENCA', 'CHEIO', 'SEM_COBRANCA') THEN
    RAISE EXCEPTION 'EXP_REENVIO_COBRANCA: modo de cobranca "%" invalido (DIFERENCA, CHEIO ou SEM_COBRANCA).', p_modo_cobranca USING ERRCODE = 'P0001';
  END IF;
  v_motivo_cob := nullif(btrim(coalesce(p_motivo_cobranca, '')), '');
  IF char_length(coalesce(v_motivo_cob, '')) > 500 THEN
    RAISE EXCEPTION 'EXP_REENVIO_COBRANCA: o motivo da cobranca passa de 500 caracteres.' USING ERRCODE = 'P0001';
  END IF;
  IF v_modo = 'SEM_COBRANCA' THEN
    SELECT coalesce(is_super_adm, false) OR coalesce(is_admin, false) INTO v_adm
      FROM public.usuarios WHERE user_id = v_uid;
    IF NOT coalesce(v_adm, false) THEN
      RAISE EXCEPTION 'EXP_REENVIO_COBRANCA: somente administrador registra reenvio sem cobranca de frete.' USING ERRCODE = 'P0001';
    END IF;
    IF char_length(coalesce(v_motivo_cob, '')) < 5 THEN
      RAISE EXCEPTION 'EXP_REENVIO_COBRANCA: informe o motivo de nao cobrar o frete do reenvio (minimo 5 caracteres).' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_chave := 'REENVIO:' || p_id_int || ':' || p_ciclo;

  -- 2. IDEMPOTENCIA antes de tudo: a mesma chave devolve o registro anterior,
  --    sem gravar nada de novo.
  SELECT * INTO v_exist FROM public.expedicao_reenvios WHERE chave = v_chave;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_exist.id, 'ciclo', v_exist.ciclo, 'chave', v_exist.chave, 'idempotente', true,
      'diferenca', v_exist.diferenca, 'exige_nota', v_exist.exige_nota,
      'modo_cobranca', v_exist.modo_cobranca, 'valor_cobrar', v_exist.valor_cobrar);
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
      'diferenca', v_exist.diferenca, 'exige_nota', v_exist.exige_nota,
      'modo_cobranca', v_exist.modo_cobranca, 'valor_cobrar', v_exist.valor_cobrar);
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

  -- 4b. SALDO A DEFINIR (22/10/2026). Desde a 2B o veredito inclui o frete
  --     pendente de ciclos anteriores (pelo valor a cobrar do modo).
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
  IF v_modalidade = 'FOB' AND v_modo <> 'DIFERENCA' THEN
    RAISE EXCEPTION 'EXP_REENVIO_COBRANCA: em FOB o cliente paga o frete direto a transportadora; o reenvio nao cobra frete (deixe o modo diferenca).' USING ERRCODE = 'P0001';
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
    -- Frete menor: recusado so no modo DIFERENCA (CHEIO e SEM_COBRANCA aceitam).
    IF v_diferenca < 0 AND v_modo = 'DIFERENCA' THEN
      RAISE EXCEPTION 'EXP_REENVIO_FRETE: o frete novo (R$ %) e menor que o do envio anterior (R$ %). No modo diferenca nao ha devolucao; cobre o frete cheio ou registre sem cobranca. Nada foi gravado.',
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
    frete_digitado_por, frete_digitado_por_nome, exige_nota,
    modo_cobranca, modo_motivo, modo_definido_por, modo_definido_por_nome, modo_definido_em)
  VALUES (
    p_id_int, p_ciclo, v_chave, v_motivo, v_uid, v_nome, v_prop.status_interno, v_modalidade,
    v_exp.id_endereco_entrega, p_id_endereco_entrega, v_cep_ant, v_cep_novo,
    v_tipo_ant, v_tipo_novo, v_exp.data_despacho, v_veredito, to_jsonb(v_exp),
    CASE WHEN v_modalidade = 'CIF' THEN v_frete_ant END, v_frete_novo, v_diferenca, v_origem,
    CASE WHEN v_origem = 'COTACAO' THEN v_consulta.id END, v_opcao,
    v_digit_uid, v_digit_nome, v_tipo_mudou,
    v_modo, v_motivo_cob, v_uid, v_nome, now())
  RETURNING id, valor_cobrar INTO v_novo_id, v_valor;

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
      || CASE WHEN v_frete_novo IS NOT NULL AND (v_diferenca <> 0 OR v_modo <> 'DIFERENCA')
              THEN format(' (frete R$ %s -> R$ %s; cobranca %s R$ %s)',
                     replace(to_char(v_frete_ant, 'FM999999990.00'), '.', ','),
                     replace(to_char(v_frete_novo, 'FM999999990.00'), '.', ','),
                     CASE v_modo WHEN 'CHEIO' THEN 'frete cheio' WHEN 'SEM_COBRANCA' THEN 'sem cobranca' ELSE 'diferenca' END,
                     replace(to_char(v_valor, 'FM999999990.00'), '.', ','))
              ELSE '' END, 500),
    'EXPEDICAO_REENVIO', 'USUARIO', v_uid, v_nome, 'RETORNO');

  RETURN jsonb_build_object('id', v_novo_id, 'ciclo', p_ciclo, 'chave', v_chave, 'idempotente', false,
    'veredito_frete', v_veredito, 'diferenca', v_diferenca, 'exige_nota', v_tipo_mudou,
    'modo_cobranca', v_modo, 'valor_cobrar', v_valor);
END;
$$;

REVOKE ALL ON FUNCTION public.exp_reenviar_pedido(bigint, integer, uuid, text, text, text, bigint, text, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exp_reenviar_pedido(bigint, integer, uuid, text, text, text, bigint, text, numeric, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.exp_reenviar_pedido(bigint, integer, uuid, text, text, text, bigint, text, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exp_reenviar_pedido(bigint, integer, uuid, text, text, text, bigint, text, numeric, text, text) TO service_role;

COMMENT ON FUNCTION public.exp_reenviar_pedido(bigint, integer, uuid, text, text, text, bigint, text, numeric, text, text) IS
  'Reenvio (fase 1 22/10 + 2B + modo 18/11/2026): EM TRANSITO -> EXPEDICAO com endereco/tipo novos. Em CIF com frete novo: opcao da cotacao mais recente do CEP (conferida aqui) ou valor digitado por expedicao.admin. Modo de cobranca: DIFERENCA (frete menor recusado), CHEIO, SEM_COBRANCA (so administrador, com motivo); o valor a cobrar (coluna gerada) fica no ciclo. Tipo trocado exige nota nova no redespacho. Quem paga travado; FOB so DIFERENCA.';

-- -----------------------------------------------------------------------------
-- 5. COBRAR O FRETE DO REENVIO (PIX marcado pelo valor a cobrar do modo)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exp_reenvio_cobrar_diferenca(p_chave text)
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

  IF v_r.modo_cobranca = 'SEM_COBRANCA' THEN
    RAISE EXCEPTION 'EXP_REENVIO_COBRANCA: o reenvio % foi registrado sem cobranca de frete.', v_r.ciclo USING ERRCODE = 'P0001';
  END IF;
  v_pendente := round(v_r.valor_cobrar - coalesce(v_r.abono_valor, 0), 2);
  IF v_pendente <= 0 THEN
    RAISE EXCEPTION 'EXP_REENVIO_COBRANCA: o reenvio % nao tem frete a cobrar.', v_r.ciclo USING ERRCODE = 'P0001';
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
    CASE v_r.modo_cobranca
      WHEN 'CHEIO' THEN format('Frete do reenvio %s do pedido #%s (valor cheio, R$ %s)', v_r.ciclo, v_r.id_int,
        replace(to_char(coalesce(v_r.frete_novo, 0), 'FM999999990.00'), '.', ','))
      ELSE format('Diferença de frete do reenvio %s do pedido #%s (R$ %s -> R$ %s)', v_r.ciclo, v_r.id_int,
        replace(to_char(coalesce(v_r.frete_anterior, 0), 'FM999999990.00'), '.', ','),
        replace(to_char(coalesce(v_r.frete_novo, 0), 'FM999999990.00'), '.', ','))
    END,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date, NULL,
    false, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, v_r.chave
  ) RETURNING id, id_pagamento INTO v_id, v_ref;

  RETURN jsonb_build_object('id', v_id, 'id_pagamento', v_ref, 'valor', v_pendente,
    'id_empresa', v_modelo.id_empresa, 'idempotente', false);
END;
$$;

COMMENT ON FUNCTION public.exp_reenvio_cobrar_diferenca(text) IS
  'Reenvio (2B + modo 18/11/2026): cria a cobranca PIX (A_RECEBER) do valor a cobrar do ciclo (diferenca ou frete cheio, conforme o modo), marcada com chave_reenvio, copiando pagador/empresa da cobranca do pedido. Uma viva por ciclo (devolve a existente). SEM_COBRANCA recusa. Permissao cobrancas.create. O QR e gerado depois por /api/cobrancas/gerar-pix.';

-- -----------------------------------------------------------------------------
-- 6. ABONAR O FRETE DO REENVIO (so administrador; abona o valor a cobrar)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exp_reenvio_abonar_diferenca(p_chave text, p_motivo text)
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
    RAISE EXCEPTION 'EXP_REENVIO_ABONO: somente administrador abona o frete do reenvio.' USING ERRCODE = 'P0001';
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
  IF v_r.valor_cobrar <= 0 THEN
    RAISE EXCEPTION 'EXP_REENVIO_ABONO: o reenvio % nao tem frete a cobrar.', v_r.ciclo USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_viva FROM public.pagamentos_v2
   WHERE chave_reenvio = v_r.chave AND status IS DISTINCT FROM 'CANCELADO'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'EXP_REENVIO_ABONO: o frete do reenvio % ja tem a cobranca % (%). %',
      v_r.ciclo, coalesce(v_viva.id_pagamento, v_viva.id::text), v_viva.status,
      CASE WHEN v_viva.status = 'PAID' THEN 'Ja foi paga; nao ha o que abonar.'
           ELSE 'Cancele a cobranca antes de abonar.' END
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.expedicao_reenvios
     SET abono_valor = v_r.valor_cobrar, abonado_por = v_uid, abonado_por_nome = v_nome,
         abonado_em = now(), abono_motivo = v_motivo
   WHERE id = v_r.id;

  SELECT id_cliente INTO v_cli FROM public.propostas WHERE id_int = v_r.id_int;
  INSERT INTO public.propostas_chat (id_int, id_cliente, mensagem, tipo, autor_uid, autor_nome, setor, visivel_externo)
  VALUES (v_r.id_int, v_cli,
    format('%s do reenvio %s (%s) abonado por %s. Motivo: %s',
      CASE v_r.modo_cobranca WHEN 'CHEIO' THEN 'Frete cheio' ELSE 'Diferença de frete' END,
      v_r.ciclo, public.exp__reais(v_r.valor_cobrar), coalesce(v_nome, 'Usuário'), v_motivo),
    'SISTEMA', v_uid, v_nome, 'Financeiro', false);

  RETURN jsonb_build_object('chave', v_r.chave, 'abono', v_r.valor_cobrar, 'idempotente', false);
END;
$$;

COMMENT ON FUNCTION public.exp_reenvio_abonar_diferenca(text, text) IS
  'Reenvio (2B + modo 18/11/2026): abona o valor a cobrar do ciclo (so is_admin/is_super_adm, motivo obrigatorio). Recusa se ha cobranca viva do ciclo. Grava no ciclo e no chat (Financeiro). Nao mexe em valor_total nem desconto.';

-- -----------------------------------------------------------------------------
-- 7. VEREDITO DO REDESPACHO (+ modo e valor a cobrar; a regra nao muda)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exp_reenvio_redespacho(
  p_id_int     bigint,
  p_cep        text,
  p_tipo_frete text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r          public.expedicao_reenvios%ROWTYPE;
  v_despacho   timestamptz;
  v_cep        text := nullif(regexp_replace(coalesce(p_cep, ''), '\D', '', 'g'), '');
  v_tipo       text := nullif(upper(btrim(coalesce(p_tipo_frete, ''))), '');
  v_decidido   boolean;
  v_saldo      jsonb;
  v_nota       jsonb;
  v_base       jsonb;
BEGIN
  SELECT * INTO v_r FROM public.expedicao_reenvios
   WHERE id_int = p_id_int ORDER BY ciclo DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('aberto', false, 'bloqueia', false, 'situacao', 'SEM_REENVIO');
  END IF;

  SELECT data_despacho INTO v_despacho FROM public.expedicoes WHERE id_int = p_id_int;
  IF v_despacho IS NOT NULL AND v_despacho > v_r.criado_em THEN
    RETURN jsonb_build_object('aberto', false, 'bloqueia', false, 'situacao', 'REENVIO_FECHADO', 'ciclo', v_r.ciclo);
  END IF;

  v_decidido := v_r.modalidade_frete = 'CIF' AND v_r.frete_origem IN ('COTACAO', 'DIGITADO_ADM');
  v_base := jsonb_build_object(
    'aberto', true,
    'ciclo', v_r.ciclo,
    'chave', v_r.chave,
    'criado_em', v_r.criado_em,
    'frete_decidido', v_decidido,
    'frete_anterior', v_r.frete_anterior,
    'frete_novo', v_r.frete_novo,
    'diferenca', v_r.diferenca,
    'modo_cobranca', v_r.modo_cobranca,
    'valor_cobrar', v_r.valor_cobrar,
    'abono', v_r.abono_valor,
    'exige_nota', v_r.exige_nota,
    'cep_reenvio', v_r.cep_novo,
    'tipo_reenvio', v_r.tipo_frete_novo);

  -- 1. o envio e o que o ciclo cotou
  IF v_decidido AND ((v_cep IS NOT NULL AND v_cep <> v_r.cep_novo) OR (v_tipo IS NOT NULL AND v_tipo <> v_r.tipo_frete_novo)) THEN
    RETURN v_base || jsonb_build_object('bloqueia', true, 'situacao', 'DIVERGE_DO_REENVIO',
      'mensagem', format('O reenvio %s cotou o frete para %s no CEP %s. Despache com o tipo de envio e o endereço do reenvio.',
        v_r.ciclo, v_r.tipo_frete_novo, v_r.cep_novo));
  END IF;

  -- 2. saldo (inclui o frete a cobrar do reenvio)
  v_saldo := public.exp_saldo_despacho(p_id_int);
  IF coalesce((v_saldo->>'bloqueia')::boolean, false) THEN
    RETURN v_base || jsonb_build_object('bloqueia', true, 'situacao', 'SALDO', 'saldo', v_saldo,
      'mensagem', coalesce(v_saldo->>'mensagem', 'Despacho bloqueado: o pedido tem saldo a receber.'));
  END IF;

  -- 3. nota nova quando o tipo de envio mudou
  IF v_r.exige_nota THEN
    SELECT n INTO v_nota FROM (
      SELECT jsonb_build_object('tipo', 'NF-e', 'numero', nf.numero_nf, 'em', nf.data_autorizacao) AS n, nf.data_autorizacao AS em
        FROM public.notas_fiscais nf
       WHERE nf.id_int = p_id_int
         AND upper(btrim(coalesce(nf.status, ''))) = 'AUTORIZADA'
         AND lower(btrim(coalesce(nf.ambiente, ''))) = 'producao'
         AND nf.data_cancelamento IS NULL
         AND nf.data_autorizacao > v_r.criado_em
      UNION ALL
      SELECT jsonb_build_object('tipo', 'NFS-e', 'numero', ns.numero_nfse, 'em', ns.created_at), ns.created_at
        FROM public.notas_servico ns
       WHERE ns.id_int = p_id_int
         AND upper(btrim(coalesce(ns.status, ''))) = 'AUTORIZADA'
         AND lower(btrim(coalesce(ns.ambiente, ''))) = 'producao'
         AND ns.data_cancelamento IS NULL
         AND ns.created_at > v_r.criado_em
    ) t ORDER BY em DESC LIMIT 1;
    IF v_nota IS NULL THEN
      RETURN v_base || jsonb_build_object('bloqueia', true, 'situacao', 'SEM_NOTA_NOVA',
        'mensagem', format('O reenvio %s trocou o tipo de envio (%s para %s) e exige nota nova: emita uma nota (NF-e de venda, de remessa ou NFS-e) depois de %s e despache em seguida.',
          v_r.ciclo, coalesce(v_r.tipo_frete_anterior, 'sem tipo'), v_r.tipo_frete_novo,
          to_char(v_r.criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')));
    END IF;
  END IF;

  RETURN v_base || jsonb_build_object('bloqueia', false, 'situacao', 'LIBERADO', 'nota_nova', v_nota);
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. TROCAR O MODO DE COBRANCA DE UM CICLO ABERTO (so administrador)
-- -----------------------------------------------------------------------------
-- So o ultimo ciclo, ainda nao redespachado (a mesma regra de "aberto" do
-- redespacho), sem cobranca viva nem paga e sem abono. Grava quem trocou, o
-- motivo e uma linha SISTEMA no chat (Financeiro).
CREATE FUNCTION public.exp_reenvio_trocar_modo(p_chave text, p_modo text, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_adm      boolean;
  v_nome     text;
  v_modo     text := upper(btrim(coalesce(p_modo, '')));
  v_motivo   text := btrim(coalesce(p_motivo, ''));
  v_r        public.expedicao_reenvios%ROWTYPE;
  v_ultimo   integer;
  v_despacho timestamptz;
  v_cob      public.pagamentos_v2%ROWTYPE;
  v_valor    numeric;
  v_cli      bigint;
  v_rotulo   text;
BEGIN
  SELECT coalesce(is_super_adm, false) OR coalesce(is_admin, false),
         coalesce(nullif(btrim(nome_usuario), ''), email)
    INTO v_adm, v_nome
    FROM public.usuarios WHERE user_id = v_uid;
  IF NOT coalesce(v_adm, false) THEN
    RAISE EXCEPTION 'EXP_REENVIO_MODO: somente administrador troca o modo de cobranca do frete do reenvio.' USING ERRCODE = 'P0001';
  END IF;
  IF v_modo NOT IN ('DIFERENCA', 'CHEIO', 'SEM_COBRANCA') THEN
    RAISE EXCEPTION 'EXP_REENVIO_MODO: modo "%" invalido (DIFERENCA, CHEIO ou SEM_COBRANCA).', p_modo USING ERRCODE = 'P0001';
  END IF;
  IF char_length(v_motivo) < 5 OR char_length(v_motivo) > 500 THEN
    RAISE EXCEPTION 'EXP_REENVIO_MODO: descreva o motivo da troca (5 a 500 caracteres).' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_r FROM public.expedicao_reenvios WHERE chave = p_chave FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXP_REENVIO_MODO: reenvio % nao encontrado.', coalesce(p_chave, 'vazio') USING ERRCODE = 'P0001';
  END IF;
  IF v_r.modo_cobranca = v_modo THEN
    RETURN jsonb_build_object('chave', v_r.chave, 'modo_cobranca', v_r.modo_cobranca, 'valor_cobrar', v_r.valor_cobrar, 'idempotente', true);
  END IF;

  SELECT max(ciclo) INTO v_ultimo FROM public.expedicao_reenvios WHERE id_int = v_r.id_int;
  IF v_r.ciclo <> v_ultimo THEN
    RAISE EXCEPTION 'EXP_REENVIO_MODO: so o ultimo reenvio do #% (o %) troca o modo de cobranca.', v_r.id_int, v_ultimo USING ERRCODE = 'P0001';
  END IF;
  SELECT data_despacho INTO v_despacho FROM public.expedicoes WHERE id_int = v_r.id_int;
  IF v_despacho IS NOT NULL AND v_despacho > v_r.criado_em THEN
    RAISE EXCEPTION 'EXP_REENVIO_MODO: o reenvio % ja foi redespachado; o modo de cobranca nao muda mais.', v_r.ciclo USING ERRCODE = 'P0001';
  END IF;
  IF v_r.abonado_em IS NOT NULL THEN
    RAISE EXCEPTION 'EXP_REENVIO_MODO: o frete do reenvio % ja foi abonado; o modo de cobranca nao muda mais.', v_r.ciclo USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_cob FROM public.pagamentos_v2
   WHERE chave_reenvio = v_r.chave AND status IS DISTINCT FROM 'CANCELADO'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'EXP_REENVIO_MODO: o frete do reenvio % ja tem a cobranca % (%). %',
      v_r.ciclo, coalesce(v_cob.id_pagamento, v_cob.id::text), v_cob.status,
      CASE WHEN v_cob.status = 'PAID' OR (v_cob.status = 'A_VENCER' AND v_cob.confirmado = true)
           THEN 'Ja foi paga; o modo nao muda.'
           ELSE 'Cancele a cobranca antes de trocar o modo.' END
      USING ERRCODE = 'P0001';
  END IF;

  IF v_modo = 'DIFERENCA' AND v_r.diferenca < 0 THEN
    RAISE EXCEPTION 'EXP_REENVIO_MODO: o frete novo (%) e menor que o anterior (%); o modo diferenca nao vale para este reenvio.',
      public.exp__reais(v_r.frete_novo), public.exp__reais(v_r.frete_anterior) USING ERRCODE = 'P0001';
  END IF;
  IF v_modo <> 'DIFERENCA' AND v_r.modalidade_frete = 'FOB' THEN
    RAISE EXCEPTION 'EXP_REENVIO_MODO: em FOB o reenvio nao cobra frete.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.expedicao_reenvios
     SET modo_cobranca = v_modo, modo_motivo = v_motivo,
         modo_definido_por = v_uid, modo_definido_por_nome = v_nome, modo_definido_em = now()
   WHERE id = v_r.id
  RETURNING valor_cobrar INTO v_valor;

  v_rotulo := CASE v_modo WHEN 'CHEIO' THEN 'frete cheio' WHEN 'SEM_COBRANCA' THEN 'sem cobrança' ELSE 'diferença' END;
  SELECT id_cliente INTO v_cli FROM public.propostas WHERE id_int = v_r.id_int;
  INSERT INTO public.propostas_chat (id_int, id_cliente, mensagem, tipo, autor_uid, autor_nome, setor, visivel_externo)
  VALUES (v_r.id_int, v_cli,
    format('Cobrança do frete do reenvio %s trocada de %s para %s por %s. Valor a cobrar: %s. Motivo: %s',
      v_r.ciclo,
      CASE v_r.modo_cobranca WHEN 'CHEIO' THEN 'frete cheio' WHEN 'SEM_COBRANCA' THEN 'sem cobrança' ELSE 'diferença' END,
      v_rotulo, coalesce(v_nome, 'Usuário'), public.exp__reais(v_valor), v_motivo),
    'SISTEMA', v_uid, v_nome, 'Financeiro', false);

  RETURN jsonb_build_object('chave', v_r.chave, 'modo_anterior', v_r.modo_cobranca, 'modo_cobranca', v_modo,
    'valor_cobrar', v_valor, 'idempotente', false);
END;
$$;

REVOKE ALL ON FUNCTION public.exp_reenvio_trocar_modo(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exp_reenvio_trocar_modo(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.exp_reenvio_trocar_modo(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exp_reenvio_trocar_modo(text, text, text) TO service_role;

COMMENT ON FUNCTION public.exp_reenvio_trocar_modo(text, text, text) IS
  'Reenvio (18/11/2026): troca o modo de cobranca do frete do ultimo ciclo ainda aberto (so is_admin/is_super_adm, motivo obrigatorio). Recusa com cobranca viva ou paga do ciclo, com abono, ou DIFERENCA com frete menor. Grava no ciclo e no chat (Financeiro).';

-- -----------------------------------------------------------------------------
-- CONFERENCIA (sem contagem em tabela viva)
-- -----------------------------------------------------------------------------
DO $confere$
BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.exp_saldo_despacho(bigint)'::regprocedure) NOT LIKE '%s.valor_cobrar%' THEN
    RAISE EXCEPTION 'exp_saldo_despacho sem o valor a cobrar do reenvio.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'exp_reenviar_pedido'
                AND pg_get_function_identity_arguments(p.oid) <> 'p_id_int bigint, p_ciclo integer, p_id_endereco_entrega uuid, p_tipo_frete text, p_motivo text, p_modalidade text, p_id_consulta bigint, p_id_opcao text, p_frete_digitado numeric, p_modo_cobranca text, p_motivo_cobranca text') THEN
    RAISE EXCEPTION 'sobrou uma assinatura antiga de exp_reenviar_pedido.';
  END IF;
  IF has_function_privilege('anon', 'public.exp_reenvio_trocar_modo(text, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.exp_reenviar_pedido(bigint, integer, uuid, text, text, text, bigint, text, numeric, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.exp_reenvio_cobrar_diferenca(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.exp_reenvio_abonar_diferenca(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon com EXECUTE numa funcao do reenvio.';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.expedicao_reenvios', 'valor_cobrar', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.expedicao_reenvios', 'modo_cobranca', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated sem leitura das colunas novas de expedicao_reenvios.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.expedicao_reenvios
              WHERE modo_cobranca <> 'DIFERENCA' OR valor_cobrar IS DISTINCT FROM diferenca) THEN
    RAISE EXCEPTION 'ciclo existente fora de DIFERENCA ou com valor_cobrar diferente da diferenca.';
  END IF;
END
$confere$;

-- =============================================================================
-- ROLLBACK (so com autorizacao; antes confira que nenhum ciclo saiu de
-- DIFERENCA: select count(*) from public.expedicao_reenvios where modo_cobranca <> 'DIFERENCA';)
--   1. drop function public.exp_reenvio_trocar_modo(text, text, text);
--   2. drop function public.exp_reenviar_pedido(bigint, integer, uuid, text, text, text, bigint, text, numeric, text, text);
--      e rodar de novo, de 20261118_exp_reenvio_fase2b_diferenca.sql, o CREATE
--      de exp_reenviar_pedido com os revoke/grant/comment dele;
--   3. rodar de novo, da mesma migration, os CREATE de exp_saldo_despacho,
--      exp_reenvio_cobrar_diferenca e exp_reenvio_abonar_diferenca (como
--      CREATE OR REPLACE) e o de exp_reenvio_situacao (CREATE OR REPLACE);
--      de 20261118b, o de exp_reenvio_redespacho (CREATE OR REPLACE);
--   4. alter table public.expedicao_reenvios
--        drop constraint expedicao_reenvios_abono_ate_valor_cobrar,
--        drop constraint expedicao_reenvios_fob_sem_cobranca,
--        drop constraint expedicao_reenvios_sem_cobranca_motivada,
--        drop constraint expedicao_reenvios_valor_cobrar_nao_negativo,
--        drop constraint expedicao_reenvios_diferenca_no_modo,
--        drop constraint expedicao_reenvios_modo_cobranca,
--        add constraint expedicao_reenvios_diferenca_nao_negativa check (diferenca >= 0),
--        add constraint expedicao_reenvios_abono_ate_diferenca check (abono_valor is null or (abono_valor > 0 and abono_valor <= diferenca)),
--        drop column valor_cobrar, drop column modo_definido_em, drop column modo_definido_por_nome,
--        drop column modo_definido_por, drop column modo_motivo, drop column modo_cobranca;
-- =============================================================================
