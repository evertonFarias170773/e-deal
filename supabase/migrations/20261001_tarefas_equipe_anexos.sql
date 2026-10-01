-- =============================================================================
-- tarefas_equipe_anexos — PDF e imagem, ate 10 MB, em bucket privado.
-- Spec: docs/superpowers/specs/2026-09-30-tarefas-equipe-design.md (etapa 1)
-- Autorizada pelo dono em 01/10/2026 (migrations da etapa 1).
--
-- O bucket `tarefas-anexos` NAO tem policy em storage.objects: anon e
-- authenticated nao leem nem gravam nada nele. Quem toca o bucket e a service
-- role, dentro das rotas /api/tarefas, depois de a sessao do usuario provar
-- que ele enxerga a tarefa. O download e por link assinado de 60 segundos.
--
-- As duas policies restritivas que ja existem em storage.objects
-- (ideal_control_master_privado, sem listagem anonima) so fecham acesso e nao
-- abrem nada para este bucket.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tarefas-anexos',
  'tarefas-anexos',
  false,
  10485760,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']
);

create table public.tarefas_equipe_anexos (
  id                  bigint generated always as identity primary key,
  tarefa_id           bigint      not null references public.tarefas_equipe(id) on delete cascade,
  momento             text        not null,
  nome_arquivo        text        not null,
  caminho             text        not null unique,
  tipo_mime           text        not null,
  tamanho_bytes       integer     not null,
  enviado_por_user_id uuid        not null default auth.uid() references auth.users(id),
  created_at          timestamptz not null default now(),
  constraint tarefas_equipe_anexos_momento_chk check (momento in ('CRIACAO', 'ANDAMENTO', 'CONCLUSAO')),
  constraint tarefas_equipe_anexos_nome_chk    check (char_length(btrim(nome_arquivo)) between 1 and 200),
  constraint tarefas_equipe_anexos_mime_chk    check (tipo_mime in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  constraint tarefas_equipe_anexos_tamanho_chk check (tamanho_bytes between 1 and 10485760),
  constraint tarefas_equipe_anexos_caminho_chk check (caminho like 'tarefa/' || tarefa_id::text || '/%')
);
create index tarefas_equipe_anexos_tarefa_idx on public.tarefas_equipe_anexos (tarefa_id, created_at);

comment on table public.tarefas_equipe_anexos is
  'Anexos das tarefas. Arquivo no bucket privado tarefas-anexos; download so pela rota /api/tarefas/anexos/[id].';

-- Anexar: quem enxerga a tarefa, enquanto ela esta aberta ou em andamento.
create function public.tarefas_equipe__aceita_anexo(p_tarefa bigint, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.tarefas_equipe__pode_ver(p_tarefa, p_user_id)
     and exists (
       select 1 from public.tarefas_equipe t
        where t.id = p_tarefa and t.status in ('ABERTA', 'EM_ANDAMENTO')
     );
$$;

revoke all on function public.tarefas_equipe__aceita_anexo(bigint, uuid) from public, anon;
grant execute on function public.tarefas_equipe__aceita_anexo(bigint, uuid) to authenticated, service_role;

alter table public.tarefas_equipe_anexos enable row level security;

create policy tarefas_equipe_anexos_select on public.tarefas_equipe_anexos
  for select to authenticated
  using (public.tarefas_equipe__pode_ver(tarefa_id, (select auth.uid())));

create policy tarefas_equipe_anexos_insert on public.tarefas_equipe_anexos
  for insert to authenticated
  with check (
    enviado_por_user_id = (select auth.uid())
    and public.tarefas_equipe__aceita_anexo(tarefa_id, (select auth.uid()))
  );

revoke all on table public.tarefas_equipe_anexos from anon;
revoke update, delete, truncate, references, trigger on table public.tarefas_equipe_anexos from authenticated;
