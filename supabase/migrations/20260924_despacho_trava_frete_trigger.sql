-- ============================================================================
-- Liga a trava do despacho — 24/09/2026. Par de
-- 20260924_despacho_trava_frete_recotacao.sql (tabelas, veredito e funcao da
-- trigger), aplicada ANTES e sem efeito ate aqui.
--
-- Aplicada so depois de o app que grava as recotacoes (rota cotar) e mostra a
-- liberacao do ADM estar no ar. A partir daqui, marcar `data_despacho` em
-- pedido CIF com CEP ou transporte diferentes do cotado exige recotacao ate
-- R$ 4,00 acima do frete da proposta, ou liberacao de ADM.
-- ============================================================================
CREATE TRIGGER trg_exp_trava_frete_despacho
  BEFORE INSERT OR UPDATE ON public.expedicoes
  FOR EACH ROW EXECUTE FUNCTION public.exp__trg_trava_frete_despacho();
