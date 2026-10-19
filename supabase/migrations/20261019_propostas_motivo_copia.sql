-- ============================================================================
-- 20261019_propostas_motivo_copia — a copia diz se e DUPLICACAO ou RETRABALHO
-- 19/10/2026 — decisao do dono.
--
-- O QUE MUDA
--   1. `propostas.motivo_copia` (text): DUPLICACAO ou RETRABALHO. Vazia nas copias
--      antigas e em todo pedido que nao e copia. Nenhuma linha existente e tocada.
--      O original continua em `id_int_origem_copia` (o id_int, nao o uuid).
--   2. `copiar_proposta_v2` recebe `p_motivo` (padrao DUPLICACAO):
--        - DUPLICACAO: exatamente como antes (copia de copia continua bloqueada);
--        - RETRABALHO: pode partir de uma copia; `id_int_origem_copia` recebe o
--          pedido duplicado (o imediatamente anterior); a orientacao tecnica
--          (`obs_tecnica`) comeca com "Retrabalho do pedido #X", sem apagar o que
--          vinha do original. Valores copiados como na duplicacao.
--      O motivo e gravado na criacao. Nao ha caminho novo para troca-lo.
--   O resto do corpo e o de 20261003 byte a byte (md5 1791b6bbbd0396c87ec5888748534021),
--   conferido no bloco abaixo.
--
-- ASSINATURA NOVA: (integer, text DEFAULT 'DUPLICACAO'). A antiga (integer) e
--   apagada no MESMO bloco, para nao ficarem duas funcoes com o mesmo nome (a
--   chamada do app, so com p_id_int_origem, ficaria ambigua). O app atual continua
--   funcionando: sem p_motivo, vale DUPLICACAO.
-- PERMISSOES: as de antes, explicitas (EXECUTE para authenticated e service_role;
--   o dono, postgres). PUBLIC e anon sem EXECUTE (o padrao do schema daria a anon).
--
-- md5 do corpo novo: 3d798fe333c7591ca588c424153dcf8a
-- ROLLBACK: no rodape.
-- ============================================================================

DO $guard$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5
  FROM pg_proc p
  WHERE p.oid = 'public.copiar_proposta_v2(integer)'::regprocedure;

  IF v_md5 IS DISTINCT FROM '1791b6bbbd0396c87ec5888748534021' THEN
    RAISE EXCEPTION 'copiar_proposta_v2: corpo vivo (md5 %) difere do de 20261003; reconfira antes de aplicar', v_md5;
  END IF;
END
$guard$;

ALTER TABLE public.propostas
  ADD COLUMN motivo_copia text
  CONSTRAINT propostas_motivo_copia_valido CHECK (motivo_copia IS NULL OR motivo_copia IN ('DUPLICACAO', 'RETRABALHO'));

COMMENT ON COLUMN public.propostas.motivo_copia IS
  'Por que esta proposta e copia (copiar_proposta_v2, desde 19/10/2026): DUPLICACAO ou RETRABALHO. Nulo em copia antiga e em proposta que nao e copia. Fixo depois de criado. O original esta em id_int_origem_copia.';

DROP FUNCTION public.copiar_proposta_v2(integer);

CREATE FUNCTION public.copiar_proposta_v2(p_id_int_origem integer, p_motivo text DEFAULT 'DUPLICACAO')
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_novo_id_int BIGINT;
  -- Motivo da copia (19/10/2026): DUPLICACAO (padrao) ou RETRABALHO. Fixo depois de criado.
  v_motivo text := upper(btrim(coalesce(p_motivo, 'DUPLICACAO')));
  v_uid uuid := auth.uid();
  v_vendedor_origem text;
  v_origem_avulsa boolean;
  v_super boolean;
  v_admin_coluna boolean;
  v_nome_usuario text;
  v_meu_vendedor text;
  v_permissoes jsonb;
  v_tem_perfil boolean;
  v_pode boolean;
