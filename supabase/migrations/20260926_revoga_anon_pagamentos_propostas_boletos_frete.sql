-- =====================================================================
-- anon sai de pagamentos_v2, propostas, boletos, transportadoras e
-- calcular_frete_transportadora
-- =====================================================================
--
-- O QUE
-- -----
-- 1. REVOKE ALL de anon nas quatro tabelas. Em pagamentos_v2 isso leva junto
--    os grants por coluna de anon (INSERT e UPDATE em 58 colunas).
-- 2. REVOKE EXECUTE de PUBLIC e anon em calcular_frete_transportadora.
--
-- authenticated, service_role e postgres nao mudam (grants de tabela, de
-- coluna e de funcao). Nenhuma policy muda. Nenhuma linha e lida ou escrita.
--
-- POR QUE
-- -------
-- Com a chave anon, que vai no navegador, dava para ler as 10 mil propostas,
-- os 9 mil pagamentos e os boletos, e gravar pagamentos_v2 por coluna.
--
-- POR QUE ISTO NAO QUEBRA NADA
-- ----------------------------
-- * Todo o uso anon medido era do proprio Vibe: o CobrancasProvider carregava
--   sem sessao (lista de pagamentos_v2, faturado das propostas, boletos) e as
--   rotas de recotacao e de frete do complementar cotavam transportadoras sem
--   o JWT do usuario. Corrigido no commit afbdb40, publicado antes desta
--   migration; depois do deploy as chamadas anon a estes objetos pararam.
-- * A estacao do Imposition nao le estes objetos como anon. Os triggers que
--   leem propostas em tabelas que anon grava (atualiza_flag_arte_proposta,
--   exp__trg_trava_frete_despacho) sao SECURITY DEFINER; checagem de FK roda
--   com o dono da tabela.
-- * Portal do cliente (link_cliente_*) e QR da OS (os_qr_*) sao SECURITY
--   DEFINER e nao dependem de grant de anon. O pagamento do cliente vai pela
--   Edge Function pagamento-publico, com service role.

REVOKE ALL ON TABLE public.pagamentos_v2   FROM anon;
REVOKE ALL ON TABLE public.propostas       FROM anon;
REVOKE ALL ON TABLE public.boletos         FROM anon;
REVOKE ALL ON TABLE public.transportadoras FROM anon;

REVOKE EXECUTE ON FUNCTION public.calcular_frete_transportadora(text, text, numeric) FROM PUBLIC, anon;
