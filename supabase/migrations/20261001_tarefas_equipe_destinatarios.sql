-- =============================================================================
-- tarefas_equipe_destinatarios — uma ou mais pessoas, ou "todos".
-- Spec: docs/superpowers/specs/2026-09-30-tarefas-equipe-design.md (etapa 1)
-- Autorizada pelo dono em 01/10/2026 (migrations da etapa 1).
--
-- - Destinatarios numa tabela propria; "todos" e a coluna para_todos.
-- - Todos os destinatarios veem; qualquer um assume; quem assume vira o
--   responsavel (responsavel_user_id fica vazio ate alguem assumir).
-- - Criacao so pela funcao tarefas_equipe_criar (tarefa + destinatarios na
--   mesma transacao). Sai a policy de INSERT direto em tarefas_equipe.
-- - A tarefa que ja existia (id 7, Everton para Edison, ABERTA) passa o
--   responsavel para a lista de destinatarios e fica sem responsavel.
-- =============================================================================

alter table public.tarefas_equipe add column para_todos boolean not null default false;
alter table public.tarefas_equipe drop constraint tarefas_equipe_responsavel_chk;
alter table public.tarefas_equipe
  add constraint tarefas_equipe_melhoria_sem_todos_chk check (tipo = 'TAREFA' or not para_todos);

create table public.tarefas_equipe_destinatarios (
  tarefa_id bigint not null references public.tarefas_equipe(id) on delete cascade,
  user_id   uuid   not null references auth.users(id),
  primary key (tarefa_id, user_id)
);
create index tarefas_equipe_destinatarios_user_idx on public.tarefas_equipe_destinatarios (user_id, tarefa_id);
create index tarefas_equipe_todos_idx on public.tarefas_equipe (status) where para_todos;

comment on table public.tarefas_equipe_destinatarios is
  'Pessoas que receberam a tarefa. Tarefa para todos (tarefas_equipe.para_todos) nao tem linhas aqui.';

-- -----------------------------------------------------------------------------
-- Apoio da RLS (SECURITY DEFINER: le as tabelas sem passar pelo RLS, o que
-- evita recursao entre as policies de tarefas_equipe e das tabelas filhas).
-- -----------------------------------------------------------------------------
create function public.tarefas_equipe__eh_destinatario(p_tarefa bigint, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.tarefas_equipe_destinatarios d
     where d.tarefa_id = p_tarefa and d.user_id = p_user_id
  );
$$;

-- Quem enxerga a tarefa: admin; na TAREFA, tambem quem criou, o responsavel,
-- os destinatarios e, se for para todos, a equipe.
create function public.tarefas_equipe__pode_ver(p_tarefa bigint, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select public.tarefas_equipe__eh_admin(p_user_id)
           or (t.tipo = 'TAREFA' and (
                 t.criado_por_user_id = p_user_id
              or t.responsavel_user_id = p_user_id
              or (t.para_todos and public.tarefas_equipe__eh_da_equipe(p_user_id))
              or public.tarefas_equipe__eh_destinatario(t.id, p_user_id)))
      from public.tarefas_equipe t
     where t.id = p_tarefa
  ), false);
$$;

