-- =============================================================================
-- tarefas_equipe_novidade — mensagem, assumir, concluir e cancelar fazem o sinal
-- piscar para os outros participantes, ate cada um abrir a tarefa.
-- Spec: docs/superpowers/specs/2026-09-30-tarefas-equipe-design.md
-- Autorizada pelo dono em 01/10/2026 (migrations da conversa e da novidade).
--
-- COMO FUNCIONA
--   A tarefa guarda a ULTIMA novidade: quando, quem fez e qual foi.
--   `tarefas_equipe_vistos.visto_em` passa a ser a hora da ULTIMA abertura
--   (antes era gravado uma vez so). Ha novidade para mim quando a ultima
--   novidade e de outra pessoa e e posterior a minha ultima abertura.
--
-- QUEM E AVISADO (alem de quem recebeu a tarefa e nunca abriu, regra antiga):
--   quem criou, o responsavel, os destinatarios escolhidos e quem ja escreveu
--   na conversa. Em tarefa PARA TODOS os destinatarios nao contam: so quem
--   criou, o responsavel e quem ja escreveu — nao pisca para a equipe inteira
--   a cada mensagem. Quem fez a acao nunca recebe o proprio aviso.
--
-- Tarefas que ja existiam ficam com as colunas vazias: nada pisca retroativo.
-- =============================================================================

alter table public.tarefas_equipe
  add column novidade_em          timestamptz,
  add column novidade_por_user_id uuid references auth.users(id),
  add column novidade_tipo        text,
  add constraint tarefas_equipe_novidade_tipo_chk
    check (novidade_tipo is null or novidade_tipo in ('CRIADA', 'MENSAGEM', 'ASSUMIDA', 'CONCLUIDA', 'CANCELADA'));

-- -----------------------------------------------------------------------------
-- Guarda das transicoes: igual a anterior, mais a novidade.
--   - INSERT: novidade CRIADA, de quem criou.
--   - Assumir, concluir, cancelar: novidade do tipo, de quem fez.
--   - Mesma situacao: as colunas de novidade so mudam por dentro de outra
--     trigger (a da mensagem). Um PATCH direto do cliente nao as altera.
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

    new.novidade_em := clock_timestamp();
    new.novidade_por_user_id := new.criado_por_user_id;
    new.novidade_tipo := 'CRIADA';
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

  -- Mesma situacao: passa o vinculo virando nulo (pedido ou cliente apagado) e
  -- a novidade marcada pela trigger da mensagem.
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
    -- pg_trigger_depth() = 1 e UPDATE direto (cliente, painel); > 1 e UPDATE
    -- feito por outra trigger (a da mensagem). So esse segundo mexe na novidade.
    if pg_trigger_depth() <= 1 then
      new.novidade_em := old.novidade_em;
      new.novidade_por_user_id := old.novidade_por_user_id;
      new.novidade_tipo := old.novidade_tipo;
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

  -- Toda mudanca de situacao e novidade, de quem a fez.
  new.novidade_em := clock_timestamp();
  new.novidade_por_user_id := v_uid;
  new.novidade_tipo := case new.status
                         when 'EM_ANDAMENTO' then 'ASSUMIDA'
                         when 'CONCLUIDA' then 'CONCLUIDA'
                         else 'CANCELADA' end;

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
-- Mensagem nova: marca a novidade na tarefa e registra que o autor ja viu ate
-- aqui. SECURITY DEFINER: o autor nao altera as colunas de novidade nem `vistos`.
-- -----------------------------------------------------------------------------
create function public.tarefas_equipe__mensagem_novidade()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.tarefas_equipe
     set novidade_em = clock_timestamp(),
         novidade_por_user_id = new.autor_user_id,
         novidade_tipo = 'MENSAGEM'
   where id = new.tarefa_id;

  insert into public.tarefas_equipe_vistos (tarefa_id, user_id, visto_em)
  values (new.tarefa_id, new.autor_user_id, clock_timestamp())
  on conflict (tarefa_id, user_id) do update set visto_em = excluded.visto_em;

  return new;
