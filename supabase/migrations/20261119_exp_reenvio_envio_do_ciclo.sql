-- =============================================================================
-- 20261119_exp_reenvio_envio_do_ciclo
--
-- REENVIO: O ENVIO E O DO CICLO (19/11/2026, caso #24552).
--
-- O #24552 foi reenviado pela Transportadora Sao Miguel e o card e o Despachar
-- continuaram em SEDEX: o reenvio zerava a transportadora em expedicoes, a tela
-- caia na transportadora da PROPOSTA (o frete da venda) e o "Salvar antes de
-- gerar a etiqueta" gravou SEDEX/CORREIOS de volta; o rastreio do envio que
-- voltou (AE116583457BR) seguia pre-preenchido.
--
-- O QUE MUDA: so o UPDATE de expedicoes dentro de exp_reenviar_pedido (mesma
-- assinatura, mesmos GRANTs, resto da funcao identico ao da 20261118c):
--   - com opcao cotada, grava a transportadora da opcao;
--   - envio mudado (tipo ou opcao): vinculo e categoria vazios (a tela deriva
--     do ciclo e o Despachar grava);
--   - limpa codigo_rastreamento (o do envio que voltou fica em envio_anterior).
-- A prepostagem antiga (correios_*) continua registrada.
--
-- A tela (card, Despachar) passa a ler o envio do ciclo aberto, e a rota da
-- prepostagem dos Correios recusa reenvio aberto de outro tipo (codigo).
--
-- NAO MEXE em propostas, cotacao_frete, NF, gatilhos de frete, saldo, cobranca
-- nem em ciclos ja gravados.
-- =============================================================================

SET LOCAL lock_timeout = '8s';

-- TRAVA: a funcao tem de estar como a 20261118c deixou.
DO $trava$
DECLARE v_md5 text;
BEGIN
  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'exp_reenviar_pedido'
     AND pg_get_function_identity_arguments(p.oid) = 'p_id_int bigint, p_ciclo integer, p_id_endereco_entrega uuid, p_tipo_frete text, p_motivo text, p_modalidade text, p_id_consulta bigint, p_id_opcao text, p_frete_digitado numeric, p_modo_cobranca text, p_motivo_cobranca text';
  IF v_md5 IS DISTINCT FROM '47f9c71fe8b1b96b82e3e37a6b102b68' THEN
    RAISE EXCEPTION 'exp_reenviar_pedido mudou desde 20261118c (md5 %). Nada aplicado.', v_md5;
  END IF;
END
$trava$;

CREATE OR REPLACE FUNCTION public.exp_reenviar_pedido(
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

  -- 19/11/2026 (caso #24552): o envio passa a ser o do CICLO. Com opcao cotada,
  -- a transportadora e a dela; tipo trocado sem opcao, vazio. Vinculo e
  -- categoria ficam vazios quando o envio muda: a tela os deriva da opcao
  -- (resolverTransportadoraParceira / categoriaDoServico) e o Despachar grava.
  -- O rastreio do envio que voltou nao vale para o novo: sai daqui (a copia
  -- fica em envio_anterior). A prepostagem antiga continua registrada
  -- (correios_*), porque o objeto ainda precisa ser cancelado no portal.
  UPDATE public.expedicoes
     SET id_endereco_entrega       = p_id_endereco_entrega,
         tipo_frete                = v_tipo_novo,
         transportadora_nome       = CASE
                                       WHEN v_opcao IS NOT NULL THEN coalesce(nullif(btrim(v_opcao->>'transportadora'), ''), nullif(btrim(v_opcao->>'servico'), ''))
                                       WHEN v_tipo_mudou THEN NULL
                                       ELSE transportadora_nome
                                     END,
         id_transportadora_cliente = CASE WHEN v_tipo_mudou OR v_opcao IS NOT NULL THEN NULL ELSE id_transportadora_cliente END,
         categoria_frete           = CASE WHEN v_tipo_mudou OR v_opcao IS NOT NULL THEN NULL ELSE categoria_frete END,
         codigo_rastreamento       = NULL,
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

-- CONFERENCIA
DO $confere$
BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.exp_reenviar_pedido(bigint, integer, uuid, text, text, text, bigint, text, numeric, text, text)'::regprocedure)
     NOT LIKE '%codigo_rastreamento       = NULL%' THEN
    RAISE EXCEPTION 'exp_reenviar_pedido sem a limpeza do rastreio.';
  END IF;
  IF has_function_privilege('anon', 'public.exp_reenviar_pedido(bigint, integer, uuid, text, text, text, bigint, text, numeric, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon com EXECUTE em exp_reenviar_pedido.';
  END IF;
END
$confere$;

-- =============================================================================
-- ROLLBACK (so com autorizacao): rodar de novo, de 20261118c_exp_reenvio_modo_cobranca.sql,
-- o CREATE de exp_reenviar_pedido como CREATE OR REPLACE (md5 47f9c71fe8b1b96b82e3e37a6b102b68).
-- =============================================================================
