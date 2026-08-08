-- Produto de Prateleira — dispensa do fluxo de arte
--
-- O QUE E
--   Produto de prateleira e vendido pronto: nao existe arte para criar, revisar
--   ou aprovar. Quando TODOS os itens ativos de uma proposta sao de prateleira,
--   a etapa de Arte e dispensada e a proposta vai de LIBERADO direto para
--   REVISAO ATENDENTE assim que o pagamento for confirmado pela regra oficial.
--
--   Nenhum status novo e criado. FLUXO-OFICIAL-STATUS-PROPOSTAS.md ja preve o
--   caso: secao 6.6 ("arte nao necessaria ou concluida") e a matriz da secao 13
--   ("Arte concluida ou dispensada"). Prateleira e a materializacao do
--   "dispensada".
--
-- POR QUE REAPROVEITAR is_estoque
--   public.produtos.is_estoque ja existia como boolean default false e estava
--   dormente: 0 de 64 produtos marcados, nenhuma view, constraint, indice,
--   politica RLS ou funcao decidindo comportamento por ele (a unica funcao que
--   o cita, duplicar_produto, apenas copia a coluna). Criar um segundo flag
--   parecido (is_prateleira) deixaria dois conceitos concorrentes no catalogo.
--   Decisao tomada em 10/08/2026: is_estoque passa a significar "produto de
--   prateleira". A UI foi rerrotulada junto com esta migration.
--
-- SNAPSHOT NA PROPOSTA
--   produtos_proposta.is_estoque congela a decisao no momento da venda, no
--   mesmo espirito de ncm/cfop, que ja sao snapshot. Sem isso, desmarcar o
--   produto depois faria uma proposta ja paga voltar a exigir arte.
--
-- KILL-SWITCH NATURAL
--   Enquanto nenhum produto estiver marcado, a condicao de dispensa e sempre
--   falsa e o comportamento e bit a bit o de hoje.
--
-- ANTES DE APLICAR — verificacao (somente leitura)
--
--   a) Nenhum uso funcional ativo do flag:
--
--        select 'FUNCAO' as tipo, n.nspname || '.' || p.proname as objeto
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--        where n.nspname not in ('pg_catalog','information_schema')
--          and p.prokind = 'f' and pg_get_functiondef(p.oid) ilike '%is_estoque%'
--        union all
--        select 'VIEW', schemaname || '.' || viewname from pg_views
--        where definition ilike '%is_estoque%' and schemaname not in ('pg_catalog','information_schema')
--        union all
--        select 'CONSTRAINT', conrelid::regclass::text || ' / ' || conname
--        from pg_constraint where pg_get_constraintdef(oid) ilike '%is_estoque%'
--        union all
--        select 'INDICE', schemaname || '.' || indexname from pg_indexes where indexdef ilike '%is_estoque%'
--        union all
--        select 'RLS', schemaname || '.' || tablename || ' / ' || policyname from pg_policies
--        where (coalesce(qual,'') || coalesce(with_check,'')) ilike '%is_estoque%';
--
--      Esperado em 10/08/2026: apenas public.duplicar_produto.
--
--   b) Quantos produtos ja estao marcados (define o alcance do backfill):
--
--        select count(*) filter (where is_estoque is true) as prateleira,
--               count(*) as total
--        from public.produtos;
--
-- ROLLBACK
--   A definicao anterior de check_and_promote_proposta esta preservada no rodape
--   deste arquivo. A coluna produtos_proposta.is_estoque pode permanecer:
--   `default false` a torna inerte.

-- 1. Semantica do flag no catalogo ------------------------------------------

comment on column public.produtos.is_estoque is
  'Produto de prateleira: vendido pronto, dispensa o fluxo de arte. Quando todos os itens ativos de uma proposta apontam para produtos com este flag, a proposta pula a etapa de Arte e vai de LIBERADO para REVISAO ATENDENTE. Rotulado "Produto de prateleira" na UI desde 10/08/2026.';

-- 2. Snapshot no item da proposta --------------------------------------------

alter table public.produtos_proposta
  add column if not exists is_estoque boolean not null default false;

comment on column public.produtos_proposta.is_estoque is
  'Copia de produtos.is_estoque no momento do save (produto de prateleira). Congelada de proposito: alterar o cadastro do produto depois nao muda propostas ja fechadas.';

-- 3. Backfill ----------------------------------------------------------------
--    Idempotente. Em 10/08/2026 nenhum produto esta marcado, entao e no-op;
--    fica registrado para o caso de a marcacao ocorrer antes do deploy.

update public.produtos_proposta pp
set is_estoque = true
from public.produtos p
where p.id_produto = pp.id_produto
  and p.is_estoque is true
  and pp.is_estoque is false;