end;
$$;

revoke all on function public.tarefas_equipe__mensagem_novidade() from public, anon;

create trigger tarefas_equipe_mensagens__novidade
  after insert on public.tarefas_equipe_mensagens
  for each row execute function public.tarefas_equipe__mensagem_novidade();

-- -----------------------------------------------------------------------------
-- Abrir a tarefa = ver. Regrava a hora a cada abertura.
-- SECURITY DEFINER porque `vistos` nao da UPDATE a authenticated; so grava a
-- linha do proprio usuario, e so de tarefa que ele enxerga.
-- -----------------------------------------------------------------------------
create function public.tarefas_equipe_marcar_vista(p_tarefa bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.tarefas_equipe__pode_ver(p_tarefa, v_uid) then
    return;
  end if;
  insert into public.tarefas_equipe_vistos (tarefa_id, user_id, visto_em)
  values (p_tarefa, v_uid, clock_timestamp())
  on conflict (tarefa_id, user_id) do update set visto_em = excluded.visto_em;
end;
$$;

revoke all on function public.tarefas_equipe_marcar_vista(bigint) from public, anon;
grant execute on function public.tarefas_equipe_marcar_vista(bigint) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Tarefas com novidade para mim (selo "Nova" na linha; a contagem faz o menu e
-- a Topbar piscarem). SECURITY INVOKER: o RLS vale.
-- -----------------------------------------------------------------------------
create function public.tarefas_equipe_novas()
returns table (tarefa_id bigint, tipo text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with eu as (
    select auth.uid() as uid, public.tarefas_equipe__eh_da_equipe(auth.uid()) as da_equipe
  )
  select t.id,
         case when t.novidade_em is not null
                   and t.novidade_em > coalesce(v.visto_em, '-infinity'::timestamptz)
              then t.novidade_tipo else 'CRIADA' end
    from public.tarefas_equipe t
   cross join eu
    left join public.tarefas_equipe_vistos v on v.tarefa_id = t.id and v.user_id = eu.uid
   where
     -- 1. Recebi e nunca abri (regra de sempre).
     ( v.user_id is null
       and t.criado_por_user_id <> eu.uid
       and t.status in ('ABERTA', 'EM_ANDAMENTO')
       and t.tipo = 'TAREFA'
       and ((t.para_todos and eu.da_equipe) or public.tarefas_equipe__eh_destinatario(t.id, eu.uid)) )
     or
     -- 2. Mensagem, assumir, concluir ou cancelar de outra pessoa, depois da
     --    minha ultima abertura, numa tarefa em que estou envolvido.
     ( t.novidade_em is not null
       and t.novidade_tipo <> 'CRIADA'
       and t.novidade_por_user_id is distinct from eu.uid
       and t.novidade_em > coalesce(v.visto_em, '-infinity'::timestamptz)
       and ( t.criado_por_user_id = eu.uid
             or t.responsavel_user_id = eu.uid
             or (not t.para_todos and public.tarefas_equipe__eh_destinatario(t.id, eu.uid))
             or exists (select 1 from public.tarefas_equipe_mensagens m
                         where m.tarefa_id = t.id and m.autor_user_id = eu.uid) ) );
$$;

revoke all on function public.tarefas_equipe_novas() from public, anon;
grant execute on function public.tarefas_equipe_novas() to authenticated, service_role;

-- Resumo: `minhas` como antes; `nao_vistas` passa a contar pela regra nova.
create or replace function public.tarefas_equipe_resumo()
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
    select t.id, t.responsavel_user_id,
           (t.tipo = 'TAREFA' and (
              (t.para_todos and eu.da_equipe)
              or public.tarefas_equipe__eh_destinatario(t.id, eu.uid))) as recebida,
           eu.uid
      from public.tarefas_equipe t, eu
     where t.status in ('ABERTA', 'EM_ANDAMENTO')
  )
  select
    (select count(*) from ativas
      where responsavel_user_id = uid or (responsavel_user_id is null and recebida))::integer,
    (select count(*) from public.tarefas_equipe_novas())::integer;
$$;
