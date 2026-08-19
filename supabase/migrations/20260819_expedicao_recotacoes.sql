-- Parte C, Etapa 2 — ledger de recotacao de frete e a RPC que a aplica
--
-- O QUE E
--   Cria `public.expedicao_recotacoes` (livro-razao append-only, uma linha por
--   recotacao APLICADA) e `public.exp_aplicar_recotacao`, que grava o frete novo
--   na proposta e registra o ledger em UMA transacao.
--
-- POR QUE UMA RPC, E NAO TRES CHAMADAS DA ROTA
--   O PostgREST nao da transacao multi-statement. Tres escritas soltas
--   (UPDATE valor_frete, UPDATE valor_total, INSERT no ledger) deixariam duas
--   janelas em que o processo pode morrer com FRETE NOVO E TOTAL VELHO — a
--   incoerencia que esta etapa existe justamente para evitar. Dentro da funcao,
--   ou tudo, ou nada. A cotacao (I/O de rede) fica FORA: a rota cota, valida e
--   passa numeros ja apurados.
--
-- A REGRA CENTRAL: `valor_total` ANDA SO PELO DELTA DO FRETE
--   Esta etapa NAO escreve `valor_total = cc__total_soberano_proposta(...)`.
--   Escreve `valor_total = total_anterior + diferenca`.
--
--   O motivo esta em docs/business/CONTA-CORRENTE-CREDITO.md, item 13 da secao
--   4.2: `cc__total_soberano_proposta` ignora o desconto de tabela especial do
--   cliente (o trigger `trg_calcular_valor_sub_total` forca
--   `produtos_proposta.valor_sub_total` a ser o BRUTO, e a funcao so desconta
--   linhas de `desconto_proposta` com tipo DESCONTO_GERAL). Medido em
--   19/08/2026: das 28 propostas em que o total gravado diverge do soberano, 21
--   sao por tabela especial. Gravar o retorno da funcao mudaria o total dessas
--   propostas por MUITO mais que o frete — no pedido 20916, um frete R$ 3,00
--   mais barato viraria +R$ 103 de total.
--
--   Escrever pelo delta e legitimo porque as tres formulas em uso sao LINEARES
--   no frete, com coeficiente 1, e o frete nao interage com desconto nenhum:
--     cc__total_soberano_proposta, nao-avulsa : subtotal + frete - desconto(subtotal)
--     cc__total_soberano_proposta, avulsa     : valor + frete
--     app (calculateResumo)                   : subtotalProdutos - descontoGeral + frete
--   O bonus incide sobre itens, nunca sobre frete. Mover o total pelo delta e a
--   unica operacao sobre a qual as formulas concordam sem excecao.
--
--   A funcao NAO conserta e NAO piora a divergencia: ela a deixa como esta e a
--   REGISTRA, em `total_soberano_no_ato` e `divergencia_total`.
--
--   E PROTEGE A PREMISSA: depois das escritas, mede
--   `cc__total_soberano_proposta` de novo e ABORTA se a diferenca nao for
--   exatamente o delta do frete (EXP_RECOT_NAO_LINEAR). Se alguem tornar a
--   formula nao-linear no frete, a aplicacao para de funcionar em vez de gravar
--   total errado em silencio.
--
-- GATES SAO LIDOS DO BANCO, NUNCA RECEBIDOS POR PARAMETRO
--   Modalidade efetiva, NF-e autorizada, despacho e entrega sao consultados
--   DENTRO da transacao, junto com status, avulsa e pagamento. Gate que confia
--   no chamador nao e gate. Os parametros descritivos (transportadora, servico,
--   peso, endereco) alimentam so o ledger; `p_modalidade` e conferido contra a
--   leitura e recusado se divergir.
--
-- O QUE ESTA MIGRATION NAO FAZ
--   NAO toca `cotacao_frete` (os tres triggers dela reescrevem
--   `propostas.valor_total` e `status_interno` — secao 2 de EXPEDICAO.md).
--   NAO toca Conta Corrente: nenhuma pendencia, nenhum `movimento_credito`,
--   nenhuma chamada a `cc_abrir_pendencia`. A diferenca e registrada, nao
--   lancada — isso e Etapa 3 em diante.
--   NAO altera `expedicoes`, o schema de `propostas`, RLS existente ou trigger
--   nenhuma. NAO faz backfill.
--
-- ESCOPO DESTA ETAPA: SO O QUE BARATEIA
--   `exp_recot_dif_etapa2_ck` (diferenca <= 0) congela a restricao no schema:
--   encarecer e impossivel, mesmo por bug ou chamada direta. A Etapa 4 remove
--   esse CHECK por migration explicita, junto com a alcada — preferivel a uma
--   regra que viva so no TypeScript.
--
-- TIPOS: ATENCAO AO `valor_total`
--   `propostas.valor_frete` e numeric(10,2), mas `propostas.valor_total` e
--   DOUBLE PRECISION. Por isso:
--     - a guarda otimista de `valor_frete` e EXATA (numeric);
--     - a de `valor_total` usa tolerancia de R$ 0,005, porque comparacao exata
--       contra float e fragil por representacao;
--     - a escrita NAO arredonda: soma o delta e deixa o resto do valor como
--       estava. Ha 12 propostas nos status vivos com mais de duas casas em
--       `valor_total` (ex.: 12.702); arredondar mudaria o total por algo que nao
--       e o frete, contrariando a regra central.
--   O ledger guarda numeric(12,2), entao `total_anterior`/`total_novo` saem
--   arredondados la — internamente coerentes com `exp_recot_total_ck`.
--
-- ROLLBACK
--   DROP FUNCTION public.exp_aplicar_recotacao(...);
--   DROP TABLE public.expedicao_recotacoes;
--   Limpo ENQUANTO nenhuma recotacao tiver sido aplicada. Depois da primeira,
--   derrubar a tabela apaga a UNICA trilha de por que os fretes mudaram — os
--   dois UPDATEs em `propostas` continuam em `audit.logs_v2`, mas sem o motivo,
--   sem a cotacao de origem e sem o autor da decisao. Nesse caso, preferir
--   desativar a rota a derrubar o ledger.

