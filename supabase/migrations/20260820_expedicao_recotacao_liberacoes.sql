-- Liberacao da recotacao de frete: o expedidor deixa de ter autonomia
--
-- O QUE E
--   Cria `public.expedicao_recotacao_liberacoes` (autorizacao POR PEDIDO, dada
--   por um admin), as RPCs `exp_liberar_recotacao` e `exp_revogar_recotacao`, e
--   redefine `exp_aplicar_recotacao` para CONSUMIR a liberacao dentro da mesma
--   transacao das escritas.
--
-- POR QUE
--   Decisao do dono em 20/08/2026: recotar frete deixa de ser autonomia do
--   expedidor. O botao "Recotar frete" no DespacharModal nasce BLOQUEADO e um
--   admin libera caso a caso, pelo menu Acoes da Expedicao.
--
--   Uma liberacao cobre O FLUXO INTEIRO — ver as opcoes (rota `cotar`) e
--   aplicar uma delas (rota `aplicar`). E de USO UNICO: consumida quando uma
--   aplicacao acontece, e o botao volta a bloquear. Recotar sem aplicar NAO
--   consome; a liberacao vale ate ser consumida ou revogada.
--
-- POR QUE TABELA PROPRIA, E NAO COLUNAS EM `expedicoes`
--   `expedicoes` tem UNIQUE (id_int): uma linha por pedido. Como o mesmo pedido
--   pode ser liberado varias vezes ao longo do tempo, colunas ali guardariam so
--   a ultima liberacao e apagariam o historico a cada nova. Alem disso
--   `expedicoes` e escrita pelo fluxo de despacho — por uma autorizacao no meio
--   dela e convidar sobrescrita acidental.
--
-- UMA LIBERACAO ATIVA POR PEDIDO — GARANTIDA PELO BANCO
--   `exp_lib_uma_ativa_por_pedido` e um indice unico PARCIAL sobre `id_int`
--   filtrando `consumida_em IS NULL AND revogada_em IS NULL`. Mesma tecnica de
--   `ux_ccp_uma_aberta_por_proposta` na Conta Corrente. Liberar um pedido que ja
--   tem liberacao ativa nao cria segunda linha: a RPC devolve a existente, e a
--   rota responde de forma idempotente ("ja esta liberado desde ...").
--
-- O CONSUMO E ATOMICO — E ESSE E O PONTO
--   Dentro de `exp_aplicar_recotacao`:
--
--     UPDATE ... SET consumida_em = now()
--      WHERE id_int = p_id_int AND consumida_em IS NULL AND revogada_em IS NULL
--     RETURNING id INTO v_liberacao;
--     IF NOT FOUND THEN RAISE 'EXP_RECOT_SEM_LIBERACAO' ...
--
--   O `WHERE ... IS NULL RETURNING` e a reivindicacao: duas aplicacoes
--   simultaneas nao passam com uma liberacao so, porque a segunda transacao
--   bloqueia na trava de linha e, quando entra, ja ve `consumida_em` preenchida,
--   casa zero linhas e levanta. Nao existe janela.
--
--   ORDEM DENTRO DA FUNCAO, e ela importa:
--     1. permissao
--     2. IDEMPOTENCIA por `chave` (retorno antecipado)   <-- ANTES do consumo
--     3. trava da proposta + guardas otimistas
--     4. gates (avulsa, status, pago, modalidade, NF-e, despacho, encarece)
--     5. CONSUMO da liberacao                            <-- depois dos gates,
--     6. as duas escritas em `propostas`                     antes das escritas
--     7. assercao de linearidade
--     8. INSERT no ledger
--     9. UPDATE da liberacao com `id_recotacao`          <-- depois do INSERT
--
--   O passo 2 vir antes do 5 e deliberado: um retry de rede com a MESMA chave
--   devolve o registro anterior e NAO queima uma segunda liberacao do admin.
--
-- SOBRE O CHECK DE COERENCIA DO CONSUMO
--   Entre os passos 5 e 9 a linha fica, de propósito, com `consumida_em`
--   preenchida e `id_recotacao` ainda nula. CHECK no Postgres e avaliado por
--   statement e nao pode ser DEFERRABLE, entao a restricao so pode valer no
--   sentido que e verdadeiro o tempo todo: ter `id_recotacao` exige estar
--   consumida. O sentido inverso (consumida sem `id_recotacao` depois do
--   commit) seria bug, e esta na verificacao (f) do rodape, nao numa constraint.
--
-- REVOGACAO
--   Liberacao dada por engano se desfaz: `revogada_em`, `revogada_por_uid`,
--   `revogada_por_nome` e `motivo_revogacao`, pela RPC `exp_revogar_recotacao`,
--   com a MESMA permissao de liberar. So alcanca liberacao ativa e NAO
--   consumida — o que ja foi usado nao se desfaz por aqui.
--
-- PERMISSAO: `expedicao.admin`, QUE JA EXISTE
--   A chave esta no catalogo editavel de perfis (PerfisPermissoesPanel.tsx) e
--   nao era usada em lugar nenhum do codigo. Este e o uso dela. Vale o fallback
--   padrao do projeto, implementado em `cc__assert_permissao`: `is_super_adm`
--   passa sempre; a chave no perfil passa; `is_admin` passa por fallback. Ou
--   seja, a chave NAO restringe quem ja e admin — ela existe para poder delegar
--   a liberacao a um supervisor sem dar admin geral do ERP.
--
-- SEM EXPIRACAO POR TEMPO
--   A liberacao expira por CONSUMO ou por REVOGACAO, nunca por prazo. Nao ha
--   job para varrer, e expiracao preguicosa espalharia a mesma regra de prazo
--   por tres lugares (UI, `cotar`, `aplicar`). Nao existe coluna `expira_em`: se
--   um dia for preciso, nasce aditiva e nula.
--
-- TRILHA
--   A tabela e a trilha primaria (quem liberou, quando, quando consumiu, por
--   qual aplicacao, quem revogou e por que). Ela SOFRE UPDATE — diferente de
--   `expedicao_recotacoes`, que e append-only — entao leva o trigger de
--   auditoria `audit.log_row_changes_v2()`, o mesmo de `propostas`.
--   As linhas de timeline em `propostas_chat` sao gravadas pelas ROTAS, em
--   best-effort e fora da transacao, no mesmo padrao ja usado na aplicacao:
--   falhar a timeline nunca desfaz a autorizacao.
--
-- O QUE ESTA MIGRATION NAO FAZ
--   NAO cria liberacao retroativa para o pedido 20960, que teve a aplicacao #1
--   do ledger em 20/08/2026, ANTES desta regra existir. Liberacao e autorizacao
--   previa; fabricar uma depois inventaria um ato administrativo que nao houve e
--   o assinaria em nome de alguem. O ledger ja guarda autor, data e valores
--   daquela aplicacao. Na pratica o 20960 volta a ficar bloqueado como todos os
--   outros — que e exatamente o comportamento desejado.
--   NAO toca `cotacao_frete`, `expedicoes`, `propostas` (schema) nem Conta
--   Corrente. NAO altera o ledger `expedicao_recotacoes`. NAO faz backfill.

