-- mc_usar_credito_avulso: passa id_int (proposta) ao checar escopo, nao id_empresa
--
-- PROBLEMA
--   `cc__assert_escopo_empresa(p_uid uuid, p_id_int bigint)` recebe o ID DA
--   PROPOSTA. Ela mesma resolve a empresa da proposta internamente, via
--   `cc__id_empresa_proposta(p_id_int)`, e compara com a empresa do usuario.
--
--   `mc_usar_credito_avulso` chamava:
--
--     PERFORM public.cc__assert_escopo_empresa(v_uid, v_pag.id_empresa);
--
--   ou seja, entregava um ID DE EMPRESA (1, 2, 3...) no lugar de um ID DE
--   PROPOSTA. Os dois sao bigint, entao o Postgres aceita sem reclamar — o
--   erro so aparece em execucao, e disfarcado.
--
--   Consequencia: a funcao ia procurar a proposta de `id_int = 1`, que nao
--   existe. `cc__id_empresa_proposta(1)` devolve NULL, e o NULL cai direto no
--   ramo de negacao:
--
--     PERM: proposta #1 fora do escopo de empresa do usuario
--
--   O "#1" da mensagem nao era proposta nenhuma: era o id_empresa vazando
--   como se fosse id_int. Pista boa — foi o que denunciou a troca.
--
--   Isso NAO dependia da empresa do usuario: falhava sempre, para qualquer
--   nao superadmin (superadmin retorna antes da checagem). Credito avulso
--   estava integralmente bloqueado para vendedor.
--
-- EVIDENCIA DE QUE E TROCA DE ARGUMENTO, E NAO REGRA INTENCIONAL
--   Os outros 9 pontos de chamada de `cc__assert_escopo_empresa` no schema
--   passam id_int — `cc_abrir_pendencia` (p_id_int), `cc_encerrar_pendencia`
--   (v_p.id_int, v_cred.id_int) e `cc_usar_pendencia` (v_p.id_int).
--   `mc_usar_credito_avulso` era o unico fora do padrao.
--
-- CORRECAO
--   Passar `v_pag.id_int` — a proposta do proprio pagamento. Coerente com
--   `cc_usar_pendencia`, que faz exatamente isso.
--
--   O RESTO DA FUNCAO E BYTE A BYTE O MESMO. Nenhuma guarda foi removida:
--   idempotencia por `movimento_credito`, bloqueio de pagamento CANCELADO,
--   divergencia de cliente, divergencia de proposta de destino, coerencia
--   entre `pagamentos_v2.id_empresa` e a empresa da proposta, trava do
--   cliente e recalculo do saldo sob trava continuam iguais. A regra de
--   escopo tambem nao muda: continua sendo "empresa do usuario tem de bater
--   com a empresa da proposta" — ela so passa a receber a proposta certa
--   para avaliar.

CREATE OR REPLACE FUNCTION public.mc_usar_credito_avulso(p_id_cliente bigint, p_valor numeric, p_id_pagamento uuid, p_id_int_destino bigint DEFAULT NULL::bigint, p_observacao text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_valor numeric;
  v_saldo numeric;
  v_pag public.pagamentos_v2%ROWTYPE;
  v_existente bigint;
  v_new_id bigint;
BEGIN
  PERFORM public.cc__assert_permissao(v_uid, 'credito.usar');

  IF p_id_cliente IS NULL
     OR p_valor IS NULL
     OR p_id_pagamento IS NULL THEN
    RAISE EXCEPTION
      'MC_PARAMS: id_cliente, valor e id_pagamento são obrigatórios';
  END IF;

  v_valor := round(p_valor, 2);

  IF v_valor < 0.01 THEN
    RAISE EXCEPTION
      'CC_VALOR_MINIMO: uso mínimo é R$ 0,01';
  END IF;

  SELECT *
    INTO v_pag
  FROM public.pagamentos_v2
  WHERE id = p_id_pagamento
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'CC_COBRANCA: pagamento % não encontrado',
      p_id_pagamento;
  END IF;

  SELECT id
    INTO v_existente
  FROM public.movimento_credito
  WHERE id_pagamento_destino = p_id_pagamento
    AND tipo_evento = 'USO_PEDIDO'
    AND id_pendencia IS NULL
  LIMIT 1;

  IF FOUND THEN
    RETURN v_existente;
  END IF;

  IF v_pag.status = 'CANCELADO' THEN
    RAISE EXCEPTION
      'CC_COBRANCA_CANCELADA: pagamento % está cancelado',
      p_id_pagamento;
  END IF;

  -- id_int (proposta), NAO id_empresa: cc__assert_escopo_empresa espera o id
  -- da proposta e deriva a empresa dela por conta propria.
  PERFORM public.cc__assert_escopo_empresa(
    v_uid,
    v_pag.id_int
  );

  IF v_pag.id_cliente IS DISTINCT FROM p_id_cliente THEN
    RAISE EXCEPTION
      'CC_CLIENTE_DIVERGENTE: pagamento % pertence a outro cliente',
      p_id_pagamento;
  END IF;

  IF p_id_int_destino IS NOT NULL
     AND v_pag.id_int IS DISTINCT FROM p_id_int_destino THEN
    RAISE EXCEPTION
      'CC_PROPOSTA_DIVERGENTE: pagamento % não pertence à proposta de destino informada',
      p_id_pagamento;
  END IF;

  IF v_pag.id_empresa IS NOT NULL
     AND v_pag.id_empresa <> public.cc__id_empresa_proposta(v_pag.id_int) THEN
    RAISE EXCEPTION
      'CC_EMPRESA_DIVERGENTE: pagamento % pertence a outra empresa',
      p_id_pagamento;
  END IF;

  PERFORM 1
  FROM public.clientes
  WHERE id_cliente = p_id_cliente
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'MC_CLIENTE: cliente % não encontrado',
      p_id_cliente;
  END IF;

  SELECT COALESCE(
    SUM(
      CASE
        WHEN tipo = 'CREDITO' THEN valor
        WHEN tipo = 'DEBITO' THEN -valor
        ELSE 0
      END
    ),
    0
  )
  INTO v_saldo
  FROM public.movimento_credito
  WHERE id_cliente = p_id_cliente
    AND cancelado = false;

  IF v_saldo < v_valor THEN
    RAISE EXCEPTION
      'CC_SALDO_INSUFICIENTE: saldo R$ % < solicitado R$ %',
      GREATEST(v_saldo, 0),
      v_valor;
  END IF;

  INSERT INTO public.movimento_credito (
    id_cliente,
    id_int,
    valor,
    tipo,
    origem,
    observacao,
    created_by,
    tipo_evento,
    id_int_destino,
    id_pagamento_destino,
    motivo_evento
  )
  VALUES (
    p_id_cliente,
    v_pag.id_int,
    v_valor,
    'DEBITO',
    'SISTEMA',
    COALESCE(
      p_observacao,
      'Crédito avulso aplicado como pagamento.'
    ),
    v_uid,
    'USO_PEDIDO',
    v_pag.id_int,
    p_id_pagamento,
    'USO_CREDITO_AVULSO'
  )
  RETURNING id INTO v_new_id;

  PERFORM public.cc__timeline(
    v_pag.id_int,
    p_id_cliente,
    format(
      '💰 Crédito avulso de R$ %s aplicado como pagamento.',
      to_char(v_valor, 'FM999999990.00')
    ),
    v_uid
  );

  RETURN v_new_id;
END;
$function$;