-- ---------------------------------------------------------------------------
-- 1. LEDGER
-- ---------------------------------------------------------------------------

CREATE TABLE public.expedicao_recotacoes (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- bigint para casar com propostas.id_int, que e bigint (expedicoes.id_int e
  -- integer e nao tem FK; aqui a FK existe, entao o tipo precisa bater).
  id_int                bigint        NOT NULL REFERENCES public.propostas(id_int),
  chave                 uuid          NOT NULL,
  aplicado_em           timestamptz   NOT NULL DEFAULT now(),

  autor_uid             uuid,
  autor_nome            text,
  autor_email           text,

  frete_anterior        numeric(12,2) NOT NULL,
  frete_novo            numeric(12,2) NOT NULL,
  diferenca             numeric(12,2) NOT NULL,

  -- o total como a PROPOSTA o carrega: fonte da escrita
  total_anterior        numeric(12,2) NOT NULL,
  total_novo            numeric(12,2) NOT NULL,

  -- o total como a FORMULA SOBERANA o calcula, no instante da aplicacao.
  -- Nao alimenta escrita nenhuma: existe para a divergencia entre as duas
  -- formulas ficar visivel e datada em vez de silenciosa.
  total_soberano_no_ato numeric(12,2),
  divergencia_total     numeric(12,2),

  transportadora        text          NOT NULL,
  servico               text          NOT NULL,
  prazo                 text,
  peso_gramas           integer       NOT NULL,
  peso_origem           text,
  subtotal_itens        numeric(12,2) NOT NULL,
  id_endereco_entrega   uuid          REFERENCES public.enderecos(id),
  cep                   text,

  -- o estado do pedido no instante da aplicacao: por que os gates deixaram passar
  modalidade            text          NOT NULL,
  status_interno        text          NOT NULL,
  tinha_nfe_autorizada  boolean       NOT NULL,
  valor_pago            numeric(12,2) NOT NULL,
  ja_despachado         boolean       NOT NULL,
  codigo_rastreamento   text,

  -- a lista INTEIRA que foi cotada, nao so a escolhida: e o que permite
  -- responder depois "por que ele escolheu essa" sem recotar um passado que
  -- ja nao existe.
  opcoes_cotadas        jsonb,
  observacao            text,

  CONSTRAINT exp_recot_chave_uk        UNIQUE (chave),
  CONSTRAINT exp_recot_dif_coerente_ck CHECK (diferenca = frete_novo - frete_anterior),
  CONSTRAINT exp_recot_dif_etapa2_ck   CHECK (diferenca <= 0),
  CONSTRAINT exp_recot_total_ck        CHECK (total_novo = total_anterior + diferenca),
  CONSTRAINT exp_recot_modalidade_ck   CHECK (modalidade = 'CIF'),
  CONSTRAINT exp_recot_valores_ck      CHECK (frete_anterior >= 0 AND frete_novo >= 0 AND peso_gramas > 0)
);

