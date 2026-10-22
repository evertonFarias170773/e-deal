-- =============================================================================
-- 20261022_exp_reenvio_fase2a_fundacao
--
-- REENVIO, FASE 2A: FUNDACAO FINANCEIRA (22/10/2026).
--
-- A diferenca de frete do reenvio sera (na 2B) uma cobranca nova em
-- pagamentos_v2, no mesmo pedido, sem tocar em valor_total, cotacao_frete nem
-- NF. Antes disso, duas coisas precisam estar no lugar:
--
--   1. MARCADOR. Coluna pagamentos_v2.chave_reenvio = 'REENVIO:<id_int>:<ciclo>',
--      a mesma chave de expedicao_reenvios (FK). Unica entre as cobrancas nao
--      canceladas (idempotencia: uma cobranca viva por ciclo de reenvio).
--      So nasce no INSERT e nunca muda depois. O navegador (authenticated)
--      tem GRANT por COLUNA em pagamentos_v2 (59 de 64 colunas, conferido em
--      22/10/2026) e a coluna nova nasce sem GRANT: ele nem consegue escrever
--      nela. O gatilho trg_pgv2_reenvio_marcador e a segunda camada (recusa
--      authenticated/anon se um dia a coluna ganhar GRANT) e a da
--      imutabilidade (vale para todos). Marca so por funcao do banco
--      (SECURITY DEFINER) ou service_role. Sem isso, marcar uma cobranca
--      comum como reenvio a tiraria do pago e fabricaria saldo.
--
--   2. CONTAS. cc__valor_pago passa a ignorar a cobranca marcada. Com isso,
--      sem mexer em mais nada, ela fica fora de: exp_saldo_despacho (e da
--      trava do despacho e do reenvio), cc_abrir_pendencia (nao abre credito
--      FAVOR_CLIENTE falso), criar_pedido_complementar,
--      complementar_aplicar_frete e exp_aplicar_recotacao.
--      cc__total_soberano_proposta nao le pagamentos_v2: nao muda.
--
--   3. PROMOCAO. check_and_promote_proposta ganha ENTREGUE na lista de status
--      protegidos (a mesma lista de atualizar_status_financeiro_proposta; era
--      o unico que faltava) e deixa de contar a cobranca do reenvio. Corrige
--      o caminho do 22714: arte reaprovada (ou cobranca confirmada) em pedido
--      ENTREGUE nao o devolve a REVISAO ATENDENTE.
--
-- PEDIDO SEM REENVIO: chave_reenvio nula em todas as cobrancas -> as duas
-- funcoes alteradas devolvem exatamente o mesmo de antes (o filtro novo e
-- sempre verdadeiro). A unica mudanca de comportamento sem reenvio e a do item
-- 3: pedido ENTREGUE nao e mais promovido.
--
-- NAO MEXE em RLS, GRANT de tabela, valor_total, cotacao_frete, NF, trava de
-- saldo, trava de frete, exp_reenviar_pedido, exp_saldo_despacho,
-- cc_abrir_pendencia, cc__total_soberano_proposta, LIBERADO nem entrada na
-- producao. Nao cria cobranca, abono nem devolucao (2B). Nao corrige pedido
-- existente.
--
-- TRAVA DE APLICACAO: as funcoes alteradas e as lidas (que dependem do
-- resultado) tem de bater com o md5 do mapeamento de 22/10/2026
-- (md5 de prosrc sem CR, como nas migrations anteriores). Sem contagem em
-- tabela viva.
-- =============================================================================

SET LOCAL lock_timeout = '8s';

DO $trava$
DECLARE
  v_md5 text;
  v_esperado record;
BEGIN
  FOR v_esperado IN
    SELECT * FROM (VALUES
      -- alteradas aqui
      ('cc__valor_pago',                      'p_id_int bigint',  '09d4cc275f1872cdb4adc72c8bdfcbb3'),
      ('check_and_promote_proposta',          'p_id_int integer', '9e20586a5d0983fc6096c6929e491326'),
      -- lidas, nao alteradas (o resultado delas muda so pela cc__valor_pago)
      ('exp_saldo_despacho',                  'p_id_int bigint',  '8b42e75bf2366c1ed220b49e3198e72f'),
      ('cc_abrir_pendencia',                  'p_id_int bigint, p_id_cliente bigint, p_chave_evento uuid, p_motivo text, p_total_soberano numeric, p_observacao text', 'f84a6ab657a1bd5cb0a7c162f89cc736'),
      ('cc__total_soberano_proposta',         'p_id_int bigint',  'cfc3c430c8602fc9dca2064b30afaedc'),
      ('trg_sync_financeiro_to_proposta_func', '',                '1f092b8033fd7fd4549ac7bb4075827b')
    ) AS t(nome, args, md5)
  LOOP
    SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_md5
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_esperado.nome
       AND pg_get_function_identity_arguments(p.oid) = v_esperado.args;
    IF v_md5 IS DISTINCT FROM v_esperado.md5 THEN
      RAISE EXCEPTION '% mudou desde o mapeamento (md5 %, esperado %). Nada aplicado.',
        v_esperado.nome, v_md5, v_esperado.md5;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.pagamentos_v2'::regclass
                AND attname = 'chave_reenvio' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'pagamentos_v2.chave_reenvio ja existe. Nada aplicado.';
  END IF;
