-- ============================================================================
-- produtos — coluna nova `verso_padrao` ("Frente e Verso" do cadastro)
-- 07/10/2026 — pedido do gerente, decisões do dono.
--
-- SITUAÇÃO: APLICADA em 07/10/2026 (migration produtos_verso_padrao), com o
-- "pode aplicar" do dono. Retrato do piloto conferido antes e depois no pedido
-- de teste 23096: só mudaram a chave nova do produto, a seção de produtos e a
-- revisao; as outras oito seções ficaram com o mesmo resumo.
--
-- O QUE É
--   O verso com que o modelo NOVO do produto nasce na aba Pedido. A tela do
--   catálogo grava; `padroesDeNovoLote` (aba Pedido) lê no momento de criar o
--   modelo. Modelo que já existe nunca é relido.
--
-- O QUE MUDA
--   Uma coluna: public.produtos.verso_padrao, text, nula, sem default.
--   Sem CHECK: a lista (SÓ FRENTE, FRENTE E VERSO, VERSO FIXO, VERSO VARIÁVEL)
--   é validada pela constante do app (src/features/orcamentos/lib/
--   verso-do-modelo.ts), a mesma do campo Verso do modelo.
--   Sem backfill: os produtos existentes ficam sem valor, e produto sem valor
--   se comporta como hoje (modelo nasce SÓ FRENTE).
--
-- QUEM DEPENDE DE public.produtos (conferido em 07/10/2026)
--   - Gatilhos: trg_audit_produtos (log_row_changes_v2, usa to_jsonb, genérico)
--     e trg_produto_boletim_campos_padrao (lê só id_produto e is_estoque).
--   - Visões: view_base_conhecimento e view_base_conhecimento_produtos listam
--     colunas; não mudam.
--   - Funções que leem a tabela (copiar_proposta_v2, duplicar_proposta,
--     recalcular_proposta_v3, fn_criar_rascunho_nfe, fn_alertas_nfe,
--     fn_autopreencher_fiscal_nfe_item, fn_preencher_peso_unitario_nfe_item,
--     gerar_texto_whatsapp*, produtos_export_md, cc__total_soberano_proposta,
--     buscar_imagens_por_produtos): citam colunas pelo nome; nenhuma usa
--     produtos%ROWTYPE, SELECT * nem INSERT sem lista de colunas.
--   - duplicar_produto: INSERT com lista fixa de colunas (não copia nem
--     id_formato); o produto duplicado nasce sem verso_padrao. O app não a chama.
--   - RETRATO DO PILOTO: piloto_snapshot_pedido devolve to_jsonb(p) de
--     public.produtos. A coluna nova aparece como chave nova ("verso_padrao":
--     null) em cada produto do retrato. O consumidor está fora deste
--     repositório — é a pergunta que o dono faz ao parceiro antes de aplicar.
--
-- O QUE NÃO MUDA
--   RLS, políticas, permissões, gatilhos, visões e funções. Nenhuma linha de
--   produtos nem de pedidos_modelos é regravada.
-- ============================================================================

DO $migracao$
DECLARE
  v_linhas_antes bigint;
  v_linhas_depois bigint;
  v_com_valor bigint;
  v_tipo text;
  v_nula text;
  v_default text;
BEGIN
  SELECT count(*) INTO v_linhas_antes FROM public.produtos;

  ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS verso_padrao text;

  COMMENT ON COLUMN public.produtos.verso_padrao IS
    'Frente e Verso do cadastro: verso com que o modelo NOVO do produto nasce na aba Pedido (SÓ FRENTE, FRENTE E VERSO, VERSO FIXO, VERSO VARIÁVEL). Nulo = SÓ FRENTE. Lista validada no app (lib/verso-do-modelo.ts). Não altera modelo existente.';

  SELECT data_type, is_nullable, column_default
    INTO v_tipo, v_nula, v_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'produtos' AND column_name = 'verso_padrao';

  IF v_tipo IS DISTINCT FROM 'text' OR v_nula IS DISTINCT FROM 'YES' OR v_default IS NOT NULL THEN
    RAISE EXCEPTION 'verso_padrao fora do combinado: tipo %, nula %, default %', v_tipo, v_nula, v_default;
  END IF;

  SELECT count(*), count(verso_padrao) INTO v_linhas_depois, v_com_valor FROM public.produtos;
  IF v_linhas_depois <> v_linhas_antes THEN
    RAISE EXCEPTION 'contagem de produtos mudou: % -> %', v_linhas_antes, v_linhas_depois;
  END IF;
  IF v_com_valor <> 0 THEN
    RAISE EXCEPTION 'esperado nenhum produto com verso_padrao (sem backfill), achei %', v_com_valor;
  END IF;

  RAISE NOTICE 'produtos.verso_padrao criada: text, nula, sem default; % produtos, nenhum com valor', v_linhas_depois;
END
$migracao$;

-- ============================================================================
-- ROLLBACK (não roda sozinho)
--
-- Antes de reverter, publique o app SEM a coluna: a tela do catálogo lê e grava
-- `verso_padrao`, e com a coluna removida a leitura de produtos passa a falhar.
-- O rollback apaga os valores que o catálogo tiver gravado. Guarde-os antes:
--
--   SELECT id_produto, verso_padrao FROM public.produtos WHERE verso_padrao IS NOT NULL;
--
-- Nenhum modelo é afetado: pedidos_modelos.verso_tipo guarda a sua própria cópia.
-- ============================================================================
/*
ALTER TABLE public.produtos DROP COLUMN IF EXISTS verso_padrao;
*/
