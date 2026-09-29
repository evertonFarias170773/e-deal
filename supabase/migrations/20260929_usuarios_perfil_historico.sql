-- ============================================================================
-- Historico de troca de perfil + TRUNCATE fora de public.usuarios
-- 29/09/2026, decisao do dono — autorizacao nominal SO para esta migration.
--
-- 1. public.usuarios_perfil_historico
--    A rota POST /api/admin/usuarios/perfil grava `usuarios.id_perfil` com a
--    service role, e o audit.logs_v2 so ve `actor_role = service_role`, sem o
--    usuario. Esta tabela guarda quem trocou, de quem, de qual perfil para qual
--    e quando — uma linha por troca bem-sucedida, gravada pela propria rota.
--    Sem FK para usuarios de proposito: apagar um usuario nao pode apagar o
--    historico de quem mexeu nele.
--    RLS ativa e nenhuma policy: so a service_role (que ignora RLS) grava e le.
--    O REVOKE e explicito porque, em public, tabela criada por postgres nasce
--    com ALL para authenticated (default privileges).
--
-- 2. TRUNCATE em public.usuarios sai de anon e authenticated. TRUNCATE ignora
--    RLS: com ele, qualquer sessao esvaziava a tabela inteira.
-- ============================================================================

create table public.usuarios_perfil_historico (
  id          bigint generated always as identity primary key,
  alterado_em timestamptz not null default now(),
  autor_uid   uuid        not null,
  autor_email text,
  autor_nome  text,
  alvo_uid    uuid        not null,
  alvo_email  text,
  perfil_de   integer,
  perfil_para integer
);

comment on table public.usuarios_perfil_historico is
  'Uma linha por troca de usuarios.id_perfil feita pela rota /api/admin/usuarios/perfil (service role). Quem alterou (autor), de quem (alvo), de qual perfil para qual e quando. So a service_role grava e le.';

create index usuarios_perfil_historico_alvo_idx on public.usuarios_perfil_historico (alvo_uid, alterado_em desc);

alter table public.usuarios_perfil_historico enable row level security;

revoke all on public.usuarios_perfil_historico from public, anon, authenticated;
grant all on public.usuarios_perfil_historico to service_role;

revoke truncate on public.usuarios from anon, authenticated;
