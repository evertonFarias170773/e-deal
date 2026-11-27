-- =============================================================================
-- 20261127_lisiton_api_criar_pedido
--
-- INTEGRACAO LISITON -> VIBE: CRIAR O PEDIDO PELA API (27/11/2026).
--
-- Decisoes do Everton (26-27/11/2026):
--   - Lisiton (8469) e o cliente; o cliente final e o pagador (id_faturado),
--     vinculado a 8469 em clientes_socios (vinculo_comercial), como a socio-pagador.
--   - Vendedora: Lisiane Colbeich. Pedido 100% de prateleira, FOB com frete zero,
--     preco do cadastro do produto (a rota usa as funcoes da tela).
--   - Empresa: lida de integracao_lisiton_config, que a Edina troca na tela
--     Configuracoes > Integracao Lisiton (hoje E3, id 3).
--   - Contatos do pedido: todas as conversas da 8469 no ChatGuru, com a da
--     Lisiane como principal; com isso a liberacao automatica de prateleira
--     (liberarPrateleiraAutomaticamente) segue sozinha depois do PIX pago.
--   - Auditoria: service_role; a origem "Integracao Lisiton" vai escrita no
--     pedido (obs_proposta) e no chat.
--
-- O QUE ESTA MIGRATION CRIA
--   1. integracao_lisiton_config: uma linha (empresa, conversa principal).
--      Leitura para authenticated; escrita so por lisiton_config_definir_empresa
--      (permissao config.integracoes ou ADM).
--   2. integracao_lisiton_pedidos: a chave de idempotencia da Lisiton -> id_int.
--      So service_role.
--   3. lisiton_criar_pedido(jsonb): grava, numa transacao, o cliente final
--      (acha pelo documento ou cria), o vinculo, o endereco (reaproveita ou cria),
--      a proposta, os itens, o checklist congelado, os lotes (um por cor), a
--      cotacao de frete FOB, as conversas do ChatGuru e a mensagem de origem.
--      As LINHAS da proposta, dos itens e dos lotes chegam montadas pela rota
--      com as funcoes do Salvar da tela (createItemFromProduto,
--      montarDadosItemProposta, montarInsertDeLoteDaProposta, nomeTransporteEfetivo,
--      categoriaDoServico); a funcao confere e grava. So service_role.
--
-- NAO MEXE em tela de orcamento, socio-pagador, saveProposta, Edge do ChatGuru,
-- cobranca (o PIX sai depois, pela funcao da pagina /p), status nem RLS de
-- tabela existente.
-- =============================================================================

SET LOCAL lock_timeout = '8s';

-- -----------------------------------------------------------------------------
-- 1. CONFIGURACAO
-- -----------------------------------------------------------------------------
CREATE TABLE public.integracao_lisiton_config (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id),
  id_empresa           smallint NOT NULL CHECK (id_empresa IN (1, 2, 3)),
  chat_id_principal    text NOT NULL,
  atualizado_por       uuid,
  atualizado_por_nome  text,
  atualizado_em        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.integracao_lisiton_config IS
  'Integracao Lisiton (27/11/2026): empresa dos pedidos criados pela API (1 Ideal Grafica, 2 Ideal Biro, 3 E3) e a conversa do ChatGuru que fica como principal. Uma linha. Escrita so por lisiton_config_definir_empresa.';

INSERT INTO public.integracao_lisiton_config (id, id_empresa, chat_id_principal, atualizado_por_nome)
VALUES (true, 3, '6af713eb705cf55752183198', 'Migration 20261127 (decisao do Everton)');

