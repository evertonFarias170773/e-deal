-- mc_estornar_uso_pedido: estorno do uso de credito avulso de uma cobranca
-- E-CREDITO, com cancelamento da cobranca, numa transacao so.
--
-- Por que existe (23/10/2026, pedido 24191): nenhum caminho oficial desfazia
-- uma E-CREDITO paga. cancelar-pago recusa E-CREDITO (cancelar sem estornar
-- deixaria o credito consumido), e mc_ajuste_avulso_estornar so aceita AJUSTE
-- sem proposta — o uso (USO_PEDIDO) sempre tem proposta.
--
-- O que grava, e so isto:
--   1. movimento_credito: um CREDITO de compensacao (tipo_evento ESTORNO,
--      id_movimento_ref = o uso). Nenhuma linha existente e alterada.
--   2. pagamentos_v2: a cobranca vira CANCELADO, com motivo e autor no
--      motivo_cancela. O autor tambem fica no audit (actor do JWT).
--   3. propostas_chat: mensagem com o autor real (autor_uid).
-- O status da proposta NAO e escrito aqui: o gatilho de pagamentos_v2 recalcula
-- como em qualquer cancelamento (e nao mexe em status protegido, como
-- REVISAO ATENDENTE). A volta a NOVO e ato separado, pela rota propria.
--
-- Idempotente: o indice unico ux_mc_estorno_unico (id_movimento_ref WHERE
-- tipo_evento = 'ESTORNO') garante um estorno por uso. Repetir devolve o id do
-- estorno existente, sem gravar nada.
--
-- Travas (todas por condicao, nunca por contagem absoluta):
--   - so ADM (cc__assert_permissao '__ADMIN__') e no escopo da empresa;
--   - cobranca E-CREDITO, status PAID;
--   - exatamente um USO_PEDIDO avulso desta cobranca (id_pagamento_destino),
--     DEBITO, nao cancelado, mesmo cliente, mesma proposta e mesmo valor;
--   - proposta fora da producao: is_prd_aprovado = false, status anterior a
--     REVISAO PRODUCAO, sem linha em propostas_os_setores nem producao_volumes;
--   - sem expedicao (nenhuma linha em expedicoes);
--   - sem NF-e nem NFS-e AUTORIZADA de producao (mesma regra de
--     isNotaImpeditiva no app).
--
-- Permissao de execucao: o default do schema public para funcoes criadas por
-- postgres ja da EXECUTE so a postgres, authenticated e service_role (sem PUBLIC
-- e sem anon), igual a mc_usar_credito_avulso. Nenhum GRANT ou REVOKE aqui.