COMMENT ON TABLE public.expedicao_recotacoes IS
  'Livro-razao APPEND-ONLY das recotacoes de frete aplicadas no despacho (Parte C, Etapa 2). Uma linha por aplicacao; a recotacao pode ocorrer mais de uma vez por pedido. chave e a idempotencia (unique). total_soberano_no_ato registra a divergencia com cc__total_soberano_proposta sem corrigi-la.';

COMMENT ON COLUMN public.expedicao_recotacoes.chave IS
  'Idempotencia. Nasce na tela (uma por opcao, quando o resultado da cotacao chega) e decide no banco: repetir a mesma chave nunca grava duas vezes.';

COMMENT ON COLUMN public.expedicao_recotacoes.total_soberano_no_ato IS
  'cc__total_soberano_proposta medido ANTES das escritas. So registro — a escrita usa total_anterior + diferenca. Ver CONTA-CORRENTE-CREDITO.md secao 4.2, item 13.';

-- Historico por pedido (a recotacao pode se repetir) e relatorio por periodo.
CREATE INDEX expedicao_recotacoes_id_int_idx
  ON public.expedicao_recotacoes (id_int, aplicado_em DESC);
CREATE INDEX expedicao_recotacoes_aplicado_em_idx
  ON public.expedicao_recotacoes (aplicado_em DESC);

-- ---------------------------------------------------------------------------
-- 2. RLS — molde de `expedicoes` em SELECT/INSERT, e nada alem disso
--    (`expedicoes` tem select USING(true) e insert/update exigindo apenas
--    id_int IS NOT NULL). Aqui NAO existe policy de UPDATE nem de DELETE:
--    livro-razao nao se edita. Isso e mais estrito que o molde, nunca menos.
-- ---------------------------------------------------------------------------

ALTER TABLE public.expedicao_recotacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY expedicao_recotacoes_select_authenticated
  ON public.expedicao_recotacoes FOR SELECT TO authenticated USING (true);

