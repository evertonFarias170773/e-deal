-- ============================================================================
-- public.usuarios: SELECT por coluna
-- 29/09/2026, decisao do dono — autorizacao nominal SO para esta migration.
--
-- O QUE ESTAVA ERRADO
--   Todo usuario logado lia todas as colunas de todos os usuarios
--   (`usuarios_sel` = true e SELECT de tabela), inclusive cod_confirma
--   (codigo de confirmacao), telefone, documento, "cpfCnpj" e cus_asaas.
--
-- O QUE MUDA
--   anon e authenticated perdem o SELECT de tabela; authenticated recebe SELECT
--   so nas colunas que o Vibe le. Ficam de fora: cod_confirma, telefone,
--   documento, "cpfCnpj" e cus_asaas. As policies (qual LINHA se ve) nao mudam.
--
-- PREPARADO ANTES
--   - 357752e: a checagem de pendencias deixou o select("*");
--   - 20260929_chat_autor_sem_select_estrela: o trigger do chat deixou o select *.
--   As 43 leituras de usuarios no codigo pedem so colunas desta lista; as
--   funcoes SECURITY INVOKER e as policies de outras tabelas tambem.
--
-- NAO MUDA
--   service_role e as funcoes SECURITY DEFINER (donas postgres) leem tudo.
--   O UPDATE por coluna de authenticated (inclusive telefone, so da propria
--   linha) segue como esta.
-- ============================================================================

revoke select on public.usuarios from anon, authenticated;

grant select (
  user_id, email, nome_usuario, is_admin, is_super_adm, is_vendedor, is_designer,
  is_impressor, is_expedidor, id_perfil, id_empresa, setor, avatar, meu_vendedor,
  id_vendedor, data_cadastro, data_atualizacao, whats_confirmado, "clienteIdeal"
) on public.usuarios to authenticated;