-- ---------------------------------------------------------------------------
-- 1. TABELA
-- ---------------------------------------------------------------------------

CREATE TABLE public.expedicao_recotacao_liberacoes (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_int              bigint      NOT NULL REFERENCES public.propostas(id_int),

  liberado_em         timestamptz NOT NULL DEFAULT now(),
  liberado_por_uid    uuid,
  liberado_por_nome   text,
  liberado_por_email  text,
  motivo              text,

  -- consumo: acontece na transacao de exp_aplicar_recotacao
  consumida_em        timestamptz,
  id_recotacao        bigint      REFERENCES public.expedicao_recotacoes(id),

  -- revogacao: desfaz liberacao dada por engano, so enquanto nao consumida
  revogada_em         timestamptz,
  revogada_por_uid    uuid,
  revogada_por_nome   text,
  motivo_revogacao    text,

  -- Ter `id_recotacao` exige estar consumida. O inverso e transitoriamente
  -- falso por desenho (ver cabecalho) e por isso nao vira constraint.
  CONSTRAINT exp_lib_recotacao_ck
    CHECK (id_recotacao IS NULL OR consumida_em IS NOT NULL),

  -- Consumida e revogada sao mutuamente exclusivas: ou foi usada, ou foi
  -- desfeita antes de ser usada.
  CONSTRAINT exp_lib_consumo_xor_revogacao_ck
    CHECK (consumida_em IS NULL OR revogada_em IS NULL),

  -- Campos de revogacao so existem acompanhados da data.
  CONSTRAINT exp_lib_revogacao_coerente_ck
    CHECK (revogada_em IS NOT NULL
           OR (revogada_por_uid IS NULL AND revogada_por_nome IS NULL AND motivo_revogacao IS NULL))
);