CREATE POLICY expedicao_recotacoes_insert_authenticated
  ON public.expedicao_recotacoes FOR INSERT TO authenticated WITH CHECK (id_int IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 3. RPC
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.exp_aplicar_recotacao(
  p_id_int               bigint,
  p_chave                uuid,
  p_frete_anterior       numeric,
  p_frete_novo           numeric,
  p_total_anterior       numeric,
  p_transportadora       text,
  p_servico              text,
  p_prazo                text,
  p_peso_gramas          integer,
  p_peso_origem          text,
  p_subtotal_itens       numeric,
  p_id_endereco_entrega  uuid,
  p_cep                  text,
  p_modalidade           text,
  p_opcoes_cotadas       jsonb,
  p_autor_nome           text,
  p_autor_email          text,
  p_observacao           text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  -- tolerancia so para comparar contra propostas.valor_total, que e float8
  c_tol_float  constant numeric := 0.005;
  v_uid        uuid := auth.uid();
  v_exist      bigint;
  v_prop       public.propostas%ROWTYPE;
  v_diferenca  numeric;
  v_total_ant  numeric;
  v_total_novo numeric;
  v_pago       numeric;
  v_sob_antes  numeric;
  v_sob_depois numeric;
  v_new_id     bigint;
  v_exp        public.expedicoes%ROWTYPE;
  v_tem_nfe    boolean;
  v_despachado boolean;
  v_modalidade text;
BEGIN
  PERFORM public.cc__assert_permissao(v_uid, 'expedicao.processar');

  IF p_id_int IS NULL OR p_chave IS NULL
     OR p_frete_anterior IS NULL OR p_frete_novo IS NULL OR p_total_anterior IS NULL THEN
    RAISE EXCEPTION 'EXP_RECOT_PARAMS: id_int, chave, fretes e total anterior sao obrigatorios';
  END IF;

  -- Idempotencia ANTES de qualquer gate de negocio. Mesmo padrao de
  -- cc_abrir_pendencia (chave_evento) e pelo mesmo motivo: a operacao ja
  -- aconteceu, e o estado atual pode reprovar num gate que ela mesma mudou.
  -- O unique(chave) segue como rede para corrida.
  SELECT id INTO v_exist FROM public.expedicao_recotacoes WHERE chave = p_chave;
  IF FOUND THEN RETURN v_exist; END IF;

  SELECT * INTO v_prop FROM public.propostas WHERE id_int = p_id_int FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXP_RECOT_PROPOSTA: proposta #% nao encontrada', p_id_int;
  END IF;

  -- Guarda otimista: a tela pode estar velha, mesmo sem concorrencia.
  IF v_prop.valor_frete IS DISTINCT FROM p_frete_anterior THEN
    RAISE EXCEPTION 'EXP_RECOT_CONCORRENCIA: o frete da proposta #% mudou (R$ % agora, R$ % na recotacao) - recote de novo',
      p_id_int, v_prop.valor_frete, p_frete_anterior;
  END IF;
  IF v_prop.valor_total IS NULL
     OR abs(v_prop.valor_total::numeric - p_total_anterior) > c_tol_float THEN
    RAISE EXCEPTION 'EXP_RECOT_CONCORRENCIA: o total da proposta #% mudou (R$ % agora, R$ % na recotacao) - recote de novo',
      p_id_int, v_prop.valor_total, p_total_anterior;
  END IF;

  -- Gates que dependem de DADO, nao de rede: revalidados aqui dentro.
  -- Avulsa fica de fora porque tg_propostas_valor_total_avulsa preenche
  -- valor_total sozinha quando ele e nulo ou zero, quebrando a separacao das
  -- duas escritas.
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

  -- NF-e e despacho sao LIDOS aqui, nunca recebidos por parametro: sao gates,
  -- e gate que confia no chamador nao e gate. A rota tambem os avalia, para
  -- responder 409 com mensagem boa antes de chegar ate aqui.
  SELECT EXISTS (SELECT 1 FROM public.notas_fiscais nf
                  WHERE nf.id_int = p_id_int AND nf.status = 'AUTORIZADA')
    INTO v_tem_nfe;

  SELECT * INTO v_exp FROM public.expedicoes WHERE id_int = p_id_int;

  -- Modalidade LIDA do banco, com a precedencia oficial (despacho > orcamento).
  -- O parametro p_modalidade so alimenta o ledger, e e conferido contra a
  -- leitura: gate que confia no chamador nao e gate.
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

  -- Excecao estreita: despacho SEM nada emitido foi so a marcacao da etapa, e
  -- desfazer e trivial. Com rastreio ou prepostagem, o frete ja foi contratado
  -- (nos Correios a prepostagem ja consumiu o cartao da empresa) e recotar
  -- passa a oferecer transportadora que nao vai levar nada.
  v_despachado := v_exp.data_despacho IS NOT NULL;
  IF v_despachado
     AND (v_exp.codigo_rastreamento IS NOT NULL OR v_exp.correios_id_prepostagem IS NOT NULL) THEN
    RAISE EXCEPTION 'EXP_RECOT_DESPACHADO: pedido #% ja despachado com rastreio/prepostagem emitidos (%)',
      p_id_int, COALESCE(v_exp.codigo_rastreamento, v_exp.correios_id_prepostagem);
  END IF;

  v_diferenca  := round(p_frete_novo - p_frete_anterior, 2);
  v_total_ant  := round(p_total_anterior, 2);
  v_total_novo := v_total_ant + v_diferenca;

  IF v_diferenca > 0 THEN
    RAISE EXCEPTION 'EXP_RECOT_ENCARECE: nesta etapa so recotacao que barateia ou empata (diferenca R$ %)', v_diferenca;
  END IF;
  IF v_tem_nfe AND v_diferenca >= 0 THEN
    RAISE EXCEPTION 'EXP_RECOT_NFE: com NF-e autorizada so o que barateia (diferenca R$ %)', v_diferenca;
  END IF;

  -- Retrato da divergencia ANTES de escrever: so registro, nunca fonte.
  v_sob_antes := public.cc__total_soberano_proposta(p_id_int);

  -- As duas escritas, explicitas e separadas.
  UPDATE public.propostas SET valor_frete = p_frete_novo WHERE id_int = p_id_int;
  -- Soma o delta sobre o valor que ja estava la, SEM arredondar o resto: o
  -- total anda pelo frete e por mais nada.
  UPDATE public.propostas
     SET valor_total = v_prop.valor_total + v_diferenca::double precision
   WHERE id_int = p_id_int;

  -- Assercao de linearidade: protege a regra central deste arquivo.
  v_sob_depois := public.cc__total_soberano_proposta(p_id_int);
  IF v_sob_antes IS NOT NULL AND v_sob_depois IS NOT NULL
     AND abs((v_sob_depois - v_sob_antes) - v_diferenca) > 0.01 THEN
    RAISE EXCEPTION 'EXP_RECOT_NAO_LINEAR: cc__total_soberano_proposta deixou de ser linear no frete (delta soberano R$ %, delta do frete R$ %) - a Etapa 2 nao pode gravar assim',
      round(v_sob_depois - v_sob_antes, 2), v_diferenca;
  END IF;

  INSERT INTO public.expedicao_recotacoes (
    id_int, chave, autor_uid, autor_nome, autor_email,
    frete_anterior, frete_novo, diferenca,
    total_anterior, total_novo, total_soberano_no_ato, divergencia_total,
    transportadora, servico, prazo, peso_gramas, peso_origem, subtotal_itens,
    id_endereco_entrega, cep,
    modalidade, status_interno, tinha_nfe_autorizada, valor_pago,
    ja_despachado, codigo_rastreamento, opcoes_cotadas, observacao)
  VALUES (
    p_id_int, p_chave, v_uid, p_autor_nome, p_autor_email,
    round(p_frete_anterior, 2), round(p_frete_novo, 2), v_diferenca,
    v_total_ant, v_total_novo,
    round(v_sob_antes, 2), round(v_total_ant - v_sob_antes, 2),
    p_transportadora, p_servico, p_prazo, p_peso_gramas, p_peso_origem,
    round(p_subtotal_itens, 2),
    p_id_endereco_entrega, p_cep,
    v_modalidade, v_prop.status_interno, v_tem_nfe, round(v_pago, 2),
    COALESCE(v_despachado, false), v_exp.codigo_rastreamento, p_opcoes_cotadas, p_observacao)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END; $$;

COMMENT ON FUNCTION public.exp_aplicar_recotacao(bigint, uuid, numeric, numeric, numeric, text, text, text, integer, text, numeric, uuid, text, text, jsonb, text, text, text) IS
  'Parte C, Etapa 2. Aplica UMA opcao da recotacao: grava valor_frete, move valor_total pelo delta do frete e registra o ledger, tudo em uma transacao. Idempotente por chave. NAO toca cotacao_frete nem Conta Corrente.';

REVOKE EXECUTE ON FUNCTION public.exp_aplicar_recotacao(bigint, uuid, numeric, numeric, numeric, text, text, text, integer, text, numeric, uuid, text, text, jsonb, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.exp_aplicar_recotacao(bigint, uuid, numeric, numeric, numeric, text, text, text, integer, text, numeric, uuid, text, text, jsonb, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- VERIFICACAO (rodar depois de aplicar)
--
-- a) Tabela, CHECKs e unique:
--    SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conrelid = 'public.expedicao_recotacoes'::regclass ORDER BY conname;
--    Esperado: 5 CHECK + 1 UNIQUE + 1 PK + 2 FK.
--
-- b) Indices:
--    SELECT indexdef FROM pg_indexes
--     WHERE schemaname = 'public' AND tablename = 'expedicao_recotacoes';
--    Esperado: pkey, chave_uk, id_int_idx, aplicado_em_idx.
--
-- c) RLS append-only — DUAS policies, nenhuma de UPDATE/DELETE:
--    SELECT polname, polcmd FROM pg_policy
--     WHERE polrelid = 'public.expedicao_recotacoes'::regclass ORDER BY polname;
--    Esperado exatamente: ..._insert_authenticated (a) e ..._select_authenticated (r).
--
-- d) RPC:
--    SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'exp_aplicar_recotacao';
--    Esperado: prosecdef = true, proconfig = {search_path=public, pg_temp}.
--
-- e) Nada tocado fora do escopo:
--    SELECT count(*) FROM conta_corrente_pendencias;   -- esperado 11
--    SELECT count(*) FROM cotacao_frete;               -- inalterado
--    SELECT count(*) FROM expedicao_recotacoes;        -- esperado 0
-- ---------------------------------------------------------------------------
