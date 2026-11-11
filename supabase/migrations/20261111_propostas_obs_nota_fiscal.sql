-- ============================================================================
-- propostas — coluna nova `obs_nota_fiscal` ("Observação para a nota fiscal")
-- 11/11/2026 — decisão do Everton (caso do pedido 25049: nome do projeto e
-- número de captação da Rouanet na NF).
--
-- SITUAÇÃO: autorizada pelo dono em 11/11/2026, só esta migration.
--
-- O QUE É
--   Uma coluna aditiva em public.propostas, nulável e sem default:
--
--     obs_nota_fiscal  text
--
--   Texto livre que o vendedor quer IMPRESSO na nota do pedido. Editado no
--   bloco "4. Dados para nota fiscal" da aba Geral e na aba "Produção /
--   Expedição / Notas" (mesmo campo, mesma coluna). Vai para as Informações
--   Complementares da NF-e (rascunho novo) e da NFS-e (janela), depois do que
--   já sai hoje. Não se confunde com `obs_proposta` (bloco "10. Observações e
--   Condições"), que é interno e NÃO vai para a nota.
--
--   Nula = ninguém escreveu. NÃO HÁ BACKFILL.
--
-- O QUE NÃO MUDA
--   Nenhuma linha, nenhuma outra coluna, nenhum gatilho, função, visão, índice,
--   política, grant ou default. `vw_propostas_lista` (p.* congelado) não passa
--   a enxergar a coluna, e não precisa. `copiar_proposta_v2` e
--   `criar_pedido_complementar` inserem por lista de colunas: a coluna nova NÃO
--   é copiada (como `obs_entrega`). Nenhuma nota é tocada: notas já criadas
--   guardam o próprio texto em `notas_fiscais.informacoes_complementares`.
--
-- GATILHOS DE propostas (o que qualquer UPDATE já dispara): updated_at,
-- auditoria; os demais saem sem agir para esta coluna (medido para
-- obs_entrega em 09/10/2026, mesmo desenho).
--
-- TRAVA
--   lock_timeout de 5 s; com a tabela travada, confere que NADA mudou além da
--   coluna nova (resumo md5 de todas as linhas, antes e depois).
-- ============================================================================

DO $migracao$
DECLARE
  v_linhas_antes bigint;
  v_linhas_depois bigint;
  v_hash_antes text;
  v_hash_depois text;
  v_com_valor bigint;
  v_tipo text;
  v_nula text;
  v_default text;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  LOCK TABLE public.propostas IN ACCESS EXCLUSIVE MODE;

  SELECT count(*), md5(coalesce(string_agg(md5((to_jsonb(p) - 'obs_nota_fiscal')::text), '' ORDER BY md5((to_jsonb(p) - 'obs_nota_fiscal')::text)), ''))
    INTO v_linhas_antes, v_hash_antes
    FROM public.propostas p;

  ALTER TABLE public.propostas ADD COLUMN IF NOT EXISTS obs_nota_fiscal text;

  COMMENT ON COLUMN public.propostas.obs_nota_fiscal IS
    'Observacao para a nota fiscal (texto livre). Vai para as Informacoes Complementares da NF-e e da NFS-e do pedido. Nula = ninguem escreveu. Nao confundir com obs_proposta (interna).';

  SELECT data_type, is_nullable, column_default
    INTO v_tipo, v_nula, v_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'propostas' AND column_name = 'obs_nota_fiscal';

  IF v_tipo IS DISTINCT FROM 'text' OR v_nula IS DISTINCT FROM 'YES' OR v_default IS NOT NULL THEN
    RAISE EXCEPTION 'obs_nota_fiscal fora do combinado: tipo %, nula %, default %', v_tipo, v_nula, v_default;
  END IF;

  EXECUTE $sql$
    SELECT count(*), count(obs_nota_fiscal),
           md5(coalesce(string_agg(md5((to_jsonb(p) - 'obs_nota_fiscal')::text), '' ORDER BY md5((to_jsonb(p) - 'obs_nota_fiscal')::text)), ''))
      FROM public.propostas p
  $sql$ INTO v_linhas_depois, v_com_valor, v_hash_depois;

  IF v_linhas_depois <> v_linhas_antes THEN
    RAISE EXCEPTION 'contagem de propostas mudou: % -> %', v_linhas_antes, v_linhas_depois;
  END IF;
  IF v_com_valor <> 0 THEN
    RAISE EXCEPTION 'esperado nenhuma proposta com obs_nota_fiscal (sem backfill), achei %', v_com_valor;
  END IF;
  IF v_hash_depois IS DISTINCT FROM v_hash_antes THEN
    RAISE EXCEPTION 'o resumo de propostas mudou alem da coluna nova: % -> %', v_hash_antes, v_hash_depois;
  END IF;

  RAISE NOTICE 'propostas.obs_nota_fiscal criada: text, nula, sem default; % propostas, nenhuma com valor; resumo % (igual antes e depois)', v_linhas_depois, v_hash_depois;
END
$migracao$;

-- ============================================================================
-- ROLLBACK (não roda sozinho)
--
-- Antes de reverter, publique o app SEM a coluna: a proposta, a Fila de
-- faturamento e as janelas das notas passam a ler `obs_nota_fiscal`. O
-- rollback apaga os textos gravados. Guarde-os antes:
--
--   select id_int, obs_nota_fiscal from public.propostas where obs_nota_fiscal is not null;
-- ============================================================================
/*
DO $rollback$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  ALTER TABLE public.propostas DROP COLUMN IF EXISTS obs_nota_fiscal;
END
$rollback$;
*/
