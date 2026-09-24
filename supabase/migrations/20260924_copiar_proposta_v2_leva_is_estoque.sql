-- ============================================================================
-- copiar_proposta_v2: a cópia passa a levar produtos_proposta.is_estoque
-- 24/09/2026 — decisão do dono.
--
-- O QUE ACONTECIA
--   A função copia os itens com lista fixa de colunas (id_produto, nome,
--   modelo_descri, qtd, fixo, pesos, valores). `is_estoque` (produto de
--   prateleira, migration de 08/08/2026) ficava de fora e o item copiado
--   nascia com o default `false`. Como o app congela a marca no item ("item já
--   gravado mantém o que veio do banco", orcamentos.service.ts), o Salvar
--   seguinte a mantinha em `false`: a cópia de um pedido de prateleira passava
--   a exigir arte — Modelo/Bloco na aba Pedido, "Arte: Pendente" e
--   `propostas.em_arte = true`.
--
--   Casos reais desde 08/08: 22631 (cópia da 22106, item 2808 "Dseg - Triband")
--   e 21481 (cópia da 21478, 4 itens de serviço). Só o 2808 foi corrigido por
--   UPDATE, por decisão do dono; a 21481 ficou de fora.
--
-- O QUE MUDA
--   `is_estoque` entra nas três listas do passo 3 (SELECT de origem, colunas do
--   INSERT e SELECT do INSERT). Nada mais muda: o corpo é o vivo em 24/09/2026,
--   conferido antes de aplicar (md5 do corpo sem espaços =
--   562ccb91733b2914fcfc63d5fc4520c8, idêntico ao dump de 05/06/2026 em
--   scratch/schema.sql — nenhuma migration do repo criava a função até aqui).
--   O bloco DO abaixo confere esse md5 e aborta se o corpo vivo for outro.
--
-- FORA DO ESCOPO (anotado, não feito)
--   `duplicar_proposta` (a função antiga) tem a mesma lista fixa e o mesmo
--   buraco; o app só chama `copiar_proposta_v2`. As colunas do snapshot do
--   boletim (migration 20260922) continuam de fora da cópia de propósito — ver
--   a nota daquela migration.
-- ============================================================================

DO $guard$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(regexp_replace(
           substring(pg_get_functiondef(p.oid) from '\$function\$(.*)\$function\$'),
           '\s', '', 'g'))
    INTO v_md5
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'copiar_proposta_v2';

  IF v_md5 IS DISTINCT FROM '562ccb91733b2914fcfc63d5fc4520c8' THEN
    RAISE EXCEPTION 'copiar_proposta_v2: corpo vivo (md5 %) difere do conferido em 24/09/2026; reconfira antes de aplicar', v_md5;
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.copiar_proposta_v2(p_id_int_origem integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_novo_id_int BIGINT;
BEGIN
  -- Não permitir copiar uma proposta que já é cópia
  IF EXISTS (
    SELECT 1
    FROM public.propostas
    WHERE id_int = p_id_int_origem
      AND is_copia = true
  ) THEN
    RAISE EXCEPTION 'Não é permitido duplicar uma proposta que já é cópia';
  END IF;

  -- 1) Duplica a proposta principal
  INSERT INTO public.propostas (
    user_id,
    cliente,
    proposta,
    valor,
    vendedor,
    id_conversa,
    peso,
    id_vendedor,
    "cnpjCpf",
    prop_reduz,
    frete_escolhido,
    status_interno,
    json_produtos,
    empresa,
    volume,
    valor_total,
    conferencia,
    conferido_por,
    id_cliente,
    id_frete,
    contato,
    id_endereco_ent,
    texto_whatsapp,
    is_copia,
    id_int_origem_copia,
    tem_veppo,
    credito_processado,
    obs_proposta,
    "PDF",
    tipo_cob_edeal,
    tipo_boleto_edeal,
    is_avulso,
    id_faturado,
    boleto_aproved,
    motivo_reproved,
    is_reproved
  )
  SELECT
    user_id,
    cliente,
    proposta,
    valor,
    vendedor,
    id_conversa,
    peso,
    id_vendedor,
    "cnpjCpf",
    prop_reduz,
    'À definir' AS frete_escolhido,
    'NOVO' AS status_interno,
    json_produtos,
    empresa,
    volume,
    valor_total,
    conferencia,
    conferido_por,
    id_cliente,
    NULL AS id_frete,
    NULL AS contato,
    NULL AS id_endereco_ent,
    NULL AS texto_whatsapp,
    true AS is_copia,
    p_id_int_origem AS id_int_origem_copia,
    tem_veppo,
    false AS credito_processado,
    NULL AS obs_proposta,
    NULL AS "PDF",
    NULL AS tipo_cob_edeal,
    NULL AS tipo_boleto_edeal,
    is_avulso,
    NULL AS id_faturado,
    true AS boleto_aproved,
    '' AS motivo_reproved,
    false AS is_reproved
  FROM public.propostas
  WHERE id_int = p_id_int_origem
  RETURNING id_int INTO v_novo_id_int;

  -- 2) Tabela temporária para relacionar produto antigo -> produto novo
  CREATE TEMP TABLE tmp_map_produtos (
    id_antigo BIGINT,
    id_novo   BIGINT
  ) ON COMMIT DROP;

  -- 3) Copia produtos_proposta
  --    is_estoque entrou em 24/09/2026: produto de prateleira copiado continua
  --    de prateleira (antes nascia false e a cópia passava a exigir arte).
  WITH origem AS (
    SELECT
      id,
      id_produto,
      nome_produto,
      modelo_descri,
      qtd,
      fixo,
      peso_base,
      peso_extra,
      valor_base,
      valor_extra,
      is_estoque,
      ROW_NUMBER() OVER (
        ORDER BY id
      ) AS rn
    FROM public.produtos_proposta
    WHERE id_int = p_id_int_origem
  ),
  inseridos AS (
    INSERT INTO public.produtos_proposta (
      id_int,
      id_produto,
      nome_produto,
      modelo_descri,
      qtd,
      fixo,
      peso_base,
      peso_extra,
      valor_base,
      valor_extra,
      is_estoque
    )
    SELECT
      v_novo_id_int,
      id_produto,
      nome_produto,
      modelo_descri,
      qtd,
      fixo,
      peso_base,
      peso_extra,
      valor_base,
      valor_extra,
      is_estoque
    FROM origem
    ORDER BY rn
    RETURNING id
  ),
  novos AS (
    SELECT
      id,
      ROW_NUMBER() OVER (ORDER BY id) AS rn
    FROM inseridos
  )
  INSERT INTO tmp_map_produtos (id_antigo, id_novo)
  SELECT
    o.id,
    n.id
  FROM origem o
  JOIN novos n
    ON o.rn = n.rn;

  -- 4) Copia variações dos produtos, apontando para os NOVOS ids
  INSERT INTO public.produtos_proposta_variacao (
    id_produto_proposta,
    id_tipo_variacao,
    nome_variacao,
    v_extra,
    peso_uni,
    id_variacao
  )
  SELECT
    m.id_novo,
    v.id_tipo_variacao,
    v.nome_variacao,
    v.v_extra,
    v.peso_uni,
    v.id_variacao
  FROM public.produtos_proposta_variacao v
  JOIN tmp_map_produtos m
    ON m.id_antigo = v.id_produto_proposta;

  -- 5) Copia desconto, se existir
  INSERT INTO public.desconto_proposta (
    id_int,
    tipo_desconto,
    validade,
    valor_percentual,
    valor_nominal,
    descricao
  )
  SELECT
    v_novo_id_int,
    tipo_desconto,
    validade,
    valor_percentual,
    valor_nominal,
    descricao
  FROM public.desconto_proposta
  WHERE id_int = p_id_int_origem;

  RETURN v_novo_id_int;
END;
$function$;
