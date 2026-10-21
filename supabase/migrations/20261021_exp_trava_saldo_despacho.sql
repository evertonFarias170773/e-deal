-- =============================================================================
-- 20261021_exp_trava_saldo_despacho
--
-- TRAVA DE SALDO NO DESPACHO (21/10/2026).
--
-- O despacho de pedido normal nao tinha guarda financeira: com o total alterado
-- depois do pagamento (modalidade, frete), o pedido saia com saldo a cobrar.
-- Agora o banco recusa a PRIMEIRA gravacao de `expedicoes.data_despacho`
-- (vazia -> preenchida) quando ha saldo a definir:
--
--   saldo = round(propostas.valor_total, 2) - cc__valor_pago(id_int)
--
-- comparado em centavos, sem tolerancia: R$ 0,01 devedor ja bloqueia. O "pago"
-- e o criterio que ja existe em `cc__valor_pago` (PAID, ou A_VENCER com
-- confirmado = true); nenhum criterio novo.
--
-- QUANDO AGE
--   So na transicao de `data_despacho` de vazio para preenchido (INSERT com
--   data, ou UPDATE de NULL para data) — o Despachar da Expedicao, inclusive
--   retirada no balcao e o complemento que sai junto. Mesmo padrao de
--   `trg_exp_trava_frete_despacho`. Nao age em:
--     - webhook dos Correios, `ve_registrar`, Marcar como entregue, prepostagem,
--       etiqueta: nenhum deles grava `data_despacho`;
--     - redespacho de pedido ja despachado (OLD.data_despacho preenchida);
--     - "Voltar um passo" (data_despacho volta a NULL).
--   Gravacao direta do navegador e RLS permissiva nao contornam: e trigger.
--
-- SAIDA PARA O OPERADOR
--   Cobrar a diferenca na aba Pagamentos (e esperar a confirmacao) ou o ADM
--   abonar a diferenca (/api/orcamentos/abonar-diferenca, que baixa o total).
--   Nao ha liberacao de ADM na propria trava: a liberacao de despacho
--   (`expedicao_despacho_liberacoes`) e da diferenca de FRETE e nao vale aqui.
--
-- NAO MEXE em cotacao_frete, valor_total, engine de status, LIBERADO nem na
-- entrada na producao. Nao corrige pedidos ja despachados (sem backfill).
--
-- TRAVA DE APLICACAO: so aplica se o trigger e as funcoes de hoje baterem com
-- o md5 lido no mapeamento de 21/10/2026, e se os nomes novos nao existirem.
-- =============================================================================

SET LOCAL lock_timeout = '8s';

DO $trava$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'exp__trg_trava_frete_despacho';
  IF v_md5 IS DISTINCT FROM 'c77dff2370af2d41c9cf902cfb853c1a' THEN
    RAISE EXCEPTION 'exp__trg_trava_frete_despacho mudou desde o mapeamento (md5 %). Nada aplicado.', v_md5;
  END IF;

  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'cc__valor_pago'
     AND pg_get_function_identity_arguments(p.oid) = 'p_id_int bigint';
  IF v_md5 IS DISTINCT FROM '09d4cc275f1872cdb4adc72c8bdfcbb3' THEN
    RAISE EXCEPTION 'cc__valor_pago mudou desde o mapeamento (md5 %). Nada aplicado.', v_md5;
  END IF;

  SELECT md5(pg_get_triggerdef(t.oid)) INTO v_md5
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'expedicoes' AND t.tgname = 'trg_exp_trava_frete_despacho';
  IF v_md5 IS DISTINCT FROM md5('CREATE TRIGGER trg_exp_trava_frete_despacho BEFORE INSERT OR UPDATE ON public.expedicoes FOR EACH ROW EXECUTE FUNCTION exp__trg_trava_frete_despacho()') THEN
    RAISE EXCEPTION 'trg_exp_trava_frete_despacho mudou desde o mapeamento. Nada aplicado.';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname IN ('exp__reais', 'exp_saldo_despacho', 'exp__trg_trava_saldo_despacho'))
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_exp_trava_despacho_saldo') THEN
    RAISE EXCEPTION 'exp_saldo_despacho, exp__trg_trava_saldo_despacho ou trg_exp_trava_despacho_saldo ja existem. Nada aplicado.';
  END IF;
