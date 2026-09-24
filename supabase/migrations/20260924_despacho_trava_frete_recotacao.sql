-- ============================================================================
-- Trava do despacho pela recotacao — 24/09/2026, decisao do dono.
--
-- A REGRA
--   Pedido CIF com CEP de entrega ou transporte diferentes do cotado: a
--   diferenca de frete e medida pela RECOTACAO, comparada em centavos contra o
--   frete da proposta.
--     - sem recotacao para o CEP de agora ........ trava, pede para recotar;
--     - recotacao mais barata ou ate R$ 4,00 acima  so avisa;
--     - mais de R$ 4,00 acima .................... trava.
--   Um ADM (expedicao.admin, conferido aqui no banco) libera o despacho com
--   qualquer diferenca, e a liberacao registra quem, quando e por que. A
--   prepostagem dos Correios segue a mesma regra (a rota consulta esta funcao
--   ANTES de chamar os Correios).
--   Peso divergente continua so avisando (paliativo de 26/08/2026, no app).
--
-- POR QUE NO BANCO
--   O despacho e PostgREST direto do navegador (EXPEDICAO.md §3.5): a trava que
--   existia em `despachar()` rodava no cliente e era contornavel. Aqui ela e a
--   trigger `trg_exp_trava_frete_despacho`, que recusa marcar `data_despacho`.
--
-- POR QUE A RECOTACAO E GRAVADA
--   A rota `cotar` so mostrava as opcoes. Agora cada recotacao fica em
--   `expedicao_recotacao_consultas`, escrita SO pelo servidor (service role):
--   authenticated nao insere, entao ninguem forja uma recotacao barata para
--   passar pela trava.
--
-- O QUE NAO MUDA
--   Frete e total da proposta: nada aqui escreve em `propostas`,
--   `cotacao_frete` ou `expedicao_recotacoes`. A liberacao de RECOTACAO
--   (`expedicao_recotacao_liberacoes`) continua como esta; a de DESPACHO e
--   outra, porque toda recotacao ja exige liberacao de admin — se uma valesse
--   pela outra, o limite de R$ 4,00 nunca se aplicaria.
--   Pedido complementar que sai junto com o principal nao e avaliado (o
--   principal e gravado antes e ja passou pela trava) — como era no app.
-- ============================================================================

-- 1. Cada recotacao feita no despacho ------------------------------------------
CREATE TABLE public.expedicao_recotacao_consultas (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_int              bigint      NOT NULL REFERENCES public.propostas(id_int),
  consultado_em       timestamptz NOT NULL DEFAULT now(),
  autor_uid           uuid,
  autor_nome          text,
  -- frete da proposta no momento da recotacao (so registro; a trava compara
  -- com o frete de AGORA)
  frete_proposta      numeric(12,2) NOT NULL,
  -- CEP para o qual se cotou, so digitos
  cep                 text        NOT NULL,
  id_endereco_entrega uuid,
  peso_gramas         integer,
  -- [{id, transportadora, servico, valor, prazo}]
  opcoes              jsonb       NOT NULL,
  CONSTRAINT exp_rec_consulta_cep_ck CHECK (cep ~ '^[0-9]{8}$'),
  CONSTRAINT exp_rec_consulta_opcoes_ck CHECK (jsonb_typeof(opcoes) = 'array')
);

COMMENT ON TABLE public.expedicao_recotacao_consultas IS
  'Resultado de cada recotacao de frete feita no despacho (rota /api/expedicao/recotacao/cotar). Append-only, escrita so pelo servidor com service role. E a fonte da trava do despacho (exp_trava_frete_despacho).';

CREATE INDEX exp_rec_consultas_id_int_idx
  ON public.expedicao_recotacao_consultas (id_int, consultado_em DESC);

ALTER TABLE public.expedicao_recotacao_consultas ENABLE ROW LEVEL SECURITY;
CREATE POLICY expedicao_recotacao_consultas_select_authenticated
  ON public.expedicao_recotacao_consultas FOR SELECT TO authenticated USING (true);
-- Default privileges dao ALL a authenticated em tabela nova; o RLS ja recusa a
-- escrita, e o REVOKE deixa isso explicito.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.expedicao_recotacao_consultas FROM authenticated, anon;

