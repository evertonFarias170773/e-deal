-- =============================================================================
-- tarefas_equipe_prazo_prioridade_admin — o administrador tambem muda prazo e
-- prioridade, como ja pode assumir, concluir e cancelar.
-- Autorizada pelo dono em 02/10/2026 (migration da guarda).
--
-- So a funcao da guarda muda, em tres pontos: o comentario da regra, a condicao
-- de quem pode (o administrador entra para qualquer tarefa, nao so melhoria) e
-- o texto da recusa. Nada de tabela, coluna ou constraint.
--
-- CONFERENCIA DO CORPO DA GUARDA (quebras de linha LF)
--   antes : b2e0e828e10e9ce663fe8cf47c9e4f82  (20261002_tarefas_equipe_prazo_prioridade.sql)
--   depois: 7f14114462a8b2bb6bd700ab0d4be946
--   select md5(replace(prosrc, chr(13), '')) from pg_proc
--    where oid = 'public.tarefas_equipe__guarda'::regproc;
-- =============================================================================

create or replace function public.tarefas_equipe__guarda()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_admin     boolean;
  v_recebedor boolean;
  v_mudou_prazo      boolean;
  v_mudou_prioridade boolean;
  v_agora            timestamptz;
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
    new.alteracoes := '[]'::jsonb;

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
     or new.para_todos is distinct from old.para_todos
     or (new.id_int is distinct from old.id_int and new.id_int is not null)
     or (new.id_cliente is distinct from old.id_cliente and new.id_cliente is not null)
  then
    raise exception 'Só o prazo, a prioridade e a situação da tarefa podem ser alterados.' using errcode = '42501';
  end if;

  -- O historico de alteracoes so e escrito aqui dentro: o que o cliente mandar
  -- nessa coluna e descartado.
  new.alteracoes := old.alteracoes;

  -- Prazo e prioridade: quem criou, quem recebeu, o responsavel e o
  -- administrador (como nas outras acoes), com a tarefa aberta ou em andamento,
  -- e sem mudar a situacao no mesmo UPDATE.
  v_mudou_prazo := new.data_limite is distinct from old.data_limite;
  v_mudou_prioridade := new.prioridade is distinct from old.prioridade;
  if v_mudou_prazo or v_mudou_prioridade then
    if old.status not in ('ABERTA', 'EM_ANDAMENTO') then
      raise exception 'Esta tarefa já foi encerrada.' using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      raise exception 'Mude o prazo ou a prioridade separado da situação.' using errcode = '42501';
    end if;
    -- Sem usuario (service_role, SQL do painel): passa, e o historico fica sem autor.
    if v_uid is not null and not coalesce(
         v_uid = old.criado_por_user_id
         or v_uid is not distinct from old.responsavel_user_id
         or (old.tipo = 'TAREFA' and (
               public.tarefas_equipe__eh_destinatario(old.id, v_uid)
               or (old.para_todos and public.tarefas_equipe__eh_da_equipe(v_uid))))
         or public.tarefas_equipe__eh_admin(v_uid),
         false)
    then
      raise exception 'Só quem criou a tarefa, quem a recebeu, o responsável ou um administrador pode mudar o prazo e a prioridade.' using errcode = '42501';
    end if;
  end if;

  -- Mesma situacao: passa o vinculo virando nulo (pedido ou cliente apagado), a
  -- novidade marcada pela trigger da mensagem e a mudanca de prazo ou prioridade.
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
    -- Prazo ou prioridade mudou: uma linha por campo no historico, e novidade
    -- de quem mudou (pisca para os outros participantes).
    if v_mudou_prazo or v_mudou_prioridade then
      v_agora := clock_timestamp();
      if v_mudou_prazo then
        new.alteracoes := new.alteracoes || jsonb_build_array(jsonb_build_object(
          'em', v_agora, 'por', v_uid, 'campo', 'PRAZO', 'de', old.data_limite, 'para', new.data_limite));
      end if;
      if v_mudou_prioridade then
        new.alteracoes := new.alteracoes || jsonb_build_array(jsonb_build_object(
          'em', v_agora, 'por', v_uid, 'campo', 'PRIORIDADE', 'de', old.prioridade, 'para', new.prioridade));
      end if;
      new.novidade_em := v_agora;
      new.novidade_por_user_id := v_uid;
      new.novidade_tipo := 'ALTERADA';
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
