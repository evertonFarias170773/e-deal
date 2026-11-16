-- ============================================================================
-- 20261116_pagamentos_v2_frete_cif_zero — frete CIF nunca e R$ 0,00 na cobranca
-- 16/11/2026 — regra do dono de 11/11/2026; trava pedida pelo Everton.
--
-- REGRA (toda porta que grava em pagamentos_v2: tela, area do cliente, rotas
-- pagamento-combinado, usar-credito, faturado-com-entrada, trocar-forma)
--   A PRIMEIRA cobranca viva de um pedido CIF com propostas.valor_frete <= 0 e
--   recusada com:
--     "Frete CIF não pode ser R$ 0,00. Cote ou informe o valor do frete."
--   Mesma regra do Salvar (src/features/orcamentos/lib/frete-cif-zero.ts).
--
-- FORA DA REGRA
--   - proposta avulsa (is_avulso: "Frete Incluso");
--   - pedido complementar (id_int_pedido_principal: CIF com diferenca <= 0);
--   - cliente com clientes.pode_editar_frete = true (ate a diretoria decidir);
--   - modalidade FOB ou RETIRA (nula cobra frete, como CIF);
--   - pedido sem item ativo (o Salvar tambem dispensa: amostra sem produto);
--   - pedido que JA TEM cobranca viva (status fora de CANCELADO/CANCELADA): o
--     pedido existente nao e corrigido aqui, e a troca de forma de pagamento,
--     que grava a nova antes de cancelar a antiga, segue passando.
--   - cobranca sem id_int (debito avulso).
--
-- QUANDO AGE: BEFORE INSERT. Nenhuma linha existente e tocada; UPDATE nao entra.
--
-- SEGURANCA: SECURITY DEFINER para ler propostas, clientes e produtos_proposta
--   sem depender da RLS de quem grava (a area do cliente grava com a chave de
--   servico; a tela com a sessao). So le. search_path fixo. Sem EXECUTE para
--   PUBLIC, anon ou authenticated: funcao de gatilho nao precisa.
--
-- ROLLBACK: no rodape.
-- ============================================================================

CREATE FUNCTION public.fn_pgv2_frete_cif_zero()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_avulso     boolean;
  v_principal  bigint;
  v_modalidade text;
  v_frete      numeric;
  v_cliente    bigint;
  v_pode       boolean;
BEGIN
  IF NEW.id_int IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(p.is_avulso, false), p.id_int_pedido_principal,
         upper(btrim(coalesce(p.modalidade_frete, ''))), coalesce(p.valor_frete, 0), p.id_cliente
    INTO v_avulso, v_principal, v_modalidade, v_frete, v_cliente
    FROM public.propostas p
   WHERE p.id_int = NEW.id_int;

  IF NOT FOUND
     OR v_avulso
     OR v_principal IS NOT NULL
     OR v_modalidade IN ('FOB', 'RETIRA')
     OR v_frete > 0
  THEN
    RETURN NEW;
  END IF;

  SELECT c.pode_editar_frete INTO v_pode FROM public.clientes c WHERE c.id_cliente = v_cliente;
  IF coalesce(v_pode, false) THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.produtos_proposta pp
     WHERE pp.id_int = NEW.id_int
       AND (pp.status_item IS NULL OR pp.status_item <> 'CANCELADO')
  ) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pagamentos_v2 o
     WHERE o.id_int = NEW.id_int
       AND o.id IS DISTINCT FROM NEW.id
       AND upper(btrim(coalesce(o.status, ''))) NOT IN ('CANCELADO', 'CANCELADA')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Frete CIF não pode ser R$ 0,00. Cote ou informe o valor do frete.'
    USING ERRCODE = 'P0001', HINT = 'Cote o frete na aba Fretes, ou declare RETIRA ou FOB.';
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_pgv2_frete_cif_zero() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_pgv2_frete_cif_zero() FROM anon;
REVOKE ALL ON FUNCTION public.fn_pgv2_frete_cif_zero() FROM authenticated;

COMMENT ON FUNCTION public.fn_pgv2_frete_cif_zero() IS
  'Gatilho de pagamentos_v2 (16/11/2026): recusa a primeira cobranca viva de pedido CIF com valor_frete <= 0. Fora: avulsa, complementar, cliente pode_editar_frete, FOB/RETIRA, pedido sem item ativo, pedido que ja tem cobranca viva.';

CREATE TRIGGER trg_pgv2_frete_cif_zero
  BEFORE INSERT ON public.pagamentos_v2
  FOR EACH ROW EXECUTE FUNCTION public.fn_pgv2_frete_cif_zero();

-- ============================================================================
-- ROLLBACK — tire o comentario de bloco e rode.
-- ============================================================================
/*
DROP TRIGGER IF EXISTS trg_pgv2_frete_cif_zero ON public.pagamentos_v2;
DROP FUNCTION IF EXISTS public.fn_pgv2_frete_cif_zero();
*/
