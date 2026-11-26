-- Trocar a transportadora ABONANDO a diferenca do frete (26/11/2026)
--
-- Decisao do Everton (26/11/2026): com a permissao nova `frete.trocar_abonando`
-- (perfil Administrador), a opcao da recotacao que ENCARECE pode ser aplicada
-- como abono:
--   - a transportadora muda para a da opcao (propostas.id_transportadora_cliente
--     e categoria_frete, as mesmas duas colunas que /api/propostas/transportadora
--     ja grava);
--   - o frete cobrado (propostas.valor_frete) e o total (valor_total) NAO mudam;
--     cotacao_frete, pagamentos_v2 e boletos nao sao tocados;
--   - a diferenca fica no historico da recotacao (expedicao_recotacoes): valor
--     da opcao, valor abonado, quem, quando e motivo obrigatorio;
--   - com NF-e autorizada a troca e permitida (o valor da nota nao muda); a tela
--     avisa para emitir CC-e com a transportadora nova.
-- Sem a permissao nada muda: exp_aplicar_recotacao continua recusando o que
-- encarece (EXP_RECOT_ENCARECE).
--
-- Casos que motivaram: 25824 (SEDEX 24,46 -> VEPPO 45,66) e 25484 (SEDEX 134,90
-- -> Sao Miguel 155,00, com NF-e 41715/41716 autorizadas).
--
-- Quem le a linha do abono:
--   exp_trava_frete_despacho: a ultima recotacao e a referencia de CEP e
--     transporte. O servico da opcao (VEPPO, SAO MIGUEL) vira TRANSPORTADORA em
--     exp__tipo_frete_do_texto, entao despachar pela transportadora abonada nao
--     diverge. O frete comparado continua sendo propostas.valor_frete.
--   exp_saldo_despacho: o total nao muda, o saldo nao muda.
--   Relatorio "Frete cobrado por transportadora": soma o abono a parte.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.exp_aplicar_recotacao_abono(bigint, uuid, numeric, numeric, numeric, text, text, text, bigint, text, integer, text, numeric, uuid, text, text, jsonb, text, text, text);
--   ALTER TABLE public.expedicao_recotacoes DROP CONSTRAINT IF EXISTS exp_recot_abono_ck;
--   ALTER TABLE public.expedicao_recotacoes DROP COLUMN IF EXISTS abono_valor, DROP COLUMN IF EXISTS abono_motivo,
--     DROP COLUMN IF EXISTS valor_opcao, DROP COLUMN IF EXISTS id_transportadora_abono;
--     (so depois de nao haver linha de abono)
--   UPDATE public.perfis SET permissoes = permissoes - 'frete.trocar_abonando' WHERE id = 2;

-- 1. Colunas do abono no historico da recotacao
ALTER TABLE public.expedicao_recotacoes
  ADD COLUMN IF NOT EXISTS valor_opcao numeric(12,2),
  ADD COLUMN IF NOT EXISTS abono_valor numeric(12,2),
  ADD COLUMN IF NOT EXISTS abono_motivo text,
  ADD COLUMN IF NOT EXISTS id_transportadora_abono bigint;

-- Linha de abono: o frete cobrado nao anda (diferenca 0, total igual), e a
-- opcao contratada custa o frete cobrado + o abono.
ALTER TABLE public.expedicao_recotacoes DROP CONSTRAINT IF EXISTS exp_recot_abono_ck;
ALTER TABLE public.expedicao_recotacoes
  ADD CONSTRAINT exp_recot_abono_ck CHECK (
    abono_valor IS NULL
    OR (abono_valor > 0
        AND diferenca = 0
        AND frete_novo = frete_anterior
        AND total_novo = total_anterior
        AND valor_opcao = frete_novo + abono_valor
        AND id_transportadora_abono IS NOT NULL
        AND length(btrim(coalesce(abono_motivo, ''))) >= 5)
  );

COMMENT ON COLUMN public.expedicao_recotacoes.abono_valor IS
  'Troca de transportadora abonando a diferenca (26/11/2026): valor que a empresa absorve. frete_novo = frete_anterior (o cliente nao paga a mais); valor_opcao = frete cobrado + abono.';
COMMENT ON COLUMN public.expedicao_recotacoes.valor_opcao IS
  'Valor cotado da opcao aplicada como abono: o custo real do transporte. Nulo nas aplicacoes normais (ali o custo e frete_novo).';

