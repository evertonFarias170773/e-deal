-- Faturamento: E-Amostra e E-Retrabalho param de somar.
--
-- POR QUE
--   Desde cd02e30 os dois viram PAID com o valor real da venda gravado na
--   linha. O valor precisa continuar ali — é o que fecha a cobertura da
--   proposta e o que permite saber quanto foi dado em cortesia. O que não pode
--   é entrar em faturamento, receita, ticket, comissão ou meta: amostra e
--   retrabalho são cortesia, não venda.
--
--   A exclusão é no CONSUMO, nunca no registro. Nada é zerado, nada é apagado.
--
-- E-PERMUTA NÃO ENTRA NESTA EXCLUSÃO
--   Permuta é moeda: a contrapartida foi recebida e a venda é real. Continua
--   somando em todos os pontos. O predicado `quitaNaLiberacao` do aplicativo
--   (cobrancas-utils.ts) inclui os TRÊS e responde outra pergunta — "quita ao
--   ser liberado?". NÃO é o mesmo conjunto e não deve ser espelhado aqui.
--
-- ONDE SE APLICA (3 objetos)
--   · view_pagamentos_pagos_v2   — funil: alimenta 3 blocos de
--                                  rpc_dashboard_executivo e a
--                                  get_dashboard_financeiro
--   · rpc_dashboard_vendedor     — 4 blocos (faturamento, série, curva ABC,
--                                  últimos pagamentos)
--   · rpc_ranking_vendedores     — 1 bloco (total, ticket, participação)
--
-- ONDE NÃO SE APLICA, POR DECISÃO DO DONO
--   · v_aprovadas_tipo, dentro de rpc_dashboard_executivo: o gráfico
--     "Aprovadas por tipo" MANTÉM a barra dos dois — é lá que se enxerga
--     quanto foi dado em cortesia;
--   · rpc_relatorio_vendas_pagas e vw_relatorio_vendas_pagas_base: são
--     extrato, não faturamento.
--
-- COBERTURA NÃO É FATURAMENTO
--   calcularSituacaoQuitacaoProposta, cc__valor_pago, vw_pagamentos_resumo, o
--   saldo restante e o valorPagoTotal das rotas continuam contando os dois. Se
--   deixassem, a proposta nunca fecharia e travaria em AGUARDANDO. Nenhum
--   deles é tocado aqui.
--
-- POR QUE AS DUAS FUNÇÕES SÃO REESCRITAS POR TRANSFORMAÇÃO, E NÃO COPIADAS
--   `rpc_dashboard_vendedor` tem 326 linhas e `rpc_ranking_vendedores`, 63.
--   Um CREATE OR REPLACE com o corpo transcrito à mão regride produção em
--   silêncio se o corpo vivo tiver divergido do que se copiou — e uma única
--   letra errada em 389 linhas não aparece em revisão.
--
--   O bloco abaixo lê o corpo VIVO, insere a condição e regrava. Tudo o que
--   não é a condição nova é carregado byte a byte, por construção. As guardas
--   são explícitas: a âncora tem de aparecer exatamente 4 vezes numa função e
--   1 na outra, e o corpo novo tem de ser exatamente o antigo mais as linhas
--   acrescentadas. Qualquer divergência levanta exceção e a migration inteira
--   é desfeita.
--
--   Custo assumido: este bloco não recria as funções num banco vazio — ele
--   depende de elas já existirem. É migration de produção, não de bootstrap.
--
-- A view é escrita à mão porque tem 5 linhas e cabe inteira na revisão.

