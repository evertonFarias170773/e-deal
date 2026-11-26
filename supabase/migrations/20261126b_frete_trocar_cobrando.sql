-- =============================================================================
-- 20261126b_frete_trocar_cobrando
--
-- TROCAR A TRANSPORTADORA COBRANDO A DIFERENCA A PARTE (26/11/2026).
--
-- Decisao do Everton (consultado o fiscal): a diferenca do frete e cobrada a
-- parte, SEM nota complementar. A NF-e fica como esta e a transportadora e
-- corrigida por CC-e. Complemento do abono (20261126_frete_trocar_abonando).
--
--   - a transportadora muda como no abono (propostas.id_transportadora_cliente e
--     categoria_frete); frete cobrado (valor_frete) e total (valor_total) NAO
--     mudam; cotacao_frete, boletos e as cobrancas que ja existem nao sao tocados;
--   - a diferenca vira UMA COBRANCA NOVA do pedido em pagamentos_v2 (PIX, boleto
--     ou cartao, os de sempre), descricao "Diferenca de frete - troca para <X>",
--     marcada com pagamentos_v2.id_troca_frete = a linha do historico;
--   - o historico da recotacao (expedicao_recotacoes) guarda valor, quem,
--     quando, motivo e o id da cobranca (id_cobranca);
--   - a trava de saldo (exp_saldo_despacho) segura o despacho ate ela ser paga
--     ou abonada (SALDO_TROCA_FRETE).
--
-- MARCA id_troca_frete: o mesmo desenho da chave_reenvio (20261022). Nasce no
-- INSERT, por funcao do banco ou service_role, e nunca muda. O navegador tem
-- GRANT de INSERT/UPDATE por coluna em pagamentos_v2 e a coluna nova nasce sem
-- ele; o gatilho trg_pgv2_troca_frete_marcador e a segunda camada e a da
-- imutabilidade. Uma cobranca viva por troca (indice unico parcial).
--
-- FORA DA VENDA (opcao A do Everton, 26/11/2026). A cobranca marcada nao e
-- pagamento da proposta nem venda. As duas marcas (chave_reenvio e
-- id_troca_frete) passam a ficar de fora de:
--   ja excluiam o reenvio, ganham a troca:
--     cc__valor_pago, check_and_promote_proposta, rpc_relatorio_vendas
--     (e por ela rpc_relatorio_vendas_json, a comissao), rpc_relatorio_vendas_pagas
--     (e rpc_relatorio_vendas_pagas_json), rpc_relatorio_curva_abc_clientes,
--     rpc_relatorio_vendas_por_cidade;
--   nao excluiam nenhuma, ganham as duas:
--     rpc_dashboard_executivo, rpc_dashboard_vendedor, rpc_ranking_vendedores,
--     view_pagamentos_pagos, view_pagamentos_pagos_v2,
--     vw_relatorio_vendas_pagas_base, vw_pagamentos_resumo.
--   Ficam somando (dinheiro que entrou, nao venda): rpc_relatorio_conferencia_pagamentos,
--   fn_analise_credito_cliente e vw_maestro_cliente_360 (ultimo recebimento).
--   Efeito no que ja existe: as 2 cobrancas pagas do reenvio (R$ 113,64) saem
--   dos paineis e das views acima.
--
-- As funcoes longas recebem a exclusao por SUBSTITUICAO DE TRECHO sobre o texto
-- atual (pg_temp.trocar_trecho): o md5 de cada uma e conferido antes, o trecho
-- tem de aparecer o numero exato de vezes, e a conferencia final procura o
-- trecho novo. O texto de cada trecho esta abaixo, junto da chamada.
--
-- NAO MEXE em RLS, GRANT de tabela, valor_total, valor_frete, cotacao_frete,
-- NF, boletos, cobrancas existentes, exp_aplicar_recotacao nem no abono.
--
-- Rollback (so sem cobranca marcada):
--   reaplicar as funcoes/views pelo texto anterior (md5 da trava abaixo);
--   DROP FUNCTION public.exp_aplicar_recotacao_cobrando(...), exp_troca_frete_situacao(bigint),
--     exp_troca_frete_cobrar(bigint, text), exp_troca_frete_abonar(bigint, text);
--   DROP TRIGGER trg_pgv2_troca_frete_marcador ON public.pagamentos_v2;
--   ALTER TABLE public.pagamentos_v2 DROP COLUMN id_troca_frete;
--   ALTER TABLE public.expedicao_recotacoes DROP CONSTRAINT exp_recot_cobranca_ck, DROP COLUMN cobranca_*, id_cobranca.
-- =============================================================================

SET LOCAL lock_timeout = '8s';

-- -----------------------------------------------------------------------------
-- 0. TRAVA: o texto de hoje (md5 de prosrc sem CR / de pg_get_viewdef)
-- -----------------------------------------------------------------------------
DO $trava$
DECLARE
  v_md5 text;
  v_esperado record;
