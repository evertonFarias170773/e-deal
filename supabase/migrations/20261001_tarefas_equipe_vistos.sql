-- =============================================================================
-- tarefas_equipe_vistos — marca, por usuario, que a tarefa foi aberta.
-- Spec: docs/superpowers/specs/2026-09-30-tarefas-equipe-design.md (etapa 1)
-- Autorizada pelo dono em 01/10/2026 (migrations da etapa 1).
--
-- O sinal piscando no menu e na Topbar = existe tarefa recebida por mim,
-- criada por outra pessoa, aberta ou em andamento, sem linha minha aqui.
-- `tarefas_equipe_resumo()` devolve esse numero e o contador das minhas.
-- =============================================================================

create table public.tarefas_equipe_vistos (
  tarefa_id bigint      not null references public.tarefas_equipe(id) on delete cascade,
  user_id   uuid        not null default auth.uid() references auth.users(id),
  visto_em  timestamptz not null default now(),
  primary key (tarefa_id, user_id)
);
create index tarefas_equipe_vistos_user_idx on public.tarefas_equipe_vistos (user_id, tarefa_id);

alter table public.tarefas_equipe_vistos enable row level security;

create policy tarefas_equipe_vistos_select on public.tarefas_equipe_vistos
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy tarefas_equipe_vistos_insert on public.tarefas_equipe_vistos
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.tarefas_equipe__pode_ver(tarefa_id, (select auth.uid()))
  );

revoke all on table public.tarefas_equipe_vistos from anon;
revoke update, delete, truncate, references, trigger on table public.tarefas_equipe_vistos from authenticated;

-- -----------------------------------------------------------------------------
-- Resumo para o menu e a Topbar. SECURITY INVOKER: o RLS de tarefas_equipe
-- vale, entao so entram tarefas que o usuario enxerga.
--   minhas     = ABERTA/EM_ANDAMENTO em que sou o responsavel, ou que recebi
--                (destinatario ou para todos) e ainda estao sem responsavel.
--   nao_vistas = recebidas por mim, criadas por outra pessoa, ABERTA ou
--                EM_ANDAMENTO, que eu ainda nao abri.
-- -----------------------------------------------------------------------------
create function public.tarefas_equipe_resumo()
returns table (minhas integer, nao_vistas integer)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with eu as (
    select auth.uid() as uid, public.tarefas_equipe__eh_da_equipe(auth.uid()) as da_equipe
  ),
  ativas as (
    select t.id, t.responsavel_user_id, t.criado_por_user_id,
           (t.tipo = 'TAREFA' and (
              (t.para_todos and eu.da_equipe)
              or public.tarefas_equipe__eh_destinatario(t.id, eu.uid))) as recebida,
           eu.uid
      from public.tarefas_equipe t, eu
     where t.status in ('ABERTA', 'EM_ANDAMENTO')
  )
  select
    count(*) filter (
      where responsavel_user_id = uid or (responsavel_user_id is null and recebida)
    )::integer,
    count(*) filter (
      where recebida
        and criado_por_user_id <> uid
        and not exists (select 1 from public.tarefas_equipe_vistos v where v.tarefa_id = ativas.id and v.user_id = ativas.uid)
    )::integer
  from ativas;
$$;

revoke all on function public.tarefas_equipe_resumo() from public, anon;
grant execute on function public.tarefas_equipe_resumo() to authenticated, service_role;
