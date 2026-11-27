-- =============================================================================
-- API da Lisiton: o cliente final deixa de ganhar vinculo comercial com a 8469
-- (27/11/2026, decisao do Everton). Autorizada so para esta migration.
-- =============================================================================
--
-- O corpo vivo de lisiton_criar_pedido foi comparado com o arquivo
-- 20261127b_lisiton_pagador_lisiton_retira.sql antes: identicos (md5
-- ce71c11e615837e8fe04d5a23e0e1b3c).
--
-- O QUE MUDA: sai o INSERT em `clientes_socios` (tipo 'vinculo_comercial').
-- O vinculo fazia o cliente final aparecer como opcao de pagador da proposta
-- (socio-pagador lista os vinculos da 8469), e no 25963 ele foi escolhido como
-- pagador. O cliente final continua achado pelo documento ou criado, so como
-- dono do endereco de entrega; quem paga e a 8469 (id_faturado).
--
-- O QUE NAO MUDA: os vinculos que ja existem ficam como estao (nenhum DELETE).
-- O resto da funcao e o da migration 20261127b, linha a linha.
--
-- A etiqueta, a Declaracao e a prepostagem passam a ler o cliente final em
-- `integracao_lisiton_pedidos.id_cliente_final` (codigo do app,
-- expedicao/lib/cliente-final-integracao.server.ts), nao pelo vinculo.
-- =============================================================================

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
  v_cf        jsonb := coalesce(p->'cliente_final', p->'pagador');
  v_end       jsonb := p->'endereco';
  v_prop      jsonb := p->'proposta';
  v_vend      jsonb := p->'vendedora';
  v_doc       text := regexp_replace(coalesce(v_cf->>'documento', ''), '\D', '', 'g');
  v_modal     text := upper(coalesce(nullif(btrim(v_prop->>'modalidade_frete'), ''), 'FOB'));
  v_id_transp bigint := nullif(v_prop->>'id_transportadora_cliente', '')::bigint;
  v_id_final  bigint;
  v_nome_final text;
  v_criou_cf  boolean := false;
  v_id_end    uuid;
  v_receb     text;
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
  -- Idempotencia: a chave e reservada antes de tudo.
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
    RETURN jsonb_build_object('id_int', v_reserva.id_int, 'id_cliente_final', v_reserva.id_cliente_final,
                              'id_cliente_pagador', c_lisiton, 'idempotente', true);
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
  IF v_modal NOT IN ('FOB', 'RETIRA') THEN
    RAISE EXCEPTION 'LISITON_MODALIDADE: modalidade de frete % nao aceita (FOB ou RETIRA).', v_modal USING ERRCODE = 'P0001';
  END IF;
  IF v_modal = 'FOB' AND NOT EXISTS (SELECT 1 FROM public.clientes c
                  WHERE c.id_cliente = v_id_transp
                    AND upper(coalesce(c.categoria, '')) = 'TRANSPORTADORA' AND c.ativo IS TRUE) THEN
    RAISE EXCEPTION 'LISITON_TRANSPORTADORA: transportadora nao cadastrada ou inativa.' USING ERRCODE = 'P0001';
  END IF;
  IF v_modal = 'RETIRA' AND v_id_transp IS NOT NULL THEN
    RAISE EXCEPTION 'LISITON_TRANSPORTADORA: retirada no balcao nao leva transportadora.' USING ERRCODE = 'P0001';
  END IF;

  -- Cliente final (so para a entrega): pelos digitos do documento; sem cadastro,
  -- cria com os dados enviados, atendente = a vendedora.
  SELECT id_cliente INTO v_id_final FROM public.vw_cadastros_lista_completa
   WHERE documento_numeros = v_doc ORDER BY id_cliente LIMIT 1;
  IF v_id_final IS NULL THEN
    INSERT INTO public.clientes (nome, fantasia, documento, tipo_pessoa, categoria, ativo, email,
                                 whatsapp_1, cidade_uf, nome_vendedor, id_vendedor)
    VALUES (btrim(v_cf->>'nome'), nullif(btrim(coalesce(v_cf->>'fantasia', '')), ''), v_doc,
            CASE WHEN length(v_doc) = 14 THEN 'JURIDICA' ELSE 'FISICA' END, 'CLIENTE', true,
            nullif(btrim(coalesce(v_cf->>'email', '')), ''),
            nullif(btrim(coalesce(v_cf->>'telefone', '')), ''),
            nullif(btrim(coalesce(v_end->>'cidade', '')) || '/' || upper(btrim(coalesce(v_end->>'uf', ''))), '/'),
            v_vend->>'nome', (v_vend->>'id_vendedor')::uuid)
    RETURNING id_cliente INTO v_id_final;
    v_criou_cf := true;
  END IF;
  IF v_id_final = c_lisiton THEN
    RAISE EXCEPTION 'LISITON_DOCUMENTO: o cliente final nao pode ser a propria Lisiton.' USING ERRCODE = 'P0001';
  END IF;
  -- O nome que vai no papel: o do cadastro (o cadastro existente nao e alterado).
  SELECT coalesce(nullif(btrim(nome), ''), nullif(btrim(fantasia), ''), btrim(v_cf->>'nome'))
    INTO v_nome_final FROM public.clientes WHERE id_cliente = v_id_final;

  -- Endereco de entrega do cliente final, com o nome dele como recebedor.
  SELECT e.id, e.recebedor INTO v_id_end, v_receb FROM public.enderecos e
   WHERE e.id_cliente = v_id_final
     AND regexp_replace(coalesce(e.cep, ''), '\D', '', 'g') = v_cep
     AND lower(btrim(coalesce(e.numero, ''))) = lower(btrim(coalesce(v_end->>'numero', '')))
     AND (nullif(btrim(coalesce(e.recebedor, '')), '') IS NULL OR lower(btrim(e.recebedor)) = lower(v_nome_final))
   ORDER BY (upper(coalesce(e.tipo_endereco, '')) = 'ENTREGA') DESC, e.data_criacao DESC
   LIMIT 1;
  IF v_id_end IS NULL THEN
    INSERT INTO public.enderecos (id_cliente, cep, endereco, numero, complemento, bairro, cidade, uf, tipo_endereco, obs, recebedor)
    VALUES (v_id_final, v_cep, btrim(v_end->>'endereco'), btrim(v_end->>'numero'),
            nullif(btrim(coalesce(v_end->>'complemento', '')), ''), btrim(v_end->>'bairro'),
            btrim(v_end->>'cidade'), upper(btrim(v_end->>'uf')),
            CASE WHEN EXISTS (SELECT 1 FROM public.enderecos WHERE id_cliente = v_id_final) THEN 'ENTREGA' ELSE 'PRINCIPAL' END,
            'Integração Lisiton', v_nome_final)
    RETURNING id INTO v_id_end;
  ELSIF nullif(btrim(coalesce(v_receb, '')), '') IS NULL THEN
    UPDATE public.enderecos SET recebedor = v_nome_final WHERE id = v_id_end;
  END IF;

  -- Proposta: as colunas que o Salvar grava num INSERT (status NOVO fixo).
  -- Pagador = a Lisiton.
  INSERT INTO public.propostas (
    id_cliente, id_faturado, id_endereco_ent, id_contato, cliente, empresa, vendedor,
    obs_proposta, obs_tecnica, obs_entrega, obs_nota_fiscal, texto_whatsapp, contato, cep, is_avulso,
    valor, valor_total, frete_escolhido, valor_frete, modalidade_frete, transporte_categoria,
    id_transportadora_cliente, frete_valor_digitado, categoria_frete, user_id, proposta, status_interno)
  VALUES (
    c_lisiton, c_lisiton, v_id_end, nullif(v_prop->>'id_contato', ''), v_prop->>'cliente', v_prop->>'empresa', v_vend->>'nome',
    v_prop->>'obs_proposta', '', coalesce(v_prop->>'obs_entrega', ''), NULL, v_prop->>'texto_whatsapp', v_prop->>'contato', v_cep, false,
    (v_prop->>'valor')::numeric, (v_prop->>'valor_total')::numeric, v_prop->>'frete_escolhido', 0, v_modal, v_prop->>'transporte_categoria',
    v_id_transp, NULL, v_prop->>'categoria_frete', (v_vend->>'uid')::uuid, v_prop->>'proposta', 'NOVO')
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

  -- Cotacao de frete sem card (FOB ou RETIRA; o Salvar grava a linha mesmo assim).
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
          format('Pedido criado pela Integração Lisiton (chave %s). Pagador: Lisiton. Cliente final (entrega): %s. %s. Vendedora: %s.',
                 v_chave, v_nome_final, CASE WHEN v_modal = 'RETIRA' THEN 'Retirada no balcão' ELSE 'Frete FOB' END, v_vend->>'nome'),
          'SISTEMA', NULL, 'Integração Lisiton', 'COMERCIAL', false);

  UPDATE public.integracao_lisiton_pedidos SET id_int = v_id_int, id_cliente_final = v_id_final WHERE chave = v_chave;

  RETURN jsonb_build_object('id_int', v_id_int, 'id_cliente_final', v_id_final, 'id_cliente_pagador', c_lisiton,
                            'cliente_criado', v_criou_cf, 'id_endereco', v_id_end, 'idempotente', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.lisiton_criar_pedido(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lisiton_criar_pedido(jsonb) TO service_role;