BEGIN
  FOR v_esperado IN
    SELECT * FROM (VALUES
      ('cc__valor_pago',                   'p_id_int bigint', '4e92cd145c719e998715b2ec31efbdfa'),
      ('check_and_promote_proposta',       'p_id_int integer', 'da65da807db578b2c4da3519a7eb06d6'),
      ('exp_saldo_despacho',               'p_id_int bigint', 'e9236015260fc9a351e793d3002be657'),
      ('rpc_relatorio_vendas',             'p_data_inicio date, p_data_fim date, p_empresas smallint[], p_formas_pagamento text[], p_vendedores text[], p_incluir_frete boolean, p_situacao text', '7ec20607a405fa32c2cefb66863385bf'),
      ('rpc_relatorio_vendas_pagas',       'p_data_inicio date, p_data_fim date, p_empresas smallint[], p_formas_pagamento text[], p_vendedores text[], p_incluir_frete boolean', '0c439d66c49ec25a6297eab2abb7e5b8'),
      ('rpc_relatorio_curva_abc_clientes', 'p_data_inicio date, p_data_fim date, p_empresas smallint[], p_vendedores text[], p_incluir_frete boolean', 'a75c65fc1c95dadb2895aa949d8369c0'),
      ('rpc_relatorio_vendas_por_cidade',  'p_data_inicio date, p_data_fim date, p_empresas smallint[], p_vendedores text[], p_incluir_frete boolean', '5f585feeca0e01952d049cb47e581ed1'),
      ('rpc_dashboard_executivo',          'p_inicio date, p_fim date, p_inicio_prev date, p_fim_prev date, p_id_empresa integer', '60989ba7b030d634d18a1d92fe0c0710'),
      ('rpc_dashboard_vendedor',           'p_inicio date, p_fim date, p_inicio_prev date, p_fim_prev date, p_vendedor text', '2ebcdc05dbb3b8309f5e6691bca14600'),
      ('rpc_ranking_vendedores',           'p_inicio date, p_fim date', 'de86008d05f9bb5c73aabb6b839425c9'),
      -- lidas, nao alteradas: chamam as de cima
      ('rpc_relatorio_vendas_json',        'p_data_inicio date, p_data_fim date, p_empresas smallint[], p_formas_pagamento text[], p_vendedores text[], p_incluir_frete boolean, p_situacao text', 'c42acf8b879110016d081ccd50827592'),
      ('rpc_relatorio_vendas_pagas_json',  'p_data_inicio date, p_data_fim date, p_empresas smallint[], p_formas_pagamento text[], p_vendedores text[], p_incluir_frete boolean', '8bcba9887624c0cc9386232823a0f11d')
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

  FOR v_esperado IN
    SELECT * FROM (VALUES
      ('view_pagamentos_pagos',          '933f4327ef030946c2161d7c3fcda7ab'),
      ('view_pagamentos_pagos_v2',       '3140c90d0463b4cf670fe16d6fccbc5b'),
      ('vw_relatorio_vendas_pagas_base', '227f1c164015896eef92e96f1230df52'),
      ('vw_pagamentos_resumo',           '106b2e73ac5beee7b799d73f11d0b6f4')
    ) AS t(nome, md5)
  LOOP
    SELECT md5(pg_get_viewdef(('public.' || v_esperado.nome)::regclass)) INTO v_md5;
    IF v_md5 IS DISTINCT FROM v_esperado.md5 THEN
      RAISE EXCEPTION 'view % mudou desde o mapeamento (md5 %, esperado %). Nada aplicado.',
        v_esperado.nome, v_md5, v_esperado.md5;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.pagamentos_v2'::regclass
                AND attname = 'id_troca_frete' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'pagamentos_v2.id_troca_frete ja existe. Nada aplicado.';
  END IF;
END
$trava$;

-- -----------------------------------------------------------------------------
-- 1. HISTORICO DA RECOTACAO: as colunas da troca cobrando
-- -----------------------------------------------------------------------------
ALTER TABLE public.expedicao_recotacoes
  ADD COLUMN cobranca_valor numeric(12,2),
  ADD COLUMN cobranca_motivo text,
  ADD COLUMN cobranca_tipo text,
  ADD COLUMN id_cobranca uuid,
  ADD COLUMN cobranca_abono_valor numeric(12,2),
  ADD COLUMN cobranca_abono_motivo text,
  ADD COLUMN cobranca_abonado_por uuid,
  ADD COLUMN cobranca_abonado_por_nome text,
  ADD COLUMN cobranca_abonado_em timestamptz;

-- Linha da troca cobrando: o frete cobrado da proposta nao anda (diferenca 0,
-- total igual); a opcao contratada custa o frete cobrado + a cobranca a parte.
-- Uma linha e abono OU cobranca, nunca os dois.
ALTER TABLE public.expedicao_recotacoes
  ADD CONSTRAINT exp_recot_cobranca_ck CHECK (
    cobranca_valor IS NULL
    OR (cobranca_valor > 0
        AND abono_valor IS NULL
        AND diferenca = 0
        AND frete_novo = frete_anterior
        AND total_novo = total_anterior
        AND valor_opcao = frete_novo + cobranca_valor
        AND id_transportadora_abono IS NOT NULL
        AND cobranca_tipo IN ('PIX', 'BOLETO', 'CARD_PARCELADO')
        AND length(btrim(coalesce(cobranca_motivo, ''))) >= 5
        AND (cobranca_abono_valor IS NULL
             OR (cobranca_abono_valor = cobranca_valor
                 AND length(btrim(coalesce(cobranca_abono_motivo, ''))) >= 5)))
  );

COMMENT ON COLUMN public.expedicao_recotacoes.cobranca_valor IS
  'Troca de transportadora cobrando a diferenca a parte (26/11/2026): valor da cobranca nova do pedido, fora do total e do pago da proposta. frete_novo = frete_anterior; valor_opcao = frete cobrado + cobranca_valor. id_transportadora_abono guarda a transportadora nova (abono ou cobranca).';
COMMENT ON COLUMN public.expedicao_recotacoes.id_cobranca IS
  'pagamentos_v2.id da cobranca criada na troca cobrando. Se ela for cancelada, a nova (exp_troca_frete_cobrar) tem o mesmo id_troca_frete.';

-- -----------------------------------------------------------------------------
-- 2. MARCA EM pagamentos_v2
-- -----------------------------------------------------------------------------
ALTER TABLE public.pagamentos_v2 ADD COLUMN id_troca_frete bigint;

COMMENT ON COLUMN public.pagamentos_v2.id_troca_frete IS
  'expedicao_recotacoes.id da troca de transportadora cobrando a diferenca. Cobranca fora do pago da proposta (cc__valor_pago) e fora da venda (relatorios e paineis). Nasce no INSERT por funcao do banco ou service_role e nunca muda.';

ALTER TABLE public.pagamentos_v2
  ADD CONSTRAINT pagamentos_v2_id_troca_frete_fkey
  FOREIGN KEY (id_troca_frete) REFERENCES public.expedicao_recotacoes (id);

CREATE UNIQUE INDEX pagamentos_v2_id_troca_frete_viva_uk
  ON public.pagamentos_v2 (id_troca_frete)
  WHERE id_troca_frete IS NOT NULL AND status IS DISTINCT FROM 'CANCELADO';

CREATE FUNCTION public.fn_pgv2_troca_frete_marcador()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id_troca_frete IS DISTINCT FROM OLD.id_troca_frete THEN
      RAISE EXCEPTION 'PGV2_TROCA_FRETE_IMUTAVEL: a marca da troca de frete da cobranca % nasce com ela e nao pode ser incluida, trocada nem removida.', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id_troca_frete IS NULL THEN
    RETURN NEW;
  END IF;
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'PGV2_TROCA_FRETE_SO_PELO_BANCO: cobranca da troca de frete so e criada pelo fluxo da troca.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- A troca e do MESMO pedido e e uma troca cobrando.
  IF NOT EXISTS (SELECT 1 FROM public.expedicao_recotacoes r
                  WHERE r.id = NEW.id_troca_frete AND r.id_int = NEW.id_int
                    AND r.cobranca_valor IS NOT NULL) THEN
    RAISE EXCEPTION 'PGV2_TROCA_FRETE_PEDIDO: a troca % nao e uma troca cobrando do pedido %.', NEW.id_troca_frete, NEW.id_int
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_pgv2_troca_frete_marcador() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_pgv2_troca_frete_marcador
  BEFORE INSERT OR UPDATE OF id_troca_frete ON public.pagamentos_v2
  FOR EACH ROW EXECUTE FUNCTION public.fn_pgv2_troca_frete_marcador();

-- -----------------------------------------------------------------------------
-- 3. PAGO DA PROPOSTA (mesma assinatura, mesmos GRANTs)
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
    AND chave_reenvio IS NULL
    -- Troca cobrando (26/11/2026): a diferenca de frete da troca de
    -- transportadora tambem nao.
    AND id_troca_frete IS NULL;
$function$;

-- -----------------------------------------------------------------------------
-- 4. SUBSTITUICAO DE TRECHO NAS FUNCOES LONGAS
-- -----------------------------------------------------------------------------
CREATE FUNCTION pg_temp.trocar_trecho(p_fn regprocedure, p_de text, p_para text, p_vezes integer)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_def text := pg_get_functiondef(p_fn);
  v_n   integer := (length(v_def) - length(replace(v_def, p_de, ''))) / length(p_de);
BEGIN
  IF v_n <> p_vezes THEN
    RAISE EXCEPTION '%: o trecho "%" aparece % vez(es), esperado %. Nada aplicado.', p_fn, p_de, v_n, p_vezes;
  END IF;
  EXECUTE replace(v_def, p_de, p_para);
END;
$$;

-- 4.1 Promocao: a cobranca da troca nao conta (nem libera, nem segura).
SELECT pg_temp.trocar_trecho('public.check_and_promote_proposta(integer)'::regprocedure,
  'AND chave_reenvio IS NULL;',
  'AND chave_reenvio IS NULL AND id_troca_frete IS NULL;', 1);

-- 4.2 Os 4 relatorios de vendas (a comissao vem do rpc_relatorio_vendas).
SELECT pg_temp.trocar_trecho(
  'public.rpc_relatorio_vendas(date, date, smallint[], text[], text[], boolean, text)'::regprocedure,
  'and pg.chave_reenvio is null',
  'and pg.chave_reenvio is null and pg.id_troca_frete is null', 1);
SELECT pg_temp.trocar_trecho(
  'public.rpc_relatorio_vendas_pagas(date, date, smallint[], text[], text[], boolean)'::regprocedure,
  'and pg.chave_reenvio is null',
  'and pg.chave_reenvio is null and pg.id_troca_frete is null', 1);
SELECT pg_temp.trocar_trecho(
  'public.rpc_relatorio_curva_abc_clientes(date, date, smallint[], text[], boolean)'::regprocedure,
  'and pg.chave_reenvio is null',
  'and pg.chave_reenvio is null and pg.id_troca_frete is null', 1);
SELECT pg_temp.trocar_trecho(
  'public.rpc_relatorio_vendas_por_cidade(date, date, smallint[], text[], boolean)'::regprocedure,
  'and pg.chave_reenvio is null',
  'and pg.chave_reenvio is null and pg.id_troca_frete is null', 1);

-- 4.3 Paineis: Dashboard (faturamento por forma), Meu Desempenho e ranking.
SELECT pg_temp.trocar_trecho(
  'public.rpc_dashboard_executivo(date, date, date, date, integer)'::regprocedure,
  'where (p2.status = ''PAID'' or (p2.status = ''A_VENCER'' and p2.confirmado = true))',
  'where (p2.status = ''PAID'' or (p2.status = ''A_VENCER'' and p2.confirmado = true)) and p2.chave_reenvio is null and p2.id_troca_frete is null', 1);
SELECT pg_temp.trocar_trecho(
  'public.rpc_dashboard_vendedor(date, date, date, date, text)'::regprocedure,
  'and public.fn_conta_no_faturamento(p2.tipo_cobranca)',
  'and public.fn_conta_no_faturamento(p2.tipo_cobranca) and p2.chave_reenvio is null and p2.id_troca_frete is null', 4);
SELECT pg_temp.trocar_trecho(
  'public.rpc_ranking_vendedores(date, date)'::regprocedure,
  'and public.fn_conta_no_faturamento(p2.tipo_cobranca)',
  'and public.fn_conta_no_faturamento(p2.tipo_cobranca) and p2.chave_reenvio is null and p2.id_troca_frete is null', 1);

-- -----------------------------------------------------------------------------
-- 5. VIEWS (mesmas colunas; so o filtro novo)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_pagamentos_pagos AS
 SELECT date(paid_at) AS data,
    id_empresa,
    valor
   FROM pagamentos_v2
  WHERE ((status = 'PAID'::text) AND (paid_at IS NOT NULL)
    AND (chave_reenvio IS NULL) AND (id_troca_frete IS NULL));

CREATE OR REPLACE VIEW public.view_pagamentos_pagos_v2 AS
 SELECT ((data_confirmacao AT TIME ZONE 'America/Sao_Paulo'::text))::date AS data,
    id_empresa,
    status,
    sum(valor) AS total,
    count(*) AS quantidade
   FROM pagamentos_v2 pg
  WHERE ((status = ANY (ARRAY['PAID'::text, 'A_VENCER'::text])) AND (confirmado = true) AND (data_confirmacao IS NOT NULL) AND fn_conta_no_faturamento(tipo_cobranca) AND (NOT (EXISTS ( SELECT 1
           FROM propostas pr
          WHERE ((pr.id_int = pg.id_int) AND fn_venda_de_teste((pr.id_cliente)::bigint, pr.id_faturado, pr.vendedor, pr.user_id)))))
    AND (chave_reenvio IS NULL) AND (id_troca_frete IS NULL))
  GROUP BY (((data_confirmacao AT TIME ZONE 'America/Sao_Paulo'::text))::date), id_empresa, status;

CREATE OR REPLACE VIEW public.vw_relatorio_vendas_pagas_base AS
 WITH base AS (
         SELECT pg.id_int AS numero_proposta,
            max(pg.os_ideal) AS os_ideal,
            max(pg.cliente) AS cliente,
            string_agg(DISTINCT NULLIF(TRIM(BOTH FROM pg.atendente), ''::text), ' / '::text) AS vendedor,
            min((pg.paid_at)::date) AS primeira_data_pagamento,
            max((pg.paid_at)::date) AS ultima_data_pagamento,
            string_agg(DISTINCT pg.tipo_cobranca, ' / '::text) AS formas_pagamento,
            max(pg.id_empresa) AS id_empresa,
            max(pg.empresa) AS empresa_original,
            sum(pg.valor) AS valor_com_frete,
            COALESCE(max(pr.valor_frete), (0)::numeric) AS valor_frete,
            (sum(pg.valor) - COALESCE(max(pr.valor_frete), (0)::numeric)) AS valor_sem_frete,
            count(*) AS qtd_pagamentos
           FROM (pagamentos_v2 pg
             LEFT JOIN propostas pr ON ((pr.id_int = pg.id_int)))
          WHERE ((pg.status = ANY (ARRAY['PAID'::text, 'A_VENCER'::text])) AND (pg.confirmado IS TRUE) AND (pg.paid_at IS NOT NULL)
            AND (pg.chave_reenvio IS NULL) AND (pg.id_troca_frete IS NULL))
          GROUP BY pg.id_int
        )
 SELECT numero_proposta,
    os_ideal,
    cliente,
    COALESCE(vendedor, 'Não informado'::text) AS vendedor,
    primeira_data_pagamento,
    ultima_data_pagamento,
    formas_pagamento,
        CASE
            WHEN (id_empresa = 1) THEN 'IDEAL GRÁFICA EXPRESSA EIRELI'::text
            WHEN (id_empresa = 2) THEN 'IDEAL BIRÔ SERV. GRAFICOS'::text
            WHEN (id_empresa = 3) THEN 'E3 BRINDES LTDA'::text
            ELSE empresa_original
        END AS empresa,
    id_empresa,
    valor_com_frete,
    valor_frete,
    valor_sem_frete,
    qtd_pagamentos
   FROM base;

-- vw_pagamentos_resumo: o filtro vai no JOIN (pedido sem cobranca continua na view).
DO $resumo$
DECLARE
  v_def text := pg_get_viewdef('public.vw_pagamentos_resumo'::regclass);
  v_de  text := 'LEFT JOIN pagamentos_v2 v2 ON ((v2.id_int = vpc.id_int)))';
  v_para text := 'LEFT JOIN pagamentos_v2 v2 ON (((v2.id_int = vpc.id_int) AND (v2.chave_reenvio IS NULL) AND (v2.id_troca_frete IS NULL))))';
BEGIN
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'vw_pagamentos_resumo: JOIN de pagamentos_v2 nao encontrado uma vez. Nada aplicado.';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.vw_pagamentos_resumo AS ' || replace(v_def, v_de, v_para);
END
$resumo$;

-- -----------------------------------------------------------------------------
-- 6. TROCAR COBRANDO
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exp__cobranca_da_troca(p_id_recotacao bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
-- Cria a cobranca marcada de uma troca cobrando (uso interno: sem GRANT).
-- Copia o pagador da cobranca ativa mais recente da proposta (paga primeiro),
-- como exp_reenvio_cobrar_diferenca.
DECLARE
  v_r       public.expedicao_recotacoes%ROWTYPE;
  v_modelo  public.pagamentos_v2%ROWTYPE;
  v_id      uuid;
  v_ref     text;
  v_hoje    date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT * INTO v_r FROM public.expedicao_recotacoes WHERE id = p_id_recotacao;
  SELECT * INTO v_modelo FROM public.pagamentos_v2
   WHERE id_int = v_r.id_int AND chave_reenvio IS NULL AND id_troca_frete IS NULL
     AND status IS DISTINCT FROM 'CANCELADO'
   ORDER BY (status = 'PAID') DESC, created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXP_RECOT_COBRANCA_SEM_PAGADOR: o #% nao tem cobranca ativa de onde copiar o pagador.', v_r.id_int
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.pagamentos_v2 (
    id_int, id_cliente, cliente, documento, valor, status, tipo_cobranca,
    empresa, id_empresa, os_ideal, atendente, descricao, vencimento, obs_v2,
    confirmado, forma_fatu, forma_pgto, id_modelo_cobranca,
    p_valor_entrada, p_qtd_parcelas, p_dias_pra_inicio, p_intervalo, paid_at, id_troca_frete
  ) VALUES (
    v_r.id_int, v_modelo.id_cliente, v_modelo.cliente, v_modelo.documento,
    v_r.cobranca_valor, 'A_RECEBER', v_r.cobranca_tipo,
    v_modelo.empresa, v_modelo.id_empresa, v_modelo.os_ideal, v_modelo.atendente,
    format('Diferença de frete — troca para %s', coalesce(nullif(btrim(v_r.transportadora), ''), v_r.servico, 'outra transportadora')),
    CASE WHEN v_r.cobranca_tipo = 'BOLETO' THEN v_hoje + 3 ELSE v_hoje END, NULL,
    false, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, v_r.id
  ) RETURNING id, id_pagamento INTO v_id, v_ref;

  RETURN jsonb_build_object('id', v_id, 'id_pagamento', v_ref, 'valor', v_r.cobranca_valor,
    'id_empresa', v_modelo.id_empresa, 'tipo_cobranca', v_r.cobranca_tipo, 'idempotente', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.exp__cobranca_da_troca(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.exp_aplicar_recotacao_cobrando(
  p_id_int               bigint,
  p_chave                uuid,
  p_frete_atual          numeric,
  p_valor_opcao          numeric,
  p_total_atual          numeric,
  p_transportadora       text,
  p_servico              text,
  p_prazo                text,
  p_id_transportadora    bigint,
  p_categoria_frete      text,
  p_peso_gramas          integer,
  p_peso_origem          text,
  p_subtotal_itens       numeric,
  p_id_endereco_entrega  uuid,
  p_cep                  text,
  p_modalidade           text,
  p_opcoes_cotadas       jsonb,
  p_autor_nome           text,
  p_autor_email          text,
  p_motivo               text,
  p_tipo_cobranca        text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_tol_float  constant numeric := 0.005;
  v_uid        uuid := auth.uid();
  v_exist      public.expedicao_recotacoes%ROWTYPE;
  v_prop       public.propostas%ROWTYPE;
  v_depois     record;
  v_exp        public.expedicoes%ROWTYPE;
  v_pago       numeric;
  v_tem_nfe    boolean;
  v_modalidade text;
  v_dif        numeric;
  v_sob        numeric;
  v_tipo       text := upper(btrim(coalesce(p_tipo_cobranca, '')));
  v_new_id     bigint;
  v_cob        jsonb;
BEGIN
  PERFORM public.cc__assert_permissao(v_uid, 'frete.trocar_abonando');

  IF p_id_int IS NULL OR p_chave IS NULL OR p_frete_atual IS NULL
     OR p_valor_opcao IS NULL OR p_total_atual IS NULL THEN
    RAISE EXCEPTION 'EXP_RECOT_PARAMS: id_int, chave, frete, valor da opcao e total sao obrigatorios';
  END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 5 THEN
    RAISE EXCEPTION 'EXP_RECOT_COBRANCA_MOTIVO: escreva o motivo da troca (pelo menos 5 letras)';
  END IF;
  IF v_tipo NOT IN ('PIX', 'BOLETO', 'CARD_PARCELADO') THEN
    RAISE EXCEPTION 'EXP_RECOT_COBRANCA_TIPO: forma de cobranca % invalida (PIX, BOLETO ou CARD_PARCELADO)', coalesce(p_tipo_cobranca, 'vazia');
  END IF;

  -- Idempotencia: a mesma chave devolve a mesma troca e a cobranca viva dela.
  SELECT * INTO v_exist FROM public.expedicao_recotacoes WHERE chave = p_chave;
  IF FOUND THEN
    RETURN jsonb_build_object('id_recotacao', v_exist.id, 'idempotente', true,
      'cobranca', (SELECT jsonb_build_object('id', v.id, 'id_pagamento', v.id_pagamento, 'valor', v.valor,
                                             'id_empresa', v.id_empresa, 'tipo_cobranca', v.tipo_cobranca)
                     FROM public.pagamentos_v2 v
                    WHERE v.id_troca_frete = v_exist.id AND v.status IS DISTINCT FROM 'CANCELADO'
                    ORDER BY v.created_at DESC LIMIT 1));
  END IF;

  SELECT * INTO v_prop FROM public.propostas WHERE id_int = p_id_int FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXP_RECOT_PROPOSTA: proposta #% nao encontrada', p_id_int;
  END IF;

  IF v_prop.valor_frete IS DISTINCT FROM p_frete_atual THEN
    RAISE EXCEPTION 'EXP_RECOT_CONCORRENCIA: o frete da proposta #% mudou (R$ % agora, R$ % na recotacao) - recote de novo',
      p_id_int, v_prop.valor_frete, p_frete_atual;
  END IF;
  IF v_prop.valor_total IS NULL
     OR abs(v_prop.valor_total::numeric - p_total_atual) > c_tol_float THEN
    RAISE EXCEPTION 'EXP_RECOT_CONCORRENCIA: o total da proposta #% mudou (R$ % agora, R$ % na recotacao) - recote de novo',
      p_id_int, v_prop.valor_total, p_total_atual;
  END IF;

  IF COALESCE(v_prop.is_avulso, false) THEN
    RAISE EXCEPTION 'EXP_RECOT_AVULSA: proposta avulsa nao entra na recotacao (#%)', p_id_int;
  END IF;
  IF COALESCE(btrim(v_prop.status_interno), '') <> 'EXPEDICAO' THEN
    RAISE EXCEPTION 'EXP_RECOT_STATUS: recotacao so no despacho; #% esta em "%"',
      p_id_int, v_prop.status_interno;
  END IF;

  v_pago := public.cc__valor_pago(p_id_int);
  IF COALESCE(v_pago, 0) <= 0 THEN
    RAISE EXCEPTION 'EXP_RECOT_NAO_PAGA: proposta #% nao possui pagamento confirmado', p_id_int;
  END IF;

  SELECT * INTO v_exp FROM public.expedicoes WHERE id_int = p_id_int;

  v_modalidade := COALESCE(v_exp.modalidade_frete, v_prop.modalidade_frete);
  IF v_modalidade IS DISTINCT FROM 'CIF' THEN
    RAISE EXCEPTION 'EXP_RECOT_MODALIDADE: recotacao so em CIF; #% esta como %',
      p_id_int, COALESCE(v_modalidade, 'sem modalidade declarada');
  END IF;
  IF p_modalidade IS DISTINCT FROM v_modalidade THEN
    RAISE EXCEPTION 'EXP_RECOT_MODALIDADE: modalidade informada (%) diverge da gravada (%) na proposta #%',
      p_modalidade, v_modalidade, p_id_int;
  END IF;

  IF v_exp.data_entrega IS NOT NULL THEN
    RAISE EXCEPTION 'EXP_RECOT_ENTREGUE: pedido #% ja foi entregue', p_id_int;
  END IF;
  IF v_exp.data_despacho IS NOT NULL THEN
    RAISE EXCEPTION 'EXP_RECOT_DESPACHADO: pedido #% ja foi despachado; a troca cobrando vale antes do despacho', p_id_int;
  END IF;

  v_dif := round(p_valor_opcao - p_frete_atual, 2);
  IF v_dif <= 0 THEN
    RAISE EXCEPTION 'EXP_RECOT_COBRANCA_NAO_ENCARECE: esta opcao nao encarece o frete (diferenca R$ %); use Aplicar', v_dif;
  END IF;

  IF p_id_transportadora IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.clientes c
        WHERE c.id_cliente = p_id_transportadora
          AND upper(coalesce(c.categoria, '')) = 'TRANSPORTADORA'
          AND c.ativo IS TRUE) THEN
    RAISE EXCEPTION 'EXP_RECOT_COBRANCA_SEM_CADASTRO: a opcao % nao tem transportadora cadastrada e ativa', coalesce(p_transportadora, '?');
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.notas_fiscais nf
                  WHERE nf.id_int = p_id_int AND nf.status = 'AUTORIZADA')
    INTO v_tem_nfe;

  v_sob := public.cc__total_soberano_proposta(p_id_int);

  -- So o vinculo da transportadora e a categoria, como no abono.
  UPDATE public.propostas
     SET id_transportadora_cliente = p_id_transportadora,
         categoria_frete = p_categoria_frete
   WHERE id_int = p_id_int;

  SELECT valor_frete, valor_total INTO v_depois FROM public.propostas WHERE id_int = p_id_int;
  IF v_depois.valor_frete IS DISTINCT FROM v_prop.valor_frete
     OR v_depois.valor_total IS DISTINCT FROM v_prop.valor_total THEN
    RAISE EXCEPTION 'EXP_RECOT_COBRANCA_TOTAL: o frete ou o total da proposta #% mudou na troca; nada foi gravado', p_id_int;
  END IF;

  INSERT INTO public.expedicao_recotacoes (
    id_int, chave, autor_uid, autor_nome, autor_email,
    frete_anterior, frete_novo, diferenca,
    total_anterior, total_novo, total_soberano_no_ato, divergencia_total,
    transportadora, servico, prazo, peso_gramas, peso_origem, subtotal_itens,
    id_endereco_entrega, cep,
    modalidade, status_interno, tinha_nfe_autorizada, valor_pago,
    ja_despachado, codigo_rastreamento, opcoes_cotadas, observacao,
    valor_opcao, id_transportadora_abono,
    cobranca_valor, cobranca_motivo, cobranca_tipo)
  VALUES (
    p_id_int, p_chave, v_uid, p_autor_nome, p_autor_email,
    round(p_frete_atual, 2), round(p_frete_atual, 2), 0,
    round(p_total_atual, 2), round(p_total_atual, 2),
    round(v_sob, 2), round(round(p_total_atual, 2) - v_sob, 2),
    p_transportadora, p_servico, p_prazo, p_peso_gramas, p_peso_origem,
    round(p_subtotal_itens, 2),
    p_id_endereco_entrega, p_cep,
    v_modalidade, v_prop.status_interno, v_tem_nfe, round(v_pago, 2),
    false, v_exp.codigo_rastreamento, p_opcoes_cotadas, 'TROCA_COBRANDO',
    round(p_valor_opcao, 2), p_id_transportadora,
    v_dif, btrim(p_motivo), v_tipo)
  RETURNING id INTO v_new_id;

  v_cob := public.exp__cobranca_da_troca(v_new_id);

  UPDATE public.expedicao_recotacoes SET id_cobranca = (v_cob->>'id')::uuid WHERE id = v_new_id;

  RETURN jsonb_build_object('id_recotacao', v_new_id, 'idempotente', false, 'cobranca', v_cob,
    'tinha_nfe_autorizada', v_tem_nfe);
END;
$function$;

REVOKE ALL ON FUNCTION public.exp_aplicar_recotacao_cobrando(bigint, uuid, numeric, numeric, numeric, text, text, text, bigint, text, integer, text, numeric, uuid, text, text, jsonb, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_aplicar_recotacao_cobrando(bigint, uuid, numeric, numeric, numeric, text, text, text, bigint, text, integer, text, numeric, uuid, text, text, jsonb, text, text, text, text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. SITUACAO, COBRAR DE NOVO E ABONAR (aba Pagamentos)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exp_troca_frete_situacao(p_id_int bigint)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',             r.id,
      'transportadora', coalesce(nullif(btrim(r.transportadora), ''), r.servico),
      'servico',        r.servico,
      'frete_cobrado',  r.frete_novo,
      'valor_opcao',    r.valor_opcao,
      'valor',          r.cobranca_valor,
      'tipo',           r.cobranca_tipo,
      'motivo',         r.cobranca_motivo,
      'autor',          r.autor_nome,
      'aplicado_em',    r.aplicado_em,
      'id_cobranca',    r.id_cobranca,
      'abono',          r.cobranca_abono_valor,
      'abonado_por',    r.cobranca_abonado_por_nome,
      'abono_motivo',   r.cobranca_abono_motivo,
      'pago',           c.pago,
      'cobranca_viva',  c.viva,
      'pendente',       greatest(0, r.cobranca_valor - coalesce(r.cobranca_abono_valor, 0) - c.pago)
    ) ORDER BY r.aplicado_em), '[]'::jsonb)
  FROM public.expedicao_recotacoes r
  CROSS JOIN LATERAL (
    SELECT
      coalesce(round((sum(p.valor) FILTER (
        WHERE p.status = 'PAID' OR (p.status = 'A_VENCER' AND p.confirmado = true)))::numeric, 2), 0) AS pago,
      (SELECT jsonb_build_object('id', v.id, 'id_pagamento', v.id_pagamento, 'status', v.status, 'valor', v.valor,
                                 'id_empresa', v.id_empresa, 'tipo_cobranca', v.tipo_cobranca,
                                 'pix_copia_cola', v.pix_copia_cola IS NOT NULL,
                                 'url_cobranca', v.url_cobranca)
         FROM public.pagamentos_v2 v
        WHERE v.id_troca_frete = r.id AND v.status IS DISTINCT FROM 'CANCELADO'
        ORDER BY v.created_at DESC LIMIT 1) AS viva
    FROM public.pagamentos_v2 p
    WHERE p.id_troca_frete = r.id AND p.status IS DISTINCT FROM 'CANCELADO'
  ) c
  WHERE r.id_int = p_id_int AND r.cobranca_valor IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public.exp_troca_frete_situacao(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_troca_frete_situacao(bigint) TO authenticated, service_role;

-- Cobranca cancelada (PIX vencido, boleto refeito): cria a proxima, pela forma escolhida.
CREATE OR REPLACE FUNCTION public.exp_troca_frete_cobrar(p_id_recotacao bigint, p_tipo_cobranca text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_r      public.expedicao_recotacoes%ROWTYPE;
  v_viva   public.pagamentos_v2%ROWTYPE;
  v_status text;
  v_tipo   text := upper(btrim(coalesce(p_tipo_cobranca, '')));
  v_pago   numeric;
BEGIN
  PERFORM public.cc__assert_permissao(v_uid, 'cobrancas.create');
  IF v_tipo NOT IN ('PIX', 'BOLETO', 'CARD_PARCELADO') THEN
    RAISE EXCEPTION 'EXP_TROCA_COBRANCA: forma de cobranca % invalida.', coalesce(p_tipo_cobranca, 'vazia') USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_r FROM public.expedicao_recotacoes WHERE id = p_id_recotacao AND cobranca_valor IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXP_TROCA_COBRANCA: troca % nao encontrada.', coalesce(p_id_recotacao::text, 'vazia') USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_viva FROM public.pagamentos_v2
   WHERE id_troca_frete = v_r.id AND status IS DISTINCT FROM 'CANCELADO'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_viva.id, 'id_pagamento', v_viva.id_pagamento, 'valor', v_viva.valor,
      'id_empresa', v_viva.id_empresa, 'tipo_cobranca', v_viva.tipo_cobranca, 'idempotente', true);
  END IF;
  IF v_r.cobranca_abono_valor IS NOT NULL THEN
    RAISE EXCEPTION 'EXP_TROCA_COBRANCA: a diferenca desta troca foi abonada.' USING ERRCODE = 'P0001';
  END IF;

  SELECT upper(btrim(coalesce(status_interno, ''))) INTO v_status FROM public.propostas WHERE id_int = v_r.id_int;
  IF v_status IN ('CANCELADO', 'ENTREGUE') THEN
    RAISE EXCEPTION 'EXP_TROCA_COBRANCA: o #% esta %; nao recebe cobranca nova.', v_r.id_int, v_status USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.expedicao_recotacoes SET cobranca_tipo = v_tipo WHERE id = v_r.id;
  RETURN public.exp__cobranca_da_troca(v_r.id);
END;
$function$;

REVOKE ALL ON FUNCTION public.exp_troca_frete_cobrar(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_troca_frete_cobrar(bigint, text) TO authenticated, service_role;

-- Abono da cobranca da troca: so administrador, com motivo, sem cobranca viva.
CREATE OR REPLACE FUNCTION public.exp_troca_frete_abonar(p_id_recotacao bigint, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_adm     boolean;
  v_nome    text;
  v_motivo  text := btrim(coalesce(p_motivo, ''));
  v_r       public.expedicao_recotacoes%ROWTYPE;
  v_viva    public.pagamentos_v2%ROWTYPE;
  v_pago    numeric;
  v_cli     bigint;
BEGIN
  SELECT coalesce(is_super_adm, false) OR coalesce(is_admin, false),
         coalesce(nullif(btrim(nome_usuario), ''), email)
    INTO v_adm, v_nome
    FROM public.usuarios WHERE user_id = v_uid;
  IF NOT coalesce(v_adm, false) THEN
    RAISE EXCEPTION 'EXP_TROCA_ABONO: somente administrador abona a diferenca de frete da troca.' USING ERRCODE = 'P0001';
  END IF;
  IF char_length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'EXP_TROCA_ABONO: descreva o motivo do abono (minimo 5 caracteres).' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_r FROM public.expedicao_recotacoes WHERE id = p_id_recotacao AND cobranca_valor IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXP_TROCA_ABONO: troca % nao encontrada.', coalesce(p_id_recotacao::text, 'vazia') USING ERRCODE = 'P0001';
  END IF;
  IF v_r.cobranca_abonado_em IS NOT NULL THEN
    RETURN jsonb_build_object('id_recotacao', v_r.id, 'abono', v_r.cobranca_abono_valor, 'idempotente', true);
  END IF;

  SELECT * INTO v_viva FROM public.pagamentos_v2
   WHERE id_troca_frete = v_r.id AND status IS DISTINCT FROM 'CANCELADO'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'EXP_TROCA_ABONO: a diferenca ja tem a cobranca % (%). %',
      coalesce(v_viva.id_pagamento, v_viva.id::text), v_viva.status,
      CASE WHEN v_viva.status = 'PAID' THEN 'Ja foi paga; nao ha o que abonar.'
           ELSE 'Cancele a cobranca antes de abonar.' END
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.expedicao_recotacoes
     SET cobranca_abono_valor = v_r.cobranca_valor, cobranca_abonado_por = v_uid,
         cobranca_abonado_por_nome = v_nome, cobranca_abonado_em = now(),
         cobranca_abono_motivo = v_motivo
   WHERE id = v_r.id;

  SELECT id_cliente INTO v_cli FROM public.propostas WHERE id_int = v_r.id_int;
  INSERT INTO public.propostas_chat (id_int, id_cliente, mensagem, tipo, autor_uid, autor_nome, setor, visivel_externo)
  VALUES (v_r.id_int, v_cli,
    format('Diferença de frete da troca para %s (%s) abonada por %s. Motivo: %s',
      coalesce(nullif(btrim(v_r.transportadora), ''), v_r.servico), public.exp__reais(v_r.cobranca_valor),
      coalesce(v_nome, 'Usuário'), v_motivo),
    'SISTEMA', v_uid, v_nome, 'Financeiro', false);

  RETURN jsonb_build_object('id_recotacao', v_r.id, 'abono', v_r.cobranca_valor, 'idempotente', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.exp_troca_frete_abonar(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_troca_frete_abonar(bigint, text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. TRAVA DE SALDO: ramo da troca cobrando (mesma assinatura, mesmos GRANTs)
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
  v_troca       record;
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

    -- Troca cobrando (26/11/2026): a diferenca de frete da troca de
    -- transportadora tambem esta fora do total e do pago; segura ate ser paga
    -- ou abonada. Sem troca cobrando, o retorno e o mesmo de sempre.
    SELECT round(sum(s.pendente), 2) AS pendente,
           (array_agg(s.transportadora ORDER BY s.aplicado_em) FILTER (WHERE s.pendente > 0))[1] AS transportadora
      INTO v_troca
      FROM jsonb_to_recordset(public.exp_troca_frete_situacao(p_id_int))
           AS s(pendente numeric, transportadora text, aplicado_em timestamptz);
    IF coalesce(v_troca.pendente, 0) > 0 THEN
      RETURN jsonb_build_object(
        'bloqueia', true,
        'situacao', 'SALDO_TROCA_FRETE',
        'total', v_total,
        'pago', v_pago,
        'saldo', v_troca.pendente,
        'mensagem',
          'Despacho bloqueado: falta receber ' || public.exp__reais(v_troca.pendente) ||
          ' da diferença de frete da troca para ' || coalesce(v_troca.transportadora, 'a transportadora nova') || '. ' ||
          'A cobrança está na aba Pagamentos da proposta (ou peça ao administrador para abonar); ' ||
          'despache depois que o pagamento for confirmado.'
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
-- 9. CONFERENCIA
-- -----------------------------------------------------------------------------
DO $confere$
DECLARE
  v_conf record;
  v_n integer;
BEGIN
  FOR v_conf IN
    SELECT * FROM (VALUES
      ('cc__valor_pago',                   'AND id_troca_frete IS NULL', 1),
      ('check_and_promote_proposta',       'AND id_troca_frete IS NULL', 1),
      ('rpc_relatorio_vendas',             'and pg.id_troca_frete is null', 1),
      ('rpc_relatorio_vendas_pagas',       'and pg.id_troca_frete is null', 1),
      ('rpc_relatorio_curva_abc_clientes', 'and pg.id_troca_frete is null', 1),
      ('rpc_relatorio_vendas_por_cidade',  'and pg.id_troca_frete is null', 1),
      ('rpc_dashboard_executivo',          'and p2.chave_reenvio is null and p2.id_troca_frete is null', 1),
      ('rpc_dashboard_vendedor',           'and p2.chave_reenvio is null and p2.id_troca_frete is null', 4),
      ('rpc_ranking_vendedores',           'and p2.chave_reenvio is null and p2.id_troca_frete is null', 1),
      ('exp_saldo_despacho',               'SALDO_TROCA_FRETE', 1)
    ) AS t(nome, trecho, vezes)
  LOOP
    SELECT (length(p.prosrc) - length(replace(p.prosrc, v_conf.trecho, ''))) / length(v_conf.trecho)
      INTO v_n
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_conf.nome;
    IF v_n IS DISTINCT FROM v_conf.vezes THEN
      RAISE EXCEPTION '% sem a exclusao da troca (% de % trechos).', v_conf.nome, v_n, v_conf.vezes;
    END IF;
  END LOOP;

  FOR v_conf IN
    SELECT * FROM (VALUES ('view_pagamentos_pagos'), ('view_pagamentos_pagos_v2'),
                          ('vw_relatorio_vendas_pagas_base'), ('vw_pagamentos_resumo')) AS t(nome)
  LOOP
    IF pg_get_viewdef(('public.' || v_conf.nome)::regclass) NOT LIKE '%id_troca_frete IS NULL%'
       OR pg_get_viewdef(('public.' || v_conf.nome)::regclass) NOT LIKE '%chave_reenvio IS NULL%' THEN
      RAISE EXCEPTION 'view % sem a exclusao das duas marcas.', v_conf.nome;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.pagamentos_v2'::regclass
                    AND tgname = 'trg_pgv2_troca_frete_marcador' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'trg_pgv2_troca_frete_marcador ausente ou desligado.';
  END IF;
  IF has_column_privilege('authenticated', 'public.pagamentos_v2', 'id_troca_frete', 'INSERT')
     OR has_column_privilege('authenticated', 'public.pagamentos_v2', 'id_troca_frete', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated consegue escrever pagamentos_v2.id_troca_frete.';
  END IF;
END
$confere$;
