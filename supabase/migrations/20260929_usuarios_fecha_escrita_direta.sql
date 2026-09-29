-- ============================================================================
-- public.usuarios: fim da escrita direta na linha de outro usuario
-- 29/09/2026, decisao do dono — autorizacao nominal SO para esta migration.
--
-- O QUE ESTAVA ERRADO
--   `usuarios_upd` (UPDATE, true/true), `usuarios_ins` (INSERT, true) e
--   `usuarios_del` (DELETE, true) para authenticated: qualquer usuario logado
--   alterava, criava ou apagava a linha de qualquer outro — inclusive
--   `is_super_adm`, `is_admin` e `id_perfil`, ou seja, se promovia a Super Admin.
--
-- O QUE MUDA
--   - saem as tres policies; ficam `update own row` (auth.uid() = user_id) e
--     `insert via service_role`;
--   - anon e authenticated perdem INSERT, UPDATE e DELETE na tabela;
--   - authenticated volta a ter UPDATE so em (nome_usuario, telefone, avatar,
--     data_atualizacao) — com a policy, so na propria linha.
--   Perfil e flags de admin nao sao mais graváveis por sessao de usuario. A
--   troca de perfil passa por POST /api/admin/usuarios/perfil (service role,
--   checagem no servidor), publicada ANTES desta migration (940ba85).
--
-- O QUE NAO MUDA
--   SELECT (usuarios_sel e select own row), o cadastro pelo Auth
--   (handle_new_user, SECURITY DEFINER de postgres) e o painel do Supabase.
--   TRUNCATE de anon/authenticated fica como esta: fora do escopo autorizado.
-- ============================================================================

drop policy if exists usuarios_upd on public.usuarios;
drop policy if exists usuarios_ins on public.usuarios;
drop policy if exists usuarios_del on public.usuarios;

revoke insert, update, delete on public.usuarios from anon, authenticated;

grant update (nome_usuario, telefone, avatar, data_atualizacao) on public.usuarios to authenticated;
