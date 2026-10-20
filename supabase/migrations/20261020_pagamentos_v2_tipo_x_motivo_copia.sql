-- ============================================================================
-- 20261020_pagamentos_v2_tipo_x_motivo_copia — E-RETRABALHO x pedido de retrabalho
-- 20/10/2026 — decisao do dono.
--
-- REGRA (vale para TODA porta que grava em pagamentos_v2: tela, area do
-- cliente, rotas pagamento-combinado e usar-credito; o n8n nao cria cobranca)
--   1. E-RETRABALHO so nasce em pedido com propostas.motivo_copia = RETRABALHO
--      OU em pedido que JA TEVE uma E-RETRABALHO (qualquer status, inclusive
--      cancelada): sao os retrabalhos antigos, sem motivo gravado.
--      Mensagem: "E-Retrabalho só pode ser usado em pedido criado como Retrabalho".
--   2. Pedido com motivo_copia = RETRABALHO so aceita E-RETRABALHO.
--      Mensagem: "Pedido de retrabalho só aceita cobrança E-Retrabalho".
--      Pedido antigo (motivo vazio) que ja teve E-RETRABALHO: so a regra 1 vale;
--      outras formas continuam livres nele.
--
-- QUANDO AGE
--   BEFORE INSERT, e BEFORE UPDATE OF tipo_cobranca, id_int SO quando um dos dois
--   muda de fato (um UPDATE que reenvia a linha inteira com os mesmos valores
--   passa direto). Atualizacao de status, confirmacao, valor etc. nunca entra:
--   nem dispara o gatilho. Nenhuma linha existente e tocada.
--
-- CONVIVENCIA com os 9 gatilhos existentes (mapa de 20/10/2026): os BEFORE de
--   INSERT so preenchem token e id_pagamento; o BEFORE de UPDATE so olha a
--   confirmacao; os AFTER so rodam se a gravacao passar.
--
-- SEGURANCA: SECURITY INVOKER (le propostas e pagamentos_v2 com os direitos de
--   quem grava; todas as portas leem as duas tabelas). search_path fixo. Funcao
--   de gatilho nao precisa de EXECUTE para disparar: sem grant a PUBLIC, anon
--   nem authenticated.
--
-- ROLLBACK: no rodape.
-- ============================================================================

CREATE FUNCTION public.fn_pgv2_tipo_x_motivo_copia()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tipo   text := upper(btrim(coalesce(NEW.tipo_cobranca, '')));
  v_motivo text;
BEGIN
  -- UPDATE que nao muda tipo nem pedido: nada a conferir.
  IF TG_OP = 'UPDATE'
     AND NEW.tipo_cobranca IS NOT DISTINCT FROM OLD.tipo_cobranca
     AND NEW.id_int IS NOT DISTINCT FROM OLD.id_int
  THEN
    RETURN NEW;
  END IF;

  IF NEW.id_int IS NOT NULL THEN
    SELECT p.motivo_copia INTO v_motivo
    FROM public.propostas p
    WHERE p.id_int = NEW.id_int;
  END IF;

  IF v_tipo = 'E-RETRABALHO' THEN
    IF v_motivo IS DISTINCT FROM 'RETRABALHO'
       AND NOT EXISTS (
         SELECT 1
         FROM public.pagamentos_v2 o
         WHERE o.id_int = NEW.id_int
           AND upper(btrim(coalesce(o.tipo_cobranca, ''))) = 'E-RETRABALHO'
           AND o.id IS DISTINCT FROM NEW.id
       )
    THEN
      RAISE EXCEPTION 'E-Retrabalho só pode ser usado em pedido criado como Retrabalho'
        USING ERRCODE = 'P0001', HINT = 'Crie o pedido pelo Duplicar proposta, opção Retrabalho.';
    END IF;
  ELSIF v_motivo = 'RETRABALHO' THEN
    RAISE EXCEPTION 'Pedido de retrabalho só aceita cobrança E-Retrabalho'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_pgv2_tipo_x_motivo_copia() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_pgv2_tipo_x_motivo_copia() FROM anon;
REVOKE ALL ON FUNCTION public.fn_pgv2_tipo_x_motivo_copia() FROM authenticated;

COMMENT ON FUNCTION public.fn_pgv2_tipo_x_motivo_copia() IS
  'Gatilho de pagamentos_v2 (20/10/2026): E-RETRABALHO so em pedido RETRABALHO (motivo_copia) ou que ja teve E-RETRABALHO; pedido RETRABALHO so aceita E-RETRABALHO. Age na criacao e quando tipo_cobranca ou id_int mudam.';

CREATE TRIGGER trg_pgv2_tipo_x_motivo_copia
  BEFORE INSERT OR UPDATE OF tipo_cobranca, id_int ON public.pagamentos_v2
  FOR EACH ROW EXECUTE FUNCTION public.fn_pgv2_tipo_x_motivo_copia();

-- ============================================================================
-- ROLLBACK — tire o comentario de bloco e rode.
-- ============================================================================
/*
DROP TRIGGER IF EXISTS trg_pgv2_tipo_x_motivo_copia ON public.pagamentos_v2;
DROP FUNCTION IF EXISTS public.fn_pgv2_tipo_x_motivo_copia();
*/
