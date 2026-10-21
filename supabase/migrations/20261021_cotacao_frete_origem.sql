-- ============================================================================
-- 20261021_cotacao_frete_origem — de onde veio o frete escolhido
-- 21/10/2026 — decisao do dono.
--
-- POR QUE: card calculado (COTACAO) trava a transportadora e o "Valor cobrado"
--   na aba Fretes; frete manual (MANUAL) segue editavel. Sem esta coluna a linha
--   gravada nao diz qual dos dois ela e, e a regra so valeria ate o Salvar.
--
-- O QUE MUDA: so a coluna `origem` (text, nula) com CHECK COTACAO/MANUAL.
--   Sem default e sem backfill: as linhas existentes ficam com origem vazia e
--   seguem editaveis, como hoje. Quem grava e o Salvar da aba Fretes
--   (lib/origem-frete.ts). n8n (SEDEX), complementar_aplicar_frete e as rotas da
--   Expedicao inserem com lista de colunas: gravam origem nula, como antes.
--   Gatilhos (tg_recalc_frete_v4, trg_frete_sync_financeiro, trg_recalc_after_frete)
--   e a view vw_proposta_completa leem so colunas existentes. ACL e RLS iguais.
--
-- ROLLBACK: no rodape.
-- ============================================================================

ALTER TABLE public.cotacao_frete
  ADD COLUMN origem text
  CONSTRAINT cotacao_frete_origem_valida CHECK (origem IS NULL OR origem IN ('COTACAO', 'MANUAL'));

COMMENT ON COLUMN public.cotacao_frete.origem IS
  'De onde veio o frete escolhido (21/10/2026): COTACAO = card calculado (transportadora e valor so leitura na aba Fretes); MANUAL = frete manual (editavel); nulo = linha antiga ou gravada fora da aba (editavel). Gravada pelo Salvar (lib/origem-frete.ts).';

-- ============================================================================
-- ROLLBACK — tire o comentario de bloco e rode.
-- ============================================================================
/*
ALTER TABLE public.cotacao_frete DROP COLUMN origem;
*/
