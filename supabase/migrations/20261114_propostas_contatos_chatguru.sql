-- ============================================================================
-- Contatos do pedido pelo ChatGuru (14/11/2026, decisão da diretoria).
--
-- O ChatGuru passa a ser a fonte dos contatos do pedido. Na aba Geral o
-- usuário escolhe uma ou mais conversas do Guru do cliente (visão
-- chatguru_contatos_3478); uma delas é a PRINCIPAL. A principal é o Comprador
-- da aba Artes, e propostas.chatguru_chat_id espelha a principal (a rota
-- /api/orcamentos/conversa-whatsapp grava as duas no mesmo pedido de gravação).
--
-- Uma linha por conversa escolhida. nome e telefone são o retrato da conversa
-- no momento da escolha: a visão do Guru não tem acesso para authenticated, e
-- quem lê o pedido (Expedição, cobrança) precisa deles sem a chave de serviço.
--
-- A tabela contatos continua existindo e sendo gravada; nada aqui a apaga.
--
-- Escrita pela rota, com a sessão do usuário: a RLS repete a de propostas
-- (quem vê a proposta vê e escolhe os contatos dela) e a auditoria registra
-- o autor (audit.log_row_changes_v2).
--
-- Autorização do Everton (14/11/2026): esta migration e a carga dos 144
-- principais (supabase/manutencao/propostas-contatos-chatguru-carga/).
-- ============================================================================

create table public.propostas_contatos_chatguru (
  id bigint generated always as identity primary key,
  id_int integer not null references public.propostas (id_int) on delete cascade,
  chat_id text not null check (length(trim(chat_id)) > 0),
  nome text,
  telefone text,
  principal boolean not null default false,
  escolhido_por uuid,
  escolhido_por_nome text,
  escolhido_em timestamptz not null default now(),
  constraint propostas_contatos_chatguru_conversa_unica unique (id_int, chat_id)
);

comment on table public.propostas_contatos_chatguru is
  'Conversas do ChatGuru escolhidas como contatos do pedido (aba Geral). Uma principal por pedido = Comprador da aba Artes = propostas.chatguru_chat_id.';
comment on column public.propostas_contatos_chatguru.telefone is
  'Número da conversa no momento da escolha, como o Guru guarda (55 + DDD + número, com ou sem o 9).';

-- Uma principal por pedido, no máximo.
create unique index ux_propostas_contatos_chatguru_principal
  on public.propostas_contatos_chatguru (id_int) where principal;

alter table public.propostas_contatos_chatguru enable row level security;

revoke all on table public.propostas_contatos_chatguru from anon, authenticated;
grant select, insert, update, delete on table public.propostas_contatos_chatguru to authenticated;
grant select on table public.propostas_contatos_chatguru to supabase_read_only_user;
grant all on table public.propostas_contatos_chatguru to service_role;

-- Quem enxerga a proposta (RLS de propostas, avaliada com a sessão) enxerga e
-- escolhe os contatos dela.
create policy propostas_contatos_chatguru_leitura
  on public.propostas_contatos_chatguru for select to authenticated
  using (exists (select 1 from public.propostas p where p.id_int = propostas_contatos_chatguru.id_int));

create policy propostas_contatos_chatguru_insercao
  on public.propostas_contatos_chatguru for insert to authenticated
  with check (exists (select 1 from public.propostas p where p.id_int = propostas_contatos_chatguru.id_int));

create policy propostas_contatos_chatguru_alteracao
  on public.propostas_contatos_chatguru for update to authenticated
  using (exists (select 1 from public.propostas p where p.id_int = propostas_contatos_chatguru.id_int))
  with check (exists (select 1 from public.propostas p where p.id_int = propostas_contatos_chatguru.id_int));

create policy propostas_contatos_chatguru_exclusao
  on public.propostas_contatos_chatguru for delete to authenticated
  using (exists (select 1 from public.propostas p where p.id_int = propostas_contatos_chatguru.id_int));

create trigger trg_audit_propostas_contatos_chatguru
  after insert or delete or update on public.propostas_contatos_chatguru
  for each row execute function audit.log_row_changes_v2();
