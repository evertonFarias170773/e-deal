-- =============================================================================
-- tarefas_equipe — tarefas entre pessoas da equipe e lista de melhorias do DEV
-- Especificacao: docs/superpowers/specs/2026-09-30-tarefas-equipe-design.md
--
-- Autorizada pelo dono em 30/09/2026 (migration que cria tarefas_equipe com RLS
-- e indices). Tudo aqui pertence a essa tabela: as duas funcoes de apoio da RLS,
-- a trigger que guarda as transicoes e a entrada na publicacao do realtime.
--
-- Tres camadas:
--   1. RLS: quem ve, cria e altera cada linha.
--   2. Trigger tarefas_equipe__guarda: qual transicao vale, quem pode, autor e
--      horario pelo auth.uid() (o que o cliente mandar nesses campos e ignorado),
--      campos imutaveis.
--   3. Privilegios: anon sem nada; authenticated sem DELETE e sem TRUNCATE
--      (TRUNCATE passa por cima do RLS). Ninguem apaga tarefa.
-- =============================================================================

create table public.tarefas_equipe (
  id                     bigint generated always as identity primary key,
  tipo                   text        not null default 'TAREFA',
  titulo                 text        not null,
  descricao              text,
  responsavel_user_id    uuid        references auth.users(id),
  id_int                 bigint      references public.propostas(id_int) on delete set null,
  id_cliente             integer     references public.clientes(id_cliente) on delete set null,
  data_limite            date,
  status                 text        not null default 'ABERTA',
  criado_por_user_id     uuid        not null default auth.uid() references auth.users(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  assumido_por_user_id   uuid        references auth.users(id),
  assumido_at            timestamptz,
  concluido_por_user_id  uuid        references auth.users(id),
  concluido_at           timestamptz,
  observacao_conclusao   text,
  cancelado_por_user_id  uuid        references auth.users(id),
  cancelado_at           timestamptz,
  constraint tarefas_equipe_tipo_chk      check (tipo in ('TAREFA', 'MELHORIA')),
  constraint tarefas_equipe_status_chk    check (status in ('ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA')),
  constraint tarefas_equipe_titulo_chk    check (char_length(btrim(titulo)) between 1 and 200),
  constraint tarefas_equipe_descricao_chk check (descricao is null or char_length(descricao) <= 5000),
  constraint tarefas_equipe_obs_chk       check (observacao_conclusao is null or char_length(observacao_conclusao) <= 1000),
  constraint tarefas_equipe_responsavel_chk check (tipo = 'MELHORIA' or responsavel_user_id is not null)
);

comment on table public.tarefas_equipe is
  'Tarefas entre pessoas da equipe (TAREFA) e lista de melhorias para o DEV (MELHORIA). Substitui propostas_pendencias. Spec 2026-09-30-tarefas-equipe-design.md.';

create index tarefas_equipe_responsavel_idx on public.tarefas_equipe (responsavel_user_id, status);
create index tarefas_equipe_criador_idx     on public.tarefas_equipe (criado_por_user_id, status);
create index tarefas_equipe_tipo_idx        on public.tarefas_equipe (tipo, status, created_at desc);
create index tarefas_equipe_id_int_idx      on public.tarefas_equipe (id_int) where id_int is not null;
create index tarefas_equipe_id_cliente_idx  on public.tarefas_equipe (id_cliente) where id_cliente is not null;

-- -----------------------------------------------------------------------------
-- Quem e admin: o mesmo criterio da tela (usuarios.service.ts). Com perfil
-- ativo, decide o perfil ('*' ou 'admin.usuarios.view'); sem perfil,
-- is_admin ou is_super_adm. SECURITY DEFINER porque usuarios tem SELECT por
-- coluna e public.is_admin() esta quebrada.
-- -----------------------------------------------------------------------------
create function public.tarefas_equipe__eh_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case
             when p.id is not null then (p.permissoes ? '*' or p.permissoes ? 'admin.usuarios.view')
             else coalesce(u.is_admin, false) or coalesce(u.is_super_adm, false)
           end
      from public.usuarios u
      left join public.perfis p on p.id = u.id_perfil and p.ativo
     where u.user_id = p_user_id
  ), false);
$$;