COMMENT ON TABLE public.expedicao_recotacao_liberacoes IS
  'Autorizacao POR PEDIDO para recotar frete no despacho. Dada por admin (expedicao.admin), cobre ver as opcoes e aplicar uma delas, e e de uso unico: consumida pela aplicacao. Recotar sem aplicar nao consome. Sem expiracao por tempo — so consumo ou revogacao.';

COMMENT ON COLUMN public.expedicao_recotacao_liberacoes.consumida_em IS
  'Preenchida DENTRO da transacao de exp_aplicar_recotacao, depois dos gates e antes das escritas. O UPDATE ... WHERE consumida_em IS NULL RETURNING e o que impede duas aplicacoes simultaneas de passarem com uma liberacao so.';

COMMENT ON COLUMN public.expedicao_recotacao_liberacoes.id_recotacao IS
  'Qual aplicacao consumiu esta liberacao. Preenchida no fim da mesma transacao, depois do INSERT no ledger — que e append-only e por isso nao aponta de volta.';

-- UMA liberacao ATIVA por pedido. Consumida ou revogada libera o slot para uma
-- nova, o que mantem o historico completo em vez de sobrescrever.
CREATE UNIQUE INDEX exp_lib_uma_ativa_por_pedido
  ON public.expedicao_recotacao_liberacoes (id_int)
  WHERE consumida_em IS NULL AND revogada_em IS NULL;

CREATE INDEX exp_lib_id_int_idx
  ON public.expedicao_recotacao_liberacoes (id_int, liberado_em DESC);

-- ---------------------------------------------------------------------------
-- 2. RLS — leitura para authenticated; NENHUMA escrita por PostgREST
--    Insert, update e delete acontecem SO pelas RPCs SECURITY DEFINER abaixo.
--    Sem policy de UPDATE, ninguem "desconsome" uma liberacao pela API.
-- ---------------------------------------------------------------------------

ALTER TABLE public.expedicao_recotacao_liberacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY expedicao_recotacao_liberacoes_select_authenticated
  ON public.expedicao_recotacao_liberacoes FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- 3. AUDITORIA
--    Esta tabela SOFRE UPDATE (consumo e revogacao), diferente do ledger
--    `expedicao_recotacoes`, que e append-only e portanto e a propria trilha.
--    Mesmo trigger de `propostas` (trg_audit_propostas).
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_audit_expedicao_recotacao_liberacoes
  AFTER INSERT OR UPDATE OR DELETE ON public.expedicao_recotacao_liberacoes
  FOR EACH ROW EXECUTE FUNCTION audit.log_row_changes_v2();

