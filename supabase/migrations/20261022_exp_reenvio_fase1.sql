-- =============================================================================
-- 20261022_exp_reenvio_fase1
--
-- REENVIO, FASE 1 (22/10/2026).
--
-- Pedido devolvido pela transportadora (EM TRANSITO) volta a EXPEDICAO para ser
-- reexpedido, sem passar por Arte nem Producao, com endereco e/ou tipo de envio
-- novos, DESDE QUE nao haja diferenca de valor de frete. Diferenca de frete
-- (cobranca, abono, devolucao) e a fase 2.
--
-- OBJETOS NOVOS, nenhum existente alterado:
--   - public.expedicao_reenvios: uma linha por ciclo de reenvio, imutavel pelo
--     PostgREST (RLS ligado, so politica de leitura). Guarda o motivo, o autor
--     (da sessao, no banco), endereco e tipo de envio novos, quem paga, o
--     veredito do frete e a COPIA INTEIRA da linha de `expedicoes` antes do
--     reenvio (`envio_anterior`). E essa copia que preserva o primeiro envio:
--     `expedicoes` tem uma linha por pedido e o proximo Despachar sobrescreve
--     data, rastreio e conhecimento.
--   - public.exp_reenviar_pedido(...): SECURITY DEFINER, permissao
--     `expedicao.reenvio`, FOR UPDATE em propostas e expedicoes, chave
--     idempotente REENVIO:<id_int>:<ciclo>.
--
-- O QUE A RPC GRAVA (e so isto):
--   1. a linha nova em expedicao_reenvios;
--   2. expedicoes: id_endereco_entrega e tipo_frete novos (e, se o tipo mudou,
--      transportadora_nome, id_transportadora_cliente e categoria_frete
--      voltam a nulo, para o Despachar pedir de novo);
--   3. propostas.status_interno: EM TRANSITO -> EXPEDICAO (sem status novo);
--   4. os_status_log: a transicao, com motivo e autor (origem EXPEDICAO_REENVIO,
--      tipo RETORNO).
--
-- `data_despacho` FICA. Depois do despacho vale o endereco gravado em
-- `expedicoes` (lib/endereco-entrega.ts), e e isso que faz o endereco novo
-- valer na etiqueta, na prepostagem, na declaracao e na tela. O reenvio fica
-- "aberto" enquanto `expedicoes.data_despacho` for a mesma copiada em
-- `data_despacho_anterior`; o proximo Despachar grava data nova e o fecha.
-- Nenhum trigger novo.
--
-- FRETE: com CIF e CEP ou tipo de envio diferentes do envio anterior, o
-- veredito e o de `exp_trava_frete_despacho` (so leitura, nao consome
-- liberacao). Passa so SEM_DIVERGENCIA, ou DENTRO_DO_LIMITE com diferenca
-- zero. Qualquer outro caso (recotar, valor diferente, liberacao de ADM, sem
-- cotacao) e recusado: a diferenca de frete e a fase 2. Troca de quem paga
-- (RETIRA/FOB/CIF) e recusada. Em FOB o frete nao e da empresa.
--
-- NAO MEXE em cotacao_frete, valor_total, NF, Conta Corrente, pagamentos_v2,
-- check_and_promote_proposta, arte, producao, engine de status, trava de saldo
-- nem trava de frete. Nao concede a permissao a nenhum perfil.
--
-- TRAVA DE APLICACAO: os nomes novos nao podem existir, e a funcao do frete
-- que a RPC le precisa bater com o md5 lido no mapeamento de 22/10/2026 (o
-- contrato `situacao`/`diferenca` vem dela).
-- =============================================================================

SET LOCAL lock_timeout = '8s';

DO $trava$
DECLARE
  v_md5 text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname = 'expedicao_reenvios')
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'exp_reenviar_pedido') THEN
    RAISE EXCEPTION 'expedicao_reenvios ou exp_reenviar_pedido ja existem. Nada aplicado.';
  END IF;

  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'exp_trava_frete_despacho'
     AND pg_get_function_identity_arguments(p.oid) = 'p_id_int bigint, p_cep_destino text, p_tipo_frete text, p_modalidade text';
  IF v_md5 IS DISTINCT FROM 'e1936809e7ebb7a5e57e70dcfdcc688a' THEN
    RAISE EXCEPTION 'exp_trava_frete_despacho mudou desde o mapeamento (md5 %). Nada aplicado.', v_md5;
  END IF;
END
$trava$;

-- -----------------------------------------------------------------------------
-- 1. O registro do reenvio
-- -----------------------------------------------------------------------------
-- Sem FK para propostas/expedicoes de proposito: o registro e historico e nao
-- pode travar nem sumir com exclusao de pedido de teste. Quem escreve e so a
-- RPC, que confere o pedido antes.
CREATE TABLE public.expedicao_reenvios (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_int                  integer     NOT NULL,
  ciclo                   integer     NOT NULL CHECK (ciclo >= 1),
  chave                   text        NOT NULL,
  motivo                  text        NOT NULL CHECK (char_length(btrim(motivo)) BETWEEN 3 AND 500),
  autor_uid               uuid        NOT NULL,
  autor_nome              text,
  criado_em               timestamptz NOT NULL DEFAULT now(),
  status_anterior         text        NOT NULL,
  modalidade_frete        text        NOT NULL CHECK (modalidade_frete IN ('FOB', 'CIF')),
  id_endereco_anterior    uuid,
  id_endereco_novo        uuid        NOT NULL,
  cep_anterior            text,
  cep_novo                text        NOT NULL,
  tipo_frete_anterior     text,
  tipo_frete_novo         text        NOT NULL CHECK (tipo_frete_novo IN ('CORREIOS', 'MOTOBOY', 'TRANSPORTADORA')),
  data_despacho_anterior  timestamptz NOT NULL,
  veredito_frete          jsonb,
  envio_anterior          jsonb       NOT NULL,
  CONSTRAINT expedicao_reenvios_chave_formato CHECK (chave = 'REENVIO:' || id_int || ':' || ciclo),
  CONSTRAINT expedicao_reenvios_chave_key UNIQUE (chave),
  CONSTRAINT expedicao_reenvios_ciclo_key UNIQUE (id_int, ciclo)
);

COMMENT ON TABLE public.expedicao_reenvios IS
  'Reenvio de pedido devolvido (fase 1, 22/10/2026): uma linha por ciclo, gravada so por exp_reenviar_pedido. envio_anterior e a copia da linha de expedicoes antes do reenvio. Aberto enquanto expedicoes.data_despacho = data_despacho_anterior.';

-- RLS ligado e so leitura: escrita pelo PostgREST nao passa (sem politica de
-- escrita). A RPC escreve como dona (SECURITY DEFINER).
ALTER TABLE public.expedicao_reenvios ENABLE ROW LEVEL SECURITY;

CREATE POLICY expedicao_reenvios_select_authenticated
  ON public.expedicao_reenvios FOR SELECT TO authenticated USING (true);

-- -----------------------------------------------------------------------------
-- 2. A RPC do reenvio
-- -----------------------------------------------------------------------------
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
  'Reenvio fase 1: EM TRANSITO -> EXPEDICAO com endereco/tipo novos, sem diferenca de frete. Permissao expedicao.reenvio; chave REENVIO:<id_int>:<ciclo>; grava expedicao_reenvios, expedicoes (endereco/tipo), propostas.status_interno e os_status_log.';

REVOKE ALL ON FUNCTION public.exp_reenviar_pedido(bigint, integer, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_reenviar_pedido(bigint, integer, uuid, text, text, text) TO authenticated, service_role;