BEGIN
  IF v_motivo NOT IN ('DUPLICACAO', 'RETRABALHO') THEN
    RAISE EXCEPTION 'Motivo da cópia inválido: %. Use DUPLICACAO ou RETRABALHO.', p_motivo;
  END IF;

  -- 0) Quem pode duplicar: só quem vê a proposta (02/10/2026).
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessão não identificada. Entre de novo no sistema para duplicar a proposta.'
      USING ERRCODE = '28000';
  END IF;

  SELECT vendedor, COALESCE(is_avulso, false)
    INTO v_vendedor_origem, v_origem_avulsa
  FROM public.propostas
  WHERE id_int = p_id_int_origem;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposta #% não encontrada.', p_id_int_origem;
  END IF;

  SELECT u.is_super_adm, u.is_admin, u.nome_usuario, u.meu_vendedor, pf.permissoes, pf.id IS NOT NULL
    INTO v_super, v_admin_coluna, v_nome_usuario, v_meu_vendedor, v_permissoes, v_tem_perfil
  FROM public.usuarios u
  LEFT JOIN public.perfis pf ON pf.id = u.id_perfil AND pf.ativo = true
  WHERE u.user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário sem cadastro no sistema. Não é possível duplicar a proposta.'
      USING ERRCODE = '42501';
  END IF;

  v_permissoes := COALESCE(v_permissoes, '[]'::jsonb);

  v_pode :=
    COALESCE(v_super, false)
    OR v_permissoes ? '*'
    OR v_permissoes ? 'propostas.view_all'
    -- O administrador das telas: com perfil, a chave; sem perfil, a coluna.
    OR CASE WHEN COALESCE(v_tem_perfil, false)
            THEN v_permissoes ? 'admin.usuarios.view'
            ELSE COALESCE(v_admin_coluna, false)
       END;

  -- O vendedor dela: perfil de escopo próprio e nome igual ao da proposta,
  -- sem acento, sem caixa e sem ponto no fim ("Edison Jr." = "Edison Jr").
  IF NOT v_pode
     AND (v_permissoes ? 'propostas.view_own' OR v_permissoes ? 'propostas.view_team')
     AND btrim(COALESCE(v_vendedor_origem, '')) <> ''
  THEN
    v_pode := regexp_replace(lower(btrim(regexp_replace(unaccent(v_vendedor_origem), '\s+', ' ', 'g'))), '[.\s]+$', '')
      IN (
        regexp_replace(lower(btrim(regexp_replace(unaccent(COALESCE(NULLIF(btrim(v_nome_usuario), ''), '#')), '\s+', ' ', 'g'))), '[.\s]+$', ''),
        regexp_replace(lower(btrim(regexp_replace(unaccent(COALESCE(NULLIF(btrim(v_meu_vendedor), ''), '#')), '\s+', ' ', 'g'))), '[.\s]+$', '')
      );
  END IF;

  IF NOT COALESCE(v_pode, false) THEN
    RAISE EXCEPTION 'Você só pode duplicar proposta em que é o vendedor. Peça a um administrador ou a quem tem visão geral das propostas.'
      USING ERRCODE = '42501';
  END IF;

  -- Não permitir copiar uma proposta que já é cópia — na DUPLICACAO comum.
  -- RETRABALHO pode partir de uma cópia (19/10/2026): o novo pedido aponta para
  -- o pedido duplicado (o imediatamente anterior), nunca para o primeiro da cadeia.
  IF v_motivo = 'DUPLICACAO' AND EXISTS (
    SELECT 1
    FROM public.propostas
    WHERE id_int = p_id_int_origem
      AND is_copia = true
  ) THEN
    RAISE EXCEPTION 'Não é permitido duplicar uma proposta que já é cópia';
  END IF;

  -- 1) Duplica a proposta principal
  --    Desde 02/10/2026 leva faturado, endereço (se ainda existe), contato,
  --    observações, orientação técnica e a declaração de frete. A cotação e o
  --    valor do frete continuam fora: cota de novo.
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
    id_contato,
    id_endereco_ent,
    cep,
    texto_whatsapp,
    is_copia,
    id_int_origem_copia,
    motivo_copia,
    tem_veppo,
    credito_processado,
    obs_proposta,
    obs_tecnica,
    "PDF",
    tipo_cob_edeal,
    tipo_boleto_edeal,
    is_avulso,
    id_faturado,
    boleto_aproved,
    motivo_reproved,
    is_reproved,
    modalidade_frete,
    id_transportadora_cliente,
    transporte_categoria,
    categoria_frete
  )
  SELECT
    v_uid AS user_id,
    o.cliente,
    o.proposta,
    o.valor,
    o.vendedor,
    o.id_conversa,
    o.peso,
    o.id_vendedor,
    o."cnpjCpf",
    o.prop_reduz,
    'À definir' AS frete_escolhido,
    'NOVO' AS status_interno,
    o.json_produtos,
    o.empresa,
    o.volume,
    o.valor_total,
    false AS conferencia,
    NULL AS conferido_por,
    o.id_cliente,
    NULL AS id_frete,
    o.contato,
    o.id_contato,
    -- Endereço que saiu do cadastro não vai: a tela cai no padrão, como antes.
    --   O CEP vai sempre: sem o id, é por ele que a tela reencontra o endereço.
    CASE WHEN e.id IS NOT NULL THEN o.id_endereco_ent END AS id_endereco_ent,
    o.cep,
    NULL AS texto_whatsapp,
    true AS is_copia,
    p_id_int_origem AS id_int_origem_copia,
    v_motivo AS motivo_copia,
    o.tem_veppo,
    false AS credito_processado,
    o.obs_proposta,
    -- RETRABALHO: "Retrabalho do pedido #X" no INICIO da orientacao tecnica
    -- (o que o boletim mostra em "Orientacao tecnica de producao"), sem apagar o
    -- texto que a copia ja leva do original.
    CASE
      WHEN v_motivo = 'RETRABALHO' THEN
        'Retrabalho do pedido #' || p_id_int_origem
        || CASE WHEN btrim(coalesce(o.obs_tecnica, '')) <> '' THEN E'\n' || o.obs_tecnica ELSE '' END
      ELSE o.obs_tecnica
    END AS obs_tecnica,
    NULL AS "PDF",
    NULL AS tipo_cob_edeal,
    NULL AS tipo_boleto_edeal,
    o.is_avulso,
    o.id_faturado,
    true AS boleto_aproved,
    '' AS motivo_reproved,
    false AS is_reproved,
    o.modalidade_frete,
    o.id_transportadora_cliente,
    -- Em CIF as categorias saem da cotação escolhida, que não é copiada.
    CASE WHEN o.modalidade_frete IN ('FOB', 'RETIRA') THEN o.transporte_categoria END AS transporte_categoria,
    CASE WHEN o.modalidade_frete IN ('FOB', 'RETIRA') THEN o.categoria_frete END AS categoria_frete
  FROM public.propostas o
  LEFT JOIN public.enderecos e
    ON e.id::text = o.id_endereco_ent
  WHERE o.id_int = p_id_int_origem
  RETURNING id_int INTO v_novo_id_int;

  -- 2) Tabela temporária para relacionar produto antigo -> produto novo
  CREATE TEMP TABLE tmp_map_produtos (
    id_antigo BIGINT,
    id_novo   BIGINT
  ) ON COMMIT DROP;

  -- 3) Copia produtos_proposta
  --    is_estoque entrou em 24/09/2026: produto de prateleira copiado continua
  --    de prateleira (antes nascia false e a cópia passava a exigir arte).
  --    Desde 02/10/2026 item CANCELADO não é copiado, e o item nasce com o
  --    checklist do boletim congelado quando o produto existe no catálogo.
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
      AND upper(COALESCE(status_item, '')) <> 'CANCELADO'
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
      is_estoque,
      boletim_campos_congelado_em
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
      is_estoque,
      CASE
        WHEN EXISTS (SELECT 1 FROM public.produtos pr WHERE pr.id_produto = origem.id_produto)
        THEN now()
      END
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

  -- 3b) Snapshot do checklist do boletim: os campos que o produto marca HOJE,
  --     como num item novo. Só para os itens carimbados no passo 3.
  INSERT INTO public.produtos_proposta_boletim_campos (
    id_produto_proposta,
    campo
  )
  SELECT
    pp.id,
    c.campo
  FROM tmp_map_produtos m
  JOIN public.produtos_proposta pp
    ON pp.id = m.id_novo
  JOIN public.produto_boletim_campos c
    ON c.id_produto = pp.id_produto
  WHERE pp.boletim_campos_congelado_em IS NOT NULL;

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

  -- 4b) Copia os modelos dos itens copiados (02/10/2026 — decisão do dono).
  --     Vão as colunas que a aba Pedido grava: nome, cor do papel, quantidade,
  --     numeração (tipo, numerador, nº inicial e final — IGUAL à original),
  --     verso, bloco, camarote, ordem e o texto das variações. Coluna que o
  --     produto não imprime nasce nula, pela mesma regra do lote novo
  --     (lib/checklist-lote.ts): produto sem checklist não tem regra.
  --     A arte NÃO vai: o modelo nasce PENDENTE, sem arquivo, sem amostra e
  --     sem nenhum campo de impressão ou acabamento, e leva na observação de
  --     arte de onde veio.
  INSERT INTO public.pedidos_modelos (
    id_int,
    id_produto_proposta_origem,
    nome_modelo,
    padrao,
    quantidade,
    tipo_numeracao,
    numeracao_inicio,
    numeracao_fim,
    verso_tipo,
    bloco,
    gabarito_operacional,
    variacoes_texto,
    "Q_CAM",
    "L_CAM",
    "C_INI",
    status_arte,
    status_producao,
    ordem,
    observacao_arte,
    mapa_teatro_id,
    mapa_teatro_setor_id,
    mapa_teatro_revisao,
    mapa_teatro_snapshot
  )
  SELECT
    v_novo_id_int,
    m.id_novo,
    pm.nome_modelo,
    CASE WHEN ck.sem_regra OR ck.cor THEN pm.padrao END,
    pm.quantidade,
    CASE WHEN ck.sem_regra OR ck.tipo_numeracao THEN pm.tipo_numeracao END,
    CASE WHEN ck.sem_regra OR ck.numeracao_faixa THEN pm.numeracao_inicio END,
    CASE WHEN ck.sem_regra OR ck.numeracao_faixa THEN pm.numeracao_fim END,
    CASE WHEN ck.sem_regra OR ck.impressao_fv THEN pm.verso_tipo END,
    pm.bloco,
    CASE WHEN ck.sem_regra OR ck.num_gabarito THEN pm.gabarito_operacional END,
    pm.variacoes_texto,
    pm."Q_CAM",
    pm."L_CAM",
    pm."C_INI",
    'PENDENTE' AS status_arte,
    'PENDENTE' AS status_producao,
    pm.ordem,
    'Cópia do pedido #' || p_id_int_origem AS observacao_arte,
    -- Vínculo com o Mapa de Teatro (03/10/2026): vai como está na origem,
    -- sem recalcular a revisão nem regerar o retrato. Modelo comum leva nulo.
    pm.mapa_teatro_id,
    pm.mapa_teatro_setor_id,
    pm.mapa_teatro_revisao,
    pm.mapa_teatro_snapshot
  FROM public.pedidos_modelos pm
  JOIN tmp_map_produtos m
    ON m.id_antigo = pm.id_produto_proposta_origem
  JOIN public.produtos_proposta pp
    ON pp.id = m.id_novo
  CROSS JOIN LATERAL (
    SELECT
      COUNT(*) = 0 AS sem_regra,
      COALESCE(bool_or(c.campo = 'cor'), false) AS cor,
      COALESCE(bool_or(c.campo = 'tipo_numeracao'), false) AS tipo_numeracao,
      COALESCE(bool_or(c.campo = 'numeracao_faixa'), false) AS numeracao_faixa,
      COALESCE(bool_or(c.campo = 'impressao_fv'), false) AS impressao_fv,
      COALESCE(bool_or(c.campo = 'num_gabarito'), false) AS num_gabarito
    FROM public.produto_boletim_campos c
    WHERE c.id_produto = pp.id_produto
  ) ck
  WHERE pm.id_int = p_id_int_origem
  ORDER BY pm.ordem, pm.id;

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
  WHERE id_int = p_id_int_origem
    -- O bonus da venda (TABELA_ESPECIAL) NAO vai para a copia: ela e
    -- proposta nova e usa o bonus vigente do cliente (01/10/2026).
    AND tipo_desconto IS DISTINCT FROM 'TABELA_ESPECIAL';

  -- 6) Total da cópia sem o frete da original: produtos ativos menos o
  --    desconto geral, pela mesma conta do total soberano. Proposta não avulsa
  --    e sem itens (legado) fica com os valores da original, como antes.
  IF v_origem_avulsa
     OR EXISTS (SELECT 1 FROM public.produtos_proposta WHERE id_int = v_novo_id_int)
  THEN
    UPDATE public.propostas
       SET valor = CASE
                     WHEN v_origem_avulsa THEN valor
                     ELSE (SELECT COALESCE(SUM(pp.valor_sub_total), 0)
                             FROM public.produtos_proposta pp
                            WHERE pp.id_int = v_novo_id_int)
                   END,
           valor_total = CASE
                           -- Avulsa sem valor de produtos (não há hoje): fica como veio.
                           WHEN v_origem_avulsa AND COALESCE(valor, 0) <= 0 THEN valor_total
                           ELSE public.cc__total_soberano_proposta(v_novo_id_int)
                         END
     WHERE id_int = v_novo_id_int;
  END IF;

  RETURN v_novo_id_int;