-- 4. Promocao para REVISAO ATENDENTE -----------------------------------------
--    Unica mudanca: alem de "ultima arte APROVADO", tambem promove quando a
--    arte esta dispensada (todos os itens ativos de prateleira). Proposta com
--    qualquer item normal continua exigindo arte aprovada, exatamente como hoje.
--
--    Esta funcao e o ponto de garantia no banco: cobre confirmacao de pagamento
--    que nao passe pela rota do app (integracao gravando direto em
--    pagamentos_v2). Disparada por trg_sync_finiro_to_proposta (pagamentos_v2)
--    e trg_sync_artes_to_proposta (pedidos_artes).

create or replace function public.check_and_promote_proposta(p_id_int integer)
 returns void
 language plpgsql
 security definer
as $function$
DECLARE
    v_is_avulso boolean;
    v_pagamentos_total integer;
    v_pagamentos_confirmados integer;
    v_arte_status text;
    v_itens_total integer;
    v_itens_prateleira integer;
    v_arte_dispensada boolean;
BEGIN
    IF p_id_int IS NULL THEN
        RETURN;
    END IF;

    SELECT COALESCE(is_avulso, false)
    INTO v_is_avulso
    FROM public.propostas
    WHERE id_int = p_id_int;

    IF COALESCE(v_is_avulso, false) = true THEN
        RETURN;
    END IF;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (
            WHERE COALESCE(UPPER(status), '') IN ('PAID', 'A_VENCER')
              AND COALESCE(confirmado, false) = true
        )
    INTO
        v_pagamentos_total,
        v_pagamentos_confirmados
    FROM public.pagamentos_v2
    WHERE id_int = p_id_int
      AND COALESCE(UPPER(status), '') NOT IN ('CANCELADO', 'CANCELADA');

    SELECT COALESCE(UPPER(status), '')
    INTO v_arte_status
    FROM public.pedidos_artes
    WHERE id_int = p_id_int
    ORDER BY created_at DESC
    LIMIT 1;

    -- Arte dispensada: proposta com pelo menos um item ativo e TODOS de
    -- prateleira. Zero itens nunca dispensa. Item cancelado nao conta.
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE is_estoque IS TRUE)
    INTO
        v_itens_total,
        v_itens_prateleira
    FROM public.produtos_proposta
    WHERE id_int = p_id_int
      AND COALESCE(UPPER(status_item), '') <> 'CANCELADO';

    v_arte_dispensada := v_itens_total > 0 AND v_itens_total = v_itens_prateleira;

    IF v_pagamentos_total > 0
       AND v_pagamentos_total = v_pagamentos_confirmados
       AND (v_arte_status = 'APROVADO' OR v_arte_dispensada)
    THEN
        UPDATE public.propostas
        SET status_interno = 'REVISAO ATENDENTE'
        WHERE id_int = p_id_int
          AND COALESCE(status_interno, '') <> 'REVISAO ATENDENTE';
    END IF;
END;
$function$;

-- 5. Conferencia pos-aplicacao (somente leitura) ------------------------------
--
--      select column_name, data_type, column_default, is_nullable
--      from information_schema.columns
--      where table_schema='public' and table_name='produtos_proposta' and column_name='is_estoque';
--
--      select pg_get_functiondef(p.oid) from pg_proc p
--      join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname='public' and p.proname='check_and_promote_proposta';
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK — definicao anterior de check_and_promote_proposta (10/08/2026)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- CREATE OR REPLACE FUNCTION public.check_and_promote_proposta(p_id_int integer)
--  RETURNS void LANGUAGE plpgsql SECURITY DEFINER
-- AS $function$
-- DECLARE
--     v_is_avulso boolean;
--     v_pagamentos_total integer;
--     v_pagamentos_confirmados integer;
--     v_arte_status text;
-- BEGIN
--     IF p_id_int IS NULL THEN RETURN; END IF;
--     SELECT COALESCE(is_avulso, false) INTO v_is_avulso
--       FROM public.propostas WHERE id_int = p_id_int;
--     IF COALESCE(v_is_avulso, false) = true THEN RETURN; END IF;
--     SELECT COUNT(*),
--            COUNT(*) FILTER (WHERE COALESCE(UPPER(status), '') IN ('PAID','A_VENCER')
--                               AND COALESCE(confirmado, false) = true)
--       INTO v_pagamentos_total, v_pagamentos_confirmados
--       FROM public.pagamentos_v2
--      WHERE id_int = p_id_int
--        AND COALESCE(UPPER(status), '') NOT IN ('CANCELADO','CANCELADA');
--     SELECT COALESCE(UPPER(status), '') INTO v_arte_status
--       FROM public.pedidos_artes WHERE id_int = p_id_int
--      ORDER BY created_at DESC LIMIT 1;
--     IF v_pagamentos_total > 0
--        AND v_pagamentos_total = v_pagamentos_confirmados
--        AND v_arte_status = 'APROVADO'
--     THEN
--         UPDATE public.propostas SET status_interno = 'REVISAO ATENDENTE'
--          WHERE id_int = p_id_int AND COALESCE(status_interno, '') <> 'REVISAO ATENDENTE';
--     END IF;
-- END;
-- $function$;