-- 2. A troca abonando
CREATE OR REPLACE FUNCTION public.exp_aplicar_recotacao_abono(
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
  p_motivo               text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_tol_float  constant numeric := 0.005;
  v_uid        uuid := auth.uid();
  v_exist      bigint;
  v_prop       public.propostas%ROWTYPE;
  v_depois     record;
  v_exp        public.expedicoes%ROWTYPE;
  v_pago       numeric;
  v_tem_nfe    boolean;
  v_modalidade text;
  v_abono      numeric;
  v_sob        numeric;
  v_new_id     bigint;
BEGIN
  PERFORM public.cc__assert_permissao(v_uid, 'frete.trocar_abonando');

  IF p_id_int IS NULL OR p_chave IS NULL OR p_frete_atual IS NULL
     OR p_valor_opcao IS NULL OR p_total_atual IS NULL THEN
    RAISE EXCEPTION 'EXP_RECOT_PARAMS: id_int, chave, frete, valor da opcao e total sao obrigatorios';
  END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 5 THEN
    RAISE EXCEPTION 'EXP_RECOT_ABONO_MOTIVO: escreva o motivo do abono (pelo menos 5 letras)';
  END IF;

  SELECT id INTO v_exist FROM public.expedicao_recotacoes WHERE chave = p_chave;
  IF FOUND THEN RETURN v_exist; END IF;

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
    RAISE EXCEPTION 'EXP_RECOT_DESPACHADO: pedido #% ja foi despachado; a troca abonando vale antes do despacho', p_id_int;
  END IF;

  v_abono := round(p_valor_opcao - p_frete_atual, 2);
  IF v_abono <= 0 THEN
    RAISE EXCEPTION 'EXP_RECOT_ABONO_NAO_ENCARECE: esta opcao nao encarece o frete (diferenca R$ %); use Aplicar', v_abono;
  END IF;

  IF p_id_transportadora IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.clientes c
        WHERE c.id_cliente = p_id_transportadora
          AND upper(coalesce(c.categoria, '')) = 'TRANSPORTADORA'
          AND c.ativo IS TRUE) THEN
    RAISE EXCEPTION 'EXP_RECOT_ABONO_SEM_CADASTRO: a opcao % nao tem transportadora cadastrada e ativa', coalesce(p_transportadora, '?');
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.notas_fiscais nf
                  WHERE nf.id_int = p_id_int AND nf.status = 'AUTORIZADA')
    INTO v_tem_nfe;

  v_sob := public.cc__total_soberano_proposta(p_id_int);

  -- So o vinculo da transportadora e a categoria. Frete, total, cotacao_frete,
  -- modalidade e status ficam como estao.
  UPDATE public.propostas
     SET id_transportadora_cliente = p_id_transportadora,
         categoria_frete = p_categoria_frete
   WHERE id_int = p_id_int;

  SELECT valor_frete, valor_total INTO v_depois FROM public.propostas WHERE id_int = p_id_int;
  IF v_depois.valor_frete IS DISTINCT FROM v_prop.valor_frete
     OR v_depois.valor_total IS DISTINCT FROM v_prop.valor_total THEN
    RAISE EXCEPTION 'EXP_RECOT_ABONO_TOTAL: o frete ou o total da proposta #% mudou na troca; nada foi gravado', p_id_int;
  END IF;

  INSERT INTO public.expedicao_recotacoes (
    id_int, chave, autor_uid, autor_nome, autor_email,
    frete_anterior, frete_novo, diferenca,
    total_anterior, total_novo, total_soberano_no_ato, divergencia_total,
    transportadora, servico, prazo, peso_gramas, peso_origem, subtotal_itens,
    id_endereco_entrega, cep,
    modalidade, status_interno, tinha_nfe_autorizada, valor_pago,
    ja_despachado, codigo_rastreamento, opcoes_cotadas, observacao,
    valor_opcao, abono_valor, abono_motivo, id_transportadora_abono)
  VALUES (
    p_id_int, p_chave, v_uid, p_autor_nome, p_autor_email,
    round(p_frete_atual, 2), round(p_frete_atual, 2), 0,
    round(p_total_atual, 2), round(p_total_atual, 2),
    round(v_sob, 2), round(round(p_total_atual, 2) - v_sob, 2),
    p_transportadora, p_servico, p_prazo, p_peso_gramas, p_peso_origem,
    round(p_subtotal_itens, 2),
    p_id_endereco_entrega, p_cep,
    v_modalidade, v_prop.status_interno, v_tem_nfe, round(v_pago, 2),
    false, v_exp.codigo_rastreamento, p_opcoes_cotadas, 'ABONO',
    round(p_valor_opcao, 2), v_abono, btrim(p_motivo), p_id_transportadora)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.exp_aplicar_recotacao_abono(bigint, uuid, numeric, numeric, numeric, text, text, text, bigint, text, integer, text, numeric, uuid, text, text, jsonb, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_aplicar_recotacao_abono(bigint, uuid, numeric, numeric, numeric, text, text, text, bigint, text, integer, text, numeric, uuid, text, text, jsonb, text, text, text) TO authenticated, service_role;

-- 3. A permissao, no perfil Administrador (o Super Administrador ja tem '*')
UPDATE public.perfis
   SET permissoes = permissoes || '["frete.trocar_abonando"]'::jsonb
 WHERE id = 2
   AND NOT (permissoes ? 'frete.trocar_abonando');