-- 2. Liberacao do despacho pelo ADM ---------------------------------------------
CREATE TABLE public.expedicao_despacho_liberacoes (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_int              bigint      NOT NULL REFERENCES public.propostas(id_int),
  liberado_em         timestamptz NOT NULL DEFAULT now(),
  liberado_por_uid    uuid,
  liberado_por_nome   text,
  liberado_por_email  text,
  motivo              text        NOT NULL,
  -- consumo: o despacho que passou por ela (trigger, mesma transacao)
  consumida_em        timestamptz,
  revogada_em         timestamptz,
  revogada_por_uid    uuid,
  revogada_por_nome   text,
  motivo_revogacao    text,
  CONSTRAINT exp_lib_desp_motivo_ck CHECK (length(btrim(motivo)) > 0),
  CONSTRAINT exp_lib_desp_consumo_xor_revogacao_ck
    CHECK (consumida_em IS NULL OR revogada_em IS NULL),
  CONSTRAINT exp_lib_desp_revogacao_coerente_ck
    CHECK (revogada_em IS NOT NULL
           OR (revogada_por_uid IS NULL AND revogada_por_nome IS NULL AND motivo_revogacao IS NULL))
);

COMMENT ON TABLE public.expedicao_despacho_liberacoes IS
  'Liberacao POR PEDIDO, dada por ADM (expedicao.admin), para despachar com qualquer diferenca de frete na recotacao. Uso unico: consumida pelo despacho. Distinta da liberacao de recotacao.';

CREATE UNIQUE INDEX exp_lib_desp_uma_ativa_por_pedido
  ON public.expedicao_despacho_liberacoes (id_int)
  WHERE consumida_em IS NULL AND revogada_em IS NULL;

ALTER TABLE public.expedicao_despacho_liberacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY expedicao_despacho_liberacoes_select_authenticated
  ON public.expedicao_despacho_liberacoes FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.expedicao_despacho_liberacoes FROM authenticated, anon;

CREATE TRIGGER trg_audit_expedicao_despacho_liberacoes
  AFTER INSERT OR UPDATE OR DELETE ON public.expedicao_despacho_liberacoes
  FOR EACH ROW EXECUTE FUNCTION audit.log_row_changes_v2();