-- Usuario da equipe: perfil ativo com pelo menos uma permissao. Deixa de fora o
-- perfil "Acesso Pendente" (lista vazia) e quem nao tem linha em usuarios.
create function public.tarefas_equipe__eh_da_equipe(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.usuarios u
      join public.perfis p on p.id = u.id_perfil and p.ativo
     where u.user_id = p_user_id
       and jsonb_typeof(p.permissoes) = 'array'
       and jsonb_array_length(p.permissoes) > 0
  );
$$;

revoke all on function public.tarefas_equipe__eh_admin(uuid) from public, anon;
revoke all on function public.tarefas_equipe__eh_da_equipe(uuid) from public, anon;
grant execute on function public.tarefas_equipe__eh_admin(uuid) to authenticated, service_role;
grant execute on function public.tarefas_equipe__eh_da_equipe(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Guarda das transicoes
-- -----------------------------------------------------------------------------
create function public.tarefas_equipe__guarda()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean;
begin
  if tg_op = 'INSERT' then
    new.titulo := btrim(new.titulo);
    new.descricao := nullif(btrim(coalesce(new.descricao, '')), '');
    new.status := 'ABERTA';
    new.created_at := now();
    new.updated_at := now();
    new.assumido_por_user_id := null;  new.assumido_at := null;
    new.concluido_por_user_id := null; new.concluido_at := null; new.observacao_conclusao := null;
    new.cancelado_por_user_id := null; new.cancelado_at := null;

    if v_uid is not null then
      new.criado_por_user_id := v_uid;
      if new.tipo = 'MELHORIA' and not public.tarefas_equipe__eh_admin(v_uid) then
        raise exception 'Somente a diretoria e os administradores criam melhorias.' using errcode = '42501';
      end if;
    end if;

    if new.responsavel_user_id is not null then
      if not public.tarefas_equipe__eh_da_equipe(new.responsavel_user_id) then
        raise exception 'A pessoa escolhida não é um usuário ativo da equipe.' using errcode = '23514';
      end if;
      if new.tipo = 'MELHORIA' and not public.tarefas_equipe__eh_admin(new.responsavel_user_id) then
        raise exception 'Melhoria só pode ser atribuída a um administrador.' using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE ------------------------------------------------------------------
  if new.id is distinct from old.id
     or new.tipo is distinct from old.tipo
     or new.criado_por_user_id is distinct from old.criado_por_user_id
     or new.created_at is distinct from old.created_at
     or new.titulo is distinct from old.titulo
     or new.descricao is distinct from old.descricao
     or new.data_limite is distinct from old.data_limite
     or (new.id_int is distinct from old.id_int and new.id_int is not null)
     or (new.id_cliente is distinct from old.id_cliente and new.id_cliente is not null)
  then
    raise exception 'Os dados da tarefa não podem ser alterados, só a situação.' using errcode = '42501';
  end if;

  -- Mesma situacao: so passa o vinculo virando nulo (pedido ou cliente apagado).
  if new.status = old.status then
    if (new.responsavel_user_id, new.assumido_por_user_id, new.assumido_at,
        new.concluido_por_user_id, new.concluido_at, new.observacao_conclusao,
        new.cancelado_por_user_id, new.cancelado_at)
       is distinct from
       (old.responsavel_user_id, old.assumido_por_user_id, old.assumido_at,
        old.concluido_por_user_id, old.concluido_at, old.observacao_conclusao,
        old.cancelado_por_user_id, old.cancelado_at)
    then
      raise exception 'Use assumir, concluir ou cancelar para mudar a tarefa.' using errcode = '42501';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if old.status in ('CONCLUIDA', 'CANCELADA') then
    raise exception 'Esta tarefa já foi encerrada.' using errcode = '42501';
  end if;
  if new.status = 'ABERTA' then
    raise exception 'Uma tarefa não volta para aberta.' using errcode = '42501';
  end if;

  -- Campos de ciclo de vida: o cliente nao escolhe; a trigger preenche.
  new.assumido_por_user_id := old.assumido_por_user_id;  new.assumido_at := old.assumido_at;
  new.concluido_por_user_id := old.concluido_por_user_id; new.concluido_at := old.concluido_at;
  new.cancelado_por_user_id := old.cancelado_por_user_id; new.cancelado_at := old.cancelado_at;
  new.observacao_conclusao := case when new.status = 'CONCLUIDA'
                                   then nullif(btrim(coalesce(new.observacao_conclusao, '')), '')
                                   else old.observacao_conclusao end;
  new.updated_at := now();

  -- Sem usuario (service_role, SQL do painel): so registra a transicao.
  if v_uid is null then
    new.responsavel_user_id := old.responsavel_user_id;
    if new.status = 'EM_ANDAMENTO' then new.assumido_at := now(); end if;
    if new.status = 'CONCLUIDA' then new.concluido_at := now(); end if;
    if new.status = 'CANCELADA' then new.cancelado_at := now(); end if;
    return new;
  end if;

  v_admin := public.tarefas_equipe__eh_admin(v_uid);

  -- Responsavel so muda num caso: admin assume ou conclui melhoria sem dono.
  if new.responsavel_user_id is distinct from old.responsavel_user_id then
    if not (old.tipo = 'MELHORIA' and old.responsavel_user_id is null and v_admin
            and new.status in ('EM_ANDAMENTO', 'CONCLUIDA')) then
      raise exception 'O responsável da tarefa não pode ser trocado.' using errcode = '42501';
    end if;
  end if;
  if old.tipo = 'MELHORIA' and old.responsavel_user_id is null and v_admin
     and new.status in ('EM_ANDAMENTO', 'CONCLUIDA') then
    new.responsavel_user_id := v_uid;
  end if;

  if new.status = 'EM_ANDAMENTO' then
    if old.status <> 'ABERTA' then
      raise exception 'Esta tarefa já foi assumida.' using errcode = '42501';
    end if;
    if not (v_admin or v_uid = old.responsavel_user_id) then
      raise exception 'Só quem recebeu a tarefa ou um administrador pode assumi-la.' using errcode = '42501';
    end if;
    new.assumido_por_user_id := v_uid;
    new.assumido_at := now();

  elsif new.status = 'CONCLUIDA' then
    if not (v_admin or v_uid = old.responsavel_user_id) then
      raise exception 'Só quem recebeu a tarefa ou um administrador pode concluí-la.' using errcode = '42501';
    end if;
    if old.status = 'ABERTA' then
      new.assumido_por_user_id := v_uid;
      new.assumido_at := now();
    end if;
    new.concluido_por_user_id := v_uid;
    new.concluido_at := now();

  elsif new.status = 'CANCELADA' then
    if not (v_admin or v_uid = old.criado_por_user_id) then
      raise exception 'Só quem criou a tarefa ou um administrador pode cancelá-la.' using errcode = '42501';
    end if;
    new.cancelado_por_user_id := v_uid;
    new.cancelado_at := now();
  end if;

  return new;
end;
$$;

revoke all on function public.tarefas_equipe__guarda() from public, anon;

create trigger tarefas_equipe__guarda
  before insert or update on public.tarefas_equipe
  for each row execute function public.tarefas_equipe__guarda();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.tarefas_equipe enable row level security;

create policy tarefas_equipe_select on public.tarefas_equipe
  for select to authenticated
  using (
    (select public.tarefas_equipe__eh_admin((select auth.uid())))
    or (tipo = 'TAREFA' and (criado_por_user_id = (select auth.uid())
                             or responsavel_user_id = (select auth.uid())))
  );

create policy tarefas_equipe_insert on public.tarefas_equipe
  for insert to authenticated
  with check (
    criado_por_user_id = (select auth.uid())
    and status = 'ABERTA'
    and (tipo = 'TAREFA' or (select public.tarefas_equipe__eh_admin((select auth.uid()))))
  );

create policy tarefas_equipe_update on public.tarefas_equipe
  for update to authenticated
  using (
    (select public.tarefas_equipe__eh_admin((select auth.uid())))
    or (tipo = 'TAREFA' and (criado_por_user_id = (select auth.uid())
                             or responsavel_user_id = (select auth.uid())))
  )
  with check (
    (select public.tarefas_equipe__eh_admin((select auth.uid())))
    or (tipo = 'TAREFA' and (criado_por_user_id = (select auth.uid())
                             or responsavel_user_id = (select auth.uid())))
  );

-- Sem policy de DELETE: ninguem apaga. E sem o privilegio, para TRUNCATE nao
-- contornar o RLS.
revoke all on table public.tarefas_equipe from anon;
revoke delete, truncate, references, trigger on table public.tarefas_equipe from authenticated;

-- -----------------------------------------------------------------------------
-- Realtime (contador e toasts). O realtime aplica o RLS de quem escuta.
-- -----------------------------------------------------------------------------
alter publication supabase_realtime add table public.tarefas_equipe;