-- ── 1. O predicado ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_conta_no_faturamento(p_tipo_cobranca text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  -- Falso APENAS para os dois tipos de cortesia. Qualquer outro valor conta,
  -- inclusive nulo, vazio e grafia desconhecida: na dúvida a receita aparece,
  -- porque esconder faturamento em silêncio é o dano pior.
  --
  -- E-PERMUTA conta. Permuta é venda liquidada pela contrapartida.
  SELECT upper(btrim(coalesce(p_tipo_cobranca, ''))) NOT IN ('E-AMOSTRA', 'E-RETRABALHO');
$function$;

COMMENT ON FUNCTION public.fn_conta_no_faturamento(text) IS
  'O valor desta cobranca entra em soma de faturamento/receita/ticket/comissao/meta? '
  'Falso so para E-AMOSTRA e E-RETRABALHO (cortesia). E-PERMUTA CONTA — permuta e venda '
  'liquidada pela contrapartida. Nao confundir com quitaNaLiberacao (cobrancas-utils.ts), '
  'que inclui os tres e responde outra pergunta. Cobertura de proposta NAO usa este '
  'predicado: la os dois continuam contando.';

-- ── 2. O funil: view_pagamentos_pagos_v2 ────────────────────────────────────
-- Idêntica à versão viva, mais a última condição.
CREATE OR REPLACE VIEW public.view_pagamentos_pagos_v2 AS
 SELECT ((data_confirmacao AT TIME ZONE 'America/Sao_Paulo'::text))::date AS data,
    id_empresa,
    status,
    sum(valor) AS total,
    count(*) AS quantidade
   FROM pagamentos_v2
  WHERE ((status = ANY (ARRAY['PAID'::text, 'A_VENCER'::text]))
     AND (confirmado = true)
     AND (data_confirmacao IS NOT NULL)
     AND public.fn_conta_no_faturamento(tipo_cobranca))
  GROUP BY (((data_confirmacao AT TIME ZONE 'America/Sao_Paulo'::text))::date), id_empresa, status;

-- ── 3. As duas RPCs, por transformação guardada ─────────────────────────────
DO $mig$
DECLARE
  r            record;
  v_def        text;
  v_novo       text;
  v_qtd        int;
  c_ancora     constant text := E'      and p2.data_confirmacao is not null\n';
  c_insercao   constant text := E'      and public.fn_conta_no_faturamento(p2.tipo_cobranca)\n';
BEGIN
  FOR r IN
    SELECT p.oid, p.proname,
           CASE p.proname
             WHEN 'rpc_dashboard_vendedor'  THEN 4   -- faturamento, serie, ABC, ultimos
             WHEN 'rpc_ranking_vendedores'  THEN 1
           END AS esperado
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('rpc_dashboard_vendedor', 'rpc_ranking_vendedores')
  LOOP
    v_def := pg_get_functiondef(r.oid);

    -- Idempotencia: rodar de novo nao empilha a condicao.
    IF position('fn_conta_no_faturamento' IN v_def) > 0 THEN
      RAISE NOTICE 'ja aplicada em %, nada a fazer', r.proname;
      CONTINUE;
    END IF;

    v_qtd := (length(v_def) - length(replace(v_def, c_ancora, ''))) / length(c_ancora);

    IF v_qtd IS DISTINCT FROM r.esperado THEN
      RAISE EXCEPTION
        'ANCORA_DIVERGENTE: % tem % ocorrencia(s) da ancora, esperado %. O corpo vivo divergiu do mapeado; nada foi alterado.',
        r.proname, v_qtd, r.esperado;
    END IF;

    v_novo := replace(v_def, c_ancora, c_ancora || c_insercao);

    -- O corpo novo tem de ser o antigo MAIS exatamente as linhas inseridas.
    -- Qualquer outra diferenca de tamanho significa que o replace pegou algo
    -- que nao devia.
    IF length(v_novo) <> length(v_def) + r.esperado * length(c_insercao) THEN
      RAISE EXCEPTION
        'DIFERENCA_INESPERADA em %: corpo novo tem % bytes, esperado %. Nada foi alterado.',
        r.proname, length(v_novo), length(v_def) + r.esperado * length(c_insercao);
    END IF;

    EXECUTE v_novo;
  END LOOP;
END
$mig$;

-- ── 4. Assercoes ────────────────────────────────────────────────────────────
-- Auto-verificacao: se qualquer uma falhar, a migration inteira e desfeita.
--
-- A linha de teste e criada dentro de um sub-bloco que SEMPRE termina em
-- excecao, entao ela e revertida junto com tudo o que os gatilhos escreveram
-- (propostas_chat, propostas.status_interno, audit). Nenhum gatilho de
-- pagamentos_v2 consome sequencia — conferido: id e gen_random_uuid(),
-- id_pagamento e derivado por contagem sob pg_advisory_xact_lock. Nada
-- sobrevive ao rollback.
DO $assert$
DECLARE
  v_id_int        int;
  v_id_cliente    int;
  v_valor         numeric := 987654.32;   -- valor absurdo, impossivel de confundir
  v_base          numeric;
  v_com_amostra   numeric;
  v_com_permuta   numeric;
  v_cobertura_antes numeric;
  v_cobertura_com   numeric;
BEGIN
  SELECT p.id_int, p.id_cliente
    INTO v_id_int, v_id_cliente
    FROM propostas p
   WHERE p.id_cliente IS NOT NULL
   ORDER BY p.id_int DESC
   LIMIT 1;

  IF v_id_int IS NULL THEN
    RAISE EXCEPTION 'ASSERCAO_SEM_PROPOSTA: nao ha proposta para ancorar o teste.';
  END IF;

  SELECT coalesce(sum(total), 0) INTO v_base FROM public.view_pagamentos_pagos_v2;

  -- Cobertura da proposta ANTES (tem de subir com a amostra: cobertura conta).
  SELECT coalesce(sum(valor), 0) INTO v_cobertura_antes
    FROM pagamentos_v2
   WHERE id_int = v_id_int AND status <> 'CANCELADO'
     AND (status = 'PAID' OR (status = 'A_VENCER' AND confirmado = true));

  BEGIN
    INSERT INTO pagamentos_v2
      (id_int, id_cliente, valor, status, tipo_cobranca, confirmado, confirmado_por,
       data_confirmacao, paid_at, id_empresa, descricao)
    VALUES
      (v_id_int, v_id_cliente, v_valor, 'PAID', 'E-AMOSTRA', true, 'ASSERCAO_MIGRATION',
       now(), now(), 1, 'Linha de assercao da migration - revertida');

    SELECT coalesce(sum(total), 0) INTO v_com_amostra FROM public.view_pagamentos_pagos_v2;

    SELECT coalesce(sum(valor), 0) INTO v_cobertura_com
      FROM pagamentos_v2
     WHERE id_int = v_id_int AND status <> 'CANCELADO'
       AND (status = 'PAID' OR (status = 'A_VENCER' AND confirmado = true));

    INSERT INTO pagamentos_v2
      (id_int, id_cliente, valor, status, tipo_cobranca, confirmado, confirmado_por,
       data_confirmacao, paid_at, id_empresa, descricao)
    VALUES
      (v_id_int, v_id_cliente, v_valor, 'PAID', 'E-PERMUTA', true, 'ASSERCAO_MIGRATION',
       now(), now(), 1, 'Linha de assercao da migration - revertida');

    SELECT coalesce(sum(total), 0) INTO v_com_permuta FROM public.view_pagamentos_pagos_v2;

    RAISE EXCEPTION 'ROLLBACK_ASSERCAO';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_ASSERCAO' THEN
      RAISE;
    END IF;
  END;

  -- (a) E-AMOSTRA confirmada NAO entra no faturamento.
  IF v_com_amostra <> v_base THEN
    RAISE EXCEPTION
      'ASSERCAO_A_FALHOU: E-AMOSTRA entrou no faturamento (base=%, com amostra=%).',
      v_base, v_com_amostra;
  END IF;

  -- (b) E-PERMUTA continua somando, com o valor exato.
  IF v_com_permuta <> v_base + v_valor THEN
    RAISE EXCEPTION
      'ASSERCAO_B_FALHOU: E-PERMUTA nao somou o valor esperado (base=%, com permuta=%, esperado=%).',
      v_base, v_com_permuta, v_base + v_valor;
  END IF;

  -- (c) A exclusao NAO vazou para a cobertura: la a amostra conta.
  IF v_cobertura_com <> v_cobertura_antes + v_valor THEN
    RAISE EXCEPTION
      'ASSERCAO_C_FALHOU: a exclusao vazou para a cobertura da proposta % (antes=%, com amostra=%).',
      v_id_int, v_cobertura_antes, v_cobertura_com;
  END IF;

  RAISE NOTICE 'Assercoes OK: base=%, amostra nao somou, permuta somou %, cobertura subiu %.',
    v_base, v_valor, v_valor;
END
$assert$;