END
$trava$;

-- -----------------------------------------------------------------------------
-- 1. MARCADOR
-- -----------------------------------------------------------------------------
-- Coluna nula, sem default: so metadado, sem reescrever a tabela.
ALTER TABLE public.pagamentos_v2 ADD COLUMN chave_reenvio text;

COMMENT ON COLUMN public.pagamentos_v2.chave_reenvio IS
  'REENVIO:<id_int>:<ciclo> (expedicao_reenvios.chave). Cobranca da diferenca de frete do reenvio: fora do pago da proposta (cc__valor_pago). Nasce no INSERT por funcao do banco ou service_role e nunca muda.';

ALTER TABLE public.pagamentos_v2
  ADD CONSTRAINT pagamentos_v2_chave_reenvio_fkey
  FOREIGN KEY (chave_reenvio) REFERENCES public.expedicao_reenvios (chave);

-- O reenvio e do MESMO pedido da cobranca.
ALTER TABLE public.pagamentos_v2
  ADD CONSTRAINT pagamentos_v2_chave_reenvio_do_pedido
  CHECK (chave_reenvio IS NULL OR split_part(chave_reenvio, ':', 2) = id_int::text);

-- Idempotencia: uma cobranca viva por ciclo. Cancelada libera a chave para a
-- proxima (PIX vencido, boleto refeito).
CREATE UNIQUE INDEX pagamentos_v2_chave_reenvio_viva_uk
  ON public.pagamentos_v2 (chave_reenvio)
  WHERE chave_reenvio IS NOT NULL AND status IS DISTINCT FROM 'CANCELADO';

CREATE FUNCTION public.fn_pgv2_reenvio_marcador()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.chave_reenvio IS DISTINCT FROM OLD.chave_reenvio THEN
      RAISE EXCEPTION 'PGV2_REENVIO_IMUTAVEL: a marca de reenvio da cobranca % nasce com ela e nao pode ser incluida, trocada nem removida.', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT: o navegador grava pagamentos_v2 direto (authenticated). Por ali a
  -- marca nunca entra; so funcao do banco (current_user = dono) ou service_role.
  IF NEW.chave_reenvio IS NOT NULL AND current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'PGV2_REENVIO_SO_PELO_BANCO: cobranca de reenvio so e criada pelo fluxo do reenvio.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_pgv2_reenvio_marcador() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_pgv2_reenvio_marcador() FROM anon;
REVOKE ALL ON FUNCTION public.fn_pgv2_reenvio_marcador() FROM authenticated;

CREATE TRIGGER trg_pgv2_reenvio_marcador
  BEFORE INSERT OR UPDATE OF chave_reenvio ON public.pagamentos_v2
  FOR EACH ROW EXECUTE FUNCTION public.fn_pgv2_reenvio_marcador();

-- -----------------------------------------------------------------------------
-- 2. PAGO DA PROPOSTA (mesma assinatura, mesmos GRANTs; so a ultima linha nova)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cc__valor_pago(p_id_int bigint)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(round(SUM(
    GREATEST(0, COALESCE(valor,0) - COALESCE(
      (regexp_match(COALESCE(obs_v2,''), '\[ABATIMENTO_DEBITO:(\d+(?:\.\d{1,2})?)\]'))[1]::numeric, 0)))
  , 2), 0)
  FROM public.pagamentos_v2
  WHERE id_int = p_id_int
    AND status <> 'CANCELADO'
    AND (status = 'PAID' OR (status = 'A_VENCER' AND confirmado = true))
    -- Reenvio fase 2A (22/10/2026): a diferenca de frete do reenvio nao e
    -- pagamento da proposta.
    AND chave_reenvio IS NULL;
$function$;