CREATE FUNCTION public.mc_estornar_uso_pedido(p_id_pagamento uuid, p_motivo text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_pag public.pagamentos_v2%ROWTYPE;
  v_uso public.movimento_credito%ROWTYPE;
  v_qtd_uso integer;
  v_estorno bigint;
  v_status_prop text;
  v_prd boolean;
  v_autor text;
  v_linhas integer;
BEGIN
  PERFORM public.cc__assert_permissao(v_uid, '__ADMIN__');

  IF p_id_pagamento IS NULL THEN
    RAISE EXCEPTION 'MC_PARAMS: id_pagamento é obrigatório';
  END IF;
  IF length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'MC_PARAMS: descreva o motivo do estorno (mínimo 5 caracteres)';
  END IF;

  -- 1. Cobranca, travada ate o fim da transacao.
  SELECT * INTO v_pag FROM public.pagamentos_v2 WHERE id = p_id_pagamento FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MC_NAOENCONTRADO: cobrança % não encontrada', p_id_pagamento;
  END IF;

  PERFORM public.cc__assert_escopo_empresa(v_uid, v_pag.id_int);

  IF upper(replace(btrim(coalesce(v_pag.tipo_cobranca, '')), '_', '-')) <> 'E-CREDITO' THEN
    RAISE EXCEPTION 'MC_TIPO: só cobrança E-CREDITO usa este estorno (esta é %)', coalesce(v_pag.tipo_cobranca, 'sem tipo');
  END IF;

  -- 2. O uso de credito desta cobranca: exatamente um.
  SELECT count(*) INTO v_qtd_uso
    FROM public.movimento_credito
   WHERE id_pagamento_destino = p_id_pagamento
     AND tipo_evento = 'USO_PEDIDO';
  IF v_qtd_uso <> 1 THEN
    RAISE EXCEPTION 'MC_USO: a cobrança % tem % uso(s) de crédito; o estorno exige exatamente um. Conferência manual.', v_pag.id_pagamento, v_qtd_uso;
  END IF;

  SELECT * INTO v_uso
    FROM public.movimento_credito
   WHERE id_pagamento_destino = p_id_pagamento
     AND tipo_evento = 'USO_PEDIDO'
     FOR UPDATE;

  -- 3. Repeticao: o estorno ja existe.
  SELECT id INTO v_estorno
    FROM public.movimento_credito
   WHERE id_movimento_ref = v_uso.id
     AND tipo_evento = 'ESTORNO';
  IF FOUND THEN
    IF v_pag.status = 'CANCELADO' THEN
      RETURN v_estorno;
    END IF;
    RAISE EXCEPTION 'MC_INCONSISTENTE: o uso #% já tem estorno (#%), mas a cobrança % está %. Conferência manual.', v_uso.id, v_estorno, v_pag.id_pagamento, v_pag.status;
  END IF;

  -- 4. Travas da cobranca e do uso.
  IF v_pag.status IS DISTINCT FROM 'PAID' THEN
    RAISE EXCEPTION 'MC_STATUS: a cobrança % está %; o estorno vale só para PAID', v_pag.id_pagamento, coalesce(v_pag.status, 'sem status');
  END IF;
  IF v_uso.cancelado THEN
    RAISE EXCEPTION 'MC_CANCELADO: o uso #% está marcado como cancelado (mecanismo legado). Conferência manual.', v_uso.id;
  END IF;
  IF upper(v_uso.tipo) <> 'DEBITO' THEN
    RAISE EXCEPTION 'MC_USO: o uso #% não é DEBITO', v_uso.id;
  END IF;
  IF v_uso.id_pendencia IS NOT NULL THEN
    RAISE EXCEPTION 'MC_ESCOPO: o uso #% veio de pendência; use o estorno da pendência (cc_encerrar_pendencia, modo ESTORNO)', v_uso.id;
  END IF;
  IF v_uso.id_cliente IS DISTINCT FROM v_pag.id_cliente::bigint
     OR v_uso.id_int IS DISTINCT FROM v_pag.id_int::bigint THEN
    RAISE EXCEPTION 'MC_DIVERGENTE: o uso #% não pertence ao mesmo cliente e proposta da cobrança %', v_uso.id, v_pag.id_pagamento;
  END IF;
  IF round(v_uso.valor, 2) <> round(v_pag.valor, 2) THEN
    RAISE EXCEPTION 'MC_VALOR: uso #% (R$ %) e cobrança % (R$ %) têm valores diferentes. Conferência manual.', v_uso.id, v_uso.valor, v_pag.id_pagamento, v_pag.valor;
  END IF;

  -- 5. Travas do pedido: fora da producao, sem expedicao, sem nota autorizada.
  SELECT upper(btrim(coalesce(status_interno, ''))), coalesce(is_prd_aprovado, false)
    INTO v_status_prop, v_prd
    FROM public.propostas
   WHERE id_int = v_pag.id_int
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MC_NAOENCONTRADO: proposta % não encontrada', v_pag.id_int;
  END IF;

  IF v_prd
     OR v_status_prop IN (
          'REVISAO PRODUCAO', 'EM PRODUCAO',
          'EM IMPRESSAO', 'EM IMPRESSAO / PENDENTE',
          'EM ACABAMENTO', 'EM ACABAMENTO / PENDENTE',
          'EXPEDICAO', 'A RETIRAR', 'EM TRANSITO', 'ENTREGUE', 'RECEBIDO')
     OR EXISTS (SELECT 1 FROM public.propostas_os_setores s WHERE s.id_int = v_pag.id_int)
     OR EXISTS (SELECT 1 FROM public.producao_volumes v WHERE v.id_int = v_pag.id_int) THEN
    RAISE EXCEPTION 'MC_PRODUCAO: a proposta % já entrou na produção (status %); retire-a da produção antes', v_pag.id_int, v_status_prop;
  END IF;

  IF EXISTS (SELECT 1 FROM public.expedicoes e WHERE e.id_int = v_pag.id_int) THEN
    RAISE EXCEPTION 'MC_EXPEDICAO: a proposta % tem expedição registrada', v_pag.id_int;
  END IF;

  IF EXISTS (SELECT 1 FROM public.notas_fiscais n
              WHERE n.id_int = v_pag.id_int
                AND upper(btrim(coalesce(n.status, ''))) = 'AUTORIZADA'
                AND upper(btrim(coalesce(n.ambiente, ''))) = 'PRODUCAO')
     OR EXISTS (SELECT 1 FROM public.notas_servico n
              WHERE n.id_int = v_pag.id_int
                AND upper(btrim(coalesce(n.status, ''))) = 'AUTORIZADA'
                AND upper(btrim(coalesce(n.ambiente, ''))) = 'PRODUCAO') THEN
    RAISE EXCEPTION 'MC_NOTA: a proposta % tem nota fiscal autorizada', v_pag.id_int;
  END IF;

  SELECT coalesce(nullif(btrim(nome_usuario), ''), 'Usuário')
    INTO v_autor
    FROM public.usuarios
   WHERE user_id = v_uid;

  -- 6. Escritas.
  INSERT INTO public.movimento_credito (
    id_cliente, id_int, valor, tipo, origem, observacao, created_by,
    tipo_evento, id_int_origem, id_movimento_ref, motivo_evento
  ) VALUES (
    v_uso.id_cliente, v_uso.id_int, v_uso.valor, 'CREDITO', 'MANUAL',
    format('Estorno do uso de crédito #%s (cobrança %s): %s', v_uso.id, v_pag.id_pagamento, v_motivo),
    v_uid, 'ESTORNO', v_uso.id_int, v_uso.id, 'ESTORNO_USO_PEDIDO'
  )
  RETURNING id INTO v_estorno;

  UPDATE public.pagamentos_v2
     SET status = 'CANCELADO',
         motivo_cancela = format('Estorno do uso de crédito #%s (movimento #%s) por %s: %s', v_uso.id, v_estorno, v_autor, v_motivo)
   WHERE id = p_id_pagamento
     AND status = 'PAID';
  GET DIAGNOSTICS v_linhas = ROW_COUNT;
  IF v_linhas <> 1 THEN
    RAISE EXCEPTION 'MC_CONCORRENCIA: a cobrança % mudou durante o estorno', v_pag.id_pagamento;
  END IF;

  INSERT INTO public.propostas_chat (id_int, id_cliente, mensagem, tipo, autor_uid, autor_nome, setor, visivel_externo)
  VALUES (
    v_pag.id_int, v_pag.id_cliente,
    format('Cobrança %s (E-CREDITO, R$ %s) cancelada por %s, com estorno do uso de crédito #%s: o valor voltou ao saldo do cliente (movimento #%s). Motivo: %s',
           v_pag.id_pagamento, to_char(v_pag.valor, 'FM999999990.00'), v_autor, v_uso.id, v_estorno, v_motivo),
    'SISTEMA', v_uid, v_autor, 'Financeiro', false
  );

  RETURN v_estorno;
END;
$function$;

COMMENT ON FUNCTION public.mc_estornar_uso_pedido(uuid, text) IS
  'Estorna o uso de crédito avulso de uma cobrança E-CREDITO paga (CREDITO de compensação referenciando o USO_PEDIDO) e cancela a cobrança. Só ADM; pedido fora da produção, sem expedição e sem nota autorizada. Idempotente por ux_mc_estorno_unico.';