ALTER TABLE public.integracao_lisiton_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.integracao_lisiton_config FROM anon, authenticated;
GRANT SELECT ON public.integracao_lisiton_config TO authenticated;
CREATE POLICY integracao_lisiton_config_ler ON public.integracao_lisiton_config
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.lisiton_config_definir_empresa(p_id_empresa smallint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
  v_cfg  public.integracao_lisiton_config%ROWTYPE;
BEGIN
  PERFORM public.cc__assert_permissao(v_uid, 'config.integracoes');
  IF p_id_empresa IS NULL OR p_id_empresa NOT IN (1, 2, 3) THEN
    RAISE EXCEPTION 'LISITON_CONFIG_EMPRESA: empresa invalida (1, 2 ou 3).' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(nullif(btrim(nome_usuario), ''), email) INTO v_nome FROM public.usuarios WHERE user_id = v_uid;
  UPDATE public.integracao_lisiton_config
     SET id_empresa = p_id_empresa, atualizado_por = v_uid, atualizado_por_nome = v_nome, atualizado_em = now()
   WHERE id
  RETURNING * INTO v_cfg;
  RETURN to_jsonb(v_cfg);
END;
$function$;

REVOKE ALL ON FUNCTION public.lisiton_config_definir_empresa(smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lisiton_config_definir_empresa(smallint) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. IDEMPOTENCIA
-- -----------------------------------------------------------------------------
CREATE TABLE public.integracao_lisiton_pedidos (
  chave            text PRIMARY KEY CHECK (length(chave) BETWEEN 8 AND 100),
  hash_payload     text NOT NULL,
  id_int           bigint UNIQUE,
  id_cliente_pagador bigint,
  criado_em        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.integracao_lisiton_pedidos IS
  'Chave de idempotencia enviada pela Lisiton -> pedido criado. Repetir a chave devolve o mesmo pedido; a mesma chave com outro conteudo e recusada.';

ALTER TABLE public.integracao_lisiton_pedidos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.integracao_lisiton_pedidos FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. CRIAR O PEDIDO
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lisiton_criar_pedido(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_lisiton   constant bigint := 8469;
  v_chave     text := btrim(coalesce(p->>'chave', ''));
  v_hash      text := btrim(coalesce(p->>'hash', ''));
  v_reserva   public.integracao_lisiton_pedidos%ROWTYPE;
  v_pag       jsonb := p->'pagador';
  v_end       jsonb := p->'endereco';
  v_prop      jsonb := p->'proposta';
  v_vend      jsonb := p->'vendedora';
  v_doc       text := regexp_replace(coalesce(v_pag->>'documento', ''), '\D', '', 'g');
  v_id_pag    bigint;
  v_criou_pag boolean := false;
  v_id_end    uuid;
  v_cep       text := regexp_replace(coalesce(v_end->>'cep', ''), '\D', '', 'g');
  v_id_int    bigint;
  v_item      jsonb;
  v_lin       jsonb;
  v_mod       jsonb;
  v_id_item   bigint;
  v_ordem     integer;
  v_conv      jsonb;
  v_principal text;
  v_total     numeric;
  v_soma      numeric := 0;
BEGIN
  -- Idempotencia: a chave e reservada antes de tudo. Duas chamadas simultaneas
  -- com a mesma chave: a segunda espera a primeira terminar e cai no conflito.
  IF length(v_chave) < 8 OR length(v_chave) > 100 OR v_hash = '' THEN
    RAISE EXCEPTION 'LISITON_CHAVE: chave de idempotencia ausente ou invalida (8 a 100 caracteres).' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.integracao_lisiton_pedidos (chave, hash_payload) VALUES (v_chave, v_hash)
  ON CONFLICT (chave) DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO v_reserva FROM public.integracao_lisiton_pedidos WHERE chave = v_chave;
    IF v_reserva.hash_payload IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'LISITON_CHAVE_REUSADA: esta chave de idempotencia ja foi usada em outro pedido, com outro conteudo.' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object('id_int', v_reserva.id_int, 'id_cliente_pagador', v_reserva.id_cliente_pagador, 'idempotente', true);
  END IF;

  -- Conferencias do que a rota montou.
  IF jsonb_typeof(p->'itens') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'itens') = 0 THEN
    RAISE EXCEPTION 'LISITON_ITENS: o pedido precisa de pelo menos um item.' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_doc) NOT IN (11, 14) THEN
    RAISE EXCEPTION 'LISITON_DOCUMENTO: documento do cliente final invalido.' USING ERRCODE = 'P0001';
  END IF;
  IF v_doc = (SELECT regexp_replace(coalesce(documento, ''), '\D', '', 'g') FROM public.clientes WHERE id_cliente = c_lisiton) THEN
    RAISE EXCEPTION 'LISITON_DOCUMENTO: o cliente final nao pode ser a propria Lisiton.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clientes c
                  WHERE c.id_cliente = (v_prop->>'id_transportadora_cliente')::bigint
                    AND upper(coalesce(c.categoria, '')) = 'TRANSPORTADORA' AND c.ativo IS TRUE) THEN
    RAISE EXCEPTION 'LISITON_TRANSPORTADORA: transportadora nao cadastrada ou inativa.' USING ERRCODE = 'P0001';
  END IF;

  -- Cliente final: pelos digitos do documento (a mesma busca da socio-pagador);
  -- sem cadastro, cria com os dados enviados, atendente = a vendedora.
  SELECT id_cliente INTO v_id_pag FROM public.vw_cadastros_lista_completa
   WHERE documento_numeros = v_doc ORDER BY id_cliente LIMIT 1;
  IF v_id_pag IS NULL THEN
    INSERT INTO public.clientes (nome, fantasia, documento, tipo_pessoa, categoria, ativo, email,
                                 whatsapp_1, cidade_uf, nome_vendedor, id_vendedor)
    VALUES (btrim(v_pag->>'nome'), nullif(btrim(coalesce(v_pag->>'fantasia', '')), ''), v_doc,
            CASE WHEN length(v_doc) = 14 THEN 'JURIDICA' ELSE 'FISICA' END, 'CLIENTE', true,
            nullif(btrim(coalesce(v_pag->>'email', '')), ''),
            nullif(btrim(coalesce(v_pag->>'telefone', '')), ''),
            nullif(btrim(coalesce(v_end->>'cidade', '')) || '/' || upper(btrim(coalesce(v_end->>'uf', ''))), '/'),
            v_vend->>'nome', (v_vend->>'id_vendedor')::uuid)
    RETURNING id_cliente INTO v_id_pag;
    v_criou_pag := true;
  END IF;
  IF v_id_pag = c_lisiton THEN
    RAISE EXCEPTION 'LISITON_DOCUMENTO: o cliente final nao pode ser a propria Lisiton.' USING ERRCODE = 'P0001';
  END IF;

  -- Vinculo comercial com a Lisiton, so se faltar (o par e unico).
  INSERT INTO public.clientes_socios (id_cliente_principal, id_cliente_socio, tipo_relacao)
  SELECT c_lisiton, v_id_pag, 'vinculo_comercial'
   WHERE NOT EXISTS (SELECT 1 FROM public.clientes_socios
                      WHERE id_cliente_principal = c_lisiton AND id_cliente_socio = v_id_pag);

  -- Endereco de entrega: o do cliente final com o mesmo CEP e numero, ou um novo.
  SELECT e.id INTO v_id_end FROM public.enderecos e
   WHERE e.id_cliente = v_id_pag
     AND regexp_replace(coalesce(e.cep, ''), '\D', '', 'g') = v_cep
     AND lower(btrim(coalesce(e.numero, ''))) = lower(btrim(coalesce(v_end->>'numero', '')))
   ORDER BY (upper(coalesce(e.tipo_endereco, '')) = 'ENTREGA') DESC, e.data_criacao DESC
   LIMIT 1;
  IF v_id_end IS NULL THEN
    INSERT INTO public.enderecos (id_cliente, cep, endereco, numero, complemento, bairro, cidade, uf, tipo_endereco, obs)
    VALUES (v_id_pag, v_cep, btrim(v_end->>'endereco'), btrim(v_end->>'numero'),
            nullif(btrim(coalesce(v_end->>'complemento', '')), ''), btrim(v_end->>'bairro'),
            btrim(v_end->>'cidade'), upper(btrim(v_end->>'uf')),
            CASE WHEN EXISTS (SELECT 1 FROM public.enderecos WHERE id_cliente = v_id_pag) THEN 'ENTREGA' ELSE 'PRINCIPAL' END,
            'Integração Lisiton')
    RETURNING id INTO v_id_end;
  END IF;

  -- Proposta: as colunas que o Salvar grava num INSERT (status NOVO fixo).
  INSERT INTO public.propostas (
    id_cliente, id_faturado, id_endereco_ent, id_contato, cliente, empresa, vendedor,
    obs_proposta, obs_tecnica, obs_entrega, obs_nota_fiscal, texto_whatsapp, contato, cep, is_avulso,
    valor, valor_total, frete_escolhido, valor_frete, modalidade_frete, transporte_categoria,
    id_transportadora_cliente, frete_valor_digitado, categoria_frete, user_id, proposta, status_interno)
  VALUES (
    c_lisiton, v_id_pag, v_id_end, nullif(v_prop->>'id_contato', ''), v_prop->>'cliente', v_prop->>'empresa', v_vend->>'nome',
    v_prop->>'obs_proposta', '', coalesce(v_prop->>'obs_entrega', ''), NULL, v_prop->>'texto_whatsapp', v_prop->>'contato', v_cep, false,
    (v_prop->>'valor')::numeric, (v_prop->>'valor_total')::numeric, v_prop->>'frete_escolhido', 0, 'FOB', v_prop->>'transporte_categoria',
    (v_prop->>'id_transportadora_cliente')::bigint, NULL, v_prop->>'categoria_frete', (v_vend->>'uid')::uuid, v_prop->>'proposta', 'NOVO')
  RETURNING id_int INTO v_id_int;

  -- Itens, checklist congelado e lotes (um por cor).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p->'itens') LOOP
    v_lin := v_item->'linha';
    INSERT INTO public.produtos_proposta (
      id_int, id_produto, nome_produto, modelo_descri, valor_unt, qtd, fixo, valor_sub_total,
      peso_uni, peso_base, peso_extra, valor_base, valor_extra, ncm, cfop, status_item, is_estoque)
    VALUES (
      v_id_int, (v_lin->>'id_produto')::bigint, v_lin->>'nome_produto', v_lin->>'modelo_descri',
      (v_lin->>'valor_unt')::numeric, (v_lin->>'qtd')::numeric, (v_lin->>'fixo')::numeric, (v_lin->>'valor_sub_total')::numeric,
      (v_lin->>'peso_uni')::numeric, (v_lin->>'peso_base')::numeric, (v_lin->>'peso_extra')::numeric,
      (v_lin->>'valor_base')::numeric, (v_lin->>'valor_extra')::numeric, v_lin->>'ncm', v_lin->>'cfop',
      coalesce(v_lin->>'status_item', 'PENDENTE'), (v_lin->>'is_estoque')::boolean)
    RETURNING id INTO v_id_item;
    v_soma := v_soma + (v_lin->>'valor_sub_total')::numeric;

    IF (v_lin->>'is_estoque')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'LISITON_PRATELEIRA: o produto % nao e de prateleira.', v_lin->>'id_produto' USING ERRCODE = 'P0001';
    END IF;

    -- Checklist congelado (congelarChecklistDosItensNovos): as linhas do produto e o carimbo.
    INSERT INTO public.produtos_proposta_boletim_campos (id_produto_proposta, campo)
    SELECT v_id_item, b.campo FROM public.produto_boletim_campos b WHERE b.id_produto = (v_lin->>'id_produto')::bigint;
    UPDATE public.produtos_proposta SET boletim_campos_congelado_em = now()
     WHERE id = v_id_item AND boletim_campos_congelado_em IS NULL;

    v_ordem := 0;
    FOR v_mod IN SELECT * FROM jsonb_array_elements(v_item->'lotes') LOOP
      v_ordem := v_ordem + 1;
      INSERT INTO public.pedidos_modelos (
        id_int, id_produto_proposta_origem, nome_modelo, padrao, quantidade, tipo_numeracao,
        numeracao_inicio, numeracao_fim, verso_tipo, bloco, gabarito_operacional, variacoes_texto,
        "Q_CAM", "L_CAM", "C_INI", status_arte, status_producao, ordem)
      VALUES (
        v_id_int, v_id_item, v_mod->>'nome_modelo', v_mod->>'padrao', (v_mod->>'quantidade')::numeric,
        v_mod->>'tipo_numeracao', (v_mod->>'numeracao_inicio')::bigint, (v_mod->>'numeracao_fim')::bigint, v_mod->>'verso_tipo',
        v_mod->>'bloco', v_mod->>'gabarito_operacional', v_mod->>'variacoes_texto',
        (v_mod->>'Q_CAM')::numeric, (v_mod->>'L_CAM')::numeric, (v_mod->>'C_INI')::numeric,
        coalesce(v_mod->>'status_arte', 'PENDENTE'), coalesce(v_mod->>'status_producao', 'PENDENTE'),
        coalesce((v_mod->>'ordem')::integer, v_ordem));
    END LOOP;

    -- A soma dos lotes e a quantidade do item (a mesma conferencia da liberacao).
    IF (SELECT coalesce(sum(quantidade), 0) FROM public.pedidos_modelos WHERE id_produto_proposta_origem = v_id_item)
       IS DISTINCT FROM (v_lin->>'qtd')::numeric THEN
      RAISE EXCEPTION 'LISITON_LOTES: a soma das cores nao bate com a quantidade do produto %.', v_lin->>'id_produto' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- Cotacao de frete FOB (o Salvar grava a linha mesmo sem card).
  INSERT INTO public.cotacao_frete (id_int, servico, valor, prazo, peso, origem, cep, escolhido)
  VALUES (v_id_int, p->'cotacao'->>'servico', 0, coalesce(p->'cotacao'->>'prazo', 'A combinar'),
          nullif(p->'cotacao'->>'peso', '')::numeric, NULL, nullif(v_cep, ''), true);

  -- Conversas do ChatGuru: todas as da Lisiton, a da Lisiane como principal.
  FOR v_conv IN SELECT * FROM jsonb_array_elements(coalesce(p->'conversas', '[]'::jsonb)) LOOP
    INSERT INTO public.propostas_contatos_chatguru (id_int, chat_id, nome, telefone, principal, escolhido_por, escolhido_por_nome)
    VALUES (v_id_int, v_conv->>'chat_id', v_conv->>'nome', v_conv->>'telefone', false, NULL, 'Integração Lisiton');
    IF (v_conv->>'principal')::boolean IS TRUE THEN v_principal := v_conv->>'chat_id'; END IF;
  END LOOP;
  IF v_principal IS NULL THEN
    RAISE EXCEPTION 'LISITON_CONVERSA: a conversa principal da Lisiton nao esta entre as conversas do cliente no ChatGuru.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.propostas_contatos_chatguru SET principal = true WHERE id_int = v_id_int AND chat_id = v_principal;
  UPDATE public.propostas SET chatguru_chat_id = v_principal WHERE id_int = v_id_int;

  -- O total que o Salvar consolida no fim (itens sem bonus nem desconto + frete zero).
  SELECT valor_total INTO v_total FROM public.propostas WHERE id_int = v_id_int;
  IF round(v_soma, 2) IS DISTINCT FROM round((v_prop->>'valor_total')::numeric, 2) THEN
    RAISE EXCEPTION 'LISITON_TOTAL: o total montado (%) nao e a soma dos itens (%).', v_prop->>'valor_total', v_soma USING ERRCODE = 'P0001';
  END IF;
  IF round(coalesce(v_total, 0)::numeric, 2) IS DISTINCT FROM round(v_soma, 2) THEN
    UPDATE public.propostas SET valor_total = round(v_soma, 2) WHERE id_int = v_id_int;
  END IF;

  INSERT INTO public.propostas_chat (id_int, id_cliente, mensagem, tipo, autor_uid, autor_nome, setor, visivel_externo)
  VALUES (v_id_int, c_lisiton,
          format('Pedido criado pela Integração Lisiton (chave %s). Cliente final: %s. Vendedora: %s.',
                 v_chave, btrim(coalesce(v_pag->>'nome', '')), v_vend->>'nome'),
          'SISTEMA', NULL, 'Integração Lisiton', 'COMERCIAL', false);

  UPDATE public.integracao_lisiton_pedidos SET id_int = v_id_int, id_cliente_pagador = v_id_pag WHERE chave = v_chave;

  RETURN jsonb_build_object('id_int', v_id_int, 'id_cliente_pagador', v_id_pag, 'cliente_criado', v_criou_pag,
                            'id_endereco', v_id_end, 'idempotente', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.lisiton_criar_pedido(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lisiton_criar_pedido(jsonb) TO service_role;
