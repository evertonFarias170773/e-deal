-- =====================================================================
-- anon sai de 24 tabelas e 20 funcoes que nao usa; em propostas_chat fica
-- so com INSERT e SELECT
-- =====================================================================
--
-- O QUE
-- -----
-- 1. REVOKE ALL de anon em 24 tabelas (lista abaixo). authenticated,
--    service_role e postgres nao mudam; nenhuma policy muda.
-- 2. propostas_chat: anon perde UPDATE, DELETE, TRUNCATE, REFERENCES,
--    TRIGGER e MAINTAIN. Ficam INSERT e SELECT.
-- 3. REVOKE EXECUTE de PUBLIC e de anon em 20 funcoes SECURITY DEFINER.
--    authenticated e service_role tem grant proprio em todas e continuam.
--
-- Nenhum corpo de funcao muda. Nenhuma linha e lida, escrita ou apagada.
--
-- POR QUE
-- -------
-- Com a chave anon, que vai no navegador, dava para ler e gravar essas
-- tabelas (movimento_credito e clientes_socios entre elas) e chamar funcoes
-- de NF-e, de credito e de permissao sem checagem de quem chama.
--
-- POR QUE ISTO NAO QUEBRA NADA
-- ----------------------------
-- * Uso por anon, pg_stat_statements desde o restart de 22/09 21:05: zero nas
--   24 tabelas e nas 20 funcoes. Os unicos registros (1 em clientes_socios,
--   movimento_credito e produtos_proposta_variacao) sao a contagem da
--   auditoria de 26/09. O site do Imposition nao cita nenhuma das 24.
-- * propostas_chat: a estacao do Imposition grava como anon 554 vezes, e 434
--   delas com INSERT ... RETURNING, que exige SELECT. Por isso SELECT fica ate
--   o parceiro deixar de pedir a linha de volta.
-- * As funcoes que chamam estas 20 por dentro sao SECURITY DEFINER; o EXECUTE
--   e conferido contra o dono delas. Quem chama por RPC e o Vibe logado
--   (authenticated) e o n8n (service_role).
-- * `usuarios` ficou de fora: anon a consulta (lista do Imposition) e hoje
--   recebe vazio pelo RLS; revogar trocaria o vazio por 401.

-- 1. Tabelas sem uso anon
REVOKE ALL ON TABLE public."Titulo_Tarefa"               FROM anon;
REVOKE ALL ON TABLE public.arquivos_recebidos            FROM anon;
REVOKE ALL ON TABLE public.base_conhecimento_produtos    FROM anon;
REVOKE ALL ON TABLE public.categorias                    FROM anon;
REVOKE ALL ON TABLE public.cores                         FROM anon;
REVOKE ALL ON TABLE public.descontos                     FROM anon;
REVOKE ALL ON TABLE public.desconto_proposta             FROM anon;
REVOKE ALL ON TABLE public.dialogo                       FROM anon;
REVOKE ALL ON TABLE public."fotosProdutos"               FROM anon;
REVOKE ALL ON TABLE public.origem_produto                FROM anon;
REVOKE ALL ON TABLE public.produto_variacoes             FROM anon;
REVOKE ALL ON TABLE public.sem_dono                      FROM anon;
REVOKE ALL ON TABLE public.sudeste_matriz                FROM anon;
REVOKE ALL ON TABLE public.tarefas                       FROM anon;
REVOKE ALL ON TABLE public.versao                        FROM anon;
REVOKE ALL ON TABLE public.producao_config_impressora    FROM anon;
REVOKE ALL ON TABLE public.producao_print_config         FROM anon;
REVOKE ALL ON TABLE public.cotacao_frete                 FROM anon;
REVOKE ALL ON TABLE public.pagamentos                    FROM anon;
REVOKE ALL ON TABLE public.pagamentos_publicos           FROM anon;
REVOKE ALL ON TABLE public.clientes_socios               FROM anon;
REVOKE ALL ON TABLE public.movimento_credito             FROM anon;
REVOKE ALL ON TABLE public.produtos_proposta_variacao    FROM anon;
REVOKE ALL ON TABLE public.contatos                      FROM anon;

-- 2. propostas_chat: ficam INSERT e SELECT
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.propostas_chat FROM anon;

-- 3. Funcoes SECURITY DEFINER sem uso anon
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recalcular_proposta_v4(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.copiar_proposta_v2(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_lancar_movimento_credito(bigint, text, numeric, text, bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_cancelar_movimento_credito(bigint, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_analise_credito_cliente(bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_montar_payload_nfe(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_preparar_envio_nfe(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_salvar_retorno_focus_nfe(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_criar_rascunho_nfe(bigint, bigint, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_trocar_destinatario_nfe(text, bigint, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_alertas_nfe(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public."preview-nfe-rascunho"(bigint, bigint, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_recalcular_totais_nfe(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_renumerar_itens_nfe(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_clonar_rascunho_nfe(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_trocar_empresa_nfe(text, integer, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_permissoes_perfil(bigint, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_dashboard_executivo(date, date, date, date, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_gerar_pagamentos_nfe(text, numeric, integer, integer, integer, text, date, boolean, date) FROM PUBLIC, anon;