-- 3. Tipo de transporte a partir do texto do servico ---------------------------
-- ESPELHO de `normalizarTipoFrete` (src/features/expedicao/lib/tipo-frete.ts).
-- Mudou la, muda aqui: as duas precisam classificar igual.
CREATE OR REPLACE FUNCTION public.exp__tipo_frete_do_texto(p_texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH n AS (
    SELECT upper(btrim(translate(coalesce(p_texto, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))) AS s
  )
  SELECT CASE
    WHEN s = '' THEN 'INDEFINIDO'
    WHEN s ~ '(^|[^A-Z])(SEDEX|PAC)([^A-Z]|$)' THEN 'CORREIOS'
    WHEN position('MOTOBOY' IN s) > 0 THEN 'MOTOBOY'
    WHEN position('RETIRA' IN s) > 0 OR position('BALCAO' IN s) > 0 THEN 'RETIRA_BALCAO'
    WHEN position('SEM CUSTO' IN s) > 0 THEN 'SEM_CUSTO'
    WHEN s ~ '(SAO MIGUEL|UNESUL|BRASPRESS|BRASPESS|AZUL|ECOMM|VEPPO|TROCA|TRANSPORTADORA)' THEN 'TRANSPORTADORA'
    ELSE 'INDEFINIDO'
  END
  FROM n;
$$;

-- 4. O veredito --------------------------------------------------------------------
-- Usado pela trigger, pela tela (antes do clique) e pela rota de prepostagem.
CREATE OR REPLACE FUNCTION public.exp_trava_frete_despacho(
  p_id_int      bigint,
  p_cep_destino text,
  p_tipo_frete  text,
  p_modalidade  text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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

  -- Referencia: a ultima recotacao APLICADA; sem ela, a cotacao escolhida.
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

  -- A recotacao que conta e a ULTIMA feita para o CEP de agora.
  SELECT id, consultado_em, opcoes INTO v_consulta
    FROM public.expedicao_recotacao_consultas
   WHERE id_int = p_id_int
     AND (v_cep_dest IS NULL OR cep = v_cep_dest)
   ORDER BY consultado_em DESC
   LIMIT 1;

  IF FOUND AND v_tipo IS NOT NULL THEN
    -- A opcao do transporte escolhido. Havendo mais de uma (SEDEX e PAC), vale
    -- a do mesmo servico da cotacao; sem ela, a mais barata daquele transporte.
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
   WHERE id_int = p_id_int AND consumida_em IS NULL AND revogada_em IS NULL;
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
$$;

COMMENT ON FUNCTION public.exp_trava_frete_despacho(bigint, text, text, text) IS
  'Veredito da trava de frete do despacho (regra de 24/09/2026). bloqueia=true recusa o despacho e a prepostagem. Usada pela trigger de expedicoes, pela tela e pela rota de prepostagem.';

-- 5. A trava: recusa marcar data_despacho -------------------------------------
CREATE OR REPLACE FUNCTION public.exp__trg_trava_frete_despacho()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cep      text;
  v_veredito jsonb;
BEGIN
  -- So o momento do despacho: data_despacho passando de vazia a preenchida.
  IF NEW.data_despacho IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.data_despacho IS NOT NULL THEN RETURN NEW; END IF;

  -- Complemento que sai junto: o principal ja passou pela trava.
  IF EXISTS (SELECT 1 FROM public.propostas
              WHERE id_int = NEW.id_int AND id_int_pedido_principal IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  IF NEW.id_endereco_entrega IS NOT NULL THEN
    SELECT cep INTO v_cep FROM public.enderecos WHERE id = NEW.id_endereco_entrega;
  END IF;

  v_veredito := public.exp_trava_frete_despacho(NEW.id_int, v_cep, NEW.tipo_frete, NEW.modalidade_frete);

  IF coalesce((v_veredito->>'bloqueia')::boolean, false) THEN
    RAISE EXCEPTION 'EXP_DESPACHO_TRAVA_FRETE: %', coalesce(v_veredito->>'mensagem', 'despacho bloqueado pela diferenca de frete.')
      USING ERRCODE = 'P0001';
  END IF;

  -- Passou pela liberacao do ADM: ela e de uso unico.
  IF v_veredito->>'situacao' = 'LIBERADO_ADM' THEN
    UPDATE public.expedicao_despacho_liberacoes
       SET consumida_em = now()
     WHERE id = (v_veredito->'liberacao'->>'id')::bigint
       AND consumida_em IS NULL AND revogada_em IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- A trigger que usa esta funcao e ligada em 20260924_despacho_trava_frete_trigger.sql,
-- DEPOIS do app novo no ar: ligada antes, todo despacho CIF divergente ficaria
-- travado sem recotacao gravada e sem tela para o ADM liberar.

-- 6. Liberar / revogar o despacho (ADM) ----------------------------------------
CREATE OR REPLACE FUNCTION public.exp_liberar_despacho(
  p_id_int      bigint,
  p_motivo      text,
  p_autor_nome  text DEFAULT NULL,
  p_autor_email text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_exist bigint;
  v_new   bigint;
BEGIN
  PERFORM public.cc__assert_permissao(v_uid, 'expedicao.admin');

  IF p_id_int IS NULL THEN
    RAISE EXCEPTION 'EXP_LIB_DESP_PARAMS: id_int e obrigatorio';
  END IF;
  IF length(btrim(coalesce(p_motivo, ''))) = 0 THEN
    RAISE EXCEPTION 'EXP_LIB_DESP_MOTIVO: informe o motivo da liberacao';
  END IF;

  PERFORM 1 FROM public.propostas WHERE id_int = p_id_int;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXP_LIB_DESP_PROPOSTA: proposta #% nao encontrada', p_id_int;
  END IF;

  SELECT id INTO v_exist
    FROM public.expedicao_despacho_liberacoes
   WHERE id_int = p_id_int AND consumida_em IS NULL AND revogada_em IS NULL;
  IF FOUND THEN RETURN v_exist; END IF;

  INSERT INTO public.expedicao_despacho_liberacoes
    (id_int, liberado_por_uid, liberado_por_nome, liberado_por_email, motivo)
  VALUES (p_id_int, v_uid, p_autor_nome, p_autor_email, btrim(p_motivo))
  RETURNING id INTO v_new;

  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.exp_revogar_despacho(
  p_id_int     bigint,
  p_motivo     text DEFAULT NULL,
  p_autor_nome text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  bigint;
BEGIN
  PERFORM public.cc__assert_permissao(v_uid, 'expedicao.admin');

  UPDATE public.expedicao_despacho_liberacoes
     SET revogada_em       = now(),
         revogada_por_uid  = v_uid,
         revogada_por_nome = p_autor_nome,
         motivo_revogacao  = p_motivo
   WHERE id_int = p_id_int
     AND consumida_em IS NULL
     AND revogada_em IS NULL
  RETURNING id INTO v_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXP_LIB_DESP_SEM_ATIVA: o pedido #% nao tem liberacao de despacho ativa', p_id_int;
  END IF;

  RETURN v_id;
END;
$$;

-- 7. Quem executa --------------------------------------------------------------
REVOKE ALL ON FUNCTION public.exp_trava_frete_despacho(bigint, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.exp_liberar_despacho(bigint, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.exp_revogar_despacho(bigint, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.exp__trg_trava_frete_despacho() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exp_trava_frete_despacho(bigint, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exp_liberar_despacho(bigint, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exp_revogar_despacho(bigint, text, text) TO authenticated;