END;
$function$;

REVOKE ALL ON FUNCTION public.copiar_proposta_v2(integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.copiar_proposta_v2(integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.copiar_proposta_v2(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.copiar_proposta_v2(integer, text) TO service_role;

-- ============================================================================
-- ROLLBACK — devolve a funcao de 20261003 (md5 1791b6bbbd0396c87ec5888748534021)
-- e tira a coluna. Tire o comentario de bloco e rode. Apagar a coluna perde o
-- motivo das copias feitas depois desta migration.
-- ============================================================================
/*
DROP FUNCTION public.copiar_proposta_v2(integer, text);

CREATE FUNCTION public.copiar_proposta_v2(p_id_int_origem integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_novo_id_int BIGINT;
  v_uid uuid := auth.uid();
  v_vendedor_origem text;
  v_origem_avulsa boolean;
  v_super boolean;
  v_admin_coluna boolean;
  v_nome_usuario text;
  v_meu_vendedor text;
  v_permissoes jsonb;
  v_tem_perfil boolean;
  v_pode boolean;
BEGIN
  -- 0) Quem pode duplicar: só quem vê a proposta (02/10/2026).
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessão não identificada. Entre de novo no sistema para duplicar a proposta.'
      USING ERRCODE = '28000';
  END IF;

  SELECT vendedor, COALESCE(is_avulso, false)
    INTO v_vendedor_origem, v_origem_avulsa
  FROM public.propostas
  WHERE id_int = p_id_int_origem;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposta #% não encontrada.', p_id_int_origem;
  END IF;

  SELECT u.is_super_adm, u.is_admin, u.nome_usuario, u.meu_vendedor, pf.permissoes, pf.id IS NOT NULL
    INTO v_super, v_admin_coluna, v_nome_usuario, v_meu_vendedor, v_permissoes, v_tem_perfil
  FROM public.usuarios u
  LEFT JOIN public.perfis pf ON pf.id = u.id_perfil AND pf.ativo = true
  WHERE u.user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário sem cadastro no sistema. Não é possível duplicar a proposta.'
      USING ERRCODE = '42501';
  END IF;

  v_permissoes := COALESCE(v_permissoes, '[]'::jsonb);

  v_pode :=
    COALESCE(v_super, false)
    OR v_permissoes ? '*'
    OR v_permissoes ? 'propostas.view_all'
    -- O administrador das telas: com perfil, a chave; sem perfil, a coluna.
    OR CASE WHEN COALESCE(v_tem_perfil, false)
            THEN v_permissoes ? 'admin.usuarios.view'
            ELSE COALESCE(v_admin_coluna, false)
       END;

  -- O vendedor dela: perfil de escopo próprio e nome igual ao da proposta,
  -- sem acento, sem caixa e sem ponto no fim ("Edison Jr." = "Edison Jr").
  IF NOT v_pode
     AND (v_permissoes ? 'propostas.view_own' OR v_permissoes ? 'propostas.view_team')
     AND btrim(COALESCE(v_vendedor_origem, '')) <> ''
  THEN
    v_pode := regexp_replace(lower(btrim(regexp_replace(unaccent(v_vendedor_origem), '\s+', ' ', 'g'))), '[.\s]+$', '')
      IN (
        regexp_replace(lower(btrim(regexp_replace(unaccent(COALESCE(NULLIF(btrim(v_nome_usuario), ''), '#')), '\s+', ' ', 'g'))), '[.\s]+$', ''),
        regexp_replace(lower(btrim(regexp_replace(unaccent(COALESCE(NULLIF(btrim(v_meu_vendedor), ''), '#')), '\s+', ' ', 'g'))), '[.\s]+$', '')
      );
  END IF;

  IF NOT COALESCE(v_pode, false) THEN
    RAISE EXCEPTION 'Você só pode duplicar proposta em que é o vendedor. Peça a um administrador ou a quem tem visão geral das propostas.'
      USING ERRCODE = '42501';
  END IF;

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
  --    Desde 02/10/2026 leva faturado, endereço (se ainda existe), contato,
  --    observações, orientação técnica e a declaração de frete. A cotação e o
  --    valor do frete continuam fora: cota de novo.
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
    id_contato,
    id_endereco_ent,
    cep,
    texto_whatsapp,
    is_copia,
    id_int_origem_copia,
    tem_veppo,
    credito_processado,
    obs_proposta,
    obs_tecnica,
    "PDF",
    tipo_cob_edeal,
    tipo_boleto_edeal,
    is_avulso,
    id_faturado,
    boleto_aproved,
    motivo_reproved,
    is_reproved,
    modalidade_frete,
    id_transportadora_cliente,
    transporte_categoria,
    categoria_frete
  )
  SELECT
    v_uid AS user_id,
    o.cliente,
    o.proposta,
    o.valor,
    o.vendedor,
    o.id_conversa,
    o.peso,
    o.id_vendedor,
    o."cnpjCpf",
    o.prop_reduz,
    'À definir' AS frete_escolhido,
    'NOVO' AS status_interno,
    o.json_produtos,
    o.empresa,
    o.volume,
    o.valor_total,
    false AS conferencia,
    NULL AS conferido_por,
    o.id_cliente,
    NULL AS id_frete,
    o.contato,
    o.id_contato,
    -- Endereço que saiu do cadastro não vai: a tela cai no padrão, como antes.
    --   O CEP vai sempre: sem o id, é por ele que a tela reencontra o endereço.
    CASE WHEN e.id IS NOT NULL THEN o.id_endereco_ent END AS id_endereco_ent,
    o.cep,
    NULL AS texto_whatsapp,
    true AS is_copia,
    p_id_int_origem AS id_int_origem_copia,
    o.tem_veppo,
    false AS credito_processado,
    o.obs_proposta,
    o.obs_tecnica,
    NULL AS "PDF",
    NULL AS tipo_cob_edeal,
    NULL AS tipo_boleto_edeal,
    o.is_avulso,
    o.id_faturado,
    true AS boleto_aproved,
    '' AS motivo_reproved,
    false AS is_reproved,
    o.modalidade_frete,
    o.id_transportadora_cliente,
    -- Em CIF as categorias saem da cotação escolhida, que não é copiada.
    CASE WHEN o.modalidade_frete IN ('FOB', 'RETIRA') THEN o.transporte_categoria END AS transporte_categoria,
    CASE WHEN o.modalidade_frete IN ('FOB', 'RETIRA') THEN o.categoria_frete END AS categoria_frete
  FROM public.propostas o
  LEFT JOIN public.enderecos e
    ON e.id::text = o.id_endereco_ent
  WHERE o.id_int = p_id_int_origem
  RETURNING id_int INTO v_novo_id_int;

  -- 2) Tabela temporária para relacionar produto antigo -> produto novo
  CREATE TEMP TABLE tmp_map_produtos (
    id_antigo BIGINT,
    id_novo   BIGINT
  ) ON COMMIT DROP;

  -- 3) Copia produtos_proposta
  --    is_estoque entrou em 24/09/2026: produto de prateleira copiado continua
  --    de prateleira (antes nascia false e a cópia passava a exigir arte).
  --    Desde 02/10/2026 item CANCELADO não é copiado, e o item nasce com o
  --    checklist do boletim congelado quando o produto existe no catálogo.
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
      AND upper(COALESCE(status_item, '')) <> 'CANCELADO'
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
      is_estoque,
      boletim_campos_congelado_em
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
      is_estoque,
      CASE
        WHEN EXISTS (SELECT 1 FROM public.produtos pr WHERE pr.id_produto = origem.id_produto)
        THEN now()
      END
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

  -- 3b) Snapshot do checklist do boletim: os campos que o produto marca HOJE,
  --     como num item novo. Só para os itens carimbados no passo 3.
  INSERT INTO public.produtos_proposta_boletim_campos (
    id_produto_proposta,
    campo
  )
  SELECT
    pp.id,
    c.campo
  FROM tmp_map_produtos m
  JOIN public.produtos_proposta pp
    ON pp.id = m.id_novo
  JOIN public.produto_boletim_campos c
    ON c.id_produto = pp.id_produto
  WHERE pp.boletim_campos_congelado_em IS NOT NULL;

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

  -- 4b) Copia os modelos dos itens copiados (02/10/2026 — decisão do dono).
  --     Vão as colunas que a aba Pedido grava: nome, cor do papel, quantidade,
  --     numeração (tipo, numerador, nº inicial e final — IGUAL à original),
  --     verso, bloco, camarote, ordem e o texto das variações. Coluna que o
  --     produto não imprime nasce nula, pela mesma regra do lote novo
  --     (lib/checklist-lote.ts): produto sem checklist não tem regra.
  --     A arte NÃO vai: o modelo nasce PENDENTE, sem arquivo, sem amostra e
  --     sem nenhum campo de impressão ou acabamento, e leva na observação de
  --     arte de onde veio.
  INSERT INTO public.pedidos_modelos (
    id_int,
    id_produto_proposta_origem,
    nome_modelo,
    padrao,
    quantidade,
    tipo_numeracao,
    numeracao_inicio,
    numeracao_fim,
    verso_tipo,
    bloco,
    gabarito_operacional,
    variacoes_texto,
    "Q_CAM",
    "L_CAM",
    "C_INI",
    status_arte,
    status_producao,
    ordem,
    observacao_arte,
    mapa_teatro_id,
    mapa_teatro_setor_id,
    mapa_teatro_revisao,
    mapa_teatro_snapshot
  )
  SELECT
    v_novo_id_int,
    m.id_novo,
    pm.nome_modelo,
    CASE WHEN ck.sem_regra OR ck.cor THEN pm.padrao END,
    pm.quantidade,
    CASE WHEN ck.sem_regra OR ck.tipo_numeracao THEN pm.tipo_numeracao END,
    CASE WHEN ck.sem_regra OR ck.numeracao_faixa THEN pm.numeracao_inicio END,
    CASE WHEN ck.sem_regra OR ck.numeracao_faixa THEN pm.numeracao_fim END,
    CASE WHEN ck.sem_regra OR ck.impressao_fv THEN pm.verso_tipo END,
    pm.bloco,
    CASE WHEN ck.sem_regra OR ck.num_gabarito THEN pm.gabarito_operacional END,
    pm.variacoes_texto,
    pm."Q_CAM",
    pm."L_CAM",
    pm."C_INI",
    'PENDENTE' AS status_arte,
    'PENDENTE' AS status_producao,
    pm.ordem,
    'Cópia do pedido #' || p_id_int_origem AS observacao_arte,
    -- Vínculo com o Mapa de Teatro (03/10/2026): vai como está na origem,
    -- sem recalcular a revisão nem regerar o retrato. Modelo comum leva nulo.
    pm.mapa_teatro_id,
    pm.mapa_teatro_setor_id,
    pm.mapa_teatro_revisao,
    pm.mapa_teatro_snapshot
  FROM public.pedidos_modelos pm
  JOIN tmp_map_produtos m
    ON m.id_antigo = pm.id_produto_proposta_origem
  JOIN public.produtos_proposta pp
    ON pp.id = m.id_novo
  CROSS JOIN LATERAL (
    SELECT
      COUNT(*) = 0 AS sem_regra,
      COALESCE(bool_or(c.campo = 'cor'), false) AS cor,
      COALESCE(bool_or(c.campo = 'tipo_numeracao'), false) AS tipo_numeracao,
      COALESCE(bool_or(c.campo = 'numeracao_faixa'), false) AS numeracao_faixa,
      COALESCE(bool_or(c.campo = 'impressao_fv'), false) AS impressao_fv,
      COALESCE(bool_or(c.campo = 'num_gabarito'), false) AS num_gabarito
    FROM public.produto_boletim_campos c
    WHERE c.id_produto = pp.id_produto
  ) ck
  WHERE pm.id_int = p_id_int_origem
  ORDER BY pm.ordem, pm.id;

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
  WHERE id_int = p_id_int_origem
    -- O bonus da venda (TABELA_ESPECIAL) NAO vai para a copia: ela e
    -- proposta nova e usa o bonus vigente do cliente (01/10/2026).
    AND tipo_desconto IS DISTINCT FROM 'TABELA_ESPECIAL';

  -- 6) Total da cópia sem o frete da original: produtos ativos menos o
  --    desconto geral, pela mesma conta do total soberano. Proposta não avulsa
  --    e sem itens (legado) fica com os valores da original, como antes.
  IF v_origem_avulsa
     OR EXISTS (SELECT 1 FROM public.produtos_proposta WHERE id_int = v_novo_id_int)
  THEN
    UPDATE public.propostas
       SET valor = CASE
                     WHEN v_origem_avulsa THEN valor
                     ELSE (SELECT COALESCE(SUM(pp.valor_sub_total), 0)
                             FROM public.produtos_proposta pp
                            WHERE pp.id_int = v_novo_id_int)
                   END,
           valor_total = CASE
                           -- Avulsa sem valor de produtos (não há hoje): fica como veio.
                           WHEN v_origem_avulsa AND COALESCE(valor, 0) <= 0 THEN valor_total
                           ELSE public.cc__total_soberano_proposta(v_novo_id_int)
                         END
     WHERE id_int = v_novo_id_int;
  END IF;

  RETURN v_novo_id_int;
END;
$function$;

REVOKE ALL ON FUNCTION public.copiar_proposta_v2(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.copiar_proposta_v2(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.copiar_proposta_v2(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.copiar_proposta_v2(integer) TO service_role;

ALTER TABLE public.propostas DROP COLUMN motivo_copia;
*/