revoke all on function public.tarefas_equipe__eh_destinatario(bigint, uuid) from public, anon;
revoke all on function public.tarefas_equipe__pode_ver(bigint, uuid) from public, anon;
grant execute on function public.tarefas_equipe__eh_destinatario(bigint, uuid) to authenticated, service_role;
grant execute on function public.tarefas_equipe__pode_ver(bigint, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Dados existentes (antes da trigger nova, com a trigger desligada so aqui)
-- -----------------------------------------------------------------------------
insert into public.tarefas_equipe_destinatarios (tarefa_id, user_id)
select id, responsavel_user_id
  from public.tarefas_equipe
 where tipo = 'TAREFA' and responsavel_user_id is not null
on conflict do nothing;

alter table public.tarefas_equipe disable trigger tarefas_equipe__guarda;
update public.tarefas_equipe
   set responsavel_user_id = null
 where tipo = 'TAREFA' and status = 'ABERTA' and responsavel_user_id is not null;
alter table public.tarefas_equipe enable trigger tarefas_equipe__guarda;

-- -----------------------------------------------------------------------------
-- Trigger refeita: destinatarios, assumir vira responsavel, prioridade e
-- para_todos imutaveis.
-- -----------------------------------------------------------------------------
create or replace function public.tarefas_equipe__guarda()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_admin     boolean;
  v_recebedor boolean;
begin
  if tg_op = 'INSERT' then
    new.titulo := btrim(new.titulo);
    new.descricao := nullif(btrim(coalesce(new.descricao, '')), '');
    new.status := 'ABERTA';
    new.created_at := now();
    new.updated_at := now();
    new.responsavel_user_id := null;
    new.assumido_por_user_id := null;  new.assumido_at := null;
    new.concluido_por_user_id := null; new.concluido_at := null; new.observacao_conclusao := null;
    new.cancelado_por_user_id := null; new.cancelado_at := null;

    if v_uid is not null then
      new.criado_por_user_id := v_uid;
      if not public.tarefas_equipe__eh_da_equipe(v_uid) then
        raise exception 'Seu usuário ainda não tem acesso para criar tarefas.' using errcode = '42501';
      end if;
      if new.tipo = 'MELHORIA' and not public.tarefas_equipe__eh_admin(v_uid) then
        raise exception 'Somente a diretoria e os administradores criam melhorias.' using errcode = '42501';
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
     or new.prioridade is distinct from old.prioridade
     or new.para_todos is distinct from old.para_todos
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

  -- Ciclo de vida e responsavel: o cliente nao escolhe; a trigger preenche.
  new.responsavel_user_id := old.responsavel_user_id;
  new.assumido_por_user_id := old.assumido_por_user_id;  new.assumido_at := old.assumido_at;
  new.concluido_por_user_id := old.concluido_por_user_id; new.concluido_at := old.concluido_at;
  new.cancelado_por_user_id := old.cancelado_por_user_id; new.cancelado_at := old.cancelado_at;
  new.observacao_conclusao := case when new.status = 'CONCLUIDA'
                                   then nullif(btrim(coalesce(new.observacao_conclusao, '')), '')
                                   else old.observacao_conclusao end;
  new.updated_at := now();

  -- Sem usuario (service_role, SQL do painel): so registra a transicao.
  if v_uid is null then
    if new.status = 'EM_ANDAMENTO' then new.assumido_at := now(); end if;
    if new.status = 'CONCLUIDA' then new.concluido_at := now(); end if;
    if new.status = 'CANCELADA' then new.cancelado_at := now(); end if;
    return new;
  end if;

  v_admin := public.tarefas_equipe__eh_admin(v_uid);
  v_recebedor := old.tipo = 'TAREFA' and (
                   public.tarefas_equipe__eh_destinatario(old.id, v_uid)
                   or (old.para_todos and public.tarefas_equipe__eh_da_equipe(v_uid)));

  if new.status = 'EM_ANDAMENTO' then
    if old.status <> 'ABERTA' then
      raise exception 'Esta tarefa já foi assumida.' using errcode = '42501';
    end if;
    if not (v_admin or v_recebedor) then
      raise exception 'Só quem recebeu a tarefa ou um administrador pode assumi-la.' using errcode = '42501';
    end if;
    new.responsavel_user_id := v_uid;
    new.assumido_por_user_id := v_uid;
    new.assumido_at := now();

  elsif new.status = 'CONCLUIDA' then
    if old.status = 'ABERTA' then
      if not (v_admin or v_recebedor) then
        raise exception 'Só quem recebeu a tarefa ou um administrador pode concluí-la.' using errcode = '42501';
      end if;
      new.responsavel_user_id := v_uid;
      new.assumido_por_user_id := v_uid;
      new.assumido_at := now();
    elsif not (v_admin or v_uid = old.responsavel_user_id) then
      raise exception 'Só quem assumiu a tarefa ou um administrador pode concluí-la.' using errcode = '42501';
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

-- -----------------------------------------------------------------------------
-- Criacao: tarefa + destinatarios na mesma transacao.
-- SECURITY DEFINER para gravar os destinatarios (sem policy de INSERT); as
-- regras de quem cria o que continuam na trigger, que le auth.uid() do JWT.
-- -----------------------------------------------------------------------------
create function public.tarefas_equipe_criar(
  p_tipo          text,
  p_titulo        text,
  p_descricao     text,
  p_prioridade    text,
  p_destinatarios uuid[],
  p_para_todos    boolean,
  p_id_int        bigint,
  p_id_cliente    integer,
  p_data_limite   date
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_tipo  text := coalesce(p_tipo, 'TAREFA');
  v_todos boolean := coalesce(p_para_todos, false);
  v_dest  uuid[];
  v_u     uuid;
  v_id    bigint;
begin
  if v_uid is null then
    raise exception 'Sessão não encontrada.' using errcode = '42501';
  end if;

  v_dest := array(select distinct x from unnest(coalesce(p_destinatarios, '{}'::uuid[])) as x where x is not null);

  if v_tipo = 'TAREFA' then
    if v_todos then
      v_dest := '{}'::uuid[];
    elsif cardinality(v_dest) = 0 then
      raise exception 'Escolha para quem é a tarefa: uma ou mais pessoas, ou todos.' using errcode = '23514';
    end if;
    foreach v_u in array v_dest loop
      if not public.tarefas_equipe__eh_da_equipe(v_u) then
        raise exception 'Uma das pessoas escolhidas não é um usuário ativo da equipe.' using errcode = '23514';
      end if;
    end loop;
  elsif v_todos or cardinality(v_dest) > 0 then
    raise exception 'Melhoria não tem destinatários: qualquer administrador assume.' using errcode = '23514';
  end if;

  insert into public.tarefas_equipe
    (tipo, titulo, descricao, prioridade, para_todos, id_int, id_cliente, data_limite)
  values
    (v_tipo, p_titulo, p_descricao, coalesce(p_prioridade, 'NORMAL'), v_todos and v_tipo = 'TAREFA',
     p_id_int, p_id_cliente, p_data_limite)
  returning id into v_id;

  insert into public.tarefas_equipe_destinatarios (tarefa_id, user_id)
  select v_id, x from unnest(v_dest) as x;

  return v_id;
end;
$$;

revoke all on function public.tarefas_equipe_criar(text, text, text, text, uuid[], boolean, bigint, integer, date) from public, anon;
grant execute on function public.tarefas_equipe_criar(text, text, text, text, uuid[], boolean, bigint, integer, date) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
drop policy tarefas_equipe_select on public.tarefas_equipe;
drop policy tarefas_equipe_insert on public.tarefas_equipe;
drop policy tarefas_equipe_update on public.tarefas_equipe;

create policy tarefas_equipe_select on public.tarefas_equipe
  for select to authenticated
  using (
    (select public.tarefas_equipe__eh_admin((select auth.uid())))
    or (tipo = 'TAREFA' and (
          criado_por_user_id = (select auth.uid())
       or responsavel_user_id = (select auth.uid())
       or (para_todos and (select public.tarefas_equipe__eh_da_equipe((select auth.uid()))))
       or public.tarefas_equipe__eh_destinatario(id, (select auth.uid()))))
  );

create policy tarefas_equipe_update on public.tarefas_equipe
  for update to authenticated
  using (
    (select public.tarefas_equipe__eh_admin((select auth.uid())))
    or (tipo = 'TAREFA' and (
          criado_por_user_id = (select auth.uid())
       or responsavel_user_id = (select auth.uid())
       or (para_todos and (select public.tarefas_equipe__eh_da_equipe((select auth.uid()))))
       or public.tarefas_equipe__eh_destinatario(id, (select auth.uid()))))
  )
  with check (
    (select public.tarefas_equipe__eh_admin((select auth.uid())))
    or (tipo = 'TAREFA' and (
          criado_por_user_id = (select auth.uid())
       or responsavel_user_id = (select auth.uid())
       or (para_todos and (select public.tarefas_equipe__eh_da_equipe((select auth.uid()))))
       or public.tarefas_equipe__eh_destinatario(id, (select auth.uid()))))
  );

revoke insert on table public.tarefas_equipe from authenticated;

alter table public.tarefas_equipe_destinatarios enable row level security;

create policy tarefas_equipe_destinatarios_select on public.tarefas_equipe_destinatarios
  for select to authenticated
  using (public.tarefas_equipe__pode_ver(tarefa_id, (select auth.uid())));

revoke all on table public.tarefas_equipe_destinatarios from anon;
revoke insert, update, delete, truncate, references, trigger on table public.tarefas_equipe_destinatarios from authenticated;