-- -----------------------------------------------------------------------------
-- 3. PROMOCAO (mesma assinatura, mesmos GRANTs)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_and_promote_proposta(p_id_int integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_is_avulso boolean;
    v_pagamentos_total integer;
    v_pagamentos_confirmados integer;
    v_arte_status text;
    v_itens_total integer;
    v_itens_prateleira integer;
    v_arte_dispensada boolean;
BEGIN
    IF p_id_int IS NULL THEN
        RETURN;
    END IF;

    SELECT COALESCE(is_avulso, false)
    INTO v_is_avulso
    FROM public.propostas
    WHERE id_int = p_id_int;

    IF COALESCE(v_is_avulso, false) = true THEN
        RETURN;
    END IF;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (
            WHERE COALESCE(UPPER(status), '') IN ('PAID', 'A_VENCER')
              AND COALESCE(confirmado, false) = true
        )
    INTO
        v_pagamentos_total,
        v_pagamentos_confirmados
    FROM public.pagamentos_v2
    WHERE id_int = p_id_int
      AND COALESCE(UPPER(status), '') NOT IN ('CANCELADO', 'CANCELADA')
      -- Reenvio fase 2A (22/10/2026): a cobranca do frete do reenvio nao
      -- conta para a promocao (nem libera, nem segura).
      AND chave_reenvio IS NULL;

    SELECT COALESCE(UPPER(status), '')
    INTO v_arte_status
    FROM public.pedidos_artes
    WHERE id_int = p_id_int
    ORDER BY created_at DESC
    LIMIT 1;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE is_estoque IS TRUE)
    INTO
        v_itens_total,
        v_itens_prateleira
    FROM public.produtos_proposta
    WHERE id_int = p_id_int
      AND COALESCE(UPPER(status_item), '') <> 'CANCELADO';

    v_arte_dispensada := v_itens_total > 0 AND v_itens_total = v_itens_prateleira;

    IF v_pagamentos_total > 0
       AND v_pagamentos_total = v_pagamentos_confirmados
       AND (v_arte_status = 'APROVADO' OR v_arte_dispensada)
    THEN
        UPDATE public.propostas
        SET status_interno = 'REVISAO ATENDENTE'
        WHERE id_int = p_id_int
          AND COALESCE(status_interno, '') <> 'REVISAO ATENDENTE'
          -- ITEM A: a promocao so vale enquanto a proposta ainda esta na fase
          -- comercial/arte. De REVISAO PRODUCAO em diante ela seria um
          -- rebaixamento, e o pedido ja esta na fabrica.
          -- ENTREGUE entrou em 22/10/2026 (reenvio fase 2A; caso 22714): a
          -- mesma lista de atualizar_status_financeiro_proposta.
          AND COALESCE(UPPER(status_interno), '') NOT IN (
                'REVISAO PRODUCAO',
                'EM PRODUCAO',
                'EM IMPRESSAO',
                'EM IMPRESSAO / PENDENTE',
                'EM ACABAMENTO',
                'EM ACABAMENTO / PENDENTE',
                'EXPEDICAO',
                'A RETIRAR',
                'EM TRANSITO',
                'ENTREGUE',
                'RECEBIDO',
                'CANCELADO'
              );
    END IF;
END;
$function$;

-- -----------------------------------------------------------------------------
-- CONFERENCIA (sem contagem em tabela viva)
-- -----------------------------------------------------------------------------
DO $confere$
DECLARE
  v_md5 text;
BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.cc__valor_pago(bigint)'::regprocedure) NOT LIKE '%AND chave_reenvio IS NULL;%' THEN
    RAISE EXCEPTION 'cc__valor_pago sem o corte do reenvio.';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.check_and_promote_proposta(integer)'::regprocedure) NOT LIKE '%AND chave_reenvio IS NULL;%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.check_and_promote_proposta(integer)'::regprocedure) NOT LIKE '%''ENTREGUE'',%' THEN
    RAISE EXCEPTION 'check_and_promote_proposta sem o corte do reenvio ou sem ENTREGUE.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.pagamentos_v2'::regclass
                    AND tgname = 'trg_pgv2_reenvio_marcador' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'trg_pgv2_reenvio_marcador ausente ou desligado.';
  END IF;
  -- As lidas continuam as mesmas.
  SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = 'public.exp_saldo_despacho(bigint)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '8b42e75bf2366c1ed220b49e3198e72f' THEN
    RAISE EXCEPTION 'exp_saldo_despacho mudou durante a migration.';
  END IF;
END
$confere$;
