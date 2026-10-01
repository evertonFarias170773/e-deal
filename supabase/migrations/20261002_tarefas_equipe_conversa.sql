-- =============================================================================
-- tarefas_equipe_conversa — mensagens dentro da tarefa, com anexo opcional.
-- Spec: docs/superpowers/specs/2026-09-30-tarefas-equipe-design.md
-- Autorizada pelo dono em 01/10/2026 (migrations da conversa e da novidade).
--
-- - Qualquer participante escreve (quem criou, destinatarios, responsavel, admin;
--   em tarefa para todos, quem participa das Tarefas) — a mesma regra de quem ve
--   a tarefa (`tarefas_equipe__pode_ver`). Escrever nao muda a situacao.
-- - So com a tarefa ABERTA ou EM_ANDAMENTO, como os anexos. Encerrada, a
--   conversa fica para leitura.
-- - Ninguem edita nem apaga mensagem: sem policy e sem privilegio de UPDATE/DELETE.
-- - Anexo de mensagem reaproveita tarefas_equipe_anexos e o bucket privado:
--   momento 'MENSAGEM' + mensagem_id.
-- - A marcacao de novidade (a mensagem faz o sinal piscar para os outros) vem
--   na migration seguinte, tarefas_equipe_novidade.
-- =============================================================================

create table public.tarefas_equipe_mensagens (
  id            bigint generated always as identity primary key,
  tarefa_id     bigint      not null references public.tarefas_equipe(id) on delete cascade,
  autor_user_id uuid        not null default auth.uid() references auth.users(id),
  mensagem      text        not null,
  created_at    timestamptz not null default now(),
  constraint tarefas_equipe_mensagens_texto_chk check (char_length(btrim(mensagem)) between 1 and 2000)
);
create index tarefas_equipe_mensagens_tarefa_idx on public.tarefas_equipe_mensagens (tarefa_id, created_at);
create index tarefas_equipe_mensagens_autor_idx  on public.tarefas_equipe_mensagens (autor_user_id, tarefa_id);

comment on table public.tarefas_equipe_mensagens is
  'Conversa da tarefa. So participantes leem e escrevem; ninguem edita nem apaga. Spec 2026-09-30-tarefas-equipe-design.md.';

-- Autor e horario pelo servidor; o que o cliente mandar nesses campos e ignorado.
create function public.tarefas_equipe__mensagem_prepara()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.mensagem := btrim(new.mensagem);
  new.created_at := clock_timestamp();
  if auth.uid() is not null then
    new.autor_user_id := auth.uid();
  end if;
  return new;
end;
$$;

revoke all on function public.tarefas_equipe__mensagem_prepara() from public, anon;

create trigger tarefas_equipe_mensagens__prepara
  before insert on public.tarefas_equipe_mensagens
  for each row execute function public.tarefas_equipe__mensagem_prepara();

alter table public.tarefas_equipe_mensagens enable row level security;

create policy tarefas_equipe_mensagens_select on public.tarefas_equipe_mensagens
  for select to authenticated
  using (public.tarefas_equipe__pode_ver(tarefa_id, (select auth.uid())));

-- Escreve quem ve a tarefa, enquanto ela esta ativa (mesma funcao dos anexos).
create policy tarefas_equipe_mensagens_insert on public.tarefas_equipe_mensagens
  for insert to authenticated
  with check (
    autor_user_id = (select auth.uid())
    and public.tarefas_equipe__aceita_anexo(tarefa_id, (select auth.uid()))
  );

revoke all on table public.tarefas_equipe_mensagens from anon;
revoke update, delete, truncate, references, trigger on table public.tarefas_equipe_mensagens from authenticated;

-- -----------------------------------------------------------------------------
-- Anexo de mensagem: mesma tabela e mesmo bucket.
-- -----------------------------------------------------------------------------
alter table public.tarefas_equipe_anexos
  add column mensagem_id bigint references public.tarefas_equipe_mensagens(id) on delete cascade;

alter table public.tarefas_equipe_anexos drop constraint tarefas_equipe_anexos_momento_chk;
alter table public.tarefas_equipe_anexos
  add constraint tarefas_equipe_anexos_momento_chk
  check (momento in ('CRIACAO', 'ANDAMENTO', 'CONCLUSAO', 'MENSAGEM'));
alter table public.tarefas_equipe_anexos
  add constraint tarefas_equipe_anexos_mensagem_chk
  check ((momento = 'MENSAGEM') = (mensagem_id is not null));

create index tarefas_equipe_anexos_mensagem_idx on public.tarefas_equipe_anexos (mensagem_id) where mensagem_id is not null;

-- O anexo so pode apontar para uma mensagem da MESMA tarefa, escrita por quem anexa.
create function public.tarefas_equipe__mensagem_do_autor(p_mensagem bigint, p_tarefa bigint, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.tarefas_equipe_mensagens m
     where m.id = p_mensagem and m.tarefa_id = p_tarefa and m.autor_user_id = p_user_id
  );
$$;

revoke all on function public.tarefas_equipe__mensagem_do_autor(bigint, bigint, uuid) from public, anon;
grant execute on function public.tarefas_equipe__mensagem_do_autor(bigint, bigint, uuid) to authenticated, service_role;

drop policy tarefas_equipe_anexos_insert on public.tarefas_equipe_anexos;
create policy tarefas_equipe_anexos_insert on public.tarefas_equipe_anexos
  for insert to authenticated
  with check (
    enviado_por_user_id = (select auth.uid())
    and public.tarefas_equipe__aceita_anexo(tarefa_id, (select auth.uid()))
    and (mensagem_id is null
         or public.tarefas_equipe__mensagem_do_autor(mensagem_id, tarefa_id, (select auth.uid())))
  );