END
$trava$;

-- Valor em reais no formato da tela: 1.234,56
CREATE OR REPLACE FUNCTION public.exp__reais(p_valor numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT 'R$ ' || translate(to_char(round(coalesce(p_valor, 0), 2), 'FM999,999,999,990.00'), ',.', '.,');
$$;

-- O veredito: a trigger usa para recusar e a tela do Despachar consulta para
-- dizer o motivo antes do clique. A tela so pergunta; quem decide e o banco.
CREATE OR REPLACE FUNCTION public.exp_saldo_despacho(p_id_int bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total       numeric;
  v_pago        numeric;
  v_saldo_cent  bigint;
  v_saldo       numeric;
BEGIN
  SELECT round(coalesce(valor_total, 0)::numeric, 2) INTO v_total
    FROM public.propostas WHERE id_int = p_id_int;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('bloqueia', false, 'situacao', 'SEM_PROPOSTA');
  END IF;

  v_pago := coalesce(public.cc__valor_pago(p_id_int), 0);
  v_saldo_cent := round(v_total * 100)::bigint - round(v_pago * 100)::bigint;
  v_saldo := round(v_saldo_cent / 100.0, 2);

  IF v_saldo_cent <= 0 THEN
    RETURN jsonb_build_object('bloqueia', false, 'situacao', 'SEM_SALDO',
      'total', v_total, 'pago', v_pago, 'saldo', v_saldo);
  END IF;

  RETURN jsonb_build_object(
    'bloqueia', true,
    'situacao', 'SALDO_A_RECEBER',
    'total', v_total,
    'pago', v_pago,
    'saldo', v_saldo,
    'mensagem',
      'Despacho bloqueado: falta receber ' || public.exp__reais(v_saldo) || ' deste pedido. ' ||
      'O total do pedido é ' || public.exp__reais(v_total) || ' e o pago confirmado é ' || public.exp__reais(v_pago) || '. ' ||
      'Gere a cobrança da diferença na aba Pagamentos da proposta (ou peça ao administrador para abonar a diferença) ' ||
      'e despache depois que o pagamento for confirmado.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.exp__trg_trava_saldo_despacho()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_veredito jsonb;
BEGIN
  -- So a primeira gravacao do despacho: vazio -> preenchido.
  IF NEW.data_despacho IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.data_despacho IS NOT NULL THEN RETURN NEW; END IF;

  v_veredito := public.exp_saldo_despacho(NEW.id_int);
  IF coalesce((v_veredito->>'bloqueia')::boolean, false) THEN
    RAISE EXCEPTION 'EXP_DESPACHO_TRAVA_SALDO: %', v_veredito->>'mensagem'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

-- Nome escolhido para rodar ANTES da trava de frete (ordem alfabetica dos
-- BEFORE triggers): quem tem saldo ouve primeiro o motivo do saldo.
CREATE TRIGGER trg_exp_trava_despacho_saldo
  BEFORE INSERT OR UPDATE OF data_despacho ON public.expedicoes
  FOR EACH ROW EXECUTE FUNCTION public.exp__trg_trava_saldo_despacho();

REVOKE ALL ON FUNCTION public.exp__reais(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp__reais(numeric) TO authenticated, service_role, supabase_read_only_user;

REVOKE ALL ON FUNCTION public.exp_saldo_despacho(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_saldo_despacho(bigint) TO authenticated, service_role, supabase_read_only_user;

REVOKE ALL ON FUNCTION public.exp__trg_trava_saldo_despacho() FROM PUBLIC, anon, authenticated;
