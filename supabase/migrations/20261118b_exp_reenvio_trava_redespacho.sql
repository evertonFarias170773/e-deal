-- =============================================================================
-- 20261118b_exp_reenvio_trava_redespacho
--
-- REENVIO, FASE 2B: A TRAVA DO REDESPACHO (18/11/2026). Depende de
-- 20261118_exp_reenvio_fase2b_diferenca.sql.
--
-- O reenvio nao zera expedicoes.data_despacho (fase 1), entao as travas de
-- saldo e de frete (gatilhos em expedicoes) so agem no primeiro despacho e o
-- redespacho passava sem nenhuma conferencia no banco. Esta migration cria uma
-- conferencia propria do redespacho, num gatilho NOVO; os gatilhos que existem
-- (trava de frete, trava de saldo) e os tres de frete em cotacao_frete nao sao
-- tocados.
--
-- CICLO ABERTO (para o banco): o ultimo ciclo do pedido enquanto a data de
-- despacho gravada for nula ou nao for posterior ao registro do ciclo
-- (data_despacho <= criado_em). Cobre o caminho normal (data_despacho =
-- data_despacho_anterior) e o pedido que teve a data zerada no meio.
--
-- O REDESPACHO DO CICLO ABERTO SO SAI SE:
--   1. o envio e o do ciclo, quando o ciclo cotou o frete (COTACAO ou
--      DIGITADO_ADM, em CIF): mesmo CEP e mesmo tipo de envio;
--   2. a trava de saldo (exp_saldo_despacho) nao bloqueia, o que desde a 2B
--      inclui a diferenca de frete do reenvio (paga ou abonada);
--   3. o ciclo trocou o tipo de envio (exige_nota) e o pedido tem nota de
--      PRODUCAO autorizada, nao cancelada, emitida depois de criado_em:
--      NF-e por data_autorizacao, NFS-e por created_at (a tabela nao tem data
--      de autorizacao; rascunho criado depois do ciclo ja e posterior a ele).
--      Qualquer tipo de nota vale (venda, remessa, servico).
--
-- exp_reenvio_redespacho(id_int, cep, tipo) e a funcao unica: o gatilho recusa
-- com ela e o despachar() da tela pergunta a ela antes de gravar.
-- =============================================================================

SET LOCAL lock_timeout = '8s';

DO $trava$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.expedicao_reenvios'::regclass
                    AND attname = 'exige_nota' AND NOT attisdropped)
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.exp_saldo_despacho(bigint)'::regprocedure) NOT LIKE '%SALDO_REENVIO%' THEN
    RAISE EXCEPTION 'Aplique antes 20261118_exp_reenvio_fase2b_diferenca.sql. Nada aplicado.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.expedicoes'::regclass AND tgname = 'trg_exp_reenvio_redespacho') THEN
    RAISE EXCEPTION 'trg_exp_reenvio_redespacho ja existe. Nada aplicado.';
  END IF;
END
$trava$;

-- -----------------------------------------------------------------------------
-- 1. O VEREDITO DO REDESPACHO
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.exp_reenvio_redespacho(
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

  -- 2. saldo (inclui a diferenca do reenvio)
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

REVOKE ALL ON FUNCTION public.exp_reenvio_redespacho(bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exp_reenvio_redespacho(bigint, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.exp_reenvio_redespacho(bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exp_reenvio_redespacho(bigint, text, text) TO service_role;

COMMENT ON FUNCTION public.exp_reenvio_redespacho(bigint, text, text) IS
  'Reenvio fase 2B: veredito do redespacho do ciclo aberto (envio do ciclo quando o frete foi cotado, saldo com a diferenca do reenvio, nota de producao posterior ao ciclo quando o tipo mudou). Sem ciclo aberto: aberto=false. Usada pelo gatilho trg_exp_reenvio_redespacho e pelo despachar() da tela.';

-- -----------------------------------------------------------------------------
-- 2. O GATILHO (novo; nao substitui nenhum)
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.exp__trg_reenvio_redespacho()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cep  text;
  v_ver  jsonb;
BEGIN
  -- Barato para pedido sem reenvio: a funcao sai na primeira leitura.
  IF NEW.id_endereco_entrega IS NOT NULL THEN
    SELECT cep INTO v_cep FROM public.enderecos WHERE id = NEW.id_endereco_entrega;
  END IF;
  -- BEFORE UPDATE: a leitura de expedicoes dentro da funcao ve a linha antiga
  -- (OLD.data_despacho), que e o que decide se o ciclo esta aberto.
  v_ver := public.exp_reenvio_redespacho(NEW.id_int, v_cep, NEW.tipo_frete);
  IF coalesce((v_ver->>'aberto')::boolean, false) AND coalesce((v_ver->>'bloqueia')::boolean, false) THEN
    RAISE EXCEPTION 'EXP_REDESPACHO_%: %', v_ver->>'situacao', v_ver->>'mensagem'
      USING ERRCODE = 'P0001', DETAIL = v_ver::text;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.exp__trg_reenvio_redespacho() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exp__trg_reenvio_redespacho() FROM anon;
REVOKE ALL ON FUNCTION public.exp__trg_reenvio_redespacho() FROM authenticated;

CREATE TRIGGER trg_exp_reenvio_redespacho
  BEFORE UPDATE OF data_despacho ON public.expedicoes
  FOR EACH ROW
  WHEN (NEW.data_despacho IS NOT NULL AND NEW.data_despacho IS DISTINCT FROM OLD.data_despacho)
  EXECUTE FUNCTION public.exp__trg_reenvio_redespacho();

-- -----------------------------------------------------------------------------
-- CONFERENCIA
-- -----------------------------------------------------------------------------
DO $confere$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.expedicoes'::regclass
                    AND tgname = 'trg_exp_reenvio_redespacho' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'trg_exp_reenvio_redespacho ausente ou desligado.';
  END IF;
  IF has_function_privilege('anon', 'public.exp_reenvio_redespacho(bigint, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon com EXECUTE em exp_reenvio_redespacho.';
  END IF;
END
$confere$;

-- =============================================================================
-- ROLLBACK (so com autorizacao; antes do rollback de 20261118):
--   drop trigger trg_exp_reenvio_redespacho on public.expedicoes;
--   drop function public.exp__trg_reenvio_redespacho();
--   drop function public.exp_reenvio_redespacho(bigint, text, text);
-- =============================================================================