-- ---------------------------------------------------------------------------
-- 4. RPC — LIBERAR
--    Idempotente: liberar pedido que ja tem liberacao ativa devolve a existente
--    em vez de criar segunda linha ou levantar erro. Quem garante e o indice
--    parcial; a funcao apenas le antes para responder bem.
--    `p_autor_nome` e `p_autor_email` sao descritivos, para a tela; a autoria
--    que vale e `auth.uid()`, lida da sessao e nunca do chamador.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.exp_liberar_recotacao(
  p_id_int      bigint,
  p_motivo      text DEFAULT NULL,
  p_autor_nome  text DEFAULT NULL,
  p_autor_email text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_exist bigint;
  v_new   bigint;
BEGIN
  PERFORM public.cc__assert_permissao(v_uid, 'expedicao.admin');

  IF p_id_int IS NULL THEN
    RAISE EXCEPTION 'EXP_LIB_PARAMS: id_int e obrigatorio';
  END IF;

  PERFORM 1 FROM public.propostas WHERE id_int = p_id_int;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXP_LIB_PROPOSTA: proposta #% nao encontrada', p_id_int;
  END IF;

  SELECT id INTO v_exist
    FROM public.expedicao_recotacao_liberacoes
   WHERE id_int = p_id_int AND consumida_em IS NULL AND revogada_em IS NULL;
  IF FOUND THEN RETURN v_exist; END IF;

  INSERT INTO public.expedicao_recotacao_liberacoes
    (id_int, liberado_por_uid, liberado_por_nome, liberado_por_email, motivo)
  VALUES (p_id_int, v_uid, p_autor_nome, p_autor_email, p_motivo)
  RETURNING id INTO v_new;

  RETURN v_new;
END; $$;

COMMENT ON FUNCTION public.exp_liberar_recotacao(bigint, text, text, text) IS
  'Libera a recotacao de frete de UM pedido. Permissao expedicao.admin. Idempotente: pedido ja liberado devolve a liberacao existente.';

REVOKE EXECUTE ON FUNCTION public.exp_liberar_recotacao(bigint, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.exp_liberar_recotacao(bigint, text, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.exp_liberar_recotacao(bigint, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. RPC — REVOGAR
--    Mesma permissao de liberar. So alcanca liberacao ATIVA e NAO consumida:
--    autorizacao ja usada nao se desfaz por aqui.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.exp_revogar_recotacao(
  p_id_int      bigint,
  p_motivo      text DEFAULT NULL,
  p_autor_nome  text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  bigint;
BEGIN
  PERFORM public.cc__assert_permissao(v_uid, 'expedicao.admin');

  IF p_id_int IS NULL THEN
    RAISE EXCEPTION 'EXP_LIB_PARAMS: id_int e obrigatorio';
  END IF;

  UPDATE public.expedicao_recotacao_liberacoes
     SET revogada_em      = now(),
         revogada_por_uid = v_uid,
         revogada_por_nome = p_autor_nome,
         motivo_revogacao = p_motivo
   WHERE id_int = p_id_int
     AND consumida_em IS NULL
     AND revogada_em IS NULL
  RETURNING id INTO v_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXP_LIB_SEM_ATIVA: o pedido #% nao tem liberacao ativa para revogar', p_id_int;
  END IF;

  RETURN v_id;
END; $$;

COMMENT ON FUNCTION public.exp_revogar_recotacao(bigint, text, text) IS
  'Revoga a liberacao ATIVA e nao consumida de um pedido. Permissao expedicao.admin. Liberacao ja consumida nao e alcancada.';

REVOKE EXECUTE ON FUNCTION public.exp_revogar_recotacao(bigint, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.exp_revogar_recotacao(bigint, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.exp_revogar_recotacao(bigint, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. RPC — APLICAR, redefinida com o consumo
--    Assinatura inalterada. A unica mudanca de comportamento e o consumo da
--    liberacao (passos 5 e 9 da ordem descrita no cabecalho).
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
  v_liberacao  bigint;
BEGIN
  -- 1. permissao
  PERFORM public.cc__assert_permissao(v_uid, 'expedicao.processar');

  IF p_id_int IS NULL OR p_chave IS NULL
     OR p_frete_anterior IS NULL OR p_frete_novo IS NULL OR p_total_anterior IS NULL THEN
    RAISE EXCEPTION 'EXP_RECOT_PARAMS: id_int, chave, fretes e total anterior sao obrigatorios';
  END IF;

  -- 2. IDEMPOTENCIA, antes de tudo. Um retry de rede com a mesma chave devolve
  --    o registro anterior e NAO queima uma segunda liberacao do admin.
  SELECT id INTO v_exist FROM public.expedicao_recotacoes WHERE chave = p_chave;
  IF FOUND THEN RETURN v_exist; END IF;

  -- 3. trava da proposta + guardas otimistas
  SELECT * INTO v_prop FROM public.propostas WHERE id_int = p_id_int FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXP_RECOT_PROPOSTA: proposta #% nao encontrada', p_id_int;
  END IF;

  IF v_prop.valor_frete IS DISTINCT FROM p_frete_anterior THEN
    RAISE EXCEPTION 'EXP_RECOT_CONCORRENCIA: o frete da proposta #% mudou (R$ % agora, R$ % na recotacao) - recote de novo',
      p_id_int, v_prop.valor_frete, p_frete_anterior;
  END IF;
  IF v_prop.valor_total IS NULL
     OR abs(v_prop.valor_total::numeric - p_total_anterior) > c_tol_float THEN
    RAISE EXCEPTION 'EXP_RECOT_CONCORRENCIA: o total da proposta #% mudou (R$ % agora, R$ % na recotacao) - recote de novo',
      p_id_int, v_prop.valor_total, p_total_anterior;
  END IF;

  -- 4. gates
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

  SELECT EXISTS (SELECT 1 FROM public.notas_fiscais nf
                  WHERE nf.id_int = p_id_int AND nf.status = 'AUTORIZADA')
    INTO v_tem_nfe;

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

  -- 5. CONSUMO DA LIBERACAO — depois dos gates, antes das escritas.
  --    A reivindicacao e o proprio UPDATE: duas aplicacoes simultaneas nao
  --    passam com uma liberacao so, porque a segunda encontra consumida_em ja
  --    preenchida e casa zero linhas.
  UPDATE public.expedicao_recotacao_liberacoes
     SET consumida_em = now()
   WHERE id_int = p_id_int
     AND consumida_em IS NULL
     AND revogada_em IS NULL
  RETURNING id INTO v_liberacao;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXP_RECOT_SEM_LIBERACAO: a recotacao do pedido #% nao esta liberada por um administrador', p_id_int;
  END IF;

  v_sob_antes := public.cc__total_soberano_proposta(p_id_int);

  -- 6. as duas escritas, explicitas e separadas
  UPDATE public.propostas SET valor_frete = p_frete_novo WHERE id_int = p_id_int;
  UPDATE public.propostas
     SET valor_total = v_prop.valor_total + v_diferenca::double precision
   WHERE id_int = p_id_int;

  -- 7. assercao de linearidade
  v_sob_depois := public.cc__total_soberano_proposta(p_id_int);
  IF v_sob_antes IS NOT NULL AND v_sob_depois IS NOT NULL
     AND abs((v_sob_depois - v_sob_antes) - v_diferenca) > 0.01 THEN
    RAISE EXCEPTION 'EXP_RECOT_NAO_LINEAR: cc__total_soberano_proposta deixou de ser linear no frete (delta soberano R$ %, delta do frete R$ %) - a Etapa 2 nao pode gravar assim',
      round(v_sob_depois - v_sob_antes, 2), v_diferenca;
  END IF;

  -- 8. ledger (append-only)
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

  -- 9. fecha o vinculo: qual aplicacao consumiu esta liberacao
  UPDATE public.expedicao_recotacao_liberacoes
     SET id_recotacao = v_new_id
   WHERE id = v_liberacao;

  RETURN v_new_id;
END; $$;

COMMENT ON FUNCTION public.exp_aplicar_recotacao(bigint, uuid, numeric, numeric, numeric, text, text, text, integer, text, numeric, uuid, text, text, jsonb, text, text, text) IS
  'Parte C, Etapa 2. Aplica UMA opcao da recotacao: consome a liberacao do admin, grava valor_frete, move valor_total pelo delta do frete e registra o ledger, tudo em uma transacao. Idempotente por chave, e a idempotencia vem ANTES do consumo. NAO toca cotacao_frete nem Conta Corrente.';

-- ---------------------------------------------------------------------------
-- VERIFICACAO (rodar depois de aplicar)
--
-- a) Tabela e CHECKs:
--    SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conrelid = 'public.expedicao_recotacao_liberacoes'::regclass ORDER BY conname;
--    Esperado: 3 CHECK + 1 PK + 2 FK (propostas, expedicao_recotacoes).
--
-- b) Indice PARCIAL — a garantia de uma liberacao ativa por pedido:
--    SELECT indexdef FROM pg_indexes
--     WHERE schemaname='public' AND tablename='expedicao_recotacao_liberacoes';
--    Esperado que exp_lib_uma_ativa_por_pedido traga
--    "WHERE ((consumida_em IS NULL) AND (revogada_em IS NULL))".
--
-- c) RLS — UMA politica so, de SELECT, e nenhuma de insert/update/delete:
--    SELECT polname, polcmd FROM pg_policy
--     WHERE polrelid = 'public.expedicao_recotacao_liberacoes'::regclass;
--    Esperado exatamente: ..._select_authenticated (r).
--
-- d) Trigger de auditoria:
--    SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--     WHERE tgrelid='public.expedicao_recotacao_liberacoes'::regclass AND NOT tgisinternal;
--    Esperado: trg_audit_expedicao_recotacao_liberacoes -> audit.log_row_changes_v2().
--
-- e) ACL COMPLETO das tres funcoes — array_agg(grantee) inteiro, nao so
--    'authenticated'. Foi exatamente isto que escapou em exp_aplicar_recotacao
--    (ficou com EXECUTE para anon por default privilege do Supabase no schema
--    public, e o REVOKE FROM PUBLIC nao alcanca grant explicito de role):
--
--      SELECT p.proname, array_agg(g.grantee ORDER BY g.grantee) AS com_execute
--        FROM pg_proc p
--        JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
--        LEFT JOIN information_schema.role_routine_grants g
--          ON g.routine_schema = 'public' AND g.routine_name = p.proname
--         AND g.privilege_type = 'EXECUTE'
--       WHERE p.proname IN ('exp_liberar_recotacao','exp_revogar_recotacao',
--                           'exp_aplicar_recotacao','cc_abrir_pendencia')
--       GROUP BY p.proname ORDER BY p.proname;
--
--    Esperado, nas quatro linhas, EXATAMENTE {authenticated,postgres,service_role}.
--    Qualquer 'anon' ou 'PUBLIC' na lista e falha desta migration.
--
-- f) Coerencia do consumo (o sentido que nao virou CHECK, ver cabecalho):
--    SELECT count(*) FROM public.expedicao_recotacao_liberacoes
--     WHERE consumida_em IS NOT NULL AND id_recotacao IS NULL;   -- esperado 0
--
-- g) Estado inicial e nada tocado fora do escopo:
--    SELECT count(*) FROM public.expedicao_recotacao_liberacoes;  -- esperado 0
--    SELECT count(*) FROM public.expedicao_recotacoes;            -- esperado 1 (o 20960)
--    SELECT count(*) FROM public.conta_corrente_pendencias;       -- esperado 11
--
-- h) A funcao de aplicar manteve assinatura e seguranca:
--    SELECT prosecdef, proconfig,
--           position('EXP_RECOT_SEM_LIBERACAO' in prosrc) > 0 AS consome_liberacao
--      FROM pg_proc WHERE proname = 'exp_aplicar_recotacao';
--    Esperado: true, {search_path=public, pg_temp}, true.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   DROP FUNCTION public.exp_revogar_recotacao(bigint, text, text);
--   DROP FUNCTION public.exp_liberar_recotacao(bigint, text, text, text);
--   -- e restaurar exp_aplicar_recotacao SEM o bloco de consumo, com o corpo de
--   -- 20260819_expedicao_recotacoes.sql (secao 3) mais a correcao do gate de
--   -- modalidade — CREATE OR REPLACE, assinatura inalterada.
--   DROP TABLE public.expedicao_recotacao_liberacoes;
--
--   Limpo ENQUANTO nenhuma liberacao tiver sido dada. Depois da primeira,
--   derrubar a tabela apaga quem autorizou cada recotacao — o ledger continua
--   dizendo QUE houve aplicacao e por quem foi aplicada, mas nao QUEM AUTORIZOU.
--   Nesse caso, preferir desativar a rota de liberar a derrubar a tabela.
--
--   ATENCAO a ordem: restaurar `exp_aplicar_recotacao` ANTES de dropar a tabela,
--   senao a funcao fica referenciando relacao inexistente e toda aplicacao passa
--   a falhar em tempo de execucao.
-- ---------------------------------------------------------------------------
